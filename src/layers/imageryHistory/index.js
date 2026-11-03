import * as Cesium from 'cesium';
import { formatDate, msg, t } from '../../i18n/index.js';
import { NO_IMAGERY_HOST, resolveImageryHost } from '../../maps/imageryHost.js';
import {
  DEFAULT_SPLIT,
  IMAGERY_HISTORY_LAYER_ID,
  IMAGERY_HISTORY_OWNER,
  WAYBACK_MAX_LEVEL,
  pickYear,
  yearlyReleases,
} from './model.js';
export * from './model.js';
export { createWaybackSource } from './source.js';

const NO_HOST = Object.freeze({ collection: null, kind: 'none' });
const RENDER_REASON = 'imagery-history';
const RELEASE_DAY = Object.freeze({
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * Own the Imagery through time display: one Esri World Imagery Wayback
 * release draped over the globe, chosen by year from the layer row, and by
 * default swiped against today's basemap so the two read side by side.
 *
 * While the layer is on it holds the map's imagery-comparison lease, which
 * moves a Google 3D view to Esri imagery (3D tiles cannot be swiped) and
 * restores it when the layer turns off. When another tool holds the lease the
 * old imagery still drapes, without the swipe.
 */
export function createImageryHistoryLayer({
  source,
  createSplit = null,
  requestRender = () => {},
  cesium = Cesium,
  host = resolveImageryHost,
} = {}) {
  if (
    typeof source?.getReleases !== 'function' ||
    typeof source?.tileTemplate !== 'function'
  )
    throw new TypeError('Imagery through time requires a Wayback source');

  let _viewer = null;
  let _enabled = false;
  let _years = [];
  let _year = null;
  let _swipe = true;
  let _split = DEFAULT_SPLIT;
  let _hostInfo = NO_HOST;
  let _draped = null; // { layer, collection, id }
  let _splitControl = null;
  let _controller = null;
  let _unsubscribeMap = null;
  let _lease = null;
  let _leaseRefused = false;
  let _request = null;
  let _lastUpdate = null;
  let _lastError = null;
  let _rowListener = null;

  const notify = () => _rowListener?.();
  const render = () => requestRender(RENDER_REASON);
  const selected = () => _years.find((entry) => entry.year === _year) || null;
  const swipeLive = () =>
    _swipe && !_leaseRefused && _hostInfo.kind === 'globe' && Boolean(_draped);

  function createProvider(id) {
    const provider = new cesium.UrlTemplateImageryProvider({
      url: source.tileTemplate(id),
      minimumLevel: 0,
      maximumLevel: WAYBACK_MAX_LEVEL,
      tilingScheme: new cesium.WebMercatorTilingScheme(),
      credit: source.credit,
    });
    // The scene renders on request: ask for a frame as each tile lands.
    const requestImage = provider.requestImage.bind(provider);
    provider.requestImage = (...args) => {
      const promise = requestImage(...args);
      return promise ? Promise.resolve(promise).finally(render) : promise;
    };
    return provider;
  }

  function undrape() {
    const record = _draped;
    _draped = null;
    if (!record) return false;
    try {
      record.collection.remove(record.layer, true);
    } catch {
      /* the collection is already gone */
    }
    return true;
  }

  function applySplit() {
    const live = swipeLive();
    if (_draped)
      _draped.layer.splitDirection = live
        ? cesium.SplitDirection.LEFT
        : cesium.SplitDirection.NONE;
    if (live && !_splitControl && createSplit) {
      const release = selected();
      _splitControl = createSplit({
        scene: _viewer?.scene,
        initialValue: _split,
        beforeLabel: String(release?.year ?? ''),
        afterLabel: t('TODAY'),
        onChange: (value) => {
          _split = value;
        },
      });
    } else if (!live && _splitControl) {
      _split = _splitControl.getValue?.() ?? _split;
      _splitControl.destroy();
      _splitControl = null;
    }
  }

  /** Drape the chosen year on the current host; idempotent. */
  function sync() {
    if (!_enabled || !_viewer) return;
    _hostInfo = host({ viewer: _viewer }) || NO_HOST;
    const release = selected();
    const want = release && _hostInfo.collection ? release.id : null;
    if (
      _draped &&
      (_draped.id !== want || _draped.collection !== _hostInfo.collection)
    ) {
      // Rebuilt, never re-parented: a split control keyed to the old year
      // goes too, so its label follows the new one.
      undrape();
      if (_splitControl) {
        _split = _splitControl.getValue?.() ?? _split;
        _splitControl.destroy();
        _splitControl = null;
      }
    }
    if (want !== null && !_draped) {
      const layer = _hostInfo.collection.addImageryProvider(
        createProvider(want),
      );
      _draped = { layer, collection: _hostInfo.collection, id: want };
    }
    applySplit();
    render();
  }

  function acquireLease() {
    _leaseRefused = false;
    if (_lease || !_controller?.acquireImageryComparison) return;
    try {
      _lease = _controller.acquireImageryComparison({
        owner: IMAGERY_HISTORY_OWNER,
        switchPolicy: 'esri-if-photoreal',
      });
    } catch {
      // Recent Imagery or an event replay holds the map: drape without swipe.
      _leaseRefused = true;
      return;
    }
    const lease = _lease;
    Promise.resolve(lease.ready)
      .catch(() => null)
      .then(() => {
        if (_lease !== lease || !_enabled) return;
        sync();
        notify();
      });
  }

  function releaseLease() {
    const lease = _lease;
    _lease = null;
    _leaseRefused = false;
    if (!lease) return;
    Promise.resolve()
      .then(() => lease.release())
      .catch((error) => {
        console.warn('[Data:ImageryHistory] map release failed:', error);
      });
  }

  function followMap() {
    if (!_enabled) return;
    sync();
    notify();
  }

  async function loadReleases() {
    _request?.abort();
    const request = new AbortController();
    _request = request;
    try {
      const payload = await source.getReleases({ signal: request.signal });
      if (request.signal.aborted || _request !== request || !_enabled)
        return false;
      _years = yearlyReleases(payload.releases);
      _year = pickYear(_years, _year);
      _lastUpdate = Date.now();
      _lastError = _years.length ? null : msg('No Wayback releases');
      sync();
      return true;
    } catch (error) {
      if (request.signal.aborted || _request !== request || !_enabled)
        return false;
      _lastError = error?.message || msg('Esri Wayback is unavailable');
      console.warn('[Data:ImageryHistory] Release list failed:', _lastError);
      return false;
    } finally {
      if (_request === request) _request = null;
      notify();
    }
  }

  function chooseYear(year) {
    if (!_enabled || year === _year) return;
    _year = pickYear(_years, year);
    sync();
    notify();
  }

  function toggleSwipe() {
    if (!_enabled) return;
    _swipe = !_swipe;
    applySplit();
    render();
    notify();
  }

  const layer = {
    id: IMAGERY_HISTORY_LAYER_ID,
    name: 'Imagery through time',
    icon: '◷',
    source: 'Esri Wayback',
    // The release list changes every few weeks; it loads once per enable.
    updateInterval: 0,

    init(viewer) {
      if (_viewer)
        throw new Error('Imagery through time layer is already initialized');
      _viewer = viewer;
    },

    attachMapStackController(controller) {
      _unsubscribeMap?.();
      _unsubscribeMap = null;
      _controller = controller || null;
      const off = controller?.subscribe?.(followMap);
      _unsubscribeMap = typeof off === 'function' ? off : null;
    },

    enable() {
      _enabled = true;
      acquireLease();
      if (_years.length) sync();
      return layer.update();
    },

    disable() {
      _enabled = false;
      _request?.abort();
      _request = null;
      if (_splitControl) {
        _split = _splitControl.getValue?.() ?? _split;
        _splitControl.destroy();
        _splitControl = null;
      }
      if (undrape()) render();
      _hostInfo = NO_HOST;
      releaseLease();
      notify();
    },

    async update() {
      if (!_enabled || !_viewer) return false;
      if (_years.length) return true;
      return loadReleases();
    },

    destroy() {
      if (_enabled) layer.disable();
      _unsubscribeMap?.();
      _unsubscribeMap = null;
      _controller = null;
      _viewer = null;
      _years = [];
      _year = null;
      _rowListener = null;
    },

    setRowControlsListener(listener) {
      _rowListener = typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      const release = selected();
      const chips = _years.map((entry) => ({
        id: `year-${entry.year}`,
        label: String(entry.year),
        active: entry.year === _year,
        title: t('Esri imagery as published on {date}', {
          date: formatDate(Date.parse(entry.date), RELEASE_DAY),
        }),
        onClick: () => chooseYear(entry.year),
      }));
      if (_years.length)
        chips.push({
          id: 'swipe',
          label: t('SWIPE'),
          active: swipeLive(),
          disabled: _leaseRefused || _hostInfo.kind !== 'globe',
          title: _leaseRefused
            ? t('Another imagery comparison is using the map')
            : t("Compare this year with today's imagery"),
          onClick: toggleSwipe,
        });
      return {
        chips,
        info: release
          ? t('Esri imagery as published on {date}', {
              date: formatDate(Date.parse(release.date), RELEASE_DAY),
            })
          : '',
        infoTitle: t(
          'Each year shows the last Esri World Imagery release of that year. A release mixes photos taken at different times, so a place can look the same in several years until Esri replaced its photo.',
        ),
      };
    },

    getStats() {
      if (_enabled && _years.length && _hostInfo.kind === 'none')
        return {
          count: 0,
          lastUpdate: _lastUpdate,
          error: null,
          status: 'idle',
          statusMessage: NO_IMAGERY_HOST,
        };
      return {
        count: _years.length,
        countLabel: _enabled && _year ? String(_year) : undefined,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}
