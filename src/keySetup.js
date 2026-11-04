import { createSurfaceKeyboard } from './ui/surfaceKeyboard.js';
import {
  readStoredCloudVoiceAuthMode,
  writeStoredCloudVoiceAuthMode,
} from './voice/cloudVoiceAuth.js';

import {
  keyRemindersMuted,
  onKeyRemindersChange,
  readKeyReminders,
  setKeyReminderMuted,
  setKeyRemindersOff,
} from './ui/keyReminders.js';

/**
 * Provider Settings — paste a key, get a provider.
 *
 * A key button sits in the top bar whenever the app runs under the dev server.
 * It opens a dialog rendered ENTIRELY from GET /api/setup/status (the registry
 * lives in src/keySetupCore.mjs and this module never duplicates it): the
 * providers in groups, one plain status each, what the key unlocks, where to
 * get it, and a paste field. Save posts to /api/setup/keys, which writes the
 * repo-root .env and restarts the dev server — Vite's client then reloads the
 * page itself, and the pasted key is simply *on*. No hand-edited env files.
 *
 * Only an essential key (Google Maps) that is missing puts a count on the
 * button, and the person can turn that reminder off (src/ui/keyReminders.js).
 *
 * The surface self-destructs where it cannot work: a prod build (no endpoint)
 * or a LAN visitor (loopback-only endpoint) fails the status fetch, and both
 * the button and the dialog are removed outright.
 */

import { t, msg, tn, registerUnsavedWork } from './i18n/index.js';

/** Panel groups, in order. Rows with an unknown group join the last one. */
export const KEY_SETUP_GROUPS = Object.freeze([
  Object.freeze({ id: 'globe', label: msg('3D globe'), optional: false }),
  Object.freeze({ id: 'voice', label: msg('Voice assistant'), optional: true }),
  Object.freeze({ id: 'data', label: msg('Data layers'), optional: true }),
]);

/**
 * The one status a provider row shows — pure, exported for tests. `tone` is
 * the colour: 'ok' (configured), 'attention' (an essential key is missing and
 * its reminder is on) or 'neutral' (anything else that is not configured).
 * `label` is English source text for t().
 * @param {{set?: boolean, managed?: string, essential?: boolean}} key
 * @param {boolean} [muted] Reminders about this key are off.
 * @returns {{tone: 'ok'|'attention'|'neutral', label: string, reminding: boolean}}
 */
export function keyRowStatus(key, muted = false) {
  if (key?.set)
    return key.managed === 'external'
      ? {
          tone: 'ok',
          label: msg('Configured outside this app'),
          reminding: false,
        }
      : { tone: 'ok', label: msg('Configured'), reminding: false };
  if (key?.essential && !muted)
    return { tone: 'attention', label: msg('Not configured'), reminding: true };
  return {
    tone: 'neutral',
    label: key?.essential
      ? msg('Not configured')
      : msg('Not configured (optional)'),
    reminding: false,
  };
}

/**
 * Ids of the missing keys the button reminds about — pure, exported for
 * tests: essential, not configured, and not muted.
 * @param {{keys?: Array<object>}|null} status
 * @param {(id: string) => boolean} [isMuted]
 * @returns {string[]}
 */
export function missingKeyReminders(status, isMuted = () => false) {
  return (status?.keys || [])
    .filter((key) => keyRowStatus(key, isMuted(key.id)).reminding)
    .map((key) => key.id);
}

/**
 * Button label — pure, exported for tests (keySetup.test.mjs pins the English).
 * @param {{keys?: Array<object>}|null} status
 * @param {(id: string) => boolean} [isMuted]
 * @returns {string}
 */
export function keySetupChipLabel(status, isMuted) {
  const missing = missingKeyReminders(status, isMuted).length;
  return missing > 0
    ? tn(
        missing,
        'Provider Settings · {count} key missing',
        'Provider Settings · {count} keys missing',
      )
    : t('Provider Settings');
}

