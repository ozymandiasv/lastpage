#!/usr/bin/env node
'use strict';
/**
 * Last Page — local admin server.
 * Zero external dependencies. Intended to run only on your own machine/server,
 * bound to 127.0.0.1 by default. Provides a JSON API for the admin frontend
 * in /admin/public, plus the Git publishing workflow.
 *
 * Usage: node admin/server.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tiny .env loader so the admin can run without dotenv or another dependency.
(function loadDotEnv() {
  const envPath = require('path').join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[1].startsWith('#') || process.env[m[1]]) return;
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
  } catch (_) {}
})();
const { execFile } = require('child_process');
const { URL } = require('url');

const { parseFrontmatter, stringifyFrontmatter } = require('../scripts/lib/frontmatter');
const { mdToHtml, verseToHtml, verseStoryToHtml, slugify, excerpt, wordCount } = require('../scripts/lib/markdown');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const UPLOADS_DIR = path.join(ROOT, 'assets', 'uploads');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const ADMIN_CONFIG_PATH = path.join(ROOT, 'data', 'admin-config.json');
const TAGS_PATH = path.join(ROOT, 'data', 'tags.json');

const PORT = Number(process.argv[2]) || 4321;
const HOST = process.env.ADMIN_HOST || '0.0.0.0';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function saveJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(ADMIN_CONFIG_PATH)) {
  saveJson(ADMIN_CONFIG_PATH, { password: 'changeme', _note: 'Change this password. This file is gitignored on purpose.' });
}
if (!fs.existsSync(TAGS_PATH)) {
  saveJson(TAGS_PATH, { tags: [] });
}

const CONFIG = loadJson(CONFIG_PATH, {});
const TYPE_DIR = { essay: 'essays', blog: 'blogs', review: 'reviews', note: 'notes', verse: 'verses' };
const TYPE_LABEL = { essay: 'Essay', blog: 'Blog', review: 'Review', note: 'Note', verse: 'Verse' };

// ---------------------------------------------------------------------------
// Sessions (in-memory)
// ---------------------------------------------------------------------------

const sessions = new Set();
function newSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  return token;
}
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}
function isAuthed(req) {
  const cookies = parseCookies(req);
  if (cookies.session && sessions.has(cookies.session)) return true;

  const adminCfg = loadJson(ADMIN_CONFIG_PATH, { username: 'ozymandias', password: 'changeme' });
  const configuredUser = adminCfg.username || 'ozymandias';
  const configuredPass = adminCfg.password;

  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const colonIdx = decoded.indexOf(':');
        if (colonIdx !== -1) {
          const u = decoded.slice(0, colonIdx);
          const p = decoded.slice(colonIdx + 1);
          if (u === configuredUser && p === configuredPass) return true;
        }
      } catch (_) {}
    } else if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token === configuredPass) return true;
    }
  }

  if (req.headers['x-api-key'] && req.headers['x-api-key'] === configuredPass) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 30 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
};
function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'Not found' }); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}
function run(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || (err ? String(err.message) : '') });
    });
  });
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function listPostsRaw(typeId) {
  const dir = path.join(CONTENT_DIR, TYPE_DIR[typeId]);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const slug = f.replace(/\.md$/, '');
    return { typeId, slug, data, body, wordCount: wordCount(body) };
  });
}
function allPostsRaw() {
  return Object.keys(TYPE_DIR).flatMap(listPostsRaw);
}
function postFilePath(typeId, slug) {
  return path.join(CONTENT_DIR, TYPE_DIR[typeId], `${slug}.md`);
}
function uniqueSlug(typeId, base, ignoreSlug) {
  const dir = path.join(CONTENT_DIR, TYPE_DIR[typeId]);
  fs.mkdirSync(dir, { recursive: true });
  let slug = base || 'untitled';
  let n = 2;
  while (fs.existsSync(path.join(dir, `${slug}.md`)) && slug !== ignoreSlug) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

// ---------------------------------------------------------------------------
// Tag persistence (data/tags.json — committed to the repo, no DB)
// ---------------------------------------------------------------------------

function loadStoredTags() {
  const data = loadJson(TAGS_PATH, { tags: [] });
  return Array.isArray(data.tags) ? data.tags : [];
}
// Adds any new tag names to data/tags.json. Case-insensitive de-dupe against
// what's already stored; existing tags are never removed or renamed here.
function addTagsToStore(names) {
  const existing = loadStoredTags();
  const seen = new Set(existing.map(t => t.toLowerCase()));
  let changed = false;
  (names || []).forEach(raw => {
    const name = String(raw || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    existing.push(name);
    changed = true;
  });
  if (changed) saveJson(TAGS_PATH, { tags: existing });
  return existing;
}
// Merges the persisted tag list with tags actually in use on posts, and
// counts current usage. Persisted tags with zero current usage still show
// up (count 0) so they remain available for autocomplete.
function tagsWithCounts() {
  const counts = {};
  allPostsRaw().forEach(p => (p.data.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const stored = loadStoredTags();
  const byKey = new Map(); // lower-case -> display name
  stored.forEach(t => byKey.set(t.toLowerCase(), t));
  Object.keys(counts).forEach(t => { if (!byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t); });
  return Array.from(byKey.values())
    .map(name => ({ name, count: counts[name] || 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}


// ---------------------------------------------------------------------------
// Gemini AI helpers
// ---------------------------------------------------------------------------

function getGeminiConfig() {
  const envPath = path.join(ROOT, '.env');
  let key = process.env.GEMINI_API_KEY || '';
  let model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  if (fs.existsSync(envPath)) {
    try {
      fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) {
          if (m[1] === 'GEMINI_API_KEY') key = m[2].replace(/^['"]|['"]$/g, '');
          if (m[1] === 'GEMINI_MODEL') model = m[2].replace(/^['"]|['"]$/g, '');
        }
      });
    } catch (_) {}
  }
  return { key, model };
}

function writingStyleReport() {
  const p = path.join(ROOT, 'data', 'writing-style.json');
  const saved = loadJson(p, null);
  if (saved && saved.summary) return saved;
  return {
    summary: "Personal, conversational analytical writing that begins with a concrete event, observation, question, or feeling and then widens into a larger argument. The voice is direct and confident but openly personal. The writer often uses first person to establish honesty, then shifts into evidence and reasoning before returning to a pointed conclusion.",
    voice: ["conversational", "direct", "reflective", "opinionated but fair", "occasionally humorous", "emotionally honest"],
    structure: "Open with a specific hook. Give context and personal reaction. Move into short thematic sections when the argument becomes complex. Use evidence, examples, comparisons, and rhetorical questions. End by returning to the central question or argument rather than forcing a neat conclusion.",
    sentenceStyle: "Mostly medium-length sentences with occasional short punchy sentences for emphasis. Natural transitions. Avoid academic stiffness, corporate language, excessive jargon, and artificial eloquence.",
    argumentStyle: "State a position clearly, acknowledge the strongest opposing view when useful, then explain why the writer still disagrees. Distinguish facts from interpretation and use phrases such as 'I think', 'to me', and 'the larger issue' naturally.",
    formatting: "Use Markdown headings only where they improve navigation. Headings should be followed immediately by the paragraph text, with no empty paragraph between them. Use blockquotes only for an actual quotation. Avoid over-formatting.",
    humour: "Dry, occasional humour and self-aware asides are welcome, especially in sports, media, and culture writing. Never add jokes to serious factual or political claims just for personality.",
    avoid: ["generic AI introductions", "overly polished academic prose", "fake certainty", "repetitive conclusions", "unnecessary bullet lists", "excessive em dashes", "changing the author's viewpoint"]
  };
}

function collectStyleSamples() {
  const wanted = ['blogs', 'essays'];
  const samples = [];
  for (const dirName of wanted) {
    const dir = path.join(CONTENT_DIR, dirName);
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir).filter(f => f.endsWith('.md')).slice(0, 20).forEach(f => {
      try {
        const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
        samples.push({ title: data.title || f, body: body.slice(0, 7000) });
      } catch (_) {}
    });
  }
  return samples;
}

function geminiPromptFor(action, body, meta) {
  const style = JSON.stringify(writingStyleReport(), null, 2);
  const context = JSON.stringify({
    title: meta.title || '',
    type: meta.type || '',
    category: meta.category || '',
  });

  const base = `You are the private AI writing partner and editor for Last Page (the personal website of O IV / amal.v).
AUTHOR WRITING STYLE & CORE PHILOSOPHY:
${style}

CRITICAL RULES:
1. Always sound human, authentic, intellectually curious, and reflective. Never sound like generic, sanitized, polite AI prose.
2. Tone is grounded, conversational, slightly cynical/wry, skeptical of corporate hype, consumerism, and institutional power.
3. First-person POV ("I", "my", "we").
4. Never invent facts, sources, or citations. Never change the author's opinions, arguments, or critique.
5. Return strictly valid JSON. Do not wrap in Markdown fences.

CONTEXT:
${context}
INPUT DRAFT / TEXT:
${body}`;

  if (action === 'rewrite') {
    return `${base}

TASK: Complete Rewrite in O IV's Distinct Voice and Structure.
Take the user's gist, rough draft, or detailed writeup and rewrite it into a rich, captivating, publication-ready piece for Last Page.

MANDATORY STRUCTURAL RULES:
1. OPENING HOOK (PARAGRAPH 1):
   - You MUST plunge directly into the narrative with the first paragraph.
   - ABSOLUTE RULE: DO NOT put any title, heading, or label above the opening paragraph.
   - Start with a personal memory, sharp concrete observation, or central tension (e.g. "I still remember...", "I sometimes find myself sitting and wondering...", "I have never understood...").
2. SUBSEQUENT SECTIONS WITH HEADINGS:
   - Headings start ONLY from the second section onward.
   - Use 2 to 4 evocative thematic headings in Title Case: "## Heading Name".
   - Under each heading, develop the reasoning with nuance, fair concessions ("I understand that...", "There is nothing wrong with..."), and critical counter-arguments.
3. CLOSING SECTION:
   - End with a thought-provoking, open reflection or poignant takeaway. NEVER write "In conclusion" or a bland summary.
4. METADATA:
   - "title": Thoughtful, compelling Title Case title matching O IV's style.
   - "subtitle": 1-2 sentence subtitle capturing the tension.
   - "tags": Array of 4 to 6 relevant tags.
   - "preview": 1-2 sentence engaging summary (under 160 characters) suitable for article card previews and RSS.
   - "category": Recommended category (e.g. Technology, Philosophy, Media, Politics, Life, Culture).

Return JSON:
{
  "rewritten": "...markdown starting with hook (NO heading on first paragraph) then ## headings...",
  "title": "Title in Author Voice",
  "subtitle": "Subtitle capturing the tension",
  "tags": ["Tag1", "Tag2", "Tag3", "Tag4"],
  "preview": "Concise 1-2 sentence preview text for cards.",
  "category": "Technology",
  "notes": "Brief summary of voice and structure choices"
}`;
  }

  if (action === 'grammar') {
    return `${base}

TASK: Grammar, Spelling, and Clarity Polish ONLY.
- Correct spelling, grammar, punctuation, and typographical errors.
- STRICT RULE: Do not paraphrase. Do not rewrite sentences. Do not alter the author's vocabulary, cadence, tone, opinions, or meaning.
- Preserve existing headings, formatting, and line breaks exactly.
Return JSON:
{
  "rewritten": "...corrected text...",
  "changes": ["summary of grammar fixes"],
  "notes": "Grammar and spelling polished while keeping your exact words and voice intact."
}`;
  }

  if (action === 'factcheck_grammar' || action === 'factcheck') {
    return `${base}

TASK: Fact Check + Grammar Polish.
- Verify factual claims (dates, names, statistics, quotes, historical claims, event timelines) using Google Search grounding.
- CRITICAL RULE: DO NOT aggressively or rigidly change the author's critique, arguments, or opinion. Never sanitize or tone down the author's voice.
- Only correct claims that are materially inaccurate or mistaken, while polishing grammar and awkward phrasing.
- Generate tags and preview text as well.
Return JSON:
{
  "report": {
    "overall": "Brief summary of fact check and grammar review",
    "verified": [{"claim": "...", "source": "..."}],
    "questionable": [{"claim": "...", "issue": "...", "suggested_change": "..."}],
    "unsupported": [{"claim": "...", "issue": "..."}]
  },
  "rewritten": "...fact-checked and grammar-polished markdown...",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "preview": "Optional preview text",
  "notes": "Factual claims checked gently; your core argument and opinions remain untouched."
}`;
  }

  if (action === 'tags_preview') {
    return `${base}

TASK: Generate Tags & Preview Text.
- Extract 4 to 6 specific, high-relevance tags (topics, people, themes, works).
- Write a 1-2 sentence preview text (under 160 characters) that hooks the reader on article cards.
Return JSON:
{
  "tags": ["Tag1", "Tag2", "Tag3", "Tag4"],
  "preview": "Concise card preview summary",
  "category": "Suggested category"
}`;
  }

  if (action === 'expand') {
    return `${base}
TASK: Expand this draft only where an idea is underdeveloped. Continue in the same writing voice and reasoning pattern.
Return JSON:
{"rewritten":"...","added":["what was expanded"],"notes":"..."}`;
  }

  if (action === 'format') {
    return `${base}
TASK: Improve formatting with headings only from section 2 onward (NO heading for paragraph 1).
Return JSON:
{"rewritten":"...","changes":["formatting changes"],"notes":"..."}`;
  }

  return `${base}\nReturn JSON: {"rewritten":"${body.replace(/"/g,'\\\"')}","notes":"No action"}`;
}

async function callGemini(action, body, meta) {
  const { key, model } = getGeminiConfig();
  if (!key) throw new Error('Gemini is not configured. Set GEMINI_API_KEY in the server environment.');

  const modelsToTry = [model, 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].filter((v, i, a) => v && a.indexOf(v) === i);
  let lastErr = null;

  for (const m of modelsToTry) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: geminiPromptFor(action, body, meta) }] }],
      generationConfig: {
        temperature: (action === 'grammar' || action === 'factcheck_grammar' || action === 'factcheck') ? 0.2 : 0.45,
        responseMimeType: 'application/json'
      }
    };
    if (action === 'factcheck' || action === 'factcheck_grammar') {
      payload.tools = [{ google_search: {} }];
    }

    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const raw = await r.text();
      let data;
      try { data = JSON.parse(raw); } catch (_) { throw new Error(`Gemini returned invalid JSON (${r.status}).`); }
      if (!r.ok) {
        const errMsg = data.error?.message || `Gemini request failed (${r.status}).`;
        if (r.status === 503 || r.status === 429) {
          lastErr = new Error(errMsg);
          continue;
        }
        throw new Error(errMsg);
      }
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (!text) throw new Error('Gemini returned an empty response.');
      const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      lastErr = err;
      if (err.message && (err.message.includes('503') || err.message.includes('429') || err.message.includes('high demand'))) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('All Gemini model fallbacks failed.');
}

// Route handlers
// ---------------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([\w]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

// ---- Auth ----
route('GET', '/api/session', async (req, res) => {
  sendJson(res, 200, { loggedIn: isAuthed(req) });
});
route('POST', '/api/login', async (req, res, params, body) => {
  const adminCfg = loadJson(ADMIN_CONFIG_PATH, { username: 'ozymandias', password: 'changeme' });
  const configuredUser = adminCfg.username || 'ozymandias';
  const configuredPass = adminCfg.password;

  const userOk = !adminCfg.username || !body.username || body.username.trim() === configuredUser;
  const passOk = body.password === configuredPass;

  if (!userOk || !passOk) {
    return sendJson(res, 401, { error: 'Incorrect username or password' });
  }
  const token = newSession();
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
  sendJson(res, 200, { ok: true, user: configuredUser });
});
route('POST', '/api/logout', async (req, res) => {
  const cookies = parseCookies(req);
  sessions.delete(cookies.session);
  res.setHeader('Set-Cookie', 'session=; Path=/; Max-Age=0');
  sendJson(res, 200, { ok: true });
});

// ---- Dashboard ----
route('GET', '/api/dashboard', async (req, res) => {
  const posts = allPostsRaw();
  const published = posts.filter(p => p.data.published !== false);
  const drafts = posts.filter(p => p.data.published === false);
  const byType = {};
  Object.keys(TYPE_DIR).forEach(t => { byType[t] = posts.filter(p => p.typeId === t).length; });
  const gitLog = await run('git', ['log', '-8', '--pretty=format:%h|%an|%ar|%s']);
  const gitStatus = await run('git', ['status', '--porcelain']);
  sendJson(res, 200, {
    total: posts.length,
    published: published.length,
    drafts: drafts.length,
    byType,
    recentGitLog: gitLog.ok ? gitLog.stdout.trim().split('\n').filter(Boolean).map(l => {
      const [hash, author, when, ...msg] = l.split('|');
      return { hash, author, when, message: msg.join('|') };
    }) : [],
    dirtyFiles: gitStatus.ok ? gitStatus.stdout.trim().split('\n').filter(Boolean).length : 0,
  });
});

// ---- Config (dropdown data) ----
route('GET', '/api/config', async (req, res) => {
  sendJson(res, 200, {
    contentTypes: CONFIG.contentTypes,
    categories: CONFIG.categories,
    reviewTypes: CONFIG.reviewTypes,
    tags: tagsWithCounts(),
  });
});

// ---- Tags (persisted to data/tags.json, no DB) ----
route('GET', '/api/tags', async (req, res) => {
  sendJson(res, 200, { tags: tagsWithCounts() });
});
route('POST', '/api/tags', async (req, res, params, body) => {
  const names = Array.isArray(body.names) ? body.names : [body.name];
  addTagsToStore(names);
  sendJson(res, 200, { ok: true, tags: tagsWithCounts() });
});

// ---- Posts CRUD ----
route('GET', '/api/posts', async (req, res, params, body, query) => {
  let posts = allPostsRaw();
  if (query.type) posts = posts.filter(p => p.typeId === query.type);
  if (query.status === 'draft') posts = posts.filter(p => p.data.published === false && p.data.publishStatus !== 'scheduled');
  if (query.status === 'scheduled') posts = posts.filter(p => p.data.publishStatus === 'scheduled');
  if (query.status === 'published') posts = posts.filter(p => p.data.published !== false && p.data.publishStatus !== 'scheduled');
  if (query.q) {
    const q = query.q.toLowerCase();
    posts = posts.filter(p => (p.data.title || '').toLowerCase().includes(q) || p.slug.includes(q));
  }
  posts.sort((a, b) => new Date(b.data.date || 0) - new Date(a.data.date || 0));
  sendJson(res, 200, posts.map(p => ({
    typeId: p.typeId, slug: p.slug, title: p.data.title || p.slug, date: p.data.date || '',
    published: p.data.published !== false && p.data.publishStatus !== 'scheduled',
    scheduled: p.data.publishStatus === 'scheduled',
    scheduledDate: p.data.scheduledDate || '',
    category: p.data.category || '', wordCount: p.wordCount,
  })));
});

route('GET', '/api/posts/:type/:slug', async (req, res, params) => {
  const fp = postFilePath(params.type, params.slug);
  if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
  const raw = fs.readFileSync(fp, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  sendJson(res, 200, { typeId: params.type, slug: params.slug, data, body });
});

route('POST', '/api/posts/:type', async (req, res, params, body) => {
  const typeId = params.type;
  if (!TYPE_DIR[typeId]) return sendJson(res, 400, { error: 'Unknown content type' });
  const baseSlug = slugify(body.slug || body.data.title || 'untitled');
  const slug = uniqueSlug(typeId, baseSlug);
  const data = Object.assign({ type: TYPE_LABEL[typeId], published: true, date: new Date().toISOString().slice(0, 10) }, body.data);
  fs.writeFileSync(postFilePath(typeId, slug), stringifyFrontmatter(data, body.body || ''));
  if (data.tags && data.tags.length) addTagsToStore(data.tags);
  sendJson(res, 200, { ok: true, slug });
});

route('PUT', '/api/posts/:type/:slug', async (req, res, params, body) => {
  const currentTypeId = params.type;
  const oldPath = postFilePath(currentTypeId, params.slug);
  if (!fs.existsSync(oldPath)) return sendJson(res, 404, { error: 'Not found' });

  const raw = fs.readFileSync(oldPath, 'utf8');
  const existing = parseFrontmatter(raw);

  const targetTypeId = body.newType || body.typeId || currentTypeId;
  if (!TYPE_DIR[targetTypeId]) return sendJson(res, 400, { error: 'Unknown content type' });

  const isTypeChange = targetTypeId !== currentTypeId;
  let slug = params.slug;

  if (isTypeChange || (body.slug && slugify(body.slug) !== params.slug)) {
    const desiredBase = body.slug ? slugify(body.slug) : params.slug;
    slug = uniqueSlug(targetTypeId, desiredBase, isTypeChange ? undefined : params.slug);
    fs.unlinkSync(oldPath);
  }

  const postBody = body.body !== undefined ? body.body : existing.body;
  const data = Object.assign({}, existing.data, body.data, { type: TYPE_LABEL[targetTypeId] });
  fs.writeFileSync(postFilePath(targetTypeId, slug), stringifyFrontmatter(data, postBody || ''));
  if (data.tags && data.tags.length) addTagsToStore(data.tags);
  sendJson(res, 200, { ok: true, slug, typeId: targetTypeId });
});

// ---- Quick Note (for Apple Shortcut & quick capture) ----
route('POST', '/api/notes/quick', async (req, res, params, body) => {
  let noteText = '';
  if (typeof body === 'string') {
    noteText = body;
  } else if (body && typeof body === 'object') {
    noteText = body.text || body.content || body.message || body.body || '';
  }
  const trimmed = String(noteText || '').trim();
  if (!trimmed) {
    return sendJson(res, 400, { error: 'Note text cannot be empty' });
  }

  const todayStr = indiaDateString();
  const slug = uniqueSlug('note', 'untitled');

  const data = {
    type: 'Note',
    published: false,
    publishStatus: 'draft',
    date: todayStr
  };

  if (body && Array.isArray(body.tags) && body.tags.length) {
    data.tags = body.tags;
    addTagsToStore(body.tags);
  }

  const fp = postFilePath('note', slug);
  fs.writeFileSync(fp, stringifyFrontmatter(data, trimmed + '\n'));

  sendJson(res, 200, {
    ok: true,
    slug,
    typeId: 'note',
    filePath: 'content/notes/' + slug + '.md',
    status: 'draft',
    message: 'Note saved to working tree (draft)'
  });
});

route('DELETE', '/api/posts/:type/:slug', async (req, res, params) => {
  const fp = postFilePath(params.type, params.slug);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  sendJson(res, 200, { ok: true });
});


// ---- Gemini editorial tools ----
route('GET', '/api/ai/status', async (req, res) => {
  const cfg = getGeminiConfig(); sendJson(res, 200, { configured: !!cfg.key, model: cfg.model, style: writingStyleReport() });
});
route('POST', '/api/ai', async (req, res, params, body) => {
  const allowed = new Set(['rewrite', 'grammar', 'factcheck_grammar', 'factcheck', 'tags_preview', 'expand', 'format']);
  if (!allowed.has(body.action)) return sendJson(res, 400, { error: 'Unknown AI action' });
  const text = String(body.body || '').trim();
  if (!text) return sendJson(res, 400, { error: 'Write something first.' });
  try {
    const result = await callGemini(body.action, text, body.meta || {});
    sendJson(res, 200, { ok: true, action: body.action, result });
  } catch (e) {
    sendJson(res, 502, { error: e.message });
  }
});
// ---- Markdown preview ----
route('POST', '/api/render', async (req, res, params, body) => {
  let html;
  if (body.mode === 'verse-story') {
    html = verseStoryToHtml(body.body || '');
  } else if (body.mode === 'verse') {
    html = verseToHtml(body.body || '');
  } else {
    html = mdToHtml(body.body || '');
  }
  sendJson(res, 200, { html, excerpt: excerpt(html, 160), wordCount: wordCount(html) });
});

// ---- Custom pages CRUD ----
route('GET', '/api/pages', async (req, res) => {
  const dir = path.join(CONTENT_DIR, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  const list = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const { data } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { slug: f.replace(/\.md$/, ''), title: data.title || f };
  });
  sendJson(res, 200, list);
});
route('GET', '/api/pages/:slug', async (req, res, params) => {
  const fp = path.join(CONTENT_DIR, 'pages', `${params.slug}.md`);
  if (!fs.existsSync(fp)) return sendJson(res, 404, { error: 'Not found' });
  const { data, body } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
  sendJson(res, 200, { slug: params.slug, data, body });
});
route('POST', '/api/pages', async (req, res, params, body) => {
  const dir = path.join(CONTENT_DIR, 'pages');
  fs.mkdirSync(dir, { recursive: true });
  const baseSlug = slugify(body.slug || body.data.title || 'page');
  let slug = baseSlug, n = 2;
  while (fs.existsSync(path.join(dir, `${slug}.md`))) slug = `${baseSlug}-${n++}`;
  const data = Object.assign({ published: true }, body.data);
  fs.writeFileSync(path.join(dir, `${slug}.md`), stringifyFrontmatter(data, body.body || ''));
  sendJson(res, 200, { ok: true, slug });
});
route('PUT', '/api/pages/:slug', async (req, res, params, body) => {
  const dir = path.join(CONTENT_DIR, 'pages');
  const oldPath = path.join(dir, `${params.slug}.md`);
  if (!fs.existsSync(oldPath)) return sendJson(res, 404, { error: 'Not found' });
  let slug = params.slug;
  if (body.slug && slugify(body.slug) !== params.slug) {
    slug = slugify(body.slug);
    fs.unlinkSync(oldPath);
  }
  const data = Object.assign({}, body.data);
  fs.writeFileSync(path.join(dir, `${slug}.md`), stringifyFrontmatter(data, body.body || ''));
  sendJson(res, 200, { ok: true, slug });
});
route('DELETE', '/api/pages/:slug', async (req, res, params) => {
  const fp = path.join(CONTENT_DIR, 'pages', `${params.slug}.md`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  sendJson(res, 200, { ok: true });
});

// ---- Media ----
route('GET', '/api/media', async (req, res) => {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const files = fs.readdirSync(UPLOADS_DIR).map(f => {
    const stat = fs.statSync(path.join(UPLOADS_DIR, f));
    return { name: f, url: `/assets/uploads/${f}`, size: stat.size, mtime: stat.mtime };
  }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  sendJson(res, 200, files);
});
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.avif']);

route('POST', '/api/media', async (req, res, params, body) => {
  if (!body.name || !body.data) return sendJson(res, 400, { error: 'Missing file data' });
  const base64 = body.data.split(',').pop();
  const inputBuffer = Buffer.from(base64, 'base64');
  const origExt = path.extname(body.name).toLowerCase();
  const baseName = path.basename(body.name, origExt).replace(/[^\w.\-]/g, '_');
  const outExt = IMAGE_EXTS.has(origExt) ? origExt : (origExt || '.bin');
  const safeName = `${Date.now()}-${baseName}${outExt}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), inputBuffer);
  sendJson(res, 200, { ok: true, url: `/assets/uploads/${safeName}`, converted: false });
});
route('DELETE', '/api/media/:name', async (req, res, params) => {
  const fp = path.join(UPLOADS_DIR, params.name);
  if (fs.existsSync(fp) && fp.startsWith(UPLOADS_DIR)) fs.unlinkSync(fp);
  sendJson(res, 200, { ok: true });
});

// ---- Git workflow ----
route('GET', '/api/git/status', async (req, res) => {
  const status = await run('git', ['status', '--porcelain']);
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const ahead = await run('git', ['rev-list', '--count', '@{u}..HEAD']);
  const behind = await run('git', ['rev-list', '--count', 'HEAD..@{u}']);
  sendJson(res, 200, {
    branch: branch.stdout.trim(),
    files: status.ok ? status.stdout.trim().split('\n').filter(Boolean).map(l => ({ code: l.slice(0, 2).trim(), file: l.slice(3) })) : [],
    ahead: ahead.ok ? Number(ahead.stdout.trim() || 0) : null,
    behind: behind.ok ? Number(behind.stdout.trim() || 0) : null,
    hasUpstream: ahead.ok,
  });
});
route('POST', '/api/git/pull', async (req, res) => {
  const result = await run('git', ['pull', '--ff-only']);
  sendJson(res, result.ok ? 200 : 500, result);
});
route('POST', '/api/git/push', async (req, res) => {
  const result = await run('git', ['push']);
  sendJson(res, result.ok ? 200 : 500, result);
});
route('POST', '/api/git/commit', async (req, res, params, body) => {
  await run('git', ['add', '-A']);
  const result = await run('git', ['commit', '-m', body.message || 'Update content']);
  sendJson(res, result.ok ? 200 : 500, result);
});
async function publishSite(message) {
  const log = [];
  const build = await run('node', ['scripts/build.js']);
  log.push({ step: 'build', ...build });
  if (!build.ok) return { ok: false, log };

  const add = await run('git', ['add', '-A']);
  log.push({ step: 'add', ...add });
  if (!add.ok) return { ok: false, log };

  const commit = await run('git', ['commit', '-m', message || 'Publish site update']);
  log.push({ step: 'commit', ...commit });
  if (!commit.ok && !commit.stdout.includes('nothing to commit') && !commit.stderr.includes('nothing to commit')) {
    return { ok: false, log };
  }

  const push = await run('git', ['push']);
  log.push({ step: 'push', ...push });
  return { ok: push.ok, log };
}

function indiaDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function msUntilNext10AMIST() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = k => Number(parts.find(p => p.type === k).value);
  let target = Date.UTC(get('year'), get('month') - 1, get('day'), 4, 30, 0, 0);
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000;
  return target - now.getTime();
}

let schedulerRunning = false;
async function publishScheduledPosts() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const today = indiaDateString();
    const due = allPostsRaw().filter(p => p.data.publishStatus === 'scheduled' && p.data.published === false && p.data.scheduledDate && p.data.scheduledDate <= today);
    if (!due.length) return;

    for (const post of due) {
      const fp = postFilePath(post.typeId, post.slug);
      const raw = fs.readFileSync(fp, 'utf8');
      const parsed = parseFrontmatter(raw);
      const data = Object.assign({}, parsed.data, { published: true, publishStatus: 'published' });
      delete data.scheduledDate;
      fs.writeFileSync(fp, stringifyFrontmatter(data, parsed.body));
    }

    await publishSite(`Scheduled publish: ${due.length} post${due.length === 1 ? '' : 's'}`);
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler() {
  const wait = msUntilNext10AMIST();
  setTimeout(async function tick() {
    await publishScheduledPosts();
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, wait);
  console.log(`Scheduled publishing enabled — next check at 10:00 AM IST.`);
}

route('POST', '/api/publish', async (req, res, params, body) => {
  const result = await publishSite(body.message || 'Publish site update');
  sendJson(res, result.ok ? 200 : 500, result);
});
startScheduler();

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, 'public');
const SITE_DIR = path.join(ROOT, 'site');

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsed.pathname);
  const query = Object.fromEntries(parsed.searchParams.entries());

  // API routes (auth-gated except /api/session and /api/login)
  if (pathname.startsWith('/api/')) {
    if (pathname !== '/api/session' && pathname !== '/api/login' && !isAuthed(req)) {
      return sendJson(res, 401, { error: 'Not authenticated' });
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      try {
        await r.handler(req, res, params, body, query);
      } catch (e) {
        sendJson(res, 500, { error: e.message });
      }
      return;
    }
    return sendJson(res, 404, { error: 'No such API route' });
  }

  // Preview of the generated static site
  if (pathname.startsWith('/preview/')) {
    let rel = pathname.replace('/preview', '') || '/';
    let filePath = path.join(SITE_DIR, rel);
    if (rel.endsWith('/')) filePath = path.join(filePath, 'index.html');
    if (!fs.existsSync(filePath)) filePath = path.join(SITE_DIR, '404.html');
    return serveStatic(res, filePath);
  }

  // Uploaded media (also useful for preview before publish copies it into site/)
  if (pathname.startsWith('/assets/uploads/')) {
    return serveStatic(res, path.join(ROOT, pathname));
  }

  // Admin static frontend
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
  serveStatic(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`\nLast Page admin running at http://${HOST}:${PORT}`);
  console.log('This server should stay bound to localhost / your own machine — do not expose it publicly.\n');
});
