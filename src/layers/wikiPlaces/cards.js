/** Card model for one selected place. Pure — no Cesium types. */
import { formatNumber, t, tn } from '../../i18n/index.js';
import { WIKI_PLACES_ACCENT, wrapText } from './model.js';

/** A year as read in the UI language; BCE years are negative in Wikidata. */
function yearLabel(year) {
  return year < 0
    ? t('{year} BCE', { year: formatNumber(-year, { useGrouping: false }) })
    : formatNumber(year, { useGrouping: false });
}

/**
 * The fact lines Wikidata supplies, in the UI language. Empty when there are
 * no facts; a missing fact is simply left out.
 * @param {?object} facts - `facts` from the summary proxy.
 * @returns {string[]}
 */
export function placeFactLines(facts) {
  if (!facts) return [];
  const size = [];
  if (facts.population) {
    const people = formatNumber(facts.population.value);
    size.push(
      facts.population.year
        ? tn(
            facts.population.value,
            '{count} inhabitant ({year})',
            '{count} inhabitants ({year})',
            { count: people, year: yearLabel(facts.population.year) },
          )
        : tn(
            facts.population.value,
            '{count} inhabitant',
            '{count} inhabitants',
            { count: people },
          ),
    );
  }
  if (Number.isFinite(facts.areaKm2))
    size.push(`${formatNumber(facts.areaKm2)} km²`); // i18n-ignore: unit symbol
  if (Number.isFinite(facts.elevationM))
    size.push(
      t('{elevation} m above sea level', {
        elevation: formatNumber(facts.elevationM),
      }),
    );
  const history = [];
  if (Number.isFinite(facts.inceptionYear))
    history.push(t('Since {year}', { year: yearLabel(facts.inceptionYear) }));
  if (facts.worldHeritage) history.push(t('UNESCO World Heritage Site'));
  return [size.join(' · '), history.join(' · ')].filter(Boolean);
}

/**
 * Build the overlay-host entry for one selected place. The caller supplies
 * `position` separately — this model stays JSON-safe for tests.
 * @param {{pageId:number, title:string, description?:string}} place
 * @param {{summary?: ?object, loading?: boolean, failed?: boolean}} state
 * @returns {object} World-overlay entry without `position`.
 */
export function buildPlaceCard(
  place,
  { summary = null, loading = false, failed = false } = {},
) {
  const description = summary?.description || place.description;
  const details = [];
  if (description) details.push(...wrapText(description, 52, 1));
  if (loading) details.push(t('Loading from Wikipedia…'));
  else if (failed)
    details.push(t('Wikipedia did not answer · click the place to retry'));
  else if (summary) {
    details.push(...placeFactLines(summary.facts));
    if (summary.extract) details.push(...wrapText(summary.extract, 52, 4));
  }
  const link = summary?.url || null;
  // The source and licence stay as written in every language.
  const credit = 'Wikipedia · CC BY-SA 4.0'; // i18n-ignore: product and licence names
  details.push(link ? `${credit} · ${t('click card to read more')}` : credit);
  const title = summary?.title || place.title;
  return {
    id: `wiki-place-card:${place.pageId}`,
    selected: true,
    // Only a linked card is clickable: the overlay host registers hit
    // rectangles solely for interactive entries.
    interactive: Boolean(link),
    ...(link
      ? { accessibilityLabel: t('Open {title} on Wikipedia', { title }) }
      : undefined),
    title,
    details,
    accent: WIKI_PLACES_ACCENT,
    priority: Number.MAX_SAFE_INTEGER,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}
