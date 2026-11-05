/**
 * Desktop "Earth" shell (>720px, body.earth-shell). A top bar holds search
 * and the global actions; a left rail opens one section at a time in a drawer.
 * Like the phone shell (mobileShell.js), each section shows existing panels,
 * which stay where they are in the rails and dock while CSS presents them
 * (styles/earth-shell.css).
 *
 * Sections borrow panels: the panels a section expands are put back exactly
 * as they were when the section closes, and nothing a section does is
 * persisted or treated as the user's own panel choice.
 *
 * The shell steps aside (removes its class) while another surface owns the
 * screen (Cockpit, scene playback, recording, clean view) and while the Cyber
 * HUD skin is selected, so those keep the layout they were designed for.
 */

import { EXCLUSIVE_SURFACE_CLASSES } from '../exclusiveSurfaces.js';
import { formatNumber, msg, t, tn } from '../i18n/index.js';

export const EARTH_SHELL_MEDIA_QUERY = '(min-width: 721px)';
export const EARTH_SHELL_CLASS = 'earth-shell';
export const EARTH_SECTION_ATTR = 'data-earth-section';
export const EARTH_VOICE_ATTR = 'data-earth-voice';

const SECTION_STORAGE_KEY = 'gev.earthShell.section';
/** The retired Tactical HUD switch's key, cleared so it does not linger. */
const RETIRED_HUD_STORAGE_KEY = 'gev.earthShell.tacticalHud';

/** Panels each section expands. */
export const EARTH_SECTION_PANELS = Object.freeze({
  explore: Object.freeze(['data-panel']),
  layers: Object.freeze(['data-panel']),
  scenes: Object.freeze(['scene-panel']),
  visual: Object.freeze(['control-panel', 'pp-toggles']),
  cameras: Object.freeze(['cctv-panel', 'street-level-panel']),
  context: Object.freeze(['global-context-panel']),
});

export const EARTH_SECTIONS = Object.freeze([
  Object.freeze({
    section: 'explore',
    label: msg('Explore'),
    hint: msg('Places, history and quick trips'),
    icon: 'explore',
  }),
  Object.freeze({
    section: 'layers',
    label: msg('Layers'),
    hint: msg('Live data on the globe'),
    icon: 'layers',
  }),
  Object.freeze({
    section: 'scenes',
    label: msg('Scenes'),
    hint: msg('Saved views and camera tours'),
    icon: 'movie',
  }),
  Object.freeze({
    section: 'visual',
    label: msg('Visual'),
    hint: msg('Style, base map and effects'),
    icon: 'palette',
  }),
  Object.freeze({
    section: 'cameras',
    label: msg('Cameras'),
    hint: msg('Traffic cameras and street imagery'),
    icon: 'videocam',
  }),
  Object.freeze({
    section: 'context',
    label: msg('Context'),
    hint: msg('What is near you on the map'),
    icon: 'radar',
  }),
]);

/** Quick trips in Explore; place names are searched, never translated. */
export const EARTH_QUICK_PLACES = Object.freeze([
  'Rio de Janeiro',
  'São Paulo',
  'Brasília',
  'Ouro Preto',
  'Salvador',
  'Manaus',
  'New York',
  'Tokyo',
  'Paris',
  'Cairo',
]);

/** "Surprise me" destinations: places worth looking at from above. */
export const EARTH_SURPRISE_PLACES = Object.freeze([
  'Lençóis Maranhenses',
  'Fernando de Noronha',
  'Iguazu Falls',
  'Chapada Diamantina',
  'Pão de Açúcar',
  'Machu Picchu',
  'Petra',
  'Angkor Wat',
  'Uluru',
  'Cappadocia',
  'Santorini',
  'Grand Canyon',
  'Mount Fuji',
  'Venice',
  'Kyoto',
  'Bora Bora',
  'Giza pyramid complex',
  'Matterhorn',
  'Halong Bay',
  'Salar de Uyuni',
]);

const BLOCKING_CLASSES = Object.freeze([...EXCLUSIVE_SURFACE_CLASSES]);
const BORROWED_PANELS = Object.freeze([
  ...new Set(Object.values(EARTH_SECTION_PANELS).flat()),
]);
const BORROW_OPTIONS = Object.freeze({ persist: false, syncShare: false });

/**
 * The section after a rail press: the same section closes, another opens.
 * @param {string|null} current
 * @param {string|null} pressed
 * @returns {string|null}
 */
