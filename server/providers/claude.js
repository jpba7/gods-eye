import { sameSiteGated } from './common/same-site.js';
import { createClaudeChat } from './claude/chat.js';

/**
 * Vite plugin: text chat with Claude through the local Claude Code CLI, which
 * uses this machine's Claude sign-in. See server/providers/claude/chat.js.
 */
function claudeChatProxy({ tools = [] } = {}) {
  function install(server) {
    const chat = createClaudeChat({
      tools,
      apiBase: () => {
        const address = server.httpServer?.address?.();
        const port =
          address && typeof address === 'object'
            ? address.port
            : process.env.PORT || 4173;
        return `http://localhost:${port}`;
      },
    });
    // The chat spends the person's Claude plan: refuse cross-site browsers.
    server.middlewares.use(
      '/api/claude/chat/result',
      sameSiteGated(chat.handleResult),
    );
    server.middlewares.use('/api/claude/chat', sameSiteGated(chat.handleChat));
    server.middlewares.use(
      '/api/claude/bridge',
      sameSiteGated(chat.handleBridge),
    );
    server.httpServer?.once('close', chat.dispose);
  }

  return {
    name: 'claude-chat-proxy',
    configureServer: install,
    configurePreviewServer: install,
  };
}

export { claudeChatProxy };
