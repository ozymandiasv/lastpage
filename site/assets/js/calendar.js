(function () {
  const cal = document.getElementById('homeCalendar');
  if (!cal) return;
  const raw = cal.dataset.dates || '';
  const postDates = new Set(raw.split(',').filter(Boolean));

  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();

  function render() {
    const label = new Date(year, month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    document.getElementById('calMonthLabel').textContent = label;

    const grid = document.getElementById('calGrid');
    grid.innerHTML = '';

    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (d) {
      const el = document.createElement('div');
      el.className = 'cal-day-hdr';
      el.textContent = d;
      grid.appendChild(el);
    });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      el.textContent = '·';
      grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const el = document.createElement('div');
      const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      const hasPost = postDates.has(dateStr);
      el.className = 'cal-day' + (hasPost ? ' has-post' : '') + (isToday ? ' today' : '');
      el.innerHTML = '<span class="cal-day-num">' + d + '</span>';
      if (hasPost) {
        el.title = 'Published on ' + new Date(dateStr).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
        el.addEventListener('click', function () {
          window.location.href = '/archive/#' + dateStr;
        });
      }
      grid.appendChild(el);
    }
  }

  const prevBtn = document.getElementById('calPrev');
  const nextBtn = document.getElementById('calNext');
  if (prevBtn) prevBtn.addEventListener('click', function () { month--; if (month < 0) { month = 11; year--; } render(); });
  if (nextBtn) nextBtn.addEventListener('click', function () { month++; if (month > 11) { month = 0; year++; } render(); });

  render();
})();
