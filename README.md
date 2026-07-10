# Last Page

A lightweight, Git-powered publishing platform for a personal essays/blog/review/notes/verse
website — no Astro, no framework, no build dependencies. Plain Node.js generates a fully
static HTML/CSS/JS site from Markdown; a small local admin app lets you write, preview, and
publish everything with one click.

Everything — site, templates, generator, admin, and content — lives in this one repository.
If your server disappears, `git clone` and you're fully restored.

## How it's put together

```
content/            Your writing, as Markdown + frontmatter
  essays/*.md
  blogs/*.md
  reviews/*.md
  notes/*.md
  verses/*.md
  pages/*.md         Unlimited custom pages (About, Colophon, whatever you add)

data/
  config.json         Site name, nav, categories, review types, Giscus config
  admin-config.json    Local admin password (gitignored — do not commit your real one)

templates/           HTML templates rendered with a tiny {{mustache-ish}} engine
  partials/           head / nav / footer / scripts, shared by every page
  home.html, article.html, verse.html, note.html, listing.html,
  archive.html, page.html, search.html, notes-feed.html, 404.html

assets/              CSS + client JS + uploaded media, copied verbatim into the build
  css/style.css
  js/*.js
  uploads/            Images you upload from the admin

scripts/
  build.js            The static site generator — run this to (re)build /site
  serve.js            Minimal static file server for /site (preview or lightweight prod)
  lib/
    frontmatter.js     Tiny YAML-lite frontmatter parser
    markdown.js         Dependency-free Markdown → HTML converter
    template.js          The {{ }} template engine
    helpers.js            Dates, tag colours, slugs, star ratings, etc.

admin/
  server.js            Local admin backend (Node core modules only, no npm installs needed)
  public/              Admin frontend (vanilla JS SPA)

site/                 Generated output — this is what gets served to visitors
```

Nothing here needs `npm install`. The generator and admin server use only Node's built-in
modules, on purpose, so the whole thing keeps working with nothing but a working `git` and
a reasonably recent Node (18+).

## Content system

**Content Type** (Essay / Blog / Review / Note / Verse) is separate from **Category**
(Politics, History, Philosophy, Literature, Media, Sports, Science, Technology, Culture, Life).
A post has exactly one type and, if it's an Essay/Blog/Review, one category. Notes and Verses
skip category entirely — they're fragments, not filed pieces.

Reviews additionally carry a `reviewType` (Movie, TV Series, Anime, Book, Manga, Game,
Documentary, Album, Podcast) and a `rating` out of 10, which the templates also render as a
5-star scale.

Frontmatter looks like this:

```markdown
---
title: "Oppenheimer"
type: "Review"
category: "Media"
reviewType: "Movie"
rating: 9.5
date: "2026-06-20"
published: true
subtitle: "A one-line description shown on cards and in <head> meta"
cover: "https://example.com/cover.jpg"
tags:
  - Christopher Nolan
  - Cillian Murphy
---

Article body in Markdown from here down.
```

Set `published: false` to keep something as a draft — the generator skips it entirely.

## Building the site

```
node scripts/build.js
```

Reads everything in `content/`, renders it through `templates/`, and writes a complete
static site into `/site`. Safe to run as often as you like — it wipes and regenerates
`/site` from scratch every time.

Preview it locally:

```
node scripts/serve.js 8080
# → http://localhost:8080
```

## The homepage's featured logic

The top-5 "hero" section always shows the five most recent posts across Essays and Blogs
combined, in whatever mix that turns out to be. The Essays row and Blogs row then show
**the next posts after whichever ones from that type made it into the top 5** — so if 3 blogs
and 2 essays are currently featured, the Essay row starts at essay #3 and the Blog row starts
at blog #4. This is computed in `scripts/build.js`, not hardcoded.

The homepage calendar marks every date on which *anything* (essay, blog, review, note, or
verse) was published.

## The admin dashboard

```
node admin/server.js        # → http://127.0.0.1:4321
```

This is meant to run **only on your own machine or your own server**, bound to
`127.0.0.1` by default — do not expose it to the public internet. The default password is
`changeme`, set in `data/admin-config.json` (gitignored); change it before you start using
this for real.

It gives you:

- **Posts** — create/edit/delete any Essay, Blog, Review, Note, or Verse; toggle
  Draft/Published; a live Markdown editor with a Preview tab that renders through the exact
  same Markdown engine the real build uses, so what you see is what you get.
- **Pages** — unlimited custom static pages.
- **Media** — drag-and-drop image uploads, stored in `assets/uploads/` and served at
  `/assets/uploads/...`.
- **Git & Publish** — see working-tree status, Pull, Push, Commit, and a one-click
  **Publish** button that runs the build, commits everything, and pushes to GitHub in one
  step.

## Git workflow

The whole repo — content, templates, generator, admin, and the generated `/site` — is meant
to be committed. Your Mac, your server, and GitHub stay in sync by all pulling from and
pushing to the same repo:

```
Mac  ⇄  GitHub  ⇄  Server
```

Typical loop from the admin's Git tab:

1. **Pull** — grab anything pushed from elsewhere first.
2. Write/edit posts in the Editor.
3. **Publish** — builds `/site`, commits everything with your message, and pushes.

Your server just needs to serve `/site` (via `node scripts/serve.js`, or point nginx/Caddy
at the directory) and periodically `git pull` — or run the admin there directly and hit
Publish/Pull from its Git tab.

## Comments (Giscus)

Set your repo details in `data/config.json`:

```json
"giscus": {
  "repo": "yourname/your-repo",
  "repoId": "...",
  "category": "Announcements",
  "categoryId": "..."
}
```

Get `repoId`/`categoryId` from https://giscus.app after enabling Discussions on your GitHub
repo. Comments render on every Essay, Blog, Review, Note, and Verse page and follow the
site's light/dark theme automatically.

## Adding a category, content type, or nav link

Everything driving the chrome — nav links, the 10 categories, the 9 review types, social
links, Giscus config — lives in `data/config.json`. Edit it and re-run the build; no template
changes required for a new category. Adding a genuinely new *content type* (beyond
Essay/Blog/Review/Note/Verse) touches a few more places (`scripts/build.js`'s
`TYPE_COLLECTIONS`/`TYPE_PATH`, `admin/server.js`'s `TYPE_DIR`/`TYPE_LABEL`) since each type
has its own content folder and URL prefix.
