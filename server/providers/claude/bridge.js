/**
 * MCP bridge for the Claude chat (see chat.js). Claude Code starts it over
 * stdio for one chat turn; it lists the voice tools and forwards each call
 * to the app server, which hands it to the browser and waits for the result.
 *
 * Configured only through the environment the chat writes into its MCP
 * config: GEV_CLAUDE_API_BASE, GEV_CLAUDE_CHAT_ID, GEV_CLAUDE_CHAT_TOKEN.
 */

import { fileURLToPath } from 'node:url';
import { serveStdio } from '../../mcp/stdio.js';

const PROTOCOL_VERSION = '2025-06-18';

/** A JSON-RPC handler that forwards tools to the app server. */
export function createBridgeServer({
  apiBase,
  chatId,
  token,
  fetchImpl = fetch,
}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Gev-Chat-Id': chatId,
    'X-Gev-Chat-Token': token,
  };
  let toolList = null;

  async function listTools() {
    if (toolList) return toolList;
    const response = await fetchImpl(`${apiBase}/api/claude/bridge/tools`, {
      headers,
    });
    if (!response.ok) throw new Error(`tools HTTP ${response.status}`);
    toolList = (await response.json()).tools || [];
    return toolList;
  }

  async function callTool(name, args, signal) {
    const response = await fetchImpl(`${apiBase}/api/claude/bridge/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, args: args ?? {} }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        content: [
          { type: 'text', text: payload.error || `HTTP ${response.status}` },
        ],
        isError: true,
      };
    return { content: [{ type: 'text', text: String(payload.text ?? '') }] };
  }

  async function handle(message, { signal } = {}) {
    const { id, method, params } = message || {};
    // Notifications get no response.
    if (id === undefined || id === null) return null;
    try {
      let result;
      if (method === 'initialize')
        result = {
          protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'gods-eye-view-chat', version: '1.0.0' },
        };
      else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools: await listTools() };
      else if (method === 'tools/call')
        result = await callTool(params?.name, params?.arguments, signal);
      else
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error.message },
      };
    }
  }

  return { handle };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createBridgeServer({
    apiBase: process.env.GEV_CLAUDE_API_BASE || 'http://localhost:4173',
    chatId: process.env.GEV_CLAUDE_CHAT_ID || '',
    token: process.env.GEV_CLAUDE_CHAT_TOKEN || '',
  });
  await serveStdio(server, {
    input: process.stdin,
    output: process.stdout,
    log: (line) => console.error(`<- ${line}`),
  });
}
