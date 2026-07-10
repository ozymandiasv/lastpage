(function () {
  // Theme toggle
  const root = document.documentElement;
  const btn = document.getElementById('themeBtn');
  const icon = btn ? btn.querySelector('i') : null;
  const saved = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', saved);
  if (icon) icon.className = saved === 'dark' ? 'ti ti-moon' : 'ti ti-sun';
  if (btn) {
    btn.addEventListener('click', function () {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      if (icon) icon.className = next === 'dark' ? 'ti ti-moon' : 'ti ti-sun';
      document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    });
  }

  // Reading progress bar
  const bar = document.getElementById('progress-bar');
  if (bar) {
    window.addEventListener('scroll', function () {
      const doc = document.documentElement;
      const pct = doc.scrollTop / (doc.scrollHeight - doc.clientHeight) * 100;
      bar.style.width = Math.min(pct, 100) + '%';
    }, { passive: true });
  }

  // Mobile menu toggle
  window.toggleMenu = function () {
    const menu = document.getElementById('mobileMenu');
    const toggleBtn = document.querySelector('.nav-toggle');
    if (!menu) return;
    menu.classList.toggle('open');
    if (toggleBtn) toggleBtn.classList.toggle('open');
  };
  const mobileMenu = document.getElementById('mobileMenu');
  if (mobileMenu) {
    mobileMenu.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        mobileMenu.classList.remove('open');
        const toggleBtn = document.querySelector('.nav-toggle');
        if (toggleBtn) toggleBtn.classList.remove('open');
      }
    });
  }
})();
