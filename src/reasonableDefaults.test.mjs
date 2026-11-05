import { readShellSource } from './testSupport/readShellSource.mjs';
import { expandApplicationHtml } from '../build/application-html.js';
// src/reasonableDefaults.test.mjs
//
// What the console looks like the FIRST time it opens — before any share link,
// before any stored state. The "reasonable defaults" batch (owner directive,
// 2026-08-22) moved three of them together:
//
//   1. 3D aircraft models ON, mode `proximity`.
//      Pinned in `data/layerState.test.mjs`, next to the coordinator that
//      actually decides fresh-boot layer state — including the early return that
//      makes each layer's own initializer the operative default.
//   2. Scope mask: removed in 2026-11 at the owner's request (it darkened the
//      margins of the view). Old links' Scope keys are ignored.
//   3. Detection ON (Dense @ 75%) for EVERY style, Normal included.
//      Owner: "detect should also be on by default."
//   4. Detection OUTSIDE opacity 100% since the Scope mask was removed (2026-11;
//      1% from the 2026-08-24 owner lock, 3% on 08-23, 5% before), with the
//      slider's `step` at 1 so every percent is reachable.
//
// Each pin below has the same three parts, because a default is never one
// literal:
//
//   • the first-run VALUE, at every surface that independently decides it — a
//     fresh boot runs no restore, so these literals ARE the startup state and
//     changing one alone ships a UI that disagrees with its own engine;
//   • explicit state still WINS over it — a link, or the operator's own hand,
//     because "default" means "what you get when you said nothing";
//   • the surrounding override machinery is INTACT, so a default flip cannot
//     quietly take a separate landed behaviour with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { KEYHOLE_OUTSIDE_OPACITY_DEFAULT, KEYHOLE_LABEL_FEATHER_RATIO } from './celestialRing.js';
import { AIRCRAFT_BRACKET_FLOOR_ANCHOR } from './data/detectionPolicy.js';
import { ShareLinkManager } from './sharelink.js';

// Follow the UI wiring and its extracted preset definitions.
const uiSource = readShellSource()
  + '\n' + fs.readFileSync(new URL('./ui/visualPresets.js', import.meta.url), 'utf8');
