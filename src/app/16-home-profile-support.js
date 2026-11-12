/* ---------------- Mobile Home v2 (2026-10-19 redesign) ---------------- */
function paintHome(v, mistakes, attempts) {
  if (isDesktop()) { paintHomeDesktop(v, mistakes, attempts); return; }
  const lessons = state.lessons;
  const today = lessons[0] || null;

  let html = '';

  // 0b — Streak banner (mockup v5): mascot artwork bg, painted with local
  // data first, then refreshed with cloud state by refreshHomeStreak().
  html += '<div id="home-streak-wrap">' + streakBannerHTML(getStreakLocal()) + '</div>';

  // 0b1 — Today's lesson + Daily quests FIRST, right under the streak
  // (2026-11-09, Alireza's order: new users must get the point of the app
  // immediately — lesson first, then the quests that send them into it).
  // 1 — Today's lesson (mockup v5 lesson card with illustrated hero)
  if (!today) {
    html += '<div class="empty">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += lessonBannerHTML(today);
  }

  // Daily quests (painted with local progress)
  html += '<div id="home-quests-wrap"></div>';

  // 1b — Previous lessons (days before today) → archive page
  html += prevLessonsHTML(lessons);

  // 0b2 — Grammar guides banner (smart: explore / continue / completed)
  html += '<div id="home-review-wrap"></div><div id="home-tricky-wrap"></div><div id="home-cards-wrap"></div>';
  html += '<div id="home-grammar-wrap"></div>';
  html += '<div id="home-ielts-wrap"></div>';
  html += '<div id="home-vocab-wrap"></div>';
  html += '<div id="home-words-wrap"></div>';
  html += '<div id="home-sentence-wrap"></div>';

  // 0c — Homework from teacher (filled async; empty when none pending)
  html += '<div id="home-hw-wrap"></div>';

  // 2 — Review (mistakes) — 2026-10-20 mockup redesign (hml-*)
  const todayMistakes = today ? mistakes.filter(function (x) { return x.date === today.date; }) : [];
  html += '<div class="hml-head"><h2>Review</h2>' +
    (mistakes.length ? '<a class="hml-viewall" href="#/review">View all ›</a>' : '') + '</div>';
  if (!mistakes.length) {
    html += '<div class="card plain"><p class="muted" style="margin:0">Nothing to review yet — wrong answers will appear here so you can practice them again.</p></div>';
  } else {
    const reviewAction = todayMistakes.length
      ? 'data-action="review-today" data-date="' + esc(today.date) + '"'
      : 'data-action="practice-again"';
    html += '<button class="hml-rev" ' + reviewAction + ' aria-label="Review your mistakes">' +
      '<img class="hml-rev-flame" src="/media/home/mascot-read-book.png" alt="" loading="lazy">' +
      '<span class="hml-rev-main">' +
        '<span class="hml-rev-num"><b>' + mistakes.length + '</b>to review</span>' +
        '<span class="hml-rev-sub">Practice your mistakes and get even better!</span>' +
        '<span class="hml-rev-btn">Review mistakes ›</span>' +
      '</span>' +
      '<img class="hml-rev-check" src="/media/home/ico-checkcard.png" alt="" loading="lazy">' +
    '</button>';
  }

  // 3 — Progress — 2026-10-20 mockup redesign (hml-*)
  var xpTotal = 0;
  try { xpTotal = state.myPoints || 0; } catch (e) {}
  var streakNow = 0;
  try { streakNow = (getStreakLocal() || {}).current_streak || 0; } catch (e) {}
  var activeDays = 0;
  try { activeDays = Object.keys(getStreakDayDates() || {}).length; } catch (e) {}
  var statCell = function (ico, num, lbl) {
    return '<div class="hml-stat"><div class="hml-stat-ico" aria-hidden="true">' + ico + '</div>' +
      '<div class="hml-stat-num">' + num + '</div><div class="hml-stat-lbl">' + lbl + '</div></div>';
  };
  html += '<div class="hml-head"><h2>Progress</h2>' +
    '<a class="hml-viewall" href="#/scores">View all ›</a></div>';
  html += '<a class="hml-prog-link" href="#/scores" aria-label="View your progress"><div class="hml-prog">' +
    '<div class="hml-prog-top">' +
      '<img class="hml-prog-flame" src="/media/home/mascot-run.png" alt="" loading="lazy">' +
      '<span class="hml-prog-txt"><b>Great progress!</b><span>Keep going, you\u2019re on a roll!</span></span>' +
      '<img class="hml-prog-star" src="/media/home/ico-star.png" alt="" loading="lazy">' +
    '</div>' +
    '<div class="hml-stats">' +
      statCell('⭐', Number(xpTotal).toLocaleString('en-US'), 'Total XP') +
      statCell('🔥', streakNow, 'Day streak') +
      statCell('📖', attempts.length, 'Lessons done') +
      statCell('🗓️', activeDays, 'Active days') +
    '</div>' +
  '</div></a>';

  // 4 — Notifications: only after meaningful engagement (first quiz done), never automatic
  if (oneSignalReady() && !state.user.demo && !pushSubscribed() && hasAnyQuizDone()) {
    html += '<div class="card plain"><b>🔔 Lesson notifications</b>' +
      '<p class="muted">You’re on a roll — get a short notification when each new lesson is ready.</p>' +
      '<p class="muted" id="push-status" role="status"></p>' +
      '<button class="btn btn-sm" data-action="enable-push">Enable notifications</button></div>';
  }

  // 5 — Support banner (very bottom of Home, Alireza's order 2026-11-10)
  html += supportBannerHTML();

  v.innerHTML = html;
  paintReviewDue(); paintGrammarBanner(); paintIeltsBanner(); paintTrickyDue(); paintHomeCards(); kvPullAll(); paintSupportBadges();
  paintVocabBanner();
  paintWordsBanner();
  paintSentenceBanner();
}

