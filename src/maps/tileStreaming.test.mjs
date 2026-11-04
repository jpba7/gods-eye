import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  GOOGLE_TILE_SERVER,
  PHOTOREAL_STREAMING,
  TILE_RECOVERY,
  configurePhotorealStreaming,
  findTilesetSession,
  installTileFailureRecovery,
  tileFailureStatus,
} from './tileStreaming.js';

const { UNLOADED, FAILED, READY } = Cesium.Cesium3DTileContentState;

/** A resource with the query-parameter surface the recovery touches. */
const fakeResource = (session) => ({
  queryParameters: { key: 'k', session },
  setQueryParameters(params) {
    this.queryParameters = { ...this.queryParameters, ...params };
  },
});

const tile = (state, session = 'old', children = []) => ({
  _contentState: state,
  _content: undefined,
  _contentResource: fakeResource(session),
  children,
});

function fakeTileset(root, { rootJson = null } = {}) {
  const failed = new Cesium.Event();
  const allLoaded = new Cesium.Event();
  let fetches = 0;
  return {
    root,
    tileFailed: failed,
    allTilesLoaded: allLoaded,
    resource: {
      async fetchJson() {
        fetches++;
        return rootJson;
      },
    },
    isDestroyed: () => false,
    fetches: () => fetches,
  };
}

/** Manual timers: `schedule` records, `flush` runs the pending callback. */
function fakeTimers() {
  const pending = [];
  return {
    schedule: (fn, ms) => {
      pending.push({ fn, ms });
      return pending.length;
    },
    cancel: () => {},
    delays: () => pending.map((entry) => entry.ms),
    flush: async () => {
      const next = pending.shift();
      await next?.fn();
    },
    count: () => pending.length,
  };
}

test('Google tile requests get a higher per-server cap and softer moving cull', () => {
  const scheduler = { maximumRequestsPerServer: 18, requestsByServer: {} };
  const tileset = { cullRequestsWhileMovingMultiplier: 60 };
  assert.equal(
    configurePhotorealStreaming({ RequestScheduler: scheduler }, tileset),
    tileset,
  );
  assert.equal(
    scheduler.requestsByServer[GOOGLE_TILE_SERVER],
    PHOTOREAL_STREAMING.requestsPerServer,
  );
  assert.ok(PHOTOREAL_STREAMING.requestsPerServer > 18);
  assert.equal(
    tileset.cullRequestsWhileMovingMultiplier,
    PHOTOREAL_STREAMING.cullRequestsWhileMovingMultiplier,
  );
  // A larger limit someone configured is kept, and a missing tileset is fine.
  scheduler.requestsByServer[GOOGLE_TILE_SERVER] = 64;
  assert.equal(configurePhotorealStreaming({ RequestScheduler: scheduler }, null), null);
  assert.equal(scheduler.requestsByServer[GOOGLE_TILE_SERVER], 64);
});

test('tile failure messages and root JSON are parsed defensively', () => {
  assert.equal(tileFailureStatus('Request has failed. Status Code: 403'), 403);
  assert.equal(tileFailureStatus('network error'), null);
  assert.equal(tileFailureStatus(undefined), null);
  assert.equal(
    findTilesetSession({
      root: {
        children: [
          { content: { uri: '/v1/3dtiles/datasets/x/files/a.json?session=NEW%3D&key=k' } },
        ],
      },
    }),
    'NEW=',
  );
  assert.equal(findTilesetSession({ root: { children: [] } }), null);
  assert.equal(findTilesetSession(null), null);
});

test('a failed tile is queued again after a delay, and the area can refine', async () => {
  const failedLeaf = tile(FAILED);
  const readyLeaf = tile(READY);
  const tileset = fakeTileset(tile(READY, 'old', [failedLeaf, readyLeaf]));
  const timers = fakeTimers();
  const renders = [];
  const recovery = installTileFailureRecovery(tileset, {
    states: { UNLOADED, FAILED },
    requestRender: (reason) => renders.push(reason),
    schedule: timers.schedule,
    cancel: timers.cancel,
  });

  tileset.tileFailed.raiseEvent({ url: 'a', message: 'net::ERR_FAILED' });
  tileset.tileFailed.raiseEvent({ url: 'b', message: 'net::ERR_FAILED' });
  assert.deepEqual(timers.delays(), [TILE_RECOVERY.firstDelayMs], 'one pass per burst');
  assert.equal(failedLeaf._contentState, FAILED, 'nothing changes before the delay');

  await timers.flush();
  assert.equal(failedLeaf._contentState, UNLOADED, 'Cesium requests UNLOADED tiles again');
  assert.equal(readyLeaf._contentState, READY);
  assert.deepEqual(renders, ['tile-recovery'], 'idle render mode wakes up');
  assert.equal(tileset.fetches(), 0, 'plain failures never cost a root request');
  recovery.destroy();
});

