(function () {
  const pills = document.querySelectorAll('.type-pill[data-filter]');
  const rows = document.querySelectorAll('[data-type]');
  if (!pills.length || !rows.length) return;

  function filter(type) {
    rows.forEach(function (r) {
      r.style.display = (type === 'all' || r.dataset.type === type) ? '' : 'none';
    });
    document.querySelectorAll('.archive-month').forEach(function (hdr) {
      let sib = hdr.nextElementSibling;
      let visible = false;
      while (sib && !sib.classList.contains('archive-month')) {
        if (sib.style.display !== 'none') visible = true;
        sib = sib.nextElementSibling;
      }
      hdr.style.display = visible ? '' : 'none';
    });
  }

  pills.forEach(function (pill) {
    pill.addEventListener('click', function (e) {
      e.preventDefault();
      pills.forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      filter(pill.dataset.filter);
    });
  });
})();
