import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  detectPlatform,
  parsers,
  isAiChatUrl,
  extractArticleIntelligent,
  convertToMarkdown,
} from 'decant-core';
import { DEFAULT_OPTIONS } from '../src/shared/storage.js';
import { formatMarkdown, sanitizeFilename, normalizeLatexMath } from '../src/shared/formatter.js';
import { pollTransferInject } from '../src/shared/transfer/injector.js';
import {
  loadTransferRecord,
  loadTransferRecordByKey,
  clearTransferRecord,
} from '../src/shared/transfer/records.js';
import { logger } from '../src/shared/logger.js';

async function extractAiChat(options = DEFAULT_OPTIONS) {
  if (!isAiChatUrl(window.location.href)) return null;
  const platform = detectPlatform(window.location.href);
  if (!platform) return null;

  const ParserClass = parsers.find((p) => p.platform === platform);
  if (!ParserClass) return null;

  try {
    const parser = new ParserClass();
    if (!parser.canParse(window.location.href)) return null;

    const result = await parser.parse();
    if (!result) return null;

    const mdBody = (result.messages || [])
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = typeof m.content === 'string' ? normalizeLatexMath(m.content.trim()) : '';
        return `**${role}:**\n\n${content}`;
      })
      .join('\n\n---\n\n');

    const htmlCards = (result.messages || [])
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = typeof m.content === 'string' ? normalizeLatexMath(m.content.trim()) : '';
        const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const paragraphs = escaped
          .split(/\n\n+/)
          .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
          .join('\n');
        return `<section class="chat-turn chat-${role.toLowerCase()}"><h2>${role}</h2>${paragraphs}</section>`;
      })
      .join('\n<hr/>\n');

    const parsedArticle = {
      title: result.title || `${platform} Chat`,
      byline: '',
      dir: '',
      excerpt: '',
      siteName: platform,
      publishedTime: '',
      url: window.location.href,
      content: mdBody,
      htmlContent: htmlCards,
    };

    const formattedMarkdown = formatMarkdown(parsedArticle, options);
    const baseFilename = sanitizeFilename(parsedArticle.title);

    return {
      ...parsedArticle,
      markdown: formattedMarkdown,
      filename: `${baseFilename}.md`,
      baseFilename,
    };
  } catch (err) {
    logger.error('ContentScript', 'AI chat extraction failed:', err);
    return null;
  }
}

export async function extractArticle(options = DEFAULT_OPTIONS) {
  logger.log('ContentScript', 'Starting article extraction with options:', options);

  const turndownOptions = {
    headingStyle: options.headingStyle || 'atx',
    bulletListMarker: options.bulletListMarker || '-',
    codeBlockStyle: options.codeBlockStyle || 'fenced',
    fence: options.fenceSymbol || '```',
  };

  const article = await extractArticleIntelligent(document, {
    url: window.location.href,
    turndownOptions,
  });

  const title = article?.title || document.title || 'Untitled';
  const htmlContent = article?.htmlContent || document.body?.innerHTML || '';
  let markdownBody = article?.content ? article.content.trim() : '';

  // Fallback: If Readability stripped all content (e.g. job boards, app shells, catalogs),
  // extract from main/article/body directly.
  if (!markdownBody && document.body) {
    logger.info(
      'ContentScript',
      'Intelligent extraction yielded empty content, falling back to main container…',
    );
    const container =
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.querySelector('#main-content, #content, [role="main"]') ||
      document.body;

    if (container) {
      const clone = container.cloneNode(true);
      const toRemove = clone.querySelectorAll(
        'script, style, noscript, svg, nav, footer, header, iframe',
      );
      toRemove.forEach((el) => el.remove());
      const fallbackHtml = clone.innerHTML || '';
      markdownBody = convertToMarkdown(fallbackHtml, turndownOptions).trim();
    }
  }

  logger.log('ContentScript', 'Extracted title:', title, '| HTML length:', htmlContent?.length);
  logger.log('ContentScript', 'Converted Markdown body length:', markdownBody?.length);

  const parsedArticle = {
    title,
    byline: article?.author || '',
    dir: '',
    excerpt: article?.description || '',
    siteName: article?.siteName || '',
    publishedTime: article?.published || '',
    url: article?.url || window.location.href,
    content: markdownBody,
    htmlContent,
  };

  const formattedMarkdown = formatMarkdown(parsedArticle, options);
  const baseFilename = sanitizeFilename(title);

  return {
    ...parsedArticle,
    markdown: formattedMarkdown,
    filename: `${baseFilename}.md`,
    baseFilename,
  };
}

