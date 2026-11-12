/* ---------------- streak engine (local-first, Supabase RPC when migrated) ----------------
   Rules (mirrored in supabase-streak-migration.sql → record_streak_day):
   consecutive day → streak+1 · exactly one missed day → freeze auto-consumed ·
   longer gap → reset to 1 · every 7-day milestone → earn one freeze. */
function streakKey() {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_streak_' + email;
}
function getStreakLocal() {
  try { return JSON.parse(localStorage.getItem(streakKey()) || '{}'); }
  catch (e) { return {}; }
}
function setStreakLocal(s) {
  try { localStorage.setItem(streakKey(), JSON.stringify(s)); } catch (e) {}
}
function recordStreakDayLocal(dateStr) {
  const s = getStreakLocal();
  const cur = s.current_streak || 0, best = s.longest_streak || 0;
  const freezes = s.streak_freezes || 0, last = s.last_streak_date || null;
  if (last === dateStr) {
    return { ok: true, is_new: false, current_streak: cur, longest_streak: best,
             freezes: freezes, frozen: false, milestone: false, source: 'local' };
  }
  let ns, frozen = false;
  if (!last) { ns = 1; }
  else {
    const gap = Math.round((new Date(dateStr + 'T12:00:00') - new Date(last + 'T12:00:00')) / 86400000);
    if (gap === 1) ns = cur + 1;
    else if (gap === 2 && freezes > 0) { ns = cur + 1; frozen = true; }
    else ns = 1;
  }
  const milestone = ns % 7 === 0;
  const nf = freezes - (frozen ? 1 : 0) + (milestone ? 1 : 0);
  setStreakLocal({ current_streak: ns, longest_streak: Math.max(best, ns),
                   last_streak_date: dateStr, streak_freezes: nf });
  return { ok: true, is_new: true, current_streak: ns, longest_streak: Math.max(best, ns),
           freezes: nf, frozen: frozen, milestone: milestone, source: 'local' };
}
async function recordStreakDay() {
  const dateStr = todayStr();
  if (cloudReady()) {
    try {
      const r = await sb.rpc('record_streak_day', { p_date: dateStr });
      if (!r.error && r.data && r.data.ok) {
        const d = r.data;
        return { ok: true, is_new: !!d.is_new, current_streak: d.current_streak,
                 longest_streak: d.longest_streak, freezes: d.freezes,
                 frozen: !!d.frozen, milestone: !!d.milestone, source: 'cloud' };
      }
    } catch (e) { /* pre-migration → local fallback */ }
  }
  return recordStreakDayLocal(dateStr);
}
async function grantFreeze() {
  if (cloudReady()) {
    try {
      const r = await sb.rpc('grant_streak_freeze');
      if (!r.error && r.data && r.data.ok) return r.data.freezes;
    } catch (e) { /* pre-migration → local fallback */ }
  }
  const s = getStreakLocal();
  const nf = (s.streak_freezes || 0) + 1;
  s.streak_freezes = nf; setStreakLocal(s);
  return nf;
}
/* Called by the podcast gift when a Streak Freeze is won (was referenced but
   never defined — ReferenceError, 2026-10-25). The freeze count is rendered
   by the home streak banner and the progress stats from streak state, so a
   banner refresh is all that is needed; safe no-op anywhere else. */
function updateFreezeLine(n) {
  try { if (document.getElementById('home-streak-wrap')) refreshHomeStreak(); } catch (e) {}
}
/* Dates (YYYY-MM-DD) with words read + quiz done — the streak-qualifying
   days (2026-10-14 rule). Used for the streak week strip, which lives on
   the streak card. */
function getStreakDayDates() {
  try {
    const all = getAllProgress();
    const set = {};
    Object.keys(all).forEach(function (d) {
      if (all[d] && all[d].words && all[d].quiz) set[d] = 1;
    });
    return set;
  } catch (e) { return {}; }
}
/* Dates (YYYY-MM-DD) with a completed word quiz — kept for other uses. */
async function getWordQuizDates() {
  try {
    const attempts = await getAttempts();
    const set = {};
    attempts.forEach(function (a) { if (a && a.kind === 'word' && a.date) set[a.date] = 1; });
    return set;
  } catch (e) { return {}; }
}
function weekStripHTML(dateSet) {
  const now = new Date();
  const dow = now.getDay(); /* 0 = Su */
  const start = new Date(now); start.setDate(now.getDate() - dow);
  const names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  let days = '', dots = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const done = !!dateSet[fmtDate(d)];
    days += '<span class="' + (i === dow ? 'today' : '') + '">' + names[i] + '</span>';
    dots += '<span><i class="' + (done ? 'on' : (i === 6 ? 'star' : 'off')) + '">' +
            (done ? '✓' : (i === 6 ? '★' : '')) + '</i></span>';
  }
  return '<div class="cel-week"><div class="cel-wdays">' + days +
         '</div><div class="cel-wdots">' + dots + '</div></div>';
}

