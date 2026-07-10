'use strict';
/**
 * Tiny dependency-free template engine.
 * Supports:
 *   {{var}}            escaped value (dot paths ok: post.title)
 *   {{{var}}}          raw/unescaped HTML
 *   {{#each list}}...{{/each}}   with {{this}}, {{@index}}, {{@first}}, {{@last}}
 *   {{#if cond}}...{{else}}...{{/if}}
 *   {{#unless cond}}...{{/unless}}
 *   {{> partialName}}  include a partial (resolved via `partials` map)
 * Values are simple JS objects/arrays — no filters, no logic-in-template beyond above.
 */

const fs = require('fs');
const path = require('path');

function escapeHtml(s) {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function get(ctx, key) {
  if (key === 'this') return ctx;
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
}

function loadPartials(dir) {
  const partials = {};
  if (!fs.existsSync(dir)) return partials;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.html')) partials[f.replace('.html', '')] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return partials;
}

// Splits template into a token tree honoring nested {{#each}}/{{#if}} blocks.
function findMatchingEnd(src, startIdx, tag) {
  // startIdx points right after the opening block tag
  let depth = 1;
  const openRe = /\{\{#(each|if|unless)\s+[^}]+\}\}/g;
  const closeRe = /\{\{\/(each|if|unless)\}\}/g;
  let i = startIdx;
  while (depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const openMatch = openRe.exec(src);
    const closeMatch = closeRe.exec(src);
    if (!closeMatch) throw new Error('Unclosed block tag in template');
    if (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      i = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      if (depth === 0) return closeMatch.index;
      i = closeMatch.index + closeMatch[0].length;
    }
  }
  return -1;
}

function render(src, ctx, partials = {}) {
  let out = '';
  let i = 0;
  const tagRe = /\{\{(\{)?(#each|#if|#unless|else|\/each|\/if|\/unless|>)?\s*([^}]*?)(\})?\}\}/g;

  while (i < src.length) {
    const start = src.indexOf('{{', i);
    if (start === -1) { out += src.slice(i); break; }
    out += src.slice(i, start);

    // Partial: {{> name}}
    const partialMatch = src.slice(start).match(/^\{\{>\s*([\w-]+)\s*\}\}/);
    if (partialMatch) {
      const partialSrc = partials[partialMatch[1]] || '';
      out += render(partialSrc, ctx, partials);
      i = start + partialMatch[0].length;
      continue;
    }

    // Block: {{#each x}} ... {{/each}}
    const eachMatch = src.slice(start).match(/^\{\{#each\s+([^\s}]+)\s*\}\}/);
    if (eachMatch) {
      const bodyStart = start + eachMatch[0].length;
      const endIdx = findMatchingEnd(src, bodyStart, 'each');
      const inner = src.slice(bodyStart, endIdx);
      const list = get(ctx, eachMatch[1]) || [];
      list.forEach((item, idx) => {
        const subCtx = Object.assign({}, ctx, typeof item === 'object' && item !== null ? item : { this: item }, {
          '@index': idx, '@first': idx === 0, '@last': idx === list.length - 1, this: item,
        });
        out += render(inner, subCtx, partials);
      });
      i = src.indexOf('{{/each}}', endIdx) + '{{/each}}'.length;
      continue;
    }

    // Block: {{#if x}} ... {{else}} ... {{/if}}   (also #unless)
    const ifMatch = src.slice(start).match(/^\{\{#(if|unless)\s+([^\s}]+)\s*\}\}/);
    if (ifMatch) {
      const kind = ifMatch[1];
      const bodyStart = start + ifMatch[0].length;
      const endIdx = findMatchingEnd(src, bodyStart, kind);
      let inner = src.slice(bodyStart, endIdx);
      let truthy = !!get(ctx, ifMatch[2]);
      if (Array.isArray(get(ctx, ifMatch[2]))) truthy = get(ctx, ifMatch[2]).length > 0;
      if (kind === 'unless') truthy = !truthy;

      const elseSplitRe = /\{\{else\}\}/;
      const elseMatch = inner.match(elseSplitRe);
      let mainPart = inner, elsePart = '';
      if (elseMatch) {
        mainPart = inner.slice(0, elseMatch.index);
        elsePart = inner.slice(elseMatch.index + elseMatch[0].length);
      }
      out += render(truthy ? mainPart : elsePart, ctx, partials);
      i = src.indexOf(`{{/${kind}}}`, endIdx) + `{{/${kind}}}`.length;
      continue;
    }

    // Plain / raw variable
    const varMatch = src.slice(start).match(/^\{\{(\{)?\s*([\w.@-]+)\s*(\})?\}\}/);
    if (varMatch) {
      const raw = !!varMatch[1];
      const val = get(ctx, varMatch[2]);
      out += raw ? (val == null ? '' : String(val)) : escapeHtml(val);
      i = start + varMatch[0].length;
      continue;
    }

    // Fallback: emit literally to avoid infinite loop
    out += '{{';
    i = start + 2;
  }
  return out;
}

module.exports = { render, loadPartials, escapeHtml };
