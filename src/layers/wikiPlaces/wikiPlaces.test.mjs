import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createWikiPlacesLayer } from './index.js';
import { buildPlaceCard, placeFactLines } from './cards.js';
import {
  MAX_SEARCH_ALTITUDE_M,
  WIKI_PLACES_CARD_SOURCE_ID,
  WIKI_PLACES_LABEL_SOURCE_ID,
  sameSearch,
  viewSearch,
  wikipediaLanguage,
  wrapText,
} from './model.js';
import { createWikipediaPlacesSource } from './source.js';

const place = (pageId, title, lat = -20.385, lon = -43.503) => ({
  pageId,
  title,
  description: `${title} description`,
  lat,
  lon,
  distanceM: 10,
  views: 1000 - pageId,
  wikidataId: `Q${pageId}`,
});

function harness({
  places = [place(1, 'Ouro Preto'), place(2, 'Igreja de São Francisco')],
  summary = null,
  heightM = 5_000,
  center = { lat: -20.385, lon: -43.503 },
} = {}) {
  const events = [];
  const searches = [];
  const opened = [];
  let clickAction = null;
  let picked = null;
  let cardHit = null;
  const moveEnd = new Set();
  const camera = {
    positionCartographic: { height: heightM },
    pickEllipsoid: () =>
      center ? Cesium.Cartesian3.fromDegrees(center.lon, center.lat) : null,
    moveEnd: {
      addEventListener: (fn) => moveEnd.add(fn),
      removeEventListener: (fn) => moveEnd.delete(fn),
    },
  };
  const viewer = {
    camera,
    scene: {
      canvas: { clientWidth: 800, clientHeight: 600 },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
      pick: () => picked,
    },
    dataSources: { add() {}, remove() {} },
  };
  const source = {
    async getNearby(search) {
      searches.push(search);
      return { places };
    },
    async getSummary() {
      return summary;
    },
  };
  const layer = createWikiPlacesLayer({
    source,
    locale: () => 'pt',
    overlayHost: {
      setEntries: (...args) => events.push(['set', ...args]),
      setVisible() {},
      clearSource: (id) => events.push(['clear', id]),
      hitTest: () => cardHit,
    },
    picking: {
      resolvePickId: (value) => value?.id?.id ?? null,
      isOwnedByOtherLayer: () => false,
      registerPickOwner() {},
      unregisterPickOwner() {},
    },
    screenSpaceEventHandlerFactory: () => ({
      setInputAction: (fn) => {
        clickAction = fn;
      },
      destroy() {},
    }),
    openExternal: (url) => opened.push(url),
    setTimer: (fn) => {
      fn();
      return 1;
    },
    clearTimer() {},
  });
  layer.init(viewer);
  return {
    layer,
    viewer,
    camera,
    events,
    searches,
    opened,
    moveEnd,
    click: () => clickAction({ position: { x: 1, y: 1 } }),
    pick: (value) => {
      picked = value;
    },
    hitCard: (value) => {
      cardHit = value;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the app locale chooses the Wikipedia edition', () => {
  assert.equal(wikipediaLanguage('pt'), 'pt');
  assert.equal(wikipediaLanguage('zh-Hant'), 'zh');
  assert.equal(wikipediaLanguage('xx'), 'en');
});

test('the search follows the view and stops above the ceiling', () => {
  const near = viewSearch({ lat: 1, lon: 2 }, 3_000, 'en');
  assert.deepEqual(near, {
    lang: 'en',
    latitude: 1,
    longitude: 2,
    radiusM: 2_100,
  });
  assert.equal(viewSearch({ lat: 1, lon: 2 }, 40_000, 'en').radiusM, 10_000);
  assert.equal(viewSearch({ lat: 1, lon: 2 }, 100, 'en').radiusM, 1_000);
  assert.equal(
    viewSearch({ lat: 1, lon: 2 }, MAX_SEARCH_ALTITUDE_M + 1, 'en'),
    null,
  );
  assert.equal(viewSearch(null, 1_000, 'en'), null);
  assert.equal(sameSearch(near, { ...near, latitude: 1.001 }), true);
  assert.equal(sameSearch(near, { ...near, latitude: 1.01 }), false);
  assert.equal(sameSearch(near, { ...near, lang: 'pt' }), false);
});

test('long text wraps on words and is cut with an ellipsis', () => {
  assert.deepEqual(wrapText('a bb ccc dddd', 6, 3), ['a bb', 'ccc', 'dddd']);
  assert.deepEqual(wrapText('one two three four five six', 9, 2), [
    'one two',
    'three…',
  ]);
  assert.deepEqual(wrapText('', 10, 2), []);
});

test('fact lines leave out what Wikidata does not have', () => {
  assert.deepEqual(placeFactLines(null), []);
  assert.deepEqual(
    placeFactLines({
      population: { value: 74824, year: 2022 },
      areaKm2: 1246,
      elevationM: 1150,
      inceptionYear: 1711,
      worldHeritage: true,
    }),
    [
      '74,824 inhabitants (2022) · 1,246 km² · 1,150 m above sea level',
      'Since 1711 · UNESCO World Heritage Site',
    ],
  );
  assert.deepEqual(placeFactLines({ inceptionYear: -500 }), ['Since 500 BCE']);
});

test('a card is clickable only when the article has a link', () => {
  const loading = buildPlaceCard(place(1, 'Ouro Preto'), { loading: true });
  assert.equal(loading.interactive, false);
  assert.equal(loading.title, 'Ouro Preto');
  assert.ok(loading.details.includes('Loading from Wikipedia…'));
  const ready = buildPlaceCard(place(1, 'Ouro Preto'), {
    summary: {
      title: 'Ouro Preto',
      extract: 'Ouro Preto é um município brasileiro.',
      url: 'https://pt.wikipedia.org/wiki/Ouro_Preto',
      facts: null,
    },
  });
  assert.equal(ready.interactive, true);
  assert.match(ready.accessibilityLabel, /Ouro Preto/);
  assert.match(ready.details.at(-1), /CC BY-SA 4\.0/);
});

test('enabling searches the view in the locale edition and labels places', async () => {
  const h = harness();
  h.layer.enable(h.viewer);
  await settle();
  assert.equal(h.searches.length, 1);
  assert.equal(h.searches[0].lang, 'pt');
  assert.equal(h.layer.getStats().count, 2);
  const labels = h.events.findLast(
    ([kind, id]) => kind === 'set' && id === WIKI_PLACES_LABEL_SOURCE_ID,
  );
  assert.deepEqual(
    labels[2].map((entry) => entry.title),
    ['Ouro Preto', 'Igreja de São Francisco'],
  );
  // A camera move to the same cell does not search again.
  for (const listener of h.moveEnd) listener();
  await settle();
  assert.equal(h.searches.length, 1);
});

test('above the ceiling the layer waits and says why', async () => {
  const h = harness({ heightM: MAX_SEARCH_ALTITUDE_M * 2 });
  h.layer.enable(h.viewer);
  await settle();
  assert.equal(h.searches.length, 0);
  assert.equal(h.layer.getStats().statusMessage, 'zoom in to see places');
});

test('clicking a place opens its card; clicking the card opens the article', async () => {
  const summary = {
    title: 'Ouro Preto',
    extract: 'Ouro Preto é um município brasileiro.',
    url: 'https://pt.wikipedia.org/wiki/Ouro_Preto',
    facts: { population: { value: 74824, year: 2022 } },
  };
  const h = harness({ summary });
  h.layer.enable(h.viewer);
  await settle();
  h.pick({ id: { id: 'wiki-places:1' } });
  h.click();
  await settle();
  const card = h.events.findLast(
    ([kind, id]) => kind === 'set' && id === WIKI_PLACES_CARD_SOURCE_ID,
  )[2][0];
  assert.equal(card.title, 'Ouro Preto');
  assert.equal(card.interactive, true);
  assert.ok(card.details.some((line) => line.includes('74,824')));

  h.hitCard({ entryId: card.id });
  h.click();
  assert.deepEqual(h.opened, ['https://pt.wikipedia.org/wiki/Ouro_Preto']);
  assert.equal(card.activate(), true);

  // Empty space clears the selection.
  h.hitCard(null);
  h.pick(null);
  h.click();
  assert.deepEqual(h.events.at(-1), ['clear', WIKI_PLACES_CARD_SOURCE_ID]);
});

test('a missing summary says so and a second click retries', async () => {
  const h = harness({ summary: null });
  h.layer.enable(h.viewer);
  await settle();
  const cards = () =>
    h.events.filter(
      ([kind, id]) => kind === 'set' && id === WIKI_PLACES_CARD_SOURCE_ID,
    );
  h.pick({ id: { id: 'wiki-places:2' } });
  h.click();
  await settle();
  const card = cards().at(-1)[2][0];
  assert.equal(card.interactive, false);
  assert.ok(
    card.details.includes(
      'Wikipedia did not answer · click the place to retry',
    ),
  );
  const published = cards().length;
  h.click();
  await settle();
  assert.ok(cards().length > published, 'the retry publishes a loading card');
});

test('disable clears places and the card', async () => {
  const h = harness();
  h.layer.enable(h.viewer);
  await settle();
  h.layer.disable(h.viewer);
  assert.equal(h.layer.getStats().count, 0);
  assert.equal(h.moveEnd.size, 0);
  assert.ok(
    h.events.some(
      ([kind, id]) => kind === 'clear' && id === WIKI_PLACES_LABEL_SOURCE_ID,
    ),
  );
});

test('the browser source calls the local proxy and treats 404 as gone', async () => {
  const urls = [];
  const source = createWikipediaPlacesSource({
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('summary')) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ places: [] }));
    },
  });
  const nearby = await source.getNearby({
    lang: 'pt',
    latitude: 1,
    longitude: 2,
    radiusM: 1000,
  });
  assert.deepEqual(nearby.places, []);
  assert.equal(
    urls[0],
    '/api/wikipedia/nearby?lang=pt&latitude=1&longitude=2&radius=1000',
  );
  assert.equal(await source.getSummary({ lang: 'pt', pageId: 3 }), null);
});