/**
 * Collect a POST body from field descriptors — pure, exported for tests.
 * @param {Array<{envVar: string, value: string}>} fields
 * @returns {Record<string, string>} non-empty trimmed values only
 */
export function collectKeyUpdates(fields) {
  const updates = {};
  for (const field of fields || []) {
    const value = String(field?.value ?? '').trim();
    if (value && field?.envVar) updates[field.envVar] = value;
  }
  return updates;
}

/**
 * Why /api/setup/keys refused a save, by the `code` the server sends beside
 * its English `error` (src/keySetupCore.mjs, server/standalone/key-setup.js).
 * The English matches the server's text.
 */
const SAVE_REFUSALS = Object.freeze({
  proxied: msg('Provider Settings does not answer proxied requests'),
  sharing: msg('Provider Settings is disabled while sharing is enabled'),
  'not-loopback': msg(
    'Provider Settings answers only the machine running the server',
  ),
  'not-local-host': msg('Provider Settings answers only local hostnames'),
  'origin-required': msg('Provider Settings requires an exact local Origin'),
  'origin-unrecognized': msg('Unrecognized Origin refused'),
  'cross-origin': msg('Cross-origin requests are refused'),
  'content-type': msg('Content-Type must be application/json'),
  method: msg('Method not allowed'),
  'too-large': msg('Request too large'),
  'invalid-json': msg('Invalid JSON'),
  'not-object': msg('Body must be a JSON object of {ENV_VAR: value}'),
  'no-keys': msg('No keys provided'),
  'too-many': msg('At most {limit} keys per save'),
  'unknown-key': msg('Unknown key: {name}'),
  'not-string': msg('{name} must be a string'),
  empty: msg('{name} is empty'),
  'too-long': msg('{name} is longer than any real key ({limit} max)'),
  'not-printable': msg(
    '{name} may only contain printable characters with no spaces',
  ),
  'invalid-char': msg(
    '{name} contains a character that is not valid in a key (#, quotes, $, \\, or backtick)',
  ),
  external: msg(
    '{name} is configured outside Provider Settings and can only be changed where it was set',
  ),
  'harden-failed': msg(
    'The key was not saved: could not restrict the credential file to your account; nothing was saved',
  ),
  'store-unreadable': msg(
    'The key was not saved: the existing configuration could not be read, so nothing was changed',
  ),
  'write-failed': msg('Could not write the {store} store'),
});

/**
 * The status line for a refused save — pure, exported for tests. A known
 * `code` reads in the active language; anything else shows the server's text.
 * @param {{code?: string, params?: object, error?: string}} payload
 * @param {number} status HTTP status of the response.
 * @returns {string}
 */
export function saveRefusalText(payload, status) {
  const pattern = Object.hasOwn(SAVE_REFUSALS, payload?.code)
    ? SAVE_REFUSALS[payload.code]
    : null;
  if (pattern) {
    const values = {};
    for (const name of ['name', 'limit', 'store']) {
      const value = payload.params?.[name];
      if (typeof value === 'string' || typeof value === 'number')
        values[name] = value;
    }
    return t(pattern, values);
  }
  return payload?.error || t('Save failed ({status}).', { status });
}

function sleepWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * An OAuth check error. A server reason is later wrapped in «OAuth check
 * failed: …»; our own translated fallback is flagged to show unwrapped.
 * @param {unknown} serverError
 * @param {string} fallback Already-translated fallback sentence.
 * @returns {Error}
 */
function oauthCheckError(serverError, fallback) {
  if (serverError) return new Error(String(serverError));
  const error = new Error(fallback);
  error.oauthFallback = true;
  return error;
}

/**
 * Status text for a failed OAuth check — pure, exported for tests. A fallback
 * sentence of our own already says what failed and is shown alone; any other
 * reason (server text, network error) gets the «OAuth check failed» wrapper.
 * @param {unknown} error
 * @returns {string}
 */
export function oauthCheckFailureText(error) {
  if (error?.oauthFallback && error.message) return error.message;
  return t('OAuth check failed: {detail}', {
    detail: error?.message || error,
  });
}

