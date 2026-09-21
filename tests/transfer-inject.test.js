import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';

import {
  TRANSFER_TARGETS,
  TRANSFER_TARGET_IDS,
  PLATFORM_URLS,
  getTransferTarget,
  isSupportedTransferTarget,
} from '../src/shared/transfer/targets.js';
import {
  findComposer,
  findBlocker,
  isVisible,
  verifyContent,
  attemptTransferInject,
  pollTransferInject,
} from '../src/shared/transfer/injector.js';
import {
  pickTransferRecord,
  splitPayload,
  joinChunkedRecord,
  expiredTransferKeys,
  transferKey,
  chunkKey,
  loadTransferRecord,
  loadTransferRecordByKey,
} from '../src/shared/transfer/records.js';

function docOf(html) {
  return parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`).document;
}

const okEnv = (document, seen = {}) => ({
  document,
  isTopFrame: true,
  clipboardWrite: async (text) => {
    seen.clipboard = text;
  },
});

// ── targets registry ──────────────────────────────────────────────

test('transfer targets: exactly the 12 supported AI chats', () => {
  assert.deepEqual(TRANSFER_TARGET_IDS, [
    'chatgpt',
    'claude',
    'gemini',
    'deepseek',
    'perplexity',
    'qwen',
    'mistral',
    'lumo',
    'copilot',
    'meta',
    'z_ai',
    'grok',
  ]);
  assert.equal(TRANSFER_TARGETS.length, 12);
});

test('transfer targets: platform URLs and lookup helpers', () => {
  assert.equal(PLATFORM_URLS.copilot, 'https://copilot.com/');
  assert.equal(PLATFORM_URLS.grok, 'https://grok.com/');
  assert.equal(PLATFORM_URLS.z_ai, 'https://chat.z.ai/');
  assert.ok(isSupportedTransferTarget('grok'));
  assert.ok(!isSupportedTransferTarget('bogus'));
  assert.equal(getTransferTarget('meta')?.label, 'Meta AI');
  assert.equal(getTransferTarget('meta')?.requiresAuth, true);
});

// ── records: keys & chunking ──────────────────────────────────────

test('records: transferKey and chunkKey formatting', () => {
  assert.equal(transferKey(42), 'xfer_42');
  assert.equal(chunkKey(42, 0), 'xfer_42_c0');
  assert.equal(chunkKey(42, 3), 'xfer_42_c3');
});

test('records: splitPayload splits on CHUNK_SIZE and round-trips', () => {
  const parts = splitPayload('a'.repeat(1500000));
  assert.equal(parts.length, 3);
  assert.equal(parts[0].length, 700000);
  assert.equal(parts[1].length, 700000);
  assert.equal(parts[2].length, 100000);
});

test('records: pickTransferRecord selects newest fresh matching origin', () => {
  const now = 1_000_000;
  const dump = {
    xfer_1: { url: 'https://chatgpt.com/', timestamp: now - 10000, payload: 'old' },
    xfer_2: { url: 'https://chatgpt.com/', timestamp: now - 1000, payload: 'new' },
    xfer_3: { url: 'https://claude.ai/', timestamp: now - 500, payload: 'claude' },
    xfer_expired: { url: 'https://chatgpt.com/', timestamp: now - 400000, payload: 'expired' },
  };

  const picked = pickTransferRecord(dump, 'https://chatgpt.com', now);
  assert.ok(picked);
  assert.equal(picked.key, 'xfer_2');
  assert.equal(picked.record.payload, 'new');

  const claudePicked = pickTransferRecord(dump, 'https://claude.ai', now);
  assert.equal(claudePicked.key, 'xfer_3');
});

test('records: expiredTransferKeys identifies dead records and chunk keys', () => {
  const now = 1_000_000;
  const dump = {
    xfer_1: { timestamp: now - 500000 },
    xfer_1_c0: 'chunk0',
    xfer_2: { timestamp: now - 1000 },
    xfer_2_c0: 'live_chunk',
  };

  const dead = expiredTransferKeys(dump, now);
  assert.ok(dead.includes('xfer_1'));
  assert.ok(dead.includes('xfer_1_c0'));
  assert.ok(!dead.includes('xfer_2'));
  assert.ok(!dead.includes('xfer_2_c0'));
});

// ── injector: composer finding ────────────────────────────────────

test('injector: finds chatgpt ProseMirror composer', () => {
  const doc = docOf('<div id="prompt-textarea" class="ProseMirror" contenteditable="true"></div>');
  const comp = findComposer(doc, 'chatgpt');
  assert.ok(comp);
  assert.equal(comp.id, 'prompt-textarea');
});

test('injector: finds deepseek textarea composer', () => {
  const doc = docOf('<textarea placeholder="Message DeepSeek"></textarea>');
  const comp = findComposer(doc, 'deepseek');
  assert.ok(comp);
  assert.equal(comp.tagName, 'TEXTAREA');
});

test('injector: finds claude contenteditable composer', () => {
  const doc = docOf('<div data-testid="chat-input" contenteditable="true"></div>');
  const comp = findComposer(doc, 'claude');
  assert.ok(comp);
  assert.equal(comp.getAttribute('data-testid'), 'chat-input');
});

test('injector: finds grok query-bar editor', () => {
  const doc = docOf('<div class="query-bar-editor" contenteditable="true"></div>');
  const comp = findComposer(doc, 'grok');
  assert.ok(comp);
});

test('injector: element without layout geometry is hidden unless fixed', () => {
  const makeElement = (position) => ({
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          display: 'block',
          visibility: 'visible',
          opacity: '1',
          position,
        }),
      },
    },
    offsetParent: null,
    getClientRects: () => [],
    getAttribute: () => null,
    hasAttribute: () => false,
  });

  assert.equal(isVisible(makeElement('static')), false);
  assert.equal(isVisible(makeElement('fixed')), true);
});

// ── injector: blocker finding ─────────────────────────────────────

test('injector: detects active modal dialog blocker', () => {
  const doc = docOf('<div role="dialog" aria-modal="true">Sign In</div>');
  const blocker = findBlocker(doc, null);
  assert.ok(blocker);
});

// ── injector: attemptTransferInject ───────────────────────────────

test('injector: attemptTransferInject populates textarea and writes clipboard backup', async () => {
  const doc = docOf('<textarea placeholder="Message DeepSeek"></textarea>');
  const seen = {};
  const env = okEnv(doc, seen);

  const res = await attemptTransferInject(env, {
    payload: 'Hello from Decant transfer!',
    targetPlatform: 'deepseek',
    autoSend: false,
  });

  assert.equal(res.ok, true);
  assert.equal(seen.clipboard, 'Hello from Decant transfer!');
  const ta = doc.querySelector('textarea');
  assert.equal(ta.value, 'Hello from Decant transfer!');
});

test('records: joinChunkedRecord reconstructs full string from parts', () => {
  const dump = {
    xfer_10: { chunked: true, count: 2 },
    xfer_10_c0: 'hello ',
    xfer_10_c1: 'world',
  };
  assert.equal(joinChunkedRecord(dump, 'xfer_10', dump.xfer_10), 'hello world');
});

test('injector: verifyContent matches normalized text', () => {
  const doc = docOf('<textarea>  hello    world  </textarea>');
  const ta = doc.querySelector('textarea');
  assert.equal(verifyContent(ta, 'hello world'), true);
  assert.equal(verifyContent(ta, 'goodbye'), false);
  assert.equal(verifyContent(ta, 'hello'), false);
});

test('injector: generic composer match disables auto-send', async () => {
  const doc = docOf('<div contenteditable="true" role="textbox"></div>');
  const res = await attemptTransferInject(okEnv(doc), {
    payload: 'Do not submit this',
    targetPlatform: 'chatgpt',
    autoSend: true,
  });

  assert.equal(res.ok, true);
  assert.equal(res.autoSent, false);
  assert.equal(res.autoSendSkipped, 'generic-composer');
});

test('records: unkeyed load reads only legacy pendingContinuation', async () => {
  const calls = [];
  const storage = {
    async get(key) {
      calls.push(key);
      return {
        pendingContinuation: {
          url: 'https://chatgpt.com/',
          timestamp: 999_000,
          payload: 'legacy',
        },
      };
    },
  };

  const loaded = await loadTransferRecord(storage, { origin: 'https://chatgpt.com' }, 1_000_000);
  assert.equal(loaded.payload, 'legacy');
  assert.deepEqual(calls, ['pendingContinuation']);
});

test('records: keyed load retrieves only its base record and chunk keys', async () => {
  const calls = [];
  const storage = {
    async get(key) {
      calls.push(key);
      if (key === 'xfer_7') {
        return {
          xfer_7: {
            url: 'https://chatgpt.com/',
            timestamp: 999_000,
            chunked: true,
            count: 2,
          },
        };
      }
      return { xfer_7_c0: 'hello ', xfer_7_c1: 'world' };
    },
  };

  const loaded = await loadTransferRecordByKey(
    storage,
    'xfer_7',
    { origin: 'https://chatgpt.com' },
    1_000_000,
  );
  assert.equal(loaded.payload, 'hello world');
  assert.deepEqual(calls, ['xfer_7', ['xfer_7_c0', 'xfer_7_c1']]);
});

test('injector: attemptTransferInject rejects on non-top frame', async () => {
  const env = { document: docOf('<div></div>'), isTopFrame: false };
  const res = await attemptTransferInject(env, { payload: 'abc', targetPlatform: 'chatgpt' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-top-frame');
});

test('injector: pollTransferInject succeeds when composer is present', async () => {
  const doc = docOf('<textarea placeholder="Message DeepSeek"></textarea>');
  const env = okEnv(doc);
  const res = await pollTransferInject(
    env,
    { payload: 'poll text', targetPlatform: 'deepseek', autoSend: false },
    { maxWaitMs: 1000, pollMs: 50 },
  );
  assert.equal(res.ok, true);
  assert.equal(res.attempts, 1);
});

test('attemptTransferInject: fills a contenteditable composer with multi-line payload', async () => {
  const doc = docOf('<div data-testid="chat-input" contenteditable="true" role="textbox"></div>');
  const multiLine = 'Here is line 1\n\nHere is line 2\nHere is line 3';
  const res = await attemptTransferInject(okEnv(doc), {
    payload: multiLine,
    targetPlatform: 'claude',
    autoSend: false,
  });
  assert.equal(res.ok, true);
  assert.ok(verifyContent(doc.querySelector('[data-testid="chat-input"]'), multiLine));
});

test('injector: pollTransferInject retries on verify-failed before giving up', async () => {
  let attemptCount = 0;
  const doc = docOf('<textarea placeholder="Message DeepSeek"></textarea>');
  const textarea = doc.querySelector('textarea');
  const env = {
    document: doc,
    isTopFrame: true,
  };

  Object.defineProperty(textarea, 'value', {
    get() {
      return attemptCount >= 2 ? 'ready text' : 'wrong text';
    },
    set() {},
    configurable: true,
  });

  const res = await pollTransferInject(
    env,
    { payload: 'ready text', targetPlatform: 'deepseek', autoSend: false },
    {
      maxWaitMs: 1000,
      pollMs: 10,
      onAttempt: () => {
        attemptCount++;
      },
    },
  );
  assert.equal(res.ok, true);
  assert.ok(res.attempts >= 3);
});

test('injector: pollTransferInject terminates after 4 verify-failed attempts', async () => {
  const doc = docOf('<textarea placeholder="Message DeepSeek"></textarea>');
  const textarea = doc.querySelector('textarea');
  const env = { document: doc, isTopFrame: true };

  Object.defineProperty(textarea, 'value', {
    get() {
      return 'wrong';
    },
    set() {},
    configurable: true,
  });

  const res = await pollTransferInject(
    env,
    { payload: 'ready text', targetPlatform: 'deepseek', autoSend: false },
    { maxWaitMs: 1000, pollMs: 10 },
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'verify-failed');
  assert.equal(res.attempts, 4);
});

test('options HTML and script wire transferCopyToClipboard', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync('entrypoints/options/index.html', 'utf8');
  const js = fs.readFileSync('entrypoints/options/main.js', 'utf8');
  assert.match(html, /id="transferCopyToClipboard"/);
  assert.match(html, /data-i18n="transferCopyClipboardLabel"/);
  assert.match(js, /transferCopyToClipboard/);
});

test('manifest configures extShortName and short_name', async () => {
  const fs = await import('node:fs');
  const wxtConfig = fs.readFileSync('wxt.config.ts', 'utf8');
  assert.match(wxtConfig, /short_name:\s*'__MSG_extShortName__'/);
  assert.match(wxtConfig, /default_title\s*=\s*'__MSG_extShortName__'/);

  const enMessages = JSON.parse(fs.readFileSync('public/_locales/en/messages.json', 'utf8'));
  assert.equal(enMessages.extShortName.message, 'Decant');
  assert.ok(enMessages.transferCopyClipboardLabel);
  assert.ok(enMessages.transferCopyClipboardHelp);
});
