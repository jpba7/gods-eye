import { haversineKm } from '../common/geo.js';
import { validWikidataId } from './wikidata.js';

/**
 * Wikipedia editions a request may name. The app maps its own locale to one
 * of these; anything else is refused before an upstream URL is built.
 */
export const WIKIPEDIA_LANGUAGES = Object.freeze([
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'pt',
  'ru',
  'uk',
  'zh',
]);

/** MediaWiki caps geosearch at a 10 km radius. */
export const MAX_NEARBY_RADIUS_M = 10_000;
export const MIN_NEARBY_RADIUS_M = 100;
/** One page of results; `prop=pageviews` answers at most 50 pages per request. */
export const NEARBY_LIMIT = 50;
/** Days of page views that rank how notable a place is. */
export const PAGEVIEW_DAYS = 30;
/** Longest intro text a place card keeps. */
export const MAX_EXTRACT_CHARS = 700;

/** A shipped Wikipedia edition, or null. */
export function validWikipediaLanguage(value) {
  const lang = String(value ?? '')
    .trim()
    .toLowerCase();
  return WIKIPEDIA_LANGUAGES.includes(lang) ? lang : null;
}

/** A positive integer page id, or null. */
export function validPageId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9][0-9]{0,11}$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function apiUrl(lang, params) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    ...params,
  }).toString();
  return url.href;
}

/**
 * Articles with coordinates around a point, with what ranks and labels them.
 * @param {{lang:string, latitude:number, longitude:number, radiusM:number}} query
 */
export function nearbyUrl({ lang, latitude, longitude, radiusM }) {
  return apiUrl(lang, {
    generator: 'geosearch',
    ggscoord: `${latitude}|${longitude}`,
    ggsradius: String(radiusM),
    ggslimit: String(NEARBY_LIMIT),
    ggsnamespace: '0',
    prop: 'coordinates|description|pageprops|pageviews',
    colimit: String(NEARBY_LIMIT),
    ppprop: 'wikibase_item',
    pvipdays: String(PAGEVIEW_DAYS),
  });
}

/** One article's intro, link and Wikidata id. */
export function summaryUrl({ lang, pageId }) {
  return apiUrl(lang, {
    pageids: String(pageId),
    prop: 'extracts|description|pageprops|info|coordinates',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    exlimit: '1',
    ppprop: 'wikibase_item',
    inprop: 'url',
  });
}

function text(value, max = 300) {
  const out = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

function primaryCoordinate(page) {
  const rows = Array.isArray(page?.coordinates) ? page.coordinates : [];
  const row = rows.find((candidate) => candidate?.primary !== false) || rows[0];
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Sum of daily views; days the API has not counted yet are null and skipped. */
function totalViews(pageviews) {
  if (!pageviews || typeof pageviews !== 'object') return 0;
  let total = 0;
  for (const count of Object.values(pageviews)) {
    const value = Number(count);
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return Math.round(total);
}

/**
 * Normalize a geosearch response into places ranked by recent page views,
 * nearest first among equals. Returns null for a payload that is not a
 * MediaWiki query response, and [] for an area with no geotagged articles.
 */
export function normalizeNearby(payload, { latitude, longitude }) {
  if (!payload || typeof payload !== 'object' || payload.error) return null;
  // No `query` at all is MediaWiki's answer for an empty generator.
  if (payload.query === undefined) return [];
  const pages = payload.query?.pages;
  if (!Array.isArray(pages)) return null;
  const places = [];
  for (const page of pages) {
    const pageId = validPageId(page?.pageid);
    const point = primaryCoordinate(page);
    const title = text(page?.title, 200);
    if (!pageId || !point || !title) continue;
    places.push({
      pageId,
      title,
      description: text(page.description, 160),
      lat: point.lat,
      lon: point.lon,
      distanceM: Math.round(
        haversineKm(latitude, longitude, point.lat, point.lon) * 1000,
      ),
      views: totalViews(page.pageviews),
      wikidataId: validWikidataId(page.pageprops?.wikibase_item),
    });
  }
  return places
    .sort(
      (a, b) =>
        b.views - a.views || a.distanceM - b.distanceM || a.pageId - b.pageId,
    )
    .slice(0, NEARBY_LIMIT);
}

/**
 * Normalize one article's intro. Returns null when the payload is malformed
 * or the page does not exist.
 */
export function normalizeSummary(payload, lang) {
  const page = payload?.query?.pages?.[0];
  if (!page || page.missing || page.invalid) return null;
  const pageId = validPageId(page.pageid);
  const title = text(page.title, 200);
  if (!pageId || !title) return null;
  let url = null;
  try {
    const parsed = new URL(String(page.fullurl ?? ''));
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === `${lang}.wikipedia.org`
    )
      url = parsed.href;
  } catch {
    // A missing or foreign link is dropped, never passed through.
  }
  return {
    pageId,
    title,
    description: text(page.description, 160),
    extract: text(page.extract, MAX_EXTRACT_CHARS),
    url,
    wikidataId: validWikidataId(page.pageprops?.wikibase_item),
    coordinates: primaryCoordinate(page),
  };
}
