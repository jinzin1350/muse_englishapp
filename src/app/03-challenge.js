/* ---------------- challenge: points ledger + leaderboard ----------------
   Every rewarded action writes one row to public.scores. Dedupe is enforced
   twice: a per-user localStorage "done" set (fast, offline) and a DB unique
   index on (user_id, action, ref) via upsert onConflict.
   The Challenge view reads via get_leaderboard() (display_name/level/points
   only — emails are never exposed). */
var NICK_RE = /^[A-Za-z0-9_-]{3,20}$/;
function validNickname(n) { return NICK_RE.test(n || ''); }

async function nicknameTaken(nick) {
  if (!sb) return false;
  try {
    const r = await sb.rpc('nickname_available', { nick: nick });
    if (r.error) return false; // fail-open pre-migration; the DB unique index is the backstop
    return r.data === false;
  } catch (e) { return false; }
}

/* Inline SVG icon set for the Challenge UI — same outline style as the tab
   bar (24 viewBox, 1.8 stroke, round caps). No emojis anywhere in this UI. */
function svgIcon(paths) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}
var ICO = {
  trophy: svgIcon('<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H5a2 2 0 0 0 0 4h2"/><path d="M17 6h2a2 2 0 0 1 0 4h-2"/>'),
  users: svgIcon('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  medal: svgIcon('<circle cx="12" cy="14" r="5"/><path d="M8.6 9.7 6 3h4l2 3.6L14 3h4l-2.6 6.7"/>'),
  gem: svgIcon('<path d="M6 3h12l4 6-10 12L2 9l4-6z"/><path d="M2 9h20"/>'),
  crown: svgIcon('<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>'),
  zap: svgIcon('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  flame: svgIcon('<path d="M12 22c4.4 0 7.5-3 7.5-7.5 0-3.5-2.5-6-4.5-8-.8 1.8-2.2 2.8-2.2 4.7-1.2-.8-2-2-2.3-3.7C8 9.5 4.5 12 4.5 14.5 4.5 19 7.6 22 12 22z"/>'),
  eye: svgIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  headphones: svgIcon('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>'),
  mic: svgIcon('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  quiz: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  doc: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  book: svgIcon('<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>'),
  check: svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  refresh: svgIcon('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  lock: svgIcon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  grid: svgIcon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')
};

var PTS_LABELS = {
  lesson_open: 'Lesson opened',
  words_viewed: 'Words explored',
  podcast_complete: 'Podcast complete',
  shadowing_complete: 'Shadowing complete',
  word_quiz: 'Word quiz complete',
  grammar_quiz: 'Grammar quiz complete',
  grammar_exercise: 'Grammar exercise', tricky_q: 'Tricky Bits',
  grammar_topic_done: 'Grammar guide complete',
  deck_review: 'Review complete',
  streak_7: '7-day streak',
  mystery_box: 'Mystery box',
  podcast_milestone: 'Podcast milestone',
  shadowing_speaking: 'Speaking practice',
  summary_complete: 'Podcast summary',
  quest_daily: 'Daily quest'
};

function ptsKey(kind) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_pts_' + kind + '_' + email;
}
function ptsGet(kind) {
  try { return JSON.parse(localStorage.getItem(ptsKey(kind)) || '{}'); }
  catch (e) { return {}; }
}
function ptsSet(kind, obj) {
  try { localStorage.setItem(ptsKey(kind), JSON.stringify(obj)); } catch (e) {}
}

/* Award points for an action. Real logged-in users only; each action+ref
   awards once. On success the celebratory popup fires; on failure the award
   is queued and retried on the next login. */
async function awardPoints(action, points, ref, noPopup, extraMeta) {
  try {
    if (!state.user || state.user.demo || !state.user.id) return;
    ref = ref || '';
    const key = action + '|' + ref;
    const done = ptsGet('done');
    if (done[key]) return;
    let ok = false;
    if (sb) {
      try {
        const r = await sb.from('scores').upsert(
          { user_id: state.user.id, action: action, points: points, ref: ref },
          { onConflict: 'user_id,action,ref' }
        );
        if (!r.error) ok = true;
      } catch (e) { /* offline / pre-migration -> queue */ }
    }
    if (ok) {
      done[key] = Date.now();
      ptsSet('done', done);
      refreshMyPoints();
      if (points > 0 && !noPopup) queuePointsPopup(points, PTS_LABELS[action] || action);
      if (action === 'lesson_open') {
        bumpStat('lessons_opened', 1);
        trackEvent('lesson_open', Object.assign({ date: ref }, extraMeta || {}));
      }
      bumpStat('xp_earned', points);
      if (points > 0) bumpLocalXPDay(points);
      refreshQuests();
    } else {
      const pend = ptsGet('pending');
      pend[key] = { action: action, points: points, ref: ref, ts: Date.now() };
      ptsSet('pending', pend);
    }
  } catch (e) {}
}

/* Retry queued awards (runs after login). No popups for these — by the time
   the retry succeeds the moment has passed. */
async function flushPointsQueue() {
  try {
    if (!cloudReady()) return;
    const pend = ptsGet('pending');
    const keys = Object.keys(pend);
    if (!keys.length) return;
    const done = ptsGet('done');
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], p = pend[k];
      try {
        const r = await sb.from('scores').upsert(
          { user_id: state.user.id, action: p.action, points: p.points, ref: p.ref || '' },
          { onConflict: 'user_id,action,ref' }
        );
        if (!r.error) { done[k] = Date.now(); delete pend[k]; }
      } catch (e) { /* keep for next login */ }
    }
    ptsSet('done', done);
    ptsSet('pending', pend);
    refreshMyPoints();
  } catch (e) {}
}