/* Read-only streak state (never records a day): Supabase profile when migrated,
   localStorage fallback otherwise. */
async function getStreakState() {
  if (cloudReady()) {
    try {
      const r = await sb.from('profiles')
        .select('current_streak,longest_streak,streak_freezes')
        .eq('id', state.user.id).single();
      if (!r.error && r.data) {
        const cs = { current_streak: r.data.current_streak || 0,
                     longest_streak: r.data.longest_streak || 0,
                     freezes: r.data.streak_freezes || 0, source: 'cloud' };
        /* Persist the cloud truth locally so the next first paint isn't stale. */
        try {
          const prev = getStreakLocal();
          setStreakLocal({ current_streak: cs.current_streak, longest_streak: cs.longest_streak,
                           streak_freezes: cs.freezes, last_streak_date: prev.last_streak_date || null });
        } catch (e) {}
        return cs;
      }
    } catch (e) { /* pre-migration → local fallback */ }
  }
  const s = getStreakLocal();
  return { current_streak: s.current_streak || 0, longest_streak: s.longest_streak || 0,
           freezes: s.streak_freezes || 0, source: 'local' };
}
async function getMyPrizes() {
  if (cloudReady()) {
    try {
      const r = await sb.from('scores').select('points,ref,created_at')
        .eq('user_id', state.user.id).eq('action', 'mystery_box')
        .order('created_at', { ascending: false }).limit(20);
      if (!r.error && r.data) return r.data;
    } catch (e) {}
  }
  return [];
}
async function getMyPoints() {
  if (cloudReady()) {
    try {
      const r = await sb.rpc('my_points');
      if (!r.error && typeof r.data === 'number') { state.myPoints = r.data; return r.data; }
    } catch (e) {}
  }
  return state.myPoints || 0;
}
function prizeLabel(points) {
  if (points === 50) return '+50 XP';
  if (points === 20) return '+20 XP';
  if (points === 30) return '⭐ Weekly Star';
  return '🧊 Streak Freeze';
}
/* ---------------- home streak card ---------------- */
function homeWeekStripHTML(dateSet) {
  const now = new Date();
  const dow = now.getDay();
  const start = new Date(now); start.setDate(now.getDate() - dow);
  const names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let out = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const done = !!(dateSet && dateSet[fmtDate(d)]);
    out += '<span class="hw-day' + (i === dow ? ' today' : '') + '">' +
           '<i class="hw-name">' + names[i] + '</i>' +
           '<i class="hw-dot' + (done ? ' on' : '') + '"></i></span>';
  }
  return '<div class="hw-strip">' + out + '</div>';
}
function streakCardHTML(st, dates) {
  st = st || {};
  const n = st.current_streak || 0;
  const fr = (st.freezes != null ? st.freezes : st.streak_freezes) || 0;
  const headline = n > 0
    ? '<div class="streak-topline"><span class="streak-num">' + n + '</span>' +
      '<span class="streak-unit">day streak!</span></div>'
    : '<div class="streak-topline"><span class="streak-start">Start your streak today! \uD83D\uDD25</span></div>';
  return '<section class="card streak-card" aria-label="Your streak">' +
    '<img class="streak-flame" src="/media/celebration/flame.webp" alt="Streak flame">' +
    '<div class="streak-main">' + headline +
      homeWeekStripHTML(dates) +
      '<div class="streak-freezes">\uD83E\uDDCA ' + fr + ' freeze' + (fr === 1 ? '' : 's') + ' ready</div>' +
    '</div></section>';
}
async function refreshHomeStreak() {
  try {
    const res = await Promise.all([getStreakState(), Promise.resolve(getStreakDayDates())]);
    const wrap = document.getElementById('home-streak-wrap');
    if (!wrap || state.view !== 'home') return;
    wrap.innerHTML = streakBannerHTML(res[0], res[1]);
  } catch (e) {}
}
/* ---------------- celebration sequence ----------------
   Two full-screen moments after the first word-quiz completion of the day:
   1. "Awesome! You finished today's lesson." (tap anywhere -> 2)
   2. "Want more points?" (Go to podcast / Maybe later).
   NOTE (2026-10-14 rule): the streak is NOT recorded here anymore — it is
   recorded by markStep() once the words are genuinely read and the quiz
   is done (words + quiz, today's lesson only). */
