import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWikipediaService,
  parseNearbyQuery,
  parseSummaryQuery,
  WIKIMEDIA_USER_AGENT,
} from './routes.js';
import {
  nearbyUrl,
  normalizeNearby,
  normalizeSummary,
  validWikipediaLanguage,
} from './upstream.js';
import { extractPlaceFacts, wikidataYear } from './wikidata.js';

const quantity = (amount, unit, extra = {}) => ({
  rank: 'normal',
  mainsnak: {
    snaktype: 'value',
    datavalue: {
      value: {
        amount,
        unit: unit ? `http://www.wikidata.org/entity/${unit}` : '1',
      },
    },
  },
  ...extra,
});
const time = (value) => ({ datavalue: { value: { time: value } } });

test('nearby queries are validated, clamped and snapped to a cache cell', () => {
  const query = parseNearbyQuery(
    new URLSearchParams(
      'lang=pt&latitude=-20.38612&longitude=-43.50349&radius=25000',
    ),
  );
  assert.deepEqual(query, {
    lang: 'pt',
    latitude: -20.385,
    longitude: -43.505,
    radiusM: 10_000,
  });
  assert.equal(
    parseNearbyQuery(
      new URLSearchParams('lang=xx&latitude=1&longitude=1&radius=500'),
    ),
    null,
  );
  assert.equal(
    parseNearbyQuery(
      new URLSearchParams('lang=en&latitude=91&longitude=1&radius=500'),
    ),
    null,
  );
  assert.equal(
    parseNearbyQuery(new URLSearchParams('lang=en&latitude=1&longitude=1')),
    null,
  );
});

test('only shipped editions and numeric page ids reach the upstream', () => {
  assert.equal(validWikipediaLanguage('PT'), 'pt');
  assert.equal(validWikipediaLanguage('evil.example.com/'), null);
  assert.deepEqual(
    parseSummaryQuery(new URLSearchParams('lang=en&pageId=123')),
    { lang: 'en', pageId: 123 },
  );
  assert.equal(
    parseSummaryQuery(new URLSearchParams('lang=en&pageId=12a')),
    null,
  );
  const url = new URL(
    nearbyUrl({ lang: 'pt', latitude: 1, longitude: 2, radiusM: 500 }),
  );
  assert.equal(url.hostname, 'pt.wikipedia.org');
  assert.equal(url.searchParams.get('ggscoord'), '1|2');
});

test('nearby places rank by recent page views, then distance', () => {
  const places = normalizeNearby(
    {
      query: {
        pages: [
          {
            pageid: 1,
            title: 'Quiet chapel',
            coordinates: [{ lat: 0.001, lon: 0, primary: true }],
            pageviews: { a: 3, b: null },
          },
          {
            pageid: 2,
            title: 'Famous square',
            description: 'public square',
            coordinates: [{ lat: 0.002, lon: 0 }],
            pageprops: { wikibase_item: 'Q42' },
            pageviews: { a: 500, b: 250 },
          },
          { pageid: 3, title: 'No coordinates' },
          {
            pageid: 4,
            title: 'Bad id',
            coordinates: [{ lat: 0, lon: 0 }],
            pageprops: { wikibase_item: 'javascript:1' },
          },
        ],
      },
    },
    { latitude: 0, longitude: 0 },
  );
  assert.deepEqual(
    places.map((place) => place.title),
    ['Famous square', 'Quiet chapel', 'Bad id'],
  );
  assert.equal(places[0].views, 750);
  assert.equal(places[0].wikidataId, 'Q42');
  assert.equal(places[0].distanceM, 222);
  assert.equal(places[2].wikidataId, null);
  assert.deepEqual(normalizeNearby({ batchcomplete: true }, {}), []);
  assert.equal(normalizeNearby({ error: { code: 'x' } }, {}), null);
});