export async function waitForChatGptOAuth({
  fetchImpl,
  signal,
  timeoutMs = 120_000,
  pollMs = 1_000,
  now = () => Date.now(),
  sleep = sleepWithSignal,
} = {}) {
  const deadline = now() + Math.max(0, timeoutMs);
  while (!signal?.aborted && now() <= deadline) {
    const response = await fetchImpl('/api/realtime/oauth-status', {
      cache: 'no-store',
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (signal?.aborted) return false;
    if (response.ok && payload.available) return true;
    if (!response.ok || payload.loginFailed) {
      throw oauthCheckError(
        payload.error,
        t('Could not check ChatGPT sign-in. Try again.'),
      );
    }
    if (now() >= deadline) break;
    await sleep(Math.max(0, pollMs), signal);
  }
  return false;
}

/**
 * After the FIRST Google key lands, the restart's reload should boot the
 * photoreal default — not faithfully restore the auto-selected keyless OSM
 * basemap from the URL's live share hash. Strips only `map=osm`: a stack under
 * any other name was chosen or shared on purpose and survives, and so does
 * everything else in the hash (camera, style, layers). Pure, exported for tests.
 * @param {string} hash Location hash without the leading '#'.
 * @returns {string|null} The rewritten hash, or null when there is nothing to strip.
 */
export function stripKeylessBasemapFromHash(hash) {
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash);
    if (!['osm', 'esri-imagery'].includes(params.get('map'))) return null;
    params.delete('map');
    return params.toString();
  } catch {
    return null;
  }
}

/** Short cost note per tier; the title keeps the longer explanation. */
const TIER_LABELS = Object.freeze({
  metered: msg('Needs a billing account'),
  paid: msg('Optional paid token'),
  free: msg('Free key'),
});

const TIER_TITLES = Object.freeze({
  metered: msg('Metered — a billing-enabled account'),
  paid: msg('Optional paid token — public access works without one'),
  free: msg('Free key — register, paste, done'),
});

function updateCloudVoiceAuthControl(auth, busy = false) {
  const mode = readStoredCloudVoiceAuthMode();
  const state = auth.querySelector('.key-setup-cloud-auth-state');
  const toggle = auth.querySelector('[data-cloud-voice-auth-toggle]');
  state.textContent =
    mode === 'oauth'
      ? t('Voice sign-in: ChatGPT OAuth')
      : t('Voice sign-in: API key');
  toggle.textContent =
    mode === 'oauth' ? t('Use API key') : t('Use ChatGPT OAuth');
  toggle.title =
    mode === 'oauth'
      ? t('Use OPENAI_API_KEY for the next cloud voice session')
      : t(
          'Use the signed-in local ChatGPT/Codex OAuth session for the next cloud voice session',
        );
  // Keep the control focusable while the delegated handler blocks repeats.
  toggle.setAttribute('aria-disabled', String(busy));
}

function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build one key row. All content is our own registry text, set via textContent.
 * @param {Document} documentRef
 * @param {object} key One entry of the status payload.
 * @param {{off: boolean, muted: string[]}} reminders
 */