function attemptCardHTML(a, i) {
  const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
  const kindLabel = (a.kind === 'grammar' || a.kind === 'grammar_topic') ? 'Grammar quiz'
    : a.kind === 'grammar_test' ? 'Grammar check-up'
    : a.kind === 'mistakes' ? 'Review session' : 'Word quiz';
  return '' +
  '<div class="card plain att-card"><div class="attempt-card" data-action="att-toggle" data-i="' + i + '" role="button" tabindex="0" aria-label="Show details">' +
    '<div class="attempt-info">' +
      '<div class="attempt-theme">' + esc(a.theme || 'Lesson') + '</div>' +
      '<div class="attempt-meta">' + esc(kindLabel) + ' · ' + esc(a.date || '') + ' · ' + esc(fmtDateTime(a.ts)) + '</div>' +
    '</div>' +
    '<div class="percent-wrap"><div class="percent-num">' + a.score + '/' + a.total + '</div>' +
    '<div class="progress"><div style="width:' + pct + '%"></div></div></div>' +
    '<span class="att-arrow">›</span>' +
  '</div><div class="att-detail" id="att-detail-' + i + '" hidden></div></div>';
}

/* Attempt detail (Alireza 2026-11-02): tap a Progress history row and it
   expands — score context, how often this quiz was taken + best score,
   a deep link back to the lesson/topic, and the questions missed that
   day (joined from the mistakes list by date + kind; mistakes answered
   correctly later are already gone from that list). */
