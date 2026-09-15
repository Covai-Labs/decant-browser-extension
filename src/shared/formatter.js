export function formatMarkdown(article, options) {
  const { title, byline, url, content, siteName, excerpt } = article;
  const clippedDate = new Date().toISOString().split('T')[0];
  const publishedDate = article.publishedTime
    ? new Date(article.publishedTime).toISOString().split('T')[0]
    : clippedDate;

  let frontmatter = '';
  if (options.includeFrontmatter && options.frontmatterTemplate) {
    frontmatter = options.frontmatterTemplate
      .replace(/\{\{title\}\}/g, title || '')
      .replace(/\{\{url\}\}/g, url || '')
      .replace(/\{\{author\}\}/g, byline || siteName || '')
      .replace(/\{\{published\}\}/g, publishedDate)
      .replace(/\{\{clipped\}\}/g, clippedDate)
      .replace(/\{\{excerpt\}\}/g, excerpt || '');

    if (!frontmatter.endsWith('\n')) {
      frontmatter += '\n';
    }
    frontmatter += '\n';
  }

  const markdownBody = `# ${title}\n\n${content}`;
  return `${frontmatter}${markdownBody}`.trim();
}

export function normalizeLatexMath(text) {
  if (!text || typeof text !== 'string') return text || '';

  // 1. Convert bracket display math \[ ... \] or \\[ ... \\] to $$ ... $$
  let result = text.replace(/(?:\\{1,2}\[)([\s\S]+?)(?:\\{1,2}\])(?!\()/g, (match, math) => {
    return `\n\n$$${math}$$\n\n`;
  });

  // 2. Convert bracket inline math \( ... \) or \\( ... \\) to $ ... $
  result = result.replace(/(?:\\{1,2}\()([\s\S]+?)(?:\\{1,2}\))(?!\))/g, (match, math) => {
    return `$${math}$`;
  });

  // 3. Normalize display vs inline $$...$$
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (match, math, offset, fullText) => {
    const isMultiLine = math.includes('\n');
    let isStandalone = isMultiLine;
    if (!isStandalone) {
      const lineStart = fullText.lastIndexOf('\n', offset - 1);
      const before = fullText.substring(lineStart + 1, offset);
      const end = offset + match.length;
      const lineEnd = fullText.indexOf('\n', end);
      const after = lineEnd === -1 ? fullText.substring(end) : fullText.substring(end, lineEnd);
      isStandalone = before.trim() === '' && after.trim() === '';
    }

    if (isStandalone) {
      return `\n\n$$${isMultiLine ? math.trim() : math}$$\n\n`;
    }

    // Inline math: convert to $...$ so it does not inject blank lines or break surrounding prose
    return `$${math}$`;
  });

  return result;
}

export function sanitizeFilename(title) {
  if (!title) return 'clipped-page';
  return title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}
