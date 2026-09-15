import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMarkdown, sanitizeFilename, normalizeLatexMath } from '../src/shared/formatter.js';
import { DEFAULT_OPTIONS } from '../src/shared/storage.js';

test('sanitizeFilename removes illegal characters and spaces', () => {
  const result = sanitizeFilename('Test: Article / Title? *');
  assert.equal(result, 'Test- Article - Title- -');
});

test('normalizeLatexMath preserves inline math in lists without breaking items', () => {
  const input =
    "* Initial Symmetrical Current ($$I''_k$$): The RMS value. Formula: $$I''_k = c \\cdot U_n / (\\sqrt{3} \\cdot Z_k)$$.\n\nStandalone:\n\n$$E = mc^2$$\n";
  const result = normalizeLatexMath(input);

  // Inline math should become single dollar signs
  assert.ok(result.includes("($I''_k$)"));
  assert.ok(result.includes("Formula: $I''_k = c \\cdot U_n / (\\sqrt{3} \\cdot Z_k)$"));
  // Standalone math block must still use double dollars
  assert.ok(result.includes('$$E = mc^2$$'));
  // List item should not be fragmented with double newlines
  assert.ok(!result.includes('*\n\nInitial'));
});

test('normalizeLatexMath converts bracket display and inline math', () => {
  const input = 'Bracket display: \\[x^2 + y^2 = z^2\\] and inline \\(a + b\\).';
  const result = normalizeLatexMath(input);
  assert.ok(result.includes('$$x^2 + y^2 = z^2$$'));
  assert.ok(result.includes('$a + b$'));
});

test('formatMarkdown includes YAML frontmatter when enabled', () => {
  const article = {
    title: 'Hello World',
    byline: 'Jane Doe',
    url: 'https://example.com/hello',
    siteName: 'Example Blog',
    excerpt: 'An example article',
    content: 'This is the main body.',
  };

  const options = {
    ...DEFAULT_OPTIONS,
    includeFrontmatter: true,
    frontmatterTemplate: '---\ntitle: "{{title}}"\nauthor: "{{author}}"\n---',
  };

  const formatted = formatMarkdown(article, options);
  assert.match(formatted, /^---\ntitle: "Hello World"\nauthor: "Jane Doe"\n---/);
  assert.match(formatted, /# Hello World/);
  assert.match(formatted, /This is the main body\./);
});

test('formatMarkdown formats default frontmatter template with extracted_with', () => {
  const article = {
    title: 'Hello World',
    byline: 'Jane Doe',
    url: 'https://example.com/hello',
    siteName: 'Example Blog',
    excerpt: 'An example article',
    content: 'This is the main body.',
    publishedTime: '2026-08-20T10:00:00Z',
  };

  const formatted = formatMarkdown(article, DEFAULT_OPTIONS);
  assert.match(formatted, /extracted_with: "decant\.covai\.org"/);
  assert.match(formatted, /title: "Hello World"/);
  assert.match(formatted, /source: "https:\/\/example\.com\/hello"/);
});

test('formatMarkdown omits frontmatter when disabled', () => {
  const article = {
    title: 'No Frontmatter Test',
    byline: '',
    url: 'https://example.com',
    content: 'Content only.',
  };

  const options = {
    ...DEFAULT_OPTIONS,
    includeFrontmatter: false,
  };

  const formatted = formatMarkdown(article, options);
  assert.equal(formatted, '# No Frontmatter Test\n\nContent only.');
});
