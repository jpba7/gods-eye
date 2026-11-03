import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WAYBACK_CONFIG_URL,
  normalizeReleases,
  releaseTileUrl,
  validReleaseId,
} from './upstream.js';
import { createWaybackService, waybackProxy } from './routes.js';

const entry = (id, date) => ({
  itemID: 'abc',
  itemTitle: `World Imagery (Wayback ${date})`,
  itemURL: releaseTileUrl(id),
  layerIdentifier: 'WB_X',
});

const CONFIG = {
  64001: entry(64001, '2026-02-26'),
  10: entry(10, '2014-02-20'),
  119: entry(119, '2020-10-14'),
};

test('release ids are small positive integers', () => {
  assert.equal(validReleaseId('10'), 10);
  assert.equal(validReleaseId(' 64001 '), 64001);
  for (const bad of ['0', '-1', '1.5', 'x', '', null, '1234567890'])
    assert.equal(validReleaseId(bad), null, String(bad));
});

test('releases come out oldest first with only their id and date', () => {
  assert.deepEqual(normalizeReleases(CONFIG), [
    { id: 10, date: '2014-02-20' },
    { id: 119, date: '2020-10-14' },
    { id: 64001, date: '2026-02-26' },
  ]);
});

test('a release with a foreign URL or an impossible date is dropped', () => {
  const releases = normalizeReleases({
    ...CONFIG,
    5: { ...entry(5, '2015-01-01'), itemURL: 'https://evil.example/{level}' },
    6: entry(6, '2015-02-31'),
    7: { ...entry(7, '2015-01-01'), itemTitle: 'World Imagery' },
    abc: entry(8, '2015-01-01'),
  });
  assert.deepEqual(
    releases.map((release) => release.id),
    [10, 119, 64001],
  );
  assert.equal(normalizeReleases(null), null);
  assert.equal(normalizeReleases([]), null);
  assert.deepEqual(normalizeReleases({}), []);
});

function fakeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: ok ? 200 : status });
  };
  return { calls, fetchImpl };
}

test('the service caches the list and serves a stale copy when Esri fails', async () => {
  let clock = 0;
  let body = CONFIG;
  const calls = [];
  const service = createWaybackService({
    now: () => clock,
    fetchImpl: async (url) => {
      calls.push(url);
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body));
    },
  });
  const first = await service.releases();
  assert.equal(first.status, 'ready');
  assert.equal(first.releases.length, 3);
  assert.match(first.credit, /Esri/);
  assert.deepEqual(calls, [WAYBACK_CONFIG_URL]);

  clock = 60_000;
  assert.equal((await service.releases()).status, 'cached');
  assert.equal(calls.length, 1);

  clock = 2 * 24 * 60 * 60_000;
  body = new Error('down');
  const stale = await service.releases();
  assert.equal(stale.status, 'stale');
  assert.equal(stale.releases.length, 3);

  clock = 30 * 24 * 60 * 60_000;
  await assert.rejects(service.releases());
});

test('an empty or malformed list is an upstream failure', async () => {
  const service = createWaybackService(fakeFetch({}));
  await assert.rejects(service.releases(), /Malformed/);
  const failing = createWaybackService(
    fakeFetch(null, { ok: false, status: 500 }),
  );
  await assert.rejects(failing.releases(), /HTTP 500/);
});

function middleware(service) {
  let handler = null;
  waybackProxy({ service }).configureServer({
    middlewares: {
      use: (path, fn) => {
        assert.equal(path, '/api/wayback/releases');
        handler = fn;
      },
    },
  });
  return async (method = 'GET') => {
    const res = {
      status: 0,
      headers: {},
      body: '',
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = body;
      },
    };
    await handler(
      { method, url: '/api/wayback/releases', headers: {}, socket: {} },
      res,
    );
    return res;
  };
}

test('the route answers GET with the list and refuses other methods', async () => {
  const call = middleware({
    releases: async () => ({ status: 'ready', releases: [] }),
  });
  const ok = await call();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Cache-Control'], 'public, max-age=3600');
  assert.equal((await call('POST')).status, 405);
  const down = middleware({
    releases: async () => {
      throw new Error('down');
    },
  });
  assert.equal((await down()).status, 503);
});