export function nextEarthSection(current, pressed) {
  if (!pressed || !Object.hasOwn(EARTH_SECTION_PANELS, pressed)) return null;
  return current === pressed ? null : pressed;
}

/**
 * Camera height as the status bar shows it.
 * @param {number} meters
 * @returns {string}
 */
export function formatCameraHeight(meters) {
  if (!Number.isFinite(meters)) return '--';
  if (Math.abs(meters) >= 10_000)
    return `${formatNumber(Math.round(meters / 1000))} km`;
  if (Math.abs(meters) >= 1000)
    return `${formatNumber(meters / 1000, { maximumFractionDigits: 1 })} km`;
  return `${formatNumber(Math.round(meters))} m`;
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStored(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private windows and blocked storage simply forget the choice.
  }
}

function icon(documentRef, name, className = 'earth-icon') {
  const span = documentRef.createElement('span');
  span.className = `material-symbols-outlined ${className}`;
  span.setAttribute('aria-hidden', 'true');
  span.textContent = name;
  return span;
}

function iconButton(documentRef, { id, glyph, label, className = '' }) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  if (id) button.id = id;
  button.className = `earth-icon-btn ${className}`.trim();
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(documentRef, glyph));
  return button;
}

function buildTopBar(documentRef) {
  const bar = documentRef.createElement('header');
  bar.id = 'earth-topbar';

  const brand = documentRef.createElement('div');
  brand.className = 'earth-brand';
  const menu = iconButton(documentRef, {
    id: 'earth-menu-btn',
    glyph: 'menu',
    label: t('Show or hide the side panel'),
  });
  menu.setAttribute('aria-controls', 'earth-drawer');
  const logo = documentRef.createElement('img');
  logo.src = '/logo.svg';
  logo.alt = '';
  logo.className = 'earth-logo';
  const name = documentRef.createElement('span');
  name.className = 'earth-brand-name';
  // i18n-ignore: product name
  name.textContent = "God's Eye";
  brand.append(menu, logo, name);

  const search = documentRef.createElement('form');
  search.id = 'earth-search';
  search.setAttribute('role', 'search');
  const searchLabel = documentRef.createElement('label');
  searchLabel.className = 'earth-search-field';
  searchLabel.append(icon(documentRef, 'search', 'earth-search-icon'));
  const input = documentRef.createElement('input');
  input.id = 'earth-search-input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.placeholder = t('Search a place, city or coordinates');
  input.setAttribute('aria-label', t('Search a place, city or coordinates'));
  searchLabel.append(input);
  const surprise = iconButton(documentRef, {
    id: 'earth-surprise-btn',
    glyph: 'shuffle',
    label: t('Surprise me'),
  });
  const error = documentRef.createElement('div');
  error.id = 'earth-search-error';
  error.setAttribute('role', 'status');
  error.setAttribute('aria-live', 'polite');
  error.hidden = true;
  search.append(searchLabel, surprise, error);

  const actions = documentRef.createElement('div');
  actions.className = 'earth-actions';
  const assistant = documentRef.createElement('button');
  assistant.type = 'button';
  assistant.id = 'earth-assistant-btn';
  assistant.className = 'earth-pill-btn';
  assistant.setAttribute('aria-expanded', 'false');
  assistant.setAttribute('aria-controls', 'gev-voice-control');
  const assistantLabel = documentRef.createElement('span');
  assistantLabel.textContent = t('Assistant');
  assistant.append(icon(documentRef, 'mic'), assistantLabel);
  const share = iconButton(documentRef, {
    id: 'earth-share-btn',
    glyph: 'link',
    label: t('Copy share link'),
  });
  actions.append(assistant, share);

  bar.append(brand, search, actions);
  return { bar, menu, search, input, surprise, error, assistant, share };
}

function buildRail(documentRef) {
  const rail = documentRef.createElement('nav');
  rail.id = 'earth-rail';
  rail.setAttribute('aria-label', t('Sections'));
  for (const entry of EARTH_SECTIONS) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'earth-rail-btn';
    button.dataset.earthSection = entry.section;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'earth-drawer');
    const pill = documentRef.createElement('span');
    pill.className = 'earth-rail-pill';
    pill.append(icon(documentRef, entry.icon));
    const label = documentRef.createElement('span');
    label.className = 'earth-rail-label';
    label.textContent = t(entry.label);
    button.append(pill, label);
    rail.append(button);
  }
  return rail;
}