async function refreshMyPoints() {
  try {
    if (!cloudReady()) return;
    const r = await sb.rpc('my_points');
    if (!r.error && typeof r.data === 'number') state.myPoints = r.data;
  } catch (e) {}
}

/* ---------- celebratory points popup (prize-like, queued, auto-dismiss) ---------- */
/* ---------- Daily quests (2026-10-09): 3 quests/day on home, bonus XP on claim.
   Progress is derived from existing local signals (day progress, awarded-points
   log, local XP-day counter); the reward goes through awardPoints() so the
   scores upsert keeps claims idempotent across devices. ---------- */
function xpDayKey() {
  try { return 'ela_xpday_' + (state.user && state.user.email ? state.user.email : 'anon') + '_' + todayStr(); }
  catch (e) { return null; }
}
function bumpLocalXPDay(points) {
  try {
    const k = xpDayKey();
    if (!k) return;
    const cur = parseInt(localStorage.getItem(k) || '0', 10) || 0;
    localStorage.setItem(k, String(cur + points));
  } catch (e) {}
}
function localXPDay() {
  try {
    const k = xpDayKey();
    if (!k) return 0;
    return parseInt(localStorage.getItem(k) || '0', 10) || 0;
  } catch (e) { return 0; }
}
function ptsDoneToday(action) {
  try { return !!ptsGet('done')[action + '|' + todayStr()]; }
  catch (e) { return false; }
}
function lessonLink(tab) {
  let d = todayStr();
  try { if (state.lessons && state.lessons[0] && state.lessons[0].date) d = state.lessons[0].date; } catch (e) {}
  return '#/lesson/' + d + (tab ? '/' + tab : '');
}
function markChallengeVisit() {
  try {
    if (!state.user || state.user.demo || !state.user.email) return;
    localStorage.setItem('ela_ch_' + state.user.email + '_' + todayStr(), '1');
  } catch (e) {}
}
function challengeVisited() {
  try {
    if (!state.user || !state.user.email) return false;
    return !!localStorage.getItem('ela_ch_' + state.user.email + '_' + todayStr());
  } catch (e) { return false; }
}
function pastLessonDone() {
  try {
    const done = ptsGet('done'), t = todayStr(), pre = 'lesson_open|';
    for (const k in done) {
      if (k.indexOf(pre) === 0 && k.slice(pre.length) !== t) return true;
    }
    return false;
  } catch (e) { return false; }
}
/* Quest pool (2026-10-09): every quest is clickable -> deep-links to the exact
   activity. 3 shown/day: the lesson quest is the fixed anchor, the other two
   rotate deterministically by date (same 3 for everyone each day). */
function questDefs() {
  const d = todayStr();
  const done = function (action) { return ptsDoneToday(action) ? 1 : 0; };
  const nSteps = stepsForDate(d).length;
  const pool = [
    { key: 'lesson', icon: '📝', xp: 30, target: nSteps, title: 'Complete today\'s lesson',
      progress: function () { try { return dayDoneCount(d); } catch (e) { return 0; } },
      unit: 'steps', link: lessonLink() },
    { key: 'xp100', icon: '⚡', xp: 20, target: 100, title: 'Earn 100 XP',
      progress: function () { return localXPDay(); },
      unit: 'XP', link: lessonLink() },
    { key: 'quiz', icon: '🎯', xp: 20, target: 1, title: 'Finish the word quiz',
      progress: function () { return done('word_quiz'); },
      unit: '', link: lessonLink('quiz') },
    { key: 'podcast', icon: '🎧', xp: 20, target: 1, title: 'Listen to the full podcast',
      progress: function () { return done('podcast_complete'); },
      unit: '', link: lessonLink('podcast') },
    { key: 'shadowing', icon: '🎤', xp: 20, target: 1, title: 'Complete shadowing',
      progress: function () { return done('shadowing_complete'); },
      unit: '', link: lessonLink('shadowing') },
    { key: 'grammar', icon: '📖', xp: 20, target: 1, title: 'Take a grammar quiz',
      progress: function () { return done('grammar_quiz'); },
      unit: '', link: lessonLink('grammar') },
    { key: 'review', icon: '🔁', xp: 15, target: 1, title: 'Answer your review questions',
      progress: function () { return done('deck_review'); },
      unit: '', link: '#/review' },
    { key: 'challenge', icon: '🏆', xp: 15, target: 1, title: 'Check out the challenge',
      progress: function () { return challengeVisited() ? 1 : 0; },
      unit: '', link: '#/challenge' },
    { key: 'pastlesson', icon: '📚', xp: 20, target: 1, title: 'Review a past lesson',
      progress: function () { return pastLessonDone() ? 1 : 0; },
      unit: '', link: '#/lessons' }
  ];
  /* Task 4: on a no-podcast day the podcast quest becomes the shadowing
     quest (and the pool's own shadowing entry is dropped to avoid a dup). */
  try {
    const tm = (state.lessons || []).find(function (x) { return x.date === d; });
    if (tm && !lessonHasPodcast(tm)) {
      for (let qi = 0; qi < pool.length; qi++) {
        if (pool[qi].key === 'podcast') {
          pool[qi] = { key: 'shadowing', icon: '🎤', xp: 20, target: 1, title: 'Complete shadowing',
            progress: function () { return done('shadowing_complete'); },
            unit: '', link: lessonLink('shadowing') };
        }
      }
      let seenShadowing = false;
      for (let qi = pool.length - 1; qi >= 0; qi--) {
        if (pool[qi].key === 'shadowing') {
          if (seenShadowing) pool.splice(qi, 1); else seenShadowing = true;
        }
      }
    }
  } catch (e) {}
  const anchor = pool[0];
  const rest = pool.slice(1);
  const dayNum = Math.floor(Date.parse(d + 'T12:00:00') / 86400000);
  const a = dayNum % rest.length;
  const b = (dayNum + 3) % rest.length;
  return [anchor, rest[a], rest[b]];
}
/* Quests auto-reward (2026-10-09, Alireza's call): no claim button — the moment a
   quest's progress hits its target, the XP is granted automatically. awardPoints
   is idempotent per (action, ref), so this is safe to run on every refresh: no
   double XP, and the "+XP" popup fires exactly once. */
