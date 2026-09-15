/**
 * Utility for handing off decanted Markdown content to AI chat platforms.
 * Supports 12 platforms: ChatGPT, Claude, Gemini, DeepSeek, Perplexity,
 * Qwen, Mistral, Lumo, Copilot, Meta AI, Z.ai, and Grok.
 */

import { TRANSFER_TARGETS } from './transfer/targets.js';

export const AI_PLATFORMS = Object.fromEntries(
  TRANSFER_TARGETS.map((t) => [t.id, { name: t.label, url: t.url }]),
);

export {
  TRANSFER_TARGETS,
  TRANSFER_TARGET_IDS,
  PLATFORM_URLS,
  getTransferTarget,
  isSupportedTransferTarget,
} from './transfer/targets.js';

export function buildAiPrompt({ title, url, content, template }) {
  if (template && template.trim().length > 0) {
    return template
      .replace(/\{\{title\}\}/g, title || '')
      .replace(/\{\{url\}\}/g, url || '')
      .replace(/\{\{content\}\}/g, content || '');
  }

  return `Please analyze and summarize the key takeaways from this web article:\n\nTitle: ${title || 'Untitled'}\nSource: ${url || ''}\n\n${content || ''}`;
}

export function getAiPlatformUrl(target = 'chatgpt') {
  return AI_PLATFORMS[target]?.url || AI_PLATFORMS.chatgpt.url;
}
