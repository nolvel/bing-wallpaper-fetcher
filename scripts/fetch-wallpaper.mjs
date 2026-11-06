import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { getFeedVersion, markets } from './wallpaper-feed.mjs';
const market = process.argv[2];
const force = process.argv[3] === '--force';
const settings = markets.get(market);
const bingOrigin = 'https://www.bing.com';
const dataDirectory = new URL('../data/', import.meta.url);
const output = new URL('latest.json', dataDirectory);
const lock = new URL('.latest.lock/', dataDirectory);
const temporary = new URL('latest.json.tmp', lock);

function getPublishedAt(ssd, timeZone) {
  const date = typeof ssd === 'string' && ssd.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!date) throw new Error('Bing response has an invalid Ssd');

  const [, year, month, day] = date;
  const midnight = `${year}-${month}-${day}T00:00:00.000Z`;
  const target = Date.parse(midnight);
  if (!Number.isFinite(target) || new Date(target).toISOString() !== midnight) {
    throw new Error('Bing response has an invalid Ssd');
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  let timestamp = target;
  // Resolve local midnight using the offset in effect on that date.
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(timestamp).map(({ type, value }) => [type, value]),
    );
    const localAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    timestamp += target - localAsUtc;
  }
  return new Date(timestamp).toISOString();
}

async function fetchWallpaper() {
  const url = new URL('/hp/api/model', bingOrigin);
  url.search = new URLSearchParams({
    mkt: market,
    setlang: settings.language,
    cc: settings.country,
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Bing returned HTTP ${response.status}`);

  const payload = await response.json();
  const media = payload.MediaContents?.[0];
  const content = media?.ImageContent;
  const image = new URL(content?.Image?.Url ?? '/', bingOrigin);
  const imageKey = image.searchParams.get('id') ?? '';
  const match = imageKey.match(/^(OHR\.[\w.-]+_(?<market>[A-Z]{2}-[A-Z]{2})\d+)_(?:\d+x\d+|UHD)\.[a-z]+$/i);
  if (match?.groups.market.toLowerCase() !== market.toLowerCase()) {
    throw new Error(`Expected ${market} image, received ${imageKey || 'no image ID'}`);
  }

  const id = match[1];
  const title = content.Headline?.trim();
  const description = content.Title?.trim();
  const copyright = content.Copyright?.trim();
  if (!title || !description || !copyright) {
    throw new Error('Bing response is missing wallpaper text');
  }

  const publishedAt = getPublishedAt(media.Ssd, settings.timeZone);
  const rawLink = content.BackstageUrl;
  const link = typeof rawLink === 'string' && rawLink.trim() &&
    URL.canParse(rawLink, bingOrigin) ? new URL(rawLink, bingOrigin) : null;
  const linkUrl = link && ['https:', 'http:'].includes(link.protocol)
    ? link.href : null;

  return {
    id,
    publishedAt,
    fetchedAt: new Date().toISOString(),
    title,
    description,
    copyright,
    source: 'Bing',
    previewUrl: `${bingOrigin}/th?id=${id}_640x360.jpg`,
    fullHdUrl: `${bingOrigin}/th?id=${id}_1920x1080.jpg`,
    uhdUrl: `${bingOrigin}/th?id=${id}_UHD.jpg`,
    linkUrl,
    market,
  };
}

async function validateImageUrls(wallpaper) {
  for (const field of ['previewUrl', 'fullHdUrl', 'uhdUrl']) {
    const response = await fetch(wallpaper[field], {
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status !== 200 || !contentType.startsWith('image/')) {
      await response.body?.cancel();
      throw new Error(
        `${field} returned HTTP ${response.status}, Content-Type ${contentType}`,
      );
    }

    const image = await response.arrayBuffer();
    if (image.byteLength === 0) {
      throw new Error(`${field} returned an empty image`);
    }
    console.log(`${field} validated: ${image.byteLength} bytes`);
  }
}

async function readFeed() {
  try {
    const feed = JSON.parse(await readFile(output, 'utf8'));
    if (feed?.schemaVersion !== 1 || !feed.wallpapers ||
        typeof feed.wallpapers !== 'object' || Array.isArray(feed.wallpapers)) {
      throw new Error('Unsupported data/latest.json format');
    }
    return feed;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { schemaVersion: 1, wallpapers: {} };
  }
}

async function updateFeed() {
  if (!settings || process.argv.length > 4 || (process.argv[3] && !force)) {
    throw new Error(`Usage: node scripts/fetch-wallpaper.mjs <${[...markets.keys()].join('|')}> [--force]`);
  }

  await mkdir(dataDirectory, { recursive: true });
  await mkdir(lock);
  try {
    const wallpaper = await fetchWallpaper();
    const feed = await readFeed();
    const existing = feed.wallpapers[market];
    const unchanged = !force && existing?.id === wallpaper.id;
    if (unchanged) {
      console.log(`${market} unchanged: ${wallpaper.id}`);
    } else {
      await validateImageUrls(wallpaper);
      feed.wallpapers[market] = wallpaper;
    }

    const { schemaVersion, wallpapers } = feed;
    const version = getFeedVersion(feed);
    if (unchanged && feed.version === version) return;

    await writeFile(temporary, `${JSON.stringify({ schemaVersion, version, wallpapers }, null, 2)}\n`);
    await rename(temporary, output);
    if (!unchanged) console.log(`${market} updated: ${wallpaper.id}`);
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

try {
  await updateFeed();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