function autoRewardQuests() {
  try {
    if (!state.user || state.user.demo || !state.user.id) return;
    const qs = questDefs();
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      if (q.progress() >= q.target) {
        awardPoints('quest_daily', q.xp, q.key + '|' + todayStr());
      }
    }
  } catch (e) {}
}
function faDigits(x) {
  return String(x).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[+d]; });
}
function questCardHTML(q) {
  const p = Math.min(q.progress(), q.target);
  const done = p >= q.target;
  const pct = q.target ? Math.round((p / q.target) * 100) : 0;
  const progTxt = q.unit === 'steps'
    ? p + ' / ' + q.target + ' steps'
    : (q.unit === 'XP'
      ? p + ' / ' + q.target + ' XP'
      : (done ? 'Done' : 'Not done'));
  const side = done
    ? '<span class="hm-q-xp is-claimed" aria-label="Rewarded">✅</span>'
    : '<span class="hm-q-xp">XP +' + q.xp + '</span>';
  return '<div class="hm-q-row' + (done ? ' is-done' : '') + '">' +
    '<a class="hm-q-body" href="' + (q.link || '#/home') + '">' +
    '<span class="hm-q-ico" aria-hidden="true">' + q.icon + '</span>' +
    '<span class="hm-q-main"><span class="hm-q-rtitle">' + q.title + '</span>' +
    '<span class="hm-q-bar"><span style="width:' + pct + '%"></span></span>' +
    '<span class="hm-q-stat">' + progTxt + '</span></span></a>' +
    side + '<span class="hm-q-go" aria-hidden="true">›</span></div>';
}
function paintQuests() {
  try {
    const host = document.getElementById('home-quests-wrap');
    if (!host || state.view !== 'home') return;
    if (isDesktop()) return; /* desktop home paints its own quests card */
    if (!state.user || state.user.demo) { host.innerHTML = ''; return; }
    const qs = questDefs();
    host.innerHTML = '<section class="hm-quests"' + (_faOn ? '' : ' dir=\'ltr\' lang=\'en\'') + ' aria-label="Today\'s quests">' +
      '<div class="hm-q-head"><div class="hm-q-titles">' +
      '<div class="hm-q-title">Daily Quests</div>' +
      '<div class="hm-q-sub">Complete quests, earn XP, level up!</div></div></div>' +
      '<div class="hm-q-rows">' + qs.map(questCardHTML).join('') + '</div></section>';
  } catch (e) {}
}
function refreshQuests() { autoRewardQuests(); paintQuests(); }
var ptsPopQueue = [];
var ptsPopShowing = false;

function queuePointsPopup(points, label) {
  ptsPopQueue.push({ points: points, label: label });
  pumpPointsPopup();
}

function pumpPointsPopup() {
  if (ptsPopShowing) return;
  const item = ptsPopQueue.shift();
  if (!item) return;
  ptsPopShowing = true;
  let host = document.getElementById('pts-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pts-toast-host';
    document.body.appendChild(host);
  }
  // The total is fetched live so the learner sees the points land in their score.
  const render = function (total) {
    host.innerHTML =
      '<div class="pts-toast" role="status" aria-live="polite">' +
        '<div class="pts-burst">' + ICO.zap + '</div>' +
        '<div class="pts-amount">+' + esc(String(item.points)) + '</div>' +
        '<div class="pts-label">' + esc(item.label) + '</div>' +
        (total !== null && total !== undefined
          ? '<div class="pts-total">Total: ' + esc(Number(total).toLocaleString('en-US')) + ' pts</div>' : '') +
      '</div>';
    const el = host.firstChild;
    if (!el) { ptsPopShowing = false; pumpPointsPopup(); return; }
    void el.offsetWidth; // restart the pop animation
    el.classList.add('pop');
    setTimeout(function () {
      el.classList.add('bye');
      setTimeout(function () {
        if (host) host.innerHTML = '';
        ptsPopShowing = false;
        pumpPointsPopup();
      }, 350);
    }, 2500);
  };
  if (sb && cloudReady()) {
    sb.rpc('my_points').then(function (r) {
      render(!r.error && typeof r.data === 'number' ? r.data : state.myPoints);
    }, function () { render(state.myPoints); });
  } else {
    render(state.myPoints);
  }
}