test('summaries keep only same-edition HTTPS links', () => {
  const page = {
    pageid: 7,
    title: 'Ouro Preto',
    extract: '  Ouro Preto é um município   brasileiro. ',
    fullurl: 'https://pt.wikipedia.org/wiki/Ouro_Preto',
    pageprops: { wikibase_item: 'Q192797' },
  };
  const summary = normalizeSummary({ query: { pages: [page] } }, 'pt');
  assert.equal(summary.extract, 'Ouro Preto é um município brasileiro.');
  assert.equal(summary.url, 'https://pt.wikipedia.org/wiki/Ouro_Preto');
  const foreign = normalizeSummary(
    { query: { pages: [{ ...page, fullurl: 'https://evil.example/wiki' }] } },
    'pt',
  );
  assert.equal(foreign.url, null);
  assert.equal(
    normalizeSummary({ query: { pages: [{ missing: true }] } }, 'pt'),
    null,
  );
});

test('Wikidata facts pick the newest population and convert units', () => {
  const facts = extractPlaceFacts({
    claims: {
      P1082: [
        quantity('+70000', null, { qualifiers: { P585: [time('+2010-01-01T00:00:00Z')] } }),
        quantity('+74824', null, { qualifiers: { P585: [time('+2022-08-01T00:00:00Z')] } }),
        { ...quantity('+1', null), rank: 'deprecated' },
      ],
      P2044: [quantity('+3800', 'Q3710')],
      P2046: [quantity('+1245.865', 'Q712226')],
      P571: [
        { rank: 'normal', mainsnak: { snaktype: 'value', ...time('+1711-07-08T00:00:00Z') } },
      ],
      P1435: [
        {
          rank: 'normal',
          mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q9259' } } },
        },
      ],
    },
  });
  assert.deepEqual(facts, {
    population: { value: 74824, year: 2022 },
    elevationM: 1158,
    areaKm2: 1246,
    inceptionYear: 1711,
    worldHeritage: true,
  });
  assert.equal(wikidataYear({ time: '-0500-00-00T00:00:00Z' }), -500);
  assert.deepEqual(extractPlaceFacts({}), {
    population: null,
    elevationM: null,
    areaKm2: null,
    inceptionYear: null,
    worldHeritage: false,
  });
});

test('the service identifies itself, caches and falls back to stale data', async () => {
  let clock = 0;
  let fail = false;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (fail) throw new Error('offline');
    return new Response(
      JSON.stringify({
        query: {
          pages: [
            { pageid: 9, title: 'Here', coordinates: [{ lat: 1, lon: 2 }] },
          ],
        },
      }),
    );
  };
  const service = createWikipediaService({ fetchImpl, now: () => clock });
  const query = { lang: 'en', latitude: 1, longitude: 2, radiusM: 1000 };
  const first = await service.nearby(query);
  assert.equal(first.status, 'ready');
  assert.equal(first.places[0].title, 'Here');
  assert.equal(calls[0].init.headers['User-Agent'], WIKIMEDIA_USER_AGENT);

  assert.equal((await service.nearby(query)).status, 'cached');
  assert.equal(calls.length, 1);

  clock = 31 * 60_000;
  fail = true;
  const stale = await service.nearby(query);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.places.length, 1);
});

test('a summary carries Wikidata facts, and survives a Wikidata outage', async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('wikidata.org')) throw new Error('down');
    return new Response(
      JSON.stringify({
        query: {
          pages: [
            {
              pageid: 5,
              title: 'Place',
              extract: 'A place.',
              fullurl: 'https://en.wikipedia.org/wiki/Place',
              pageprops: { wikibase_item: 'Q5' },
            },
          ],
        },
      }),
    );
  };
  const service = createWikipediaService({ fetchImpl });
  const summary = await service.summary({ lang: 'en', pageId: 5 });
  assert.equal(summary.title, 'Place');
  assert.equal(summary.facts, null);
  assert.equal(summary.license, 'CC BY-SA 4.0');
});
