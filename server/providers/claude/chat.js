/**
 * Text chat with Claude through the local Claude Code CLI (`claude -p`).
 *
 * The CLI runs on this machine with the person's own Claude sign-in, so the
 * chat spends their Claude subscription and needs no API key. Its only tools
 * are the voice tools, served by a small MCP bridge (bridge.js) that hands
 * every call back to the browser through this chat's response stream: the
 * browser runs it with the same runner voice uses and posts the result to
 * /api/claude/chat/result.
 *
 * Wire format of POST /api/claude/chat: newline-delimited JSON events
 *   { type: 'start', chatId }
 *   { type: 'session', sessionId }
 *   { type: 'text', text }
 *   { type: 'tool_call', callId, name, args }
 *   { type: 'done', sessionId, costUsd } | { type: 'error', error }
 */

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequestBody } from '../common/request.js';
import { realtimeInstructions } from '../openai/instructions.js';

const BRIDGE_PATH = fileURLToPath(new URL('./bridge.js', import.meta.url));
const MCP_SERVER_NAME = 'gev';
const MAX_MESSAGE_CHARS = 4000;
const MAX_RESULT_CHARS = 24_000;
const MAX_ACTIVE_CHATS = 2;
const TOOL_CALL_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 5 * 60_000;
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tools that only make sense for a live microphone session.
const EXCLUDED_TOOLS = new Set(['set_voice_inactivity_timeout']);

const TEXT_CHAT_INSTRUCTIONS = [
  'MODE OVERRIDE: this is a TEXT chat panel inside the app, not a voice session. Everything above about speaking, preambles, microphones and voice cards applies to your written replies instead.',
  'Reply in the language the user writes in. Keep replies short: a sentence or two, or a short list when the user asks for one. Plain text or light Markdown only.',
  'Tool results arrive as JSON. Their "say" line is the confirmation to give; never claim an action happened unless its result has ok=true.',
  'You can only act through the provided tools. You have no shell, files or web access here.',
].join('\n');

/** The system prompt: the voice controller's rules, adapted to text. */
export function chatInstructions() {
  return `${realtimeInstructions()}\n\n${TEXT_CHAT_INSTRUCTIONS}`;
}

/** Bridge tool records ({name, description, inputSchema}) from voice tools. */
export function bridgeTools(tools = []) {
  return tools
    .filter((tool) => tool?.name && !EXCLUDED_TOOLS.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.parameters || { type: 'object', properties: {} },
    }));
}

/** Translate one line of `claude -p --output-format stream-json` into chat events. */
export function streamJsonEvents(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  if (message?.type === 'system' && message.subtype === 'init')
    return message.session_id
      ? [{ type: 'session', sessionId: message.session_id }]
      : [];
  if (message?.type === 'assistant') {
    const content = Array.isArray(message.message?.content)
      ? message.message.content
      : [];
    return content
      .filter((part) => part?.type === 'text' && part.text?.trim())
      .map((part) => ({ type: 'text', text: part.text }));
  }
  if (message?.type === 'result') {
    if (message.is_error || message.subtype !== 'success')
      return [
        {
          type: 'error',
          error: String(message.result || message.subtype || 'Claude failed'),
        },
      ];
    return [
      {
        type: 'done',
        sessionId: message.session_id || null,
        costUsd:
          typeof message.total_cost_usd === 'number'
            ? message.total_cost_usd
            : null,
      },
    ];
  }
  return [];
}