var celState = null;
var QCEL_ART = {
  a: '/media/celebration/quiz-awesome.webp',
  b: '/media/celebration/quiz-more-points.webp'
};
/* tap zones as fractions of the 941x1672 art (baked-in buttons) */
var QCEL_ZONES = {
  b: [{ k: 'go', l: .09, t: .795, w: .82, h: .095 },
      { k: 'later', l: .09, t: .892, w: .82, h: .075 }]
};
function launchCelebration(info) {
  closeCelebration();
  celState = { info: info };
  qcelShow('a');
}
function qcelShow(stage) {
  qcelClear();
  const root = document.createElement('div');
  root.id = 'celebration';
  root.setAttribute('data-stage', stage);
  root.innerHTML =
    '<div class="podms-stage">' +
      '<img class="podms-art" src="' + QCEL_ART[stage] + '" alt="">' +
      '<div class="podms-zones"></div>' +
    '</div>';
  document.body.appendChild(root);
  if (stage === 'a') {
    root.querySelector('.podms-stage').addEventListener('click', function () { qcelShow('b'); });
  } else {
    const zones = root.querySelector('.podms-zones');
    (QCEL_ZONES[stage] || []).forEach(function (z) {
      const b = document.createElement('button');
      b.className = 'podms-tap';
      b.setAttribute('aria-label', z.k);
      zones.appendChild(b);
      b.addEventListener('click', function (e) { e.stopPropagation(); qcelTap(z.k); });
    });
  }
  qcelLayout();
  window.addEventListener('resize', qcelLayout);
}
function qcelLayout() {
  try {
    const root = document.getElementById('celebration');
    if (!root) return;
    const zs = QCEL_ZONES[root.getAttribute('data-stage')];
    if (!zs) return;
    const W = root.clientWidth, H = root.clientHeight;
    const iw = 941, ih = 1672;
    const sc = Math.max(W / iw, H / ih);
    const dw = iw * sc, dh = ih * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
    root.querySelectorAll('.podms-tap').forEach(function (b, i) {
      const z = zs[i]; if (!z) return;
      b.style.left = (ox + z.l * dw) + 'px';
      b.style.top = (oy + z.t * dh) + 'px';
      b.style.width = (z.w * dw) + 'px';
      b.style.height = (z.h * dh) + 'px';
    });
  } catch (e) {}
}
function qcelTap(k) {
  const info = celState && celState.info;
  if (k === 'go') {
    const d = (info && info.date) || todayStr();
    closeCelebration();
    state.lessonTab = 'podcast';
    go('lesson', d);
  } else {
    closeCelebration();
    go('home');
  }
}
function qcelClear() {
  window.removeEventListener('resize', qcelLayout);
  const el = document.getElementById('celebration');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
function closeCelebration() {
  qcelClear();
  celState = null;
}

/* ---------------- rank-climb celebration (2026-10-10) ----------------
   After the first word-quiz of the day: snapshot the weekly rank BEFORE the
   XP lands, award the points, snapshot AFTER, then animate the user climbing
   the board. Top-3 finishes reveal the podium (same cards as #/challenge).
   The board is live, so a #1 finish is framed as "right now — race is LIVE",
   never as a permanent championship. */
async function getRankSnapshot() {
  try {
    if (!state.user || state.user.demo || !sb || !cloudReady()) return null;
    const r = await sb.rpc('get_leaderboard', { period_start: weekStartISO() });
    const rows = (!r.error && Array.isArray(r.data)) ? r.data : [];
    const board = mergeBoard(rows, true);
    const meId = state.user.id;
    for (let i = 0; i < board.length; i++) {
      if (board[i].user_id === meId) return { rank: i + 1, points: board[i].points, board: board };
    }
    return null;
  } catch (e) { return null; }
}

/* Once-per-key guard for the rank-climb celebration (grammar: per day, assignment: per id). */
function rkcDone(type, key) {
  try {
    const k = 'rkc_done_' + type + '_' + key;
    if (localStorage.getItem(k)) return true;
    localStorage.setItem(k, '1');
    return false;
  } catch (e) { return false; }
}

async function launchRankClimb(info) {
  const before = await getRankSnapshot();
  await awardPoints(info.action || 'word_quiz', info.xp, info.date);
  try { await refreshMyPoints(); } catch (e) {}
  /* small delay: let the points RPC settle so the after-snapshot sees them */
  await new Promise(function (res) { setTimeout(res, 1200); });
  const after = await getRankSnapshot();
  if (before && after) {
    showRankClimb(before, after, info, function () { launchCelebration(info); });
  } else {
    launchCelebration(info);
  }
}

function rkcRowHTML(u, rank, isMe) {
  return '<div class="r-num">' + rank + '</div>' +
    '<div class="r-ava" style="' + avatarStyle(u.display_name) + '">' + esc(nickInitial(u.display_name)) + '</div>' +
    '<div class="r-name">' + esc(u.display_name) + '</div>' +
    '<div class="r-pts">◆ <span>' + Number(u.points).toLocaleString('en-US') + '</span></div>';
}

function rkcPodiumCard(u, place, isMe) {
  const medal = place === 1 ? 'm1' : place === 2 ? 'm2' : 'm3';
  return '<div class="rkc-pd p' + place + (isMe ? ' me' : '') + '">' +
    (place === 1 ? '<div class="rkc-crown">👑</div>' : '') +
    '<div class="rkc-pdava" style="' + avatarStyle(u.display_name) + '">' + esc(nickInitial(u.display_name)) + '</div>' +
    '<div class="rkc-medal ' + medal + '">' + place + '</div>' +
    '<div class="rkc-pdname">' + esc(u.display_name) + '</div>' +
    (isMe ? '<span class="rkc-you">YOU</span>' : '') +
    '<div class="rkc-pdpts">◆ ' + Number(u.points).toLocaleString('en-US') + '</div>' +
  '</div>';
}

function showRankClimb(before, after, info, onDone) {
  const meId = state.user.id;
  const oldRank = before.rank, newRank = after.rank;
  const climbed = oldRank - newRank;
  const board = after.board;

  const ov = document.createElement('div');
  ov.id = 'rankclimb';
  ov.innerHTML =
    '<div class="rkc-stars"></div>' +
    '<div class="rkc-sheet">' +
      '<h2>Weekly Challenge</h2>' +
      '<p class="rkc-sub">Watch yourself climb! 🧗</p>' +
      '<div class="rkc-earn"><div class="rkc-bigpts">+<span id="rkc-xp">0</span></div><div class="rkc-lbl">points earned — lesson complete!</div></div>' +
      '<div class="rkc-champ" id="rkc-champ" style="display:none">' +
        '<span class="rkc-bolt">⚡</span><h3>You\'re #1!</h3><p>Right now — but the race is <b>LIVE</b></p>' +
      '</div>' +
      '<div class="rkc-podium" id="rkc-podium"></div>' +
      '<div class="rkc-board" id="rkc-board"></div>' +
      '<div class="rkc-result" id="rkc-result"></div>' +
      '<button class="rkc-cta" id="rkc-cta">View Full Leaderboard</button>' +
      '<button class="rkc-skip" id="rkc-skip">Continue</button>' +
    '</div>';
  document.body.appendChild(ov);

  const done = function () {
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    try { onDone(); } catch (e) {}
  };
  ov.querySelector('#rkc-skip').addEventListener('click', done);
  ov.querySelector('#rkc-cta').addEventListener('click', function () {
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    go('challenge');
  });

  const boardEl = ov.querySelector('#rkc-board');
  const podiumEl = ov.querySelector('#rkc-podium');
  const resultEl = ov.querySelector('#rkc-result');

  /* window: 2 above the new rank .. 2 below the old rank, capped at 12 rows */
  const winTop = Math.max(1, newRank - 2);
  let winBottom = Math.min(board.length, oldRank + 2);
  if (winBottom - winTop > 11) winBottom = winTop + 11;
  const winUsers = board.slice(winTop - 1, winBottom);

  function renderRows(order, ranks) {
    boardEl.innerHTML = '';
    order.forEach(function (u, i) {
      const d = document.createElement('div');
      const isMe = u.user_id === meId;
      d.className = 'rkc-row' + (isMe ? ' me' : '');
      d.setAttribute('data-uid', u.user_id);
      d.innerHTML = rkcRowHTML(u, ranks[i], isMe);
      boardEl.appendChild(d);
    });
  }

  /* initial order: AFTER-board window, but user inserted at old-rank slot */
  const startOrder = winUsers.slice();
  const meAfter = board[newRank - 1];
  const meIdxWin = startOrder.findIndex(function (u) { return u.user_id === meId; });
  if (meIdxWin >= 0) startOrder.splice(meIdxWin, 1);
  let insertAt = oldRank - winTop;
  if (insertAt < 0) insertAt = 0;
  if (insertAt > startOrder.length) insertAt = startOrder.length;
  const meBefore = Object.assign({}, meAfter, { points: before.points });
  startOrder.splice(insertAt, 0, meBefore);
  /* ranks: walk the window; me shows oldRank, others their window rank */
  const startRanks = [];
  let rk = winTop;
  startOrder.forEach(function (u) {
    if (u.user_id === meId) startRanks.push(oldRank);
    else { startRanks.push(rk); rk++; }
  });
  renderRows(startOrder, startRanks);

  function flipSwap(elA, elB, cb) {
    const rows = Array.prototype.slice.call(boardEl.children);
    const first = {};
    rows.forEach(function (r) { first[r.getAttribute('data-uid')] = r.getBoundingClientRect().top; });
    boardEl.insertBefore(elA, elB);
    rows.forEach(function (r) {
      const dy = first[r.getAttribute('data-uid')] - r.getBoundingClientRect().top;
      r.style.transition = 'none';
      r.style.transform = 'translateY(' + dy + 'px)';
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        rows.forEach(function (r) {
          r.style.transition = 'transform .38s cubic-bezier(.25,.9,.25,1)';
          r.style.transform = '';
        });
        setTimeout(cb, 400);
      });
    });
  }

  /* XP count-up, then climb */
  const xpEl = ov.querySelector('#rkc-xp');
  let n = 0;
  const xpTimer = setInterval(function () {
    n += Math.max(1, Math.round(info.xp / 20));
    if (n >= info.xp) { n = info.xp; clearInterval(xpTimer); }
    xpEl.textContent = n;
  }, 45);
  ov.querySelector('.rkc-earn').classList.add('show');

  setTimeout(function () {
    if (climbed <= 0) { finishNoClimb(); return; }
    const meRow = function () { return boardEl.querySelector('.rkc-row.me'); };
    const mePtsEl = function () { const r = meRow(); return r ? r.querySelector('.r-pts span') : null; };
    meRow().classList.add('climbing');
    let curRank = oldRank, s = 0;
    const steps = Math.min(climbed, 12);
    const ptsFrom = before.points, ptsTo = after.points;
    (function step() {
      if (s >= steps) { finishClimb(curRank); return; }
      const rows = boardEl.children;
      let idx = -1;
      for (let i = 0; i < rows.length; i++) if (rows[i].classList.contains('me')) idx = i;
      if (idx <= 0) { finishClimb(curRank); return; }
      const above = rows[idx - 1];
      above.classList.add('passed');
      flipSwap(rows[idx], above, function () {
        curRank--; s++;
        const pe = mePtsEl();
        if (pe) pe.textContent = Math.round(ptsFrom + (ptsTo - ptsFrom) * (s / steps)).toLocaleString('en-US');
        renumberBoard(curRank);
        step();
      });
    })();

    function renumberBoard(meRank) {
      /* rows above me: winTop..meRank-1 ; me: meRank ; below: meRank+1.. */
      let k = winTop;
      Array.prototype.forEach.call(boardEl.children, function (r) {
        if (r.classList.contains('me')) { r.querySelector('.r-num').textContent = meRank; k = meRank + 1; }
        else { r.querySelector('.r-num').textContent = k; k++; }
      });
    }

    function finishClimb(finalRank) {
      const mr = meRow();
      if (mr) mr.classList.remove('climbing');
      if (finalRank !== newRank) {
        /* huge climb: re-render the window centered on the true new rank */
        const wTop = Math.max(1, newRank - 2);
        const wBot = Math.min(board.length, newRank + 5);
        boardEl.innerHTML = '';
        board.slice(wTop - 1, wBot).forEach(function (u, i) {
          const d = document.createElement('div');
          d.className = 'rkc-row' + (u.user_id === meId ? ' me' : '');
          d.setAttribute('data-uid', u.user_id);
          d.innerHTML = rkcRowHTML(u, wTop + i, u.user_id === meId);
          boardEl.appendChild(d);
        });
      }
      if (newRank <= 3) {
        /* podium reveal: top-3 of the AFTER board */
        const top3 = board.slice(0, 3);
        podiumEl.innerHTML =
          rkcPodiumCard(top3[1], 2, top3[1].user_id === meId) +
          rkcPodiumCard(top3[0], 1, top3[0].user_id === meId) +
          rkcPodiumCard(top3[2], 3, top3[2].user_id === meId);
        podiumEl.classList.add('show');
        boardEl.innerHTML = '';
        const rest = board.slice(3, winBottom);
        rest.forEach(function (u, i) {
          const d = document.createElement('div');
          d.className = 'rkc-row' + (u.user_id === meId ? ' me' : '');
          d.setAttribute('data-uid', u.user_id);
          d.innerHTML = rkcRowHTML(u, i + 4, u.user_id === meId);
          boardEl.appendChild(d);
        });
      }
      showResult();
    }

    function finishNoClimb() {
      renumberNoClimb();
      showResult();
    }
    function renumberNoClimb() {
      Array.prototype.forEach.call(boardEl.children, function (r) {
        if (r.classList.contains('me')) r.querySelector('.r-num').textContent = newRank;
      });
    }

    function showResult() {
      let html;
      if (newRank === 1) {
        ov.querySelector('#rkc-champ').style.display = 'block';
        requestAnimationFrame(function () { ov.querySelector('#rkc-champ').classList.add('show'); });
        const chaser = board[1];
        const gap = Math.max(0, Math.round(after.points - chaser.points));
        html = '<div class="big">⚡ You\'re #1 — right now!</div>' +
          '<div class="small">👀 <b>' + esc(chaser.display_name) + '</b> is only <b>' + gap + ' points</b> behind — anyone can pass you any minute!</div>';
      } else if (climbed > 0) {
        html = '<div class="big">🚀 You climbed ' + climbed + ' position' + (climbed > 1 ? 's' : '') + '!</div>';
        if (newRank <= 3) html += '<div class="small">You\'re on the <b>podium</b>! 🏆</div>';
        else {
          const above = board[newRank - 2];
          const gap = Math.max(0, Math.round(above.points - after.points));
          html += '<div class="small">Only <b>' + gap + ' points</b> to overtake <b>' + esc(above.display_name) + '</b>! 💪</div>';
        }
      } else {
        html = '<div class="big">You held #' + newRank + '! 💪</div>' +
          '<div class="small">Keep earning to climb higher.</div>';
      }
      resultEl.innerHTML = html;
      resultEl.classList.add('show');
      ov.querySelector('#rkc-cta').classList.add('show');
      ov.querySelector('#rkc-skip').classList.add('show');
    }
  }, 1300);
}

