import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { getOptions } from '../../src/shared/storage.js';
import {
  getAiPlatformUrl,
  getTransferTarget,
  buildAiPrompt,
} from '../../src/shared/ai-transfer.js';
import {
  MAX_CHUNKS,
  chunkKey,
  expiredTransferKeys,
  splitPayload,
  transferKey,
} from '../../src/shared/transfer/records.js';
import { logger } from '../../src/shared/logger.js';
import { getMessage } from '../../src/shared/i18n.js';
import { clipAllTabs, downloadFile } from '../../src/shared/batch-clipper.js';

const UNINSTALL_URL = 'https://decant.covai.org/uninstall-feedback.html';
const WELCOME_URL = 'https://decant.covai.org/welcome.html';
const TRANSFER_CLEANUP_ALARM = 'prune-transfer-records';
const TRANSFER_CLEANUP_PERIOD_MINUTES = 5;

export default defineBackground({
  type: 'module',
  main() {
    logger.info('Background', 'Decant Background Service Worker initialized.');

    const extVersion = browser.runtime.getManifest?.()?.version;
    const uninstallUrl = extVersion ? `${UNINSTALL_URL}?v=${extVersion}` : UNINSTALL_URL;
    browser.runtime.setUninstallURL(uninstallUrl);

    async function setupContextMenus() {
      if (!browser.contextMenus) return;

      const options = await getOptions();
      const target = options.defaultAiTarget || 'chatgpt';

      browser.contextMenus.removeAll(() => {
        const copyTitle = getMessage('contextMenuCopy', 'Copy to Markdown');
        const saveTitle = getMessage('contextMenuSave', 'Save to Markdown');
        const clipAllTitle = getMessage('contextMenuClipAll', 'Clip All Tabs in Window');

        browser.contextMenus.create({
          id: 'decant-copy',
          title: copyTitle,
          contexts: ['page', 'selection'],
        });

        browser.contextMenus.create({
          id: 'decant-save',
          title: saveTitle,
          contexts: ['page', 'selection'],
        });

        browser.contextMenus.create({
          id: 'decant-clip-all',
          title: clipAllTitle,
          contexts: ['page'],
        });

        if (target && target !== 'none') {
          const targetObj = getTransferTarget(target);
          const targetName = targetObj ? targetObj.label : 'ChatGPT';
          const transferTitle = getMessage('contextMenuTransferToAi', `Send to ${targetName}`, [
            targetName,
          ]);
          browser.contextMenus.create({
            id: 'decant-transfer-ai',
            title: transferTitle,
            contexts: ['page', 'selection'],
          });
        }
      });
    }

    async function injectContentScriptIntoOpenTabs() {
      try {
        const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
        for (const tab of tabs) {
          if (tab.id && !tab.discarded) {
            browser.scripting
              ?.executeScript({
                target: { tabId: tab.id },
                files: ['content-scripts/content.js'],
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        logger.debug('Background', 'Could not pre-inject content scripts:', err);
      }
    }

    // Setup Context Menus & Onboarding
    browser.runtime.onInstalled.addListener(async (details) => {
      logger.info('Background', 'Extension event details:', details.reason);

      if (details.reason === 'install') {
        browser.tabs.create({ url: WELCOME_URL });
      }

      await setupContextMenus();
      await injectContentScriptIntoOpenTabs();
    });

    if (browser.runtime.onStartup) {
      browser.runtime.onStartup.addListener(async () => {
        await setupContextMenus();
      });
    }

    if (browser.storage?.onChanged) {
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' || areaName === 'local') {
          if (changes.options || changes.defaultAiTarget) {
            setupContextMenus();
          }
        }
      });
    }

    // Handle Context Menu clicks
    browser.contextMenus.onClicked.addListener(async (info, tab) => {
      if (!tab || !tab.id) return;
      logger.info('Background', 'Context menu clicked:', info.menuItemId, '| Tab:', tab.id);
      const options = await getOptions();

      if (info.menuItemId === 'decant-copy') {
        copyTabToClipboard(tab.id, options);
      } else if (info.menuItemId === 'decant-save') {
        clipTab(tab.id, options);
      } else if (info.menuItemId === 'decant-clip-all') {
        handleBatchClip(tab.windowId, options, 'zip');
      } else if (info.menuItemId === 'decant-transfer-ai') {
        handleTransferContextMenu(tab, options, info);
      }
    });

    // Handle Keyboard Commands
    browser.commands.onCommand.addListener(async (command, tab) => {
      if (!tab || !tab.id) return;
      logger.info('Background', 'Command triggered:', command, '| Tab:', tab.id);
      const options = await getOptions();

      if (command === 'clip_tab_as_markdown') {
        clipTab(tab.id, options);
      } else if (command === 'copy_tab_as_markdown') {
        copyTabToClipboard(tab.id, options);
      } else if (command === 'clip_all_tabs') {
        handleBatchClip(tab.windowId, options, 'zip');
      }
    });

    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab?.url) {
        browser.tabs
          .sendMessage(tabId, { action: 'NUDGE_TRANSFER_INJECT', key: `xfer_${tabId}` })
          .catch(() => {});
      }
    });

    async function handleTransferContextMenu(tab, options, info = {}) {
      try {
        const target = options.defaultAiTarget || 'chatgpt';
        const targetFrameId = typeof info.frameId === 'number' ? info.frameId : undefined;
        const sendOptions = targetFrameId !== undefined ? { frameId: targetFrameId } : undefined;

        let selectedText = info.selectionText ? info.selectionText.trim() : '';

        // If info.selectionText is empty, query content script in tab/frame
        if (!selectedText && tab && tab.id !== undefined) {
          try {
            const selRes = await browser.tabs.sendMessage(
              tab.id,
              { action: 'GET_CURRENT_SELECTION' },
              sendOptions,
            );
            if (selRes && selRes.success && typeof selRes.selection === 'string') {
              selectedText = selRes.selection.trim();
            }
          } catch {
            if (targetFrameId && targetFrameId !== 0) {
              try {
                const topRes = await browser.tabs.sendMessage(
                  tab.id,
                  { action: 'GET_CURRENT_SELECTION' },
                  { frameId: 0 },
                );
                if (topRes && topRes.success && typeof topRes.selection === 'string') {
                  selectedText = topRes.selection.trim();
                }
              } catch {
                // Ignore
              }
            }
          }
        }

        let payload = '';
        if (selectedText && selectedText.length > 0) {
          const effectiveUrl = info.frameUrl || info.pageUrl || tab.url || '';
          payload = buildAiPrompt({
            title: tab.title || 'Selected Text',
            url: effectiveUrl,
            content: selectedText,
            template: options.aiPromptTemplate,
          });
        } else {
          let response = await sendMessageToTab(
            tab.id,
            { action: 'EXTRACT_MARKDOWN', options },
            1,
            50,
          );
          if (!response) {
            await browser.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content-scripts/content.js'],
            });
            response = await sendMessageToTab(
              tab.id,
              { action: 'EXTRACT_MARKDOWN', options },
              5,
              100,
            );
          }
          if (response && response.status === 'success' && response.data) {
            payload = buildAiPrompt({
              title: response.data.title || tab.title || '',
              url: response.data.url || tab.url || '',
              content: response.data.content || response.data.markdown || '',
              template: options.aiPromptTemplate,
            });
          }
        }

        if (payload) {
          if (options.transferCopyToClipboard !== false && tab?.id !== undefined) {
            try {
              await browser.tabs.sendMessage(
                tab.id,
                { action: 'COPY_TO_CLIPBOARD', text: payload, message: false },
                sendOptions,
              );
            } catch {
              // Ignore
            }
          }
          await performTransfer(target, payload, tab.title || 'Decanted Article', true);
        }
      } catch (err) {
        logger.error('Background', 'Transfer from context menu failed:', err);
      }
    }

    async function handleBatchClip(windowId, options, mode = 'zip') {
      try {
        logger.info(
          'Background',
          `Starting batch tab clipping for window: ${windowId}, mode: ${mode}`,
        );
        const result = await clipAllTabs(options, mode, windowId, (processed, total, title) => {
          browser.runtime
            .sendMessage({
              action: 'BATCH_PROGRESS',
              processed,
              total,
              title,
            })
            .catch(() => {
              // Popup might be closed, which is fine
            });
        });

        browser.runtime
          .sendMessage({
            action: 'BATCH_COMPLETE',
            result,
          })
          .catch(() => {});

        logger.info('Background', 'Batch tab clipping completed successfully:', result);
      } catch (err) {
        logger.error('Background', 'Batch tab clipping failed:', err);
        browser.runtime
          .sendMessage({
            action: 'BATCH_ERROR',
            error: err.message,
          })
          .catch(() => {});
      }
    }

    async function clipTab(tabId, options) {
      try {
        let response = await sendMessageToTab(
          tabId,
          { action: 'EXTRACT_MARKDOWN', options },
          1,
          50,
        );

        if (!response) {
          logger.info('Background', 'Injecting content script dynamically into tab:', tabId);
          await browser.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/content.js'],
          });
          response = await sendMessageToTab(tabId, { action: 'EXTRACT_MARKDOWN', options }, 5, 100);
        }

        if (response && response.status === 'success') {
          logger.info(
            'Background',
            'Clipping tab successful. Downloading:',
            response.data.filename,
          );
          downloadMarkdown(response.data.filename, response.data.markdown);
        } else {
          logger.error('Background', 'Tab clipping failed:', response?.error);
        }
      } catch (err) {
        logger.error('Background', 'Error clipping tab:', err);
      }
    }

    async function copyTabToClipboard(tabId, options) {
      try {
        let response = await sendMessageToTab(
          tabId,
          { action: 'EXTRACT_MARKDOWN', options },
          1,
          50,
        );

        if (!response) {
          await browser.scripting.executeScript({
            target: { tabId },
            files: ['content-scripts/content.js'],
          });
          response = await sendMessageToTab(tabId, { action: 'EXTRACT_MARKDOWN', options }, 5, 100);
        }

        if (response && response.status === 'success') {
          logger.info('Background', 'Copying markdown to clipboard...');
          await sendMessageToTab(
            tabId,
            {
              action: 'COPY_TO_CLIPBOARD',
              text: response.data.markdown,
            },
            2,
            50,
          );
        }
      } catch (err) {
        logger.error('Background', 'Error copying tab to clipboard:', err);
      }
    }

    async function performTransfer(target, payload, title = 'Decanted Article', autoSend = true) {
      const uriAppTargets = ['obsidian', 'logseq', 'bear', 'noteplan', 'drafts'];
      if (uriAppTargets.includes(target)) {
        const syncData = await browser.storage.sync.get('obsidianVault');
        const vault = syncData.obsidianVault || '';
        const cleanTitle =
          title
            .replace(/[#|^[\]]/g, '')
            .replace(/[/\\?%*:|"<>]/g, '')
            .trim()
            .slice(0, 245) || 'Clipped Article';

        let appUri = '';
        if (target === 'obsidian') {
          const params = new URLSearchParams();
          params.append('name', cleanTitle);
          if (vault && vault.trim().length > 0) params.append('vault', vault.trim());
          if (payload) params.append('content', payload);
          appUri = `obsidian://new?${params.toString()}`;
        } else if (target === 'logseq') {
          const params = new URLSearchParams();
          params.append('page', cleanTitle);
          if (payload) params.append('content', payload);
          appUri = `logseq://x-callback-url/quickCapture?${params.toString()}`;
        } else if (target === 'bear') {
          const params = new URLSearchParams();
          params.append('title', cleanTitle);
          if (payload) params.append('text', payload);
          appUri = `bear://x-callback-url/create?${params.toString()}`;
        } else if (target === 'noteplan') {
          const params = new URLSearchParams();
          params.append('noteTitle', cleanTitle);
          if (payload) params.append('text', payload);
          appUri = `noteplan://x-callback-url/addText?${params.toString()}`;
        } else if (target === 'drafts') {
          const params = new URLSearchParams();
          const fullText = cleanTitle ? `# ${cleanTitle}\n\n${payload}` : payload;
          params.append('text', fullText);
          appUri = `drafts://x-callback-url/create?${params.toString()}`;
        }

        await browser.tabs.create({ url: appUri });
        return { success: true, uri: appUri };
      }

      const url = getAiPlatformUrl(target);
      const newTab = await browser.tabs.create({ url });
      const base = {
        targetPlatform: target,
        url,
        timestamp: Date.now(),
        autoSend,
      };

      if (newTab && newTab.id !== undefined) {
        const chunks = splitPayload(payload);
        if (chunks.length > MAX_CHUNKS) {
          throw new Error('Transfer payload is too large.');
        }
        const key = transferKey(newTab.id);
        const entries = {};
        if (chunks.length > 1) {
          entries[key] = { ...base, chunked: true, count: chunks.length };
          chunks.forEach((chunk, index) => {
            entries[chunkKey(newTab.id, index)] = chunk;
          });
        } else {
          entries[key] = { ...base, payload };
        }
        await browser.storage.local.set(entries);
        browser.tabs
          .sendMessage(newTab.id, { action: 'NUDGE_TRANSFER_INJECT', key })
          .catch(() => {});
        pruneTransferKeys();
      } else {
        await browser.storage.local.set({ pendingContinuation: { ...base, payload } });
      }

      return { success: true, tabId: newTab?.id };
    }

    async function pruneTransferKeys() {
      try {
        const dump = await browser.storage.local.get(null);
        const dead = expiredTransferKeys(dump);
        if (dead.length > 0) {
          await browser.storage.local.remove(dead);
        }
      } catch {
        // ignore
      }
    }

    pruneTransferKeys();
    if (browser.alarms) {
      browser.alarms.create(TRANSFER_CLEANUP_ALARM, {
        periodInMinutes: TRANSFER_CLEANUP_PERIOD_MINUTES,
      });
      browser.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === TRANSFER_CLEANUP_ALARM) {
          pruneTransferKeys();
        }
      });
    }

    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TRANSFER_CHAT') {
        (async () => {
          try {
            const res = await performTransfer(
              request.targetPlatform,
              request.payload || '',
              request.title || 'Decanted Article',
              request.autoSend !== false,
            );
            sendResponse(res);
          } catch (e) {
            logger.error('Background', 'Transfer failed:', e);
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }

      if (request.action === 'BATCH_CLIP_TABS') {
        (async () => {
          try {
            const options = request.options || (await getOptions());
            const mode = request.mode || 'zip';
            const windowId = request.windowId || null;
            await handleBatchClip(windowId, options, mode);
            sendResponse({ success: true });
          } catch (e) {
            logger.error('Background', 'Batch clipping error:', e);
            sendResponse({ success: false, error: e.message });
          }
        })();
        return true;
      }
    });

    async function sendMessageToTab(tabId, message, maxRetries = 0, retryDelay = 100) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const res = await new Promise((resolve) => {
          browser.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
            if (browser.runtime.lastError) {
              browser.tabs.sendMessage(tabId, message, (fallbackRes) => {
                if (browser.runtime.lastError) {
                  if (attempt === maxRetries) {
                    logger.warn(
                      'Background',
                      'sendMessage lastError:',
                      browser.runtime.lastError.message,
                    );
                  }
                  resolve(null);
                } else {
                  resolve(fallbackRes);
                }
              });
            } else {
              resolve(response);
            }
          });
        });
        if (res) return res;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
      return null;
    }

    async function downloadMarkdown(filename, content) {
      await downloadFile(content, filename, 'text/markdown');
    }
  },
});