/* One-time "battle name" prompt: blocking until the user picks a nickname.
   Used for existing users without display_name, and re-used from the
   Challenge locked state. */
function ensureNickname(suggestion) {
  return new Promise(function (resolve) {
    showModal(
      '<div class="nick-trophy">' + ICO.trophy + '</div>' +
      '<h2>Choose your battle name</h2>' +
      '<p class="muted">This is the name everyone sees on the Challenge leaderboard.</p>' +
      '<div class="field" style="text-align:left"><label for="nick-input">Nickname</label>' +
      '<input id="nick-input" maxlength="20" placeholder="e.g. word_warrior" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">3–20 characters: A–Z, 0–9, _ or -</p></div>' +
      '<div class="field" style="text-align:left"><label for="nick-phone">Mobile number</label>' +
      '<input id="nick-phone" type="tel" autocomplete="tel" placeholder="e.g. +98 912 345 6789">' +
      '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">So your teacher can reach you — international format is fine.</p></div>' +
      '<div class="form-error" id="nick-error" role="alert"></div>' +
      '<button class="btn btn-block" id="nick-save">Join the Challenge</button>',
      true
    );
    const save = function () {
      const inp = document.getElementById('nick-input');
      const err = document.getElementById('nick-error');
      const btn = document.getElementById('nick-save');
      const nick = ((inp && inp.value) || '').trim();
      if (!validNickname(nick)) {
        if (err) err.textContent = 'Use 3–20 characters: letters, numbers, _ or -.';
        return;
      }
      const phoneEl0 = document.getElementById('nick-phone');
      const phone = normalizePhone(phoneEl0 ? phoneEl0.value : '');
      if (!validPhone(phone)) {
        if (err) err.textContent = 'Enter a valid mobile number (7–15 digits, + is fine).';
        return;
      }
      if (err) err.textContent = '';
      if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
      nicknameTaken(nick).then(function (taken) {
        if (taken) {
          if (err) err.textContent = 'This nickname is taken, try another.';
          if (btn) { btn.disabled = false; btn.textContent = 'Join the Challenge'; }
          return;
        }
        if (btn) btn.textContent = 'Saving…';
        saveNickname(nick).then(function (ok) {
          if (ok) {
            savePhone(phone).then(function (pok) {
              if (!pok) stashPendingPhone(phone);
              closeModal(); resolve(true);
            });
          }
          else {
            if (err) err.textContent = 'Couldn’t save — check your connection and try again.';
            if (btn) { btn.disabled = false; btn.textContent = 'Join the Challenge'; }
          }
        });
      });
    };
    const saveBtn = document.getElementById('nick-save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const inpEl = document.getElementById('nick-input');
    if (inpEl) {
      if (suggestion) inpEl.value = suggestion;
      inpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
      setTimeout(function () { try { inpEl.focus(); } catch (e) {} }, 120);
    }
    const phEl = document.getElementById('nick-phone');
    if (phEl) {
      try { const pre = localStorage.getItem('el_pending_phone'); if (pre) phEl.value = pre; } catch (e) {}
      phEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    }
  });
}

async function saveNickname(nick) {
  try {
    if (!sb || !state.user || !state.user.id) return false;
    // Server-side save: profiles has no user UPDATE policy, so a SECURITY
    // DEFINER function validates + writes display_name (see supabase-nickname-fix.sql).
    const r = await sb.rpc('set_nickname', { nick: nick });
    if (r.error || r.data !== true) return false;
    try { await sb.auth.updateUser({ data: { display_name: nick } }); } catch (e) {}
    state.user.displayName = nick;
    return true;
  } catch (e) { return false; }
}

/* Mobile number (2026-11-10, Alireza's order): collected at onboarding --
   in the nickname modal and on the signup form -- and saved via the
   set_phone RPC (profiles.phone). If the RPC is unavailable (migration
   not run yet) or fails, the number is stashed in localStorage and
   retried on every enterApp until it lands. */
function normalizePhone(raw) { return (raw || '').replace(/[\s\-()]/g, ''); }
function validPhone(raw) { return /^\+?\d{7,15}$/.test(normalizePhone(raw)); }
function stashPendingPhone(phone) { try { localStorage.setItem('el_pending_phone', phone); } catch (e) {} }
async function savePhone(phone) {
  try {
    if (!sb || !state.user || !state.user.id) return false;
    const r = await sb.rpc('set_phone', { p_phone: phone });
    if (!r.error && r.data === true) { try { state.user.phone = phone; } catch (e) {} return true; }
    return false;
  } catch (e) { return false; }
}
async function retryPendingPhone(u) {
  try {
    if (!sb) return;
    let v = null;
    try { v = localStorage.getItem('el_pending_phone'); } catch (e) {}
    if (!v && u && u.user_metadata && u.user_metadata.phone) v = u.user_metadata.phone;
    if (!v || !validPhone(v)) return;
    const ok = await savePhone(normalizePhone(v));
    if (ok) { try { localStorage.removeItem('el_pending_phone'); } catch (e) {} }
  } catch (e) {}
}

function ensurePhone(u) {
  return new Promise(function (resolve) {
    showModal(
      '<div class="nick-trophy">\u{1F4F1}</div>' +
      '<h2>Your mobile number</h2>' +
      '<p class="muted">We still need a mobile number for your account, so your teacher can reach you.</p>' +
      '<div class="field" style="text-align:left"><label for="phone-input">Mobile number</label>' +
      '<input id="phone-input" type="tel" autocomplete="tel" placeholder="e.g. +98 912 345 6789">' +
      '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">International format is fine.</p></div>' +
      '<div class="form-error" id="phone-error" role="alert"></div>' +
      '<button class="btn btn-orange btn-block" id="phone-save" style="padding:0.95rem 1rem;font-size:1.05rem;border-radius:14px">Save</button>',
      true
    );
    const save = function () {
      const inp = document.getElementById('phone-input');
      const err = document.getElementById('phone-error');
      const btn = document.getElementById('phone-save');
      const phone = normalizePhone(inp ? inp.value : '');
      if (!validPhone(phone)) {
        if (err) err.textContent = 'Enter a valid mobile number (7\u201315 digits, + is fine).';
        return;
      }
      if (err) err.textContent = '';
      if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
      savePhone(phone).then(function (ok) {
        if (ok) { closeModal(); resolve(true); }
        else {
          stashPendingPhone(phone);
          if (err) err.textContent = 'Couldn\u2019t save \u2014 check your connection and try again.';
          if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        }
      });
    };
    const saveBtn = document.getElementById('phone-save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const inpEl = document.getElementById('phone-input');
    if (inpEl) {
      let pre = null;
      try { pre = localStorage.getItem('el_pending_phone'); } catch (e) {}
      if (!pre && u && u.user_metadata && u.user_metadata.phone) pre = u.user_metadata.phone;
      if (pre) inpEl.value = pre;
      inpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
      setTimeout(function () { try { inpEl.focus(); } catch (e) {} }, 120);
    }
  });
}

/* Award words_viewed when the learner scrolls to the last word card. */
var _wordsObs = null;
function observeWordsEnd(body, m) {
  try {
    if (_wordsObs) { try { _wordsObs.disconnect(); } catch (e) {} _wordsObs = null; }
    if (!m || !m.date) return;
    const cards = body.querySelectorAll('.word-card');
    /* No observer support or no cards: fall back to tab-open marking. */
    if (typeof IntersectionObserver === 'undefined' || !cards.length) { markStep(m.date, 'words'); return; }
    const last = cards[cards.length - 1];
    _wordsObs = new IntersectionObserver(function (entries) {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          try { _wordsObs.disconnect(); } catch (e) {}
          _wordsObs = null;
          /* Words step = the learner scrolled through to the last word. */
          markStep(m.date, 'words');
          awardPoints('words_viewed', 10, m.date);
          break;
        }
      }
    }, { threshold: 0.35 });
    _wordsObs.observe(last);
  } catch (e) {}
}