/* ---------------- podcast milestone celebrations (2026-10-02, v2 art) ----------------
   Genuine-listening milestones at 2:00 and 5:00 of the podcast, plus a +30 XP
   bonus when the episode is genuinely listened to the end.
   Only real playback counts (seeks don't).
   m2: "Great!" art -> Open gift -> random prize -> 2s -> "Keep going!" art
       (Continue now = resume podcast / Later = dismiss)
   m5: "Amazing!" art -> Open gift -> +20 XP -> 2s -> "Next Challenge!" art
       (Continue now / Later)
   end: podcast played to the end -> +30 XP celebration.
   Once per day per milestone. */
var podMs = { date: null, lastPos: 0, listened: 0, m2: false, m5: false, end: false, busy: false };
var podMsState = null;
var podMsLastSave = 0;

/* full-screen art per stage (941x1672 originals) */
var PODMS_ART = {
  m2a: '/media/celebration/pod-ms2-great.webp',
  m2b: '/media/celebration/pod-ms2-keepgoing.webp',
  m5a: '/media/celebration/pod-ms5-amazing.webp',
  m5b: '/media/celebration/pod-ms5-next.webp'
};
/* tap zones as fractions of the art (baked-in buttons) */
var PODMS_ZONES = {
  m2a: [{ k: 'gift', l: .09, t: .862, w: .82, h: .09 }],
  m5a: [{ k: 'gift', l: .09, t: .865, w: .82, h: .09 }],
  m2b: [{ k: 'cont', l: .11, t: .75, w: .78, h: .10 },
         { k: 'later', l: .15, t: .848, w: .70, h: .08 }],
  m5b: [{ k: 'cont', l: .09, t: .792, w: .82, h: .10 },
         { k: 'later', l: .15, t: .883, w: .70, h: .075 }]
};

