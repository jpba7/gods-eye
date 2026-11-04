/**
 * Photorealistic 3D tile streaming: request tuning and failure recovery.
 *
 * Two problems made zooming over a city feel broken:
 *
 * - **Tiles that failed once never loaded again.** Cesium marks a tile whose
 *   request fails (network blip, HTTP 429/5xx, an expired Google session) as
 *   FAILED for the life of the tileset, and a parent only refines when every
 *   visible child is ready. One failed child therefore froze its whole area at
 *   the coarse level it had, however far the camera zoomed in. Google 3D Tiles
 *   sessions also expire a few hours after the root request, after which every
 *   new tile request fails and nothing refines anywhere.
 *   `installTileFailureRecovery` puts failed tiles back in the queue with a
 *   backoff, and renews the session (one new root request) when failures
 *   look like an expired session.
 * - **Slow refinement after a zoom.** Cesium caps each server at 18 requests
 *   in flight, and while the camera glides it drops requests for tiles it
 *   expects to fly past. Google serves tiles over HTTP/2, so a higher cap and
 *   a gentler moving-camera cull let the sharp tiles arrive sooner.
 */

/** Host key Cesium's RequestScheduler uses for Google Map Tiles. */
export const GOOGLE_TILE_SERVER = 'tile.googleapis.com:443';

export const PHOTOREAL_STREAMING = Object.freeze({
  /** In-flight tile requests to Google (Cesium's default is 18). */
  requestsPerServer: 32,
  /** Moving-camera request culling (Cesium's default is 60; lower culls less). */
  cullRequestsWhileMovingMultiplier: 20,
});

export const TILE_RECOVERY = Object.freeze({
  /** Wait before the first retry, so a burst of failures is handled at once. */
  firstDelayMs: 2_000,
  /** Longest wait between retries while tiles keep failing. */
  maxDelayMs: 60_000,
  /** Retries per tile before it is left alone. */
  attemptsPerTile: 4,
  /** Failures with a refused status before the session is renewed. */
  sessionRefreshAfterFailures: 3,
  /** At most one session renewal (a root request, billed) in this period. */
  sessionRefreshIntervalMs: 10 * 60_000,
});

/** Statuses a tile server returns when its session or credentials lapsed. */
const REFUSED_STATUSES = new Set([400, 401, 403, 404, 410]);

/** Cesium3DTileContentState values (stable since Cesium 1.x). */
const DEFAULT_STATES = Object.freeze({ UNLOADED: 0, FAILED: 5 });

/**
 * Raise the Google per-server request cap and soften moving-camera culling.
 * @param {{RequestScheduler?: object}} Cesium
 * @param {object|null} tileset
 * @returns {object|null} The tileset.
 */
export function configurePhotorealStreaming(Cesium, tileset) {
  const scheduler = Cesium?.RequestScheduler;
  if (scheduler && typeof scheduler.requestsByServer === 'object') {
    const current =
      scheduler.requestsByServer[GOOGLE_TILE_SERVER] ??
      scheduler.maximumRequestsPerServer ??
      0;
    scheduler.requestsByServer[GOOGLE_TILE_SERVER] = Math.max(
      current,
      PHOTOREAL_STREAMING.requestsPerServer,
    );
  }
  if (tileset && typeof tileset === 'object')
    tileset.cullRequestsWhileMovingMultiplier =
      PHOTOREAL_STREAMING.cullRequestsWhileMovingMultiplier;
  return tileset;
}

/** HTTP status quoted in a Cesium tile failure message, if any. */
export function tileFailureStatus(message) {
  const match = /status code:?\s*(\d{3})/i.exec(String(message ?? ''));
  return match ? Number(match[1]) : null;
}

