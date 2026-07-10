(function () {
  'use strict';

  // ------------------------------------------------------------------
  // API helper
  // ------------------------------------------------------------------
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
    return data;
  }

  function toast(msg, type) {
    const el = document.getElementById('toast') || (function () {
      const t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
      return t;
    })();
    el.textContent = msg;
    el.className = 'show' + (type ? ' ' + type : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ''; }, 3200);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------
  const loginScreen = document.getElementById('loginScreen');
  const app = document.getElementById('app');

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('loginPassword').value;
    const err = document.getElementById('loginError');
    err.textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: { password: pw } });
      loginScreen.classList.add('hidden');
      app.classList.remove('hidden');
      router();
    } catch (e2) {
      err.textContent = e2.message;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
  });

  async function checkAuth() {
    const s = await api('/api/session');
    if (s.loggedIn) {
      loginScreen.classList.add('hidden');
      app.classList.remove('hidden');
      router();
    } else {
      loginScreen.classList.remove('hidden');
      app.classList.add('hidden');
    }
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  const main = document.getElementById('main');
  const TYPE_LABELS = { essay: 'Essay', blog: 'Blog', review: 'Review', note: 'Note', verse: 'Verse' };

  const routes = {
    dashboard: renderDashboard,
    posts: renderPosts,
    editor: renderEditor,
    pages: renderPages,
    pageEditor: renderPageEditor,
    media: renderMedia,
    git: renderGit,
  };

  function router() {
    const hash = location.hash.replace(/^#\//, '');
    const parts = hash.split('/').filter(Boolean);
    let name = parts[0] || 'dashboard';

    document.querySelectorAll('.sidebar-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.route === name);
    });

    if (name === 'editor') return renderEditor(parts[1], parts[2]); // new|edit, type/slug
    if (name === 'page-editor') return renderPageEditor(parts[1]);  // new|slug
    (routes[name] || renderDashboard)();
  }
  window.addEventListener('hashchange', router);

  // ------------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------------
  async function renderDashboard() {
    main.innerHTML = '<div class="page-title">Dashboard</div><div class="page-sub">Loading…</div>';
    const d = await api('/api/dashboard');
    main.innerHTML = `
      <div class="page-title">Dashboard</div>
      <div class="page-sub">Overview of your content and repository.</div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-num">${d.total}</div><div class="stat-label">Total posts</div></div>
        <div class="stat-card"><div class="stat-num">${d.published}</div><div class="stat-label">Published</div></div>
        <div class="stat-card"><div class="stat-num">${d.drafts}</div><div class="stat-label">Drafts</div></div>
        <div class="stat-card"><div class="stat-num">${d.dirtyFiles}</div><div class="stat-label">Uncommitted files</div></div>
      </div>
      <div class="panel">
        <div class="panel-title">By type</div>
        <div class="stat-grid">
          ${Object.entries(d.byType).map(([t, n]) => `<div class="stat-card"><div class="stat-num">${n}</div><div class="stat-label">${TYPE_LABELS[t] || t}</div></div>`).join('')}
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">Recent Git activity</div>
        ${d.recentGitLog.length ? d.recentGitLog.map(l => `
          <div class="git-log-item">
            <span class="git-log-hash">${esc(l.hash)}</span>
            <div class="git-log-msg">${esc(l.message)}</div>
            <div class="git-log-meta">${esc(l.author)} · ${esc(l.when)}</div>
          </div>`).join('') : '<div class="small-note">No git history found.</div>'}
      </div>
      <div style="display:flex;gap:10px;">
        <a href="#/editor/new/essay" class="btn btn-primary">+ New Essay</a>
        <a href="#/editor/new/blog" class="btn">+ New Blog</a>
        <a href="#/editor/new/review" class="btn">+ New Review</a>
        <a href="#/editor/new/note" class="btn">+ New Note</a>
        <a href="#/editor/new/verse" class="btn">+ New Verse</a>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Posts list
  // ------------------------------------------------------------------
  async function renderPosts() {
    main.innerHTML = '<div class="page-title">Posts</div><div class="page-sub">Loading…</div>';
    const cfg = await api('/api/config');
    let state = { type: '', status: '', q: '' };

    async function load() {
      const qs = new URLSearchParams();
      if (state.type) qs.set('type', state.type);
      if (state.status) qs.set('status', state.status);
      if (state.q) qs.set('q', state.q);
      const posts = await api('/api/posts?' + qs.toString());
      document.getElementById('postsTableBody').innerHTML = posts.length ? posts.map(p => `
        <tr>
          <td><span class="type-chip">${TYPE_LABELS[p.typeId]}</span></td>
          <td><a class="row-title" href="#/editor/edit/${p.typeId}/${p.slug}">${esc(p.title)}</a></td>
          <td>${esc(p.category) || '—'}</td>
          <td>${esc(p.date) || '—'}</td>
          <td><span class="pill ${p.published ? 'pill-published' : 'pill-draft'}">${p.published ? 'Published' : 'Draft'}</span></td>
          <td class="row-actions">
            <a class="btn btn-sm" href="#/editor/edit/${p.typeId}/${p.slug}">Edit</a>
            <button class="btn btn-sm btn-danger" data-del="${p.typeId}/${p.slug}">Delete</button>
          </td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="small-note" style="padding:20px 10px;">No posts match.</td></tr>';

      document.getElementById('postsTableBody').querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this post permanently?')) return;
          const [t, s] = btn.dataset.del.split('/');
          await api(`/api/posts/${t}/${s}`, { method: 'DELETE' });
          toast('Post deleted', 'success');
          load();
        });
      });
    }

    main.innerHTML = `
      <div class="page-title">Posts</div>
      <div class="page-sub">Create, edit, and manage everything you've published.</div>
      <div class="toolbar">
        <select id="fType">
          <option value="">All types</option>
          ${cfg.contentTypes.map(t => `<option value="${t.id}">${t.plural}</option>`).join('')}
        </select>
        <select id="fStatus">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <input type="text" id="fSearch" placeholder="Search title…">
        <div style="flex:1;"></div>
        <a href="#/editor/new/essay" class="btn btn-primary">+ New Post</a>
      </div>
      <table class="post-table">
        <thead><tr><th>Type</th><th>Title</th><th>Category</th><th>Date</th><th>Status</th><th></th></tr></thead>
        <tbody id="postsTableBody"></tbody>
      </table>
    `;
    document.getElementById('fType').addEventListener('change', e => { state.type = e.target.value; load(); });
    document.getElementById('fStatus').addEventListener('change', e => { state.status = e.target.value; load(); });
    document.getElementById('fSearch').addEventListener('input', e => { state.q = e.target.value; load(); });
    load();
  }

  // ------------------------------------------------------------------
  // Post editor (Essay / Blog / Review / Note / Verse)
  // ------------------------------------------------------------------
  async function renderEditor(mode, typeAndSlug) {
    // typeAndSlug is "type" for new, or "type/slug" for edit — router passes parts[1]/parts[2]
    let type = typeAndSlug;
    let slug = null;
    if (mode === 'edit') {
      const parts = location.hash.split('/');
      type = parts[3]; slug = parts[4];
    }
    const isNew = mode === 'new';
    const cfg = await api('/api/config');

    let post = { data: { type: TYPE_LABELS[type], published: true, date: new Date().toISOString().slice(0, 10), tags: [] }, body: '' };
    if (!isNew) post = await api(`/api/posts/${type}/${slug}`);

    const isVerse = type === 'verse';
    const isNote = type === 'note';
    const isReview = type === 'review';
    const tags = post.data.tags || [];

    main.innerHTML = `
      <div class="page-title">${isNew ? 'New' : 'Edit'} ${TYPE_LABELS[type]}</div>
      <div class="page-sub">${isNote ? 'Notes have no title — just write the fragment.' : 'Fill in the details, write in Markdown, and preview before saving.'}</div>
      <div class="editor-grid">
        <div class="editor-main">
          ${isNote ? '' : `<input type="text" id="eTitle" class="editor-title-input" placeholder="Title" value="${esc(post.data.title || '')}">`}
          ${isNote ? '' : `<input type="text" id="eSubtitle" placeholder="Subtitle (optional)" value="${esc(post.data.subtitle || '')}">`}

          <div class="editor-tabs">
            <div class="editor-tab active" data-tab="write">Write</div>
            <div class="editor-tab" data-tab="preview">Preview</div>
          </div>
          <div id="tabWrite">
            <textarea id="eBody" class="markdown-textarea" placeholder="${isVerse ? 'Write your verse. Blank lines separate stanzas.' : 'Write in Markdown…'}">${esc(post.body || '')}</textarea>
          </div>
          <div id="tabPreview" class="hidden">
            <div id="mdPreview" class="md-preview"></div>
          </div>
        </div>

        <div class="editor-sidebar">
          <div class="panel">
            <div class="toggle-row">
              <label style="margin:0;">Published</label>
              <input type="checkbox" id="ePublished" ${post.data.published !== false ? 'checked' : ''}>
            </div>
            <div style="margin-top:12px;">
              <label>Date</label>
              <input type="date" id="eDate" value="${esc(post.data.date || new Date().toISOString().slice(0,10))}" style="width:100%;">
            </div>
          </div>

          ${isNote ? '' : `
          <div class="panel">
            <label>Category</label>
            <select id="eCategory" style="width:100%;">
              <option value="">—</option>
              ${cfg.categories.map(c => `<option value="${c}" ${post.data.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <div style="margin-top:12px;">
              <label>Cover image URL</label>
              <input type="text" id="eCover" placeholder="https://…" value="${esc(post.data.cover || '')}" style="width:100%;">
              <img id="coverPreview" class="cover-preview ${post.data.cover ? '' : 'hidden'}" src="${esc(post.data.cover || '')}">
            </div>
          </div>`}

          ${isReview ? `
          <div class="panel">
            <label>Review type</label>
            <select id="eReviewType" style="width:100%;">
              ${cfg.reviewTypes.map(r => `<option value="${r}" ${post.data.reviewType === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <div style="margin-top:12px;">
              <label>Rating (out of 10)</label>
              <input type="number" id="eRating" min="0" max="10" step="0.5" value="${post.data.rating != null ? post.data.rating : ''}" style="width:100%;">
            </div>
          </div>` : ''}

          <div class="panel">
            <label>Tags</label>
            <input type="text" id="eTagInput" placeholder="Type a tag and press Enter">
            <div class="tag-input-list" id="eTagList"></div>
          </div>

          ${isVerse || isNote ? '' : `
          <div class="panel">
            <label>Preview text (used in row previews; auto-generated if empty)</label>
            <textarea id="ePreviewText" rows="3" style="width:100%;">${esc(post.data.preview || '')}</textarea>
          </div>`}

          <div class="editor-save-row">
            ${isNew ? '' : `<button class="btn btn-danger" id="eDelete">Delete</button>`}
            <button class="btn btn-primary" id="eSave">${isNew ? 'Create' : 'Save changes'}</button>
          </div>
        </div>
      </div>
    `;

    // Tags
    let tagState = tags.slice();
    function renderTags() {
      document.getElementById('eTagList').innerHTML = tagState.map((t, i) =>
        `<span class="tag-chip">${esc(t)}<button data-i="${i}">×</button></span>`).join('');
      document.getElementById('eTagList').querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => { tagState.splice(Number(b.dataset.i), 1); renderTags(); });
      });
    }
    renderTags();
    document.getElementById('eTagInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        e.preventDefault();
        tagState.push(e.target.value.trim());
        e.target.value = '';
        renderTags();
      }
    });

    // Cover preview
    const coverInput = document.getElementById('eCover');
    if (coverInput) {
      coverInput.addEventListener('input', () => {
        const img = document.getElementById('coverPreview');
        img.src = coverInput.value;
        img.classList.toggle('hidden', !coverInput.value);
      });
    }

    // Tabs
    document.querySelectorAll('.editor-tab').forEach(tabEl => {
      tabEl.addEventListener('click', async () => {
        document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
        tabEl.classList.add('active');
        const isPreview = tabEl.dataset.tab === 'preview';
        document.getElementById('tabWrite').classList.toggle('hidden', isPreview);
        document.getElementById('tabPreview').classList.toggle('hidden', !isPreview);
        if (isPreview) {
          const body = document.getElementById('eBody').value;
          const r = await api('/api/render', { method: 'POST', body: { body, mode: isVerse ? 'verse' : 'md' } });
          document.getElementById('mdPreview').innerHTML = r.html;
        }
      });
    });

    // Save
    document.getElementById('eSave').addEventListener('click', async () => {
      const data = Object.assign({}, post.data, {
        type: TYPE_LABELS[type],
        published: document.getElementById('ePublished').checked,
        date: document.getElementById('eDate').value,
        tags: tagState,
      });
      if (!isNote) {
        data.title = document.getElementById('eTitle').value.trim();
        data.subtitle = document.getElementById('eSubtitle').value.trim();
        data.category = document.getElementById('eCategory').value;
        data.cover = document.getElementById('eCover').value.trim();
        const prevEl = document.getElementById('ePreviewText');
        if (prevEl) data.preview = prevEl.value.trim();
        if (!data.title) return toast('Title is required', 'error');
      }
      if (isReview) {
        data.reviewType = document.getElementById('eReviewType').value;
        data.rating = Number(document.getElementById('eRating').value || 0);
      }
      const body = document.getElementById('eBody').value;
      try {
        if (isNew) {
          const r = await api(`/api/posts/${type}`, { method: 'POST', body: { data, body } });
          toast('Created', 'success');
          location.hash = `#/editor/edit/${type}/${r.slug}`;
        } else {
          await api(`/api/posts/${type}/${slug}`, { method: 'PUT', body: { data, body } });
          toast('Saved', 'success');
        }
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    const delBtn = document.getElementById('eDelete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this post permanently?')) return;
      await api(`/api/posts/${type}/${slug}`, { method: 'DELETE' });
      toast('Deleted', 'success');
      location.hash = '#/posts';
    });
  }

  // ------------------------------------------------------------------
  // Custom pages
  // ------------------------------------------------------------------
  async function renderPages() {
    main.innerHTML = '<div class="page-title">Pages</div><div class="page-sub">Loading…</div>';
    const list = await api('/api/pages');
    main.innerHTML = `
      <div class="page-title">Pages</div>
      <div class="page-sub">Unlimited custom pages — About, Colophon, Contact, whatever you need.</div>
      <div class="toolbar"><div style="flex:1;"></div><a href="#/page-editor/new" class="btn btn-primary">+ New Page</a></div>
      <table class="post-table">
        <thead><tr><th>Title</th><th>URL</th><th></th></tr></thead>
        <tbody>
          ${list.map(p => `
            <tr>
              <td><a class="row-title" href="#/page-editor/${p.slug}">${esc(p.title)}</a></td>
              <td class="small-note">/${p.slug === 'about' ? 'about' : p.slug}/</td>
              <td class="row-actions">
                <a class="btn btn-sm" href="#/page-editor/${p.slug}">Edit</a>
                <button class="btn btn-sm btn-danger" data-del="${p.slug}">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    main.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this page?')) return;
        await api(`/api/pages/${btn.dataset.del}`, { method: 'DELETE' });
        toast('Page deleted', 'success');
        renderPages();
      });
    });
  }

  async function renderPageEditor(slugParam) {
    const isNew = slugParam === 'new';
    let page = { slug: '', data: { title: '', showInNav: false, navLabel: '', navOrder: 50 }, body: '' };
    if (!isNew) page = await api(`/api/pages/${slugParam}`);

    main.innerHTML = `
      <div class="page-title">${isNew ? 'New Page' : 'Edit Page'}</div>
      <div class="page-sub">Custom static page rendered with the site's default page template.</div>
      <div class="editor-grid">
        <div class="editor-main">
          <input type="text" id="pTitle" class="editor-title-input" placeholder="Page title" value="${esc(page.data.title || '')}">
          <div class="editor-tabs">
            <div class="editor-tab active" data-tab="write">Write</div>
            <div class="editor-tab" data-tab="preview">Preview</div>
          </div>
          <div id="tabWrite"><textarea id="pBody" class="markdown-textarea">${esc(page.body || '')}</textarea></div>
          <div id="tabPreview" class="hidden"><div id="pPreview" class="md-preview"></div></div>
        </div>
        <div class="editor-sidebar">
          <div class="panel">
            <label>URL slug</label>
            <input type="text" id="pSlug" value="${esc(page.slug || '')}" ${page.slug === 'about' ? 'disabled' : ''} style="width:100%;">
            <div class="small-note">Page will be published at /slug/</div>
          </div>
          <div class="panel">
            <div class="toggle-row"><label style="margin:0;">Show in nav</label><input type="checkbox" id="pShowNav" ${page.data.showInNav ? 'checked' : ''}></div>
            <div style="margin-top:12px;"><label>Nav label</label><input type="text" id="pNavLabel" value="${esc(page.data.navLabel || '')}" style="width:100%;"></div>
          </div>
          <div class="editor-save-row">
            ${isNew ? '' : `<button class="btn btn-danger" id="pDelete">Delete</button>`}
            <button class="btn btn-primary" id="pSave">${isNew ? 'Create' : 'Save changes'}</button>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('.editor-tab').forEach(tabEl => {
      tabEl.addEventListener('click', async () => {
        document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
        tabEl.classList.add('active');
        const isPreview = tabEl.dataset.tab === 'preview';
        document.getElementById('tabWrite').classList.toggle('hidden', isPreview);
        document.getElementById('tabPreview').classList.toggle('hidden', !isPreview);
        if (isPreview) {
          const body = document.getElementById('pBody').value;
          const r = await api('/api/render', { method: 'POST', body: { body } });
          document.getElementById('pPreview').innerHTML = r.html;
        }
      });
    });

    document.getElementById('pSave').addEventListener('click', async () => {
      const title = document.getElementById('pTitle').value.trim();
      if (!title) return toast('Title is required', 'error');
      const data = {
        title,
        showInNav: document.getElementById('pShowNav').checked,
        navLabel: document.getElementById('pNavLabel').value.trim() || title,
        published: true,
      };
      const body = document.getElementById('pBody').value;
      const slugVal = document.getElementById('pSlug').value.trim();
      try {
        if (isNew) {
          const r = await api('/api/pages', { method: 'POST', body: { slug: slugVal, data, body } });
          toast('Page created', 'success');
          location.hash = `#/page-editor/${r.slug}`;
        } else {
          await api(`/api/pages/${page.slug}`, { method: 'PUT', body: { slug: slugVal, data, body } });
          toast('Saved', 'success');
        }
      } catch (e) { toast(e.message, 'error'); }
    });

    const delBtn = document.getElementById('pDelete');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm('Delete this page?')) return;
      await api(`/api/pages/${page.slug}`, { method: 'DELETE' });
      toast('Deleted', 'success');
      location.hash = '#/pages';
    });
  }

  // ------------------------------------------------------------------
  // Media
  // ------------------------------------------------------------------
  async function renderMedia() {
    main.innerHTML = `
      <div class="page-title">Media</div>
      <div class="page-sub">Upload cover images and other assets. Files live in /assets/uploads.</div>
      <div class="dropzone" id="dropzone">Click or drag images here to upload</div>
      <input type="file" id="fileInput" accept="image/*" multiple class="hidden">
      <div class="media-grid" id="mediaGrid"></div>
    `;
    async function load() {
      const files = await api('/api/media');
      document.getElementById('mediaGrid').innerHTML = files.map(f => `
        <div class="media-item">
          <img src="${esc(f.url)}" loading="lazy">
          <div class="media-item-meta">
            <span class="media-item-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <button class="btn btn-sm btn-danger" data-del="${esc(f.name)}" style="padding:2px 7px;">×</button>
          </div>
        </div>
      `).join('') || '<div class="small-note">No media uploaded yet.</div>';
      document.getElementById('mediaGrid').querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          await api(`/api/media/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
          load();
        });
      });
    }

    const dz = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    dz.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => uploadFiles(e.dataTransfer.files));
    fileInput.addEventListener('change', e => uploadFiles(e.target.files));

    async function uploadFiles(fileList) {
      for (const file of fileList) {
        const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
        await api('/api/media', { method: 'POST', body: { name: file.name, data: dataUrl } });
      }
      toast('Uploaded', 'success');
      load();
    }
    load();
  }

  // ------------------------------------------------------------------
  // Git & Publish
  // ------------------------------------------------------------------
  async function renderGit() {
    main.innerHTML = '<div class="page-title">Git &amp; Publish</div><div class="page-sub">Loading…</div>';
    const status = await api('/api/git/status');
    main.innerHTML = `
      <div class="page-title">Git &amp; Publish</div>
      <div class="page-sub">Branch <b>${esc(status.branch)}</b> · ${status.ahead != null ? status.ahead + ' ahead, ' + status.behind + ' behind origin' : 'no upstream tracking'}</div>

      <div class="panel">
        <div class="panel-title">Working tree ${status.files.length ? '(' + status.files.length + ' changed)' : '(clean)'}</div>
        <div class="git-file-list">
          ${status.files.map(f => `<div class="git-file-row"><span class="git-file-code">${esc(f.code || '?')}</span><span>${esc(f.file)}</span></div>`).join('') || '<div class="small-note">Nothing to commit.</div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Sync</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="btn" id="btnPull">Git Pull</button>
          <button class="btn" id="btnPush">Git Push</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Commit</div>
        <input type="text" id="commitMsg" placeholder="Commit message" style="width:100%;margin-bottom:10px;">
        <button class="btn" id="btnCommit">Commit changes</button>
      </div>

      <div class="panel">
        <div class="panel-title">Publish</div>
        <div class="small-note" style="margin-bottom:10px;">Builds the static site, commits everything, and pushes to GitHub — in one step.</div>
        <input type="text" id="publishMsg" placeholder="Publish message (optional)" style="width:100%;margin-bottom:10px;">
        <button class="btn btn-primary" id="btnPublish">Publish site</button>
      </div>

      <div id="gitLogOutput"></div>
    `;

    function showLog(entries) {
      const box = document.getElementById('gitLogOutput');
      box.innerHTML = '<div class="publish-log">' + entries.map(l =>
        `$ ${esc(l.step || l.cmd || '')}\n${esc(l.stdout || '')}${l.stderr ? '\n' + esc(l.stderr) : ''}`
      ).join('\n\n') + '</div>';
    }

    document.getElementById('btnPull').addEventListener('click', async () => {
      const r = await api('/api/git/pull', { method: 'POST' });
      showLog([Object.assign({ step: 'git pull' }, r)]);
      toast(r.ok ? 'Pulled latest' : 'Pull failed', r.ok ? 'success' : 'error');
      renderGit();
    });
    document.getElementById('btnPush').addEventListener('click', async () => {
      const r = await api('/api/git/push', { method: 'POST' });
      showLog([Object.assign({ step: 'git push' }, r)]);
      toast(r.ok ? 'Pushed' : 'Push failed', r.ok ? 'success' : 'error');
      renderGit();
    });
    document.getElementById('btnCommit').addEventListener('click', async () => {
      const message = document.getElementById('commitMsg').value.trim() || 'Update content';
      const r = await api('/api/git/commit', { method: 'POST', body: { message } });
      showLog([Object.assign({ step: 'git commit' }, r)]);
      toast(r.ok ? 'Committed' : 'Commit failed', r.ok ? 'success' : 'error');
      renderGit();
    });
    document.getElementById('btnPublish').addEventListener('click', async () => {
      const message = document.getElementById('publishMsg').value.trim() || 'Publish site update';
      const btn = document.getElementById('btnPublish');
      btn.disabled = true; btn.textContent = 'Publishing…';
      try {
        const r = await api('/api/publish', { method: 'POST', body: { message } });
        showLog(r.log);
        toast('Published', 'success');
      } catch (e) {
        toast(e.message, 'error');
      }
      btn.disabled = false; btn.textContent = 'Publish site';
    });
  }

  checkAuth();
})();
