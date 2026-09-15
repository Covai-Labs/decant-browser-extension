// Robust transfer-prompt injector.
// Single-attempt engine (attemptTransferInject) + polling wrapper (pollTransferInject).
// Browser APIs stay outside: the content script supplies storage/toast via `env`.

import { getComposerSelectors, getSendSelectors, BLOCKER_SELECTORS } from './platform-inputs.js';

export const INJECT_MAX_WAIT_MS = 30000;
export const INJECT_POLL_MS = 750;

function isHiddenByAttr(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style') || '';
  if (/display\s*:\s*none/i.test(style)) return true;
  if (/visibility\s*:\s*hidden/i.test(style)) return true;
  if (el.hasAttribute && el.hasAttribute('hidden')) return true;
  return false;
}

export function isVisible(el) {
  if (!el) return false;
  if (isHiddenByAttr(el)) return false;
  const win =
    (el.ownerDocument && el.ownerDocument.defaultView) ||
    (typeof window !== 'undefined' ? window : null);
  try {
    if (win && typeof win.getComputedStyle === 'function') {
      const cs = win.getComputedStyle(el);
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) {
        return false;
      }
    }
  } catch {
    // ignore
  }
  if (typeof el.offsetParent !== 'undefined') {
    if (el.offsetParent !== null) return true;
    try {
      const pos =
        win && typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el).position : '';
      if (pos === 'fixed') return true;
    } catch {
      // ignore
    }
  }
  if (typeof el.getClientRects === 'function') {
    try {
      if (el.getClientRects().length > 0) return true;
    } catch {
      // ignore
    }
  }
  return typeof el.offsetParent === 'undefined' && typeof el.getClientRects !== 'function';
}

function isMeasuringMirror(el) {
  if (!el || typeof el.getAttribute !== 'function') return false;
  if (el.getAttribute('tabindex') === '-1' && el.getAttribute('aria-hidden') === 'true')
    return true;
  const cls = (el.className && el.className.toString && el.className.toString()) || '';
  if (/\bql-clipboard\b/.test(cls)) return true;
  return false;
}

export function isEditable(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    return !el.disabled && !el.readOnly;
  }
  if (el.isContentEditable) return true;
  if (typeof el.getAttribute === 'function' && el.getAttribute('contenteditable') === 'true')
    return true;
  return false;
}

function findComposerMatch(doc, targetId) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;
  const specificSelectors = getComposerSelectors(targetId, { includeGeneric: false });
  const selectorGroups = [
    { selectors: specificSelectors, generic: false },
    { selectors: getComposerSelectors(targetId).slice(specificSelectors.length), generic: true },
  ];
  for (const { selectors, generic } of selectorGroups) {
    for (const sel of selectors) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(sel);
      } catch {
        continue;
      }
      if (!nodes) continue;
      for (const el of nodes) {
        if (isMeasuringMirror(el)) continue;
        if (isEditable(el) && isVisible(el)) return { composer: el, generic };
      }
    }
  }
  return null;
}

export function findComposer(doc, targetId) {
  return findComposerMatch(doc, targetId)?.composer || null;
}

