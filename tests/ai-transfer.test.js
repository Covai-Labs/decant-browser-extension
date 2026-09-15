import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiPrompt, getAiPlatformUrl, AI_PLATFORMS } from '../src/shared/ai-transfer.js';

test('getAiPlatformUrl returns correct URL for platform', () => {
  assert.equal(AI_PLATFORMS.chatgpt.url, 'https://chatgpt.com/');
  assert.equal(AI_PLATFORMS.grok.url, 'https://grok.com/');
  assert.equal(getAiPlatformUrl('chatgpt'), 'https://chatgpt.com/');
  assert.equal(getAiPlatformUrl('claude'), 'https://claude.ai/new');
  assert.equal(getAiPlatformUrl('gemini'), 'https://gemini.google.com/app');
  assert.equal(getAiPlatformUrl('deepseek'), 'https://chat.deepseek.com/');
  assert.equal(getAiPlatformUrl('perplexity'), 'https://www.perplexity.ai/');
  assert.equal(getAiPlatformUrl('qwen'), 'https://chat.qwen.ai/');
  assert.equal(getAiPlatformUrl('mistral'), 'https://chat.mistral.ai/');
  assert.equal(getAiPlatformUrl('lumo'), 'https://lumo.proton.me/');
  assert.equal(getAiPlatformUrl('copilot'), 'https://copilot.com/');
  assert.equal(getAiPlatformUrl('meta'), 'https://www.meta.ai/');
  assert.equal(getAiPlatformUrl('z_ai'), 'https://chat.z.ai/');
  assert.equal(getAiPlatformUrl('grok'), 'https://grok.com/');
  assert.equal(getAiPlatformUrl('unknown'), 'https://chatgpt.com/');
});

test('buildAiPrompt formats default prompt when template is omitted', () => {
  const prompt = buildAiPrompt({
    title: 'Test Article',
    url: 'https://example.com/test',
    content: 'Article body text.',
  });

  assert.match(prompt, /Please analyze and summarize/);
  assert.match(prompt, /Title: Test Article/);
  assert.match(prompt, /Source: https:\/\/example\.com\/test/);
  assert.match(prompt, /Article body text\./);
});

test('buildAiPrompt replaces template variables when custom template provided', () => {
  const prompt = buildAiPrompt({
    title: 'Custom Title',
    url: 'https://example.com',
    content: 'Body content',
    template: 'Summarize {{title}} from {{url}}:\n\n{{content}}',
  });

  assert.equal(prompt, 'Summarize Custom Title from https://example.com:\n\nBody content');
});

test('pendingContinuation payload structure contains target, timestamp, and payload text', () => {
  const prompt = buildAiPrompt({
    title: 'Test',
    url: 'https://example.com',
    content: 'Test content',
  });

  const continuationObj = {
    payload: prompt,
    targetPlatform: 'chatgpt',
    timestamp: Date.now(),
  };

  assert.equal(typeof continuationObj.payload, 'string');
  assert.equal(continuationObj.targetPlatform, 'chatgpt');
  assert.ok(continuationObj.timestamp <= Date.now());
});

test('TRANSFER_TARGETS contains 12 platforms', async () => {
  const { TRANSFER_TARGETS, TRANSFER_TARGET_IDS, isSupportedTransferTarget, getTransferTarget } =
    await import('../src/shared/transfer/targets.js');

  assert.equal(TRANSFER_TARGETS.length, 12);
  assert.equal(TRANSFER_TARGET_IDS.length, 12);
  assert.ok(isSupportedTransferTarget('grok'));
  assert.ok(isSupportedTransferTarget('meta'));
  assert.ok(isSupportedTransferTarget('z_ai'));
  assert.ok(!isSupportedTransferTarget('nonexistent'));

  const grok = getTransferTarget('grok');
  assert.equal(grok.label, 'Grok');
  assert.equal(grok.url, 'https://grok.com/');
});