/** The `session` query value of the first content URI in a tileset JSON. */
export function findTilesetSession(json) {
  const stack = json?.root ? [json.root] : [];
  while (stack.length) {
    const node = stack.pop();
    const uri = node?.content?.uri ?? node?.content?.url;
    const match = typeof uri === 'string' && /[?&]session=([^&#]+)/.exec(uri);
    if (match) return decodeURIComponent(match[1]);
    if (Array.isArray(node?.children)) stack.push(...node.children);
  }
  return null;
}

function* walkTiles(root) {
  const stack = root ? [root] : [];
  while (stack.length) {
    const tile = stack.pop();
    yield tile;
    const children = tile?.children;
    if (Array.isArray(children)) for (const child of children) stack.push(child);
  }
}

/**
 * Retry failed 3D tiles and renew an expired tile session.
 * @param {object} tileset - Cesium3DTileset.
 * @param {object} [options]
 * @param {{UNLOADED: number, FAILED: number}} [options.states] - Cesium3DTileContentState.
 * @param {(reason?: string) => void} [options.requestRender]
 * @param {(fn: Function, ms: number) => any} [options.schedule]
 * @param {(id: any) => void} [options.cancel]
 * @param {() => number} [options.now]
 * @param {(event: {retried: number, sessionRenewed: boolean}) => void} [options.onRecover]
 * @returns {{recover: () => Promise<object>, destroy: () => void}}
 */
export function installTileFailureRecovery(
  tileset,
  {
    states = DEFAULT_STATES,
    requestRender = () => {},
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    now = () => Date.now(),
    onRecover = null,
  } = {},
) {
  const noop = { recover: async () => ({ retried: 0 }), destroy() {} };
  if (!tileset?.tileFailed?.addEventListener) return noop;

  const attempts = new WeakMap();
  let timer = null;
  let streak = 0;
  let refused = 0;
  let lastRefresh = -Infinity;
  let destroyed = false;
  let running = null;

  const alive = () => !destroyed && !tileset.isDestroyed?.();

  const renewSession = async () => {
    lastRefresh = now();
    const resource = tileset.resource;
    if (typeof resource?.fetchJson !== 'function') return false;
    let session = null;
    try {
      session = findTilesetSession(await resource.fetchJson());
    } catch {
      return false;
    }
    if (!session || !alive()) return false;
    let renewed = 0;
    for (const tile of walkTiles(tileset.root)) {
      const content = tile?._contentResource;
      const current = content?.queryParameters?.session;
      if (typeof current !== 'string' || current === session) continue;
      content.setQueryParameters({ session });
      renewed++;
    }
    return renewed > 0;
  };

  const recover = async () => {
    timer = null;
    if (!alive()) return { retried: 0, sessionRenewed: false };
    let sessionRenewed = false;
    if (
      refused >= TILE_RECOVERY.sessionRefreshAfterFailures &&
      now() - lastRefresh >= TILE_RECOVERY.sessionRefreshIntervalMs
    )
      sessionRenewed = await renewSession();
    refused = 0;
    if (!alive()) return { retried: 0, sessionRenewed };
    let retried = 0;
    for (const tile of walkTiles(tileset.root)) {
      if (tile?._contentState !== states.FAILED) continue;
      // A failed request leaves no content; anything else failed while
      // processing and needs Cesium to unload it first.
      if (tile._content !== undefined && tile._content !== null) continue;
      const used = attempts.get(tile) ?? 0;
      if (used >= TILE_RECOVERY.attemptsPerTile) continue;
      attempts.set(tile, used + 1);
      tile._contentState = states.UNLOADED;
      retried++;
    }
    if (retried) {
      streak++;
      requestRender('tile-recovery');
    }
    const result = { retried, sessionRenewed };
    onRecover?.(result);
    return result;
  };

  const run = () => {
    running = recover().finally(() => {
      running = null;
    });
    return running;
  };

  const onFailed = (event) => {
    if (!alive()) return;
    if (REFUSED_STATUSES.has(tileFailureStatus(event?.message))) refused++;
    if (timer !== null || running) return;
    const delay = Math.min(
      TILE_RECOVERY.maxDelayMs,
      TILE_RECOVERY.firstDelayMs * 2 ** Math.min(streak, 5),
    );
    timer = schedule(run, delay);
  };
  // Everything in view loaded: the next failure starts a fresh backoff.
  const onAllLoaded = () => {
    streak = 0;
  };

  const removeFailed = tileset.tileFailed.addEventListener(onFailed);
  const removeLoaded = tileset.allTilesLoaded?.addEventListener?.(onAllLoaded);

  return {
    recover: run,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) cancel(timer);
      timer = null;
      removeFailed?.();
      removeLoaded?.();
    },
  };
}