test('retries back off while tiles keep failing and stop after the per-tile budget', async () => {
  const leaf = tile(FAILED);
  const tileset = fakeTileset(tile(READY, 'old', [leaf]));
  const timers = fakeTimers();
  const recovery = installTileFailureRecovery(tileset, {
    states: { UNLOADED, FAILED },
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  const delays = [];
  for (let i = 0; i < TILE_RECOVERY.attemptsPerTile + 2; i++) {
    leaf._contentState = FAILED;
    tileset.tileFailed.raiseEvent({ message: 'Status Code: 503' });
    delays.push(...timers.delays());
    await timers.flush();
  }
  assert.deepEqual(delays.slice(0, 3), [2000, 4000, 8000]);
  assert.ok(delays.every((ms) => ms <= TILE_RECOVERY.maxDelayMs));
  assert.equal(leaf._contentState, FAILED, 'a tile that always fails is left alone');

  // Once everything in view has loaded, the next failure starts fresh.
  tileset.allTilesLoaded.raiseEvent();
  tileset.tileFailed.raiseEvent({ message: 'x' });
  assert.deepEqual(timers.delays(), [TILE_RECOVERY.firstDelayMs]);
  recovery.destroy();
  assert.equal(tileset.tileFailed.numberOfListeners, 0);
});

test('refused requests renew the tile session once, then retry with it', async () => {
  const leaves = [tile(FAILED), tile(FAILED), tile(FAILED), tile(READY)];
  const root = tile(READY, 'old', leaves);
  const tileset = fakeTileset(root, {
    rootJson: { root: { children: [{ content: { uri: '/a.json?session=fresh' } }] } },
  });
  const timers = fakeTimers();
  let clock = 1_000_000;
  const results = [];
  installTileFailureRecovery(tileset, {
    states: { UNLOADED, FAILED },
    schedule: timers.schedule,
    cancel: timers.cancel,
    now: () => clock,
    onRecover: (result) => results.push(result),
  });

  for (let i = 0; i < TILE_RECOVERY.sessionRefreshAfterFailures; i++)
    tileset.tileFailed.raiseEvent({ message: 'Request has failed. Status Code: 400' });
  await timers.flush();
  assert.equal(tileset.fetches(), 1);
  assert.deepEqual(results.at(-1), { retried: 3, sessionRenewed: true });
  for (const node of [root, ...leaves]) {
    assert.equal(node._contentResource.queryParameters.session, 'fresh');
    assert.equal(node._contentResource.queryParameters.key, 'k');
  }

  // More refusals inside the refresh interval retry without another root request.
  for (const leaf of leaves.slice(0, 3)) leaf._contentState = FAILED;
  clock += TILE_RECOVERY.sessionRefreshIntervalMs - 1;
  for (let i = 0; i < TILE_RECOVERY.sessionRefreshAfterFailures; i++)
    tileset.tileFailed.raiseEvent({ message: 'Status Code: 403' });
  await timers.flush();
  assert.equal(tileset.fetches(), 1, 'root requests are rate limited');
  assert.equal(results.at(-1).retried, 3);
});

test('a destroyed tileset or recovery does nothing', async () => {
  const leaf = tile(FAILED);
  const tileset = fakeTileset(tile(READY, 'old', [leaf]));
  const timers = fakeTimers();
  const recovery = installTileFailureRecovery(tileset, {
    states: { UNLOADED, FAILED },
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  tileset.tileFailed.raiseEvent({ message: 'x' });
  tileset.isDestroyed = () => true;
  await timers.flush();
  assert.equal(leaf._contentState, FAILED);
  recovery.destroy();
  recovery.destroy();
  assert.deepEqual(installTileFailureRecovery(null).destroy(), undefined);
});
