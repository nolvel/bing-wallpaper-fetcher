import { createHash } from 'node:crypto';

export const markets = new Map([
  ['zh-CN', { language: 'zh', country: 'CN', timeZone: 'Asia/Shanghai' }],
  ['en-US', { language: 'en', country: 'US', timeZone: 'America/Los_Angeles' }],
  ['ja-JP', { language: 'ja', country: 'JP', timeZone: 'Asia/Tokyo' }],
  ['it-IT', { language: 'it', country: 'IT', timeZone: 'Europe/Rome' }],
  ['es-ES', { language: 'es', country: 'ES', timeZone: 'Europe/Madrid' }],
]);

export function getFeedVersion({ schemaVersion, wallpapers }) {
  const content = JSON.stringify({ schemaVersion, wallpapers }, (_key, value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
  return createHash('md5').update(content).digest('hex').slice(0, 16);
}