function podMsLoad() {
  const d = todayStr();
  podMs.date = d; podMs.lastPos = 0;
  let s = null;
  try { s = JSON.parse(localStorage.getItem('podms_' + ((state.user && state.user.email) || 'anon') + '_' + d) || 'null'); } catch (e) {}
  if (s) { podMs.listened = s.listened || 0; podMs.m2 = !!s.m2; podMs.m5 = !!s.m5; podMs.end = !!s.end; }
  else { podMs.listened = 0; podMs.m2 = false; podMs.m5 = false; podMs.end = false; }
  podMs.lastBump = podMs.listened;
}
function podMsSave() {
  try {
    localStorage.setItem('podms_' + ((state.user && state.user.email) || 'anon') + '_' + todayStr(),
      JSON.stringify({ listened: Math.floor(podMs.listened), m2: podMs.m2, m5: podMs.m5, end: podMs.end }));
  } catch (e) {}
}
function podMsTrack() {
  try {
    if (podMs.date !== todayStr()) podMsLoad();
    if (podMs.busy) return;
    const cur = player.el.currentTime || 0;
    if (!player.src || player.src.indexOf('podcast.mp3') === -1 || player.el.paused) {
      podMs.lastPos = cur; return;
    }
    const delta = cur - podMs.lastPos;
    podMs.lastPos = cur;
    const rate = player.el.playbackRate || 1;
    if (delta > 0 && delta < 2.5 * rate) {
      podMs.listened += delta;
      if (podMs.listened - (podMs.lastBump || 0) >= 60) {
        const add = Math.floor(podMs.listened - (podMs.lastBump || 0));
        podMs.lastBump = podMs.listened;
        bumpStat('podcast_seconds', add);
      }
      if (Date.now() - podMsLastSave > 20000) { podMsLastSave = Date.now(); podMsSave(); }
      if (!podMs.m2 && podMs.listened >= 120) firePodMs(2);
      else if (!podMs.m5 && podMs.listened >= 300) firePodMs(5);
    }
  } catch (e) {}
}
function podMsOnEnded() {
  try {
    if (podMs.date !== todayStr()) podMsLoad();
    if (podMs.end || podMs.busy) return;
    if (!player.src || player.src.indexOf('podcast.mp3') === -1) return;
    const dur = player.el.duration || 0;
    if (dur > 0 && podMs.listened >= dur * 0.8) {
      podMs.end = true; podMsSave();
      podMsShowEnd();
    }
  } catch (e) {}
}
function firePodMs(which) {
  if (podMs.busy || document.getElementById('celebration') || document.getElementById('podms')) return;
  podMs['m' + which] = true; podMsSave();
  trackEvent('podcast_milestone', { minutes: which });
  podMs.busy = true;
  try { player.el.pause(); } catch (e) {}
  playerUI(); refreshTrackCards();
  podMsState = { which: which, prize: null, timer: null };
  podMsShow('m' + which + 'a');
}
/* render one full-screen art stage with invisible tap zones over the baked buttons */
function podMsShow(stage) {
  podMsClear();
  const root = document.createElement('div');
  root.id = 'podms';
  root.setAttribute('data-stage', stage);
  root.innerHTML =
    '<div class="podms-stage">' +
      '<img class="podms-art" src="' + PODMS_ART[stage] + '" alt="">' +
      '<div class="podms-zones"></div>' +
      '<div class="podms-reveal" id="podms-reveal"><div class="podms-reveal-card">' +
        '<div class="pr-emoji" id="podms-reveal-emoji">\uD83C\uDF81</div>' +
        '<div class="pr-label" id="podms-reveal-label">+10 XP</div>' +
        '<div class="pr-sub">tap to continue</div>' +
      '</div></div>' +
    '</div>';
  document.body.appendChild(root);
  const zones = root.querySelector('.podms-zones');
  (PODMS_ZONES[stage] || []).forEach(function (z) {
    const b = document.createElement('button');
    b.className = 'podms-tap';
    b.setAttribute('aria-label', z.k);
    zones.appendChild(b);
    b.addEventListener('click', function (e) { e.stopPropagation(); podMsTap(z.k); });
  });
  document.getElementById('podms-reveal').addEventListener('click', function () {
    const st = podMsState;
    if (st && st.timer) { clearTimeout(st.timer); st.timer = null; }
    podMsNextArt();
  });
  podMsLayout();
  window.addEventListener('resize', podMsLayout);
}
/* map art-fraction zones onto the cover-fit image */
function podMsLayout() {
  try {
    const root = document.getElementById('podms');
    if (!root) return;
    const stage = root.getAttribute('data-stage');
    const W = root.clientWidth, H = root.clientHeight;
    const iw = 941, ih = 1672;
    /* Wide screens: fit the art by HEIGHT so the whole design stays visible
       (phone-like card centered on the black backdrop). Portrait phones keep
       the cover fit. Pure cover on landscape cropped the top/bottom of the
       portrait art — the baked buttons live at ~86% height, so they and their
       tap zones landed off-screen and the milestone could not be dismissed
       on desktop (Alireza, 2026-10-25). The art box is sized explicitly here
       so the zones below always map onto the visible art. */
    const sc = (W / H > iw / ih) ? (H / ih) : Math.max(W / iw, H / ih);
    const dw = iw * sc, dh = ih * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
    const art = root.querySelector('.podms-art');
    if (art) {
      art.style.left = ox + 'px'; art.style.top = oy + 'px';
      art.style.width = dw + 'px'; art.style.height = dh + 'px';
    }
    const zs = PODMS_ZONES[stage];
    if (!zs) return;
    const btns = root.querySelectorAll('.podms-tap');
    btns.forEach(function (b, i) {
      const z = zs[i]; if (!z) return;
      b.style.left = (ox + z.l * dw) + 'px';
      b.style.top = (oy + z.t * dh) + 'px';
      b.style.width = (z.w * dw) + 'px';
      b.style.height = (z.h * dh) + 'px';
    });
  } catch (e) {}
}
function podMsTap(k) {
  if (!podMsState) return;
  if (k === 'gift') podMsOpenGift();
  else if (k === 'cont') podMsResume();
  else if (k === 'later') closePodMs();
}
function podMsOpenGift() {
  const st = podMsState;
  if (!st || st.prize) return;
  const date = todayStr();
  let prize;
  if (st.which === 2) {
    const pool = [
      { label: '+10 XP', points: 10 },
      { label: '+20 XP', points: 20 },
      { label: '+30 XP', points: 30 },
      { label: 'Streak Freeze', points: 0, freeze: true }
    ];
    prize = pool[Math.floor(Math.random() * pool.length)];
    awardPoints('podcast_milestone', prize.points, date + '-m2', true);
    if (prize.freeze) { try { grantFreeze().then(function (n) { updateFreezeLine(n); }); } catch (e) {} }
  } else {
    prize = { label: '+20 XP', points: 20 };
    awardPoints('podcast_milestone', 20, date + '-m5', true);
  }
  st.prize = prize;
  document.getElementById('podms-reveal-emoji').textContent = prize.freeze ? '\uD83E\uDDCA' : '\uD83C\uDF89';
  document.getElementById('podms-reveal-label').textContent = prize.label;
  document.getElementById('podms-reveal').classList.add('show');
  st.timer = setTimeout(podMsNextArt, 2000);
}
function podMsNextArt() {
  const st = podMsState;
  if (!st || st.which === 'end') return;
  podMsShow('m' + st.which + 'b');
}
function podMsShowEnd() {
  if (podMs.busy || document.getElementById('celebration') || document.getElementById('podms')) return;
  podMs.busy = true;
  try { player.el.pause(); } catch (e) {}
  awardPoints('podcast_milestone', 30, todayStr() + '-end', true);
  podMsState = { which: 'end', prize: { label: '+30 XP', points: 30 }, timer: null };
  const root = document.createElement('div');
  root.id = 'podms';
  root.setAttribute('data-stage', 'end');
  root.innerHTML =
    '<div class="podms-stage" id="podms-end-stage">' +
      '<img class="podms-art" src="/media/celebration/pod-end-complete.webp" alt="Podcast complete! +30 points">' +
    '</div>';
  document.body.appendChild(root);
  document.getElementById('podms-end-stage').addEventListener('click', closePodMs);
  podMsLayout();
  window.addEventListener('resize', podMsLayout);
}
function podMsClear() {
  window.removeEventListener('resize', podMsLayout);
  const el = document.getElementById('podms');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
function closePodMs() {
  const st = podMsState;
  if (st && st.timer) { try { clearTimeout(st.timer); } catch (e) {} }
  podMs.busy = false;
  try { podMs.lastPos = player.el.currentTime || 0; } catch (e) {}
  podMsClear();
  podMsState = null;
}
function podMsResume() {
  closePodMs();
  const d = (state.lesson && state.lesson.date) || todayStr();
  state.lessonTab = 'podcast';
  go('lesson', d);
  setTimeout(function () {
    try {
      const p = player.el.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
    podMs.lastPos = player.el.currentTime || 0;
    playerUI(); refreshTrackCards();
  }, 350);
}

