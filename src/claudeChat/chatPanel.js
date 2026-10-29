/**
 * Claude chat panel: a typed conversation with Claude that controls the app
 * with the same tools as voice. The server runs the local Claude Code CLI
 * (server/providers/claude/chat.js) and streams newline-delimited JSON
 * events back; each `tool_call` runs here through the voice runner and its
 * result is posted to /api/claude/chat/result.
 */

import { t } from '../i18n/index.js';

// A product name, not UI text: it stays the same in every language.
const NAME = 'Claude';
const SESSION_STORAGE_KEY = 'gev:claude-chat:session:v1';

/** Split a fetch body stream into parsed NDJSON events. */
export async function* readNdjson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // A malformed line is skipped, not fatal.
      }
    }
  }
  const rest = buffered.trim();
  if (rest) {
    try {
      yield JSON.parse(rest);
    } catch {
      // Ignore a trailing partial line.
    }
  }
}

function readStoredSession(storage) {
  try {
    return storage?.getItem(SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeStoredSession(storage, sessionId) {
  try {
    if (sessionId) storage?.setItem(SESSION_STORAGE_KEY, sessionId);
    else storage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Private windows may refuse storage; the chat still works.
  }
}

/** Tool names as a person reads them: "fly_to_location" → "fly to location". */
function toolLabel(name) {
  return String(name || '').replace(/_/g, ' ');
}

/**
 * Mount the panel. `run(name, args, { signal })` executes one tool, as the
 * voice runner does.
 */
export function initClaudeChat({
  run,
  doc = document,
  fetchImpl = (...args) => fetch(...args),
  storage = globalThis.localStorage,
} = {}) {
  if (typeof run !== 'function') return { destroy() {} };

  const root = doc.createElement('section');
  root.id = 'gev-claude-chat';
  root.dataset.open = 'false';
  root.innerHTML = `
    <button type="button" class="gev-claude-chat-toggle" aria-expanded="false" aria-controls="gev-claude-chat-panel" title="${t('Chat with Claude')}">
      <span aria-hidden="true">✦</span><span class="gev-claude-chat-toggle-label">${NAME}</span>
    </button>
    <div class="gev-claude-chat-panel" id="gev-claude-chat-panel" hidden>
      <header class="gev-claude-chat-header">
        <span class="gev-claude-chat-title">${NAME}</span>
        <button type="button" class="gev-claude-chat-new" title="${t('Start a new conversation')}">${t('New', { context: 'claude chat' })}</button>
        <button type="button" class="gev-claude-chat-close" aria-label="${t('Close chat')}">×</button>
      </header>
      <ol class="gev-claude-chat-log" aria-live="polite"></ol>
      <form class="gev-claude-chat-form">
        <textarea rows="2" maxlength="4000" placeholder="${t('Ask or command the map…')}" aria-label="${t('Message to Claude')}"></textarea>
        <button type="submit" class="gev-claude-chat-send">${t('Send', { context: 'claude chat' })}</button>
      </form>
    </div>`;
  doc.body.appendChild(root);

  const toggle = root.querySelector('.gev-claude-chat-toggle');
  const panel = root.querySelector('.gev-claude-chat-panel');
  const log = root.querySelector('.gev-claude-chat-log');
  const form = root.querySelector('.gev-claude-chat-form');
  const input = form.querySelector('textarea');
  const send = form.querySelector('.gev-claude-chat-send');

  let sessionId = readStoredSession(storage);
  let turn = null;

  function setOpen(open) {
    root.dataset.open = String(open);
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }

  function addEntry(kind, text) {
    const item = doc.createElement('li');
    item.className = `gev-claude-chat-entry is-${kind}`;
    item.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function setBusy(busy) {
    root.dataset.busy = String(busy);
    send.textContent = busy
      ? t('Stop', { context: 'claude chat' })
      : t('Send', { context: 'claude chat' });
    input.disabled = busy;
  }

  async function answerToolCall(event, chatId, signal, step) {
    let result;
    try {
      result = await run(event.name, event.args || {}, { signal });
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    step.dataset.ok = String(result?.ok !== false);
    if (signal.aborted) return;
    await fetchImpl('/api/claude/chat/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, callId: event.callId, result }),
      signal,
    }).catch(() => {});
  }

  async function submit(message) {
    const controller = new AbortController();
    const { signal } = controller;
    turn = controller;
    setBusy(true);
    addEntry('user', message);
    const thinking = addEntry('status', t('Thinking…'));
    let chatId = null;
    let answered = false;
    try {
      const response = await fetchImpl('/api/claude/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
        signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      for await (const event of readNdjson(response.body)) {
        if (event.type === 'start') chatId = event.chatId;
        else if (event.type === 'session' || event.type === 'done') {
          if (event.sessionId) {
            sessionId = event.sessionId;
            writeStoredSession(storage, sessionId);
          }
        } else if (event.type === 'text') {
          answered = true;
          addEntry('assistant', event.text);
        } else if (event.type === 'tool_call') {
          const step = addEntry('tool', `▸ ${toolLabel(event.name)}`);
          answerToolCall(event, chatId, signal, step);
        } else if (event.type === 'error') {
          // The CLI also reports its failure as an assistant message.
          const last = log.lastElementChild;
          if (
            last?.classList.contains('is-assistant') &&
            last.textContent === event.error
          )
            last.remove();
          throw new Error(event.error);
        }
      }
      if (!answered) addEntry('status', t('Done.'));
    } catch (error) {
      if (!signal.aborted) addEntry('error', error?.message || String(error));
      else addEntry('status', t('Stopped.'));
    } finally {
      thinking.remove();
      if (turn === controller) turn = null;
      setBusy(false);
      input.focus();
    }
  }

  toggle.addEventListener('click', () => setOpen(root.dataset.open !== 'true'));
  root
    .querySelector('.gev-claude-chat-close')
    .addEventListener('click', () => setOpen(false));
  root.querySelector('.gev-claude-chat-new').addEventListener('click', () => {
    turn?.abort();
    sessionId = null;
    writeStoredSession(storage, null);
    log.replaceChildren();
    input.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (turn) {
      turn.abort();
      return;
    }
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    submit(message);
  });
  input.addEventListener('keydown', (event) => {
    // Enter sends; Shift+Enter makes a new line. Keys stay out of the map.
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('keyup', (event) => event.stopPropagation());

  return {
    root,
    open: () => setOpen(true),
    destroy() {
      turn?.abort();
      root.remove();
    },
  };
}
