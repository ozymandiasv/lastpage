(function () {
  const mount = document.getElementById('giscus-container');
  if (!mount) return;
  const cfg = window.__GISCUS__ || {};
  if (!cfg.repo) return;

  function inject(theme) {
    mount.innerHTML = '';
    const s = document.createElement('script');
    s.src = 'https://giscus.app/client.js';
    s.setAttribute('data-repo', cfg.repo);
    s.setAttribute('data-repo-id', cfg.repoId || '');
    s.setAttribute('data-category', cfg.category || 'Announcements');
    s.setAttribute('data-category-id', cfg.categoryId || '');
    s.setAttribute('data-mapping', 'pathname');
    s.setAttribute('data-strict', '0');
    s.setAttribute('data-reactions-enabled', '1');
    s.setAttribute('data-emit-metadata', '0');
    s.setAttribute('data-input-position', 'top');
    s.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    s.setAttribute('data-lang', 'en');
    s.setAttribute('crossorigin', 'anonymous');
    s.async = true;
    mount.appendChild(s);
  }

  inject(document.documentElement.getAttribute('data-theme'));

  document.addEventListener('themechange', function (e) {
    const iframe = document.querySelector('iframe.giscus-frame');
    if (iframe) {
      iframe.contentWindow.postMessage({ giscus: { setConfig: { theme: e.detail.theme === 'dark' ? 'dark' : 'light' } } }, 'https://giscus.app');
    }
  });
})();
