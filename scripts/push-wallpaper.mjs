import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { getFeedVersion, markets } from './wallpaper-feed.mjs';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

async function pushWallpaper() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
    throw new Error('Usage: node scripts/push-wallpaper.mjs [--dry-run]');
  }

  const url = new URL(requiredEnv('WALLPAPER_PUSH_URL'));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('WALLPAPER_PUSH_URL must be an HTTPS URL without credentials, query or fragment');
  }
  const appid = requiredEnv('WALLPAPER_APP_ID');
  const secret = requiredEnv('WALLPAPER_APP_SECRET');
  const data = JSON.parse(await readFile(new URL('../data/latest.json', import.meta.url), 'utf8'));
  if (data?.schemaVersion !== 1 || !data.wallpapers || typeof data.wallpapers !== 'object' ||
      Array.isArray(data.wallpapers) || Object.keys(data.wallpapers).length === 0) {
    throw new Error('Invalid or empty data/latest.json');
  }
  for (const [market, wallpaper] of Object.entries(data.wallpapers)) {
    if (!markets.has(market) || !wallpaper?.id || !wallpaper.publishedAt ||
        !Number.isFinite(Date.parse(wallpaper.publishedAt))) {
      throw new Error(`Invalid wallpaper record for ${market}`);
    }
  }
  if (data.version !== getFeedVersion(data)) {
    throw new Error('Invalid version in data/latest.json');
  }

  // Match PHP json_encode(data, JSON_UNESCAPED_UNICODE).
  const dataJson = JSON.stringify(data)
    .replace(/\//g, '\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const marketList = Object.keys(data.wallpapers).join(', ');
  if (args[0] === '--dry-run') {
    console.log(`Validated push configuration and data for ${marketList}`);
    console.log('Dry run complete; request was not sent');
    return;
  }

  const retryDelays = [2_000, 5_000];
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    // Refresh the signature's timestamp for every HTTP attempt.
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createHash('md5')
      .update(`${appid}${timestamp}${secret}${dataJson}`, 'utf8')
      .digest('hex');
    let retryable = true;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid, timestamp, sign, data }),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      const text = await response.text();
      retryable = response.status === 429 || response.status >= 500;
      let result = null;
      try {
        result = JSON.parse(text);
      } catch {
        // HTML error pages are described by response headers below.
      }
      const message = typeof result?.msg === 'string'
        ? result.msg.replaceAll(secret, '[redacted]').replaceAll(appid, '[redacted]')
            .replaceAll(sign, '[redacted]').replace(/[\r\n]/g, ' ').slice(0, 200)
        : `Content-Type=${response.headers.get('content-type') ?? 'unknown'}, Server=${response.headers.get('server') ?? 'unknown'}`;
      if (!response.ok) {
        throw new Error(`Wallpaper push returned HTTP ${response.status}: ${message}`);
      }
      if (result?.status !== 1) {
        throw new Error(`Wallpaper push was rejected: ${message}`);
      }
      console.log(`Wallpaper push succeeded for ${marketList}`);
      return;
    } catch (error) {
      if (!retryable || attempt === retryDelays.length) throw error;
      console.warn(`Wallpaper push attempt ${attempt + 1}/3 failed; retrying in ${retryDelays[attempt] / 1000}s`);
      await delay(retryDelays[attempt]);
    }
  }
}

try {
  await pushWallpaper();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
