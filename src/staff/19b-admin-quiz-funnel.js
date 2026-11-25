/* ---------------- admin panel: quiz funnel (/manage/quiz-funnel). Claude, 2026-11-25 ----------------
   One row = one learner + one lesson date. Counts only lessons opened after
   quiz tracking went live (AP_QF_START), so every step is measured the same way.
   Sources: scores (lesson_open, words_viewed; ref = lesson date) and app_events
   (quiz_nudge, quiz_start, quiz_exit, quiz_completed; meta.date = lesson date),
   written by src/app/18b-quiz-door.js and 19-quiz.js. Word quiz only.
   Staff accounts (admin emails, teachers) are left out. */
var AP_QF_START = '2026-11-25T16:07:00Z';
async function apQfFetch(table, cols, field, values, sinceISO) {
  var rows = [], page = 1000;
  for (var from = 0; from < 100000; from += page) {
    var r = await sb.from(table).select(cols).in(field, values).gte('created_at', sinceISO)
      .order('created_at', { ascending: true }).range(from, from + page - 1);
    if (r.error) throw r.error;
    rows = rows.concat(r.data || []);
    if (!r.data || r.data.length < page) break;
  }
  return rows;
}
async function apRenderQuizFunnel(v) {
  v.innerHTML = apShell('quiz-funnel',
    '<div class="ap-head"><h1>🎯 Quiz funnel</h1><p class="muted">From opening a lesson to finishing its word quiz. One row is one learner on one lesson. ' +
    'Counted from ' + esc(AP_QF_START.slice(0, 16).replace('T', ' ')) + ' UTC, when quiz tracking started. Staff accounts are left out.</p></div>' +
    '<div class="ap-seg" id="ap-qf-days">' + [7, 14, 30].map(function (d) {
      return '<button class="ap-seg-btn" data-qf-days="' + d + '">Last ' + d + ' days</button>';
    }).join('') + '</div>' +
    '<div id="ap-qf-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  var host = v.querySelector('#ap-qf-host');
  var scores, events, staff = {};
  try {
    var since = new Date(Date.now() - 30 * 86400000).toISOString();
    if (since < AP_QF_START) since = AP_QF_START;
    var res = await Promise.all([
      apQfFetch('scores', 'user_id,action,ref,created_at', 'action', ['lesson_open', 'words_viewed'], since),
      apQfFetch('app_events', 'user_id,event,meta,created_at', 'event', ['quiz_nudge', 'quiz_start', 'quiz_exit', 'quiz_completed'], since),
      sb.from('teachers').select('user_id'),
      sb.from('profiles').select('id').in('email', (APP_CONFIG.ADMIN_EMAILS || []))
    ]);
    scores = res[0]; events = res[1];
    ((res[2] && res[2].data) || []).forEach(function (t) { if (t.user_id) staff[t.user_id] = 1; });
    ((res[3] && res[3].data) || []).forEach(function (p) { staff[p.id] = 1; });
  } catch (e) { scores = null; }
  if (!scores) { host.innerHTML = '<div class="empty">Could not load quiz data.</div>'; return; }

  var draw = function (days) {
    var since = new Date(Date.now() - days * 86400000).toISOString();
    if (since < AP_QF_START) since = AP_QF_START;
    var P = {};
    var pair = function (uid, date) {
      var k = uid + '|' + date;
      return P[k] || (P[k] = { open: 0, words: 0, nudge: 0, nudgeGo: 0, nudgeLater: 0, start: 0, from: '', done: 0, exitAt: 0, exitHow: '', secs: null });
    };
    scores.forEach(function (r) {
      if (staff[r.user_id] || !r.ref || r.created_at < since) return;
      var p = pair(r.user_id, r.ref);
      if (r.action === 'lesson_open') p.open = 1; else if (r.action === 'words_viewed') p.words = 1;
    });
    events.forEach(function (r) {
      var m = r.meta || {};
      if (staff[r.user_id] || !m.date || r.created_at < since) return;
      if (r.event !== 'quiz_nudge' && m.kind !== 'word') return;
      var p = pair(r.user_id, m.date);
      if (r.event === 'quiz_nudge') {
        if (m.action === 'shown') p.nudge = 1; else if (m.action === 'go') p.nudgeGo = 1; else if (m.action === 'later') p.nudgeLater = 1;
      } else if (r.event === 'quiz_start') { if (!p.start) p.from = m.from || 'other'; p.start = 1; }
      else if (r.event === 'quiz_completed') { p.done = 1; if (m.secs != null) p.secs = Number(m.secs); }
      else if (r.event === 'quiz_exit') {
        var at = Number(m.at) || 0;
        if (at >= p.exitAt) { p.exitAt = at; p.exitHow = m.how || ''; }
      }
    });
    var rows = Object.keys(P).map(function (k) { return P[k]; }).filter(function (p) { return p.open || p.words || p.start; });
    var c = function (f) { return rows.filter(f).length; };
    var opened = c(function (p) { return p.open; }) || 0;
    var words = c(function (p) { return p.words; });
    var started = c(function (p) { return p.start; });
    var done = c(function (p) { return p.done; });
    var wordsNoStart = c(function (p) { return p.words && !p.start && !p.done; });
    var pct = function (a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; };
    var bar = function (label, n, base, note) {
      var w = base ? Math.round(100 * n / base) : 0;
      return '<div class="ap-qf-row"><div class="ap-qf-lab">' + label + (note ? '<small>' + note + '</small>' : '') + '</div>' +
        '<div class="ap-qf-bar"><i style="width:' + Math.min(100, w) + '%"></i></div>' +
        '<div class="ap-qf-n"><b>' + n + '</b> ' + pct(n, base) + '</div></div>';
    };
    var quitters = rows.filter(function (p) { return p.start && !p.done; });
    var buckets = [['Left at question 1', function (a) { return a === 1; }], ['Questions 2–4', function (a) { return a >= 2 && a <= 4; }],
      ['Questions 5–8', function (a) { return a >= 5 && a <= 8; }], ['Question 9 or later', function (a) { return a >= 9; }],
      ['No exit recorded', function (a) { return !a; }]];
    var secs = rows.filter(function (p) { return p.done && p.secs != null; }).map(function (p) { return p.secs; }).sort(function (a, b) { return a - b; });
    var median = secs.length ? secs[Math.floor(secs.length / 2)] : null;
    var froms = {};
    rows.forEach(function (p) { if (p.start) froms[p.from] = (froms[p.from] || 0) + 1; });
    var fromLabel = { words_end: 'Big button after the last word', nudge: 'The pop-up after the last word', other: 'Elsewhere (resume, links)' };
    host.innerHTML =
      '<div class="card"><h3>From lesson to finished quiz</h3>' +
        bar('Opened a lesson', opened, opened) +
        bar('Reached the last word', words, opened) +
        bar('Started the quiz', started, opened) +
        bar('Finished the quiz', done, opened) +
        '<p class="muted" style="margin-top:10px">Of those who reached the last word, <b>' + pct(c(function (p) { return p.words && p.start; }), words) + '</b> started the quiz. ' +
        'Of those who started, <b>' + pct(done, started) + '</b> finished. ' +
        (median != null ? 'Typical time to finish: <b>' + Math.round(median / 6) / 10 + ' min</b>.' : '') + '</p></div>' +
      '<div class="ap-kpis">' +
        apKpi('Saw the last word, never started', String(wordsNoStart), 'the leak this page is about') +
        apKpi('Started, didn’t finish', String(quitters.length), 'see where they stopped below') +
        apKpi('Pop-up shown', String(c(function (p) { return p.nudge; })),
          c(function (p) { return p.nudgeGo; }) + ' tapped Start · ' + c(function (p) { return p.nudgeLater; }) + ' tapped Later') +
      '</div>' +
      '<div class="card"><h3>Where people stopped (started, didn’t finish)</h3>' +
        (quitters.length ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Last question reached</th><th>Learners</th></tr></thead><tbody>' +
          buckets.map(function (b) { return '<tr><td>' + b[0] + '</td><td>' + quitters.filter(function (p) { return b[1](p.exitAt); }).length + '</td></tr>'; }).join('') +
          '</tbody></table></div>' : '<div class="empty">Nobody has left a quiz halfway yet.</div>') +
      '</div>' +
      '<div class="card"><h3>What started the quiz</h3>' +
        (started ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Button</th><th>Quizzes started</th></tr></thead><tbody>' +
          Object.keys(froms).sort(function (a, b) { return froms[b] - froms[a]; }).map(function (k) {
            return '<tr><td>' + esc(fromLabel[k] || k) + '</td><td>' + froms[k] + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">No quizzes started yet.</div>') +
      '</div>';
  };
  var seg = v.querySelector('#ap-qf-days');
  var pick = function (d) {
    seg.querySelectorAll('[data-qf-days]').forEach(function (b) { b.classList.toggle('on', Number(b.getAttribute('data-qf-days')) === d); });
    draw(d);
  };
  seg.addEventListener('click', function (e) { var b = e.target.closest('[data-qf-days]'); if (b) pick(Number(b.getAttribute('data-qf-days'))); });
  pick(7);
}