async function renderAttemptSnap(host, snap) {
  let still = {};
  try {
    if (!state._mistakesCache) state._mistakesCache = await getMistakes();
    (state._mistakesCache || []).forEach(function (m) { still[m.question] = 1; });
  } catch (e) {}
  host.innerHTML = '<div class="att-d-line">❌ <b>Missed in this attempt (' + snap.length + ')</b></div>' +
    snap.map(function (s) {
      const fixed = !still[s.q];
      return '<div class="att-miss"><div class="mistake-q">' + esc(s.q) + '</div>' +
        (s.acc
          ? '<div class="mistake-a">✅ ' + esc(s.acc[0] || '') + '</div>' +
            '<div class="mistake-was">You wrote: ' + esc(s.p) + '</div>'
          : '<div class="mistake-a">✅ ' + esc((s.o || [])[s.a] || '') + '</div>' +
            (typeof s.p === 'number' && s.p !== s.a
              ? '<div class="mistake-was">You chose: ' + esc((s.o || [])[s.p] || '') + '</div>' : '')) +
        (fixed ? '<div class="att-fixed">✓ Fixed since</div>' : '') + '</div>';
    }).join('');
}
function attDateStr(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function toggleAttemptDetail(i) {
  const box = document.getElementById('att-detail-' + i);
  const arr = state._progAttempts || [];
  const a = arr[i];
  if (!box || !a) return;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  if (!box.dataset.built) {
    box.dataset.built = '1';
    box.innerHTML = attemptDetailHTML(a, arr);
    fillAttemptMissed(a, box.querySelector('.att-missed'));
  }
}
function attemptDetailHTML(a, all) {
  const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
  const same = all.filter(function (x) { return x.theme === a.theme && x.kind === a.kind; })
    .slice().sort(function (x, y) { return x.ts - y.ts; });
  let h = '<div class="att-d-head"><b>' + a.score + '/' + a.total + '</b><span>' + pct + '% · ' +
    esc(fmtDateTime(a.ts)) + (a.level ? ' · ' + esc(String(a.level).toUpperCase()) : '') + '</span></div>';
  if (same.length > 1) {
    const best = same.reduce(function (m, x) { return Math.max(m, x.total ? x.score / x.total : 0); }, 0);
    h += '<div class="att-d-line">🔁 Taken ' + same.length + ' times · best ' + Math.round(best * 100) + '%</div>' +
      '<div class="att-d-chips">' + same.map(function (x) {
        return '<span class="att-chip">' + esc((x.date || '').slice(5)) + ' · ' + x.score + '/' + x.total + '</span>';
      }).join('') + '</div>';
  }
  h += attemptActionHTML(a);
  h += '<div class="att-missed"><p class="muted" style="margin:0">Loading missed questions…</p></div>';
  return h;
}
function attemptActionHTML(a) {
  let btns = '';
  if (a.kind === 'grammar_test') {
    btns = '<a class="btn btn-sm" href="#/grammar-test/report">📊 Full report</a>' +
      '<a class="btn btn-sm btn-primary" href="#/grammar-test">Retake</a>';
  } else if ((a.kind === 'grammar' || a.kind === 'grammar_topic') && /^[a-z0-9-]+$/.test(a.theme || '')) {
    btns = '<a class="btn btn-sm btn-primary" href="#/grammar/' + esc(a.theme) + '">📖 Open this topic</a>';
  } else if (a.kind === 'mistakes') {
    btns = '<a class="btn btn-sm btn-primary" href="#/review/mistakes">🔁 Go to mistakes</a>';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) {
    btns = '<a class="btn btn-sm btn-primary" href="#/lesson/' + esc(a.date) + '">📚 Open that lesson</a>';
  }
  return btns ? '<div class="att-d-btns">' + btns + '</div>' : '';
}
async function fillAttemptMissed(a, host) {
  if (!host) return;
  /* Permanent snapshot first (saved with the attempt itself, 2026-11-02):
     survives the mistakes being fixed later. Older attempts fall back to
     the day-join against the live mistakes list below. */
  const snap = (a.missed && a.missed.length) ? a.missed : getAttemptMissedLocal(a);
  if (snap) { renderAttemptSnap(host, snap); return; }
  const mk = (a.kind === 'grammar' || a.kind === 'grammar_topic' || a.kind === 'grammar_test') ? 'grammar'
    : (a.kind === 'mistakes' ? null : 'word');
  if (!mk) {
    host.innerHTML = '<p class="muted" style="margin:0">This was a practice session built from your mistakes list.</p>';
    return;
  }
  try {
    if (!state._mistakesCache) state._mistakesCache = await getMistakes();
    const dates = {};
    if (a.date) dates[a.date] = 1;
    dates[attDateStr(a.ts)] = 1;
    const seenQ = {}, missed = [];
    (state._mistakesCache || []).forEach(function (m) {
      if (m.kind === mk && dates[m.date] && !seenQ[m.question]) { seenQ[m.question] = 1; missed.push(m); }
    });
    if (!missed.length) {
      host.innerHTML = '<p class="muted" style="margin:0">No missed questions from that day are still on your list 🎉<br>' +
        '<span style="font-size:0.8rem">Mistakes you later answered correctly are removed automatically.</span></p>';
      return;
    }
    host.innerHTML = '<div class="att-d-line">❌ <b>Missed that day (' + missed.length + ')</b></div>' +
      missed.slice(0, 8).map(function (m) {
        return '<div class="att-miss"><div class="mistake-q">' + esc(m.question) + '</div>' +
          '<div class="mistake-a">✅ ' + esc(m.options[m.answer] || '') + '</div>' +
          (typeof m.picked === 'number' && m.picked !== m.answer
            ? '<div class="mistake-was">You chose: ' + esc(m.options[m.picked] || '') + '</div>' : '') + '</div>';
      }).join('') +
      (missed.length > 8 ? '<p class="muted" style="margin:0.3rem 0 0">…and ' + (missed.length - 8) + ' more in Review → Mistakes.</p>' : '');
  } catch (e) { host.innerHTML = ''; }
}

/* ---------------- desktop home (mockup v6, >=1024px) ---------------- */
function isDesktop() {
  try { return window.matchMedia('(min-width:1024px)').matches; } catch (e) { return false; }
}
function dhTitleCase(s) {
  return String(s || '').replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1); });
}
/* "Welcome back!" replaces the brand mark in the app header on desktop home. */
function paintWelcomeHeader() {
  try {
    const hdr = document.querySelector('#app-header .header-inner');
    if (!hdr) return;
    let w = hdr.querySelector('.welcome-block');
    const showIt = state.view === 'home' && !!state.user && isDesktop();
    if (showIt) {
      if (!w) {
        w = document.createElement('div');
        w.className = 'welcome-block';
        w.innerHTML = '<h1>Welcome back!</h1><p>Keep going! A little English every day makes a big difference. 🧡</p>';
        hdr.insertBefore(w, hdr.firstChild);
      }
    } else if (w) { w.remove(); }
  } catch (e) {}
}
/* Re-render home when the viewport crosses the desktop breakpoint. */
var _rsT = null, _wasDesktop = null;
window.addEventListener('resize', function () {
  clearTimeout(_rsT);
  _rsT = setTimeout(function () {
    const d = isDesktop();
    if (_wasDesktop === null) { _wasDesktop = d; return; }
    if (d !== _wasDesktop) {
      _wasDesktop = d;
      if (state.view === 'home' && !state.quiz) {
        paintWelcomeHeader();
        renderHome(document.getElementById('view'));
      }
    }
  }, 300);
});

