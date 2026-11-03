/**
 * Esri World Imagery Wayback: every published version of the World Imagery
 * basemap since February 2014, each served as its own tile set. The release
 * list is a public JSON document Esri's own Wayback app reads.
 */

/** The release list Esri's Wayback app reads. */
export const WAYBACK_CONFIG_URL =
  'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';

/** Tile host every release is served from. */
export const WAYBACK_TILE_ORIGIN = 'https://wayback.maptiles.arcgis.com';
const TILE_PATH =
  '/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/';

/** The release ids Esri uses are small positive integers. */
export function validReleaseId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9][0-9]{0,8}$/.test(text)) return null;
  return Number(text);
}

/** The tile URL template of one release, in the {level}/{row}/{col} form Esri publishes. */
export function releaseTileUrl(id) {
  return `${WAYBACK_TILE_ORIGIN}${TILE_PATH}${id}/{level}/{row}/{col}`;
}

const TITLE_DATE = /\(Wayback (\d{4})-(\d{2})-(\d{2})\)/;

function releaseDate(title) {
  const match = TITLE_DATE.exec(String(title ?? ''));
  if (!match) return null;
  const [, year, month, day] = match;
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(time);
  // Reject impossible dates such as 2020-02-31 rather than rolling them over.
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  )
    return null;
  return `${year}-${month}-${day}`;
}

/**
 * Normalize the Wayback config into releases sorted oldest first. A release
 * is kept only when its id is valid, its title carries a release date and its
 * tile URL is exactly the Esri template for that id, so nothing else the
 * document may hold ever reaches the browser. Null when the payload is not a
 * release map at all.
 * @param {unknown} payload
 * @returns {Array<{id:number, date:string}> | null}
 */
export function normalizeReleases(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const releases = [];
  const seen = new Set();
  for (const [key, entry] of Object.entries(payload)) {
    const id = validReleaseId(key);
    if (!id || seen.has(id)) continue;
    if (entry?.itemURL !== releaseTileUrl(id)) continue;
    const date = releaseDate(entry.itemTitle);
    if (!date) continue;
    seen.add(id);
    releases.push({ id, date });
  }
  return releases.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}
