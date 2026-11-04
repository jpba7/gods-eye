import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EARTH_SECTIONS,
  EARTH_SECTION_PANELS,
  EARTH_SHELL_CLASS,
  formatCameraHeight,
  initEarthShell,
  nextEarthSection,
} from './earthShell.js';

/** Minimal DOM: ids, classes, attributes and `[data-…]` selectors. */
function fakeDocument() {
  const ids = new Map();
  const doc = new EventTarget();
  const matches = (node, selector) => {
    const match = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in node.dataset)) return false;
    return match[2] === undefined || node.dataset[key] === match[2];
  };
  const make = (tag) => {
    const node = new EventTarget();
    const attributes = new Map();
    const classes = new Set();
    let id = '';
    Object.assign(node, {
      tagName: tag.toUpperCase(),
      children: [],
      parent: null,
      dataset: {},
      hidden: false,
      textContent: '',
      value: '',
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle(name, force) {
          const on = force ?? !classes.has(name);
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
      },
      style: {
        values: new Map(),
        setProperty(name, value) {
          this.values.set(name, value);
        },
        removeProperty(name) {
          this.values.delete(name);
        },
      },
      setAttribute: (key, value) => attributes.set(key, String(value)),
      getAttribute: (key) => attributes.get(key) ?? null,
      removeAttribute: (key) => attributes.delete(key),
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 120,
        width: 200,
        height: 40,
      }),
      append(...children) {
        for (const child of children) {
          child.parent = node;
          node.children.push(child);
        }
      },
      remove() {
        const siblings = node.parent?.children;
        siblings?.splice(siblings.indexOf(node), 1);
        node.parent = null;
      },
      closest(selector) {
        for (let current = node; current; current = current.parent)
          if (matches(current, selector)) return current;
        return null;
      },
      querySelector(selector) {
        return node.querySelectorAll(selector)[0] ?? null;
      },
      querySelectorAll(selector) {
        const found = [];
        const walk = (parent) => {
          for (const child of parent.children) {
            if (matches(child, selector)) found.push(child);
            walk(child);
          }
        };
        walk(node);
        return found;
      },
    });
    Object.defineProperty(node, 'id', {
      get: () => id,
      set(value) {
        id = value;
        ids.set(value, node);
      },
    });
    Object.defineProperty(node, 'className', {
      get: () => [...classes].join(' '),
      set(value) {
        classes.clear();
        for (const name of String(value).split(/\s+/).filter(Boolean))
          classes.add(name);
      },
    });
    return node;
  };
  Object.assign(doc, {
    ids,
    createElement: make,
    getElementById: (id) => ids.get(id) ?? null,
    querySelector: (selector) =>
      selector === 'dialog[open]' ? null : doc.body.querySelector(selector),
    querySelectorAll: (selector) => doc.body.querySelectorAll(selector),
    defaultView: {
      KeyboardEvent: class extends Event {
        constructor(type, init = {}) {
          super(type, init);
          this.key = init.key;
        }
      },
    },
  });
  doc.body = make('body');
  doc.documentElement = make('html');
  return doc;
}

function panel(doc, id, collapsed = true) {
  const node = doc.createElement('div');
  node.id = id;
  if (collapsed) node.classList.add('collapsed');
  doc.body.append(node);
  return node;
}

function harness({ desktop = true, stored = {} } = {}) {
  const doc = fakeDocument();
  for (const id of new Set(Object.values(EARTH_SECTION_PANELS).flat()))
    panel(doc, id);
  const search = doc.createElement('input');
  search.id = 'location-search';
  doc.body.append(search);
  const calls = [];
  const setPanelCollapsed = (id, collapsed, options) => {
    calls.push([id, collapsed, options]);
    doc.getElementById(id).classList.toggle('collapsed', collapsed);
  };
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  }
  const values = new Map(Object.entries(stored));
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const timers = [];
  const shell = initEarthShell({
    setPanelCollapsed,
    documentRef: doc,
    matchMedia: () => ({
      matches: desktop,
      addEventListener() {},
      removeEventListener() {},
    }),
    MutationObserverImpl: FakeMutationObserver,
    ResizeObserverImpl: null,
    storage,
    requestFrame: null,
    setIntervalImpl: (fn) => (timers.push(fn), timers.length),
    clearIntervalImpl: () => {},
  });
  const mutate = () => observers.forEach((observer) => observer.callback());
  return { doc, shell, calls, values, mutate, search };
}