function buildDrawer(documentRef) {
  const drawer = documentRef.createElement('aside');
  drawer.id = 'earth-drawer';
  drawer.hidden = true;

  const header = documentRef.createElement('div');
  header.className = 'earth-drawer-header';
  const titles = documentRef.createElement('div');
  titles.className = 'earth-drawer-titles';
  const title = documentRef.createElement('h2');
  title.id = 'earth-drawer-title';
  const hint = documentRef.createElement('p');
  hint.id = 'earth-drawer-hint';
  titles.append(title, hint);
  const close = iconButton(documentRef, {
    id: 'earth-drawer-close',
    glyph: 'close',
    label: t('Close panel'),
  });
  header.append(titles, close);
  drawer.setAttribute('aria-labelledby', 'earth-drawer-title');

  // Section extras sit between the header and the borrowed panels.
  const extras = documentRef.createElement('div');
  extras.id = 'earth-drawer-extras';

  const explore = documentRef.createElement('section');
  explore.className = 'earth-extra';
  explore.dataset.earthExtra = 'explore';
  const goTo = documentRef.createElement('h3');
  goTo.className = 'earth-extra-heading';
  goTo.textContent = t('Go to');
  const chips = documentRef.createElement('div');
  chips.className = 'earth-chip-row';
  for (const place of EARTH_QUICK_PLACES) {
    const chip = documentRef.createElement('button');
    chip.type = 'button';
    chip.className = 'earth-chip';
    chip.dataset.earthPlace = place;
    chip.textContent = place;
    chips.append(chip);
  }
  const discover = documentRef.createElement('h3');
  discover.className = 'earth-extra-heading';
  discover.textContent = t('Discover');
  explore.append(goTo, chips, discover);

  const layers = documentRef.createElement('section');
  layers.className = 'earth-extra';
  layers.dataset.earthExtra = 'layers';
  const filterLabel = documentRef.createElement('label');
  filterLabel.className = 'earth-filter-field';
  filterLabel.append(icon(documentRef, 'search', 'earth-search-icon'));
  const filter = documentRef.createElement('input');
  filter.id = 'earth-layer-filter';
  filter.type = 'search';
  filter.autocomplete = 'off';
  filter.placeholder = t('Filter layers');
  filter.setAttribute('aria-label', t('Filter layers'));
  filterLabel.append(filter);
  layers.append(filterLabel);

  extras.append(explore, layers);
  drawer.append(header, extras);
  return {
    drawer,
    title,
    hint,
    close,
    extras,
    filter,
  };
}

function buildMapControls(documentRef) {
  const group = documentRef.createElement('div');
  group.id = 'earth-zoom';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('Zoom'));
  const zoomIn = iconButton(documentRef, {
    id: 'earth-zoom-in',
    glyph: 'add',
    label: t('Zoom in'),
  });
  const zoomOut = iconButton(documentRef, {
    id: 'earth-zoom-out',
    glyph: 'remove',
    label: t('Zoom out'),
  });
  group.append(zoomIn, zoomOut);
  return { group, zoomIn, zoomOut };
}

function buildStatusBar(documentRef) {
  const bar = documentRef.createElement('footer');
  bar.id = 'earth-statusbar';
  const coords = documentRef.createElement('span');
  coords.id = 'earth-status-coords';
  coords.className = 'earth-status-mono';
  const height = documentRef.createElement('span');
  height.id = 'earth-status-height';
  const layers = documentRef.createElement('span');
  layers.id = 'earth-status-layers';
  bar.append(coords, height, layers);
  return { bar, coords, height, layers };
}

/**
 * Wires the desktop shell.
 * @param {object} input
 * @param {(panelId: string, collapsed: boolean, options?: object) => void} input.setPanelCollapsed
 * @param {() => any} [input.getViewer] Resolves the Cesium viewer at use time.
 * @param {Document} [input.documentRef]
 * @param {(query: string) => MediaQueryList} [input.matchMedia]
 * @param {typeof MutationObserver} [input.MutationObserverImpl]
 * @param {typeof ResizeObserver} [input.ResizeObserverImpl]
 * @param {Storage|null} [input.storage]
 * @param {() => number} [input.random]
 * @param {(callback: () => void) => number} [input.requestFrame]
 * @param {(callback: () => void, ms: number) => any} [input.setIntervalImpl]
 * @param {(handle: any) => void} [input.clearIntervalImpl]
 * @returns {{ destroy: () => void, setSection: (section: string|null) => void, getSection: () => string|null, isActive: () => boolean, sharedCollapsed: (panelId: string) => boolean|undefined }}
 */
