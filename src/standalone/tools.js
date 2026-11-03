import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { isEmbedded } from '../app/embed.js';
import { initClaudeChat } from '../claudeChat/chatPanel.js';
import { startStandaloneChrome } from './startupChrome.js';
import { loadToolCatalog } from './toolCatalog.js';
export function createStandaloneTools(options) {
  const tools = createApplicationTools({
    startChrome: startStandaloneChrome,
    sceneDataPacks: {
      sources: {
        assets: createAssetDirectorySource({
          // A panel names the app's address; see src/tools/globePanel.js.
          baseUrl: new URL(
            '/scene-assets/',
            globalThis.GEV_APP_BASE_URL ?? document.baseURI,
          ).href,
        }),
      },
    },
    ...options,
    voice: {
      supportedProviders: ['openai', 'gemini'],
      panel: true,
      toolCatalog: loadToolCatalog,
      ...options?.voice,
    },
  });
  // The Claude chat runs tools through the voice runner; embeds have no chat.
  if (!isEmbedded()) {
    const chat = initClaudeChat({
      run: (name, args, runOptions) =>
        tools.voiceCommands.runner(name, args, runOptions),
    });
    options?.defer?.(() => chat.destroy());
  }
  return tools;
}
