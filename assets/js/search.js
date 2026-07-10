(function () {
  const input = document.getElementById('globalSearch');
  const results = document.getElementById('searchResults');
  const empty = document.getElementById('searchEmpty');
  const prompt = document.getElementById('searchPrompt');
  const pills = document.querySelectorAll('#filterPills .type-pill');
  if (!input) return;

  let index = [];
  let activeFilter = 'all';

  fetch('/search-index.json').then(function (r) { return r.json(); }).then(function (data) {
    index = data;
  }).catch(function () { index = []; });

  pills.forEach(function (pill) {
    pill.addEventListener('click', function () {
      pills.forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      runSearch();
    });
  });

  function highlight(text, q) {
    if (!q) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark>$1</mark>');
  }

  function runSearch() {
    const q = (input.value || '').toLowerCase().trim();

    if (!q && activeFilter === 'all') {
      results.innerHTML = '';
      empty.style.display = 'none';
      prompt.style.display = '';
      return;
    }
    prompt.style.display = 'none';

    const filtered = index.filter(function (p) {
      const typeMatch = activeFilter === 'all' || p.type === activeFilter;
      if (!q) return typeMatch;
      const hay = [p.title, p.subtitle, p.preview, p.category, p.type].join(' ').toLowerCase();
      return typeMatch && hay.includes(q);
    });

    if (!filtered.length) {
      results.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    results.innerHTML = filtered.map(function (p) {
      const typeLC = p.type.toLowerCase();
      const title = highlight(p.title || '(untitled)', q);
      const sub = p.subtitle ? '<div class="search-result-sub">' + highlight(p.subtitle, q) + '</div>' : '';
      const prev = p.preview ? '<div class="search-result-prev">' + highlight(p.preview.slice(0, 160), q) + '…</div>' : '';
      return (
        '<a href="' + p.url + '" class="search-result">' +
          '<div class="search-result-meta-row">' +
            '<span class="badge badge-' + typeLC + '">' + p.type + '</span>' +
            (p.category ? '<span class="search-result-cat">' + p.category + '</span>' : '') +
            '<span class="search-result-date">' + p.dateLabel + '</span>' +
          '</div>' +
          '<div class="search-result-title">' + title + '</div>' +
          sub + prev +
        '</a>'
      );
    }).join('');
  }

  input.addEventListener('input', runSearch);
})();