const indexHtml = expandApplicationHtml(fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
const shareSource = fs.readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');

/** Slice ui.js between two literal anchors, so a pin reads one method, not the file. */
function uiBlock(start, end) {
  const startIndex = uiSource.indexOf(start);
  assert.ok(startIndex >= 0, `missing source anchor: ${start}`);
  const endIndex = uiSource.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing source anchor: ${end}`);
  return uiSource.slice(startIndex, endIndex);
}

/** A ShareLinkManager over a synthetic hash — enough surface for parseInitialHash. */
function managerForHash(hash) {
  globalThis.window = { location: { hash, href: `http://localhost/${hash}` } };
  globalThis.history = { replaceState(_s, _t, next) { window.location.hash = new URL(next, window.location.href).hash; } };
  const viewer = {
    camera: {
      changed: { addEventListener() {} },
      positionCartographic: { latitude: 0, longitude: 0, height: 1000 },
      heading: 0,
      pitch: -Math.PI / 2,
      roll: 0,
    },
  };
  return new ShareLinkManager(viewer);
}

// ---------------------------------------------------------------------------
// 2. The Scope mask is retired (2026-11): no control, no share keys
// ---------------------------------------------------------------------------

test('the retired Scope mask has no control, writes no share keys and ignores old ones', () => {
  assert.doesNotMatch(indexHtml, /id="scope-(toggle|feather-slider|feather-value)"/,
    'index.html: the Scope checkbox and feather slider are gone');
  const params = managerForHash('')._buildHashParams();
  for (const key of ['sc', 'scf', 'sce'])
    assert.equal(params.has(key), false, `a new link never writes ${key}`);
  // Old links still open; their Scope keys are simply read past.
  const shared = managerForHash('#lat=10&lon=20&sc=0&scf=11&sce=97').parseInitialHash();
  assert.equal(shared.lat, 10);
  for (const key of ['scopeEnabled', 'scopeFeatherPct', 'scopeTerminusPct'])
    assert.equal(Object.hasOwn(shared, key), false, `${key} is not restored`);
});

// ---------------------------------------------------------------------------
// 2c. Detection Fade — 7% on a first run, at every surface that decides it
// (owner final lock 2026-08-24; 16% before). Fade is the label/card fading
// band around the keyhole.
test('first run opens at 7% detection fade, at every surface that decides it', () => {
  assert.equal(KEYHOLE_LABEL_FEATHER_RATIO, 0.07,
    'celestialRing.js: the engine fade band opens at 7%');
  assert.match(uiSource, /detectionFadePct: 7,/,
    'ui.js: the global post defaults apply the same value on first load');
  assert.match(indexHtml, /id="detection-fade-slider"[^>]*\svalue="7"/,
    'index.html: the fade slider ships at 7');
  assert.match(indexHtml, /id="detection-fade-value"[^>]*>7%</,
    'index.html: the fade readout agrees with the slider');
  assert.match(shareSource, /this\._detectionFadePct = 7;/,
    'sharelink.js: the generator starts from the same value the overlay draws');
});

// 2b. Detection OUTSIDE opacity — 100% on a first run
// ---------------------------------------------------------------------------

test('first run opens at 100% OUTSIDE opacity, at every surface that decides it', () => {
  assert.equal(KEYHOLE_OUTSIDE_OPACITY_DEFAULT, 1,
    'without the Scope mask the globe reaches the screen edges, and so do readable labels');

  // Four independent literals decide this on a fresh boot: the engine constant
  // above, the markup and its readout, ui.js's global post defaults, and the
  // share generator's starting state. Changing one alone ships a UI that
  // disagrees with its own engine.
  assert.match(indexHtml, /id="detection-opacity-slider"[^>]*\svalue="100"/,
    'index.html: the OUTSIDE slider ships at 100');
  assert.match(indexHtml, /id="detection-opacity-value"[^>]*>100%</,
    'index.html: and its readout agrees with the handle');
  assert.match(uiSource, /detectionOutsideOpacityPct: 100,/,
    'ui.js: the global post defaults apply the same value on first load');
  assert.match(shareSource, /this\._detectionOutsideOpacityPct = 100;/,
    'sharelink.js: the generator starts from the same value the overlay draws');

  // The bracket floor keeps its 1% calibration point; at the 100% default it
  // equals the label alpha and stops overriding.
  assert.equal(AIRCRAFT_BRACKET_FLOOR_ANCHOR, 0.01,
    'the AIR bracket floor stays calibrated at the approved 1% look');

  // Reachability: the mapping was always continuous, but at the previous step
  // of 5 the whole sub-default range was one stop wide.
  assert.match(indexHtml, /id="detection-opacity-slider"[^>]*\sstep="1"/,
    'index.html: every integer percent is reachable from the handle');
});

test('an explicit OUTSIDE opacity still wins over the new default', () => {
  assert.equal(managerForHash('#lat=10&lon=20&ko=5').parseInitialHash().detectionOutsideOpacityPct, 5);
  assert.equal(managerForHash('#lat=10&lon=20&ko=40').parseInitialHash().detectionOutsideOpacityPct, 40);
  assert.equal(managerForHash('#lat=10&lon=20&ko=0').parseInitialHash().detectionOutsideOpacityPct, 0,
    'an explicit 0 is a choice too, not an absent field');

  // A link from before `ko` existed restores what ITS author saw. Every link
  // since carries the field explicitly, so the 5% era is unaffected either way.
  assert.equal(managerForHash('#lat=10&lon=20&style=normal').parseInitialHash().detectionOutsideOpacityPct, 5,
    'a pre-ko link restores the author\'s view, not the new default');
});

// ---------------------------------------------------------------------------
// 3. Detection — on for every style on a first run, Normal included
// ---------------------------------------------------------------------------

test('first run opens with detection on, in every style, using the one tactical preset', () => {
  // Normal used to start OFF while only CRT/NVG/FLIR auto-applied the preset.
  // It is now the baseline for all of them, reusing the SAME frozen object, so
  // "the tactical look" cannot fork into two definitions.
  assert.match(uiSource, /const MILITARY_DETECTION_PRESET = Object\.freeze\(\{\s*mode: 'dense',\s*densityPct: 75,?\s*\}\);/,
    'the tactical look is still Dense @ 75%');
  const baseline = uiBlock('const GLOBAL_POST_DEFAULTS = {', '\n};');
  assert.match(baseline, /detectionMode: MILITARY_DETECTION_PRESET\.mode\.toUpperCase\(\),/,
    'the first-load baseline reads the preset rather than restating it');
  assert.match(baseline, /detectionDensity: MILITARY_DETECTION_PRESET\.densityPct,/,
    'density comes from the same object, so the two cannot drift');
  assert.doesNotMatch(baseline, /detectionMode: 'OFF'/,
    'the retired OFF baseline is gone, not shadowed');

  // `const` has no hoisted value: the baseline can only READ the preset if the
  // preset is declared first. Getting this backwards is a startup TDZ crash,
  // which no other test in the suite would reach.
  assert.ok(
    uiSource.indexOf('const MILITARY_DETECTION_PRESET =')
      < uiSource.indexOf('const GLOBAL_POST_DEFAULTS ='),
    'MILITARY_DETECTION_PRESET must be declared before the baseline that reads it',
  );
});

test('detection-on-by-default is a default, not an operator override', () => {
  // `_detectionUserOverridden` means the OPERATOR hand-edited detection, and it
  // suppresses the military-style auto-enable for the rest of the session.
  // A factory default is not that. If applying the baseline set the flag, a
  // fresh session would silently lose the style auto-enable behaviour — a
  // separate landed feature, taken out by an unrelated change.
  const applyDefaults = uiBlock('  _applyGlobalPostDefaults() {', '\n  }\n');
  assert.match(applyDefaults, /this\._setDetectionMode\(defaults\.detectionMode\)/,
    'the baseline still goes through the real detection path');
  assert.doesNotMatch(applyDefaults, /_detectionUserOverridden/,
    'applying a factory default must not impersonate an operator edit');

  // And the two halves of the override machinery are still wired: the style
  // preset consults the flag, and the detection button sets it.
  assert.match(uiSource, /if \(preset\.detection && !this\._detectionUserOverridden\) \{/,
    'a style preset still yields to an operator who changed detection by hand');
  const displayActions = uiSource.slice(uiSource.indexOf('this._displayControls ='));
  const detectionButton = displayActions.slice(displayActions.indexOf('cycleDetection:'), displayActions.indexOf('toggleModels:'));
  assert.match(detectionButton, /cycleDetectionMode\(\)/, 'the button still invokes the detection action');
  assert.match(detectionButton, /this\.claimDetection\(\);/,
    'and the detection control still claims the override when the operator uses it');
  assert.match(uiSource, /claimDetection: \(\) => \{\s*this\._visualSettings\._detectionUserOverridden = true;/);

  // Style-switch semantics are unchanged: Normal is still not a preset owner,
  // so switching TO Normal does not re-apply or clear anything.
  const stylePresets = uiBlock('const STYLE_PRESET_DEFAULTS = {', '\n};');
  for (const style of ['retro', 'surveillance', 'thermal']) {
    assert.match(stylePresets, new RegExp(`\\n  ${style}: \\{`),
      `${style} still carries its own preset`);
  }
  assert.doesNotMatch(stylePresets, /\n  normal: \{/,
    'Normal gained a default, not a style preset — switching to it still touches nothing');
});

test('a share link that carries detection OFF still restores OFF', () => {
  // Same rule as the feather: the default governs a session that said nothing.
  const off = managerForHash('#lat=10&lon=20&dm=OFF&dd=50').parseInitialHash();
  assert.equal(off.detectionMode, 'OFF', 'an explicit OFF survives the default flip');

  const sparse = managerForHash('#lat=10&lon=20&dm=SPARSE&dd=25').parseInitialHash();
  assert.equal(sparse.detectionMode, 'SPARSE');
  assert.equal(sparse.detectionDensity, 25,
    'and a quieter explicit profile is not promoted to the new default');

  const dense = managerForHash('#lat=10&lon=20&dm=DENSE&dd=75').parseInitialHash();
  assert.equal(dense.detectionMode, 'DENSE');
  assert.equal(dense.detectionDensity, 75);
});
