/* ---------------- lesson path (Lesson tab in the lesson view) ----------------
   2026-11-18, Alireza's order: the Lesson tab shows all previous lessons as
   a winding path, drawn like the Grammar Path. One node = one lesson,
   oldest at the top, newest at the bottom, grouped by month. A lesson is
   ticked (green check) when its words were read to the end — the same
   `words` flag the streak rule uses. Unread lessons wear the lock marker
   ("not read yet", same as the Grammar Path) but stay tappable. The view
   auto-scrolls to the first unread lesson. Not a lesson step: STEPS and
   streak/XP rules are untouched. */
var LP_OFFSETS = [0, 46, 78, 46, 0, -46, -78, -46];
var LP_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function renderLessonPath(body) {
  var fa = false;
  try { fa = uiLang() === 'fa'; } catch (e) {}
  var lessons = (state.lessons || []).slice().sort(function (a, b) {
    return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
  });
  if (!lessons.length) {
    body.innerHTML = '<div class="empty">No lessons yet.</div>';
    return;
  }
  var readCount = 0;
  var currentDate = null;
  lessons.forEach(function (m) {
    if (getDayProgress(m.date).words) readCount++;
    else if (!currentDate) currentDate = m.date;
  });
  var html = '<div class="gp-progress"><div class="gp-progress-txt">' +
    (fa ? (readCount + ' از ' + lessons.length + ' درس خوانده شده')
        : (readCount + ' of ' + lessons.length + ' lessons read')) + '</div>' +
    '<div class="gp-bar"><div class="gp-bar-fill" style="width:' +
    Math.round(readCount / lessons.length * 100) + '%"></div></div></div>';
  var monthCount = {};
  lessons.forEach(function (m) {
    var k = m.date.slice(0, 7);
    monthCount[k] = (monthCount[k] || 0) + 1;
  });
  var curMonth = null, idx = 0;
  lessons.forEach(function (m) {
    var mon = m.date.slice(0, 7);
    if (mon !== curMonth) {
      curMonth = mon;
      var parts = m.date.split('-');
      html += '<div class="gp-sec" style="background:linear-gradient(135deg,#F6AC68,#E8833A)">' +
        '<b>' + LP_MONTHS[parseInt(parts[1], 10) - 1] + ' ' + parts[0] + '</b>' +
        '<span>' + monthCount[mon] + (fa ? ' درس' : ' lessons') + '</span></div>';
    }
    var done = !!getDayProgress(m.date).words;
    var isCurrent = m.date === currentDate;
    var dx = LP_OFFSETS[idx % LP_OFFSETS.length]; idx++;
    var sym = done ? '✓' : (isCurrent ? '★' : '\uD83D\uDD12');
    var cls = 'gp-node' + (done ? ' done' : '') + (isCurrent ? ' current' : '') +
      (!done && !isCurrent ? ' unread' : '');
    html += '<div class="gp-row" style="transform:translateX(' + dx + 'px)">' +
      (isCurrent ? '<span class="gp-start">' + (fa ? 'شروع' : 'START') + '</span>' : '') +
      '<a class="' + cls + '" href="#/lesson/' + m.date + '" data-lpdate="' + m.date + '" aria-label="' + esc(m.theme || m.date) + '">' +
      '<span class="gp-node-sym">' + sym + '</span></a>' +
      '<span class="gp-label">' + esc(m.theme || m.date) + '</span>' +
      '<span class="gp-score">' + esc(m.date) + (m.date === todayStr() ? (fa ? ' · امروز' : ' · Today') : '') + '</span>' +
      '</div>';
  });
  body.innerHTML = html;
  /* Opening a lesson from the path lands on its Words tab. */
  Array.prototype.forEach.call(body.querySelectorAll('[data-lpdate]'), function (a) {
    a.addEventListener('click', function () { state.lessonTab = 'words'; });
  });
  if (currentDate) {
    var cur = body.querySelector('.gp-node.current');
    if (cur) setTimeout(function () { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);
  }
}
