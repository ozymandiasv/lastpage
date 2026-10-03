'use strict';
/**
 * Small dependency-free Markdown -> HTML converter.
 * Supports: headings (#-###), bold, italic, links, images, blockquotes,
 * ordered/unordered lists, inline code, fenced code blocks, hr, paragraphs.
 * Headings get slugified ids so the article TOC can link to them.
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function inline(text) {
  // Inline code first (protect content from further processing)
  const codeStash = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeStash.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${codeStash.length - 1}\u0000`;
  });

  // Escape remaining raw text so stray <, >, & render literally
  text = escapeHtml(text);

  // Images
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, src, title) => `<img src="${src}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`);

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_, label, href, title) => `<a href="${href}"${title ? ` title="${escapeHtml(title)}"` : ''}${/^https?:\/\//.test(href) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`);

  // Bold + italic (order matters)
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

  // Restore inline code
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeStash[i]);

  return text;
}

function mdToHtml(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const usedIds = new Set();

  let i = 0;
  let para = [];
  let inCode = false;
  let codeLines = [];
  let codeLang = '';
  let listBuffer = null; // { type: 'ul'|'ol', items: [] }

  function flushPara() {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  }
  function flushList() {
    if (listBuffer) {
      const tag = listBuffer.type;
      out.push(`<${tag}>${listBuffer.items.map(it => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      listBuffer = null;
    }
  }
  function uniqueId(base) {
    let id = base || 'section';
    let n = 2;
    while (usedIds.has(id)) { id = `${base}-${n++}`; }
    usedIds.add(id);
    return id;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (!inCode) {
        flushPara(); flushList();
        inCode = true; codeLang = fence[1] || ''; codeLines = [];
      } else {
        out.push(`<pre><code${codeLang ? ` class="language-${codeLang}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCode = false;
      }
      i++; continue;
    }
    if (inCode) { codeLines.push(line); i++; continue; }

    // Blank line
    if (!line.trim()) { flushPara(); flushList(); i++; continue; }

    // Headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      const text = inline(h[2].trim());
      const id = uniqueId(slugify(h[2].trim()));
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      i++; continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line.trim()) && !line.trim().startsWith('- ')) {
      flushPara(); flushList();
      out.push('<hr>');
      i++; continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      flushPara(); flushList();
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${inline(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!listBuffer || listBuffer.type !== 'ul') { flushList(); listBuffer = { type: 'ul', items: [] }; }
      listBuffer.items.push(line.replace(/^[-*]\s+/, ''));
      i++; continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      if (!listBuffer || listBuffer.type !== 'ol') { flushList(); listBuffer = { type: 'ol', items: [] }; }
      listBuffer.items.push(line.replace(/^\d+\.\s+/, ''));
      i++; continue;
    }

    // Paragraph text
    flushList();
    para.push(line.trim());
    i++;
  }
  flushPara();
  flushList();

  return out.join('\n');
}

/** Extract h2/h3 for the sticky Table of Contents. Call after mdToHtml. */
function extractToc(html) {
  const toc = [];
  const re = /<h([23])\s+id="([^"]+)">(.*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    toc.push({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  }
  return toc;
}

/** Verse/poem rendering: preserves line breaks, groups stanzas by blank lines. */
function verseToHtml(md) {
  if (!md) return '';
  const stanzas = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return stanzas
    .map(stanza => `<p class="verse-stanza">${inline(stanza.trim()).split('\n').join('<br>')}</p>`)
    .join('\n');
}

function excerpt(html, len = 160) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= len) return text;
  return text.slice(0, len).replace(/\s+\S*$/, '') + '…';
}

function wordCount(html) {
  const text = html.replace(/<[^>]+>/g, ' ').trim();
  return text ? text.split(/\s+/).length : 0;
}

module.exports = { mdToHtml, verseToHtml, extractToc, excerpt, wordCount, slugify, escapeHtml };