function sameToken(expected, given) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(given || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJson(req, limit) {
  const body = await readRequestBody(req, limit);
  return JSON.parse(body || '{}');
}

function truncateResult(result) {
  let text;
  try {
    text = JSON.stringify(result ?? null);
  } catch {
    text = JSON.stringify({ ok: false, error: 'Unserializable tool result' });
  }
  return text.length > MAX_RESULT_CHARS
    ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncated]`
    : text;
}

/**
 * Construct the chat's three handlers. `command` is the Claude Code CLI;
 * `apiBase` is how the bridge process reaches this server.
 */
export function createClaudeChat({
  tools = [],
  command = process.env.CLAUDE_CLI || 'claude',
  model = process.env.CLAUDE_CHAT_MODEL || '',
  apiBase = () => `http://localhost:${process.env.PORT || 4173}`,
  spawnImpl = spawn,
  workDir = join(tmpdir(), 'gev-claude-chat'),
} = {}) {
  const toolRecords = bridgeTools(tools);
  const chats = new Map();

  function prepareWorkDir() {
    mkdirSync(workDir, { recursive: true });
    const promptFile = join(workDir, 'system-prompt.md');
    writeFileSync(promptFile, chatInstructions(), 'utf8');
    return promptFile;
  }

  function closeChat(chat, reason) {
    if (chat.closed) return;
    chat.closed = true;
    chats.delete(chat.id);
    clearTimeout(chat.runTimer);
    for (const pending of chat.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: reason || 'Chat ended' });
    }
    chat.pending.clear();
    if (chat.child && chat.child.exitCode === null) chat.child.kill();
    rmSync(chat.configFile, { force: true });
  }

  /** POST /api/claude/chat — run one turn and stream its events. */
  async function handleChat(req, res) {
    if (req.method !== 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' });
    if (chats.size >= MAX_ACTIVE_CHATS)
      return sendJson(res, 429, { error: 'Claude is still answering' });
    let body;
    try {
      body = await readJson(req, 16 * 1024);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const message = String(body?.message || '').trim();
    if (!message || message.length > MAX_MESSAGE_CHARS)
      return sendJson(res, 400, { error: 'Message is empty or too long' });
    const sessionId = SESSION_ID.test(String(body?.sessionId || ''))
      ? body.sessionId
      : null;

    const chat = {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      pending: new Map(),
      closed: false,
      child: null,
      configFile: '',
      write: (event) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      },
    };
    chats.set(chat.id, chat);

    let promptFile;
    try {
      promptFile = prepareWorkDir();
      chat.configFile = join(workDir, `mcp-${chat.id}.json`);
      writeFileSync(
        chat.configFile,
        JSON.stringify({
          mcpServers: {
            [MCP_SERVER_NAME]: {
              command: process.execPath,
              args: [BRIDGE_PATH],
              env: {
                GEV_CLAUDE_API_BASE: apiBase(),
                GEV_CLAUDE_CHAT_ID: chat.id,
                GEV_CLAUDE_CHAT_TOKEN: chat.token,
              },
            },
          },
        }),
        'utf8',
      );
    } catch (error) {
      closeChat(chat);
      return sendJson(res, 500, {
        error: `Chat setup failed: ${error.message}`,
      });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    chat.write({ type: 'start', chatId: chat.id });

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config',
      chat.configFile,
      '--tools',
      '',
      '--allowedTools',
      `mcp__${MCP_SERVER_NAME}`,
      '--system-prompt-file',
      promptFile,
      ...(model ? ['--model', model] : []),
      ...(sessionId ? ['--resume', sessionId] : []),
    ];

    let child;
    try {
      child = spawnImpl(command, args, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      chat.write({
        type: 'error',
        error: `Could not start Claude Code: ${error.message}`,
      });
      closeChat(chat);
      return res.end();
    }
    chat.child = child;
    chat.runTimer = setTimeout(() => {
      chat.write({ type: 'error', error: 'Claude took too long to answer' });
      closeChat(chat, 'Timed out');
      res.end();
    }, RUN_TIMEOUT_MS);

    let finished = false;
    let stderr = '';
    let buffered = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line) continue;
        for (const event of streamJsonEvents(line)) {
          if (event.type === 'done' || event.type === 'error') finished = true;
          chat.write(event);
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => {
      if (!finished) {
        finished = true;
        chat.write({
          type: 'error',
          error:
            error.code === 'ENOENT'
              ? 'Claude Code (claude) was not found on this computer'
              : `Claude Code failed: ${error.message}`,
        });
      }
    });
    child.on('close', (code) => {
      if (!finished)
        chat.write({
          type: 'error',
          error: stderr.trim() || `Claude Code exited with code ${code}`,
        });
      closeChat(chat);
      res.end();
    });
    // The browser closing the stream ends the turn.
    res.on('close', () => closeChat(chat, 'Chat closed'));

    child.stdin.end(message);
    return undefined;
  }

  /** POST /api/claude/chat/result — the browser's answer to a tool call. */
  async function handleResult(req, res) {
    if (req.method !== 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' });
    let body;
    try {
      body = await readJson(req, 512 * 1024);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const pending = chats
      .get(String(body?.chatId))
      ?.pending.get(String(body?.callId));
    if (!pending) return sendJson(res, 404, { error: 'No such tool call' });
    clearTimeout(pending.timer);
    pending.resolve(body.result);
    return sendJson(res, 200, { ok: true });
  }

  /**
   * /api/claude/bridge/tools (GET) and /api/claude/bridge/call (POST): the
   * MCP bridge process, authenticated by its chat's token.
   */
  async function handleBridge(req, res) {
    const path = req.url?.split('?')[0] || '';
    const chat = chats.get(String(req.headers['x-gev-chat-id'] || ''));
    if (!chat || !sameToken(chat.token, req.headers['x-gev-chat-token']))
      return sendJson(res, 403, { error: 'Unknown chat' });
    if (req.method === 'GET' && path === '/tools')
      return sendJson(res, 200, { tools: toolRecords });
    if (req.method !== 'POST' || path !== '/call')
      return sendJson(res, 404, { error: 'Not found' });
    let body;
    try {
      body = await readJson(req, 64 * 1024);
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON' });
    }
    const name = String(body?.name || '');
    if (!toolRecords.some((tool) => tool.name === name))
      return sendJson(res, 404, { error: `Unknown tool ${name}` });
    const callId = randomUUID();
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        chat.pending.delete(callId);
        resolve({ ok: false, error: 'The app did not answer in time' });
      }, TOOL_CALL_TIMEOUT_MS);
      chat.pending.set(callId, {
        timer,
        resolve: (value) => {
          chat.pending.delete(callId);
          resolve(value);
        },
      });
      chat.write({
        type: 'tool_call',
        callId,
        name,
        args: body?.args && typeof body.args === 'object' ? body.args : {},
      });
    });
    return sendJson(res, 200, { text: truncateResult(result) });
  }

  function dispose() {
    for (const chat of [...chats.values()]) closeChat(chat, 'Server closing');
  }

  return { handleChat, handleResult, handleBridge, dispose };
}