test('rail presses toggle a section or switch to another', () => {
  assert.equal(nextEarthSection(null, 'layers'), 'layers');
  assert.equal(nextEarthSection('layers', 'layers'), null);
  assert.equal(nextEarthSection('layers', 'visual'), 'visual');
  assert.equal(nextEarthSection('layers', 'unknown'), null);
});

test('every section names its panels and a translatable label', () => {
  for (const { section } of EARTH_SECTIONS)
    assert.ok(EARTH_SECTION_PANELS[section]?.length, section);
});

test('camera height reads in metres, then kilometres', () => {
  assert.equal(formatCameraHeight(Number.NaN), '--');
  assert.equal(formatCameraHeight(612.4), '612 m');
  assert.equal(formatCameraHeight(2400), '2.4 km');
  assert.equal(formatCameraHeight(1_250_000), '1,250 km');
});

test('desktop opens Explore by default and borrows the layer panel', () => {
  const { doc, shell, calls } = harness();
  assert.ok(doc.body.classList.contains(EARTH_SHELL_CLASS));
  assert.equal(shell.getSection(), 'explore');
  assert.equal(doc.body.getAttribute('data-earth-section'), 'explore');
  assert.deepEqual(calls, [
    ['data-panel', false, { persist: false, syncShare: false }],
  ]);
  // A borrowed panel shares the state it had before the section opened.
  assert.equal(shell.sharedCollapsed('data-panel'), true);
  shell.destroy();
});

test('switching sections puts borrowed panels back', () => {
  const { doc, shell, calls, values } = harness();
  calls.length = 0;
  shell.setSection('cameras');
  assert.deepEqual(
    calls.map(([id, collapsed]) => [id, collapsed]),
    [
      ['data-panel', true],
      ['cctv-panel', false],
      ['street-level-panel', false],
    ],
  );
  assert.equal(values.get('gev.earthShell.section'), 'cameras');
  shell.setSection(null);
  assert.equal(
    doc.getElementById('cctv-panel').classList.contains('collapsed'),
    true,
  );
  assert.equal(values.get('gev.earthShell.section'), 'none');
  shell.destroy();
});

test('a remembered closed drawer stays closed', () => {
  const { doc, shell, calls } = harness({
    stored: { 'gev.earthShell.section': 'none' },
  });
  assert.equal(shell.getSection(), null);
  assert.equal(doc.getElementById('earth-drawer').hidden, true);
  assert.deepEqual(calls, []);
  shell.destroy();
});

test('the shell steps aside for Cockpit and the Cyber skin', () => {
  const { doc, shell, mutate } = harness();
  doc.body.classList.add('cockpit-mode');
  mutate();
  assert.equal(doc.body.classList.contains(EARTH_SHELL_CLASS), false);
  assert.equal(
    doc.getElementById('data-panel').classList.contains('collapsed'),
    true,
  );
  doc.body.classList.remove('cockpit-mode');
  mutate();
  assert.equal(shell.getSection(), 'explore');
  doc.documentElement.dataset.uiTheme = 'cyber';
  mutate();
  assert.equal(shell.isActive(), false);
  shell.destroy();
});

test('phones keep their own shell', () => {
  const { doc, shell, calls } = harness({ desktop: false });
  assert.equal(doc.body.classList.contains(EARTH_SHELL_CLASS), false);
  assert.deepEqual(calls, []);
  shell.destroy();
});

test('top bar search runs the location search', () => {
  const { doc, shell, search } = harness();
  const keys = [];
  search.addEventListener('keydown', (event) => keys.push(event.key));
  doc.getElementById('earth-search-input').value = '  Ouro Preto ';
  doc.getElementById('earth-search').dispatchEvent(new Event('submit'));
  assert.equal(search.value, 'Ouro Preto');
  assert.deepEqual(keys, ['Enter']);
  shell.destroy();
});

test('destroy removes the chrome and the shell state', () => {
  const { doc, shell } = harness();
  shell.destroy();
  for (const id of [
    'earth-topbar',
    'earth-rail',
    'earth-drawer',
    'earth-zoom',
    'earth-statusbar',
  ])
    assert.equal(doc.getElementById(id).parent, null, id);
  assert.equal(doc.body.classList.contains(EARTH_SHELL_CLASS), false);
  assert.equal(doc.body.getAttribute('data-earth-section'), null);
});