function buildRow(documentRef, key, reminders) {
  const muted = reminders.off || reminders.muted.includes(key.id);
  const state = keyRowStatus(key, muted);
  const name = key.name || key.title;
  const row = element(documentRef, 'section', 'key-setup-row');
  row.dataset.keyId = key.id;
  row.dataset.set = String(Boolean(key.set));
  row.dataset.tone = state.tone;
  if (key.managed) row.dataset.managed = key.managed;
  const external = key.managed === 'external';

  const head = element(documentRef, 'div', 'key-setup-row-head');
  // i18n-ignore: provider product name
  const title = element(documentRef, 'strong', 'key-setup-name', name);
  const status = element(documentRef, 'span', 'key-setup-status');
  status.dataset.tone = state.tone;
  const dot = element(documentRef, 'span', 'key-setup-dot');
  dot.setAttribute('aria-hidden', 'true');
  status.append(
    dot,
    element(documentRef, 'span', 'key-setup-status-label', t(state.label)),
  );
  if (external)
    status.title = t(
      'Supplied by your environment, Keychain, or launcher — change it where it was set',
    );
  const get = element(
    documentRef,
    'a',
    'key-setup-get',
    key.set ? t('Manage') : t('Get a key'),
  );
  get.href = key.getUrl;
  get.target = '_blank';
  get.rel = 'noopener noreferrer';
  const arrow = element(documentRef, 'span', 'key-setup-get-arrow', '↗');
  arrow.setAttribute('aria-hidden', 'true');
  get.append(arrow);
  head.append(title, status, get);

  const unlocks = element(
    documentRef,
    'p',
    'key-setup-unlocks',
    t(key.unlocks),
  );

  const meta = element(documentRef, 'p', 'key-setup-meta');
  if (TIER_LABELS[key.tier]) {
    const tier = element(
      documentRef,
      'span',
      'key-setup-tier',
      t(TIER_LABELS[key.tier]),
    );
    tier.title = t(TIER_TITLES[key.tier]);
    meta.append(tier);
  }
  if (key.clientExposed) {
    // A fact about how the key works, not a warning: it ships to the browser,
    // so the provider-side restriction is what protects it.
    const exposed = element(
      documentRef,
      'span',
      'key-setup-exposed',
      t('Used in the browser: restrict it to your site at the provider'),
    );
    exposed.title = t(
      'This key runs in the browser by design — restrict it at the provider (see SECURITY.md)',
    );
    meta.append(exposed);
  }
  if (external) {
    // Externally supplied credentials (shell env, Keychain, a launcher) are
    // facts this panel reports, never values it rewrites or deletes.
    meta.append(
      element(
        documentRef,
        'span',
        'key-setup-external',
        t(
          'Supplied by your environment, Keychain, or launcher — change it where it was set',
        ),
      ),
    );
  }

  row.append(head, unlocks);
  if (meta.childNodes?.length ?? meta.children?.length) row.append(meta);
  if (!external) {
    const fields = element(documentRef, 'div', 'key-setup-fields');
    for (const envVar of key.envVars) {
      const input = documentRef.createElement('input');
      // Passwords-style so a pasted key never shows on a shared or recorded
      // screen — this app gets screen-recorded a lot.
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.envVar = envVar;
      input.setAttribute('aria-label', envVar);
      input.placeholder = key.set
        ? t('{envVar} saved — paste to replace', { envVar })
        : t('paste {envVar}', { envVar });
      fields.append(input);
    }
    row.append(fields);
  }
  const actions = element(documentRef, 'div', 'key-setup-row-actions');
  if (!external && key.managed === 'file') {
    const remove = element(
      documentRef,
      'button',
      'key-setup-remove',
      t('Remove'),
    );
    remove.type = 'button';
    remove.dataset.keySetupRemove = JSON.stringify(key.envVars);
    remove.title = t("Remove {title} from this app's saved keys", {
      title: name,
    });
    actions.append(remove);
  }
  // Only a key that reminds (or was silenced by itself) offers the switch;
  // with every reminder off, the footer switch is the one to turn back on.
  if (!key.set && key.essential && !reminders.off) {
    const own = reminders.muted.includes(key.id);
    const mute = element(
      documentRef,
      'button',
      'key-setup-mute',
      own ? t('Remind me again') : t("Don't remind me"),
    );
    mute.type = 'button';
    mute.dataset.keySetupMute = key.id;
    mute.setAttribute('aria-pressed', String(own));
    mute.title = t('Reminders about this key are kept in this browser');
    actions.append(mute);
  }
  if (actions.children?.length ?? actions.childNodes?.length)
    row.append(actions);
  if (key.id === 'openai') {
    const auth = element(documentRef, 'div', 'key-setup-cloud-auth');
    const authState = element(
      documentRef,
      'span',
      'key-setup-cloud-auth-state',
    );
    const toggle = element(
      documentRef,
      'button',
      'key-setup-cloud-auth-toggle',
    );
    toggle.type = 'button';
    toggle.dataset.cloudVoiceAuthToggle = 'true';
    auth.append(authState, toggle);
    updateCloudVoiceAuthControl(auth);
    row.append(auth);
  }
  return row;
}

