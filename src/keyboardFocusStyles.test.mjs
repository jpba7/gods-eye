import { readStylesheet } from './testSupport/readStylesheet.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const css = readStylesheet(new URL('../style.css', import.meta.url));

function ruleBody(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} rule exists`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function ruleText(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `${selector} rule exists`);
  const close = css.indexOf('}', css.indexOf('{', start));
  return css.slice(start, close + 1);
}

function ruleBodyContaining(selector, declaration) {
  let start = -1;
  while ((start = css.indexOf(selector, start + 1)) >= 0) {
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);
    if (body.includes(declaration)) return body;
  }
  assert.fail(`${selector} rule containing ${declaration} exists`);
}

test('the global keyboard ring survives local active and outline-reset rules', () => {
  const rule = ruleText(':where(\n  button,');
  assert.match(rule, /outline:\s*2px solid var\(--text-primary\) !important;/);
  for (const selector of [
    "[role='button']",
    "[role='radio']",
    "[role='slider']",
    "[role='tab']",
    '[tabindex]',
    'a[href]',
  ]) assert.ok(rule.includes(selector), `${selector} receives the global ring`);
});

test('Location city, POI, search toggle and search field use an inset ring', () => {
  const rule = ruleText('.location-pill:focus-visible,');
  assert.match(rule, /\.poi-pill:focus-visible/);
  assert.match(rule, /\.search-toggle-btn:focus-visible/);
  assert.match(rule, /#location-search:focus-visible/);
  assert.match(rule, /outline:\s*2px solid var\(--text-primary\)/);
  assert.match(rule, /outline-offset:\s*-3px/);
  for (const selector of ['.location-pill {', '.poi-pill {', '.search-toggle-btn {']) {
    assert.doesNotMatch(ruleBody(selector), /transition:\s*all\b/);
  }
});

test('Cockpit Display and Radio launcher glyphs have a complete inset ring', () => {
  const body = ruleBody('.cockpit-utility-glyph:focus-visible');
  assert.match(body, /outline:\s*2px solid var\(--text-primary\)/);
  assert.match(body, /outline-offset:\s*-3px/);
  assert.doesNotMatch(body, /outline:\s*none/);
});

test('focusable controls do not animate the global outline', () => {
  for (const selector of [
    '.panel-collapse-btn {',
    '#top-center-actions button {',
    '.data-toggle-chip {',
    '.scene-btn {',
    '.gev-action-button--compact {',
  ]) {
    assert.doesNotMatch(
      ruleBody(selector),
      /transition:\s*all\b/,
      `${selector} must leave the focus outline immediate`,
    );
  }
});

test('opening a dock popover makes its controls keyboard-reachable immediately', () => {
  const base = ruleBodyContaining('#command-dock .dock-popover-content {', 'visibility: hidden');
  assert.match(base, /visibility\s+0s\s+linear\s+180ms/);
  const open = ruleText('#command-dock #location-bar:not(.collapsed) .dock-popover-content,');
  assert.match(open, /transition-delay:\s*0s/);
});

test('the desktop shell recolours the keyboard ring without weakening it', () => {
  const rule = ruleText('body.earth-shell\n  :where(\n    button,');
  // Same :focus-visible semantics and the same 2px unremovable ring as the
  // global rule, in the shell's blue accent rather than near-white.
  assert.match(rule, /\):focus-visible \{/);
  assert.doesNotMatch(rule, /:focus \{/);
  assert.match(rule, /outline:\s*2px solid var\(--earth-accent\) !important;/);
  for (const selector of ['input', 'select', 'textarea', "[role='tab']", '[tabindex]'])
    assert.ok(rule.includes(selector), `${selector} keeps a ring in the shell`);
  // Text fields hug their own edge instead of floating a second box around it.
  const fields = ruleText('body.earth-shell\n  :where(\n    input:not(');
  assert.match(fields, /\):focus-visible \{\s*outline-offset:\s*-1px;\s*\}/);
  assert.match(fields, /\[type='checkbox'\]/);
  // The pill fields hand the same ring to their capsule; the input inside
  // only goes transparent where the capsule draws it.
  const capsule = ruleText('body.earth-shell #earth-search:has(#earth-search-input:focus-visible),');
  assert.match(capsule, /\.earth-filter-field:has\(#earth-layer-filter:focus-visible\)/);
  assert.match(capsule, /outline:\s*2px solid var\(--earth-accent\);/);
  // The accent is defined by the shell itself.
  assert.match(css, /body\.earth-shell \{[^}]*--earth-accent: #8ab4f8;/);
});
