<div align="center">

# Decant 🍷

**The distraction-free web clipper and research batcher.**

_Decant articles and web content into clean, structured Markdown, Word, HTML, and JSON with local extraction and zero telemetry._

[![Website](https://img.shields.io/badge/Website-decant.covai.org-blueviolet)](https://decant.covai.org/)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-red.svg)](LICENSE)
[![GitHub](https://img.shields.io/github/stars/Covai-Labs/decant-browser-extension?logo=github&logoColor=white&color=yellow&label=Stars)](https://github.com/Covai-Labs/decant-browser-extension)
[![Made with WXT](https://img.shields.io/badge/WXT-0.21-ff90e8)](https://wxt.dev)

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/gaedmbipeogpcddnoedpmjcemgcoboaa?logo=google-chrome&logoColor=white&label=Chrome%20Web%20Store&color=blue)](https://chromewebstore.google.com/detail/decant-web-to-markdown-cl/gaedmbipeogpcddnoedpmjcemgcoboaa)
[![Firefox Add-ons](https://img.shields.io/amo/v/decant?logo=firefox-browser&logoColor=white&label=Firefox%20Add-ons&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/decant/)

[![Chrome Users](https://img.shields.io/chrome-web-store/users/gaedmbipeogpcddnoedpmjcemgcoboaa?logo=google-chrome&logoColor=white&label=Chrome%20Users&color=blue)](https://chromewebstore.google.com/detail/decant-web-to-markdown-cl/gaedmbipeogpcddnoedpmjcemgcoboaa)
[![Firefox Users](https://img.shields.io/amo/users/decant?logo=firefox-browser&logoColor=white&label=Firefox%20Users&color=orange)](https://addons.mozilla.org/en-US/firefox/addon/decant/)

[Quick Install](#quick-install) • [Features](#key-features) • [Privacy & Permissions](#privacy--permissions) • [Development](#development) • [Contributing](#contributing)

---

Built natively for **Manifest V3** with [WXT](https://wxt.dev). Available for Chrome, Firefox, Edge, and Brave.

</div>

---

## Why Decant?

Most clippers either send your browsed content to a third-party server for "AI extraction", or wrap your page in heavy single-file dumps you can't actually reuse.

Decant goes the other way: it turns any page into **clean, structured Markdown you own** — fast, locally, and with a single click of the icon or a shortcut.

Key differentiators:

- **Multi-Tab Batch Clipper (`Alt+Shift+A`)** — ingest every open research tab into a single clean ZIP of structured Markdown files.
- **1-Click PKM hand-off** — direct URL-scheme triggers for Obsidian, Logseq, Bear, NotePlan, and Drafts with customizable YAML frontmatter.
- **Strictly local extraction** — Mozilla Readability runs on-device. Content leaves your machine only when you explicitly hand it off to an external destination, such as an AI service.

---

## Key Features

- 🗂️ **Multi-Tab Batch Clipper (`Alt+Shift+A`):** Clip all open tabs in the current window into one organized ZIP archive — individual Markdown files per tab. Ideal for research sessions, literature round-ups, and "save the whole reading list" moments.
- 📝 **Clean Markdown:** Extract articles and main content into clean, structured Markdown with proper headings, tables, code fences, and preserved links.
- 🔄 **1-Click PKM & AI Handoff:** Send clipped content straight into **Obsidian** (`obsidian://new`), **Logseq**, **Bear**, **NotePlan**, or **Drafts**, or hand off summaries into 12 AI chat platforms (ChatGPT, Claude, Gemini, DeepSeek, Perplexity, Qwen, Mistral, Lumo, Copilot, Meta AI, Z.ai, Grok).
- 👁️ **Live Preview Studio & Reader View:** Preview the decanted result in a clean reading view with **KaTeX** math rendering and **Prism** syntax highlighting across Dark, Light, and Solarized themes — before you save.
- 📊 **Export Format Matrix:** Download as **Markdown (`.md`)**, **HTML (`.html`)**, **Word (`.doc`)**, or **JSON (`.json`)**, or copy to clipboard.
- ⚡ **Side Panel & Shortcuts:** Clip, copy, and preview from the native Chromium side panel, plus keyboard shortcuts — `Alt+Shift+C` copy, `Alt+Shift+D` download, `Alt+Shift+A` batch clip.
- 🖱️ **Right-click menus:** Decant the page or text selection from the context menu, or send directly to your default AI platform.
- 🎨 **Custom Frontmatter & Formatting:** Configurable templates for metadata tags, page URLs, titles, and dates.
- 🔒 **100% Private & Local:** All parsing happens on-device in your browser. Zero tracking or telemetry. See [Privacy](#privacy).

---

## Quick Install

- **Chrome / Brave / Edge:** [Add to Chrome](https://chromewebstore.google.com/detail/decant-web-to-markdown-cl/gaedmbipeogpcddnoedpmjcemgcoboaa) or load the unpacked build (`.output/chrome-mv3`).
- **Firefox:** [Get it for Firefox](https://addons.mozilla.org/en-US/firefox/addon/decant/) or load the temporary add-on from `.output/firefox-mv3/manifest.json` at `about:debugging#/runtime/this-firefox`.

> [!NOTE]
> Store listings are live; if the store build isn't available in your region yet, the unpacked builds below work identically.

<details>
<summary><b>📦 Manual / Unpacked Installation</b></summary>

1. Run `npm run build` (Chrome) or `npm run build:firefox` (Firefox).
2. **Chrome/Edge/Brave:** open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `.output/chrome-mv3` folder.
3. **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and select `manifest.json` inside `.output/firefox-mv3`.

</details>

---

## Privacy & Permissions

Decant keeps extraction and conversion local by design. Explicitly handing content off to an AI service shares it with the configured third-party provider.

**Zero Remote Processing:** All DOM extraction, markdown generation, LaTeX parsing, and article rendering occur entirely inside your local browser. Zero analytics, zero telemetry.

| Permission                        | Why it's needed                                                                                             |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `activeTab` / `scripting`         | Inject content scripts to extract the page only when you trigger a clip                                     |
| `tabs`                            | Enumerate and coordinate open tabs for the Multi-Tab Batch Clipper (`Alt+Shift+A`) and research aggregation |
| `host_permissions` (`<all_urls>`) | Read and decant articles from arbitrary web pages and embedded frames across any domain                     |
| `storage`                         | Save your local preferences (frontmatter template, format, PKM/AI target)                                   |
| `downloads`                       | Save `.md`, `.html`, `.doc`, `.json`, and `.zip` archives directly to your device                           |
| `clipboardWrite`                  | Copy Markdown directly to your clipboard                                                                    |
| `contextMenus`                    | Provide right-click "Decant to Markdown" and "Send to AI" menu options                                      |
| `sidePanel`                       | Power the persistent Chromium side panel reader and preview interface                                       |
| `alarms`                          | Clean up temporary inter-tab transfer records                                                               |

Decant has zero analytics endpoints. Extraction remains strictly on-device; content is sent off-device only when you explicitly trigger an AI hand-off or external PKM deep-link. Audit it yourself: [PRIVACY.md](PRIVACY.md) and [`wxt.config.ts`](wxt.config.ts).

---

## Export Formats

| Format      | Extension | Use case                                       |
| :---------- | :-------- | :--------------------------------------------- |
| Markdown    | `.md`     | Obsidian, Logseq, editors, AI prompts          |
| HTML        | `.html`   | Self-contained article snapshot                |
| Word        | `.doc`    | Docs/drafting workflows                        |
| JSON        | `.json`   | Programmatic / archival pipelines              |
| ZIP (batch) | `.zip`    | All open tabs → one organized research archive |

---

## Development

Local setup, build commands (WXT dev/build for Chrome & Firefox), store packaging, project
structure, and architecture notes live in [DEVELOPMENT.md](DEVELOPMENT.md).

## Contributing

Bug reports, feature ideas, and code contributions are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, parser/extraction guidelines, and CLA.

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See [LICENSE](LICENSE) for details.

### Test Fixtures Notice

Sample fixtures located in [`tests/fixtures/`](tests/fixtures/) are retained solely for automated regression testing and extraction verification under fair use principles. They are excluded from the project's AGPL-3.0 license. See [`tests/fixtures/README.md`](tests/fixtures/README.md) for details.

Acknowledgments: [decant-core](https://github.com/Covai-Labs/decant) — shared parsing engine; Mozilla Readability; Turndown + GFM; JSZip; WXT.
