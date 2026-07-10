(function () {
  const POSTS_PER_PAGE = 8;
  const posts = Array.from(document.querySelectorAll('#recentPostsList .recent-post[data-page]'));
  if (!posts.length) return;
  let currentPage = 1;

  function update() {
    posts.forEach(function (p) {
      p.style.display = parseInt(p.dataset.page, 10) === currentPage ? '' : 'none';
    });
    const total = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
    const info = document.getElementById('pagInfo');
    if (info) info.textContent = 'Page ' + currentPage + ' of ' + total;
    const prev = document.getElementById('pagPrev');
    const next = document.getElementById('pagNext');
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= total;
  }

  const prevBtn = document.getElementById('pagPrev');
  const nextBtn = document.getElementById('pagNext');
  if (prevBtn) prevBtn.addEventListener('click', function () { currentPage--; update(); });
  if (nextBtn) nextBtn.addEventListener('click', function () { currentPage++; update(); });
  update();
})();
