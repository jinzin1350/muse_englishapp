/* ============================================================
   Muse English — static frontend
   Plain JS, no build step. Hash routes (static-hosting safe):
     public:  #/  #/signin  #/signup  #/preview
     learner: #/home  #/lesson/<date>  #/scores  #/review  #/profile  #/admin  #/waiting
   Audio: one shared element + persistent mini-player.
   Scores & mistakes: Supabase per-user, localStorage fallback.
   Lesson progress: lightweight per-user localStorage (no new schema).
   ============================================================ */
(function () {
'use strict';

/* ---------------- helpers ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function fmtDate(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function todayStr() { return fmtDate(new Date()); }

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + pad2(s);
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  return fmtDate(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function uid() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- state ---------------- */
const state = {
  user: null,          // { id, email, level, isAdmin, demo }
  lessons: [],         // manifests for user's level, newest first
  lesson: null,        // currently open manifest
  view: 'landing',
  lessonTab: 'words',
  quiz: null,          // active quiz session
  adminUsers: [],
  pushOptedIn: null,   // OneSignal subscription state: true/false/null(unknown)
  previewLesson: null, // cached public lesson for landing/preview
  justSignedUp: false,
  afterSignup: null,   // email prefilled on signin right after account creation
  showConfirmPopup: null, // email shown in the "confirm your email" popup after signup
  challengePeriod: 'weekly', // leaderboard period: 'weekly' | 'alltime'
  myPoints: null,        // cached personal challenge-points total
};

/* Six CEFR levels. Legacy 3-level values are mapped so existing assignments keep working. */
const LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
const LEVEL_LABELS = { a1: 'A1 · Beginner', a2: 'A2 · Elementary', b1: 'B1 · Intermediate', b2: 'B2 · Upper-Intermediate', c1: 'C1 · Advanced', c2: 'C2 · Proficiency' };
const LEVEL_DESC = {
  a1: 'First words and everyday phrases.',
  a2: 'Simple sentences about daily life.',
  b1: 'Independent conversations and stories.',
  b2: 'Fluent discussion of real topics.',
  c1: 'Nuanced, advanced expression.',
  c2: 'Near-native mastery and precision.'
};
function normalizeLevel(lv) {
  if (!lv) return null;
  const v = String(lv).toLowerCase();
  if (LEVELS.indexOf(v) !== -1) return v;
  if (v === 'beginner') return 'a1';
  if (v === 'intermediate') return 'b2';
  if (v === 'advanced') return 'c1';
  return null;
}
function levelLabel(lv) { return LEVEL_LABELS[lv] || lv || '—'; }

/* Deep link from push notifications: ?lesson=latest opens the newest lesson
   for the user's level right after login. */
let pendingDeepLink = null;
try {
  const q = new URLSearchParams(window.location.search);
  if (q.get('lesson') === 'latest') pendingDeepLink = 'latest';
} catch (e) { /* ignore */ }

/* Referral tracking: ?ref=<code> attributes the signup to a referrer
   (e.g. a blogger/influencer link like ?ref=dance). First touch wins and
   is kept in localStorage until signup, then saved on the profile as
   referred_by. Invalid codes are ignored. */
function getRefCode() {
  try {
    const q = new URLSearchParams(window.location.search);
    const r = q.get('ref');
    if (r && /^[A-Za-z0-9_-]{1,32}$/.test(r) && !localStorage.getItem('el_ref')) {
      localStorage.setItem('el_ref', r);
    }
    return localStorage.getItem('el_ref');
  } catch (e) { return null; }
}
getRefCode();

/* ---------------- config / integrations ---------------- */
let sb = null; // supabase client

function supabaseKeysPresent() {
  return !!(APP_CONFIG.SUPABASE_URL &&
    APP_CONFIG.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1 &&
    APP_CONFIG.SUPABASE_ANON_KEY);
}

function supabaseConfigured() {
  // Keys present AND the Supabase JS SDK actually loaded (CDN reachable).
  return supabaseKeysPresent() && typeof window.supabase !== 'undefined';
}

function initSupabase() {
  try {
    if (!supabaseConfigured()) return null;
    sb = window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
    return sb;
  } catch (e) { return null; }
}

function initOneSignal() {
  try {
    const id = APP_CONFIG.ONESIGNAL_APP_ID;
    if (!id || id.indexOf('YOUR-ONESIGNAL') !== -1) return;
    if (window.__osInitPushed) return; // push init only once
    window.__osInitPushed = true;
    // Create the deferred queue ourselves (the documented pattern): the SDK
    // drains it whenever its bundle finishes loading, so there is no race with
    // DOMContentLoaded.
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async function (OneSignal) {
      try {
        try { window.__osLogs.push('INIT-CALLBACK-START'); } catch (e) {}
        await OneSignal.init({ appId: id });
        window.__osInitDone = true;
        try { window.__osLogs.push('INIT-OK'); } catch (e) {}
      }
      catch (e) {
        window.__osInitError = (e && e.message) || String(e);
        try { window.__osLogs.push('INIT-ERR: ' + window.__osInitError); } catch (e2) {}
        console.warn('[push] OneSignal init failed:', e);
      }
    });
  } catch (e) { /* push optional */ }
}

/* Only ever called from an explicit "Enable notifications" tap — never
   automatically, never before login, never over an auth form. */
async function promptPush(btn) {
  const statusEl = document.getElementById('push-status');
  const setStatus = function (t) { if (statusEl) statusEl.textContent = t; };
  const resetBtn = function () { if (btn) { btn.disabled = false; btn.textContent = 'Enable notifications'; } };
  try {
    if (!oneSignalReady()) { setStatus('Push is not configured on this site yet.'); return; }
    if (!('Notification' in window)) { setStatus('This browser does not support notifications.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enabling…'; }
    if (Notification.permission !== 'granted') {
      setStatus('Waiting for the browser permission prompt…');
      let perm = null;
      try { perm = await Notification.requestPermission(); }
      catch (e) { perm = null; }
      if (perm !== 'granted' && Notification.permission !== 'granted') {
        setStatus(perm === 'denied' || Notification.permission === 'denied'
          ? 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.'
          : 'Permission was not granted. Tap Enable again and choose Allow.');
        resetBtn();
        return;
      }
    }
    setStatus('Permission granted — registering this device…');
    try { initOneSignal(); } catch (e) {}
    const initDone = await new Promise(function (resolve) {
      const start = Date.now();
      (function poll() {
        if (window.__osInitDone) return resolve(true);
        if (window.__osInitError) return resolve(false);
        if (Date.now() - start > 20000) return resolve(false);
        setTimeout(poll, 400);
      })();
    });
    if (!initDone) {
      const initErr = window.__osInitError ? ' OneSignal says: ' + window.__osInitError : '';
      setStatus('The push service did not start.' + initErr + ' Please reload the page and try again.');
      resetBtn();
      return;
    }
    let optInError = null;
    const ok = await new Promise(function (resolve) {
      let done = false;
      const fin = function (v) { if (!done) { done = true; resolve(v); } };
      try {
        window.OneSignalDeferred.push(async function (OneSignal) {
          try {
            await OneSignal.User.PushSubscription.optIn();
            for (let i = 0; i < 20; i++) {
              try {
                const sub = OneSignal.User.PushSubscription;
                if (sub && sub.optedIn && sub.id) { fin(true); return; }
              } catch (e) {}
              await new Promise(function (r) { setTimeout(r, 500); });
            }
            try {
              const s = OneSignal.User.PushSubscription;
              optInError = 'optedIn=' + (s && s.optedIn) + ' id=' + (s && s.id);
            } catch (e) { optInError = String((e && e.message) || e); }
            fin(false);
          } catch (e) { optInError = String((e && e.message) || e); fin(false); }
        });
      } catch (e) { optInError = String((e && e.message) || e); fin(false); }
      setTimeout(function () { fin(false); }, 16000);
    });
    if (ok) {
      setStatus('✓ Notifications are on — you’ll get a short note when each lesson is ready.');
      if (btn) btn.style.display = 'none';
      state.pushOptedIn = true;
      try { localStorage.setItem('el_push_opted_in', '1'); } catch (e) {}
    } else {
      setStatus('Permission is on, but this device did not register. ' +
        'In your OneSignal dashboard check Settings → Push & In-App → Web: the Site URL must be exactly https://muse-englishapp.pages.dev — then tap Enable again.' +
        (optInError ? ' [' + optInError + ']' : ''));
      resetBtn();
    }
  } catch (e) {
    setStatus('Couldn’t enable notifications.');
    resetBtn();
  }
}

function oneSignalReady() {
  const id = APP_CONFIG.ONESIGNAL_APP_ID;
  return id && id.indexOf('YOUR-ONESIGNAL') === -1 && typeof window.OneSignalDeferred !== 'undefined';
}

/* Reconcile the "enable notifications" UI with the real subscription state.
   Runs on boot after OneSignal init: if the device is already subscribed the
   offer stays hidden; if the user unsubscribed elsewhere it comes back. */
function syncPushState() {
  try {
    if (!oneSignalReady()) return;
    window.OneSignalDeferred.push(function (OneSignal) {
      try {
        const sub = OneSignal.User && OneSignal.User.PushSubscription;
        const optedIn = !!(sub && sub.optedIn);
        state.pushOptedIn = optedIn;
        try {
          if (optedIn) localStorage.setItem('el_push_opted_in', '1');
          else localStorage.removeItem('el_push_opted_in');
        } catch (e) {}
        if ((state.view === 'home' || state.view === 'profile') && state.user && !state.user.demo) {
          try { show(state.view); } catch (e) {}
        }
      } catch (e) { /* push optional */ }
    });
  } catch (e) { /* push optional */ }
}

/* Identify the signed-in user to OneSignal (external ID + level tag),
   so lesson-ready pushes can later be targeted per level. */
function identifyPushUser(userId, email, level) {
  try {
    if (!oneSignalReady()) return;
    window.OneSignalDeferred.push(async function (OneSignal) {
      try {
        await OneSignal.login(userId);
        await OneSignal.User.addTags({ level: level || 'pending', email: email || '' });
      } catch (e) { /* push optional */ }
    });
  } catch (e) { /* push optional */ }
}

function logoutPushUser() {
  try {
    if (!oneSignalReady()) return;
    window.OneSignalDeferred.push(async function (OneSignal) {
      try { await OneSignal.logout(); } catch (e) {}
    });
  } catch (e) {}
}

function pushSubscribed() {
  if (state.pushOptedIn === true) return true;
  try {
    return localStorage.getItem('el_push_opted_in') === '1' &&
      (typeof Notification === 'undefined' || Notification.permission === 'granted');
  } catch (e) { return false; }
}

/* ---------------- scores & mistakes: per-user on Supabase, localStorage fallback ---------------- */
function cloudReady() {
  return !!(typeof sb !== 'undefined' && sb && state.user && !state.user.demo && state.user.id);
}
function lsKey(kind) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_' + kind + '_' + email;
}
function lsGet(kind) {
  try { return JSON.parse(localStorage.getItem(lsKey(kind)) || '[]'); }
  catch (e) { return []; }
}
function lsSet(kind, val) {
  try { localStorage.setItem(lsKey(kind), JSON.stringify(val)); } catch (e) {}
}
function rowToMistake(r) {
  return { id: r.id, date: r.date, level: r.level, kind: r.kind,
           question: r.question, options: r.options || [], answer: r.answer, picked: r.picked };
}
function rowToAttempt(r) {
  return { id: r.id, ts: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
           date: r.date, level: r.level, theme: r.theme, kind: r.kind, score: r.score, total: r.total };
}
async function getMistakes() {
  if (cloudReady()) {
    try {
      const res = await sb.from('mistakes').select('*')
        .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(500);
      if (!res.error && res.data) return res.data.map(rowToMistake);
    } catch (e) {}
  }
  return lsGet('mistakes');
}
async function getAttempts() {
  if (cloudReady()) {
    try {
      const res = await sb.from('quiz_attempts').select('*')
        .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(200);
      if (!res.error && res.data) return res.data.map(rowToAttempt);
    } catch (e) {}
  }
  return lsGet('scores');
}
async function saveAttempt(a) {
  const rec = Object.assign({ ts: Date.now() }, a);
  if (cloudReady()) {
    try {
      const res = await sb.from('quiz_attempts').insert({
        user_id: state.user.id, date: a.date || null, level: a.level || null,
        theme: a.theme || null, kind: a.kind || null, score: a.score, total: a.total
      });
      if (!res.error) return;
    } catch (e) {}
  }
  const arr = lsGet('scores');
  arr.unshift(rec);
  lsSet('scores', arr.slice(0, 200));
}
async function saveMistake(m) {
  if (cloudReady()) {
    try {
      const dup = await sb.from('mistakes').select('id')
        .eq('user_id', state.user.id).eq('question', m.question).limit(1);
      if (!dup.error && dup.data && dup.data.length) return;
      const res = await sb.from('mistakes').insert({
        user_id: state.user.id, date: m.date || null, level: m.level || null, kind: m.kind || null,
        question: m.question, options: m.options || [], answer: m.answer,
        picked: (typeof m.picked === 'number' ? m.picked : null)
      });
      if (!res.error) return;
    } catch (e) {}
  }
  const arr = lsGet('mistakes');
  if (!arr.some(function (x) { return x.question === m.question && x.date === m.date; })) {
    arr.unshift(Object.assign({ id: uid() }, m));
    lsSet('mistakes', arr.slice(0, 500));
  }
}
async function removeMistake(id) {
  if (cloudReady()) {
    try {
      const res = await sb.from('mistakes').delete().eq('id', id).eq('user_id', state.user.id);
      if (!res.error) return;
    } catch (e) {}
  }
  lsSet('mistakes', lsGet('mistakes').filter(function (x) { return x.id !== id; }));
}
async function getOverallAverage() {
  const arr = await getAttempts();
  let c = 0, t = 0;
  arr.forEach(function (a) { c += a.score; t += a.total; });
  return t ? Math.round((c / t) * 100) : null;
}
/* one-time: push this device's local scores/mistakes to the user's cloud rows after login */
async function migrateLocalToCloud() {
  if (!cloudReady()) return;
  try {
    const lm = lsGet('mistakes'), la = lsGet('scores');
    for (const m of lm) { await saveMistake(m); }
    for (const a of la) {
      await sb.from('quiz_attempts').insert({
        user_id: state.user.id, date: a.date || null, level: a.level || null,
        theme: a.theme || null, kind: a.kind || null, score: a.score, total: a.total
      });
    }
    if (lm.length || la.length) { lsSet('mistakes', []); lsSet('scores', []); }
  } catch (e) {}
}

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
  medal: svgIcon('<circle cx="12" cy="14" r="5"/><path d="M8.6 9.7 6 3h4l2 3.6L14 3h4l-2.6 6.7"/>'),
  gem: svgIcon('<path d="M6 3h12l4 6-10 12L2 9l4-6z"/><path d="M2 9h20"/>'),
  crown: svgIcon('<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>'),
  zap: svgIcon('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  flame: svgIcon('<path d="M12 22c4.4 0 7.5-3 7.5-7.5 0-3.5-2.5-6-4.5-8-.8 1.8-2.2 2.8-2.2 4.7-1.2-.8-2-2-2.3-3.7C8 9.5 4.5 12 4.5 14.5 4.5 19 7.6 22 12 22z"/>'),
  eye: svgIcon('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  headphones: svgIcon('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>'),
  mic: svgIcon('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'),
  quiz: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  book: svgIcon('<path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>'),
  check: svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  refresh: svgIcon('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'),
  lock: svgIcon('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>')
};

var PTS_LABELS = {
  lesson_open: 'Lesson opened',
  words_viewed: 'Words explored',
  podcast_complete: 'Podcast complete',
  shadowing_complete: 'Shadowing complete',
  word_quiz: 'Word quiz complete',
  grammar_quiz: 'Grammar quiz complete',
  deck_review: 'Review complete',
  streak_7: '7-day streak'
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
async function awardPoints(action, points, ref) {
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
      queuePointsPopup(points, PTS_LABELS[action] || action);
      if (action === 'lesson_open') checkStreakBonus();
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

/* 7-day streak bonus: consecutive lesson_open days (ending today/yesterday).
   The ref is the start of the current 7-day window, so the 50 pts award once
   per window even as the streak keeps growing. */
async function checkStreakBonus() {
  try {
    if (!cloudReady()) return;
    const r = await sb.from('scores').select('ref')
      .eq('user_id', state.user.id).eq('action', 'lesson_open')
      .order('ref', { ascending: false }).limit(14);
    if (r.error || !r.data) return;
    const days = {};
    r.data.forEach(function (row) { if (row.ref) days[row.ref] = 1; });
    const d = new Date();
    if (!days[fmtDate(d)]) { d.setDate(d.getDate() - 1); if (!days[fmtDate(d)]) return; }
    let streak = 0;
    const c = new Date(d);
    while (days[fmtDate(c)]) { streak++; c.setDate(c.getDate() - 1); }
    if (streak >= 7) {
      const start = new Date(d);
      start.setDate(start.getDate() - 6);
      awardPoints('streak_7', 50, fmtDate(start));
    }
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
function ensureNickname() {
  return new Promise(function (resolve) {
    showModal(
      '<div class="nick-trophy">' + ICO.trophy + '</div>' +
      '<h2>Choose your battle name</h2>' +
      '<p class="muted">This is the name everyone sees on the Challenge leaderboard.</p>' +
      '<div class="field" style="text-align:left"><label for="nick-input">Nickname</label>' +
      '<input id="nick-input" maxlength="20" placeholder="e.g. word_warrior" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">3–20 characters: A–Z, 0–9, _ or -</p></div>' +
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
          if (ok) { closeModal(); resolve(true); }
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
      inpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
      setTimeout(function () { try { inpEl.focus(); } catch (e) {} }, 120);
    }
  });
}

async function saveNickname(nick) {
  try {
    if (!sb || !state.user || !state.user.id) return false;
    const r = await sb.from('profiles').upsert({ id: state.user.id, display_name: nick }, { onConflict: 'id' });
    if (r.error) return false;
    try { await sb.auth.updateUser({ data: { display_name: nick } }); } catch (e) {}
    state.user.displayName = nick;
    return true;
  } catch (e) { return false; }
}

/* Award words_viewed when the learner scrolls to the last word card. */
var _wordsObs = null;
function observeWordsEnd(body, m) {
  try {
    if (_wordsObs) { try { _wordsObs.disconnect(); } catch (e) {} _wordsObs = null; }
    if (!m || !m.date || typeof IntersectionObserver === 'undefined') return;
    const cards = body.querySelectorAll('.word-card');
    if (!cards.length) return;
    const last = cards[cards.length - 1];
    _wordsObs = new IntersectionObserver(function (entries) {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          try { _wordsObs.disconnect(); } catch (e) {}
          _wordsObs = null;
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
  awardPoints(kind, kind === 'podcast_complete' ? 20 : 15, state.lesson.date);
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
  const me = state.user;
  let html = '<div class="ch-wrap"><div class="lb-title"><h1>Leaderboard</h1>' +
    '<p>Earn points for everything you do. Climb the board.</p></div>';
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

async function loadLeaderboard() {
  const host = document.getElementById('ch-board');
  if (!host || state.view !== 'challenge') return;
  const weekly = state.challengePeriod === 'weekly';
  const start = weekly ? weekStartISO() : '1970-01-01T00:00:00.000Z';
  let rows = null;
  if (state.user.demo) {
    rows = mockBoard();
  } else if (sb) {
    try {
      const r = await sb.rpc('get_leaderboard', { period_start: start });
      if (!r.error && Array.isArray(r.data)) rows = r.data;
    } catch (e) {}
  }
  if (!host || state.view !== 'challenge') return;
  if (!rows) {
    host.innerHTML = '<div class="empty">Couldn’t load the leaderboard — check your connection and try again.</div>';
    return;
  }
  host.innerHTML = boardHTML(rows, weekly);
}

/* Laurel-wreath rank badge: two curved branches of leaves with the rank in the middle. */
function laurelBadge(rank) {
  const r = Number(rank) || 0;
  const suf = r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th';
  const cls = r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : 'gold';
  let inner = '';
  for (let s = -1; s <= 1; s += 2) {
    let d = '';
    const pts = [];
    for (let i = 0; i <= 11; i++) {
      const t = i / 11;
      const x = 32 + s * 21.5 * Math.sin(t * 1.9);
      const y = 55.5 - t * 38;
      pts.push([x, y, t]);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    inner += '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.6"/>';
    pts.forEach(function (p) {
      const t = p[2];
      const dx = s * 21.5 * 1.9 * Math.cos(t * 1.9);
      const dy = -38;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const rx = 3.4 + 2.6 * Math.sin(Math.PI * Math.min(1, t * 1.05));
      const nl = Math.sqrt(dy * dy + dx * dx);
      const ox = (-dy / nl) * s * 2.6, oy = (dx / nl) * s * 2.6;
      const cx = (p[0] + ox).toFixed(1), cy = (p[1] + oy).toFixed(1);
      inner += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx.toFixed(1) +
        '" ry="2.3" transform="rotate(' + ang.toFixed(1) + ' ' + cx + ' ' + cy +
        ')" fill="currentColor" opacity="0.92"/>';
    });
  }
  inner += '<text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-size="14" ' +
    'font-weight="800" fill="currentColor">' + r + '<tspan font-size="8">' + suf + '</tspan></text>';
  return '<span class="laurel ' + cls + '"><svg viewBox="0 0 64 64" aria-hidden="true">' + inner + '</svg></span>';
}

function boardHTML(rows, weekly) {
  const meId = state.user.id;
  if (!rows.length) {
    return '<div class="empty">No points ' + (weekly ? 'this week' : 'yet') +
      ' — finish a lesson to get on the board.</div>' + meRowHTML(0);
  }
  let html = '';
  const top = rows.slice(0, 3);
  // visual order on the podium: 2nd, 1st, 3rd
  const ordered = top.length === 3 ? [top[1], top[0], top[2]] : top;
  html += '<div class="podium">' + ordered.map(function (r) {
    return podiumCardHTML(r, top.indexOf(r) + 1, r.user_id === meId);
  }).join('') + '</div>';
  html += '<div class="rank-div"><span class="rd-gem">' + ICO.gem + '</span>Top Ranking</div>';
  const rest = rows.slice(3);
  if (rest.length) {
    html += '<div class="ch-rows">' + rest.map(function (r) {
      return rowHTML(r, r.user_id === meId);
    }).join('') + '</div>';
  }
  if (!rows.some(function (r) { return r.user_id === meId; })) {
    html += '<div style="margin-top:0.6rem">' + meRowHTML(0) + '</div>';
  }
  return html;
}

function meRowHTML(pts) {
  const me = state.user;
  return '<div class="ch-row me">' +
    '<span class="ch-avatar sm" style="' + avatarStyle(me.displayName || '?') + '">' + esc(nickInitial(me.displayName)) + '</span>' +
    '<span class="ch-meta"><span class="ch-name">' + esc(me.displayName || 'You') + ' <span class="you-tag">YOU</span></span>' +
    '<span class="ch-pts">' + ICO.gem + esc(String(pts)) + '</span></span>' +
    '<span class="ch-laurel" style="display:flex;align-items:center;justify-content:center;color:rgba(245,243,255,0.4);font-weight:800">–</span>' +
  '</div>';
}

function podiumCardHTML(r, place, isMe) {
  return '<div class="pd-card p' + place + (isMe ? ' me' : '') + '">' +
    '<div class="pd-avatar" style="' + avatarStyle(r.display_name) + '">' + esc(nickInitial(r.display_name)) + '</div>' +
    '<div class="pd-laurel">' + laurelBadge(place) + '</div>' +
    '<div class="pd-name">' + esc(r.display_name) + (isMe ? ' <span class="you-tag">YOU</span>' : '') + '</div>' +
    '<div class="pd-pts">' + ICO.gem + '<b>' + esc(Number(r.points).toLocaleString('en-US')) + '</b></div>' +
  '</div>';
}

function rowHTML(r, isMe) {
  return '<div class="ch-row' + (isMe ? ' me' : '') + '">' +
    '<span class="ch-avatar sm" style="' + avatarStyle(r.display_name) + '">' + esc(nickInitial(r.display_name)) + '</span>' +
    '<span class="ch-meta"><span class="ch-name">' + esc(r.display_name) + (isMe ? ' <span class="you-tag">YOU</span>' : '') + '</span>' +
    '<span class="ch-pts">' + ICO.gem + esc(Number(r.points).toLocaleString('en-US')) + '</span></span>' +
    '<span class="ch-laurel">' + laurelBadge(r.rnk) + '</span>' +
  '</div>';
}

/* ---------------- lesson progress: lightweight per-user localStorage ----------------
   Tracks which steps of each daily lesson the learner has engaged with.
   Steps: words → podcast → shadowing → grammar → quiz (completed). */
const STEPS = ['words', 'podcast', 'shadowing', 'grammar', 'quiz'];
const STEP_LABELS = { words: 'Words', podcast: 'Podcast', shadowing: 'Shadowing', grammar: 'Grammar', quiz: 'Quiz' };
function progressKey() {
  return 'ela_progress_' + (state.user ? state.user.email : 'anon');
}
function getAllProgress() {
  try { return JSON.parse(localStorage.getItem(progressKey()) || '{}'); }
  catch (e) { return {}; }
}
function getDayProgress(dateStr) {
  const all = getAllProgress();
  return all[dateStr] || {};
}
function markStep(dateStr, step, extra) {
  if (!dateStr || STEPS.indexOf(step) === -1) return;
  try {
    const all = getAllProgress();
    const day = all[dateStr] || {};
    day[step] = extra === undefined ? true : extra;
    day.updatedAt = Date.now();
    all[dateStr] = day;
    localStorage.setItem(progressKey(), JSON.stringify(all));
  } catch (e) {}
}
function dayDoneCount(dateStr) {
  const d = getDayProgress(dateStr);
  return STEPS.filter(function (s) { return !!d[s]; }).length;
}
function nextStep(dateStr) {
  const d = getDayProgress(dateStr);
  for (let i = 0; i < STEPS.length; i++) {
    if (!d[STEPS[i]]) return STEPS[i];
  }
  return null;
}
function hasAnyQuizDone() {
  const all = getAllProgress();
  return Object.keys(all).some(function (k) { return !!(all[k] && all[k].quiz); });
}

/* ---------------- audio engine (one shared element) ---------------- */
const player = {
  el: new Audio(),
  src: null,
  title: ''
};

function playerUI() {
  const has = !!player.src;
  $('#mini-player').classList.toggle('hidden', !has);
  const playing = has && !player.el.paused;
  $('#mp-toggle').textContent = playing ? '⏸' : '▶';
  $('#mp-title').textContent = player.title || '—';
}

function refreshTrackCards() {
  const dur = player.el.duration || 0;
  const cur = player.el.currentTime || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  const mpBar = $('#mp-bar');
  if (mpBar) mpBar.style.width = pct + '%';
  const mpTime = $('#mp-time');
  if (mpTime) mpTime.textContent = fmtTime(cur);
  $$('[data-audio-card]').forEach(function (card) {
    const active = card.getAttribute('data-src') === player.src;
    const bar = $('.progress > div', card);
    const tcur = $('.t-cur', card);
    const tbtn = $('.play-btn', card);
    if (bar) bar.style.width = (active ? pct : 0) + '%';
    if (tcur) tcur.textContent = active ? fmtTime(cur) : '0:00';
    if (tbtn && !tbtn.disabled) tbtn.textContent = (active && !player.el.paused) ? '⏸' : '▶';
  });
  $$('.speed-btn').forEach(function (b) {
    b.classList.toggle('active', parseFloat(b.getAttribute('data-rate')) === player.el.playbackRate);
  });
}

function toggleTranscript(btn) {
  const card = btn.closest('[data-audio-card]');
  const panel = card && card.querySelector('.transcript-panel');
  if (!panel) return;
  if (panel.classList.contains('hidden')) {
    panel.classList.remove('hidden');
    btn.textContent = '📝 Hide transcript';
    if (!panel.dataset.loaded) {
      panel.textContent = 'Loading transcript…';
      fetch(btn.getAttribute('data-transcript')).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      }).then(function (t) {
        panel.dataset.loaded = '1';
        panel.innerHTML = '<p>' + esc(t.trim()).replace(/\n\s*\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
      }).catch(function () { panel.textContent = 'Could not load the transcript.'; });
    }
  } else {
    panel.classList.add('hidden');
    btn.textContent = '📝 Transcript';
  }
}

function playTrack(src, title) {
  if (!src) return;
  if (player.src === src) {
    if (player.el.paused) player.el.play().catch(function () {});
    else player.el.pause();
  } else {
    player.src = src;
    player.title = title || 'Audio';
    player.el.src = playableSrc(src);
    player.el.play().catch(function () {});
  }
  playerUI();
}

/* Pre-download the lesson podcast as a Blob as soon as the lesson opens.
   The static host does not honor HTTP Range requests, so the browser can only
   seek inside audio data it has fully downloaded (a seek past the buffered
   point restarts the track from the beginning). A Blob URL hands the shared
   player the whole file locally, so forward/back seek always works, instantly.
   Only swaps the player while it is not playing; never interrupts playback. */
function checkWarmOk(res) {
  if (!res.ok) throw new Error('bad status ' + res.status);
  return res;
}

/* Get the full podcast bytes: persistent Cache Storage first (stays on the
   phone across sessions, works offline), network fetch as fallback. */
function getWarmBlob(url) {
  if (!('caches' in window)) return fetch(url).then(checkWarmOk).then(function (r) { return r.blob(); });
  return caches.open('podcast-v1').then(function (cache) {
    return cache.match(url).then(function (hit) {
      if (hit) return hit.blob();
      return fetch(url).then(checkWarmOk).then(function (res) {
        try { cache.put(url, res.clone()); } catch (e) {}
        return res.blob();
      });
    });
  });
}

function warmPodcast(m) {
  try {
    if (!m || !m.podcast || !m.podcast.audio || !window.fetch || !window.URL) return;
    // Respect the OS/browser data-saver: no pre-download then.
    try {
      const conn = navigator.connection || navigator.webkitConnection;
      if (conn && conn.saveData) return;
    } catch (e) {}
    const url = m.podcast.audio, date = m.date;
    if (player._warmDate === date) return; // already warming / warmed this lesson
    player._warmDate = date;
    player._warmPending = url;
    const done = function () { if (player._warmPending === url) player._warmPending = null; };
    player._warmPromise = getWarmBlob(url).then(function (blob) {
      done();
      if (!blob || !blob.size) return;
      if (!state.lesson || state.lesson.date !== date) return; // moved on
      if (!player.el.paused) return; // never interrupt playback
      const t = player.el.currentTime || 0;
      if (player.src && t > 0.5) return; // real progress on a stream: leave it
      setWarmBlob(url, URL.createObjectURL(blob));
      player.src = url; // logical src stays the real URL (card matching)
      player.title = m.podcast.title || 'Podcast';
      player.el.src = player._blobUrl;
      playerUI();
    }).catch(function () { done(); /* offline/failed: normal progressive play */ });
  } catch (e) {}
}

/* If the podcast is still downloading, hold the seek until the full file is
   ready, then seek on it (instant). Otherwise the seek could land past the
   downloaded point and restart the track. */
function seekWhenReady(card, fn) {
  const src = card.getAttribute('data-src');
  if (player._warmPending === src && player._warmPromise) {
    player._warmPromise.then(function () { fn(); });
    return true;
  }
  return false;
}

function initAudio() {
  // 'auto': the static host does not honor HTTP Range requests, so the browser
  // can only seek inside audio data it has already downloaded. Auto preload
  // fills the buffer up front, making forward/back seek reliable.
  player.el.preload = 'auto';
  player._seekQueue = [];
  player.el.addEventListener('loadedmetadata', function () {
    const q = player._seekQueue || []; player._seekQueue = [];
    const d = player.el.duration;
    if (isFinite(d) && d > 0) q.forEach(function (fn) { fn(d); });
  });
  player.el.addEventListener('timeupdate', refreshTrackCards);
  player.el.addEventListener('play', function () { playerUI(); refreshTrackCards(); });
  player.el.addEventListener('pause', function () { playerUI(); refreshTrackCards(); });
  player.el.addEventListener('ended', function () { try { checkTrackCompletion(true); } catch (e) {} playerUI(); refreshTrackCards(); });
  player.el.addEventListener('timeupdate', function () { try { checkTrackCompletion(false); } catch (e) {} });
  player.el.addEventListener('error', function () {
    player.title = 'Could not load audio';
    playerUI();
  });
}

async function audioAvailable(url) {
  try {
    if ('caches' in window) {
      const cache = await caches.open('podcast-v1');
      if (await cache.match(url)) return true; // on the phone: available offline
    }
  } catch (e) {}
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch (e) { return false; }
}

/* Seek & skip: shared helpers for the audio cards. */
function cardAudioTitle(card) {
  const t = card.getAttribute('data-title');
  if (t) return t;
  const el = $('.audio-title', card);
  return el ? el.textContent : 'Audio';
}

// Make this card's track the active player track (loads + plays if needed).
/* Element-level src for a track: use the pre-downloaded blob when we have one
   for this exact URL (instant, fully seekable); otherwise the network URL. */
function playableSrc(src) {
  if (src && player._blobFor === src && player._blobUrl) return player._blobUrl;
  return src;
}

function setWarmBlob(url, blobUrl) {
  if (player._blobUrl) { try { URL.revokeObjectURL(player._blobUrl); } catch (e) {} }
  player._blobUrl = blobUrl || null;
  player._blobFor = blobUrl ? url : null;
}

function activateCard(card) {
  const src = card.getAttribute('data-src');
  if (player.src !== src) {
    player.src = src;
    player.title = cardAudioTitle(card);
    player.el.src = playableSrc(src);
    player.el.play().catch(function () {});
    playerUI();
  }
}

// Run fn(duration) now if metadata is ready, otherwise queue it for loadedmetadata.
function withDuration(fn) {
  const d = player.el.duration;
  if (player.el.readyState >= 1 && isFinite(d) && d > 0) { fn(d); return; }
  player._seekQueue = player._seekQueue || [];
  player._seekQueue.push(fn);
}

function seekCard(card, frac) {
  if (seekWhenReady(card, function () { seekCard(card, frac); })) return;
  activateCard(card);
  withDuration(function (d) {
    player.el.currentTime = Math.min(Math.max(frac, 0), 0.999) * d;
    refreshTrackCards();
  });
}

function skipCard(card, delta) {
  if (seekWhenReady(card, function () { skipCard(card, delta); })) return;
  activateCard(card);
  const cur = player.el.currentTime || 0;
  withDuration(function (d) {
    player.el.currentTime = Math.min(Math.max(cur + delta, 0), d);
    refreshTrackCards();
  });
}

/* Render an audio card. Wires itself after insertion. */
function audioCardHTML(o) {
  // o: { id, src, title, sub, cover, speeds:boolean, download:boolean, transcript:url }
  const speeds = o.speeds ? [0.75, 1, 1.25, 1.5].map(function (r) {
    return '<button class="speed-btn" data-action="speed" data-rate="' + r + '" aria-label="Playback speed ' + r + 'x">' + r + 'x</button>';
  }).join('') : '';
  const transcriptBtn = o.transcript
    ? '<button class="btn btn-ghost btn-sm" data-action="toggle-transcript" data-transcript="' + esc(o.transcript) + '" aria-expanded="false">📝 Transcript</button>'
    : '';
  const skipBtns =
    '<div class="skip-row" role="group" aria-label="Skip 10 seconds">' +
      '<button class="btn btn-ghost btn-sm" data-action="skip-back" aria-label="Back 10 seconds">⏪ 10s</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="skip-fwd" aria-label="Forward 10 seconds">10s ⏩</button>' +
    '</div>';
  return '' +
  '<div class="card audio-card" data-audio-card data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" id="' + esc(o.id) + '">' +
    '<div class="audio-top">' +
      (o.cover ? '<img class="podcast-cover" src="' + esc(o.cover) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<button class="play-btn" data-action="play-track" data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" aria-label="Play ' + esc(o.title) + '">▶</button>' +
      '<div class="audio-meta">' +
        '<div class="audio-title">' + esc(o.title) + '</div>' +
        (o.sub ? '<div class="muted">' + esc(o.sub) + '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="progress seekable" role="progressbar" aria-label="Playback progress"><div></div></div>' +
    '<div class="audio-times"><span class="t-cur">0:00</span><span class="t-dur"></span></div>' +
    '<div class="audio-actions">' +
      skipBtns +
      (speeds ? '<div class="speed-row" role="group" aria-label="Playback speed">' + speeds + '</div>' : '') +
      (o.download ? '<a class="btn btn-ghost btn-sm" href="' + esc(o.src) + '" download>⬇ Download</a>' : '') +
      transcriptBtn +
    '</div>' +
    '<div class="transcript-panel hidden"></div>' +
    '<div class="coming-soon hidden">🎵 Audio is coming soon — it will appear here automatically once published.</div>' +
  '</div>';
}

function wireAudioCards(root) {
  $$('[data-audio-card]', root).forEach(function (card) {
    const src = card.getAttribute('data-src');
    const btn = $('.play-btn', card);
    const note = $('.coming-soon', card);
    const durEl = $('.t-dur', card);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', function () {
      if (durEl && isFinite(probe.duration)) durEl.textContent = fmtTime(probe.duration);
    });
    probe.src = src;
    // Seekable progress bar: click or drag to scrub.
    const prog = $('.progress', card);
    if (prog && !prog.dataset.seekWired) {
      prog.dataset.seekWired = '1';
      prog.classList.add('seekable');
      prog.setAttribute('aria-label', 'Seek');
      let dragging = false;
      const fracFromEvent = function (e) {
        const r = prog.getBoundingClientRect();
        if (!r.width) return 0;
        return (e.clientX - r.left) / r.width;
      };
      prog.addEventListener('pointerdown', function (e) {
        dragging = true;
        try { prog.setPointerCapture(e.pointerId); } catch (err) {}
        seekCard(card, fracFromEvent(e));
        e.preventDefault();
      });
      prog.addEventListener('pointermove', function (e) {
        if (dragging) seekCard(card, fracFromEvent(e));
      });
      const endDrag = function () { dragging = false; };
      prog.addEventListener('pointerup', endDrag);
      prog.addEventListener('pointercancel', endDrag);
    }
    audioAvailable(src).then(function (ok) {
      if (!ok) {
        btn.disabled = true;
        btn.textContent = '…';
        note.classList.remove('hidden');
        const dl = $('a[download]', card);
        if (dl) { dl.classList.add('hidden'); }
      }
    });
  });
}

/* ---------------- lesson loading ---------------- */
async function fetchLesson(level, dateStr) {
  const r = await fetch('lessons/' + level + '/' + dateStr + '.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('not found');
  return r.json();
}

async function loadLessons(level) {
  const found = [];
  let misses = 0;
  const d = new Date();
  for (let i = 0; i < 45; i++) {
    const ds = fmtDate(d);
    try {
      const m = await fetchLesson(level, ds);
      found.push(m);
      misses = 0;
    } catch (e) { misses++; }
    if (found.length > 0 && misses >= 10) break;
    d.setDate(d.getDate() - 1);
  }
  return found; // newest first
}

/* A recent public lesson (b2 track) used for the landing preview. */
async function loadPreviewLesson() {
  if (state.previewLesson) return state.previewLesson;
  const d = new Date();
  for (let i = 0; i < 8; i++) {
    try {
      state.previewLesson = await fetchLesson('b2', fmtDate(d));
      return state.previewLesson;
    } catch (e) { /* try previous day */ }
    d.setDate(d.getDate() - 1);
  }
  return null;
}

/* ---------------- router (hash routes — safe on static hosting) ---------------- */
const PUBLIC_VIEWS = ['landing', 'signin', 'signup', 'preview', 'support'];
const LEARNER_VIEWS = ['home', 'lesson', 'lessons', 'scores', 'review', 'profile', 'admin', 'waiting', 'support', 'challenge'];
const INPAGE_ANCHORS = ['how-it-works', 'levels'];

function parseHash() {
  const h = window.location.hash || '#/';
  const raw = h.replace(/^#/, '');
  const parts = raw.replace(/^\//, '').split('/');
  return { name: parts[0] || '', arg: decodeURIComponent(parts[1] || ''), raw: raw };
}

/* Guard: never discard an in-progress quiz silently. */
function quizGuardOk() {
  if (state.quiz) {
    return window.confirm('You have a quiz in progress. Leave now and lose your quiz progress?');
  }
  return true;
}

function go(view, arg) {
  if (!quizGuardOk()) return;
  const h = '#/' + view + (arg ? '/' + encodeURIComponent(arg) : '');
  if (window.location.hash === h) { onRoute(); }
  else { window.location.hash = h; }
}

function onRoute() {
  const r = parseHash();
  // In-page landing anchors (e.g. #how-it-works) scroll, they are not routes.
  if (INPAGE_ANCHORS.indexOf(r.name) !== -1 && !state.user) {
    const el = document.getElementById(r.name);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  let view = r.name || 'landing';
  if (!state.user) {
    if (PUBLIC_VIEWS.indexOf(view) === -1) view = 'landing';
  } else {
    // Logged-in: learner views win (support lives in both lists so it works before AND after login).
    if (LEARNER_VIEWS.indexOf(view) === -1) {
      view = 'home';
      if (window.location.hash !== '#/home') { window.location.hash = '#/home'; return; }
    }
    if (view === 'admin' && !state.user.isAdmin) view = 'home';
  }
  show(view, r.arg);
}

function show(view, arg) {
  state.view = view;
  if (view !== 'lesson') { state.quiz = null; }
  setChrome();
  closeProfileMenu();
  const v = $('#view');
  window.scrollTo(0, 0);
  if (view === 'landing') renderLanding(v);
  else if (view === 'signin') renderSignin(v);
  else if (view === 'signup') renderSignup(v);
  else if (view === 'preview') renderPreview(v);
  else if (view === 'waiting') renderWaiting(v);
  else if (view === 'home') renderHome(v);
  else if (view === 'lesson') renderLesson(v, arg);
  else if (view === 'lessons') renderLessons(v);
  else if (view === 'scores') renderScores(v);
  else if (view === 'review') renderMistakes(v);
  else if (view === 'profile') renderProfile(v);
  else if (view === 'support') renderSupport(v);
  else if (view === 'challenge') renderChallenge(v);
  else if (view === 'admin') renderAdmin(v);
}

/* ---------------- chrome (headers / profile menu / nav) ---------------- */
function setChrome() {
  const logged = !!state.user;
  $('#landing-header').classList.toggle('hidden', logged);
  $('#app-header').classList.toggle('hidden', !logged);
  $('#tabbar').classList.toggle('hidden', !logged);
  if (logged) {
    const initial = (state.user.email || '?').trim().charAt(0).toUpperCase();
    $('#profile-initial').textContent = initial;
    $('#profile-email').textContent = state.user.email;
    $('#profile-level').textContent = state.user.level ? levelLabel(normalizeLevel(state.user.level)) : 'Level pending';
    $('#profile-admin').classList.toggle('hidden', !state.user.isAdmin);
    $$('#tabbar .tab').forEach(function (t) {
      const tv = t.getAttribute('data-view');
      // The lessons archive is a sub-page of Home: keep Home highlighted there.
      const active = tv === state.view || (state.view === 'lessons' && tv === 'home');
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.body.classList.add('logged-in');
  } else {
    document.body.classList.remove('logged-in');
    player.src = null;
    try { player.el.pause(); } catch (e) {}
    playerUI();
  }
}

function closeProfileMenu() {
  const dd = $('#profile-dropdown');
  if (dd) dd.classList.add('hidden');
  const btn = $('#btn-profile');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleProfileMenu() {
  const dd = $('#profile-dropdown');
  const btn = $('#btn-profile');
  const open = dd.classList.contains('hidden');
  dd.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', String(open));
}

/* ---------------- LANDING (public) ---------------- */
function heroPreviewHTML(m) {
  if (!m) {
    return '<div class="preview-card"><div class="preview-body">' +
      '<p class="muted">Today’s lesson preview is loading…</p></div></div>';
  }
  const nWords = (m.words || []).length;
  const nQuiz = (m.quiz || []).length;
  const checks = [
    ['📚', 'Learn useful words', nWords ? nWords + ' new words with photos' : 'New words with photos'],
    ['🎧', 'Listen and shadow', m.podcast && m.podcast.title ? esc(m.podcast.title) : 'Podcast + shadowing practice'],
    ['📝', 'Test yourself', nQuiz ? nQuiz + '-question quiz' : 'Quiz on today’s words'],
    ['📈', 'Daily progress', 'Track scores and review mistakes']
  ];
  return '' +
  '<div class="preview-card" aria-label="Preview of today’s lesson">' +
    '<div class="preview-head"><span class="brand"><span class="brand-mark">📖</span><span class="brand-name">Muse English</span></span>' +
    '<span class="badge-level" style="background:rgba(247,242,232,.2);color:#fff">' + esc(levelLabel(normalizeLevel(m.level))) + '</span></div>' +
    '<div class="preview-body">' +
      '<div class="preview-date">' + esc(m.date || '') + ' · Today’s lesson</div>' +
      '<div class="preview-theme">' + esc(m.theme || 'Daily lesson') + '</div>' +
      '<ul class="preview-checks">' + checks.map(function (c) {
        return '<li><span class="ck" aria-hidden="true">' + c[0] + '</span><span><b>' + c[1] + '</b><br><span class="muted">' + c[2] + '</span></span></li>';
      }).join('') + '</ul>' +
      '<div class="preview-bar" role="img" aria-label="Daily progress example"><div></div></div>' +
      '<div class="preview-progress-label">Your daily progress — tracked automatically</div>' +
      '<a class="btn btn-block" href="#/signup">Start learning</a>' +
    '</div>' +
  '</div>';
}

function renderLanding(v) {
  const returning = (function () {
    try { return !!localStorage.getItem('el_last_user'); } catch (e) { return false; }
  })();
  v.innerHTML =
  '<div class="landing">' +
    /* Hero */
    '<section class="hero">' +
      '<div>' +
        '<span class="hero-eyebrow">Daily English lessons · A1–C2</span>' +
        '<h1>Build real English, one daily lesson at a time.</h1>' +
        '<p class="hero-desc">Words, listening, shadowing, grammar and a quiz—combined into one clear learning path for your level.</p>' +
        '<div class="hero-ctas">' +
          '<a class="btn" href="#/signup">Start learning</a>' +
          '<a class="btn btn-ghost" href="#/preview">Preview today’s lesson</a>' +
        '</div>' +
        '<ul class="hero-signals">' +
          '<li>A1–C2 levels</li>' +
          '<li>Audio + transcript</li>' +
          '<li>Mistake review</li>' +
        '</ul>' +
        (returning ? '<p class="muted" style="margin-top:0.8rem">Welcome back — <a class="link" href="#/signin">sign in</a> to continue.</p>' : '') +
      '</div>' +
      '<div class="hero-preview" id="hero-preview"><div class="preview-card"><div class="preview-body"><p class="muted">Loading today’s lesson…</p></div></div></div>' +
    '</section>' +

    /* Interactive lesson preview */
    '<section class="landing-section" aria-labelledby="lp-preview-h">' +
      '<h2 id="lp-preview-h">See a real lesson</h2>' +
      '<p class="section-sub">A peek inside today’s lesson — the same format you’ll get every day, matched to your level.</p>' +
      '<div class="preview-tabs" role="tablist" aria-label="Lesson preview">' +
        '<button class="preview-tab" role="tab" aria-selected="true" data-ptab="words" id="ptab-words">Words</button>' +
        '<button class="preview-tab" role="tab" aria-selected="false" data-ptab="listen" id="ptab-listen">Listen</button>' +
        '<button class="preview-tab" role="tab" aria-selected="false" data-ptab="quiz" id="ptab-quiz">Quiz</button>' +
      '</div>' +
      '<div id="preview-tab-body" role="tabpanel" aria-labelledby="ptab-words"><p class="muted">Loading…</p></div>' +
    '</section>' +

    /* How one lesson works */
    '<section class="landing-section" id="how-it-works" aria-labelledby="lp-how-h">' +
      '<h2 id="lp-how-h">How one lesson works</h2>' +
      '<p class="section-sub">The same four steps every day — a habit you can actually keep.</p>' +
      '<div class="steps">' +
        '<div class="step"><div class="step-num">1</div><h3>Learn</h3><p>Meet the day’s words with photos, pronunciation and Persian meanings.</p></div>' +
        '<div class="step"><div class="step-num">2</div><h3>Listen</h3><p>Hear the words in a real podcast conversation, with a full transcript.</p></div>' +
        '<div class="step"><div class="step-num">3</div><h3>Speak</h3><p>Shadow each sentence out loud — repetition that builds fluency.</p></div>' +
        '<div class="step"><div class="step-num">4</div><h3>Review</h3><p>Take the quiz. Anything you miss comes back automatically for review.</p></div>' +
      '</div>' +
    '</section>' +

    /* Levels */
    '<section class="landing-section" id="levels" aria-labelledby="lp-levels-h">' +
      '<h2 id="lp-levels-h">Built for your level</h2>' +
      '<p class="section-sub">Six CEFR levels, from your first English words to near-native precision. Your teacher assigns your level; every lesson matches it.</p>' +
      '<div class="level-grid">' +
        LEVELS.map(function (lv) {
          return '<div class="level-cell"><div class="lvl">' + lv.toUpperCase() + '</div>' +
            '<div class="lbl">' + esc(LEVEL_LABELS[lv].split(' · ')[1]) + '</div>' +
            '<div class="desc">' + esc(LEVEL_DESC[lv]) + '</div></div>';
        }).join('') +
      '</div>' +
    '</section>' +

    /* Mistakes become practice */
    '<section class="landing-section" aria-labelledby="lp-mistakes-h">' +
      '<div class="mistake-band">' +
        '<div>' +
          '<h2 id="lp-mistakes-h">Mistakes become practice</h2>' +
          '<p>Every wrong answer is saved automatically. When you review, you practice exactly the words you missed — and each one leaves your review list the moment you get it right.</p>' +
          '<a class="btn btn-green" href="#/signup" style="margin-top:0.6rem">Start learning</a>' +
        '</div>' +
        '<div class="mistake-demo" aria-hidden="true">' +
          '<div class="md-q">“She ___ to work every day.”</div>' +
          '<div class="md-wrong">✗ You chose: “go”</div>' +
          '<div class="md-arrow">↓</div>' +
          '<div class="md-review">✓ Saved to Review → practice again → “goes” → done.</div>' +
        '</div>' +
      '</div>' +
    '</section>' +

    /* Final CTA */
    '<section class="final-cta" aria-labelledby="lp-final-h">' +
      '<h2 id="lp-final-h">Start today’s lesson</h2>' +
      '<p class="muted">One lesson a day. Words, listening, speaking and a quiz — for your level.</p>' +
      '<a class="btn" href="#/signup">Create your free account</a><br>' +
      '<span class="muted">Already have an account? <a class="link" href="#/signin">Sign in</a></span>' +
    '</section>' +

    '<footer class="landing-footer">Muse English · daily lessons for levels A1–C2</footer>' +
  '</div>';

  // Fill the hero preview + interactive tabs with real lesson content.
  loadPreviewLesson().then(function (m) {
    const hp = document.getElementById('hero-preview');
    if (hp && state.view === 'landing') hp.innerHTML = heroPreviewHTML(m);
    renderPreviewTab('words', m);
  });
}

function renderPreviewTab(which, m) {
  const body = document.getElementById('preview-tab-body');
  if (!body) return;
  $$('.preview-tab').forEach(function (t) {
    const sel = t.getAttribute('data-ptab') === which;
    t.setAttribute('aria-selected', String(sel));
    body.setAttribute('aria-labelledby', t.id && sel ? t.id : body.getAttribute('aria-labelledby'));
  });
  if (!m) { body.innerHTML = '<p class="muted">Could not load the lesson preview.</p>'; return; }
  if (which === 'words') {
    const words = (m.words || []).slice(0, 4);
    body.innerHTML = '<div class="preview-words">' + words.map(function (w) {
      return '<div class="preview-word">' +
        (w.photo ? '<img src="' + esc(w.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div><div class="pw-word">' + esc(w.word) + '</div>' +
        '<div class="pw-meaning">' + esc(w.meaning || '') + '</div></div></div>';
    }).join('') + '</div>' +
    '<p class="muted" style="margin-top:0.8rem">' + (m.words || []).length + ' words in today’s lesson · <a class="link" href="#/preview">see them all</a></p>';
  } else if (which === 'listen') {
    body.innerHTML = (m.podcast && m.podcast.audio)
      ? audioCardHTML({ id: 'preview-podcast', src: m.podcast.audio, title: m.podcast.title || 'Podcast',
          sub: 'From today’s lesson', speeds: false, download: false, transcript: m.podcast.transcript || null })
      : '<p class="muted">No audio preview available.</p>';
    wireAudioCards(body);
  } else {
    const q = (m.quiz || [])[0];
    body.innerHTML = '<div class="preview-quiz-teaser">' +
      (q ? '<div class="quiz-q">' + esc(q.question) + '</div>' +
        '<div>' + q.options.map(function (o) { return '<span class="badge-level" style="margin:0.15rem">' + esc(o) + '</span>'; }).join(' ') + '</div>'
        : '<p class="muted">A short quiz closes every lesson.</p>') +
      '<p class="muted" style="margin-top:0.9rem">Create an account to take the full quiz and track your score.</p>' +
      '<a class="btn" href="#/signup">Start learning</a></div>';
  }
  refreshTrackCards();
}

/* Public read-only lesson preview (no login required). */
function renderPreview(v) {
  v.innerHTML = '<div class="landing"><p class="muted"><a class="link" href="#/">← Back</a></p>' +
    '<div id="preview-full"><p class="muted">Loading today’s lesson…</p></div></div>';
  loadPreviewLesson().then(function (m) {
    const host = document.getElementById('preview-full');
    if (!host || state.view !== 'preview') return;
    if (!m) { host.innerHTML = '<div class="empty">Could not load the preview.</div>'; return; }
    let html = '<div class="hero-date">' + esc(m.date || '') + ' · Today’s lesson · ' + esc(levelLabel(normalizeLevel(m.level))) + '</div>' +
      '<h1 style="text-transform:capitalize">' + esc(m.theme || 'Daily lesson') + '</h1>' +
      '<p class="muted">A read-only peek — sign up to get your own level’s lesson every day.</p>';
    html += '<h2>Words</h2><div class="preview-words">' + (m.words || []).map(function (w) {
      return '<div class="preview-word">' +
        (w.photo ? '<img src="' + esc(w.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div><div class="pw-word">' + esc(w.word) + '</div>' +
        '<div class="pw-meaning">' + esc(w.meaning || '') + '</div></div></div>';
    }).join('') + '</div>';
    if (m.podcast && m.podcast.audio) {
      html += '<h2 style="margin-top:1.4rem">Podcast</h2>' + audioCardHTML({
        id: 'preview-full-podcast', src: m.podcast.audio, title: m.podcast.title || 'Podcast',
        sub: 'With transcript', speeds: false, download: false, transcript: m.podcast.transcript || null
      });
    }
    if (m.shadowing && m.shadowing.audio) {
      html += '<h2 style="margin-top:1.4rem">Shadowing</h2>' + audioCardHTML({
        id: 'preview-full-shadow', src: m.shadowing.audio, title: m.shadowing.title || 'Shadowing',
        sub: 'Each sentence read twice', speeds: true, download: false, transcript: m.shadowing.transcript || null
      });
    }
    html += '<div class="final-cta"><h2>Like what you see?</h2>' +
      '<p class="muted">Get a lesson like this every day — matched to your level.</p>' +
      '<a class="btn" href="#/signup">Start learning</a><br>' +
      '<span class="muted">Already have an account? <a class="link" href="#/signin">Sign in</a></span></div>';
    host.innerHTML = html;
    wireAudioCards(host);
    refreshTrackCards();
  });
}

/* ---------------- auth: separate sign-in / create-account views ---------------- */
function authShell(inner) {
  return '<div class="landing"><div class="card" style="max-width:440px;margin:2rem auto">' + inner + '</div></div>';
}

function renderSignin(v) {
  const configured = supabaseKeysPresent();
  v.innerHTML = authShell(
    '<h1>Welcome back 👋</h1>' +
    '<p class="muted">Sign in to continue your lessons.</p>' +
    (configured ?
      '<form id="form-signin" novalidate>' +
        '<div class="field"><label for="si-email">Email</label>' +
        '<input id="si-email" name="signin-email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label for="si-pass">Password</label>' +
        '<div class="pw-wrap"><input id="si-pass" name="signin-password" type="password" autocomplete="current-password" placeholder="••••••••" required>' +
        '<button type="button" class="pw-toggle" data-action="pw-toggle" aria-label="Show password">👁️</button></div></div>' +
        '<div class="form-error" id="si-error" role="alert"></div>' +
        '<div class="form-note" id="si-note" role="status"></div>' +
        '<button class="btn btn-block" type="submit" id="si-submit">Sign in</button>' +
      '</form>' +
      '<p class="auth-switch">New here? <a class="link" href="#/signup">Create an account</a></p>'
    :
      '<div class="coming-soon">🔑 Real login is not connected yet — add your Supabase keys in <b>js/config.js</b> to enable it.</div>' +
      '<button class="btn btn-block" data-action="demo-learner">Continue in demo mode (learner)</button>' +
      '<button class="btn btn-ghost btn-block" data-action="demo-admin">Continue in demo mode (admin)</button>'
    )
  );
  // Arriving here right after signup: prefill email + explain the next step.
  if (state.afterSignup) {
    const em = document.getElementById('si-email');
    if (em) em.value = state.afterSignup;
    authNote('si', '✓ Account created! Check your inbox for the confirmation email, then sign in.');
    state.afterSignup = null;
  }
  // Signup with email confirmation required: popup explaining they must
  // confirm the email before they can enter the app.
  if (state.showConfirmPopup) {
    const em2 = state.showConfirmPopup;
    state.showConfirmPopup = null;
    showModal(
      '<div class="modal-ico">📧</div>' +
      '<h2>Check your inbox</h2>' +
      '<p>We sent a confirmation email to<br><b>' + esc(em2) + '</b>.</p>' +
      '<p>Click the link inside it to confirm your email address — then you can sign in and enter the app.</p>' +
      '<button class="btn btn-block" data-action="modal-close">OK, got it</button>',
      true
    );
  }
}

/* Self-declared level at signup: 3 buckets auto-mapped to CEFR tracks.
   No waiting for manual approval — the user enters the app immediately. */
const SIGNUP_LEVELS = [
  { id: 'a1', name: 'Elementary', desc: "I'm starting out", icon: '🌱' },
  { id: 'b1', name: 'Intermediate', desc: 'I can hold a conversation', icon: '📈' },
  { id: 'c1', name: 'Advanced', desc: "I'm fluent, I want depth", icon: '🚀' },
];
function levelPickerHTML(name) {
  return '<div class="level-pick">' + SIGNUP_LEVELS.map(function (l) {
    return '<label class="level-opt"><input type="radio" name="' + name + '" value="' + l.id + '">' +
      '<span class="level-card"><span class="level-ico">' + l.icon + '</span>' +
      '<span class="level-name">' + l.name + '</span>' +
      '<span class="level-desc">' + l.desc + '</span></span></label>';
  }).join('') + '</div>';
}

function renderSignup(v) {
  const configured = supabaseKeysPresent();  v.innerHTML = authShell(
    '<h1>Create your account ✨</h1>' +
    '<p class="muted">One lesson a day — words, listening, speaking and a quiz, for your level.</p>' +
    (configured ?
      // Distinct form/field names + autocomplete=new-password keep the browser
      // from dropping saved *login* credentials into the signup form.
      '<form id="form-signup" novalidate autocomplete="off">' +
        '<div class="field"><label for="su-email">Email</label>' +
        '<input id="su-email" name="signup-email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label for="su-pass">Password</label>' +
        '<div class="pw-wrap"><input id="su-pass" name="signup-password" type="password" autocomplete="new-password" placeholder="Choose a password (min 6 characters)" required minlength="6">' +
        '<button type="button" class="pw-toggle" data-action="pw-toggle" aria-label="Show password">👁️</button></div></div>' +
        '<div class="field"><label for="su-nick">Nickname</label>' +
        '<input id="su-nick" name="signup-nickname" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. word_warrior" maxlength="20" required>' +
        '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">Shown on the Challenge leaderboard · 3–20 characters: A–Z, 0–9, _ or -</p></div>' +
        '<div class="field"><label>Your English level</label>' + levelPickerHTML('su-level') +
        '<p class="muted" style="margin-top:0.4rem">Pick the closest one — your lessons start right away.</p></div>' +
        '<div class="form-error" id="su-error" role="alert"></div>' +
        '<div class="form-note" id="su-note" role="status"></div>' +
        '<button class="btn btn-block" type="submit" id="su-submit">Create account</button>' +
      '</form>' +
      '<p class="auth-switch">Already have an account? <a class="link" href="#/signin">Sign in</a></p>'
    :
      '<div class="coming-soon">🔑 Real signup is not connected yet — add your Supabase keys in <b>js/config.js</b> to enable it.</div>' +
      '<button class="btn btn-block" data-action="demo-learner">Continue in demo mode (learner)</button>'
    )
  );
}

function togglePw(btn) {
  const wrap = btn.closest('.pw-wrap');
  const input = wrap ? wrap.querySelector('input') : null;
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁️';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function setAuthBusy(kind, busy, label) {
  const btn = document.getElementById(kind === 'si' ? 'si-submit' : 'su-submit');
  if (btn) { btn.disabled = busy; if (label) btn.textContent = label; }
}
function authError(kind, msg) {
  const el = document.getElementById(kind === 'si' ? 'si-error' : 'su-error');
  if (el) el.textContent = msg || '';
  const note = document.getElementById(kind === 'si' ? 'si-note' : 'su-note');
  if (note) note.textContent = '';
}
function authNote(kind, msg) {
  const note = document.getElementById(kind === 'si' ? 'si-note' : 'su-note');
  if (note) note.textContent = msg || '';
}

/* ---------------- modal (popup) ---------------- */
function showModal(html, lock) {
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.id = 'app-modal';
  ov.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(ov);
  if (!lock) ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
  return ov;
}
function closeModal() {
  const m = document.getElementById('app-modal');
  if (m) m.remove();
}

/* ---------------- user region (timezone-based country detection) ---------------- */
/* VPN-proof: the device timezone reflects where the user actually lives,
   unlike IP geolocation which follows the VPN exit node. */
const TZ_COUNTRY = {
  'Asia/Tehran': ['IR', 'Iran'],
  'Asia/Dubai': ['AE', 'United Arab Emirates'], 'Asia/Muscat': ['OM', 'Oman'],
  'Asia/Qatar': ['QA', 'Qatar'], 'Asia/Bahrain': ['BH', 'Bahrain'],
  'Asia/Kuwait': ['KW', 'Kuwait'], 'Asia/Riyadh': ['SA', 'Saudi Arabia'],
  'Asia/Baghdad': ['IQ', 'Iraq'], 'Asia/Amman': ['JO', 'Jordan'],
  'Asia/Beirut': ['LB', 'Lebanon'], 'Asia/Damascus': ['SY', 'Syria'],
  'Asia/Jerusalem': ['IL', 'Israel'], 'Asia/Gaza': ['PS', 'Palestine'],
  'Asia/Hebron': ['PS', 'Palestine'], 'Asia/Nicosia': ['CY', 'Cyprus'],
  'Asia/Yerevan': ['AM', 'Armenia'], 'Asia/Baku': ['AZ', 'Azerbaijan'],
  'Asia/Tbilisi': ['GE', 'Georgia'], 'Asia/Karachi': ['PK', 'Pakistan'],
  'Asia/Kolkata': ['IN', 'India'], 'Asia/Colombo': ['LK', 'Sri Lanka'],
  'Asia/Dhaka': ['BD', 'Bangladesh'], 'Asia/Kathmandu': ['NP', 'Nepal'],
  'Asia/Yangon': ['MM', 'Myanmar'], 'Asia/Bangkok': ['TH', 'Thailand'],
  'Asia/Jakarta': ['ID', 'Indonesia'], 'Asia/Makassar': ['ID', 'Indonesia'],
  'Asia/Jayapura': ['ID', 'Indonesia'], 'Asia/Kuala_Lumpur': ['MY', 'Malaysia'],
  'Asia/Singapore': ['SG', 'Singapore'], 'Asia/Manila': ['PH', 'Philippines'],
  'Asia/Hong_Kong': ['HK', 'Hong Kong'], 'Asia/Taipei': ['TW', 'Taiwan'],
  'Asia/Shanghai': ['CN', 'China'], 'Asia/Urumqi': ['CN', 'China'],
  'Asia/Seoul': ['KR', 'South Korea'], 'Asia/Tokyo': ['JP', 'Japan'],
  'Asia/Ulaanbaatar': ['MN', 'Mongolia'], 'Asia/Almaty': ['KZ', 'Kazakhstan'],
  'Asia/Aqtau': ['KZ', 'Kazakhstan'], 'Asia/Aqtobe': ['KZ', 'Kazakhstan'],
  'Asia/Oral': ['KZ', 'Kazakhstan'], 'Asia/Qyzylorda': ['KZ', 'Kazakhstan'],
  'Asia/Tashkent': ['UZ', 'Uzbekistan'], 'Asia/Samarkand': ['UZ', 'Uzbekistan'],
  'Asia/Ashgabat': ['TM', 'Turkmenistan'], 'Asia/Dushanbe': ['TJ', 'Tajikistan'],
  'Asia/Bishkek': ['KG', 'Kyrgyzstan'], 'Asia/Kabul': ['AF', 'Afghanistan'],
  'Asia/Yekaterinburg': ['RU', 'Russia'], 'Asia/Omsk': ['RU', 'Russia'],
  'Asia/Krasnoyarsk': ['RU', 'Russia'], 'Asia/Irkutsk': ['RU', 'Russia'],
  'Asia/Yakutsk': ['RU', 'Russia'], 'Asia/Vladivostok': ['RU', 'Russia'],
  'Asia/Magadan': ['RU', 'Russia'], 'Asia/Kamchatka': ['RU', 'Russia'],
  'Asia/Novosibirsk': ['RU', 'Russia'], 'Asia/Chita': ['RU', 'Russia'],
  'Asia/Sakhalin': ['RU', 'Russia'], 'Asia/Anadyr': ['RU', 'Russia'],
  'Europe/London': ['GB', 'United Kingdom'], 'Europe/Dublin': ['IE', 'Ireland'],
  'Europe/Lisbon': ['PT', 'Portugal'], 'Europe/Madrid': ['ES', 'Spain'],
  'Europe/Paris': ['FR', 'France'], 'Europe/Brussels': ['BE', 'Belgium'],
  'Europe/Amsterdam': ['NL', 'Netherlands'], 'Europe/Berlin': ['DE', 'Germany'],
  'Europe/Rome': ['IT', 'Italy'], 'Europe/Vienna': ['AT', 'Austria'],
  'Europe/Zurich': ['CH', 'Switzerland'], 'Europe/Prague': ['CZ', 'Czechia'],
  'Europe/Warsaw': ['PL', 'Poland'], 'Europe/Budapest': ['HU', 'Hungary'],
  'Europe/Bratislava': ['SK', 'Slovakia'], 'Europe/Ljubljana': ['SI', 'Slovenia'],
  'Europe/Zagreb': ['HR', 'Croatia'], 'Europe/Belgrade': ['RS', 'Serbia'],
  'Europe/Sarajevo': ['BA', 'Bosnia and Herzegovina'], 'Europe/Skopje': ['MK', 'North Macedonia'],
  'Europe/Tirane': ['AL', 'Albania'], 'Europe/Athens': ['GR', 'Greece'],
  'Europe/Bucharest': ['RO', 'Romania'], 'Europe/Sofia': ['BG', 'Bulgaria'],
  'Europe/Chisinau': ['MD', 'Moldova'], 'Europe/Kyiv': ['UA', 'Ukraine'],
  'Europe/Minsk': ['BY', 'Belarus'], 'Europe/Riga': ['LV', 'Latvia'],
  'Europe/Tallinn': ['EE', 'Estonia'], 'Europe/Vilnius': ['LT', 'Lithuania'],
  'Europe/Helsinki': ['FI', 'Finland'], 'Europe/Stockholm': ['SE', 'Sweden'],
  'Europe/Oslo': ['NO', 'Norway'], 'Europe/Copenhagen': ['DK', 'Denmark'],
  'Europe/Istanbul': ['TR', 'Turkey'], 'Europe/Moscow': ['RU', 'Russia'],
  'Europe/Kaliningrad': ['RU', 'Russia'], 'Europe/Samara': ['RU', 'Russia'],
  'Europe/Volgograd': ['RU', 'Russia'], 'Europe/Saratov': ['RU', 'Russia'],
  'Europe/Astrakhan': ['RU', 'Russia'],
  'Africa/Cairo': ['EG', 'Egypt'], 'Africa/Lagos': ['NG', 'Nigeria'],
  'Africa/Johannesburg': ['ZA', 'South Africa'], 'Africa/Nairobi': ['KE', 'Kenya'],
  'Africa/Casablanca': ['MA', 'Morocco'], 'Africa/Algiers': ['DZ', 'Algeria'],
  'Africa/Tunis': ['TN', 'Tunisia'], 'Africa/Tripoli': ['LY', 'Libya'],
  'Africa/Khartoum': ['SD', 'Sudan'], 'Africa/Addis_Ababa': ['ET', 'Ethiopia'],
  'Africa/Accra': ['GH', 'Ghana'], 'Africa/Dakar': ['SN', 'Senegal'],
  'Africa/Abidjan': ['CI', 'Ivory Coast'],
  'America/Toronto': ['CA', 'Canada'], 'America/Vancouver': ['CA', 'Canada'],
  'America/Edmonton': ['CA', 'Canada'], 'America/Winnipeg': ['CA', 'Canada'],
  'America/Halifax': ['CA', 'Canada'], 'America/St_Johns': ['CA', 'Canada'],
  'America/Regina': ['CA', 'Canada'], 'America/Blanc-Sablon': ['CA', 'Canada'],
  'America/Atikokan': ['CA', 'Canada'], 'America/Creston': ['CA', 'Canada'],
  'America/Dawson_Creek': ['CA', 'Canada'], 'America/Fort_Nelson': ['CA', 'Canada'],
  'America/Cambridge_Bay': ['CA', 'Canada'], 'America/Yellowknife': ['CA', 'Canada'],
  'America/Inuvik': ['CA', 'Canada'], 'America/Whitehorse': ['CA', 'Canada'],
  'America/Dawson': ['CA', 'Canada'], 'America/Iqaluit': ['CA', 'Canada'],
  'America/Pangnirtung': ['CA', 'Canada'], 'America/Resolute': ['CA', 'Canada'],
  'America/Rankin_Inlet': ['CA', 'Canada'], 'America/Goose_Bay': ['CA', 'Canada'],
  'America/Moncton': ['CA', 'Canada'], 'America/Glace_Bay': ['CA', 'Canada'],
  'America/Nipigon': ['CA', 'Canada'], 'America/Thunder_Bay': ['CA', 'Canada'],
  'America/Swift_Current': ['CA', 'Canada'],
  'America/New_York': ['US', 'United States'], 'America/Chicago': ['US', 'United States'],
  'America/Denver': ['US', 'United States'], 'America/Los_Angeles': ['US', 'United States'],
  'America/Anchorage': ['US', 'United States'], 'America/Phoenix': ['US', 'United States'],
  'America/Detroit': ['US', 'United States'], 'America/Boise': ['US', 'United States'],
  'America/Indiana/Indianapolis': ['US', 'United States'], 'America/Kentucky/Louisville': ['US', 'United States'],
  'America/Juneau': ['US', 'United States'], 'Pacific/Honolulu': ['US', 'United States'],
  'America/Mexico_City': ['MX', 'Mexico'], 'America/Cancun': ['MX', 'Mexico'],
  'America/Tijuana': ['MX', 'Mexico'], 'America/Guatemala': ['GT', 'Guatemala'],
  'America/Costa_Rica': ['CR', 'Costa Rica'], 'America/Panama': ['PA', 'Panama'],
  'America/Havana': ['CU', 'Cuba'], 'America/Santo_Domingo': ['DO', 'Dominican Republic'],
  'America/Bogota': ['CO', 'Colombia'], 'America/Lima': ['PE', 'Peru'],
  'America/Santiago': ['CL', 'Chile'], 'America/Buenos_Aires': ['AR', 'Argentina'],
  'America/Sao_Paulo': ['BR', 'Brazil'], 'America/Caracas': ['VE', 'Venezuela'],
  'America/Montevideo': ['UY', 'Uruguay'],
  'Australia/Sydney': ['AU', 'Australia'], 'Australia/Melbourne': ['AU', 'Australia'],
  'Australia/Brisbane': ['AU', 'Australia'], 'Australia/Perth': ['AU', 'Australia'],
  'Australia/Adelaide': ['AU', 'Australia'], 'Australia/Darwin': ['AU', 'Australia'],
  'Australia/Hobart': ['AU', 'Australia'],
  'Pacific/Auckland': ['NZ', 'New Zealand'], 'Pacific/Fiji': ['FJ', 'Fiji'],
};
function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_COUNTRY[tz]) return { code: TZ_COUNTRY[tz][0], name: TZ_COUNTRY[tz][1], source: 'timezone' };
  } catch (e) {}
  return null;
}
/* Curated list for the manual country picker in the profile. */
const COUNTRY_OPTIONS = [
  ['IR', 'Iran'], ['CA', 'Canada'], ['US', 'United States'], ['GB', 'United Kingdom'],
  ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['SE', 'Sweden'],
  ['AU', 'Australia'], ['TR', 'Turkey'], ['AE', 'United Arab Emirates'],
  ['SA', 'Saudi Arabia'], ['IQ', 'Iraq'], ['AF', 'Afghanistan'], ['PK', 'Pakistan'],
  ['IN', 'India'], ['IT', 'Italy'], ['ES', 'Spain'], ['CH', 'Switzerland'],
  ['NO', 'Norway'],
];
/* Detects the country (if not stored yet) and saves it on the profile.
   Runs as a separate upsert so a missing DB migration can never break
   the level/profile save — it just retries on the next app open. */
async function ensureCountrySaved() {
  const u = state.user;
  if (!sb || !u || u.demo || u.countryCode) return;
  const c = detectCountry();
  if (!c) return;
  u.countryCode = c.code; u.country = c.name; u.countrySource = c.source;
  try {
    await sb.from('profiles').upsert({
      id: u.id, email: u.email, level: u.level || null,
      country_code: c.code, country: c.name,
      country_source: c.source, country_detected_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  } catch (e) { /* pre-migration or offline -> retry next open */ }
}

async function doLogin() {
  const emailEl = document.getElementById('si-email');
  const passEl = document.getElementById('si-pass');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  const pass = passEl.value;
  if (!email || !pass) { authError('si', 'Enter your email and password.'); return; }
  authError('si', '');
  if (!sb) { authError('si', 'Login service couldn’t load. Check your connection and try again.'); return; }
  setAuthBusy('si', true, 'Signing in…');
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (error) throw error;
    authNote('si', '✓ Signed in — loading your lessons…');
    await enterApp();
  } catch (e) {
    authError('si', (e && e.message) || 'Sign in failed.');
    setAuthBusy('si', false, 'Sign in');
  }
}

async function doSignup() {
  const emailEl = document.getElementById('su-email');
  const passEl = document.getElementById('su-pass');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  const pass = passEl.value;
  if (!email || !pass) { authError('su', 'Enter your email and password.'); return; }
  if (pass.length < 6) { authError('su', 'Password must be at least 6 characters.'); return; }
  const lvlEl = document.querySelector('input[name="su-level"]:checked');
  if (!lvlEl) { authError('su', 'Please pick your English level.'); return; }
  const chosenLevel = lvlEl.value;
  const nickEl = document.getElementById('su-nick');
  const nickname = nickEl ? nickEl.value.trim() : '';
  if (!validNickname(nickname)) { authError('su', 'Pick a nickname: 3–20 characters, letters, numbers, _ or -.'); return; }
  authError('su', '');
  if (!sb) { authError('su', 'Signup service couldn’t load. Check your connection and try again.'); return; }
  const taken = await nicknameTaken(nickname);
  if (taken) { authError('su', 'This nickname is taken, try another.'); return; }
  setAuthBusy('su', true, 'Creating your account…');
  try {
    // After clicking the email link, Supabase returns the user to the app
    // they signed up from (production -> production, localhost -> localhost).
    const signupOpts = { emailRedirectTo: window.location.origin + '/' };
    // Server-side persistence: the handle_new_user trigger saves level (+ref) on the
    // profile at signup, so email confirmation on another device/browser keeps them.
    const signupMeta = { level: chosenLevel, display_name: nickname };
    const signupRef = getRefCode();
    if (signupRef) signupMeta.referred_by = signupRef;
    signupOpts.data = signupMeta;
    const { data, error } = await sb.auth.signUp({
      email: email,
      password: pass,
      options: signupOpts,
    });
    if (error) throw error;
    setAuthBusy('su', false, 'Create account');
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      // Duplicate signup: Supabase sends NO confirmation email for an already-registered
      // address (returns an obfuscated user with empty identities). Tell the user to sign in.
      authError('su', 'This email is already registered. Please sign in instead.');
      return;
    }
    if (data.session) {
      // Email confirmation disabled -> already signed in: save level now.
      try { await sb.from('profiles').upsert({ id: data.user.id, email: email, level: chosenLevel }, { onConflict: 'id' }); } catch (e) {}
      try { const r = getRefCode(); if (r) await sb.from('profiles').update({ referred_by: r }).eq('id', data.user.id); } catch (e) {}
      state.justSignedUp = true;
      authNote('su', '✓ Account created — loading your lessons…');
      await enterApp();
      return;
    }
    // Confirmation required: stash the level, applied on first sign-in.
    try { localStorage.setItem('el_pending_level', JSON.stringify({ email: email, level: chosenLevel, ref: getRefCode() || null })); } catch (e) {}
    state.afterSignup = email;
    state.showConfirmPopup = email;
    go('signin');
  } catch (e) {
    authError('su', (e && e.message) || 'Sign up failed.');
    setAuthBusy('su', false, 'Create account');
  }
}

async function enterApp() {
  const { data } = await sb.auth.getUser();
  const u = data.user;
  if (!u) { go('landing'); return; }
  let level = null;
  let prof = null;
  try {
    const res = await sb.from('profiles').select('level,display_name,country_code,country,country_source,welcome_seen_at').eq('id', u.id).single();
    if (res.error) throw res.error;
    prof = res.data || null;
  } catch (e) {
    // Pre-migration fallback: the new columns may not exist yet.
    try {
      const res2 = await sb.from('profiles').select('level').eq('id', u.id).single();
      prof = (res2 && res2.data) || null;
    } catch (e2) { /* RLS or missing row -> treat as pending */ }
  }
  if (prof) level = prof.level;
  if (!level) {
    // Level chosen at signup (confirmation flow): apply it now.
    try {
      const raw = localStorage.getItem('el_pending_level');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.email === u.email && p.level) {
          await sb.from('profiles').upsert({ id: u.id, email: u.email, level: p.level }, { onConflict: 'id' });
          try { if (p.ref) await sb.from('profiles').update({ referred_by: p.ref }).eq('id', u.id); } catch (e2) {}
          level = p.level;
          localStorage.removeItem('el_pending_level');
        }
      }
    } catch (e) {}
  }
  const isAdmin = (u.email || '').toLowerCase() === String(APP_CONFIG.ADMIN_EMAIL).toLowerCase();
  state.user = {
    id: u.id, email: u.email, level: level, isAdmin: isAdmin, demo: false,
    displayName: (prof && prof.display_name) || null,
    countryCode: (prof && prof.country_code) || null,
    country: (prof && prof.country) || null,
    countrySource: (prof && prof.country_source) || null,
    welcomeSeenAt: (prof && prof.welcome_seen_at) || null,
  };
  try { localStorage.setItem('el_last_user', u.email); } catch (e) {}
  identifyPushUser(u.id, u.email, normalizeLevel(level));
  await ensureCountrySaved();
  await migrateLocalToCloud();
  await flushPointsQueue();
  await refreshMyPoints();
  // Existing users without a nickname pick one now (blocking) — the
  // Challenge leaderboard needs a display name.
  if (!state.user.demo && !state.user.displayName) {
    await ensureNickname();
  }
  await afterLogin();
}

async function afterLogin() {
  if (!state.user.level && !state.user.isAdmin) { go('waiting'); return; }
  const level = normalizeLevel(state.user.level) || 'b2';
  state.lessons = await loadLessons(level);
  state.lesson = state.lessons[0] || null;
  go('home');
  maybeShowWelcome();
  // Push notification deep link -> newest lesson
  if (pendingDeepLink === 'latest') {
    pendingDeepLink = null;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('lesson');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    if (state.lessons.length) go('lesson', state.lessons[0].date);
  }
}

/* First-entry welcome popup: Persian for a1/a2 learners, English for b1+.
   Shown once per user (tracked in profiles.welcome_seen_at + a local backup). */
async function maybeShowWelcome() {
  const u = state.user;
  if (!u || u.demo || u.isAdmin || !u.level) return;
  if (u.welcomeSeenAt) return;
  try { if (localStorage.getItem('el_welcome_seen_' + u.id)) return; } catch (e) {}
  const lvl = normalizeLevel(u.level);
  const fa = (lvl === 'a1' || lvl === 'a2');
  showModal(
    fa
      ? '<div dir="rtl" lang="fa"><div class="modal-ico">🎉</div>' +
        '<h2>خوش اومدی!</h2>' +
        '<p>هر روز <b>ساعت ۷ صبح</b> به وقت خودت، درس جدیدت آماده‌ست.</p>' +
        '<p>فقط کافیه روزی حدود <b>۱۵ دقیقه</b> وقت بذاری — کلی کلمه، جمله و نکته جدید یاد می‌گیری.</p>' +
        '<button class="btn btn-block" data-action="modal-close">شروع کن</button></div>'
      : '<div class="modal-ico">🎉</div>' +
        '<h2>Welcome!</h2>' +
        '<p>Your new lesson is ready every day at <b>7:00 AM</b>, your time.</p>' +
        '<p>Just spend about <b>15 minutes</b> a day — you\u2019ll pick up loads of new words, sentences and tips.</p>' +
        '<button class="btn btn-block" data-action="modal-close">Let\u2019s start</button>',
    true
  );
  // Mark as seen (DB first, localStorage as backup so it never double-shows).
  const now = new Date().toISOString();
  u.welcomeSeenAt = now;
  try { localStorage.setItem('el_welcome_seen_' + u.id, '1'); } catch (e) {}
  try { if (sb) await sb.from('profiles').update({ welcome_seen_at: now }).eq('id', u.id); } catch (e) {}
}

async function doLogout() {
  if (!quizGuardOk()) return;
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  logoutPushUser();
  state.user = null; state.lessons = []; state.lesson = null;
  state.adminUsers = []; state.quiz = null; state.justSignedUp = false;
  try { localStorage.removeItem('el_last_user'); } catch (e) {}
  closeProfileMenu();
  go('landing');
}

/* Demo mode (no Supabase configured) */
const DEMO_USERS = [
  { id: 'demo-u1', email: 'sara@example.com', level: null, created_at: Date.now() - 86400000 },
  { id: 'demo-u2', email: 'reza@example.com', level: 'a1', created_at: Date.now() - 3 * 86400000 },
  { id: 'demo-u3', email: 'mina@example.com', level: 'b2', created_at: Date.now() - 5 * 86400000 }
];

async function demoLogin(asAdmin) {
  state.user = {
    id: 'demo-learner',
    email: asAdmin ? String(APP_CONFIG.ADMIN_EMAIL) : 'demo-learner@example.com',
    level: 'b2',
    displayName: 'Demo',
    isAdmin: !!asAdmin,
    demo: true
  };
  state.adminUsers = DEMO_USERS.map(function (u) { return Object.assign({}, u); });
  state.lessons = await loadLessons('b2');
  state.lesson = state.lessons[0] || null;
  go('home');
}

/* ---------------- waiting view (level pending) ---------------- */
function renderWaiting(v) {
  v.innerHTML =
  '<div class="card" style="max-width:520px;margin:2rem auto">' +
    '<h1>One last step 🎯</h1>' +
    (state.justSignedUp ? '<p class="form-note">✓ Your account is created.</p>' : '') +
    '<p>What\'s your English level? Pick the closest — your lessons start right away.</p>' +
    levelPickerHTML('wait-level') +
    '<div class="form-error" id="wait-error" role="alert"></div>' +
    '<button class="btn btn-block" data-action="save-level">Start learning</button>' +
    '<p class="muted" style="margin-top:0.8rem">Signed in as ' + esc(state.user.email) + '</p>' +
  '</div>';
}

async function saveWaitingLevel() {
  const el = document.querySelector('input[name="wait-level"]:checked');
  const errEl = document.getElementById('wait-error');
  if (!el) { if (errEl) errEl.textContent = 'Please pick your English level.'; return; }
  if (errEl) errEl.textContent = '';
  try {
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from('profiles').upsert({ id: u.user.id, email: u.user.email, level: el.value }, { onConflict: 'id' });
    if (error) throw error;
    state.user.level = el.value;
    state.justSignedUp = false;
    try { localStorage.removeItem('el_pending_level'); } catch (e) {}
    identifyPushUser(u.user.id, u.user.email, normalizeLevel(el.value));
    await afterLogin();
  } catch (e) { if (errEl) errEl.textContent = 'Couldn\'t save — check your connection and try again.'; }
}

async function checkLevel() {
  if (state.user.demo) { await afterLogin(); return; }
  try {
    const { data: u } = await sb.auth.getUser();
    const { data: prof } = await sb.from('profiles').select('level').eq('id', u.user.id).single();
    if (prof && prof.level) {
      state.user.level = prof.level;
      state.justSignedUp = false;
      await afterLogin();
    } else {
      show('waiting');
    }
  } catch (e) { show('waiting'); }
}

/* ---------------- HOME dashboard ---------------- */
function todayCardHTML(m) {
  const p = getDayProgress(m.date);
  const done = dayDoneCount(m.date);
  const pct = Math.round((done / STEPS.length) * 100);
  const ns = nextStep(m.date);
  const isToday = m.date === todayStr();

  const stepsHTML = STEPS.map(function (s, i) {
    const isDone = !!p[s];
    const isNext = !isDone && s === ns;
    const cls = isDone ? 'done' : (isNext ? 'next' : 'todo');
    const mark = isDone ? '✓' : String(i + 1);
    return '<li class="' + cls + '">' +
      '<button class="today-step-btn" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + s + '" aria-label="Go to ' + STEP_LABELS[s] + '">' +
      '<span class="st-ck" aria-hidden="true">' + mark + '</span>' +
      '<span class="st-name">' + STEP_LABELS[s] + '</span>' +
      (isNext ? '<span class="st-pill">CONTINUE</span>' : '') +
      '<span class="st-go" aria-hidden="true">›</span>' +
      '</button></li>';
  }).join('');

  let cta, ctaSub;
  if (ns) {
    const started = done > 0;
    cta = started ? 'Continue with ' + STEP_LABELS[ns] : 'Start today’s lesson';
    ctaSub = started ? 'Pick up where you left off.' : 'About 20 minutes, step by step.';
  } else {
    cta = 'Lesson complete 🎉';
    ctaSub = 'Nice work — come back tomorrow for a new lesson.';
  }
  const tabFor = ns || 'words';

  return '' +
  '<section class="card today-card" aria-labelledby="today-h">' +
    '<span class="hero-kicker" style="background:rgba(200,75,49,.1);color:var(--tomato-dark)">📅 Today’s lesson</span>' +
    '<div class="today-top">' +
      '<div>' +
        '<div class="hero-date">' + esc(m.date) + (isToday ? ' · <b>Today</b>' : ' · Latest lesson') + '</div>' +
        '<h2 class="today-theme" id="today-h">' + esc(m.theme || 'Daily lesson') + '</h2>' +
        '<span class="badge-level">' + esc(levelLabel(normalizeLevel(m.level))) + '</span>' +
      '</div>' +
    '</div>' +
    '<ul class="today-steps" aria-label="Lesson steps">' + stepsHTML + '</ul>' +
    '<div class="today-progress">' +
      '<div class="tp-label"><span>Daily progress</span><span>' + done + ' of ' + STEPS.length + ' steps</span></div>' +
      '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Daily progress"><div style="width:' + pct + '%"></div></div>' +
    '</div>' +
    '<button class="btn btn-block" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + tabFor + '">' + esc(cta) + '</button>' +
    '<p class="muted" style="margin:0.5rem 0 0;text-align:center">' + esc(ctaSub) + '</p>' +
  '</section>';
}

/* ---------------- lessons archive (previous days) ---------------- */
function lessonCover(m) {
  const w = (m.words && m.words[0]) || {};
  return w.photo || '';
}
function fmtDateShort(ds) {
  try {
    const p = String(ds).split('-');
    const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return ds; }
}
function lessonWordCount(m) { return (m.words && m.words.length) || 0; }

function prevLessonsHTML(lessons) {
  const older = lessons.slice(1, 7);
  let html = '<section aria-labelledby="prev-h">' +
    '<div class="section-title"><h2 id="prev-h">Previous lessons</h2>' +
    (older.length ? '<a class="btn btn-ghost btn-sm" href="#/lessons">View all</a>' : '') + '</div>';
  if (!older.length) {
    html += '<div class="card plain"><p class="muted" style="margin:0">Yesterday’s lesson will appear here — come back tomorrow for a new one.</p></div>';
  } else {
    html += '<div class="prev-strip">' + older.map(function (m) {
      const cover = lessonCover(m);
      return '<button class="prev-card" data-action="open-lesson" data-date="' + esc(m.date) + '" aria-label="Open lesson ' + esc(m.theme || m.date) + '">' +
        (cover
          ? '<img src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
          : '<div class="prev-ph" aria-hidden="true">📚</div>') +
        '<div class="pc-body"><div class="pc-date">' + esc(fmtDateShort(m.date)) + '</div>' +
        '<div class="pc-theme">' + esc(m.theme || 'Lesson') + '</div></div></button>';
    }).join('') + '</div>';
  }
  return html + '</section>';
}

function archiveCardHTML(m) {
  const cover = lessonCover(m);
  const done = dayDoneCount(m.date);
  const pct = Math.round((done / STEPS.length) * 100);
  return '<button class="archive-card" data-action="open-lesson" data-date="' + esc(m.date) + '" aria-label="Open lesson ' + esc(m.theme || m.date) + '">' +
    (cover
      ? '<img class="ac-photo" src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<div class="ac-photo ac-ph" aria-hidden="true">📚</div>') +
    '<div class="ac-body">' +
      '<div class="ac-date">' + esc(fmtDateShort(m.date)) + ' · ' + esc(m.date) + '</div>' +
      '<div class="ac-theme">' + esc(m.theme || 'Lesson') + '</div>' +
      '<div class="ac-meta">' + esc(levelLabel(normalizeLevel(m.level))) + ' · ' + lessonWordCount(m) + ' words</div>' +
      '<div class="progress" role="progressbar" aria-label="Lesson progress" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + STEPS.length + '"><div style="width:' + pct + '%"></div></div>' +
      '<div class="ac-steps">' + done + ' of ' + STEPS.length + ' steps</div>' +
    '</div>' +
    '<div class="ac-chev" aria-hidden="true">›</div>' +
  '</button>';
}

function renderLessons(v) {
  const lessons = state.lessons;
  let html = '<div class="archive-head"><h1>Past lessons</h1>' +
    '<p class="muted" style="margin:.2rem 0 0">' + lessons.length + (lessons.length === 1 ? ' lesson' : ' lessons') + ' · ' + esc(levelLabel(normalizeLevel(state.user.level))) + '</p></div>';
  if (!lessons.length) {
    html += '<div class="empty">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += '<div class="archive-list">' + lessons.map(archiveCardHTML).join('') + '</div>';
  }
  v.innerHTML = html;
}

async function renderHome(v) {
  const lessons = state.lessons;
  const today = lessons[0] || null;
  const mistakes = await getMistakes();
  const attempts = await getAttempts();

  let html = '';

  // 1 — Today's lesson (the primary action)
  if (!today) {
    html += '<div class="empty">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += todayCardHTML(today);
  }

  // 1b — Previous lessons (days before today) → archive page
  html += prevLessonsHTML(lessons);

  // 2 — Review (mistakes), learner-facing label "Review"
  const todayMistakes = today ? mistakes.filter(function (x) { return x.date === today.date; }) : [];
  html += '<div class="section-title"><h2>Review</h2>' +
    (mistakes.length ? '<a class="btn btn-ghost btn-sm" href="#/review">View all</a>' : '') + '</div>';
  if (!mistakes.length) {
    html += '<div class="card plain"><p class="muted" style="margin:0">Nothing to review yet — wrong answers will appear here so you can practice them again.</p></div>';
  } else {
    html += '<div class="card"><div class="stat-row">' +
      '<div class="stat-num">' + mistakes.length + '</div>' +
      '<div><b>to review</b><div class="stat-example">e.g. “' + esc(mistakes[0].question.slice(0, 90)) + '”</div></div>' +
      '</div>' +
      (todayMistakes.length
        ? '<button class="btn btn-green btn-block" data-action="review-today" data-date="' + esc(today.date) + '">Review today’s mistakes</button>'
        : '<button class="btn btn-green btn-block" data-action="practice-again">Practice mistakes</button>') +
      '</div>';
  }

  // 3 — Progress: most recent meaningful activity, compact empty state
  html += '<div class="section-title"><h2>Progress</h2>' +
    (attempts.length ? '<a class="btn btn-ghost btn-sm" href="#/scores">View all</a>' : '') + '</div>';
  if (!attempts.length) {
    html += '<div class="card plain"><p class="muted" style="margin:0">No activity yet — finish a quiz and your latest result will show up here.</p></div>';
  } else {
    const a = attempts[0];
    const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
    const kindLabel = a.kind === 'grammar' ? 'Grammar quiz' : (a.kind === 'mistakes' ? 'Review session' : 'Word quiz');
    html += '<div class="card plain"><div class="attempt-card">' +
      '<div class="attempt-info">' +
        '<div class="attempt-theme">' + esc(a.theme || 'Lesson') + '</div>' +
        '<div class="attempt-meta">Latest · ' + esc(kindLabel) + ' · ' + esc(a.date || '') + '</div>' +
      '</div>' +
      '<div class="percent-wrap"><div class="percent-num">' + a.score + '/' + a.total + ' · ' + pct + '%</div>' +
      '<div class="progress"><div style="width:' + pct + '%"></div></div></div>' +
    '</div></div>';
  }

  // 4 — Notifications: only after meaningful engagement (first quiz done), never automatic
  if (oneSignalReady() && !state.user.demo && !pushSubscribed() && hasAnyQuizDone()) {
    html += '<div class="card plain"><b>🔔 Lesson notifications</b>' +
      '<p class="muted">You’re on a roll — get a short notification when each new lesson is ready.</p>' +
      '<p class="muted" id="push-status" role="status"></p>' +
      '<button class="btn btn-sm" data-action="enable-push">Enable notifications</button></div>';
  }

  v.innerHTML = html;
}

function attemptCardHTML(a) {
  const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
  const kindLabel = a.kind === 'grammar' ? 'Grammar quiz' : (a.kind === 'mistakes' ? 'Review session' : 'Word quiz');
  return '' +
  '<div class="card plain"><div class="attempt-card">' +
    '<div class="attempt-info">' +
      '<div class="attempt-theme">' + esc(a.theme || 'Lesson') + '</div>' +
      '<div class="attempt-meta">' + esc(kindLabel) + ' · ' + esc(a.date || '') + ' · ' + esc(fmtDateTime(a.ts)) + '</div>' +
    '</div>' +
    '<div class="percent-wrap"><div class="percent-num">' + a.score + '/' + a.total + '</div>' +
    '<div class="progress"><div style="width:' + pct + '%"></div></div></div>' +
  '</div></div>';
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

  '<div class="section-title"><h2>Account</h2></div>' +
  '<div class="card plain"><button class="btn btn-ghost btn-block" data-action="logout" style="margin-top:0">Log out</button></div>';
}

async function saveCountryManual() {
  const sel = document.getElementById('pf-country');
  const u = state.user;
  if (!sel || !u || u.demo || !sb) return;
  const code = sel.value;
  const name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : code;
  u.countryCode = code; u.country = name; u.countrySource = 'manual';
  try {
    await sb.from('profiles').upsert({
      id: u.id, email: u.email, level: u.level || null,
      country_code: code, country: name,
      country_source: 'manual', country_detected_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  } catch (e) { /* pre-migration or offline -> kept locally, retried later */ }
  renderProfile(document.getElementById('view'));
}

/* ---------------- SUPPORT (AI chat + Telegram fallback) ---------------- */
const SUPPORT_QUICK = [
  'How do the daily lessons work?',
  "I can't hear the podcast",
  'How do I change my level?',
  'How do I enable notifications?'
];
const SUPPORT_TELEGRAM = 'https://t.me/alirezaaaatehrani';
let supportLog = [];
let supportBusy = false;

function renderSupport(v) {
  supportLog = [];
  supportBusy = false;
  v.innerHTML =
  '<h1>Support</h1>' +
  '<p class="muted">Ask Muse\u2019s assistant anything about the app \u2014 lessons, quizzes, scores, audio and more.</p>' +
  '<div class="card plain support-card">' +
    '<div id="support-msgs" class="support-msgs" aria-live="polite"></div>' +
    '<div class="support-chips">' + SUPPORT_QUICK.map(function (q) {
      return '<button class="chip" data-support-q="' + esc(q) + '">' + esc(q) + '</button>';
    }).join('') + '</div>' +
    '<div class="support-input-row">' +
      '<input id="support-input" class="support-input" type="text" placeholder="Type your question\u2026" autocomplete="off" maxlength="500" aria-label="Your question">' +
      '<button id="support-send" class="btn" aria-label="Send message">\u27a4</button>' +
    '</div>' +
  '</div>' +
  '<div class="card mist support-tg">' +
    '<div><b>Still stuck?</b><div class="muted">Chat with us directly on Telegram \u2014 we usually reply fast.</div></div>' +
    '<a class="btn" href="' + SUPPORT_TELEGRAM + '" target="_blank" rel="noopener">\uD83D\uDCAC Open Telegram</a>' +
  '</div>';
  supportAddMsg('ai', "Hi! I'm Muse's assistant. Ask me anything about your lessons, quizzes, scores or the app itself. \uD83D\uDE42", false);
  $('#support-send').addEventListener('click', supportSend);
  $('#support-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') supportSend(); });
  Array.prototype.forEach.call(v.querySelectorAll('[data-support-q]'), function (b) {
    b.addEventListener('click', function () { supportAsk(b.getAttribute('data-support-q')); });
  });
}

function supportAddMsg(who, text, save) {
  const box = $('#support-msgs');
  if (!box) return null;
  const div = document.createElement('div');
  div.className = 'support-msg ' + (who === 'user' ? 'from-user' : 'from-ai');
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  if (save !== false) supportLog.push({ role: who === 'user' ? 'user' : 'assistant', content: text.slice(0, 1000) });
  return div;
}

function supportSend() {
  const input = $('#support-input');
  supportAsk(input ? input.value : '');
}

function supportAsk(text) {
  if (supportBusy) return;
  text = (text || '').trim();
  if (!text) return;
  supportAddMsg('user', text);
  const input = $('#support-input');
  if (input) input.value = '';
  supportBusy = true;
  const typing = supportAddMsg('ai', '\u2026', false);
  if (typing) typing.classList.add('typing');
  const payload = { messages: supportLog.slice(-12) };
  if (state.user && state.user.level) payload.level = normalizeLevel(state.user.level);
  fetch('/api/support-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; }, function () { return { ok: false, d: null }; });
  }).then(function (res) {
    if (typing) typing.remove();
    supportBusy = false;
    if (res.ok && res.d && res.d.reply) supportAddMsg('ai', res.d.reply);
    else supportAddMsg('ai', "Hmm, I couldn't reach the assistant just now. Try again in a bit \u2014 or tap Open Telegram below and we'll help you directly. \uD83D\uDE42", false);
  }).catch(function () {
    if (typing) typing.remove();
    supportBusy = false;
    supportAddMsg('ai', "You're offline or the assistant is unreachable. Check your connection \u2014 or tap Open Telegram below and we'll help you directly. \uD83D\uDE42", false);
  });
}

/* ---------------- lesson view ---------------- */
function lessonTabsHTML() {
  const tabs = [
    ['words', 'Words'],
    ['podcast', 'Podcast'],
    ['shadowing', 'Shadowing'],
    ['quiz', 'Quiz'],
    ['grammar', 'Grammar']
  ];
  return '<div class="lesson-tabs" role="tablist" aria-label="Lesson sections">' + tabs.map(function (t) {
    return '<button class="lesson-tab" role="tab" aria-selected="' + (state.lessonTab === t[0]) + '" data-action="lesson-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
  }).join('') + '</div>';
}

function renderLesson(v, dateStr) {
  if (dateStr) {
    const found = state.lessons.find(function (m) { return m.date === dateStr; });
    if (found) state.lesson = found;
  }
  const m = state.lesson;
  if (!m) { v.innerHTML = '<div class="empty">No lesson available.</div>'; return; }
  if (m.date) awardPoints('lesson_open', 5, m.date);

  let html = '<div class="hero-date">' + esc(m.date) + (m.date === todayStr() ? ' · <b>Today</b>' : '') + '</div>' +
    '<h1 style="text-transform:capitalize">' + esc(m.theme || 'Daily lesson') + '</h1>' +
    '<p><span class="badge-level">' + esc(levelLabel(normalizeLevel(m.level))) + '</span></p>' +
    lessonTabsHTML() + '<div id="lesson-body"></div>';
  v.innerHTML = html;
  renderLessonTab($('#lesson-body'));
}

function renderLessonTab(body) {
  const m = state.lesson;
  const tab = state.lessonTab;
  if (m && m.date) {
    if (tab === 'words') markStep(m.date, 'words');
    else if (tab === 'podcast') markStep(m.date, 'podcast');
    else if (tab === 'shadowing') markStep(m.date, 'shadowing');
    else if (tab === 'grammar') markStep(m.date, 'grammar');
  }
  if (tab === 'words') { body.innerHTML = wordsTabHTML(m); observeWordsEnd(body, m); }
  else if (tab === 'podcast') { body.innerHTML = podcastTabHTML(m); wireAudioCards(body); warmPodcast(m); }
  else if (tab === 'shadowing') { body.innerHTML = shadowingTabHTML(m); wireAudioCards(body); }
  else if (tab === 'quiz') body.innerHTML = quizTabHTML(m);
  else if (tab === 'grammar') { body.innerHTML = grammarTabHTML(m); wireAudioCards(body); }
  refreshTrackCards();
  centerActiveLessonTab();
}

/* Keep the selected lesson tab visible: scroll the tab strip (not the page)
   so the active tab sits in view. */
function centerActiveLessonTab() {
  const strip = $('.lesson-tabs');
  const active = strip && strip.querySelector('.lesson-tab[aria-selected="true"]');
  if (!strip || !active) return;
  const sr = strip.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  const target = strip.scrollLeft + (ar.left - sr.left) - (strip.clientWidth - ar.width) / 2;
  if (Math.abs(strip.scrollLeft - target) > 4) {
    strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }
}

function wordsTabHTML(m) {
  return (m.words || []).map(function (w) {
    return '' +
    '<div class="card plain word-card">' +
      (w.photo
        ? '<img class="word-photo" src="' + esc(w.photo) + '" alt="' + esc(w.word) + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
          '<div class="word-photo-fallback" style="display:none">🖼️</div>'
        : '<div class="word-photo-fallback">🖼️</div>') +
      '<div class="word-head"><h3 class="word-title">' + esc(w.word) + '</h3>' +
        (w.word_audio
          ? '<button class="speaker-btn" data-action="play-track" data-src="' + esc(w.word_audio) + '" data-title="' + esc(w.word) + '" aria-label="Hear pronunciation of ' + esc(w.word) + '">🔊</button>'
          : '') +
      '</div>' +
      (w.pos ? '<div class="word-pos">' + esc(w.pos) + '</div>' : '') +
      (w.pronunciation ? '<div class="word-pron">/' + esc(w.pronunciation) + '/</div>' : '') +
      (w.meaning ? '<div class="word-meaning">' + esc(w.meaning) + '</div>' : '') +
      (w.example ? '<div class="word-example">"' + esc(w.example) + '"</div>' : '') +
      (w.persian ? '<div class="word-fa" dir="auto">' + esc(w.persian) + '</div>' : '') +
    '</div>';
  }).join('') || '<div class="empty">No words in this lesson.</div>';
}

function podcastTabHTML(m) {
  let html = '';
  if (m.podcast && m.podcast.audio) {
    html += audioCardHTML({
      id: 'card-podcast', src: m.podcast.audio,
      title: m.podcast.title || 'Word Kitchen',
      sub: 'Podcast episode', cover: m.podcast.cover,
      speeds: false, download: true, transcript: m.podcast.transcript || null
    });
  }
  if (m.pronunciation_audio) {
    html += audioCardHTML({
      id: 'card-pron', src: m.pronunciation_audio,
      title: 'Pronunciation — words with examples',
      sub: 'All ' + (m.words || []).length + ' words read aloud',
      speeds: false, download: true
    });
  }
  if (!html) html = '<div class="empty">No audio in this lesson yet.</div>';
  return html;
}

function shadowingTabHTML(m) {
  if (!m.shadowing || !m.shadowing.audio) return '<div class="empty">No shadowing story for this lesson.</div>';
  return '<div class="card plain"><h3 class="serif">' + esc(m.shadowing.title || 'Shadowing story') + '</h3>' +
    '<p class="muted">Listen first, then speak along. Each sentence is read twice.</p></div>' +
    audioCardHTML({
      id: 'card-shadow', src: m.shadowing.audio,
      title: m.shadowing.title || 'Shadowing story',
      sub: 'Read twice · adjust speed below',
      speeds: true, download: true, transcript: m.shadowing.transcript || null
    });
}

function quizTabHTML(m) {
  const n = (m.quiz || []).length;
  if (!n) return '<div class="empty">No quiz for this lesson.</div>';
  return '<div class="card"><h3>📝 Word quiz</h3>' +
    '<p class="muted">' + n + ' questions on today\'s words. One at a time, instant feedback — wrong answers go straight to Review.</p>' +
    '<button class="btn btn-block" data-action="quiz-start" data-kind="word">Start quiz</button></div>';
}

function grammarTabHTML(m) {
  const g = m.grammar;
  if (!g) return '<div class="empty">No grammar lesson for this date.</div>';
  const paras = String(g.explanation || '').split(/\n\s*\n/).map(function (p, i) {
    const html = esc(p).replace(/\*\*(.+?)\*\*/g, '<strong class="hl">$1</strong>');
    return '<div class="rule-card"><span class="rule-num">' + (i + 1) + '</span><p>' + html + '</p></div>';
  }).join('');
  const examples = (g.examples || []).map(function (e) {
    let text = String(e), note = '';
    const mm = text.match(/\(([^()]*)\)\s*$/);
    if (mm) { note = mm[1]; text = text.slice(0, mm.index).trim(); }
    const html = esc(text).replace(/\*(.+?)\*/g, '<em class="ex-em">$1</em>');
    return '<div class="example-card"><span class="ex-quote">&ldquo;</span>' +
      '<p class="ex-text">' + html + '</p>' +
      (note ? '<span class="ex-note">' + esc(note) + '</span>' : '') + '</div>';
  }).join('');
  const practice = (g.practice || []).map(function (p) {
    return '<details class="practice"><summary>' + esc(p.q) + '</summary><p>' + esc(p.a) + '</p></details>';
  }).join('');
  const quizBtn = (g.quiz && g.quiz.length)
    ? '<div class="quiz-cta"><p class="quiz-cta-text">Ready to test yourself?</p>' +
      '<button class="btn btn-block" data-action="quiz-start" data-kind="grammar">Start grammar quiz · ' + g.quiz.length + ' questions</button></div>'
    : '';
  const enAudio = (normalizeLevel(m.level) === 'a1' || normalizeLevel(m.level) === 'a2') && g.audio
    ? audioCardHTML({ id: 'grammar-en-' + m.date, src: g.audio,
        title: '🎧 Grammar explained simply', sub: 'Slow and easy English', speeds: true, download: true })
    : '';
  return '<div class="grammar-page"><div class="grammar-hero"><span class="hero-kicker">📖 Grammar of the day</span>' +
    '<h2 class="hero-title">' + esc(g.title || 'Grammar') + '</h2>' +
    '<span class="hero-badge">' + esc(levelLabel(normalizeLevel(m.level))) + '</span></div>' +
    enAudio +
    (paras ? '<div class="section-kicker">The rules</div>' + paras : '') +
    (examples ? '<div class="section-kicker">Examples</div>' + examples : '') +
    (practice ? '<div class="section-kicker">Quick practice</div>' + practice : '') +
    quizBtn + '</div>';
}

/* ---------------- quiz engine ---------------- */
async function startQuiz(kind, dateStr) {
  let m = state.lesson;
  if (dateStr) {
    const found = state.lessons.find(function (x) { return x.date === dateStr; });
    if (found) { m = found; state.lesson = found; }
  }
  let questions = [];
  if (kind === 'word') {
    questions = (m.quiz || []).map(function (q) {
      return { question: q.question, options: q.options, answer: q.answer, kind: 'word' };
    });
  } else if (kind === 'grammar') {
    questions = ((m.grammar && m.grammar.quiz) || []).map(function (q) {
      return { question: q.question, options: q.options, answer: q.answer, kind: 'grammar' };
    });
  } else if (kind === 'mistakes') {
    let arr = await getMistakes();
    if (dateStr) arr = arr.filter(function (x) { return x.date === dateStr; });
    questions = arr.map(function (mk) {
      return { question: mk.question, options: mk.options, answer: mk.answer, kind: mk.kind || 'word', mistakeId: mk.id };
    });
  }
  if (!questions.length) return;
  state.quiz = {
    kind: kind, questions: questions, idx: 0, correct: 0,
    answered: false, picked: -1,
    date: m.date, level: m.level, theme: m.theme
  };
  renderQuizView();
}

function renderQuizView() {
  const q = state.quiz;
  const v = $('#view');
  const cur = q.questions[q.idx];
  const total = q.questions.length;
  let html = '<div class="quiz-progress">Question ' + (q.idx + 1) + ' of ' + total +
    (q.kind === 'mistakes' ? ' · reviewing' : '') + '</div>' +
    '<div class="card"><div class="quiz-q">' + esc(cur.question) + '</div><div id="quiz-opts">' +
    cur.options.map(function (opt, i) {
      let cls = 'opt-btn';
      if (q.answered) {
        if (i === cur.answer) cls += ' correct';
        else if (i === q.picked) cls += ' wrong';
        else cls += ' dim';
      }
      return '<button class="' + cls + '" data-action="quiz-opt" data-idx="' + i + '"' +
        (q.answered ? ' disabled' : '') + '>' + esc(opt) + '</button>';
    }).join('') + '</div>';

  if (q.answered) {
    const good = q.picked === cur.answer;
    html += '<div class="quiz-feedback ' + (good ? 'good' : 'bad') + '" role="status">' +
      (good ? '✅ Correct!' : '❌ Not quite — the correct answer is: <b>' + esc(cur.options[cur.answer]) + '</b>') +
      '</div>' +
      '<button class="btn btn-block" data-action="quiz-next">' +
      (q.idx + 1 < total ? 'Next question →' : 'See my score →') + '</button>';
  }
  html += '</div>';
  v.innerHTML = html;
  window.scrollTo(0, 0);
}

function answerQuiz(idx) {
  const q = state.quiz;
  if (!q || q.answered) return;
  q.answered = true;
  q.picked = idx;
  const cur = q.questions[q.idx];
  if (idx === cur.answer) {
    q.correct++;
    if (q.kind === 'mistakes' && cur.mistakeId) removeMistake(cur.mistakeId);
  } else if (q.kind !== 'mistakes') {
    saveMistake({
      date: q.date, level: q.level, kind: cur.kind,
      question: cur.question, options: cur.options,
      answer: cur.answer, picked: idx
    });
  }
  renderQuizView();
}

function nextQuiz() {
  const q = state.quiz;
  if (q.idx + 1 < q.questions.length) {
    q.idx++; q.answered = false; q.picked = -1;
    renderQuizView();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  const q = state.quiz;
  const total = q.questions.length;
  const pct = Math.round((q.correct / total) * 100);
  saveAttempt({
    date: q.date, level: q.level, theme: q.theme,
    kind: q.kind, score: q.correct, total: total
  });
  if (q.kind === 'word' && q.date) {
    markStep(q.date, 'quiz', { score: q.correct, total: total });
    awardPoints('word_quiz', 10 + q.correct, q.date);
  } else if (q.kind === 'grammar' && q.date) {
    awardPoints('grammar_quiz', 10, q.date);
  } else if (q.kind === 'mistakes') {
    awardPoints('deck_review', 10, q.date || todayStr());
  }
  state.quiz = null;
  $('#view').innerHTML =
  '<div class="card"><div class="score-hero">' +
    '<div class="score-big">' + q.correct + '/' + total + '</div>' +
    '<div class="score-sub">' + pct + '% · ' +
    (pct >= 85 ? 'Excellent work! 🌟' : pct >= 60 ? 'Good — keep practicing! 💪' : 'Keep going — review your mistakes below. 📚') +
    '</div></div>' +
    '<div class="btn-row">' +
      '<a class="btn" href="#/home">Home</a>' +
      '<a class="btn btn-ghost" href="#/review">Review</a>' +
    '</div></div>';
  window.scrollTo(0, 0);
}

/* ---------------- scores view (Progress) ---------------- */
async function renderScores(v) {
  const arr = await getAttempts();
  const avg = await getOverallAverage();
  let html = '<h1>Progress</h1>';
  if (avg === null) {
    html += '<div class="empty">No quiz attempts yet.<br>Finish a quiz and your scores will appear here.</div>';
  } else {
    html += '<div class="card avg-card"><div class="avg-num">' + avg + '%</div><div class="muted">overall average · ' + arr.length + ' attempts</div></div>';
    html += arr.map(attemptCardHTML).join('');
  }
  v.innerHTML = html;
}

/* ---------------- review view (mistakes) ---------------- */
async function renderMistakes(v) {
  const arr = await getMistakes();
  let html = '<h1>Review</h1><p class="muted">Words you missed, ready to practice again. Get one right and it leaves the list.</p>';
  if (!arr.length) {
    html += '<div class="empty">Nothing to review — nice work! 🎉</div>';
  } else {
    html += '<div class="card plain"><b>' + arr.length + ' to review</b>' +
      '<button class="btn btn-green btn-block" data-action="practice-again">Practice mistakes</button></div>';
    html += arr.map(function (m) {
      return '<div class="card plain">' +
        '<div class="mistake-q">' + esc(m.question) + '</div>' +
        '<div class="mistake-a">✅ ' + esc(m.options[m.answer]) + '</div>' +
        (typeof m.picked === 'number' && m.picked !== m.answer
          ? '<div class="mistake-was">You chose: ' + esc(m.options[m.picked]) + '</div>' : '') +
        '<div class="muted" style="margin-top:0.4rem;font-size:0.78rem">' + esc(m.date || '') + ' · ' + esc(m.kind || 'word') + ' quiz</div>' +
      '</div>';
    }).join('');
  }
  v.innerHTML = html;
}

/* ---------------- admin view ---------------- */
function renderAdmin(v) {
  v.innerHTML = '<h1>Admin</h1><div class="card plain"><p class="muted" style="margin:0">Set each user\'s level. New users appear as <b>pending</b> first.</p></div><div id="admin-list"><div class="empty">Loading…</div></div>';
  loadAdminUsers();
}

async function loadAdminUsers() {
  const list = $('#admin-list');
  try {
    if (state.user.demo) {
      state.adminUsers = state.adminUsers.length ? state.adminUsers : DEMO_USERS.map(function (u) { return Object.assign({}, u); });
    } else if (sb) {
      const { data, error } = await sb.from('profiles').select('id,email,level,created_at,referred_by').order('created_at', { ascending: true });
      if (error) throw error;
      state.adminUsers = data || [];
    }
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty">Could not load users: ' + esc(e.message || e) + '</div>';
    return;
  }
  if (!list) return;
  const users = state.adminUsers.slice().sort(function (a, b) {
    const ap = a.level ? 1 : 0, bp = b.level ? 1 : 0;
    return ap - bp;
  });
  const refCounts = {};
  users.forEach(function (u) { if (u.referred_by) refCounts[u.referred_by] = (refCounts[u.referred_by] || 0) + 1; });
  const refKeys = Object.keys(refCounts);
  const refSummary = refKeys.length
    ? '<div class="card plain"><p class="muted" style="margin:0">📣 Referrals: ' +
      refKeys.map(function (k) { return '📣 ' + esc(k) + ': <b>' + refCounts[k] + '</b>'; }).join(' &nbsp;·&nbsp; ') + '</p></div>'
    : '';
  list.innerHTML = refSummary + '<div class="card">' + (users.length ? users.map(function (u) {
    const pending = !u.level;
    return '<div class="user-row">' +
      '<div class="user-info">' +
        '<div class="user-email">' + esc(u.email) + (pending ? '<span class="pending-tag">PENDING</span>' : '') + (u.referred_by ? '<span class="ref-tag">📣 ' + esc(u.referred_by) + '</span>' : '') + '</div>' +
        '<div class="user-date">joined ' + esc(String(u.created_at || '').slice(0, 10)) + '</div>' +
      '</div>' +
      '<select class="level-select" data-user-id="' + esc(u.id) + '" aria-label="Set level for ' + esc(u.email) + '">' +
        '<option value="">— set level —</option>' +
        LEVELS.map(function (lv) {
          return '<option value="' + lv + '"' + (normalizeLevel(u.level) === lv ? ' selected' : '') + '>' + levelLabel(lv) + '</option>';
        }).join('') +
      '</select>' +
    '</div>';
  }).join('') : '<div class="empty">No users yet.</div>') + '</div>';
}

async function setUserLevel(id, level) {
  if (!level) return;
  try {
    if (state.user.demo) {
      const u = state.adminUsers.find(function (x) { return String(x.id) === String(id); });
      if (u) u.level = level;
    } else if (sb) {
      const { error } = await sb.from('profiles').update({ level: level }).eq('id', id);
      if (error) throw error;
    }
    await loadAdminUsers();
  } catch (e) {
    alert('Could not update level: ' + (e.message || e));
    await loadAdminUsers();
  }
}

/* ---------------- events (delegation) ---------------- */
function bindEvents() {
  // Global guard: direct hash links (profile dropdown, score screens, …)
  // bypass go(), so confirm here before an in-progress quiz is discarded.
  document.addEventListener('click', function (e) {
    if (!state.quiz) return;
    const a = e.target.closest('a[href^="#/"]');
    if (a && a.getAttribute('href') !== window.location.hash && !quizGuardOk()) {
      e.preventDefault();
    }
  }, true);

  $('#view').addEventListener('click', async function (e) {
    const t = e.target.closest('[data-action]');
    // Landing preview tabs (not data-action based)
    const ptab = e.target.closest('[data-ptab]');
    if (ptab) { renderPreviewTab(ptab.getAttribute('data-ptab'), state.previewLesson); return; }
    if (!t) return;
    const a = t.getAttribute('data-action');

    if (a === 'demo-learner') demoLogin(false);
    else if (a === 'demo-admin') demoLogin(true);
    else if (a === 'pw-toggle') togglePw(t);
    else if (a === 'skip-back') { const card = t.closest('[data-audio-card]'); if (card) skipCard(card, -10); }
    else if (a === 'skip-fwd') { const card = t.closest('[data-audio-card]'); if (card) skipCard(card, 10); }
    else if (a === 'check-level') checkLevel();
    else if (a === 'save-level') saveWaitingLevel();
    else if (a === 'save-country') saveCountryManual();
    else if (a === 'logout') doLogout();
    else if (a === 'open-lesson') { state.lessonTab = 'words'; go('lesson', t.getAttribute('data-date')); }
    else if (a === 'today-cta') {
      const d = t.getAttribute('data-date');
      state.lessonTab = t.getAttribute('data-tab') || 'words';
      go('lesson', d);
    }
    else if (a === 'lesson-tab') {
      if (!quizGuardOk()) return;
      state.lessonTab = t.getAttribute('data-tab');
      $$('.lesson-tab').forEach(function (b) {
        const sel = b.getAttribute('data-tab') === state.lessonTab;
        b.setAttribute('aria-selected', String(sel));
      });
      renderLessonTab($('#lesson-body'));
    }
    else if (a === 'play-track') playTrack(t.getAttribute('data-src'), t.getAttribute('data-title'));
    else if (a === 'toggle-transcript') {
      toggleTranscript(t);
      t.setAttribute('aria-expanded', String(!t.closest('[data-audio-card]').querySelector('.transcript-panel').classList.contains('hidden')));
    }
    else if (a === 'speed') { player.el.playbackRate = parseFloat(t.getAttribute('data-rate')); refreshTrackCards(); }
    else if (a === 'quiz-start') startQuiz(t.getAttribute('data-kind'));
    else if (a === 'quiz-opt') answerQuiz(parseInt(t.getAttribute('data-idx'), 10));
    else if (a === 'quiz-next') nextQuiz();
    else if (a === 'practice-again') {
      getMistakes().then(function (arr) {
        if (arr.length) startQuiz('mistakes');
        else go('review');
      });
    }
    else if (a === 'review-today') {
      const d = t.getAttribute('data-date');
      getMistakes().then(function (arr) {
        if (arr.some(function (x) { return x.date === d; })) startQuiz('mistakes', d);
        else go('review');
      });
    }
    else if (a === 'enable-push') promptPush(t);
    else if (a === 'ch-period') { state.challengePeriod = t.getAttribute('data-p'); renderChallenge($('#view')); }
    else if (a === 'choose-nickname') {
      ensureNickname().then(function () { if (state.view === 'challenge') renderChallenge($('#view')); });
    }
  });

  $('#view').addEventListener('change', function (e) {
    const t = e.target.closest('[data-user-id]');
    if (t) setUserLevel(t.getAttribute('data-user-id'), t.value);
  });

  $('#view').addEventListener('submit', function (e) {
    if (e.target.id === 'form-signin') { e.preventDefault(); doLogin(); }
    else if (e.target.id === 'form-signup') { e.preventDefault(); doSignup(); }
  });

  // Tabbar: quiz guard before navigating away
  $$('#tabbar .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      const tv = t.getAttribute('data-view');
      if (tv === 'lesson') {
        if (!quizGuardOk()) return;
        state.lessonTab = 'words';
        if (state.lessons.length) go('lesson', state.lessons[0].date);
        else go('home');
      } else {
        go(tv);
      }
    });
  });

  $('#btn-profile').addEventListener('click', function (e) {
    e.stopPropagation();
    toggleProfileMenu();
  });
  document.addEventListener('click', function (e) {
    const dd = $('#profile-dropdown');
    if (dd && !dd.classList.contains('hidden') && !e.target.closest('.profile-menu')) closeProfileMenu();
  });
  // Modal popups live on document.body (outside #view), so they need their own handler.
  document.addEventListener('click', function (e) {
    const t = e.target.closest('#app-modal [data-action]');
    if (!t) return;
    if (t.getAttribute('data-action') === 'modal-close') closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeProfileMenu();
  });
  $('#btn-logout').addEventListener('click', doLogout);
  $('#mp-toggle').addEventListener('click', function () {
    if (!player.src) return;
    if (player.el.paused) player.el.play().catch(function () {});
    else player.el.pause();
  });

  window.addEventListener('hashchange', onRoute);
}

/* ---------------- init ---------------- */
async function init() {
  initAudio();
  bindEvents();
  initSupabase();
  initOneSignal();
  syncPushState();
  playerUI();

  if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session && data.session.user) { await enterApp(); return; }
    } catch (e) {}
  }
  // Logged out: respect the hash (deep links to #/signin etc.), default landing.
  onRoute();
}

document.addEventListener('DOMContentLoaded', init);

/* Test/debug hooks (harmless in production). */
window.MuseApp = {
  state: state, showModal: showModal, closeModal: closeModal,
  detectCountry: detectCountry, maybeShowWelcome: maybeShowWelcome,
  renderSignin: renderSignin, renderProfile: renderProfile,
  ensureCountrySaved: ensureCountrySaved,
  queuePointsPopup: queuePointsPopup, ensureNickname: ensureNickname,
  renderChallenge: renderChallenge, awardPoints: awardPoints, demoLogin: demoLogin,
};

})();