export function initEarthShell({
  setPanelCollapsed,
  getViewer = () => null,
  documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  MutationObserverImpl = globalThis.MutationObserver,
  ResizeObserverImpl = globalThis.ResizeObserver,
  storage = defaultStorage(),
  random = Math.random,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  setIntervalImpl = globalThis.setInterval?.bind(globalThis),
  clearIntervalImpl = globalThis.clearInterval?.bind(globalThis),
} = {}) {
  const body = documentRef.body;
  const root = documentRef.documentElement;
  const element = (id) => documentRef.getElementById(id);
  const removers = [];
  const listen = (target, type, handler, options) => {
    if (!target) return;
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  };

  const top = buildTopBar(documentRef);
  const rail = buildRail(documentRef);
  const drawer = buildDrawer(documentRef);
  const zoom = buildMapControls(documentRef);
  const status = buildStatusBar(documentRef);
  body.append(top.bar, rail, drawer.drawer, zoom.group, status.bar);

  let section = null;
  let borrowed = null;
  let statusTimer = null;
  const written = new Map();
  const writeVar = (name, value) => {
    if (written.get(name) === value) return;
    written.set(name, value);
    body.style.setProperty(name, value);
  };

  const active = () => body.classList.contains(EARTH_SHELL_CLASS);

  // Borrowed panels start under the header and the section extras; Visual
  // stacks the dock's presets above the Display panel.
  const measure = () => {
    if (!active()) return;
    const extras = drawer.extras.getBoundingClientRect();
    writeVar('--earth-panels-top', `${Math.round(extras.bottom)}px`);
    const presets = element('control-panel');
    const presetsHeight =
      section === 'visual' && presets
        ? presets.getBoundingClientRect().height
        : 0;
    writeVar('--earth-presets-height', `${Math.round(presetsHeight)}px`);
    const corner = element('corner-actions');
    const cornerWidth = corner ? corner.getBoundingClientRect().width : 0;
    writeVar('--earth-corner-width', `${Math.round(cornerWidth)}px`);
  };
  const resize =
    typeof ResizeObserverImpl === 'function'
      ? new ResizeObserverImpl(() => measure())
      : null;
  removers.push(() => resize?.disconnect());
  for (const node of [
    drawer.extras,
    element('control-panel'),
    element('corner-actions'),
  ])
    if (node) resize?.observe(node);

  const isCollapsed = (panelId) =>
    element(panelId)?.classList.contains('collapsed') ?? true;
  const prefersCollapsed = (panelId) => {
    const classes = element(panelId)?.classList;
    if (!classes) return true;
    return (
      classes.contains('collapsed') &&
      !classes.contains('layout-auto-collapsed') &&
      !classes.contains('cyber-accordion-collapsed')
    );
  };
  const panelStates = () =>
    new Map(
      BORROWED_PANELS.map((panelId) => [panelId, prefersCollapsed(panelId)]),
    );
  const restoreBorrowed = () => {
    if (!borrowed) return;
    for (const [panelId, before] of borrowed.before) {
      const now = prefersCollapsed(panelId);
      if (now !== borrowed.applied.get(panelId))
        borrowed.before.set(panelId, now);
      else if (now !== before)
        setPanelCollapsed(panelId, before, BORROW_OPTIONS);
    }
  };

  const present = (next) => {
    if (next) body.setAttribute(EARTH_SECTION_ATTR, next);
    else body.removeAttribute(EARTH_SECTION_ATTR);
    drawer.drawer.hidden = !next;
    top.menu.setAttribute('aria-expanded', String(Boolean(next)));
    for (const button of rail.querySelectorAll('[data-earth-section]'))
      button.setAttribute(
        'aria-expanded',
        String(button.dataset.earthSection === next),
      );
    const entry = EARTH_SECTIONS.find((item) => item.section === next);
    drawer.title.textContent = entry ? t(entry.label) : '';
    drawer.hint.textContent = entry ? t(entry.hint) : '';
    for (const extra of drawer.extras.querySelectorAll('[data-earth-extra]'))
      extra.hidden = extra.dataset.earthExtra !== next;
    measure();
  };

  const setSection = (requested, { remember = true } = {}) => {
    const next =
      requested && Object.hasOwn(EARTH_SECTION_PANELS, requested)
        ? requested
        : null;
    if (remember) writeStored(storage, SECTION_STORAGE_KEY, next ?? 'none');
    if (!active()) {
      section = next;
      return;
    }
    if (section === next && body.getAttribute(EARTH_SECTION_ATTR) === next)
      return;
    if (borrowed) restoreBorrowed();
    else borrowed = { before: panelStates(), applied: panelStates() };
    section = next;
    present(next);
    if (!next) {
      borrowed = null;
      return;
    }
    for (const panelId of EARTH_SECTION_PANELS[next])
      if (isCollapsed(panelId))
        setPanelCollapsed(panelId, false, BORROW_OPTIONS);
    borrowed.applied = panelStates();
    requestFrame?.(() => {
      if (borrowed) borrowed.applied = panelStates();
      measure();
    });
  };

  // ── Search ─────────────────────────────────────────────────────────────
  const runSearch = (query) => {
    const text = String(query ?? '').trim();
    const target = element('location-search');
    if (!text || !target) return;
    target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(
      new (documentRef.defaultView?.KeyboardEvent ?? globalThis.KeyboardEvent)(
        'keydown',
        { key: 'Enter', bubbles: true },
      ),
    );
  };
  listen(top.search, 'submit', (event) => {
    event.preventDefault();
    runSearch(top.input.value);
  });
  listen(top.surprise, 'click', () => {
    const index = Math.floor(random() * EARTH_SURPRISE_PLACES.length);
    const place =
      EARTH_SURPRISE_PLACES[
        Math.min(EARTH_SURPRISE_PLACES.length - 1, Math.max(0, index))
      ];
    top.input.value = place;
    runSearch(place);
  });
  listen(drawer.extras, 'click', (event) => {
    const chip = event.target?.closest?.('[data-earth-place]');
    if (!chip) return;
    top.input.value = chip.dataset.earthPlace;
    runSearch(chip.dataset.earthPlace);
  });
  // Errors are announced under the hidden dock field; mirror them here.
  const sourceError = element('location-search-error');
  const syncError = () => {
    const text = sourceError?.textContent?.trim() ?? '';
    top.error.textContent = text;
    top.error.hidden = !text;
  };
  if (sourceError && typeof MutationObserverImpl === 'function') {
    const observer = new MutationObserverImpl(syncError);
    observer.observe(sourceError, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    removers.push(() => observer.disconnect());
  }
  listen(top.input, 'input', () => {
    top.error.hidden = true;
  });

  // ── Layer filter (Layers section) ──────────────────────────────────────
  const applyFilter = () => {
    const query = drawer.filter.value.trim().toLocaleLowerCase();
    const list = element('data-toggles');
    if (!list) return;
    for (const row of list.querySelectorAll('.data-toggle-row')) {
      const name = row.querySelector('.data-name')?.textContent ?? '';
      const english = row.dataset.layerName ?? '';
      row.classList.toggle(
        'earth-filtered-out',
        Boolean(query) &&
          !name.toLocaleLowerCase().includes(query) &&
          !english.toLocaleLowerCase().includes(query),
      );
    }
  };
  listen(drawer.filter, 'input', applyFilter);

  // ── Top bar actions ────────────────────────────────────────────────────
  listen(top.menu, 'click', () => {
    if (section) setSection(null);
    else
      setSection(
        readStored(storage, SECTION_STORAGE_KEY) === 'none'
          ? 'explore'
          : (readStored(storage, SECTION_STORAGE_KEY) ?? 'explore'),
      );
  });
  listen(drawer.close, 'click', () => setSection(null));
  listen(rail, 'click', (event) => {
    const button = event.target?.closest?.('[data-earth-section]');
    if (!button) return;
    setSection(nextEarthSection(section, button.dataset.earthSection));
  });
  listen(top.share, 'click', () => element('share-btn')?.click());
  const setVoiceOpen = (open) => {
    if (open) body.setAttribute(EARTH_VOICE_ATTR, 'open');
    else body.removeAttribute(EARTH_VOICE_ATTR);
    top.assistant.setAttribute('aria-expanded', String(open));
  };
  listen(top.assistant, 'click', () =>
    setVoiceOpen(body.getAttribute(EARTH_VOICE_ATTR) !== 'open'),
  );

  // The shell no longer offers the spy-satellite HUD (#intel-hud stays
  // hidden here); forget the old switch's choice.
  if (readStored(storage, RETIRED_HUD_STORAGE_KEY) !== null)
    writeStored(storage, RETIRED_HUD_STORAGE_KEY, null);

  // ── Zoom ───────────────────────────────────────────────────────────────
  const zoomBy = (direction) => {
    const camera = getViewer()?.camera;
    const height = camera?.positionCartographic?.height;
    if (!camera || !Number.isFinite(height)) return;
    const amount = Math.max(50, height * 0.45);
    if (direction > 0) camera.zoomIn(amount);
    else camera.zoomOut(amount);
  };
  listen(zoom.zoomIn, 'click', () => zoomBy(1));
  listen(zoom.zoomOut, 'click', () => zoomBy(-1));

  // ── Status bar ─────────────────────────────────────────────────────────
  const updateStatus = () => {
    if (!active()) return;
    const coords = element('hud-latlon')?.textContent?.trim() ?? '';
    status.coords.textContent = coords;
    const height = getViewer()?.camera?.positionCartographic?.height;
    status.height.textContent = t('Camera {height}', {
      height: formatCameraHeight(height),
    });
    const count = documentRef.querySelectorAll(
      '#data-toggles .data-toggle-btn.active',
    ).length;
    status.layers.textContent = tn(
      count,
      '{count} active layer',
      '{count} active layers',
    );
  };

  // ── Media gate and suspension ──────────────────────────────────────────
  const media =
    typeof matchMedia === 'function'
      ? matchMedia(EARTH_SHELL_MEDIA_QUERY)
      : null;
  const blocked = () =>
    BLOCKING_CLASSES.some((name) => body.classList.contains(name)) ||
    root?.dataset?.uiTheme === 'cyber';
  const sync = () => {
    const wanted = Boolean(media?.matches) && !blocked();
    if (wanted === active()) return;
    if (wanted) {
      body.classList.add(EARTH_SHELL_CLASS);
      const pending = section;
      section = null;
      setSection(pending, { remember: false });
      measure();
      updateStatus();
      statusTimer ??= setIntervalImpl?.(updateStatus, 500) ?? null;
    } else {
      // Put borrowed panels back before the original layout returns.
      const keep = section;
      setSection(null, { remember: false });
      section = keep;
      body.classList.remove(EARTH_SHELL_CLASS);
      setVoiceOpen(false);
      if (statusTimer !== null) clearIntervalImpl?.(statusTimer);
      statusTimer = null;
    }
  };

  const stored = readStored(storage, SECTION_STORAGE_KEY);
  section =
    stored === 'none'
      ? null
      : stored && Object.hasOwn(EARTH_SECTION_PANELS, stored)
        ? stored
        : 'explore';
  sync();

  const onChange = () => sync();
  if (media?.addEventListener) {
    media.addEventListener('change', onChange);
    removers.push(() => media.removeEventListener('change', onChange));
  } else if (media?.addListener) {
    media.addListener(onChange);
    removers.push(() => media.removeListener(onChange));
  }
  if (typeof MutationObserverImpl === 'function') {
    const observer = new MutationObserverImpl(onChange);
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    if (root)
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['data-ui-theme'],
      });
    removers.push(() => observer.disconnect());
  }
  // Escape closes the assistant popover first, then the drawer. Bubble phase,
  // so fields, dialogs and viewers take Escape before the shell.
  listen(documentRef, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !active()) return;
    if (documentRef.querySelector('dialog[open]')) return;
    if (body.getAttribute(EARTH_VOICE_ATTR) === 'open') {
      event.preventDefault();
      setVoiceOpen(false);
    }
  });

  return {
    setSection,
    getSection: () => (active() ? section : null),
    isActive: active,
    sharedCollapsed(panelId) {
      if (!borrowed?.before.has(panelId)) return undefined;
      const now = prefersCollapsed(panelId);
      return now !== borrowed.applied.get(panelId)
        ? now
        : borrowed.before.get(panelId);
    },
    destroy() {
      setSection(null, { remember: false });
      if (statusTimer !== null) clearIntervalImpl?.(statusTimer);
      statusTimer = null;
      for (const remove of removers.splice(0)) remove();
      body.classList.remove(EARTH_SHELL_CLASS);
      body.removeAttribute(EARTH_SECTION_ATTR);
      body.removeAttribute(EARTH_VOICE_ATTR);
      for (const name of written.keys()) body.style.removeProperty(name);
      for (const node of [top.bar, rail, drawer.drawer, zoom.group, status.bar])
        node.remove();
    },
  };
}