/* Podcast/shadowing completion: award when playback passes 90% (or ends).
   Tracked by logical src so the pre-downloaded blob swap doesn't matter. */
function trackKindFor(src) {
  const m = state.lesson;
  if (!m || !src) return null;
  if (m.podcast && m.podcast.audio && src === m.podcast.audio) return 'podcast_complete';
  if (m.shadowing && m.shadowing.audio && src === m.shadowing.audio) return 'shadowing_complete';
  return null;
}
var _trackPtsFired = {};
function checkTrackCompletion(forceDone) {
  const d = player.el.duration;
  if (!isFinite(d) || d <= 0) return;
  const frac = (player.el.currentTime || 0) / d;
  if (!forceDone && frac < 0.9) return;
  const kind = trackKindFor(player.src);
  if (!kind || !state.lesson || !state.lesson.date) return;
  const key = kind + '|' + state.lesson.date;
  if (_trackPtsFired[key]) return;
  _trackPtsFired[key] = 1;
  /* Podcast step = fully listened (90%+ or ended). Shadowing step needs all
     sentence exercises done (see markSpSentenceDone), not just listening. */
  if (kind === 'podcast_complete') markStep(state.lesson.date, 'podcast');
  awardPoints(kind, 15, state.lesson.date);
}

/* ---------------- challenge view (leaderboard) ---------------- */
function weekStartISO() {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function avatarHue(name) {
  let h = 0;
  const s = String(name || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
function avatarStyle(name) {
  const h = avatarHue(name);
  return 'background:linear-gradient(135deg,hsl(' + h + ',72%,60%),hsl(' + ((h + 45) % 360) + ',68%,40%))';
}
function nickInitial(name) {
  const s = String(name || '?').trim();
  return (s.charAt(0) || '?').toUpperCase();
}
function levelChip(lv) {
  const l = normalizeLevel(lv);
  return l ? '<span class="lvl-chip">' + l.toUpperCase() + '</span>' : '';
}

var EARN_ROWS = [
  ['check', 'Open today’s lesson', '5 pts'],
  ['eye', 'Read all the words', '10 pts'],
  ['headphones', 'Finish the podcast', '20 pts'],
  ['mic', 'Finish shadowing', '15 pts'],
  ['mic', 'Podcast summary', 'up to 10 pts'],
  ['quiz', 'Word quiz', '10 + 1 per correct'],
  ['book', 'Grammar quiz', '10 pts'],
  ['refresh', 'Daily review', '10 pts'],
  ['flame', '7-day streak bonus', '50 pts']
];
function howToEarnHTML() {
  return '<details class="earn-card"><summary><span class="earn-ico">' + ICO.zap + '</span><b>How to earn points</b><span class="earn-chev">›</span></summary>' +
    '<div class="earn-rows">' + EARN_ROWS.map(function (r) {
      return '<div class="earn-row"><span class="earn-ico">' + ICO[r[0]] + '</span><span>' + r[1] + '</span><b>' + r[2] + '</b></div>';
    }).join('') + '</div></details>';
}

function renderChallenge(v) {
  markChallengeVisit();
  const me = state.user;
  let html = '<div class="ch-wrap"><div class="lb-title"><div class="lb-crown">' + ICO.crown + '</div>' +
    '<div class="lb-head"><span class="lb-laurel">' + laurelBranch() + '</span><h1>Leaderboard</h1><span class="lb-laurel flip">' + laurelBranch() + '</span></div>' +
    '<p>Earn points for everything you do. Climb the board.</p></div>' +
    '<div class="ch-count"><span class="cc-people">' + ICO.users + '</span><span><b>1,500</b>&nbsp;learners in the challenge</span><span class="cc-trophy">' + ICO.trophy + '</span></div>';
  if (!me.displayName && !me.demo) {
    html += '<div class="card plain ch-locked"><div class="earn-ico">' + ICO.lock + '</div>' +
      '<h2>Pick your battle name first</h2>' +
      '<p class="muted">Choose the nickname everyone will see on the leaderboard.</p>' +
      '<button class="btn" data-action="choose-nickname">Choose nickname</button></div>';
    html += howToEarnHTML();
    v.innerHTML = html + '</div>';
    return;
  }
  const p = state.challengePeriod;
  html += '<div class="seg" role="tablist" aria-label="Leaderboard period">' +
    '<button class="seg-btn' + (p === 'weekly' ? ' active' : '') + '" data-action="ch-period" data-p="weekly" role="tab" aria-selected="' + (p === 'weekly') + '">Weekly</button>' +
    '<button class="seg-btn' + (p === 'alltime' ? ' active' : '') + '" data-action="ch-period" data-p="alltime" role="tab" aria-selected="' + (p === 'alltime') + '">All-time</button></div>';
  html += '<div id="ch-board"><div class="empty">Loading the leaderboard…</div></div>';
  html += howToEarnHTML();
  v.innerHTML = html + '</div>';
  loadLeaderboard();
}

/* Demo-mode leaderboard so the view never renders broken without Supabase. */
function mockBoard() {
  const mk = function (i, name, level, points, id) {
    return { user_id: id || ('mock-' + i), display_name: name, level: level, points: points, rnk: i };
  };
  return [
    mk(1, 'Demo', 'b2', 320, 'demo-learner'),
    mk(2, 'aria_learns', 'b1', 285),
    mk(3, 'Zed-99', 'c1', 240),
    mk(4, 'maria_eng', 'a2', 190),
    mk(5, 'kino', 'b2', 150),
    mk(6, 'word_warrior', 'a1', 95)
  ];
}

/* Fake arena population: 100 Iranian nicknames with deterministic points that
   shift every 5 hours. Generated client-side (never written to the DB) so the
   leaderboard feels alive until real users fill it; real rows merge in and
   climb naturally by their true points. */
const FAKE_NAMES = [
  'Sara_m', 'Amir_h', 'Negin', 'Kian_99', 'Yasaman', 'Arman_ir', 'Dorsa', 'Parsa_7',
  'Mahsa', 'Elham', 'Behnam', 'Shirin', 'Farhad', 'Nasrin', 'Omid', 'Leila_2',
  'Reza_k', 'Maryam', 'Hooman', 'Anahita', 'Babak', 'Roya', 'Saman', 'Taraneh',
  'Milad', 'Ghazal', 'Pouya', 'Sahar', 'Arash', 'Niloufar', 'Kaveh', 'Donya',
  'Ehsan', 'Shabnam', 'Vahid', 'Azadeh', 'Nima', 'Laleh', 'Soroush', 'Mandana',
  'Kourosh', 'Shima', 'Ashkan', 'Farnaz', 'Mehrdad', 'Golnar', 'Siavash', 'Parisa',
  'Navid', 'Hanieh', 'Erfan', 'Setareh', 'Kamran', 'Bahar', 'Ali_r', 'Zahra',
  'Hossein', 'Fatemeh', 'Mohammad', 'Narges', 'Mehdi', 'Zeynab', 'Ahmad', 'Somayeh',
  'Javad', 'Mina', 'Saeed', 'Atefeh', 'Mostafa', 'Hadis', 'Mojtaba', 'Samira',
  'Yasin', 'Negar', 'Danial', 'Mahdieh', 'Iman', 'Kimia', 'Shahram', 'Melika',
  'Farzad', 'Parmida', 'Behzad', 'Aida', 'Ramin', 'Sogand', 'Keyvan', 'Tara',
  'Bijan', 'Elina', 'Farbod', 'Diba', 'Shahin', 'Mona', 'Kiarash', 'Anis',
  'Pedram', 'Mahour', 'Shaghayegh', 'Kourosh_2'
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Fake arena: simulated weekly activity (2026-10-10).
   Each fake has a personality tier with a daily earn rate, accumulated in
   deterministic 4-hour blocks so the board moves 6x/day for everyone alike:
     top 10: grinders   ~100 pts/day (~16.7 per 4h block)
     next 35: regulars   ~70 pts/day (~11.7 per 4h block)
     rest:    casuals     ~40 pts/day (~6.7 per 4h block)
   Weekly board resets every Monday (fresh race). All-time keeps the previous
   stable shuffle. A small deterministic jitter per block keeps it from looking
   robotic. Real users must stay active to hold the top — idling 2-3 days
   lets the grinders pass them. */
function fakeBoard(weekly) {
  if (!weekly) return fakeBoardLegacy();
  const now = Date.now();
  const BLOCK = 4 * 3600 * 1000;
  const curBlock = Math.floor(now / BLOCK);
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  const elapsed = Math.max(0, Math.floor((now - d.getTime()) / BLOCK));
  const rows = [];
  for (let i = 0; i < FAKE_NAMES.length; i++) {
    const tier = i < 10 ? 0 : i < 45 ? 1 : 2;
    const perDay = tier === 0 ? 100 : tier === 1 ? 70 : 40;
    const perBlock = perDay / 6;
    /* per-user rate personality: 0.9x–1.1x, fixed for life */
    const rateVar = 0.9 + mulberry32(i * 104729 + 7)() * 0.2;
    /* base: higher index = lower start (keeps the pyramid shape) */
    const decay = Math.pow(1 - i / FAKE_NAMES.length, 1.4);
    const base = 20 + 120 * decay;
    /* jitter: ±15% of one block, re-rolled every 4h, same for all viewers */
    const jrnd = mulberry32(i * 7919 + curBlock * 131 + 17);
    const jitter = (jrnd() - 0.5) * 0.3 * perBlock;
    const pts = base + perBlock * rateVar * elapsed + jitter;
    rows.push({
      user_id: 'fake-' + i,
      display_name: FAKE_NAMES[i],
      points: Math.max(0, Math.round(pts))
    });
  }
  return rows;
}

/* All-time fake board: previous stable behavior (5h shuffle, 20–190 range). */
function fakeBoardLegacy() {
  const bucket = Math.floor(Date.now() / (5 * 3600 * 1000)); // new shuffle every 5h
  const top = 190, bottom = 20;
  const rows = [];
  for (let i = 0; i < FAKE_NAMES.length; i++) {
    const rnd = mulberry32(i * 7919 + bucket * 131 + 913);
    const decay = Math.pow(1 - i / FAKE_NAMES.length, 1.4);
    const base = bottom + (top - bottom) * decay;
    const move = (rnd() - 0.5) * 0.10 + Math.sin(bucket * 0.9 + i * 1.7) * 0.04;
    const pts = Math.round(base * (1 + move));
    rows.push({
      user_id: 'fake-' + i,
      display_name: FAKE_NAMES[i],
      points: Math.min(top, Math.max(bottom, pts))
    });
  }
  return rows;
}

/* Merge real leaderboard rows with the fake arena, rank everyone. */
function mergeBoard(realRows, weekly) {
  const meId = state.user.id;
  const seen = {};
  const all = [];
  (realRows || []).forEach(function (r) {
    seen[r.user_id] = true;
    all.push({ user_id: r.user_id, display_name: r.display_name, points: Number(r.points) || 0 });
  });
  fakeBoard(weekly).forEach(function (f) { all.push(f); });
  if (meId && !seen[meId] && !state.user.demo) {
    all.push({ user_id: meId, display_name: state.user.displayName || 'You', points: state.myPoints || 0 });
  }
  all.sort(function (a, b) { return b.points - a.points; });
  all.forEach(function (r, i) { r.rnk = i + 1; });
  return all;
}

async function loadLeaderboard() {
  const host = document.getElementById('ch-board');
  if (!host || state.view !== 'challenge') return;
  const weekly = state.challengePeriod === 'weekly';
  const start = weekly ? weekStartISO() : '1970-01-01T00:00:00.000Z';
  let rows = null;
  if (state.user.demo) {
    rows = mockBoard();
  } else if (sb) {
    try { await refreshMyPoints(); } catch (e) {}
    try {
      const r = await sb.rpc('get_leaderboard', { period_start: start });
      if (!r.error && Array.isArray(r.data)) rows = r.data;
    } catch (e) {}
  }
  if (!host || state.view !== 'challenge') return;
  if (!rows) rows = []; // RPC failed: fakes still render so the arena never looks broken
  host.innerHTML = state.user.demo ? boardHTML(rows, weekly) : boardHTML(mergeBoard(rows, weekly), weekly);
}

/* Decorative golden laurel branch for the leaderboard title (no rank number). */
function laurelBranch() {
  let inner = '<path d="M32 62 Q 22 40 30 8" fill="none" stroke="currentColor" stroke-width="2"/>';
  const leaves = [[29, 52], [26, 42], [27, 32], [30, 22]];
  leaves.forEach(function (p, i) {
    const s = i % 2 ? -1 : 1;
    inner += '<ellipse cx="' + (p[0] + s * 5) + '" cy="' + p[1] + '" rx="5.5" ry="2.6" ' +
      'transform="rotate(' + (s * 38) + ' ' + (p[0] + s * 5) + ' ' + p[1] + ')" fill="currentColor" opacity="0.95"/>';
  });
  return '<svg viewBox="0 0 40 70" aria-hidden="true">' + inner + '</svg>';
}

function boardHTML(rows, weekly) {
  const meId = state.user.id;
  if (!rows.length) {
    return '<div class="empty">No points ' + (weekly ? 'this week' : 'yet') +
      ' — finish a lesson to get on the board.</div>' + meRowHTML(0, 0);
  }
  const show = rows.slice(0, 100); // top-100 arena
  let html = '';
  const top = show.slice(0, 3);
  // visual order on the podium: 2nd, 1st, 3rd
  const ordered = top.length === 3 ? [top[1], top[0], top[2]] : top;
  html += '<div class="podium">' + ordered.map(function (r) {
    return podiumCardHTML(r, r.rnk, r.user_id === meId);
  }).join('') + '</div>';
  html += '<div class="rank-div"><span class="rd-trophy">' + ICO.trophy + '</span>Top Ranking</div>';
  const rest = show.slice(3);
  if (rest.length) {
    html += '<div class="ch-rows">' + rest.map(function (r) {
      return rowHTML(r, r.user_id === meId);
    }).join('') + '</div>';
  }
  // pin the real user below if they are outside the top 100
  const me = rows.filter(function (r) { return r.user_id === meId; })[0];
  if (me && me.rnk > 100) {
    html += '<div style="margin-top:0.6rem">' + meRowHTML(me.points, me.rnk) + '</div>';
  }
  return html;
}

function meRowHTML(pts, rnk) {
  const me = state.user;
  const rk = Number(rnk) || 0;
  const rkCls = rk === 1 ? 'rk1' : rk === 2 ? 'rk2' : rk === 3 ? 'rk3' : '';
  return '<div class="ch-row me">' +
    '<span class="ch-rank ' + rkCls + '">' + (rk || '–') + '</span>' +
    '<span class="ch-avatar sm" style="' + avatarStyle(me.displayName || '?') + '">' + esc(nickInitial(me.displayName)) + '</span>' +
    '<span class="ch-meta"><span class="ch-name">' + esc(me.displayName || 'You') + ' <span class="you-tag">YOU</span></span>' +
    '<span class="ch-pts">' + ICO.gem + esc(String(pts)) + '</span></span>' +
    '<span class="ch-crown ' + rkCls + '">' + ICO.crown + '</span>' +
  '</div>';
}

function podiumCardHTML(r, place, isMe) {
  return '<div class="pd-card p' + place + (isMe ? ' me' : '') + '">' +
    (place === 1 ? '<div class="pd-crown big rk1">' + ICO.crown + '</div>' : '') +
    '<div class="pd-avatar" style="' + avatarStyle(r.display_name) + '">' + esc(nickInitial(r.display_name)) + '</div>' +
    '<div class="pd-medal rk' + place + '"><span>' + place + '</span></div>' +
    '<div class="pd-name">' + esc(r.display_name) + (isMe ? ' <span class="you-tag">YOU</span>' : '') + '</div>' +
    '<div class="pd-pts">' + ICO.gem + '<b>' + esc(Number(r.points).toLocaleString('en-US')) + '</b></div>' +
  '</div>';
}

function rowHTML(r, isMe) {
  const rk = Number(r.rnk) || 0;
  const rkCls = rk === 1 ? 'rk1' : rk === 2 ? 'rk2' : rk === 3 ? 'rk3' : '';
  return '<div class="ch-row' + (isMe ? ' me' : '') + '">' +
    '<span class="ch-rank ' + rkCls + '">' + rk + '</span>' +
    '<span class="ch-avatar sm" style="' + avatarStyle(r.display_name) + '">' + esc(nickInitial(r.display_name)) + '</span>' +
    '<span class="ch-meta"><span class="ch-name">' + esc(r.display_name) + (isMe ? ' <span class="you-tag">YOU</span>' : '') + '</span>' +
    '<span class="ch-pts">' + ICO.gem + esc(Number(r.points).toLocaleString('en-US')) + '</span></span>' +
    '<span class="ch-crown ' + rkCls + '">' + ICO.crown + '</span>' +
  '</div>';
}

