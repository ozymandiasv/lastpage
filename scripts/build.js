#!/usr/bin/env node
'use strict';
/**
 * Last Page — static site generator.
 * Reads Markdown content + JSON config, renders it through the templates in
 * /templates using the tiny engine in scripts/lib/template.js, and writes a
 * fully static site into /site.
 *
 * Usage: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const { parseFrontmatter } = require('./lib/frontmatter');
const { mdToHtml, verseToHtml, extractToc, excerpt, wordCount, escapeHtml } = require('./lib/markdown');
const tpl = require('./lib/template');
const {
  tagColour, formatDate, formatMonthYear, slugifyPath, readTime, starRating,
} = require('./lib/helpers');

const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const ASSETS_DIR = path.join(ROOT, 'assets');
const OUT_DIR = path.join(ROOT, 'site');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));

const TYPE_PATH = {}; // e.g. Essay -> 'essay'
CONFIG.contentTypes.forEach(t => { TYPE_PATH[t.label] = t.path; });

const partials = tpl.loadPartials(path.join(TEMPLATES_DIR, 'partials'));
const templateCache = {};
function loadTemplate(name) {
  if (!templateCache[name]) {
    templateCache[name] = fs.readFileSync(path.join(TEMPLATES_DIR, name + '.html'), 'utf8');
  }
  return templateCache[name];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function writeFile(outPath, contents) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, contents);
}
function writePage(urlPath, html) {
  // urlPath like '/', '/about/', '/blog/my-slug/'
  const filePath = urlPath === '/' || urlPath.endsWith('/')
    ? path.join(OUT_DIR, urlPath, 'index.html')
    : path.join(OUT_DIR, urlPath);
  writeFile(filePath, html);
}
function render(templateName, ctx) {
  return tpl.render(loadTemplate(templateName), ctx, partials);
}
function urlFor(typeLabel, slug) {
  return `/${TYPE_PATH[typeLabel]}/${slug}/`;
}
function shareLinks(pageUrl, title) {
  const full = CONFIG.siteUrl + pageUrl;
  return {
    shareX: `https://twitter.com/intent/tweet?url=${encodeURIComponent(full)}&text=${encodeURIComponent(title)}`,
    shareReddit: `https://www.reddit.com/submit?url=${encodeURIComponent(full)}&title=${encodeURIComponent(title)}`,
  };
}
function tagObjs(tags) {
  return (tags || []).map(name => ({ name, colour: tagColour(name) }));
}
function navWithActive(active) {
  return CONFIG.nav.map(n => ({ ...n, isActive: n.active === active, hideMob: false }));
}
function baseCtx(extra) {
  return Object.assign({
    siteName: CONFIG.siteName,
    siteUrl: CONFIG.siteUrl,
    author: CONFIG.author,
    authorFullName: CONFIG.authorFullName,
    socialX: CONFIG.social.x,
    socialReddit: CONFIG.social.reddit,
    categories: CONFIG.categories.map(c => ({ name: c, slug: slugifyPath(c) })),
    year: new Date().getFullYear(),
    ogType: 'website',
    giscusJson: JSON.stringify(CONFIG.giscus),
  }, extra);
}

// ---------------------------------------------------------------------------
// Load content
// ---------------------------------------------------------------------------

function loadCollection(dir, typeLabel) {
  const full = path.join(CONTENT_DIR, dir);
  if (!fs.existsSync(full)) return [];
  const items = [];
  for (const f of fs.readdirSync(full)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(full, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    if (data.published === false) continue;
    const slug = f.replace(/\.md$/, '');
    const type = data.type || typeLabel;
    const isVerse = type === 'Verse';
    const bodyHtml = isVerse ? verseToHtml(body) : mdToHtml(body);
    const wc = wordCount(bodyHtml);

    items.push({
      slug,
      type,
      typeLC: type.toLowerCase(),
      title: data.title || slug,
      subtitle: data.subtitle || '',
      category: data.category || '',
      categorySlug: data.category ? slugifyPath(data.category) : '',
      date: data.date || '1970-01-01',
      cover: data.cover || '',
      tags: data.tags || [],
      reviewType: data.reviewType || '',
      rating: data.rating !== undefined ? data.rating : null,
      preview: data.preview || '',
      body,
      bodyHtml,
      wordCount: wc,
      readTime: readTime(wc),
      url: urlFor(type, slug),
    });
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items;
}

function loadPages() {
  const full = path.join(CONTENT_DIR, 'pages');
  if (!fs.existsSync(full)) return [];
  const items = [];
  for (const f of fs.readdirSync(full)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(full, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    if (data.published === false) continue;
    const slug = f.replace(/\.md$/, '');
    items.push({
      slug,
      title: data.title || slug,
      bodyHtml: mdToHtml(body),
      showInNav: !!data.showInNav,
      navLabel: data.navLabel || data.title,
      navOrder: data.navOrder || 99,
      url: slug === 'about' ? '/about/' : `/${slug}/`,
    });
  }
  return items;
}

console.log('Reading content…');
const essays = loadCollection('essays', 'Essay');
const blogs = loadCollection('blogs', 'Blog');
const reviews = loadCollection('reviews', 'Review');
const notes = loadCollection('notes', 'Note');
const verses = loadCollection('verses', 'Verse');
const pages = loadPages();

const articleTypes = [...essays, ...blogs, ...reviews]; // have category + full article layout
const allDated = [...essays, ...blogs, ...reviews, ...notes, ...verses]
  .slice()
  .sort((a, b) => new Date(b.date) - new Date(a.date));

// ---------------------------------------------------------------------------
// Fresh output dir + static assets
// ---------------------------------------------------------------------------

console.log('Cleaning site/ …');
rmrf(OUT_DIR);
fs.mkdirSync(OUT_DIR, { recursive: true });
copyDir(ASSETS_DIR, path.join(OUT_DIR, 'assets'));

// ---------------------------------------------------------------------------
// Homepage
// ---------------------------------------------------------------------------

console.log('Building homepage…');
{
  const combined = [...essays, ...blogs].sort((a, b) => new Date(b.date) - new Date(a.date));
  const featured = combined.slice(0, 5);
  const featuredEssayCount = featured.filter(p => p.type === 'Essay').length;
  const featuredBlogCount = featured.filter(p => p.type === 'Blog').length;

  const essayRow = essays.slice(featuredEssayCount, featuredEssayCount + 6);
  const blogRow = blogs.slice(featuredBlogCount, featuredBlogCount + 6);

  const heroSideL = featured.slice(0, 2);
  const heroMain = featured[2] || featured[0];
  const heroSideR = featured.slice(3, 5);

  const homeNotes = notes.slice(0, 6).map(n => ({
    url: n.url,
    textShort: excerpt(n.bodyHtml, 90),
    dateLabel: formatDate(n.date),
  }));
  const homeVerses = verses.slice(0, 3).map(v => ({
    url: v.url,
    title: v.title,
    preview: v.preview || excerpt(v.bodyHtml, 90),
    dateLabel: formatDate(v.date),
  }));

  const recentSource = articleTypes.slice(); // essay+blog+review, already sorted desc
  const PER_PAGE = 8;
  const recentPosts = recentSource.map((p, idx) => ({
    url: p.url,
    type: p.type,
    title: p.title,
    subtitle: p.subtitle,
    cover: p.cover,
    dateLabel: formatDate(p.date),
    author: CONFIG.author,
    page: Math.floor(idx / PER_PAGE) + 1,
  }));
  const totalPages = Math.max(1, Math.ceil(recentPosts.length / PER_PAGE));

  const postDates = [...new Set(allDated.map(p => p.date))];

  const html = render('home', baseCtx({
    title: `${CONFIG.siteName} — ${CONFIG.siteTagline}`,
    description: CONFIG.description,
    path: '/',
    nav: navWithActive('home'),
    aboutActive: false,
    heroSideL: heroSideL.map(p => ({ url: p.url, title: p.title, cover: p.cover, dateLabel: formatDate(p.date), author: CONFIG.author })),
    heroSideR: heroSideR.map(p => ({ url: p.url, title: p.title, cover: p.cover, dateLabel: formatDate(p.date), author: CONFIG.author })),
    heroMain: heroMain ? { url: heroMain.url, title: heroMain.title, subtitle: heroMain.subtitle, cover: heroMain.cover, dateLabel: formatDate(heroMain.date) } : {},
    author: CONFIG.author,
    essayRow: essayRow.map(p => ({ url: p.url, title: p.title, cover: p.cover, dateLabel: formatDate(p.date), author: CONFIG.author })),
    blogRow: blogRow.map(p => ({ url: p.url, title: p.title, cover: p.cover, dateLabel: formatDate(p.date), author: CONFIG.author })),
    notes: homeNotes,
    verses: homeVerses,
    postDatesCsv: postDates.join(','),
    recentPosts,
    showPagination: totalPages > 1,
    totalPages,
  }));
  writePage('/', html);
}

// ---------------------------------------------------------------------------
// Article pages: Essay / Blog / Review
// ---------------------------------------------------------------------------

console.log('Building article pages…');
for (const post of articleTypes) {
  const toc = extractToc(post.bodyHtml);
  const isReview = post.type === 'Review';
  const stars = isReview ? starRating(post.rating) : null;
  const starsDisplay = stars ? '★'.repeat(stars.full) + (stars.half ? '⯨' : '') + '☆'.repeat(stars.empty) : '';

  const html = render('article', baseCtx({
    title: `${post.title} — ${CONFIG.siteName}`,
    description: post.subtitle || excerpt(post.bodyHtml, 160),
    path: post.url,
    cover: post.cover,
    ogType: 'article',
    nav: navWithActive(post.type.toLowerCase()),
    aboutActive: false,
    type: post.type,
    typeLC: post.typeLC,
    category: post.category,
    categorySlug: post.categorySlug,
    dateLabel: formatDate(post.date),
    readTime: post.readTime,
    postTitle: post.title,
    subtitle: post.subtitle,
    bodyHtml: post.bodyHtml,
    tags: tagObjs(post.tags),
    isReview,
    reviewType: post.reviewType,
    rating: post.rating,
    starsDisplay,
    toc,
    ...shareLinks(post.url, post.title),
  }));
  writePage(post.url, html);
}

// ---------------------------------------------------------------------------
// Verse pages
// ---------------------------------------------------------------------------

console.log('Building verse pages…');
for (const post of verses) {
  const html = render('verse', baseCtx({
    title: `${post.title} — ${CONFIG.siteName}`,
    description: post.preview || excerpt(post.bodyHtml, 160),
    path: post.url,
    cover: post.cover,
    ogType: 'article',
    nav: navWithActive('verse'),
    aboutActive: false,
    postTitle: post.title,
    dateLabel: formatDate(post.date),
    bodyHtml: post.bodyHtml,
    tags: tagObjs(post.tags),
    ...shareLinks(post.url, post.title),
  }));
  writePage(post.url, html);
}

// ---------------------------------------------------------------------------
// Note pages
// ---------------------------------------------------------------------------

console.log('Building note pages…');
for (const post of notes) {
  const html = render('note', baseCtx({
    title: `Note — ${formatDate(post.date)} — ${CONFIG.siteName}`,
    description: excerpt(post.bodyHtml, 160),
    path: post.url,
    ogType: 'article',
    nav: navWithActive('notes'),
    aboutActive: false,
    dateLabel: formatDate(post.date),
    bodyHtml: post.bodyHtml,
    tags: tagObjs(post.tags),
    ...shareLinks(post.url, `Note — ${formatDate(post.date)}`),
  }));
  writePage(post.url, html);
}

// /notes/ feed
{
  const html = render('notes-feed', baseCtx({
    title: `Notes — ${CONFIG.siteName}`,
    description: 'Short notes and fragments.',
    path: '/notes/',
    nav: navWithActive('notes'),
    aboutActive: false,
    count: notes.length,
    countLabel: notes.length === 1 ? 'note' : 'notes',
    notes: notes.map(n => ({
      url: n.url,
      bodyHtml: n.bodyHtml,
      dateLabel: formatDate(n.date),
      tags: tagObjs(n.tags),
    })),
  }));
  writePage('/notes/', html);
}

// ---------------------------------------------------------------------------
// /type/{type}/ listing pages (essay, blog, review, verse)
// ---------------------------------------------------------------------------

console.log('Building type listing pages…');
const TYPE_COLLECTIONS = { essay: essays, blog: blogs, review: reviews, verse: verses };
for (const t of CONFIG.contentTypes) {
  if (t.id === 'note') continue; // notes has its own dedicated page
  const list = TYPE_COLLECTIONS[t.id] || [];
  const isReview = t.id === 'review';
  const isVerse = t.id === 'verse';
  const isWide = !isReview && !isVerse;

  const posts = list.map(p => {
    const stars = isReview ? starRating(p.rating) : null;
    return {
      url: p.url,
      title: p.title,
      titleLower: p.title.toLowerCase(),
      subtitle: p.subtitle,
      subLower: (p.subtitle || '').toLowerCase(),
      cover: p.cover,
      type: p.type,
      category: p.category,
      dateLabel: formatDate(p.date),
      author: CONFIG.author,
      reviewType: p.reviewType,
      rating: p.rating,
      starsDisplay: stars ? '★'.repeat(stars.full) + (stars.half ? '⯨' : '') + '☆'.repeat(stars.empty) : '',
      preview: p.preview || excerpt(p.bodyHtml, 140),
    };
  });

  const typePills = CONFIG.contentTypes.filter(x => x.id !== 'note').map(x => ({
    href: `/type/${x.id}/`, label: x.plural, isActive: x.id === t.id,
  }));

  const html = render('listing', baseCtx({
    title: `${t.plural} — ${CONFIG.siteName}`,
    description: `All ${t.plural.toLowerCase()} on ${CONFIG.siteName}.`,
    path: `/type/${t.id}/`,
    nav: navWithActive(t.id),
    aboutActive: false,
    label: t.plural,
    labelLower: t.label.toLowerCase(),
    count: posts.length,
    pieceLabel: posts.length === 1 ? `${t.label.toLowerCase()} published.` : `${t.plural.toLowerCase()} published.`,
    typePills,
    isWide, isReview, isVerse,
    posts,
  }));
  writePage(`/type/${t.id}/`, html);
}

// ---------------------------------------------------------------------------
// /category/{slug}/ pages
// ---------------------------------------------------------------------------

console.log('Building category pages…');
for (const cat of CONFIG.categories) {
  const slug = slugifyPath(cat);
  const catPosts = articleTypes.filter(p => p.category === cat);
  const months = groupByMonth(catPosts);

  const html = render('archive', baseCtx({
    title: `${cat} — ${CONFIG.siteName}`,
    description: `Essays, blogs and reviews filed under ${cat}.`,
    path: `/category/${slug}/`,
    nav: navWithActive(''),
    aboutActive: false,
    backHref: '/archive/',
    backLabel: 'All categories',
    title2: cat,
    title: `${cat} — ${CONFIG.siteName}`,
    sub: `${catPosts.length} piece${catPosts.length === 1 ? '' : 's'} filed under ${cat}.`,
    showPills: false,
    isEmpty: catPosts.length === 0,
    months,
  }));
  writePage(`/category/${slug}/`, html);
}

// ---------------------------------------------------------------------------
// /archive/ — everything, grouped by month, with type filter pills
// ---------------------------------------------------------------------------

console.log('Building archive…');
{
  const months = groupByMonth(allDated);
  const typePills = CONFIG.contentTypes.map(t => ({ filter: t.id, label: t.plural.toLowerCase() }));
  const html = render('archive', baseCtx({
    title: `Archive — ${CONFIG.siteName}`,
    description: `Every essay, blog, review, note and verse on ${CONFIG.siteName}, in one place.`,
    path: '/archive/',
    nav: navWithActive('archive'),
    aboutActive: false,
    title: `Archive — ${CONFIG.siteName}`,
    sub: `${allDated.length} pieces published since launch.`,
    showPills: true,
    typePills,
    isEmpty: allDated.length === 0,
    months,
  }));
  writePage('/archive/', html);
}

function groupByMonth(list) {
  const groups = new Map();
  for (const p of list) {
    const key = formatMonthYear(p.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return Array.from(groups.entries()).map(([label, posts]) => ({
    label,
    anchorId: slugifyPath(label),
    posts: posts.map(p => ({
      url: p.url,
      day: new Date(p.date).getDate(),
      title: p.title,
      type: p.type,
      typeLC: p.typeLC,
      category: p.category,
      isVerse: p.type === 'Verse',
    })),
  }));
}

// ---------------------------------------------------------------------------
// Search page + search-index.json
// ---------------------------------------------------------------------------

console.log('Building search…');
{
  const searchIndex = allDated.map(p => ({
    title: p.title,
    subtitle: p.subtitle,
    preview: p.preview || excerpt(p.bodyHtml, 200),
    type: p.type,
    category: p.category,
    url: p.url,
    dateLabel: formatDate(p.date),
  }));
  writeFile(path.join(OUT_DIR, 'search-index.json'), JSON.stringify(searchIndex));

  const html = render('search', baseCtx({
    title: `Search — ${CONFIG.siteName}`,
    description: `Search ${CONFIG.siteName}.`,
    path: '/search/',
    nav: navWithActive(''),
    aboutActive: false,
    types: CONFIG.contentTypes.map(t => ({ id: t.id, labelLower: t.label.toLowerCase() })),
  }));
  writePage('/search/', html);
}

// ---------------------------------------------------------------------------
// Custom pages (content/pages/*.md)
// ---------------------------------------------------------------------------

console.log('Building custom pages…');
for (const pg of pages) {
  const isAbout = pg.slug === 'about';
  const html = render('page', baseCtx({
    title: `${pg.title} — ${CONFIG.siteName}`,
    description: excerpt(pg.bodyHtml, 160),
    path: pg.url,
    nav: navWithActive(''),
    aboutActive: isAbout,
    postTitle: pg.title,
    bodyHtml: pg.bodyHtml,
  }));
  writePage(pg.url, html);
}

// ---------------------------------------------------------------------------
// RSS + sitemap + 404
// ---------------------------------------------------------------------------

console.log('Building RSS + sitemap…');
{
  const items = allDated.slice(0, 40).map(p => `
  <item>
    <title>${escapeXml(p.title)}</title>
    <link>${CONFIG.siteUrl}${p.url}</link>
    <guid>${CONFIG.siteUrl}${p.url}</guid>
    <pubDate>${new Date(p.date).toUTCString()}</pubDate>
    <description>${escapeXml(p.subtitle || excerpt(p.bodyHtml, 200))}</description>
  </item>`).join('');
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escapeXml(CONFIG.siteName)}</title>
  <link>${CONFIG.siteUrl}</link>
  <description>${escapeXml(CONFIG.description)}</description>${items}
</channel></rss>`;
  writeFile(path.join(OUT_DIR, 'rss.xml'), rss);

  const allUrls = [
    '/', '/about/', '/notes/', '/archive/', '/search/',
    ...CONFIG.contentTypes.filter(t => t.id !== 'note').map(t => `/type/${t.id}/`),
    ...CONFIG.categories.map(c => `/category/${slugifyPath(c)}/`),
    ...allDated.map(p => p.url),
    ...pages.map(p => p.url),
  ];
  const urlSet = [...new Set(allUrls)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlSet.map(u => `  <url><loc>${CONFIG.siteUrl}${u}</loc></url>`).join('\n')}
</urlset>`;
  writeFile(path.join(OUT_DIR, 'sitemap.xml'), sitemap);
}
function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

console.log('Building 404…');
{
  const html = render('404', baseCtx({
    title: `404 — ${CONFIG.siteName}`,
    description: 'Page not found.',
    path: '/404.html',
    nav: navWithActive(''),
    aboutActive: false,
  }));
  writeFile(path.join(OUT_DIR, '404.html'), html);
}

console.log(`\nDone. ${allDated.length} posts + ${pages.length} pages built into /site.`);

