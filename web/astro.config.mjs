import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Sitemap is generated at build time via @astrojs/sitemap. Output targets
// ../docs for GitHub Pages, matching the ai-chat-exporter website architecture.
export default defineConfig({
  site: 'https://decant.covai.org',
  integrations: [sitemap()],
  outDir: '../docs',
  build: {
    format: 'file',
    inlineStylesheets: 'always',
    emptyOutDir: true,
  },
});