export async function checkAndInjectContinuation(nudgeKey) {
  try {
    const { browser } = await import('wxt/browser');
    if (!browser.storage || !browser.storage.local) return;
    const recordInfo = nudgeKey
      ? await loadTransferRecordByKey(browser.storage.local, nudgeKey, window.location)
      : await loadTransferRecord(browser.storage.local, window.location);
    if (!recordInfo || !recordInfo.payload) return;

    const { keys, record, payload } = recordInfo;
    const env = {
      document,
      isTopFrame: window.top === window,
      clipboardWrite: async (text) => {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
          throw new Error('Clipboard API unavailable.');
        }
        await navigator.clipboard.writeText(text);
      },
    };

    const result = await pollTransferInject(
      env,
      {
        payload,
        targetPlatform: record.targetPlatform,
        autoSend: record.autoSend !== false,
      },
      { maxWaitMs: 15000, pollMs: 500 },
    );

    if (result.ok) {
      await clearTransferRecord(browser.storage.local, keys);
      logger.info('ContentScript', 'Successfully injected transfer prompt into AI chat.');
      showDecantToast(
        result.autoSent ? 'Decanted & prompt submitted!' : 'Decanted & prompt populated!',
      );
    } else if (result.reason === 'blocked') {
      showDecantToast(
        result.clipboardBackup
          ? 'Notice: dialog blocking prompt entry. Copied to clipboard.'
          : 'Notice: dialog blocking prompt entry. Clipboard backup failed.',
      );
    }
  } catch (e) {
    logger.warn('ContentScript', 'Continuation injection check failed:', e);
  }
}

export function showDecantToast(message = 'Decanted to clipboard!') {
  try {
    if (!document.body) return;

    let host = document.getElementById('decant-toast-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'decant-toast-root';
      host.style.position = 'fixed';
      host.style.top = '24px';
      host.style.right = '24px';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      document.body.appendChild(host);
    }

    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });

    // Inject shared styles if not already present in shadowRoot
    if (!shadow.querySelector('style')) {
      const style = document.createElement('style');
      style.textContent = `
        .decant-toast {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid #334155;
          border-left: 4px solid #8b5cf6;
          padding: 12px 18px;
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.4;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
          transform: translateY(-12px);
          opacity: 0;
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
          pointer-events: auto;
          margin-bottom: 8px;
        }
        .decant-toast.show {
          transform: translateY(0);
          opacity: 1;
        }
        .decant-toast-icon {
          font-size: 16px;
        }
        .decant-toast-msg {
          color: #f8fafc;
        }
      `;
      shadow.appendChild(style);
    }

    const toast = document.createElement('div');
    toast.className = 'decant-toast';
    toast.innerHTML = `
      <span class="decant-toast-icon">🍷</span>
      <span class="decant-toast-msg">${message}</span>
    `;

    shadow.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
        if (shadow.querySelectorAll('.decant-toast').length === 0 && host.parentNode) {
          host.remove();
        }
      }, 300);
    }, 2200);
  } catch (err) {
    logger.warn('ContentScript', 'Failed to display toast:', err);
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_end',
  main(ctx) {
    logger.info('ContentScript', 'Decant content script loaded on:', window.location.href);

    // Message Listener
    ctx.addEventListener(document, 'message:#DECANT', () => {
      // Custom event listener if needed
    });

    // Global flag to prevent duplicate event listener registrations on dynamic injection
    if (!window.__DECANT_LOADED__) {
      window.__DECANT_LOADED__ = true;

      // Import browser at runtime (not at module top level for content scripts)
      import('wxt/browser').then(({ browser }) => {
        browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
          logger.log('ContentScript', 'Received message:', request);

          if (request.action === 'PING') {
            sendResponse({ status: 'pong' });
            return true;
          }

          if (request.action === 'SHOW_TOAST') {
            showDecantToast(request.message || 'Decanted to clipboard!');
            sendResponse({ status: 'success' });
            return true;
          }

          if (request.action === 'COPY_TO_CLIPBOARD') {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard
                .writeText(request.text || '')
                .then(() => {
                  showDecantToast(request.message || 'Decanted to clipboard!');
                  sendResponse({ status: 'success' });
                })
                .catch((err) => sendResponse({ status: 'error', error: err?.message }));
            } else {
              sendResponse({ status: 'error', error: 'Clipboard API unavailable' });
            }
            return true;
          }

          if (request.action === 'NUDGE_TRANSFER_INJECT') {
            checkAndInjectContinuation(request.key);
            sendResponse({ status: 'success' });
            return true;
          }

          if (request.action === 'EXTRACT_MARKDOWN') {
            if (window !== window.top) {
              return false;
            }
            (async () => {
              try {
                const aiResult = await extractAiChat(request.options || DEFAULT_OPTIONS);
                const result =
                  aiResult || (await extractArticle(request.options || DEFAULT_OPTIONS));
                logger.info('ContentScript', 'Extraction successful for:', result.title);
                sendResponse({ status: 'success', data: result });
              } catch (err) {
                logger.error('ContentScript', 'Extraction failed:', err);
                sendResponse({ status: 'error', error: err.message });
              }
            })();
            return true;
          }
        });
      });

      checkAndInjectContinuation();
    }
  },
});
