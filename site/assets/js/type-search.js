(function () {
  const input = document.getElementById('typeSearch');
  const items = Array.from(document.querySelectorAll('.type-post-item'));
  const noResults = document.getElementById('typeNoResults');
  if (!input) return;

  input.addEventListener('input', function () {
    const q = input.value.toLowerCase().trim();
    let visible = 0;
    items.forEach(function (item) {
      const title = (item.dataset.title || '');
      const sub = (item.dataset.sub || '');
      const match = !q || title.includes(q) || sub.includes(q);
      item.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    if (noResults) noResults.style.display = visible === 0 ? '' : 'none';
  });
})();
