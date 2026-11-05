import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

const markets = new Map([
  ['zh-CN', { language: 'zh', country: 'CN' }],
  ['en-US', { language: 'en', country: 'US' }],
]);
const market = process.argv[2];
const settings = markets.get(market);
const bingOrigin = 'https://www.bing.com';
const dataDirectory = new URL('../data/', import.meta.url);
const output = new URL('latest.json', dataDirectory);
const lock = new URL('.latest.lock/', dataDirectory);
const temporary = new URL('latest.json.tmp', lock);

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
  const content = payload.MediaContents?.[0]?.ImageContent;
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

  return {
    id,
    fetchedAt: new Date().toISOString(),
    title,
    description,
    copyright,
    source: 'Bing',
    previewUrl: `${bingOrigin}/th?id=${id}_640x360.jpg`,
    fullHdUrl: `${bingOrigin}/th?id=${id}_1920x1080.jpg`,
    uhdUrl: `${bingOrigin}/th?id=${id}_UHD.jpg`,
    linkUrl: null,
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
  if (!settings) {
    throw new Error('Usage: node scripts/fetch-wallpaper.mjs <zh-CN|en-US>');
  }

  await mkdir(dataDirectory, { recursive: true });
  await mkdir(lock);
  try {
    const wallpaper = await fetchWallpaper();
    const feed = await readFeed();
    if (feed.wallpapers[market]?.id === wallpaper.id) {
      console.log(`${market} unchanged: ${wallpaper.id}`);
      return;
    }

    await validateImageUrls(wallpaper);
    feed.wallpapers[market] = wallpaper;
    await writeFile(temporary, `${JSON.stringify(feed, null, 2)}\n`);
    await rename(temporary, output);
    console.log(`${market} updated: ${wallpaper.id}`);
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