test('the shell stylesheet follows every sheet it presents', () => {
  // Cyber alone may follow it: the shell steps aside while Cyber is selected.
  const imports = readFileSync(
    new URL('../../style.css', import.meta.url),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.startsWith('@import'));
  const earth = imports.findIndex((line) => line.includes('earth-shell.css'));
  assert.ok(earth > 0, 'style.css imports earth-shell.css');
  assert.deepEqual(
    imports
      .slice(earth + 1)
      .map((line) => /styles\/([\w-]+)\.css/.exec(line)[1]),
    ['cyber'],
  );
});

test('the required map credit stays above the status bar and beside the drawer', () => {
  const css = readFileSync(
    new URL('./styles/earth-shell.css', import.meta.url),
    'utf8',
  );
  assert.match(
    css,
    /body\.earth-shell #cesium-credits \{\s*bottom: calc\(var\(--earth-status\) \+ 6px\) !important;/,
  );
  assert.match(
    css,
    /body\.earth-shell\[data-earth-section\] #cesium-credits \{\s*left: calc\(\s*var\(--earth-rail\) \+ var\(--earth-drawer\) \+ 12px\s*\) !important;/,
  );
  assert.match(
    css,
    /body\.earth-shell:not\(\[data-earth-section\]\) #cesium-credits \{\s*left: calc\(var\(--earth-rail\) \+ 12px\) !important;/,
  );
  // The credit is never hidden to make room.
  assert.doesNotMatch(css, /#cesium-credits[^{]*\{[^}]*display:\s*none/);
});

test('section panels keep icon glyphs in the Material Symbols font', () => {
  const css = readFileSync(
    new URL('./styles/earth-shell.css', import.meta.url),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  // A rule that sets the face or the spacing of every span in a section
  // panel turns icon ligatures back into their names ("radar", "draw").
  const offending = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map(([, selector, body]) => [selector.replace(/\s+/g, ''), body])
    .filter(
      ([selector, body]) =>
        /:is\([^)]*\bspan\b/.test(selector) &&
        /(font-family|letter-spacing):/.test(body) &&
        !selector.includes(':not(.material-symbols-outlined)'),
    )
    .map(([selector]) => selector);
  assert.deepEqual(offending, []);
});

test('open drawers end above the status bar whatever the rail engine sizes', () => {
  const css = readFileSync(
    new URL('./styles/earth-shell.css', import.meta.url),
    'utf8',
  );
  const rule =
    /body\.earth-shell\[data-earth-section='context'\] #right-context-rail \{([^}]*)\}/.exec(
      css,
    );
  assert.ok(rule, 'the shared open-section rail rule exists');
  assert.match(rule[1], /bottom: var\(--earth-status\) !important;/);
  // `.layout-focus` gives the rail a height for the floating HUD corridor;
  // with top, bottom and height all set, height wins and the drawer runs
  // under the status bar, out of reach of its own scrollbar.
  assert.match(rule[1], /\n {2}height: auto !important;/);
  assert.match(rule[1], /overflow-y: auto;/);
});

test('the Context drawer scrolls in one box and keeps Radio reachable', () => {
  const css = readFileSync(
    new URL('./styles/earth-shell.css', import.meta.url),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  const body = (selector) =>
    rules.find(([, s]) => s.replace(/\s+/g, ' ').trim() === selector)?.[2] ??
    '';
  const context = "body.earth-shell[data-earth-section='context']";
  // The panel's inner box is the scroller its own code moves (mission details
  // back to the top, Radio controls into view); the rail and the lists inside
  // it stop scrolling on their own.
  assert.match(body(`${context} #right-context-rail`), /overflow: hidden;/);
  assert.match(
    body(
      `${context} #right-context-rail > #global-context-panel > .global-context-panel-inner`,
    ),
    /overflow-y: auto;/,
  );
  assert.match(
    body(
      `${context} #right-context-rail :is(#military-awareness-panel, .space-mission-roster-list)`,
    ),
    /overflow: visible;/,
  );
  // The shell hides panel collapse buttons; Radio's is its only way in.
  assert.match(
    body(
      `${context} #right-context-rail #global-context-panel #radio-panel .panel-collapse-btn`,
    ),
    /display: block !important;/,
  );
});
