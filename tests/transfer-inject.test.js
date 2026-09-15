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
