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
const { execFile } = require('child_process');
const { URL } = require('url');

const { parseFrontmatter, stringifyFrontmatter } = require('../scripts/lib/frontmatter');
const { mdToHtml, verseToHtml, slugify, excerpt, wordCount } = require('../scripts/lib/markdown');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const UPLOADS_DIR = path.join(ROOT, 'assets', 'uploads');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const ADMIN_CONFIG_PATH = path.join(ROOT, 'data', 'admin-config.json');

const PORT = Number(process.argv[2]) || 4321;
const HOST = process.env.ADMIN_HOST || '127.0.0.1';

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
  return cookies.session && sessions.has(cookies.session);
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
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
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
  const adminCfg = loadJson(ADMIN_CONFIG_PATH, { password: 'changeme' });
  if (body.password !== adminCfg.password) {
    return sendJson(res, 401, { error: 'Incorrect password' });
  }
  const token = newSession();
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Strict`);
  sendJson(res, 200, { ok: true });
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
  const posts = allPostsRaw();
  const tagCounts = {};
  posts.forEach(p => (p.data.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  sendJson(res, 200, {
    contentTypes: CONFIG.contentTypes,
    categories: CONFIG.categories,
    reviewTypes: CONFIG.reviewTypes,
    tags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
  });
});

// ---- Posts CRUD ----
route('GET', '/api/posts', async (req, res, params, body, query) => {
  let posts = allPostsRaw();
  if (query.type) posts = posts.filter(p => p.typeId === query.type);
  if (query.status === 'draft') posts = posts.filter(p => p.data.published === false);
  if (query.status === 'published') posts = posts.filter(p => p.data.published !== false);
  if (query.q) {
    const q = query.q.toLowerCase();
    posts = posts.filter(p => (p.data.title || '').toLowerCase().includes(q) || p.slug.includes(q));
  }
  posts.sort((a, b) => new Date(b.data.date || 0) - new Date(a.data.date || 0));
  sendJson(res, 200, posts.map(p => ({
    typeId: p.typeId, slug: p.slug, title: p.data.title || p.slug, date: p.data.date || '',
    published: p.data.published !== false, category: p.data.category || '', wordCount: p.wordCount,
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
  sendJson(res, 200, { ok: true, slug });
});

route('PUT', '/api/posts/:type/:slug', async (req, res, params, body) => {
  const typeId = params.type;
  const oldPath = postFilePath(typeId, params.slug);
  if (!fs.existsSync(oldPath)) return sendJson(res, 404, { error: 'Not found' });
  let slug = params.slug;
  if (body.slug && slugify(body.slug) !== params.slug) {
    slug = uniqueSlug(typeId, slugify(body.slug), params.slug);
    fs.unlinkSync(oldPath);
  }
  const data = Object.assign({ type: TYPE_LABEL[typeId] }, body.data);
  fs.writeFileSync(postFilePath(typeId, slug), stringifyFrontmatter(data, body.body || ''));
  sendJson(res, 200, { ok: true, slug });
});

route('DELETE', '/api/posts/:type/:slug', async (req, res, params) => {
  const fp = postFilePath(params.type, params.slug);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  sendJson(res, 200, { ok: true });
});

// ---- Markdown preview ----
route('POST', '/api/render', async (req, res, params, body) => {
  const html = body.mode === 'verse' ? verseToHtml(body.body || '') : mdToHtml(body.body || '');
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
route('POST', '/api/media', async (req, res, params, body) => {
  if (!body.name || !body.data) return sendJson(res, 400, { error: 'Missing file data' });
  const safeName = Date.now() + '-' + body.name.replace(/[^\w.\-]/g, '_');
  const base64 = body.data.split(',').pop();
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), Buffer.from(base64, 'base64'));
  sendJson(res, 200, { ok: true, url: `/assets/uploads/${safeName}` });
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
route('POST', '/api/publish', async (req, res, params, body) => {
  const log = [];
  const build = await run('node', ['scripts/build.js']);
  log.push({ step: 'build', ...build });
  if (!build.ok) return sendJson(res, 500, { ok: false, log });

  await run('git', ['add', '-A']);
  const commit = await run('git', ['commit', '-m', body.message || 'Publish site update']);
  log.push({ step: 'commit', ...commit });

  const push = await run('git', ['push']);
  log.push({ step: 'push', ...push });

  sendJson(res, 200, { ok: true, log });
});

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
