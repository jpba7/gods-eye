/**
 * Missing-key reminders: whether the app may point at a provider key that is
 * not configured. People can turn the reminders off for one provider or for
 * all of them; the choice is kept in this browser (localStorage) only.
 *
 * A reminder is anything the app shows on its own about a missing key: the
 * count on the Provider Settings button, the highlighted row in Provider
 * Settings, a provider chip lit as an error before it was switched on. A
 * control the person just used and that cannot work without its key still
 * says why: that is an answer, not a reminder.
 *
 * Storage access is lazy and guarded: private modes and embedded frames may
 * refuse it, and then every reminder simply stays on.
 */

export const KEY_REMINDERS_STORAGE_KEY = 'gev:key-reminders:v1';

const listeners = new Set();

function storageRef(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {Storage|null} [storage]
 * @returns {{off: boolean, muted: string[]}}
 */
export function readKeyReminders(storage) {
  try {
    const raw = storageRef(storage)?.getItem(KEY_REMINDERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      off: parsed?.off === true,
      muted: Array.isArray(parsed?.muted)
        ? [...new Set(parsed.muted.filter((id) => typeof id === 'string'))]
        : [],
    };
  } catch {
    return { off: false, muted: [] };
  }
}

function writeKeyReminders(next, storage) {
  const value = {
    off: next.off === true,
    muted: [...new Set(next.muted)].sort(),
  };
  try {
    const target = storageRef(storage);
    if (!value.off && !value.muted.length)
      target?.removeItem(KEY_REMINDERS_STORAGE_KEY);
    else target?.setItem(KEY_REMINDERS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Unpersisted is still applied for this page through the listeners.
  }
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch {
      // One broken listener must not stop the others.
    }
  }
  return value;
}

/** Whether reminders about this provider key are off (by itself or all). */
export function keyRemindersMuted(id, storage) {
  const { off, muted } = readKeyReminders(storage);
  return off || (typeof id === 'string' && muted.includes(id));
}

/** Turn every missing-key reminder off (true) or back on (false). */
export function setKeyRemindersOff(off, storage) {
  return writeKeyReminders(
    { ...readKeyReminders(storage), off: off === true },
    storage,
  );
}

/** Turn reminders about one provider key off (true) or back on (false). */
export function setKeyReminderMuted(id, muted, storage) {
  const current = readKeyReminders(storage);
  const ids = new Set(current.muted);
  if (muted) ids.add(id);
  else ids.delete(id);
  return writeKeyReminders({ ...current, muted: [...ids] }, storage);
}

/**
 * Listen for changes made on this page.
 * @param {(value: {off: boolean, muted: string[]}) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onKeyRemindersChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