export function findBlocker(doc, composer) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null;
  for (const sel of BLOCKER_SELECTORS) {
    let nodes;
    try {
      nodes = doc.querySelectorAll(sel);
    } catch {
      continue;
    }
    if (!nodes) continue;
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      try {
        if (el.closest && el.closest('[aria-hidden="true"], [hidden], .ot-hide')) continue;
      } catch {
        // ignore
      }
      return el;
    }
  }
  try {
    if (composer && typeof composer.getBoundingClientRect === 'function' && doc.elementFromPoint) {
      const r = composer.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        const hit = doc.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (hit && composer.contains && !composer.contains(hit) && !hit.contains(composer)) {
          const hitSel = hit.tagName
            ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${(
                (hit.className && hit.className.toString && hit.className.toString()) ||
                ''
              )
                .split(' ')
                .slice(0, 2)
                .join('.')}`
            : 'overlay';
          return { tagName: 'OVERLAY', describe: hitSel };
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function setNativeValue(el, text) {
  const tag = (el.tagName || '').toUpperCase();
  const proto =
    tag === 'TEXTAREA'
      ? typeof HTMLTextAreaElement !== 'undefined'
        ? HTMLTextAreaElement.prototype
        : null
      : tag === 'INPUT' && typeof HTMLInputElement !== 'undefined'
        ? HTMLInputElement.prototype
        : null;
  const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, text);
  else el.value = text;
}

export function fillTextarea(doc, el, text) {
  try {
    el.focus && el.focus();
  } catch {
    // ignore
  }
  setNativeValue(el, text);
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  try {
    const Ctor =
      (win && (win.InputEvent || win.Event)) ||
      (typeof InputEvent !== 'undefined' ? InputEvent : Event);
    el.dispatchEvent(new Ctor('input', { bubbles: true, data: text, inputType: 'insertText' }));
  } catch {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      // ignore
    }
  }
  try {
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    // ignore
  }
}

export function fillContentEditable(doc, el, text) {
  try {
    el.focus && el.focus();
  } catch {
    // ignore
  }
  const d = (el.ownerDocument || doc) ?? (typeof document !== 'undefined' ? document : null);
  try {
    const sel = d && d.getSelection && d.getSelection();
    if (sel && typeof sel.selectAllChildren === 'function') {
      sel.selectAllChildren(el);
    }
  } catch {
    // ignore
  }
  let inserted = false;
  try {
    if (d && typeof d.execCommand === 'function' && d.execCommand('insertText', false, text)) {
      inserted = true;
    }
  } catch {
    // ignore
  }
  if (!inserted) {
    try {
      const sel = (d && d.getSelection && d.getSelection()) || window.getSelection();
      if (sel) {
        sel.selectAllChildren(el);
        if (d && typeof d.execCommand === 'function') {
          inserted = d.execCommand('insertText', false, text);
        }
      }
    } catch {
      // ignore
    }
  }
  if (!inserted) {
    try {
      while (el.firstChild) el.removeChild(el.firstChild);
      const owner = el.ownerDocument || doc || document;
      for (const chunk of text.split('\n\n')) {
        const p = owner.createElement('p');
        const parts = chunk.split('\n');
        parts.forEach((part, i) => {
          p.appendChild(owner.createTextNode(part));
          if (i < parts.length - 1) p.appendChild(owner.createElement('br'));
        });
        el.appendChild(p);
      }
    } catch {
      try {
        el.textContent = text;
      } catch {
        // ignore
      }
    }
  }
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    // ignore
  }
}

export function readBack(el) {
  if (!el) return '';
  if (typeof el.value === 'string' && el.value.length > 0) return el.value;
  if (typeof el.innerText === 'string' && el.innerText.length > 0) return el.innerText;
  if (typeof el.textContent === 'string') return el.textContent;
  return '';
}

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function verifyContent(el, text) {
  const got = norm(readBack(el));
  if (!got) return false;
  const want = norm(text);
  return got.length === want.length && got === want;
}

export function sendViaButton(doc, targetId) {
  for (const sel of getSendSelectors(targetId)) {
    let el;
    try {
      el = doc.querySelector(sel);
    } catch {
      continue;
    }
    if (!el) continue;
    if (isVisible(el) && !el.disabled) {
      el.click();
      return true;
    }
  }
  return false;
}

export function sendViaEnter(el) {
  const init = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 };
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    return true;
  } catch {
    return false;
  }
}

async function tryClipboardBackup(env, payload) {
  try {
    if (!env || typeof env.clipboardWrite !== 'function') return false;
    await env.clipboardWrite(payload);
    return true;
  } catch {
    return false;
  }
}

export async function attemptTransferInject(env, { payload, targetPlatform, autoSend }) {
  const doc = env && env.document;
  if (!doc) return { ok: false, reason: 'no-document' };
  if (env.isTopFrame === false) return { ok: false, reason: 'not-top-frame' };
  if (!payload) return { ok: false, reason: 'empty-payload' };

  const composerMatch = findComposerMatch(doc, targetPlatform);
  if (!composerMatch) return { ok: false, reason: 'composer-not-found' };
  const { composer, generic: genericComposer } = composerMatch;

  const blocker = findBlocker(doc, composer);
  if (blocker) {
    const describe =
      (blocker.tagName || 'BLOCKER') +
      (blocker.id ? `#${blocker.id}` : '') +
      (blocker.describe ? `(${blocker.describe})` : '');
    const blockedBackup = await tryClipboardBackup(env, payload);
    return { ok: false, reason: 'blocked', detail: describe, clipboardBackup: blockedBackup };
  }

  const clipboardBackup = await tryClipboardBackup(env, payload);

  const tag = (composer.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'INPUT') fillTextarea(doc, composer, payload);
  else fillContentEditable(doc, composer, payload);

  await new Promise((r) => setTimeout(r, 150));

  if (!verifyContent(composer, payload)) {
    return { ok: false, reason: 'verify-failed', clipboardBackup };
  }

  let autoSent = false;
  let autoSendSkipped = autoSend && genericComposer ? 'generic-composer' : null;
  if (autoSend && !genericComposer) {
    const dispatched = sendViaButton(doc, targetPlatform) || sendViaEnter(composer);
    if (!dispatched) {
      autoSendSkipped = 'send-failed';
    } else {
      await new Promise((r) => setTimeout(r, 800));
      if (norm(readBack(composer)).length === 0) autoSent = true;
      else autoSendSkipped = 'send-unconfirmed';
    }
  }

  return { ok: true, autoSent, autoSendSkipped, clipboardBackup };
}

export async function pollTransferInject(
  env,
  opts,
  { maxWaitMs = INJECT_MAX_WAIT_MS, pollMs = INJECT_POLL_MS, onAttempt } = {},
) {
  const started = Date.now();
  let attempts = 0;
  let last;
  for (;;) {
    attempts++;
    last = await attemptTransferInject(env, opts);
    if (last.ok) return { ...last, attempts };
    if (last.reason === 'blocked' || last.reason === 'verify-failed') {
      if (last.reason === 'verify-failed') return { ...last, attempts };
    }
    try {
      onAttempt && onAttempt(last, attempts);
    } catch {
      // ignore
    }
    if (Date.now() - started >= maxWaitMs) return { ...last, attempts, timedOut: true };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