function dhQuestRowHTML(q) {
  const p = Math.min(q.progress(), q.target);
  const done = p >= q.target;
  const pct = q.target ? Math.round((p / q.target) * 100) : 0;
  const progTxt = q.unit === 'steps'
    ? p + ' / ' + q.target + ' steps'
    : (q.unit === 'XP' ? p + ' / ' + q.target + ' XP' : (done ? 'Done! Great job!' : 'Not done'));
  return '<div class="dh-qrow' + (done ? ' is-done' : '') + '">' +
    '<a class="dh-qmain" href="' + (q.link || '#/home') + '">' +
    '<span class="dh-qico" aria-hidden="true">' + q.icon + '</span>' +
    '<span class="dh-qbody"><span class="dh-qtitle">' + q.title + '</span>' +
    '<span class="dh-qbar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct + '%"></span></span>' +
    '<span class="dh-qprog">' + progTxt + '</span></span>' +
    (done ? '<span class="dh-qgo is-check" aria-hidden="true">✓</span>' : '<span class="dh-qgo" aria-hidden="true">›</span>') +
    '</a><span class="dh-xp">XP +' + q.xp + '</span></div>';
}
function dhQuestsHTML() {
  const qs = questDefs();
  return '<section class="dh-card dh-quests"' + (_faOn ? '' : ' dir=\'ltr\' lang=\'en\'') + ' aria-label="Daily quests">' +
    '<div class="dh-card-head"><span class="dh-hico" aria-hidden="true">🎯</span>' +
    '<div class="dh-htitles"><h2>Daily Quests</h2><p>Complete quests, earn XP, level up!</p></div>' +
    '<a class="dh-link" href="#/scores">View all <span aria-hidden="true">›</span></a></div>' +
    '<div class="dh-qrows">' + qs.map(dhQuestRowHTML).join('') + '</div></section>';
}
function dhLessonHTML(m) {
  if (!m) return '<section class="dh-card"><div class="empty">No lessons published yet — check back tomorrow.</div></section>';
  const cover = lessonCover(m);
  const wc = lessonWordCount(m);
  const lvl = (normalizeLevel(m.level) || 'b2').toUpperCase();
  const theme = dhTitleCase(m.theme || 'Lesson');
  const done = dayDoneCount(m.date);
  const tab = nextStep(m.date) || 'words';
  const cta = done >= HOME_STEP_ORDER.length ? 'Review Lesson' : (done > 0 ? 'Continue Lesson' : 'Start Lesson');
  return '<section class="dh-card dh-lesson" aria-label="Today\u2019s lesson">' +
    '<div class="dh-card-head"><span class="dh-hico" aria-hidden="true">📖</span>' +
    '<div class="dh-htitles"><h2>Today\u2019s Lesson</h2></div>' +
    '<button class="dh-link" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + tab + '">Continue <span aria-hidden="true">›</span></button></div>' +
    '<div class="dh-lesson-body">' +
    (cover ? '<img class="dh-lesson-photo" src="' + esc(cover) + '" alt="" loading="lazy">' : '') +
    '<div class="dh-lesson-info"><div class="dh-lesson-meta">' + esc(lvl) + ' · ' + wc + ' words</div>' +
    '<div class="dh-lesson-theme">' + esc(theme) + '</div>' +
    '<p class="dh-lesson-desc">Learn ' + wc + ' new words with pronunciation, podcast, shadowing and grammar.</p></div></div>' +
    '<div class="dh-lesson-foot">' +
    '<button class="dh-start" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + tab + '"><span aria-hidden="true">▶</span> ' + cta + '</button>' +
    '<span class="dh-min">🕐 5 min</span></div></section>';
}
function dhMistakesHTML(mistakes) {
  const n = mistakes.length;
  const body = n
    ? '<div class="dh-mist-body"><span class="dh-mist-ico" aria-hidden="true">📄<b>✕</b></span>' +
      '<div class="dh-mist-txt"><b>' + n + ' mistake' + (n === 1 ? '' : 's') + ' to review</b><span>Practice these to get stronger!</span></div>' +
      '<a class="dh-review-btn" href="#/review">Review Now <span aria-hidden="true">›</span></a></div>'
    : '<p class="muted" style="margin:0.5rem 0 0">Nothing to review yet — wrong answers will appear here so you can practice them again.</p>';
  return '<section class="dh-card dh-mistakes" aria-label="Review your mistakes">' +
    '<div class="dh-card-head"><span class="dh-hico" aria-hidden="true">🔄</span>' +
    '<div class="dh-htitles"><h2>Review Your Mistakes</h2></div>' +
    (n ? '<a class="dh-link" href="#/review">See all <span aria-hidden="true">›</span></a>' : '') + '</div>' + body + '</section>';
}
function dhProgressHTML(d) {
  d = d || {};
  const pts = Number(d.pts) || 0;
  const lvl = Math.floor(pts / 1000) + 1;
  const intoLvl = pts % 1000;
  const pct = Math.round((intoLvl / 1000) * 100);
  const streak = d.streak != null ? d.streak : ((getStreakLocal() || {}).current_streak || 0);
  const C = 2 * Math.PI * 34;
  return '<div class="dh-card-head"><span class="dh-hico" aria-hidden="true">📊</span>' +
    '<div class="dh-htitles"><h2>Your Progress</h2></div>' +
    '<a class="dh-link" href="#/scores">See details <span aria-hidden="true">›</span></a></div>' +
    '<div class="dh-prog-body">' +
    '<div class="dh-ring" role="img" aria-label="Level ' + lvl + ', ' + pts + ' XP">' +
    '<svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="34" class="dh-ring-bg"/>' +
    '<circle cx="42" cy="42" r="34" class="dh-ring-fg" stroke-dasharray="' + (pct / 100 * C).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>' +
    '<span class="dh-ring-txt"><small>Level</small><b>' + lvl + '</b></span></div>' +
    '<div class="dh-prog-main"><div class="dh-xpline"><b>' + (1000 - intoLvl) + ' XP</b><span>to Level ' + (lvl + 1) + '</span></div>' +
    '<div class="dh-bar"><span style="width:' + pct + '%"></span></div>' +
    '<div class="dh-xpsub">' + pts.toLocaleString('en-US') + ' / 1,000 XP</div>' +
    '<div class="dh-stats">' +
    '<span class="dh-stat"><span class="dh-stat-ico" aria-hidden="true">🔥</span><b>' + streak + '</b><small>Day Streak</small></span>' +
    '<span class="dh-stat"><span class="dh-stat-ico" aria-hidden="true">🎯</span><b>' + (d.lessonsDone || 0) + '</b><small>Lessons Done</small></span>' +
    '<span class="dh-stat"><span class="dh-stat-ico" aria-hidden="true">⭐</span><b>' + (d.badges || 0) + '</b><small>Badges</small></span>' +
    '</div></div></div>';
}
async function refreshDhProgress() {
  try {
    if (state.view !== 'home' || !isDesktop()) return;
    let host = document.getElementById('dh-progress');
    if (!host) return;
    const dates = {};
    (lsGet('attempts') || []).forEach(function (a) { if (a && a.date) dates[a.date] = 1; });
    const lessonsDone = Object.keys(dates).length;
    let pts = state.myPoints || 0, badges = 0, streak = null;
    if (cloudReady()) {
      const res = await Promise.all([
        getMyPoints().catch(function () { return 0; }),
        getStreakState().catch(function () { return null; }),
        getMyPrizes().catch(function () { return []; })
      ]);
      pts = Number(res[0]) || 0;
      const st = res[1] || {};
      streak = st.current_streak || 0;
      const longest = st.longest_streak || 0;
      const prizes = res[2] || [];
      badges = (longest >= 7 ? 1 : 0) + (longest >= 30 ? 1 : 0) + (longest >= 100 ? 1 : 0) +
        (prizes.some(function (p) { return p.points === 30; }) ? 1 : 0) +
        (prizes.some(function (p) { return p.points === 0; }) ? 1 : 0);
    }
    host = document.getElementById('dh-progress');
    if (!host || state.view !== 'home' || !isDesktop()) return;
    host.innerHTML = dhProgressHTML({ pts: pts, streak: streak, lessonsDone: lessonsDone, badges: badges });
  } catch (e) {}
}
function dhPodcastHTML(m) {
  const p = m && m.podcast;
  const ep = state.lessons.length;
  const body = (p && p.audio)
    ? '<div class="dh-pod-body">' +
      '<span class="dh-pod-cover"><img src="/media/home/podcast-cover.webp" alt="" loading="lazy">' +
      '<button class="dh-pod-play" data-dh-toggle aria-label="Play podcast">▶</button></span>' +
      '<div class="dh-pod-info"><b>' + esc(p.title || 'English Conversations') + '</b>' +
      '<span class="dh-pod-meta">Episode ' + ep + '</span>' +
      '<p>Real-life conversations to boost your listening skills.</p></div></div>' +
      '<div class="dh-player"><button class="dh-pl-toggle" data-dh-toggle aria-label="Play or pause">▶</button>' +
      '<span class="dh-pl-cur">0:00</span>' +
      '<input class="dh-pl-seek" type="range" min="0" max="100" value="0" aria-label="Seek">' +
      '<span class="dh-pl-dur">–:––</span>' +
      '<audio class="dh-pl-audio" preload="metadata" src="' + esc(p.audio) + '"></audio></div>'
    : '<p class="muted" style="margin:0.5rem 0 0">No podcast episode yet.</p>';
  const seeAll = (p && p.audio) ? '<a class="dh-link" href="#/lesson/' + esc(m.date) + '/podcast">See all <span aria-hidden="true">›</span></a>' : '';
  return '<section class="dh-card dh-podcast" aria-label="Latest podcast">' +
    '<div class="dh-card-head"><span class="dh-hico" aria-hidden="true">🎧</span>' +
    '<div class="dh-htitles"><h2>Latest Podcast</h2></div>' + seeAll + '</div>' + body + '</section>';
}
function wireDhPlayer() {
  try {
    const card = document.querySelector('.dh-podcast');
    if (!card) return;
    const audio = card.querySelector('.dh-pl-audio');
    if (!audio || audio._dhWired) return;
    audio._dhWired = true;
    const toggles = card.querySelectorAll('[data-dh-toggle]');
    const cur = card.querySelector('.dh-pl-cur'), dur = card.querySelector('.dh-pl-dur'), seek = card.querySelector('.dh-pl-seek');
    const fmt = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
    const setPlay = function (playing) {
      toggles.forEach(function (b) { b.innerHTML = playing ? '❚❚' : '▶'; b.classList.toggle('playing', playing); });
    };
    audio.addEventListener('loadedmetadata', function () { dur.textContent = fmt(audio.duration); });
    audio.addEventListener('timeupdate', function () {
      cur.textContent = fmt(audio.currentTime);
      if (audio.duration) seek.value = Math.round((audio.currentTime / audio.duration) * 100);
    });
    audio.addEventListener('ended', function () { setPlay(false); });
    audio.addEventListener('pause', function () { setPlay(false); });
    if (seek) seek.addEventListener('input', function () { if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration; });
    toggles.forEach(function (b) {
      b.addEventListener('click', function () {
        if (audio.paused) { audio.play().then(function () { setPlay(true); }).catch(function () {}); }
        else { audio.pause(); }
      });
    });
  } catch (e) {}
}
function dhChallengeHTML() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; /* Mon=0 */
  const doneDates = {};
  try {
    for (let i = 0; i <= dow; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const ds = fmtDate(d);
      if (dayDoneCount(ds) > 0) doneDates[ds] = 1;
    }
  } catch (e) {}
  const n = Object.keys(doneDates).length;
  const target = 5;
  const pct = Math.min(100, Math.round((n / target) * 100));
  return '<div class="dh-card-head"><span class="dh-hico" aria-hidden="true">🏆</span>' +
    '<div class="dh-htitles"><h2>Challenge</h2></div>' +
    '<a class="dh-link" href="#/challenge">View all <span aria-hidden="true">›</span></a></div>' +
    '<div class="dh-ch-body"><span class="dh-ch-trophy" aria-hidden="true">🏆</span>' +
    '<div class="dh-ch-txt"><b>Weekly Challenge</b><span>Complete ' + target + ' lessons this week</span></div></div>' +
    '<div class="dh-bar"><span style="width:' + pct + '%"></span></div>' +
    '<div class="dh-ch-count"><b>' + n + ' / ' + target + '</b></div>' +
    '<div class="dh-ch-badge">🎁 Finish to earn a special badge!</div>';
}
function paintHomeDesktop(v, mistakes, attempts) {
  const lessons = state.lessons;
  const today = lessons[0] || null;
  let html = '<div class="dhome">';
  html += '<div id="home-streak-wrap">' + streakBannerHTML(getStreakLocal()) + '</div>';
  html += '<div class="dh-grid">' + dhQuestsHTML() +
    '<div class="dh-col">' + dhLessonHTML(today) + dhMistakesHTML(mistakes) + '</div></div>';
  html += '<div id="home-review-wrap"></div><div id="home-tricky-wrap"></div><div id="home-cards-wrap"></div>';
  html += '<div id="home-grammar-wrap"></div>';
  html += '<div id="home-ielts-wrap"></div>';
  html += '<div id="home-vocab-wrap"></div>';
  html += '<div id="home-words-wrap"></div>';
  html += '<div id="home-sentence-wrap"></div>';
  html += '<div id="home-hw-wrap"></div>';
  html += '<div class="dh-grid3">' +
    '<section class="dh-card" id="dh-progress">' + dhProgressHTML({}) + '</section>' +
    dhPodcastHTML(today) +
    '<section class="dh-card dh-challenge">' + dhChallengeHTML() + '</section></div>';
  html += prevLessonsHTML(lessons);
  if (oneSignalReady() && !state.user.demo && !pushSubscribed() && hasAnyQuizDone()) {
    html += '<div class="card plain"><b>🔔 Lesson notifications</b>' +
      '<p class="muted">You\u2019re on a roll — get a short notification when each new lesson is ready.</p>' +
      '<p class="muted" id="push-status" role="status"></p>' +
      '<button class="btn btn-sm" data-action="enable-push">Enable notifications</button></div>';
  }
  html += '</div>';
  html += supportBannerHTML();
  v.innerHTML = html;
  wireDhPlayer();
  refreshDhProgress();
  paintReviewDue(); paintGrammarBanner(); paintIeltsBanner(); paintTrickyDue(); paintHomeCards(); kvPullAll(); paintSupportBadges();
  paintVocabBanner();
  paintWordsBanner();
  paintSentenceBanner();
}

