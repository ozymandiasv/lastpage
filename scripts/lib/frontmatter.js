'use strict';
/**
 * Minimal, dependency-free frontmatter parser.
 * Supports: quoted strings, unquoted scalars, booleans, numbers, and
 * simple YAML block lists ("key:\n  - item"). That's all our content needs.
 */

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.replace(/\\"/g, '"');
}

function coerce(v) {
  const raw = v.trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !isNaN(Number(raw)) && !/^["']/.test(raw)) return Number(raw);
  return unquote(raw);
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw.trim() };

  const fmLines = match[1].split(/\r?\n/);
  const body = match[2].trim();
  const data = {};

  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kvMatch) { i++; continue; }
    const key = kvMatch[1];
    const rest = kvMatch[2];

    if (rest === '' || rest === undefined) {
      // Possible block list
      const arr = [];
      let j = i + 1;
      while (j < fmLines.length && /^\s*-\s?/.test(fmLines[j])) {
        arr.push(unquote(fmLines[j].replace(/^\s*-\s?/, '')));
        j++;
      }
      data[key] = arr;
      i = j;
    } else {
      data[key] = coerce(rest);
      i++;
    }
  }

  return { data, body };
}

function stringifyFrontmatter(data, body) {
  let out = '---\n';
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (!v.length) continue;
      out += `${k}:\n`;
      for (const item of v) out += `  - ${item}\n`;
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      out += `${k}: ${v}\n`;
    } else {
      out += `${k}: "${String(v).replace(/"/g, '\\"')}"\n`;
    }
  }
  out += '---\n\n' + (body || '').trim() + '\n';
  return out;
}

module.exports = { parseFrontmatter, stringifyFrontmatter };