/**
 * Group the rows: one section per KEY_SETUP_GROUPS entry that has rows, its
 * heading saying whether the whole group is optional.
 */
function buildGroups(documentRef, keys, reminders) {
  const known = new Set(KEY_SETUP_GROUPS.map((group) => group.id));
  const fallback = KEY_SETUP_GROUPS.at(-1).id;
  const sections = [];
  for (const group of KEY_SETUP_GROUPS) {
    const members = keys.filter(
      (key) => (known.has(key.group) ? key.group : fallback) === group.id,
    );
    if (!members.length) continue;
    const section = element(documentRef, 'section', 'key-setup-group');
    section.dataset.group = group.id;
    const heading = element(documentRef, 'h3', 'key-setup-group-title');
    heading.append(element(documentRef, 'span', '', t(group.label)));
    if (group.optional)
      heading.append(
        element(documentRef, 'span', 'key-setup-optional', t('Optional')),
      );
    section.append(heading);
    for (const key of members)
      section.append(buildRow(documentRef, key, reminders));
    sections.push(section);
  }
  return sections;
}
/**
 * Move the existing setup action with the theme, retaining its listeners:
 * Cyber puts it in the top toolbar, every other theme keeps it first in its
 * markup home (the bottom-right corner row, beside the language picker).
 */
export function bindKeySetupPlacement(documentRef, chip) {
  const theme = documentRef?.documentElement;
  const toolbar = documentRef?.getElementById?.('top-center-actions');
  const Observer = documentRef?.defaultView?.MutationObserver;
  const home = chip?.parentNode;
  if (!theme || !toolbar || !Observer || !home) return () => {};
  const sync = () => {
    if (theme.dataset.uiTheme === 'cyber') {
      if (chip.parentNode !== toolbar) toolbar.append(chip);
    } else if (chip.parentNode !== home) {
      home.prepend(chip);
    }
  };
  const observer = new Observer(sync);
  observer.observe(theme, {
    attributes: true,
    attributeFilter: ['data-ui-theme'],
  });
  sync();
  return () => observer.disconnect();
}