/* ---------------- PROFILE ---------------- */
function renderProfile(v) {
  const u = state.user;
  const subscribed = pushSubscribed();
  v.innerHTML =
  '<h1>Profile</h1>' +
  '<div class="card">' +
    '<div class="stat-row"><div class="profile-btn" style="cursor:default" aria-hidden="true">' +
    '<span class="profile-initial">' + esc((u.email || '?').trim().charAt(0).toUpperCase()) + '</span></div>' +
    '<div><div style="font-weight:700;word-break:break-all">' + esc(u.email) + '</div>' +
    '<div class="muted">' + esc(u.level ? levelLabel(normalizeLevel(u.level)) : 'Level pending — your teacher will assign it') + '</div></div></div>' +
  '</div>' +

  ((!u.referredBy && !u.demo)
    ? '<div class="section-title"><h2>Your level</h2></div>' +
      '<div class="card plain"><div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap">' +
      '<select id="my-level-select" class="input" style="flex:1;min-width:180px">' +
      SIGNUP_LEVELS.concat(u.level === 'c2' ? [{ id: 'c2', name: 'Proficiency' }] : []).map(function (l) {
        return '<option value="' + l.id + '"' + (normalizeLevel(u.level) === l.id ? ' selected' : '') + '>' + l.id.toUpperCase() + ' · ' + l.name + '</option>';
      }).join('') +
      '</select>' +
      '<button class="btn btn-orange" data-action="save-my-level" style="padding:0.6rem 1.1rem">Save level</button>' +
      '</div></div>'
    : '') +

  '<div class="section-title"><h2>Notifications</h2></div>' +
  '<div class="card plain">' +
    '<p class="muted" style="margin-top:0">Get a short notification when your daily lesson is ready. We’ll only ask for permission if you tap the button below.</p>' +
    '<p class="muted" id="push-status" role="status">' + (subscribed ? '✓ Notifications are on for this device.' : '') + '</p>' +
    (oneSignalReady() && !u.demo && !subscribed
      ? '<button class="btn btn-sm" data-action="enable-push">Enable notifications</button>'
      : (!oneSignalReady() ? '<p class="muted">Push is not configured on this site yet.</p>' : '')) +
  '</div>' +

  (u.isAdmin ? '<div class="section-title"><h2>Admin</h2></div>' +
    '<div class="card plain"><a class="btn btn-ghost btn-block" href="#/admin" style="margin-top:0">🛠 Open admin panel</a></div>' : '') +

  '<div class="section-title"><h2>Teaching</h2></div>' +
  (state.teacher
    ? '<div class="card plain"><a class="btn btn-ghost btn-block" href="/teachers" style="margin-top:0">🍎 Teacher portal</a>' +
      '<a class="btn btn-ghost btn-block" href="#/teacher" style="margin-top:0.6rem">🍎 Teacher dashboard</a></div>'
    : (state.teacherRequest && state.teacherRequest.status === 'pending'
      ? '<div class="card plain"><p class="muted" style="margin:0">⏳ Teacher request under review — <a class="link" href="#/become-teacher">view status</a></p></div>'
      : '<div class="card plain"><a class="btn btn-ghost btn-block" href="#/become-teacher" style="margin-top:0">🍎 Become a teacher</a></div>')) +

  '<div class="section-title"><h2>Region</h2></div>' +
  '<div class="card plain">' +
    '<p class="muted" style="margin-top:0">Your country: <b>' + esc(u.country || 'Not detected yet') + '</b>' +
    (u.countrySource === 'timezone' ? ' <span class="muted">(from your device timezone)</span>' : '') + '</p>' +
    '<div class="field"><label for="pf-country">Change country</label>' +
    '<select id="pf-country">' +
      COUNTRY_OPTIONS.map(function (c) {
        return '<option value="' + c[0] + '"' + (u.countryCode === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>';
      }).join('') +
    '</select></div>' +
    '<button class="btn btn-sm" data-action="save-country">Save country</button>' +
  '</div>' +

  /* App language (2026-11-12): Persian by default for A1–B1, English for B2+. */
  '<div class="section-title"><h2>App language</h2></div>' +
  '<div class="card plain ui-lang-card"><div class="ui-lang-row" role="group" aria-label="App language">' +
    '<button class="btn btn-sm ' + (uiLang() === 'fa' ? '' : 'btn-ghost') + '" data-action="ui-lang" data-lang="fa" aria-pressed="' + (uiLang() === 'fa') + '" data-no-fa lang="fa">فارسی</button>' +
    '<button class="btn btn-sm ' + (uiLang() === 'en' ? '' : 'btn-ghost') + '" data-action="ui-lang" data-lang="en" aria-pressed="' + (uiLang() === 'en') + '" data-no-fa>English</button>' +
  '</div><p class="muted ui-lang-note">Menus and buttons. Lessons stay in English.</p></div>' +
  '<div class="section-title"><h2>Help</h2></div>' +
  '<div class="card plain"><button class="btn btn-ghost btn-block" data-action="tut-replay" style="margin-top:0">🎓 App tour — show me around</button>' +
  '<a class="btn btn-ghost btn-block" href="#/support" style="margin-top:0.6rem">💬 Support — ask a question <span class="sup-badge hidden" data-sup-badge></span></a></div>' +
  '<div class="section-title"><h2>Account</h2></div>' +
  '<div class="card plain"><button class="btn btn-ghost btn-block" data-action="logout" style="margin-top:0">Log out</button></div>';
  paintSupportBadges();
}

async function saveCountryManual() {
  const sel = document.getElementById('pf-country');
  const u = state.user;
  if (!sel || !u || u.demo || !sb) return;
  const code = sel.value;
  const name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : code;
  u.countryCode = code; u.country = name; u.countrySource = 'manual';
  try {
    await sb.rpc('set_country', { code: code, name: name, source: 'manual' });
  } catch (e) { /* RPC missing or offline -> kept locally, retried later */ }
  renderProfile(document.getElementById('view'));
}

/* ---------------- support (learner <-> admin) + welcome message ----------------
   2026-11-10, Alireza's order: newcomers get a welcome inbox message, and
   learners can ask the admin questions from a banner at the bottom of Home
   and from Profile. Data lives behind SECURITY DEFINER RPCs
   (support-and-welcome-migration.sql); until he runs it, every call here
   fails soft — banners still show, the thread shows a "try later" note. */
function supportIsFa() {
  try { var l = normalizeLevel(state.user && state.user.level); return l === 'a1' || l === 'a2'; } catch (e) { return false; }
}

function supportBannerHTML() {
  var fa = supportIsFa();
  return '<a class="sup-banner" href="#/support">' +
    '<span class="sup-banner-ico">💬</span>' +
    '<span class="sup-banner-txt"><b>' + (fa ? 'سؤالی داری؟ از ما بپرس' : 'Questions? Ask us') + '</b>' +
    '<span>' + (fa ? 'پشتیبانی Muse English — جوابت همین‌جا میاد' : 'Muse English support — we reply right here') + '</span></span>' +
    '<span class="sup-badge hidden" data-sup-badge></span>' +
    '<span class="sup-banner-arrow">›</span></a>';
}

function paintSupportBadges() {
  if (!document.querySelector('[data-sup-badge]')) return;
  if (!sb || !state.user || state.user.demo) return;
  sb.rpc('support_unread').then(function (r) {
    var n = (!r.error && typeof r.data === 'number') ? r.data : 0;
    document.querySelectorAll('[data-sup-badge]').forEach(function (el) {
      el.textContent = n ? String(n) : '';
      el.classList.toggle('hidden', !n);
    });
  }).catch(function () {});
}

function welcomeBody(fa) {
  if (fa) return '👋 به Muse English خوش اومدی!\n\nهر روز یه درس کوتاه داری: کلمه، پادکست، شدویینگ، گرامر و کوئیز — روزی ۱۰ دقیقه کافیه.\n🔥 هر روز بخونی، استریکت ادامه پیدا می‌کنه.\n🎯 با کوئست‌های روزانه XP بگیر؛ 🔖 کلمه ذخیره کن تا سر وقت برای مرور برگرده.\n📖 گرامر: ۱۰۷ موضوع با تمرین؛ 🎓 آزمون آیلتس آکادمیک هم آماده‌ست.\n❓ سؤالی داشتی؟ از بنر «پشتیبانی» پایین صفحهٔ اصلی بپرس — جوابت همون‌جا میاد.\nموفق باشی! 🌱';
  return '👋 Welcome to Muse English!\n\nEvery day: one short lesson — words, podcast, shadowing, grammar and a quiz. About 10 minutes a day.\n🔥 Study daily to keep your streak.\n🎯 Finish daily quests to earn XP; 🔖 save words and they come back for review on time.\n📖 Grammar: 107 topics with practice. 🎓 A full IELTS Academic mock is ready too.\n❓ Questions? Tap the Support banner at the bottom of Home — we reply right there.\nGood luck! 🌱';
}

function supTime(ts) {
  try {
    var d = new Date(ts);
    return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

function supportMsgHTML(m, fa, asAdmin) {
  var mine = asAdmin ? !!m.from_admin : !m.from_admin;
  var who = mine ? (fa ? 'شما' : 'You') : (asAdmin ? 'Learner' : 'Muse English');
  return '<div class="sup-msg ' + (mine ? 'me' : 'them') + '">' +
    '<div class="sup-bubble">' + esc(m.body).replace(/\n/g, '<br>') + '</div>' +
    '<div class="sup-time">' + who + ' · ' + supTime(m.created_at) + '</div></div>';
}

async function renderSupport(v) {
  var fa = supportIsFa();
  v.innerHTML = '<div class="sup-wrap"' + (fa ? ' dir="rtl" lang="fa"' : '') + '>' +
    '<h1 class="sup-title">💬 ' + (fa ? 'پشتیبانی' : 'Support') + '</h1>' +
    '<p class="muted">' + (fa ? 'سؤالت رو این‌جا بپرس؛ جواب هم این‌جا میاد. معمولاً ظرف یه روز جواب می‌دیم.' : 'Ask your question here — the reply lands right here too. We usually reply within a day.') + '</p>' +
    '<div id="sup-thread" class="sup-thread"><div class="empty">…</div></div>' +
    '<div class="sup-composer"><textarea id="sup-input" rows="3" maxlength="2000" placeholder="' + (fa ? 'سؤالت رو بنویس…' : 'Write your question…') + '"></textarea>' +
    '<div class="form-error" id="sup-error" role="alert"></div>' +
    '<button class="btn btn-orange btn-block" id="sup-send">' + (fa ? 'ارسال' : 'Send') + '</button></div></div>';
  var host = document.getElementById('sup-thread');
  var msgs = null;
  if (sb && state.user && !state.user.demo) {
    try { var r = await sb.rpc('my_support_thread'); if (r.error) throw r.error; msgs = r.data || []; } catch (e) { msgs = null; }
  }
  if (msgs === null) {
    host.innerHTML = '<div class="empty">' + (fa ? 'فعلاً نمی‌شه پیام‌ها رو آورد؛ یه کم دیگه دوباره سر بزن.' : 'Messages could not be loaded right now — please try again a little later.') + '</div>';
  } else if (!msgs.length) {
    host.innerHTML = '<div class="empty">' + (fa ? 'هنوز پیامی نداری. اولین سؤالت رو بپرس 👇' : 'No messages yet. Ask your first question below 👇') + '</div>';
  } else {
    host.innerHTML = msgs.map(function (m) { return supportMsgHTML(m, fa, false); }).join('');
  }
  paintSupportBadges();
  var btn = document.getElementById('sup-send');
  if (btn) btn.addEventListener('click', async function () {
    var inp = document.getElementById('sup-input');
    var err = document.getElementById('sup-error');
    var body = ((inp && inp.value) || '').trim();
    if (!body) { if (err) err.textContent = fa ? 'اول سؤالت رو بنویس.' : 'Write your question first.'; return; }
    btn.disabled = true;
    var ok = false;
    try { var rr = await sb.rpc('send_support_message', { p_body: body }); ok = !rr.error && rr.data === true; } catch (e) { ok = false; }
    if (ok) {
      if (host.querySelector('.empty')) host.innerHTML = '';
      host.insertAdjacentHTML('beforeend', supportMsgHTML({ from_admin: false, body: body, created_at: new Date().toISOString() }, fa, false));
      inp.value = ''; if (err) err.textContent = '';
      window.scrollTo(0, document.body.scrollHeight);
    } else {
      if (err) err.textContent = fa ? 'ارسال نشد؛ اتصالت رو چک کن و دوباره تلاش کن.' : 'Could not send — check your connection and try again.';
    }
    btn.disabled = false;
  });
}

