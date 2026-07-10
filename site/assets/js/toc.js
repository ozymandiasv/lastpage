(function () {
  const links = Array.from(document.querySelectorAll('.toc-list a'));
  if (!links.length) return;
  const headings = links
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);

  function setActive(id) {
    links.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + id);
    });
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-90px 0px -70% 0px', threshold: 0 });
    headings.forEach(function (h) { observer.observe(h); });
  }

  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.getElementById(a.getAttribute('href').slice(1));
      if (target) {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 78, behavior: 'smooth' });
      }
    });
  });
})();