/** Wire the dev-only setup surface; unavailable endpoints remove it entirely. */
export async function initKeySetup({
  documentRef = globalThis.document,
  fetchImpl,
  signal,
} = {}) {
  const chip = documentRef?.getElementById?.('key-setup-chip');
  const root = documentRef?.getElementById?.('key-setup');
  if (!chip || !root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const lifetime = new AbortController();
  let disposed = false;
  let disposeControls = () => {};
  let disposePlacement = () => {};
  // A pasted key lives only in its field until Save: switching language (a
  // reload) asks first while any field holds one.
  const unregisterUnsavedWork = registerUnsavedWork(() =>
    [...(root.querySelectorAll?.('input[data-env-var]') || [])].some((input) =>
      String(input.value ?? '').trim(),
    )
      ? msg('unsaved provider keys')
      : null,
  );
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    delete root.dataset.ready;
    unregisterUnsavedWork();
    lifetime.abort();
    signal?.removeEventListener('abort', destroy);
    disposeControls();
    disposePlacement();
    chip.remove();
    root.remove();
  };
  if (signal?.aborted) {
    destroy();
    return null;
  }
  signal?.addEventListener('abort', destroy, { once: true });
  const doFetch = fetchImpl || globalThis.fetch?.bind(globalThis);

  let status = null;
  try {
    const response = await doFetch('/api/setup/status', {
      cache: 'no-store',
      signal: lifetime.signal,
    });
    if (!response.ok) throw new Error(String(response.status));
    status = await response.json();
    if (disposed) return null;
  } catch {
    // Prod build or non-loopback visitor: the surface cannot function, so it
    // does not exist. (The README covers .env for headless/self-host setups.)
    destroy();
    return null;
  }

  const rowsHost = root.querySelector('[data-key-setup-rows]');
  disposePlacement = bindKeySetupPlacement(documentRef, chip);
  const applyButton = root.querySelector('[data-key-setup-apply]');
  const closeButton = root.querySelector('[data-key-setup-close]');
  const chipLabel = chip.querySelector('[data-key-setup-chip-label]') || chip;
  const statusLine = root.querySelector('[data-key-setup-status]');
  const defaultStatusText = statusLine?.textContent || '';
  let busy = false;
  let oauthBusy = false;
  let open = false;

  const syncCloudVoiceAuth = () => {
    for (const auth of rowsHost.querySelectorAll('.key-setup-cloud-auth'))
      updateCloudVoiceAuthControl(auth, oauthBusy);
  };

  const chipBadge = chip.querySelector?.('[data-key-setup-chip-badge]');
  const remindersSwitch = root.querySelector('[data-key-setup-reminders]');

  const render = (nextStatus) => {
    if (disposed) return;
    status = nextStatus;
    const reminders = readKeyReminders();
    const isMuted = (id) => keyRemindersMuted(id);
    const label = keySetupChipLabel(status, isMuted);
    chipLabel.textContent = label;
    chip.title = label;
    chip.setAttribute('aria-label', label);
    if (chipBadge) {
      const missing = missingKeyReminders(status, isMuted).length;
      chipBadge.textContent = missing ? String(missing) : '';
      chipBadge.hidden = missing === 0;
    }
    // The button is the way into the dialog, so it stays: quiet when nothing
    // essential is missing, with a count when something is.
    chip.hidden = false;
    remindersSwitch?.setAttribute('aria-checked', String(!reminders.off));
    if (!rowsHost) return;
    // A re-render (a reminder switched) must not drop a pasted, unsaved key.
    const pasted = new Map();
    for (const input of rowsHost.querySelectorAll?.('input[data-env-var]') ||
      [])
      if (input.value) pasted.set(input.dataset.envVar, input.value);
    const focusedMute =
      documentRef.activeElement?.dataset?.keySetupMute || null;
    rowsHost.textContent = '';
    for (const section of buildGroups(
      documentRef,
      status.keys || [],
      reminders,
    ))
      rowsHost.append(section);
    for (const input of rowsHost.querySelectorAll?.('input[data-env-var]') ||
      [])
      if (pasted.has(input.dataset.envVar))
        input.value = pasted.get(input.dataset.envVar);
    if (focusedMute)
      (
        rowsHost.querySelector?.(`[data-key-setup-mute="${focusedMute}"]`) ||
        remindersSwitch
      )?.focus?.({ preventScroll: true });
    syncCloudVoiceAuth();
  };

  const visible = () =>
    root.isConnected &&
    root.classList.contains('visible') &&
    root.getClientRects().length > 0;

  const keyboard = createSurfaceKeyboard({
    root,
    documentRef,
    isActive: () => open && visible(),
    onEscape: () => close(),
  });

  const openDialog = () => {
    if (disposed || open) return;
    open = true;
    keyboard.activate();
    root.hidden = false;
    globalThis.requestAnimationFrame?.(() => {
      if (!open) return;
      root.classList.add('visible');
      root.querySelector('input')?.focus?.({ preventScroll: true });
    });
  };

  const close = () => {
    if (!open) return;
    open = false;
    root.classList.remove('visible');
    const hide = () => {
      if (!open) root.hidden = true;
    };
    root.addEventListener('transitionend', hide, { once: true });
    globalThis.setTimeout?.(hide, 400);
    if (statusLine) statusLine.textContent = defaultStatusText;
    keyboard.deactivate({ restoreFocus: true });
  };

  const say = (text) => {
    if (statusLine) statusLine.textContent = text;
  };

  const storeLabel = () =>
    status?.store === 'pinokio-environment'
      ? t('your app configuration')
      : t('your local .env');

  // doneMessageKey names the whole saved/removed sentence; the storage
  // destination is interpolated so the {store} phrase stays one spelling.
  const submitUpdates = async (updates, doneMessageKey) => {
    if (disposed || busy) return;
    const googleWasUnset = !status?.keys?.find(
      (key) => key.id === 'google-maps',
    )?.set;
    busy = true;
    applyButton?.setAttribute('aria-disabled', 'true');
    say(t('Saving…'));
    try {
      const response = await doFetch('/api/setup/keys', {
        method: 'POST',
        signal: lifetime.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const payload = await response.json().catch(() => ({}));
      if (disposed) return;
      if (!response.ok || !payload.ok) {
        say(saveRefusalText(payload, response.status));
        return;
      }
      for (const input of root.querySelectorAll('input[data-env-var]'))
        input.value = '';
      render(payload.status);
      if (googleWasUnset && payload.saved?.includes('GOOGLE_MAPS_API_KEY')) {
        const strip = () => {
          try {
            const next = stripKeylessBasemapFromHash(
              globalThis.location?.hash?.slice(1) || '',
            );
            if (next !== null)
              globalThis.history?.replaceState?.(
                null,
                '',
                new URL(`#${next}`, globalThis.location.href).href,
              );
          } catch {
            // Continuity is a nicety, never a blocker.
          }
        };
        strip();
        // The live share writer may re-serialize the still-OSM stack before
        // the restart's reload lands, so strip again at the door.
        globalThis.addEventListener?.('pagehide', strip, {
          once: true,
          signal: lifetime.signal,
        });
      }
      say(t(doneMessageKey, { store: storeLabel() }));
    } catch (error) {
      say(
        t('Save failed: {detail}', {
          detail: error?.message || error,
        }),
      );
    } finally {
      busy = false;
      applyButton?.setAttribute('aria-disabled', 'false');
    }
  };

  const onApply = async () => {
    if (disposed || busy) return;
    const inputs = [...root.querySelectorAll('input[data-env-var]')];
    const updates = collectKeyUpdates(
      inputs.map((input) => ({
        envVar: input.dataset.envVar,
        value: input.value,
      })),
    );
    if (!Object.keys(updates).length) {
      say(t('Paste at least one key first.'));
      return;
    }
    await submitUpdates(
      updates,
      msg('Saved to {store}. Restarting — this page reloads itself.'),
    );
  };

  const onRemindersSwitch = () => {
    if (disposed) return;
    setKeyRemindersOff(!readKeyReminders().off);
  };
  const stopListeningForReminders = onKeyRemindersChange(() => {
    if (status) render(status);
  });

  chip.addEventListener('click', openDialog);
  closeButton?.addEventListener('click', close);
  remindersSwitch?.addEventListener('click', onRemindersSwitch);
  applyButton?.addEventListener('click', onApply);
  root.dataset.ready = 'true';
  // Remove buttons are rendered per row; delegate so re-renders stay wired.
  rowsHost?.addEventListener('click', (event) => {
    const authButton = event.target?.closest?.(
      '[data-cloud-voice-auth-toggle]',
    );
    if (authButton && !disposed) {
      if (oauthBusy) return;
      void (async () => {
        const current = readStoredCloudVoiceAuthMode();
        if (current === 'oauth') {
          writeStoredCloudVoiceAuthMode('api-key');
          syncCloudVoiceAuth();
          say(t('Cloud voice will use OPENAI_API_KEY on the next session.'));
          return;
        }
        oauthBusy = true;
        syncCloudVoiceAuth();
        say(t('Checking local ChatGPT OAuth sign-in…'));
        try {
          const response = await doFetch('/api/realtime/oauth-status', {
            cache: 'no-store',
            signal: lifetime.signal,
          });
          const payload = await response.json().catch(() => ({}));
          if (lifetime.signal.aborted) return;
          if (!response.ok)
            throw oauthCheckError(
              payload.error,
              t('Could not check ChatGPT sign-in.'),
            );
          if (payload.available) {
            writeStoredCloudVoiceAuthMode('oauth');
            syncCloudVoiceAuth();
            say(
              t(
                'ChatGPT OAuth selected for cloud voice. Your API key stays saved and available.',
              ),
            );
            return;
          }

          say(
            payload.code === 'CODEX_OAUTH_REAUTH_REQUIRED'
              ? t('ChatGPT sign-in expired. Opening sign-in again…')
              : t('Opening ChatGPT sign-in in your browser…'),
          );
          const loginResponse = await doFetch('/api/realtime/oauth-login', {
            method: 'POST',
            cache: 'no-store',
            signal: lifetime.signal,
          });
          const loginPayload = await loginResponse.json().catch(() => ({}));
          if (lifetime.signal.aborted) return;
          if (!loginResponse.ok) {
            say(
              loginPayload.error ||
                payload.error ||
                t('Could not start ChatGPT sign-in on this machine.'),
            );
            return;
          }
          if (loginPayload.available) {
            writeStoredCloudVoiceAuthMode('oauth');
            syncCloudVoiceAuth();
            say(
              t(
                'ChatGPT OAuth selected for cloud voice. Your API key stays saved and available.',
              ),
            );
            return;
          }

          say(
            t(
              'Finish ChatGPT sign-in in the browser. Waiting for it to complete…',
            ),
          );
          const available = await waitForChatGptOAuth({
            fetchImpl: doFetch,
            signal: lifetime.signal,
          });
          if (lifetime.signal.aborted) return;
          if (!available) {
            say(
              t('ChatGPT sign-in timed out. Click {button} to try again.', {
                button: t('Use ChatGPT OAuth'),
              }),
            );
            return;
          }
          writeStoredCloudVoiceAuthMode('oauth');
          syncCloudVoiceAuth();
          say(
            t(
              'ChatGPT sign-in complete. OAuth will be used for the next cloud voice session.',
            ),
          );
        } catch (error) {
          if (lifetime.signal.aborted) return;
          say(oauthCheckFailureText(error));
        } finally {
          oauthBusy = false;
          if (!disposed) syncCloudVoiceAuth();
        }
      })();
      return;
    }
    const muteButton = event.target?.closest?.('[data-key-setup-mute]');
    if (muteButton) {
      if (disposed) return;
      const id = muteButton.dataset.keySetupMute;
      setKeyReminderMuted(id, !readKeyReminders().muted.includes(id));
      return;
    }
    const button = event.target?.closest?.('[data-key-setup-remove]');
    if (disposed || !button || busy) return;
    let envVars = [];
    try {
      envVars = JSON.parse(button.dataset.keySetupRemove || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(envVars) || !envVars.length) return;
    // Removal is destructive and — behind a framing defense that should already
    // stop it — a clickjack target. A confirm turns a single aligned click into
    // a deliberate two-step the lure cannot pre-satisfy.
    const ok =
      typeof globalThis.confirm !== 'function' ||
      globalThis.confirm(t('Remove this key from your saved configuration?'));
    if (!ok) return;
    void submitUpdates(
      Object.fromEntries(envVars.map((name) => [name, null])),
      msg('Removed from {store}. Restarting — this page reloads itself.'),
    );
  });

  render(status);

  // Demos and support: ?setup=1 opens the dialog straight away.
  try {
    if (
      new URLSearchParams(globalThis.location?.search || '').get('setup') ===
      '1'
    )
      openDialog();
  } catch {
    // An unparsable location never blocks init.
  }

  disposeControls = () => {
    open = false;
    keyboard.destroy();
    chip.removeEventListener('click', openDialog);
    closeButton?.removeEventListener('click', close);
    applyButton?.removeEventListener('click', onApply);
    remindersSwitch?.removeEventListener('click', onRemindersSwitch);
    stopListeningForReminders();
  };
  return { open: openDialog, close, render, destroy };
}
