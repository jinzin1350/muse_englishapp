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
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d); }

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
  teacher: null,         // approved teacher row {id,ref_code,display_name} or null
  teacherRequest: null,  // pending/rejected teacher request or null
  teacherStudents: null, // cached roster for the teacher dashboard
  viewTeacher: null,   // admin "view as teacher": {user_id, display_name, ref_code} or null (read-only)
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

/* ---------------- Teacher referral + analytics (phase 1) ----------------
   - Teachers get a ref_code; students who sign up via ?ref=CODE are linked
     through profiles.referred_by (existing text-code mechanism).
   - bumpStat() writes atomic per-day aggregates via the bump_stat() RPC.
   - trackEvent() logs coarse analytics events (fire-and-forget).
   - Heartbeat counts visible-app seconds for "daily time in app". */
function bumpStat(field, value) {
  try {
    if (!sb || !state.user || state.user.demo) return;
    sb.rpc('bump_stat', { p_field: field, p_value: value }).then(function () {}, function () {});
  } catch (e) {}
}
function trackEvent(event, meta) {
  try {
    if (!sb || !state.user || state.user.demo) return;
    sb.from('app_events').insert({
      user_id: state.user.id, event: event, meta: meta || {}
    }).then(function () {}, function () {});
  } catch (e) {}
}
async function loadTeacherStatus() {
  state.teacher = null;
  state.teacherRequest = null;
  if (!sb || !state.user || state.user.demo) return;
  try {
    const r = await sb.from('teachers')
      .select('id,user_id,ref_code,display_name,status,requested_at')
      .eq('user_id', state.user.id).maybeSingle();
    if (r.data) {
      if (r.data.status === 'approved') state.teacher = r.data;
      else state.teacherRequest = r.data;
    }
  } catch (e) { /* pre-migration: table may not exist yet */ }
}
function teacherInviteLink(code) {
  return window.location.origin + '/?ref=' + encodeURIComponent(code);
}
function initHeartbeat() {
  setInterval(function () {
    try {
      if (!state.user || state.user.demo) return;
      if (document.visibilityState !== 'visible') return;
      bumpStat('seconds_in_app', 30);
    } catch (e) {}
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') initHeartbeat._last = Date.now();
  });
}

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
/* ---------------- saved / bookmarked words ----------------
   Hard words the user bookmarks from lesson word cards, to review and
   practice later in the Review tab. Cloud table `saved_words` when signed
   in (falls back to localStorage, same pattern as mistakes). */
function savedWordKey(word, date) { return String(word || '').toLowerCase() + '|' + (date || ''); }
async function getSavedWords() {
  if (cloudReady()) {
    try {
      const res = await sb.from('saved_words').select('*')
        .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(500);
      if (!res.error && res.data) { state.savedWords = res.data; return res.data; }
    } catch (e) {}
  }
  const arr = lsGet('savedWords');
  state.savedWords = arr;
  return arr;
}
function isWordSaved(word, date) {
  const k = savedWordKey(word, date);
  return (state.savedWords || lsGet('savedWords')).some(function (x) {
    return savedWordKey(x.word, x.lesson_date) === k;
  });
}
async function toggleSaveWord(word, date) {
  const m = state.lesson;
  const w = ((m && m.words) || []).find(function (x) { return x.word === word; }) || { word: word };
  const k = savedWordKey(word, date);
  const wasSaved = isWordSaved(word, date);
  if (cloudReady()) {
    try {
      if (wasSaved) {
        await sb.from('saved_words').delete().eq('user_id', state.user.id)
          .eq('word', word).eq('lesson_date', date || null);
      } else {
        await sb.from('saved_words').insert({
          user_id: state.user.id, word: word, level: (m && m.level) || null, lesson_date: date || null,
          meaning: w.meaning || '', pronunciation: w.pronunciation || '', example: w.example || '',
          persian: w.persian || '', pos: w.pos || '', word_audio: w.word_audio || '', photo: w.photo || ''
        });
      }
      await getSavedWords();
      return !wasSaved;
    } catch (e) {}
  }
  const arr = lsGet('savedWords');
  if (wasSaved) lsSet('savedWords', arr.filter(function (x) { return savedWordKey(x.word, x.lesson_date) !== k; }));
  else {
    arr.unshift({ id: uid(), word: word, level: (m && m.level) || '', lesson_date: date || '',
      meaning: w.meaning || '', pronunciation: w.pronunciation || '', example: w.example || '',
      persian: w.persian || '', pos: w.pos || '', word_audio: w.word_audio || '', photo: w.photo || '' });
    lsSet('savedWords', arr.slice(0, 500));
  }
  state.savedWords = lsGet('savedWords');
  return !wasSaved;
}
async function removeSavedWord(id, word, date) {
  if (cloudReady() && id) {
    try {
      const res = await sb.from('saved_words').delete().eq('id', id).eq('user_id', state.user.id);
      if (!res.error) { await getSavedWords(); return; }
    } catch (e) {}
  }
  const k = savedWordKey(word, date);
  lsSet('savedWords', lsGet('savedWords').filter(function (x) {
    return String(x.id) !== String(id) && savedWordKey(x.word, x.lesson_date) !== k;
  }));
  state.savedWords = lsGet('savedWords');
}
/* Paint the saved state onto already-rendered word-card bookmark buttons
   (no full tab re-render, so nothing flickers). */
async function refreshSavedWordButtons(body) {
  const arr = await getSavedWords();
  const set = {};
  arr.forEach(function (x) { set[savedWordKey(x.word, x.lesson_date)] = 1; });
  body.querySelectorAll('.save-word-btn[data-action="toggle-save-word"]').forEach(function (b) {
    b.classList.toggle('saved', !!set[savedWordKey(b.getAttribute('data-word'), b.getAttribute('data-date'))]);
  });
}
async function toggleSaveWordBtn(btn) {
  btn.disabled = true;
  try {
    const nowSaved = await toggleSaveWord(btn.getAttribute('data-word'), btn.getAttribute('data-date'));
    btn.classList.toggle('saved', nowSaved);
  } finally { btn.disabled = false; }
}
async function getOverallAverage() {
  return avgOfAttempts(await getAttempts());
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
  grammar_exercise: 'Grammar exercise',
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
  const pool = [
    { key: 'lesson', icon: '📝', xp: 30, target: 5, title: 'Complete today\'s lesson',
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
    host.innerHTML = '<section class="hm-quests" dir="ltr" lang="en" aria-label="Today\'s quests">' +
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
      if (suggestion) inpEl.value = suggestion;
      inpEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
      setTimeout(function () { try { inpEl.focus(); } catch (e) {} }, 120);
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

/* ---------------- lesson progress: lightweight per-user localStorage ----------------
   Tracks which steps of each daily lesson the learner has engaged with.
   Steps: words → quiz (reward!) → bonus: podcast → shadowing → grammar. */
const STEPS = ['words', 'quiz', 'podcast', 'shadowing', 'grammar'];
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
    refreshQuests();
    /* Streak rule (Alireza, 2026-10-14): a streak day counts when the words
       were genuinely read AND the quiz is done — words + quiz only, not
       all 5 steps — and only for today's lesson. */
    if (dateStr === todayStr() && !day.streakRecorded && day.words && day.quiz) {
      day.streakRecorded = true;
      localStorage.setItem(progressKey(), JSON.stringify(all));
      /* 7-day streak bonus (2026-10-16 fix): awarded ONCE when a genuine 7-day
         streak completes — the milestone coming back from recordStreakDay —
         never per app open. Ref pins streak start + length, so each 7/14/21…
         milestone awards exactly once per unbroken streak. */
      try {
        recordStreakDay().then(function (r) {
          if (r && r.ok && r.milestone && r.current_streak) {
            const start = new Date();
            start.setDate(start.getDate() - (r.current_streak - 1));
            awardPoints('streak_7', 50, 'streak-' + fmtDate(start) + '-' + r.current_streak);
          }
        }).catch(function () {});
      } catch (e) {}
    }
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
  const timg = $('#mp-toggle-img');
  if (timg) timg.src = playing ? 'media/podcast/btn-pause.webp' : 'media/podcast/btn-play.webp';
  $('#mp-title').textContent = player.title || '—';
  const cover = $('#mp-cover');
  if (cover) cover.src = (player.src && /podcast\.mp3/i.test(player.src))
    ? 'media/podcast/mascot-96.webp' : 'media/podcast/note-96.webp';
}

function refreshTrackCards() {
  const dur = player.el.duration || 0;
  const cur = player.el.currentTime || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  const mpBar = $('#mp-bar');
  if (mpBar) mpBar.style.width = pct + '%';
  const mpProg = $('#mp-progress');
  if (mpProg) mpProg.setAttribute('aria-valuenow', Math.round(pct));
  const mpTime = $('#mp-time');
  if (mpTime) mpTime.textContent = fmtTime(cur);
  const mpDur = $('#mp-dur');
  if (mpDur) mpDur.textContent = fmtTime(dur);
  $$('[data-audio-card]').forEach(function (card) {
    const active = card.getAttribute('data-src') === player.src;
    const playing = active && !player.el.paused;
    card.classList.toggle('is-playing', playing);
    const bar = $('.progress > div', card);
    const tcur = $('.t-cur', card);
    const tbtn = $('.play-btn', card);
    if (bar) bar.style.width = (active ? pct : 0) + '%';
    if (tcur) tcur.textContent = active ? fmtTime(cur) : '0:00';
    if (tbtn && !tbtn.disabled) tbtn.textContent = playing ? '⏸' : '▶';
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

function closePlayer() {
  try { player.el.pause(); } catch (e) {}
  player.src = null;
  player.title = '';
  playerUI();
}

/* Click / tap on the mini-player progress bar seeks (the lesson audio is
   pre-downloaded as a blob, so seeking is instant). */
function seekFromEvent(e) {
  const bar = $('#mp-progress');
  if (!bar || !player.src) return;
  const dur = player.el.duration;
  if (!dur || !isFinite(dur)) return;
  const r = bar.getBoundingClientRect();
  const x = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
  const ratio = Math.min(1, Math.max(0, (x - r.left) / r.width));
  try { player.el.currentTime = ratio * dur; } catch (err) {}
  refreshTrackCards();
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

/* ---------------- PWA install prompt (Android + iOS) ---------------- */
let pwaDeferredPrompt = null;

function pwaIsIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || '') && !window.MSStream;
}
function pwaIsStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
}
function pwaSnoozed() {
  try {
    const v = JSON.parse(localStorage.getItem('pwa_prompt') || '{}');
    return !!(v.dismissed && (Date.now() - v.dismissed < 7 * 24 * 3600 * 1000));
  } catch (e) { return false; }
}
function pwaSnooze() {
  try { localStorage.setItem('pwa_prompt', JSON.stringify({ dismissed: Date.now() })); } catch (e) {}
}
function pwaShowBanner() {
  if (pwaIsIos()) return; /* iOS never gets the banner — it gets the guide sheet directly. */
  if (pwaIsStandalone() || pwaSnoozed()) return;
  // Never pop the install banner over the splash/loading screen — wait until
  // the first content is actually on screen.
  if (!window._appReady) {
    window._pwaRetries = (window._pwaRetries || 0) + 1;
    if (window._pwaRetries < 15) setTimeout(pwaShowBanner, 2000);
    return;
  }
  const el = $('#pwa-prompt');
  if (el) el.classList.remove('hidden');
}
function pwaHideBanner() {
  const el = $('#pwa-prompt');
  if (el) el.classList.add('hidden');
}
function pwaShowIosSheet() {
  if (pwaIsStandalone() || pwaSnoozed()) return;
  // Never pop the guide over the splash/loading screen — wait until
  // the first content is actually on screen.
  if (!window._appReady) {
    window._pwaIosRetries = (window._pwaIosRetries || 0) + 1;
    if (window._pwaIosRetries < 15) setTimeout(pwaShowIosSheet, 2000);
    return;
  }
  const sheet = $('#pwa-ios');
  if (sheet) sheet.classList.remove('hidden');
}
function initPwaPrompt() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    pwaDeferredPrompt = e;
    // Nudge shortly after the app/landing is up.
    setTimeout(pwaShowBanner, 2500);
  });
  const installBtn = $('#pwa-install');
  if (installBtn) installBtn.addEventListener('click', function () {
    if (pwaIsIos()) {
      pwaHideBanner();
      const sheet = $('#pwa-ios');
      if (sheet) sheet.classList.remove('hidden');
      return;
    }
    if (pwaDeferredPrompt) {
      pwaDeferredPrompt.prompt();
      pwaDeferredPrompt.userChoice.then(function () {
        pwaDeferredPrompt = null;
        pwaHideBanner();
        pwaSnooze();
      }).catch(function () {});
    }
  });
  const dismissBtn = $('#pwa-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', function () {
    pwaHideBanner();
    pwaSnooze();
  });
  const iosDone = $('#pwa-ios-done');
  if (iosDone) iosDone.addEventListener('click', function () {
    const sheet = $('#pwa-ios');
    if (sheet) sheet.classList.add('hidden');
    pwaSnooze();
  });
  const sheet = $('#pwa-ios');
  if (sheet) sheet.addEventListener('click', function (e) {
    if (e.target === sheet) { sheet.classList.add('hidden'); pwaSnooze(); }
  });
  // iOS has no beforeinstallprompt and no one-tap install: skip the banner
  // entirely and show the manual install guide directly on first launch.
  if (pwaIsIos()) {
    setTimeout(pwaShowIosSheet, 2500);
  }
  window.addEventListener('appinstalled', function () {
    pwaHideBanner();
    pwaSnooze();
  });
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
  player.el.addEventListener('timeupdate', function () { try { podMsTrack(); } catch (e) {} });
  player.el.addEventListener('ended', function () { try { podMsOnEnded(); } catch (e) {} });
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
    ? '<button class="btn btn-ghost btn-sm ap-chip" data-action="toggle-transcript" data-transcript="' + esc(o.transcript) + '" aria-expanded="false">📝 Transcript</button>'
    : '';
  const cover = o.cover
    ? '<div class="ap-cover"><img src="' + esc(o.cover) + '" alt="" loading="lazy" onerror="this.closest(\'.ap-cover\').style.display=\'none\'">' +
      '<button class="ap-cover-play" data-action="play-track" data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" aria-label="Play ' + esc(o.title) + '">▶</button></div>'
    : '';
  return '' +
  '<div class="card audio-card2" data-audio-card data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" id="' + esc(o.id) + '">' +
    '<div class="ap-title">' + esc(o.title) + '</div>' +
    (o.sub ? '<div class="ap-sub">' + esc(o.sub) + '</div>' : '') +
    cover +
    '<div class="progress seekable ap-progress" role="progressbar" aria-label="Playback progress"><div></div></div>' +
    '<div class="ap-times"><span class="t-cur">0:00</span><span class="t-dur"></span></div>' +
    '<div class="ap-controls">' +
      '<button class="ap-skip" data-action="skip-back" aria-label="Back 10 seconds"><span class="ap-rs">↻</span><span>10s</span></button>' +
      '<button class="play-btn ap-play" data-action="play-track" data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" aria-label="Play ' + esc(o.title) + '">▶</button>' +
      '<button class="ap-skip" data-action="skip-fwd" aria-label="Forward 10 seconds"><span>10s</span><span class="ap-rs">↺</span></button>' +
    '</div>' +
    '<div class="ap-foot">' +
      (o.download ? '<a class="btn btn-ghost btn-sm ap-chip" href="' + esc(o.src) + '" download>⬇ Download</a>' : '') +
      transcriptBtn +
      (speeds ? '<div class="speed-row ap-speeds" role="group" aria-label="Playback speed">' + speeds + '</div>' : '') +
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
  // All day-manifests fetch concurrently (one batch instead of ~11 sequential
  // round trips); assembled newest-first with the original stop rule.
  const days = [];
  const d = new Date();
  for (let i = 0; i < 45; i++) { days.push(fmtDate(d)); d.setDate(d.getDate() - 1); }
  const settled = await Promise.all(days.map(function (ds) {
    return fetchLesson(level, ds).then(
      function (m) { return { ok: true, m: m }; },
      function () { return { ok: false }; });
  }));
  const found = [];
  let misses = 0;
  for (const r of settled) {
    if (r.ok) { found.push(r.m); misses = 0; }
    else {
      misses++;
      if (found.length > 0 && misses >= 10) break;
    }
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
/* Phase 2.8 (item 1): the app-mode rule, shared by renderLanding's safety
   net. Must match the head script in index.html — keep them in sync.
   App-mode is ON if ANY is true: a session, an app hash route (#/...),
   standalone (installed PWA), an app query param (?lesson=latest,
   ?ref=), or the muse_app_used flag. */
function shouldEnterAppMode() {
  try {
    if (state.user) return true;
    var hash = window.location.hash || '';
    var standalone = false;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) standalone = true;
      if (window.navigator && window.navigator.standalone) standalone = true;
    } catch (e) {}
    var appQuery = false;
    try {
      var q = new URLSearchParams(window.location.search);
      appQuery = q.get('lesson') === 'latest' || !!q.get('ref');
    } catch (e) {}
    /* 2026-10-14: an exact '#/' is the anonymous visitor's "home" — the
       marketing landing, NOT the app. Without this, the preview/auth
       "back" links (href="#/") loop back into #/preview forever and the
       visitor can never return to the landing. Signed-in visitors never
       reach here with '#/' (onRoute moves them to #/home); push/referral
       visits still enter the app.
       2026-10-14 fix-2: this holds EVEN in the installed PWA. Its cold
       start has no hash (manifest start_url "/"), so an exact '#/' in
       standalone can only come from the in-app "back to website" links —
       keeping the !standalone carve-out trapped PWA users in a
       preview → '#/' → '/' → preview loop with no way back. */
    if (hash === '#/' && !appQuery) return false;
    if (hash.indexOf('#/') === 0) return true;
    if (standalone) return true;
    if (appQuery) return true;
    try {
      if (localStorage.getItem('muse_app_used') === '1') return true;
    } catch (e) {}
  } catch (e) {}
  return false;
}

const PUBLIC_VIEWS = ['landing', 'signin', 'signup', 'preview', 'ptest', 'certificate'];
const LEARNER_VIEWS = ['home', 'lesson', 'lessons', 'scores', 'review', 'profile', 'admin', 'admin-teacher', 'waiting', 'challenge', 'teacher', 'become-teacher', 'inbox', 'homework', 'planner', 'choose-teacher', 'progress', 'grammar', 'grammar-test', 'vocab', 'words', 'ptest', 'certificate'];
const INPAGE_ANCHORS = ['how-it-works', 'levels'];

function parseHash() {
  const h = window.location.hash || '#/';
  const raw = h.replace(/^#/, '');
  const parts = raw.replace(/^\//, '').split('/');
  return { name: parts[0] || '', arg: decodeURIComponent(parts[1] || ''), arg2: decodeURIComponent(parts[2] || ''), raw: raw };
}

/* Guard: never discard an in-progress quiz silently. */
function quizGuardOk() {
  if (state.quiz || state.gquiz || state.gtest) {
    return window.confirm('You have a quiz in progress. Leave now and lose your quiz progress?');
  }
  return true;
}

function go(view, arg) {
  if (!quizGuardOk()) return;
  /* Onboarding gate: no nickname or no level -> the only allowed destination
     is the onboarding flow (nickname modal, then the waiting/level view). */
  if (onboardingNeeded() && view !== 'waiting') view = 'waiting';
  const h = '#/' + view + (arg ? '/' + encodeURIComponent(arg) : '');
  if (window.location.hash === h) { onRoute(); }
  else { window.location.hash = h; }
}

/* ---- First-login onboarding gate (Fix 1) ----
   A first-time user must not reach any app view without BOTH a nickname and
   a level. enterApp() runs the nickname modal then the waiting view, but the
   tab bar / hash navigation could bypass them. These guards close every path:
   init() -> enterApp(), Google SSO return, page reload / PWA resume, deep
   links, and manual hash edits all funnel through onRoute()/go(). */
function onboardingNeeded() {
  const u = state.user;
  return !!(u && !u.demo && !u.isAdmin && (!u.displayName || !u.level));
}
function enforceOnboardingGate() {
  if (!onboardingNeeded()) return false;
  const u = state.user;
  /* Nickname comes first: make sure the blocking modal is up. It has no
     dismiss path (locked overlay, no close button), so the user can only
     continue by saving a valid nickname. */
  if (!u.displayName && !document.getElementById('app-modal')) {
    ensureNickname('').then(function () { onRoute(); }, function () { onRoute(); });
  }
  /* Park on the waiting (level picker) view; setChrome() hides the tab bar
     and header while the gate is active, so there is no other navigation. */
  if (state.view !== 'waiting') show('waiting');
  else setChrome();
  return true;
}

function onRoute() {
  /* Teacher portal: own path, own auth gate, own chrome. */
  if (isTeachersPath()) { renderTeachers(); return; }
  /* Dedicated admin panel: own path, own auth gate, own chrome. */
  if (isPanelPath()) { renderAdminPanel(); return; }
  document.body.classList.remove('ap-mode');
  document.body.classList.remove('tw-mode');
  const r = parseHash();
  /* Self-heal: the game player hides the tabbar; if the quiz state is gone
     (e.g. browser back), the tabbar must come back. */
  if (!state.quiz) document.body.classList.remove('duo-playing');
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
    // Logged-in: onboarding gate first — no nickname/level means no app views.
    if (enforceOnboardingGate()) return;
    // Logged-in: learner views win.
    if (LEARNER_VIEWS.indexOf(view) === -1) {
      view = 'home';
      if (window.location.hash !== '#/home') { window.location.hash = '#/home'; return; }
    }
    if ((view === 'admin' || view === 'admin-teacher') && !state.user.isAdmin) view = 'home';
    /* Offer already resolved (e.g. browser Back after choosing) -> don't trap them here. */
    if (view === 'choose-teacher' && !state.user.isAdmin) {
      teacherOfferNeeded().then(function (needed) {
        if (!needed && parseHash().name === 'choose-teacher') go('home');
      }, function () {});
    }
    /* Deep link into a lesson tab, e.g. #/lesson/2026-10-09/quiz (quest links). */
    if (view === 'lesson' && r.arg2 && ['words', 'quiz', 'podcast', 'shadowing', 'grammar'].indexOf(r.arg2) !== -1) {
      state.lessonTab = r.arg2;
    }
  }
  /* Phase 2.8 (item 1): remember that this browser has entered an app
     route, so a later plain '/' visit opens the app instead of the
     landing. Cleared by doLogout() — after logout the landing returns. */
  if (view !== 'landing') {
    try { localStorage.setItem('muse_app_used', '1'); } catch (e) {}
  }
  show(view, r.arg);
}

function show(view, arg) {
  state.view = view;
  if (view !== 'admin-teacher') state.viewTeacher = null; /* leaving view-as-teacher mode */
  if (view !== 'lesson') { state.quiz = null; }
  if (view !== 'grammar') { state.gquiz = null; document.body.classList.remove('duo-playing'); }
  if (view !== 'grammar-test') { gtestStopTimer(); state.gtest = null; document.body.classList.remove('duo-playing'); }
  if (view !== 'vocab') { state.vquiz = null; document.body.classList.remove('duo-playing'); }
  if (view !== 'ptest') { if (state.ptest) { document.body.classList.remove('duo-playing'); } state.ptest = null; }
  /* Desktop home uses the mockup v6 dashboard layout. */
  document.body.classList.toggle('view-home', view === 'home');
  document.body.classList.toggle('view-grammar', view === 'grammar');
  document.body.classList.toggle('view-vocab', view === 'vocab');
  document.body.classList.toggle('view-words', view === 'words');
  setChrome();
  paintWelcomeHeader();
  _wasDesktop = isDesktop();
  /* Stop any desktop-home podcast preview when leaving the view. */
  try { document.querySelectorAll('.dh-pl-audio').forEach(function (a) { a.pause(); }); } catch (e) {}
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
  else if (view === 'progress') renderScores(v); /* merged into Scores 2026-10-09 */
  else if (view === 'review') renderMistakes(v);
  else if (view === 'profile') renderProfile(v);
  else if (view === 'challenge') renderChallenge(v);
  else if (view === 'inbox') renderInbox(v);
  else if (view === 'homework') renderHomework(v);
  else if (view === 'admin') renderAdmin(v);
  else if (view === 'admin-teacher') renderAdminTeacherView(v, arg);
  else if (view === 'teacher') renderTeacher(v);
  else if (view === 'planner') renderPlanner(v);
  else if (view === 'become-teacher') renderBecomeTeacher(v);
  else if (view === 'choose-teacher') renderChooseTeacher(v);
  else if (view === 'grammar') renderGrammar(v, arg);
  else if (view === 'certificate') renderCertificate(v, arg);
  else if (view === 'grammar-test') renderGrammarTest(v, arg);
  else if (view === 'vocab') renderVocab(v, arg);
  else if (view === 'words') renderWords(v, arg);
  else if (view === 'ptest') renderPTest(v, arg);
}

/* ---------------- chrome (headers / profile menu / nav) ---------------- */
function setChrome() {
  const logged = !!state.user;
  /* While the onboarding gate is active the user must see ONLY the onboarding
     screens: hide the app header and tab bar so there is no way to navigate
     into the app without a nickname and a level. */
  const gating = onboardingNeeded() || state.view === 'choose-teacher';
  /* Phase 2.8: the static landing in index.html replaces #landing-header.
     The landing is shown/hidden by the app-mode class on <html>. */
  var lh = $('#landing-header');
  if (lh) lh.classList.toggle('hidden', logged || state.view === 'landing' || state.view === 'signin' || state.view === 'signup');
  $('#app-header').classList.toggle('hidden', !logged || gating);
  $('#tabbar').classList.toggle('hidden', !logged || gating);
  if (logged) {
    const initial = (state.user.email || '?').trim().charAt(0).toUpperCase();
    $('#profile-initial').textContent = initial;
    $$('#tabbar .tab').forEach(function (t) {
      const tv = t.getAttribute('data-view');
      // The lessons archive is a sub-page of Home: keep Home highlighted there.
      // Same for the grammar section and the grammar placement test (entered from the home banner).
      const active = tv === state.view || ((state.view === 'lessons' || state.view === 'grammar' || state.view === 'grammar-test' || state.view === 'vocab') && tv === 'home');
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

/* ---------------- LANDING (public) ---------------- */
function heroPreviewHTML(m) {
  if (!m) {
    return '<div class="lp-lesson-card"><div class="lp-lesson-body">' +
      '<p class="lp-muted">Today’s lesson preview is loading…</p></div></div>';
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
  '<div class="lp-lesson-card" aria-label="Preview of today’s lesson">' +
    '<div class="lp-lesson-head"><span class="lp-lesson-brand"><img src="/icons/icon-192.png" alt=""><span>Muse English</span></span>' +
    '<span class="lp-lesson-level">' + esc(levelLabel(normalizeLevel(m.level))) + '</span></div>' +
    '<div class="lp-lesson-body">' +
      '<div class="lp-lesson-date">' + esc(m.date || '') + ' · Today’s lesson</div>' +
      '<div class="lp-lesson-theme">' + esc(m.theme || 'Daily lesson') + '</div>' +
      '<ul class="lp-lesson-checks">' + checks.map(function (c) {
        return '<li><span class="lp-ck" aria-hidden="true">' + c[0] + '</span><span><b>' + c[1] + '</b><br><span class="lp-muted">' + c[2] + '</span></span></li>';
      }).join('') + '</ul>' +
      '<div class="lp-lesson-bar" role="img" aria-label="Daily progress example"><div></div></div>' +
      '<div class="lp-muted">Your daily progress — tracked automatically</div>' +
      '<a class="lp-cta lp-cta-block" href="#/signup">Start learning</a>' +
    '</div>' +
  '</div>';
}

function renderLanding(v) {
  /* The static landing in index.html IS the landing page — there is no JS
     landing view anymore. The safety net uses the SAME app-mode rule as
     the head script and may drop app-mode ONLY when none of its signals
     is true:
     - WITH a hash (old '#/landing' link, bookmark, stale navigation):
       drop the hash — the static landing at '/' is the one homepage.
       An EXPLICIT '#/landing' means "show me the landing": set a
       one-shot session flag so the '/' redirect shows the landing even
       for a returning app user, whose muse_app_used flag would
       otherwise send '/' straight back to the app preview.
     - WITH an exact '#/' hash from an anonymous visitor (no session,
       no push/referral param — installed-PWA included, whose cold start
       never carries '#/'): '#/' IS the landing —
       show it in place with no redirect. Redirecting to '/' would loop
       straight back into #/preview via the muse_app_used flag: that was
       the 2026-10-14 preview trap (the preview/auth "back" links could
       never reach the landing).
     - WITHOUT a hash (plain '/') but an app signal is true (standalone
       PWA, ?lesson=latest / ?ref=, muse_app_used flag): this is an
       anonymous app user, not a first-time visitor — open the app's
       public lesson preview (#/preview) instead of the landing.
       EXCEPT when the one-shot force-landing flag is set: show the
       landing this once, then consume the flag.
     - Otherwise: clear #view and drop app-mode so the static landing
       shows (first-time visitors and crawlers). */
  var _h = window.location.hash || '';
  if (_h === '#/landing') {
    try { sessionStorage.setItem('muse_force_landing', '1'); } catch (e) {}
    window.location.replace('/'); return;
  }
  /* 2026-10-14: an anonymous '#/' IS the landing (see shouldEnterAppMode).
     Show it in place with no redirect — redirecting to '/' would send a
     returning visitor straight back into #/preview (the muse_app_used
     flag), which is exactly the trap the preview/auth "back" links fell
     into. Signed-in visitors never reach here with '#/' (onRoute moves
     them to #/home). */
  if (_h === '#/' && !shouldEnterAppMode()) {
    document.documentElement.classList.remove('app-mode');
    v.innerHTML = '';
    return;
  }
  if (_h) {
    window.location.replace('/'); return;
  }
  try {
    if (sessionStorage.getItem('muse_force_landing') === '1') {
      sessionStorage.removeItem('muse_force_landing');
      document.documentElement.classList.remove('app-mode');
      v.innerHTML = '';
      return;
    }
  } catch (e) {}
  /* 2026-10-16 (Alireza): teacher referral links (?ref=CODE) land on the app's
     home — never the preview page, which confuses new students. Signed-in
     visitors reach #/home; anonymous visitors reach the public home (landing)
     through onRoute's auth gate, then sign up and get auto-linked to the
     teacher via resolve_teacher_offer. Other app-mode entries (push deep
     links, returning visitors, PWA cold start) keep the preview. */
  if (shouldEnterAppMode()) {
    try {
      if (new URLSearchParams(window.location.search).get('ref')) { go('home'); return; }
    } catch (e) {}
    go('preview'); return;
  }
  document.documentElement.classList.remove('app-mode');
  v.innerHTML = '';
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
  v.innerHTML = '<div class="landing"><p class="muted"><a class="link" href="#/" title="Back to the Muse English website">← Back to website</a></p>' +
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
  return '<div class="auth">' +
    '<div class="auth-glow" aria-hidden="true"></div>' +
    '<a class="auth-back" href="#/"><img src="/icons/icon-192.png" alt=""><span>Muse English</span></a>' +
    '<div class="auth-card">' +
      '<img class="auth-mascot" src="/media/podcast/mascot-96.webp" alt="Muse English mascot">' +
      inner +
    '</div>' +
  '</div>';
}

function renderSignin(v) {
  const configured = supabaseKeysPresent();
  v.innerHTML = authShell(
    '<h1>Welcome back 👋</h1>' +
    '<p class="muted">Sign in to continue your lessons.</p>' +
    (configured ?
      googleButtonHTML('si') +
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
  { id: 'b1', name: 'Intermediate', desc: 'I can hold a conversation', icon: '📊' },
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
      googleButtonHTML('su') +
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

/* ---------------- Become a teacher ---------------- */
function renderBecomeTeacher(v) {
  const t = state.teacher, req = state.teacherRequest;
  let body;
  if (t) {
    body = '<div class="tch-status ok">✓ You are an approved teacher.</div>' +
      '<a class="btn btn-block" href="#/teacher">Open teacher dashboard</a>';
  } else if (req && req.status === 'pending') {
    body = '<div class="tch-status pending">⏳ Your request is under review. We’ll let you know once it’s approved.</div>' +
      '<p class="muted">Requested as <b>' + esc(req.display_name) + '</b> · ' + esc(String(req.requested_at || '').slice(0, 10)) + '</p>';
  } else {
    body = (req && req.status === 'rejected')
      ? '<div class="tch-status no">This request was not approved. You can try again below.</div>' : '';
    body += '<form id="form-teacher-req">' +
      '<div class="field"><label for="tq-name">Display name</label>' +
      '<input id="tq-name" type="text" maxlength="40" placeholder="e.g. Sara Ahmadi" required>' +
      '<p class="muted" style="font-size:0.8rem">Shown to the students you invite. Your personal invite link is created after approval.</p></div>' +
      '<div class="form-error" id="tq-error" role="alert"></div>' +
      '<button class="btn btn-block" type="submit">Request teacher access</button></form>';
  }
  v.innerHTML = '<div class="tch-wrap"><p><a class="link" href="#/profile">← Back to profile</a></p>' +
    '<h1>🍎 Become a teacher</h1>' +
    '<p class="muted">Invite your students with a personal link and follow their progress — daily activity, streaks, XP, lessons and podcast time.</p>' +
    '<div class="card">' + body + '</div></div>';
  const form = document.getElementById('form-teacher-req');
  if (form) form.addEventListener('submit', submitTeacherRequest);
}

async function submitTeacherRequest(e) {
  e.preventDefault();
  const name = ((document.getElementById('tq-name') || {}).value || '').trim();
  const errEl = document.getElementById('tq-error');
  if (name.length < 2) { if (errEl) errEl.textContent = 'Please enter your name.'; return; }
  if (errEl) errEl.textContent = '';
  // Temporary code until the admin approves and sets the real one.
  const tmpCode = 'pending-' + state.user.id.slice(0, 8);
  try {
    const r = await sb.from('teachers').upsert({
      user_id: state.user.id, ref_code: tmpCode, display_name: name, status: 'pending'
    }, { onConflict: 'user_id' });
    if (r.error) throw r.error;
    await loadTeacherStatus();
    trackEvent('teacher_requested', {});
    if (isTeachersPath()) { renderTeachers(); return; }
    renderBecomeTeacher(document.getElementById('view'));
  } catch (err) {
    if (errEl) errEl.textContent = 'Could not send the request. ' + (err.message || '');
  }
}

/* ---------------- Teacher dashboard ---------------- */
function fmtLastActive(d) {
  if (!d) return 'never';
  if (d === todayStr()) return 'today';
  const dt = new Date(d + 'T12:00:00').getTime(), now = Date.now();
  if (now - dt < 2 * 86400000) return 'yesterday';
  return d;
}
function copyTeacherLink() {
  const link = teacherInviteLink(state.teacher.ref_code);
  function done(btn) { if (btn) { const o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(function () { btn.textContent = o; }, 1500); } }
  const btn = document.querySelector('[data-action="copy-teacher-link"]');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function () { done(btn); }, function () { fallback(); });
  } else fallback();
  function fallback() {
    try {
      const ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done(btn);
    } catch (e) {}
  }
}
function renderTeacher(v) {
  state.viewTeacher = null; /* leaving any admin view-as-teacher mode */
  if (!state.teacher) { go('become-teacher'); return; }
  v.innerHTML = '<div class="tch-wrap">' +
    '<h1>🍎 Teacher dashboard</h1>' +
    '<div class="card tch-invite">' +
      '<div class="muted" style="margin:0 0 0.4rem">Your personal invite link</div>' +
      '<div class="tch-linkrow"><code>' + esc(teacherInviteLink(state.teacher.ref_code)) + '</code>' +
      '<button class="btn btn-sm" data-action="copy-teacher-link">Copy</button></div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.6rem 0 0">Share it with your students — everyone who signs up through it shows up below.</p>' +
    '</div>' +
    '<div class="card tch-invite">' +
      '<div class="muted" style="margin:0 0 0.4rem">📝 Placement test link for new students</div>' +
      '<div class="tch-linkrow"><code>' + esc(teacherPlacementLink(state.teacher.ref_code)) + '</code>' +
      '<button class="btn btn-sm" data-action="copy-ptest-link">Copy</button></div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.6rem 0 0">Send it to a new student — they take a 5-part test (vocabulary, listening, grammar, writing, speaking) and the results land in your dashboard below.</p>' +
    '</div>' +
    '<div class="card"><h3 style="margin-top:0">🌟 My public profile</h3>' +
    '<p class="muted" style="font-size:0.85rem;margin-top:-0.3rem">Students see this when choosing a teacher. Add your photo, experience and a short bio.</p>' +
    '<div id="tch-profile-body"><div class="empty">Loading…</div></div></div>' +
    '<div class="section-title"><h2>My students <span id="tch-count" class="muted"></span></h2>' +
    '<span class="tch-actions"><a class="btn btn-sm" href="#/planner">📅 Weekly planner</a>' +
    '<button class="btn btn-sm" data-action="assignment-compose">＋ New assignment</button></span></div>' +
    '<div id="tch-weekly"></div>' +
    '<div id="tch-daily"></div>' +
    '<div id="tch-coach"></div>' +
    '<div id="tch-assign"></div>' +
    '<div id="tch-roster"><div class="empty">Loading…</div></div>' +
    '<div id="tch-detail"></div>' +
    '<div class="section-title"><h2>Placement test results</h2></div>' +
    '<div id="tch-ptest"><div class="empty">Loading…</div></div>' +
  '</div>';
  loadTeacherRoster();
  loadPlacementResults();
  loadTeacherCoach();
  loadTeacherAssignments();
  loadTeacherProfile();
}
/* Teacher public profile (photo / experience / bio) — shown to students on
   the choose-teacher page. Needs supabase-teacher-choose-migration.sql. */
async function loadTeacherProfile() {
  const host = document.getElementById('tch-profile-body');
  if (!host || !state.teacher || !state.user) return;
  let p = null;
  try {
    const r = await sb.from('teachers')
      .select('display_name,photo_url,experience_years,bio')
      .eq('user_id', state.user.id).maybeSingle();
    if (r.error) throw r.error;
    p = r.data || {};
  } catch (e) {
    host.innerHTML = '<p class="muted">Profile editing needs the latest database update.</p>';
    return;
  }
  let previewURL = null, pendingFile = null;
  const photoHTML = function (url, name) {
    return url
      ? '<img id="tch-photo-prev" class="tch-prof-photo" src="' + esc(url) + '" alt="">'
      : '<div id="tch-photo-prev" class="tch-prof-photo tch-offer-initial">' + esc((name || '?').charAt(0)) + '</div>';
  };
  host.innerHTML =
    '<div class="tch-prof-grid">' +
    '<div class="tch-prof-photowrap">' + photoHTML(p.photo_url, p.display_name) +
    '<label class="btn btn-sm" style="cursor:pointer;margin-top:.5rem">Upload photo<input type="file" id="tch-photo-file" accept="image/*" hidden></label></div>' +
    '<div class="tch-prof-fields">' +
    '<label>Display name<input id="tch-f-name" maxlength="40" value="' + esc(p.display_name || '') + '"></label>' +
    '<label>Years of teaching experience<input id="tch-f-exp" type="number" min="0" max="60" placeholder="e.g. 5" value="' + (p.experience_years !== null && p.experience_years !== undefined ? p.experience_years : '') + '"></label>' +
    '<label>Short bio (one line, max 200)<textarea id="tch-f-bio" rows="2" maxlength="200" placeholder="e.g. IELTS coach — I help adults speak with confidence">' + esc(p.bio || '') + '</textarea></label>' +
    '<div><button class="btn btn-sm" id="tch-prof-save">Save profile</button> <span class="muted" id="tch-prof-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
    '</div></div>' +
    '<div style="margin-top:.8rem"><div class="muted" style="font-size:0.82rem;margin-bottom:.4rem">Preview — what students see:</div>' +
    '<div dir="rtl" lang="fa"><div class="tch-offer-grid" id="tch-prof-preview"></div></div></div>';
  const paintPreview = function () {
    host.querySelector('#tch-prof-preview').innerHTML = tchOfferCardHTML({
      display_name: host.querySelector('#tch-f-name').value.trim() || 'Your name',
      photo_url: previewURL || p.photo_url,
      experience_years: host.querySelector('#tch-f-exp').value.trim(),
      bio: host.querySelector('#tch-f-bio').value.trim(),
      student_count: null, ref_code: ''
    });
  };
  host.querySelector('#tch-photo-file').addEventListener('change', function (ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    pendingFile = f;
    if (previewURL) { try { URL.revokeObjectURL(previewURL); } catch (e2) {} }
    previewURL = URL.createObjectURL(f);
    const prev = host.querySelector('#tch-photo-prev');
    const img = document.createElement('img');
    img.id = 'tch-photo-prev'; img.className = 'tch-prof-photo'; img.src = previewURL; img.alt = '';
    prev.replaceWith(img);
    paintPreview();
  });
  ['tch-f-name', 'tch-f-exp', 'tch-f-bio'].forEach(function (id) {
    host.querySelector('#' + id).addEventListener('input', paintPreview);
  });
  host.querySelector('#tch-prof-save').addEventListener('click', async function () {
    const status = host.querySelector('#tch-prof-status');
    const say = function (t, ok) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; };
    const name = host.querySelector('#tch-f-name').value.trim();
    const expRaw = host.querySelector('#tch-f-exp').value.trim();
    const bio = host.querySelector('#tch-f-bio').value.trim();
    if (name.length < 2) { say('Display name is too short.', false); return; }
    const exp = expRaw === '' ? null : parseInt(expRaw, 10);
    if (expRaw !== '' && !(exp >= 0 && exp <= 60)) { say('Experience must be 0–60 years.', false); return; }
    if (bio.length > 200) { say('Bio is too long (max 200).', false); return; }
    say('Saving…', true);
    try {
      let photoURL = p.photo_url || null;
      if (pendingFile) {
        const ext = ((pendingFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
        const path = state.user.id + '/photo.' + ext;
        const up = await sb.storage.from('teacher-photos')
          .upload(path, pendingFile, { upsert: true, contentType: pendingFile.type || 'image/jpeg' });
        if (up.error) throw up.error;
        photoURL = sb.storage.from('teacher-photos').getPublicUrl(path).data.publicUrl;
      }
      const r = await sb.rpc('update_teacher_profile', {
        p_display_name: name, p_experience_years: exp, p_bio: bio, p_photo_url: photoURL || ''
      });
      if (r.error || r.data !== true) throw new Error('save failed');
      p = { display_name: name, photo_url: photoURL, experience_years: exp, bio: bio };
      pendingFile = null;
      say('Saved ✓', true);
      paintPreview();
    } catch (e) { say('Save failed: ' + (e.message || e), false); }
  });
  paintPreview();
}
/* Weekly report card (phase 3): 7-day aggregates across the teacher's students. */
function renderTeacherWeekly() {
  const host = document.getElementById('tch-weekly');
  if (!host) return;
  const list = state.teacherStudents || [];
  if (!list.length) { host.innerHTML = ''; return; }
  const sum = function (k) { return list.reduce(function (a, s) { return a + (Number(s[k]) || 0); }, 0); };
  const active = list.filter(function (s) { return s.last_active && s.last_active >= daysAgoStr(6); }).length;
  host.innerHTML = '<div class="card"><div class="tch-weekly-title">📊 This week with your students</div>' +
    '<div class="tch-totals">' +
    '<div><b>' + list.length + '</b><span>students</span></div>' +
    '<div><b>' + active + '</b><span>active</span></div>' +
    '<div><b>' + sum('lessons_7d') + '</b><span>lessons</span></div>' +
    '<div><b>' + sum('xp_7d') + '</b><span>XP earned</span></div>' +
    '</div></div>';
}
/* Coach XP (phase 3): the teacher's own total + the coach leaderboard. */
async function loadTeacherCoach() {
  const host = document.getElementById('tch-coach');
  if (!host) return;
  try {
    const xpR = await sb.rpc('my_coach_xp');
    if (xpR.error) throw xpR.error;
    const boardR = await sb.rpc('coach_board');
    const board = boardR.error ? [] : (boardR.data || []).slice(0, 5);
    const me = state.teacher ? state.teacher.display_name : '';
    host.innerHTML = '<div class="card"><div class="tch-weekly-title">⭐ Your coach XP: <b>' + (xpR.data || 0) + '</b></div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0.6rem">+10 every time one of your students finishes a lesson.</p>' +
      (board.length ? '<div class="tch-board">' + board.map(function (t, i) {
        const isMe = t.display_name === me;
        return '<div class="tch-board-row' + (isMe ? ' me' : '') + '"><span>#' + (i + 1) + ' ' +
          esc(t.display_name) + (isMe ? ' (you)' : '') + '</span><b>' + t.coach_xp + ' XP</b></div>';
      }).join('') + '</div>' : '') + '</div>';
  } catch (e) { host.innerHTML = ''; /* migration 3 not run yet: stay hidden */ }
}
/* Nudge (phase 3): queue a push notification to the student, max 1 per 24h. */
async function teacherNudge(i, btn) {
  const s = (state.teacherStudents || [])[i];
  if (!s || !btn) return;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  try {
    const r = await sb.rpc('send_nudge', { p_student: s.user_id });
    if (r.error) throw r.error;
    btn.textContent = (r.data === true) ? 'Sent ✓' : 'Already sent today';
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
  }
}
async function teacherSetLevel(i, btn) {
  const s = (state.teacherStudents || state.twStudents || [])[i];
  if (!s || !btn) return;
  const sel = document.getElementById('tch-level-' + i);
  const msg = document.getElementById('tch-level-msg-' + i);
  if (!sel) return;
  const newLevel = sel.value;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Saving…';
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
  try {
    const r = await sb.rpc('set_student_level', { p_student: s.user_id, p_level: newLevel });
    if (r.error) throw r.error;
    if (r.data !== true) throw new Error('Not authorized');
    // Update local state so the UI reflects the change immediately
    s.level = newLevel;
    if (msg) { msg.textContent = '✓ Saved'; msg.style.color = '#4C9A2A'; }
    btn.textContent = 'Saved ✓';
    setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2000);
  } catch (e) {
    if (msg) { msg.textContent = 'Could not save — try again.'; msg.style.color = '#D34F4F'; }
    btn.textContent = orig;
    btn.disabled = false;
  }
}
/* ---------------- Certificates (teacher-issued, 2026-10-20) ----------------
   Teachers decide when a student earns one (his order — no auto-issue).
   Data lives in Supabase `certificates`, accessed only via RPCs:
   issue_certificate / get_student_certificates / get_my_certificates /
   revoke_certificate / verify_certificate (public). */
var CERT_LV_GRAD = { a1: ['#F0CE63', '#D9A21B'], a2: ['#F6AC68', '#E8833A'], b1: ['#6CC48C', '#3FA46A'], b2: ['#FF8145', '#F26522'], c1: ['#7DB4EC', '#4A90D9'], c2: ['#B39DE4', '#8E6FC8'] };
function certDateLong(iso) {
  if (!iso) return '';
  var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function certCardHTML(c) {
  var lv = String(c.level || 'a1').toLowerCase();
  var grad = CERT_LV_GRAD[lv] || CERT_LV_GRAD.a1;
  var lvName = (TW_LEVEL_LABEL[lv] || lv.toUpperCase());
  var bodyTxt = c.title
    ? 'has successfully completed the <b>' + esc(c.title) + '</b> course at Muse English.'
    : 'has successfully completed the <b>CEFR Level ' + lv.toUpperCase() + ' · ' + esc(lvName) + '</b> English course at Muse English.';
  return '<div class="cert-card">' +
    '<div class="cert-blob cert-b1"></div><div class="cert-blob cert-b2"></div>' +
    '<div class="cert-brand"><span class="cert-book">📖</span><span class="cert-brandname">Muse English</span></div>' +
    '<div class="cert-rule"></div>' +
    '<div class="cert-title">CERTIFICATE</div>' +
    '<div class="cert-subtitle">of Completion</div>' +
    '<div class="cert-presented">This certificate is proudly presented to</div>' +
    '<div class="cert-student">' + esc(c.student_name || '') + '</div>' +
    '<div class="cert-body">' + bodyTxt + '</div>' +
    '<div class="cert-lvrow"><span class="cert-lvcircle" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' + lv.toUpperCase() + '</span>' +
    '<span class="cert-lvtext"><b>CEFR Level ' + lv.toUpperCase() + ' · ' + esc(lvName) + '</b>' +
    '<small>Common European Framework of Reference for Languages</small></span></div>' +
    '<div class="cert-bottom">' +
    '<span class="cert-cell"><b>' + esc(certDateLong(c.issued_on || c.created_at)) + '</b><small>Date of Issue</small></span>' +
    '<span class="cert-seal"><span class="cert-seal-disc">★</span><span class="cert-rib cert-r1"></span><span class="cert-rib cert-r2"></span></span>' +
    '<span class="cert-cell"><b class="cert-issuer">' + esc(c.issuer_name || 'Muse English') + '</b><small>Teacher · Muse English</small></span>' +
    '</div>' +
    '<div class="cert-verify">Verify this certificate at <b>museenglishapp.com/#/certificate/' + esc(c.code || '') + '</b> · Certificate ID: <b>' + esc(c.code || '') + '</b></div>' +
    '</div>';
}
/* Public verification page (#/certificate/<code>) — works logged out. */
async function renderCertificate(v, code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) { v.innerHTML = '<div class="cert-page"><div class="empty">No certificate code given.</div></div>'; return; }
  v.innerHTML = '<div class="cert-page"><div class="empty">Verifying certificate…</div></div>';
  try {
    var r = await sb.rpc('verify_certificate', { p_code: code });
    if (r.error) throw r.error;
    var d = r.data || {};
    if (!d.valid) {
      v.innerHTML = '<div class="cert-page"><div class="cert-invalid"><div class="cert-invalid-ico">⚠️</div>' +
        '<h2>Certificate not found</h2><p>This code is not valid — it may have been revoked or mistyped.</p>' +
        '<a class="btn" href="#/home">Go to Muse English</a></div></div>';
      return;
    }
    v.innerHTML = '<div class="cert-page">' +
      '<div class="cert-verified">✓ Verified — this certificate was issued by Muse English</div>' +
      certCardHTML(d) +
      '<div class="cert-actions cert-noprint"><button class="btn btn-primary" data-action="cert-print">⬇ Download / Print PDF</button> ' +
      '<button class="btn" data-action="cert-share" data-code="' + esc(d.code) + '">🔗 Share / Copy link</button></div>' +
      '</div>';
  } catch (e) {
    v.innerHTML = '<div class="cert-page"><div class="empty">Could not verify right now — please try again.</div></div>';
  }
}
async function shareCertificate(code, btn) {
  var url = window.location.origin + '/#/certificate/' + code;
  if (navigator.share) {
    try { await navigator.share({ title: 'Muse English Certificate', text: 'My Muse English certificate — verify it here:', url: url }); return; } catch (e) { /* cancelled: fall through to copy */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (btn) { var orig = btn.textContent; btn.textContent = '✓ Link copied'; setTimeout(function () { btn.textContent = orig; }, 2200); }
  } catch (e) {
    window.prompt('Copy your certificate link:', url);
  }
}
function printCertificate() {
  document.body.classList.add('cert-printing');
  var done = function () { document.body.classList.remove('cert-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(done, 4000);
  window.print();
}
/* Student: my certificates (Progress page section) */
async function loadMyCerts() {
  var host = document.getElementById('my-certs');
  if (!host) return;
  if (!cloudReady()) { host.innerHTML = ''; return; }
  try {
    var r = await sb.rpc('get_my_certificates');
    if (r.error) throw r.error;
    var list = r.data || [];
    if (!list.length) {
      host.innerHTML = '<div class="empty">No certificates yet — your teacher issues them here when you complete a course. 🏅</div>';
      return;
    }
    host.innerHTML = list.map(function (c) {
      var lv = String(c.level || '').toUpperCase();
      var grad = CERT_LV_GRAD[String(c.level || 'a1').toLowerCase()] || CERT_LV_GRAD.a1;
      return '<a class="cert-row" href="#/certificate/' + esc(c.code) + '">' +
        '<span class="cert-row-badge" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' + lv + '</span>' +
        '<span class="cert-row-main"><b>' + esc(c.title || ('CEFR Level ' + lv + ' · ' + (TW_LEVEL_LABEL[String(c.level || '').toLowerCase()] || ''))) + '</b>' +
        '<small>' + esc(certDateLong(c.created_at)) + ' · ' + esc(c.code) + '</small></span>' +
        '<span class="cert-row-go">View ›</span></a>';
    }).join('');
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load certificates.</div>';
  }
}
/* Teacher: certificates block inside the student detail card */
async function loadTeacherStudentCerts(i, s) {
  var host = document.getElementById('tch-cert-' + i);
  if (!host) return;
  var lvOpts = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (lv) {
    return '<option value="' + lv + '"' + (String(s.level || '').toLowerCase() === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>';
  }).join('');
  var form = '<div class="an-title" style="margin-top:.8rem">🏅 Certificates</div>' +
    '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;margin-bottom:0.5rem">' +
    '<select id="tch-cert-lv-' + i + '" style="padding:0.35rem 0.6rem;border:1px solid #E5DCCB;border-radius:8px;background:#FFFDF9;font-size:0.9rem">' + lvOpts + '</select>' +
    '<input id="tch-cert-title-' + i + '" type="text" placeholder="Course title (optional)" style="flex:1;min-width:150px;padding:0.4rem 0.6rem;border:1px solid #E5DCCB;border-radius:8px;background:#FFFDF9;font-size:0.9rem"/>' +
    '<button class="btn btn-sm" data-action="teacher-cert-issue" data-i="' + i + '">Issue certificate</button>' +
    '<span id="tch-cert-msg-' + i + '" style="font-size:0.8rem"></span></div>' +
    '<div id="tch-cert-list-' + i + '"><div class="empty">Loading…</div></div>';
  host.innerHTML = form;
  var listHost = document.getElementById('tch-cert-list-' + i);
  try {
    var r = await sb.rpc('get_student_certificates', { p_student: s.user_id });
    if (r.error) throw r.error;
    var list = r.data || [];
    if (!list.length) { listHost.innerHTML = '<div class="empty">No certificates issued yet.</div>'; return; }
    listHost.innerHTML = list.map(function (c) {
      var lv = String(c.level || '').toUpperCase();
      return '<div class="an-arow"><span>🏅 <b>' + lv + '</b> ' + esc(c.title || '') +
        ' <span class="muted">· ' + esc(c.code) + ' · ' + esc(certDateLong(c.created_at)) + (c.revoked ? ' · <b style="color:#D34F4F">revoked</b>' : '') + '</span></span>' +
        '<span style="display:flex;gap:0.4rem"><a class="btn btn-sm btn-ghost" href="' + window.location.origin + '/#/certificate/' + esc(c.code) + '" target="_blank" rel="noopener">View</a>' +
        (c.revoked ? '' : '<button class="btn btn-sm btn-ghost" data-action="teacher-cert-revoke" data-code="' + esc(c.code) + '" data-i="' + i + '">Revoke</button>') +
        '</span></div>';
    }).join('');
  } catch (e) {
    listHost.innerHTML = '<div class="empty">Certificates need the database migration first (ask Alireza if this persists).</div>';
  }
}
async function teacherIssueCert(i, btn) {
  var s = (state.teacherStudents || [])[i];
  if (!s || !btn) return;
  var lvSel = document.getElementById('tch-cert-lv-' + i);
  var titleIn = document.getElementById('tch-cert-title-' + i);
  var msg = document.getElementById('tch-cert-msg-' + i);
  if (!lvSel) return;
  btn.disabled = true;
  var orig = btn.textContent;
  btn.textContent = 'Issuing…';
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
  try {
    var params = { p_student: s.user_id, p_level: lvSel.value, p_title: titleIn ? titleIn.value : null };
    if (state.viewTeacher && state.viewTeacher.user_id) params.p_as_teacher = state.viewTeacher.user_id;
    var r = await sb.rpc('issue_certificate', params);
    if (r.error) throw r.error;
    if (!r.data) throw new Error('Not authorized');
    if (msg) { msg.textContent = '✓ Issued: ' + r.data; msg.style.color = '#4C9A2A'; }
    btn.textContent = 'Issued ✓';
    loadTeacherStudentCerts(i, s);
  } catch (e) {
    if (msg) { msg.textContent = 'Could not issue — try again.'; msg.style.color = '#D34F4F'; }
    btn.textContent = orig;
    btn.disabled = false;
  }
}
/* Teacher: remove a student from my class (unlink only — the student's
   account and progress stay intact). RPC enforces ownership. */
async function teacherRemoveStudent(i, btn) {
  var s = (state.teacherStudents || [])[i];
  if (!s || !btn) return;
  var name = s.display_name || (s.email || '?').split('@')[0];
  if (!confirm('Remove ' + name + ' from your class?\n\nTheir account and progress stay intact — they just won\'t be your student anymore, and you won\'t be able to send them assignments.')) return;
  var msg = document.getElementById('tch-remove-msg-' + i);
  btn.disabled = true;
  try {
    var params = { p_student: s.user_id };
    if (state.viewTeacher && state.viewTeacher.user_id) params.p_as_teacher = state.viewTeacher.user_id;
    var r = await sb.rpc('remove_student_from_class', params);
    if (r.error) throw r.error;
    if (r.data !== true) throw new Error('Not allowed — this student is not in your class.');
    state.twStudents = null;
    if (document.getElementById('tw-content')) {
      twShowSection('students');
    } else {
      loadTeacherRoster();
      var host = document.getElementById('tch-detail');
      if (host) host.innerHTML = '<div class="empty">✅ ' + esc(name) + ' was removed from your class.</div>';
    }
  } catch (e) {
    btn.disabled = false;
    if (msg) msg.textContent = (e && e.message && /remove_student_from_class/.test(e.message))
      ? 'Needs the database migration first (ask Alireza).'
      : 'Could not remove: ' + ((e && e.message) || e);
  }
}

async function teacherRevokeCert(code, i) {
  if (!window.confirm('Revoke certificate ' + code + '? Its verification page will stop working.')) return;
  try {
    var r = await sb.rpc('revoke_certificate', { p_code: code });
    if (r.error) throw r.error;
    var s = (state.teacherStudents || [])[i];
    if (s) loadTeacherStudentCerts(i, s);
  } catch (e) { /* list refresh shows current state */ }
}

async function loadTeacherRoster() {
  const host = document.getElementById('tch-roster');
  if (!host) return;
  try {
    const r = await sb.rpc('get_my_students');
    if (r.error) throw r.error;
    state.teacherStudents = r.data || [];
    renderTeacherRoster();
    renderTeacherWeekly();
    loadTeacherDaily();
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load students: ' + esc(e.message || e) + '</div>';
  }
}
function renderTeacherRoster() {
  const host = document.getElementById('tch-roster');
  if (!host) return;
  const list = state.teacherStudents || [];
  const cc = document.getElementById('tch-count');
  if (cc) cc.textContent = '(' + list.length + ')';
  if (!list.length) {
    host.innerHTML = '<div class="empty">No students yet — share your invite link above to get started. 🌱</div>';
    return;
  }
  host.innerHTML = '<div class="card tch-table-card"><div class="tch-table">' +
    '<div class="tch-tr tch-th"><span>Student</span><span>🔥</span><span>XP 7d</span><span>Lessons</span><span>🎧m</span><span>🎤</span><span>Active</span></div>' +
    list.map(function (s, i) {
      const name = s.display_name || (s.email || '?').split('@')[0];
      return '<div class="tch-tr" data-action="teacher-student" data-i="' + i + '" role="button" tabindex="0">' +
        '<span class="tch-name">' + esc(name) + '<small>' + esc(s.level ? levelLabel(normalizeLevel(s.level)) : '—') + '</small></span>' +
        '<span>' + (s.current_streak || 0) + '</span>' +
        '<span>' + (s.xp_7d || 0) + '</span>' +
        '<span>' + (s.lessons_7d || 0) + '</span>' +
        '<span>' + (s.podcast_min_7d || 0) + '</span>' +
        '<span title="Shadowing speaking tries (7d)">' + (s.shadowing_7d || 0) + '</span>' +
        '<span class="muted">' + esc(fmtLastActive(s.last_active)) + '</span></div>';
    }).join('') + '</div></div>' +
    '<p class="muted" style="font-size:0.82rem">Tap a student to see their 14-day activity.</p>';
}
/* Teacher id for dashboard queries: the viewed teacher in admin view-as mode,
   otherwise the logged-in user. */
function tchViewId() {
  return (state.viewTeacher && state.viewTeacher.user_id) || (state.user && state.user.id);
}
async function openTeacherStudent(i) {
  const s = (state.teacherStudents || [])[i];
  const host = document.getElementById('tch-detail');
  if (!s || !host) return;
  host.innerHTML = '<div class="empty">Loading…</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const r = await sb.rpc('get_student_daily', { p_student: s.user_id });
    if (r.error) throw r.error;
    const rows = r.data || [];
    const name = s.display_name || (s.email || '?').split('@')[0];
    const maxSec = Math.max.apply(null, [1].concat(rows.map(function (x) { return x.seconds_in_app || 0; })));
    const sum = function (k) { return rows.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
    const streakTxt = (s.current_streak || 0) > 0 ? ' · 🔥 ' + s.current_streak + '-day streak' : '';
    const curLevel = String(s.level || '').toLowerCase();
    const levelOpts = ['a1','a2','b1','b2','c1','c2'].map(function(lv) {
      return '<option value="' + lv + '"' + (curLevel === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>';
    }).join('');
    host.innerHTML = '<div class="card"><h3 style="margin-top:0">' + esc(name) +
      ' <span class="muted" style="font-weight:400">· last 14 days' + streakTxt + '</span></h3>' +
      '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.8rem;flex-wrap:wrap">' +
        '<label style="font-size:0.85rem;color:#5B6478">📊 Level:</label>' +
        '<select id="tch-level-' + i + '" data-student="' + esc(s.user_id) + '" style="padding:0.35rem 0.6rem;border:1px solid #E5DCCB;border-radius:8px;background:#FFFDF9;font-size:0.9rem">' +
          levelOpts +
        '</select>' +
        '<button class="btn btn-sm" data-action="teacher-set-level" data-i="' + i + '">Save</button>' +
        '<span id="tch-level-msg-' + i + '" style="font-size:0.8rem"></span>' +
      '</div>' +
      (rows.length ? '<div class="tch-bars">' + rows.map(function (x) {
        const h = Math.max(4, Math.round((x.seconds_in_app || 0) / maxSec * 90));
        const mins = Math.round((x.seconds_in_app || 0) / 60);
        return '<div class="tch-bar" title="' + esc(x.day) + ': ' + mins + ' min">' +
          '<div class="tch-bar-fill" style="height:' + h + 'px"></div>' +
          '<div class="tch-bar-d">' + esc(String(x.day).slice(5)) + '</div></div>';
      }).join('') + '</div>' : '<div class="empty">No activity in the last 14 days.</div>') +
      '<div class="tch-totals">' +
        '<div><b>' + sum('xp_earned') + '</b><span>XP</span></div>' +
        '<div><b>' + sum('lessons_opened') + '</b><span>lessons</span></div>' +
        '<div><b>' + sum('quizzes_completed') + '</b><span>quizzes</span></div>' +
        '<div><b>' + Math.round(sum('podcast_seconds') / 60) + '</b><span>podcast min</span></div>' +
      '</div>' +
      '<div id="tch-an-' + i + '"><div class="empty">Loading analytics…</div></div>' +
      '<div id="tch-cert-' + i + '"><div class="empty">Loading certificates…</div></div>' +
      '<div id="tch-sh-' + i + '"><div class="empty">Loading shadowing…</div></div>' +
      '<div class="an-title" style="margin-top:.8rem">📤 Sent to this student</div>' +
      '<div id="tch-sent-' + i + '"><button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '">Show sent items</button></div>' +
      '<div style="margin-top:1rem;border-top:1px solid #F0E4DC;padding-top:0.8rem">' +
      '<div class="an-title" style="color:#B3382E">🚪 Class membership</div>' +
      '<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0.6rem">Removing a student only unlinks them from your class — their account and progress stay intact. They will no longer be your student and you won\'t be able to send them assignments.</p>' +
      '<button class="btn btn-sm" style="background:#FDECEA;color:#B3382E;border:1px solid #F3C6C0" data-action="teacher-remove-student" data-i="' + i + '">Remove from my class</button>' +
      '<span id="tch-remove-msg-' + i + '" style="font-size:0.8rem;margin-left:0.5rem"></span></div>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.9rem;flex-wrap:wrap">' +
      (state.viewTeacher ? '' :
      '<button class="btn btn-sm" data-action="teacher-nudge" data-i="' + i + '">🔔 Nudge</button>' +
      '<button class="btn btn-sm" data-action="teacher-message" data-i="' + i + '">💬 Message</button>' +
      '<button class="btn btn-sm" data-action="ai-report-tstudent" data-i="' + i + '">🤖 Report</button>') +
      '<button class="btn btn-ghost btn-sm" data-action="teacher-student-close">Close</button></div></div>';
    loadTeacherStudentAnalytics(i, s);
    loadTeacherStudentShadowing(i, s);
    loadTeacherStudentCerts(i, s);
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load activity.</div>';
  }
}
/* ---- teacher: per-student shadowing practice (attempts + listens, 30d) ---- */
async function loadTeacherStudentShadowing(i, s) {
  const host = document.getElementById('tch-sh-' + i);
  if (!host) return;
  try {
    const since30 = new Date(Date.now() - 29 * 864e5).toISOString();
    const attP = sb.from('shadowing_attempts')
      .select('lesson_date,transcript,score,created_at').eq('user_id', s.user_id)
      .gte('created_at', since30).order('created_at', { ascending: false }).limit(30)
      .then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; });
    const evP = sb.from('app_events').select('created_at').eq('user_id', s.user_id)
      .eq('event', 'shadowing_listen').gte('created_at', since30).limit(2000)
      .then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; });
    const att = await attP, evs = await evP;
    const n = att.length;
    const avg = n ? Math.round(att.reduce(function (a, x) { return a + (Number(x.score) || 0); }, 0) / n) : 0;
    let html = '<div class="an-title" style="margin-top:.8rem">🎤 Shadowing practice <span class="muted" style="font-weight:400">· last 30 days</span></div>' +
      '<div class="tch-totals">' +
      '<div><b>' + n + '</b><span>speaking tries</span></div>' +
      '<div><b>' + avg + '%</b><span>avg score</span></div>' +
      '<div><b>' + evs.length + '</b><span>sentences listened</span></div></div>';
    if (n) {
      html += '<div class="an-assign">' + att.slice(0, 8).map(function (x) {
        const mm = String(x.transcript || '').match(/^\[s(\d+)\]/);
        const said = String(x.transcript || '').replace(/^\[s\d+\]\s*/, '').slice(0, 60);
        const sc = Number(x.score) || 0;
        return '<div class="an-arow"><span>🔤 sentence ' + esc(mm ? mm[1] : '?') +
          ' <span class="muted">· ' + esc(said) + (said.length >= 60 ? '…' : '') + '</span></span>' +
          '<span class="muted">' + esc(String(x.lesson_date || '').slice(5)) + '</span>' +
          '<b class="' + (sc >= 70 ? 'ok' : 'bad') + '">' + sc + '%</b></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="empty">No shadowing practice yet.</div>';
    }
    host.innerHTML = html;
  } catch (e) { host.innerHTML = ''; }
}
/* ---- teacher: per-student sent history (assignments + this student's status) ---- */
async function toggleTeacherSent(i, btn) {
  const s = (state.teacherStudents || [])[i];
  const host = document.getElementById('tch-sent-' + i);
  if (!s || !host) return;
  const cache = (state._tSent = state._tSent || {})[i] || (state._tSent[i] = {});
  if (cache.html) {
    cache.open = !cache.open;
    host.innerHTML = cache.open ? cache.html
      : '<button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '">Show sent items</button>';
    return;
  }
  host.innerHTML = '<div class="empty">Loading…</div>';
  try {
    let a;
    try {
      a = await sb.from('assignments')
        .select('id,kind,title,topic_label,level,question_count,created_at,deadline,note,status')
        .eq('teacher_id', tchViewId()).contains('student_ids', [s.user_id])
        .order('created_at', { ascending: false }).limit(20);
      if (a.error) throw a.error;
    } catch (e2) {
      /* pre-scheduling-migration fallback (no status column) */
      a = await sb.from('assignments')
        .select('id,kind,title,topic_label,level,question_count,created_at,deadline,note')
        .eq('teacher_id', tchViewId()).contains('student_ids', [s.user_id])
        .order('created_at', { ascending: false }).limit(20);
      if (a.error) throw a.error;
    }
    const rows = (a.data || []).filter(function (x) { return x.status !== 'scheduled'; });
    const ids = rows.map(function (x) { return x.id; });
    const resMap = {};
    if (ids.length) {
      const r = await sb.from('assignment_results')
        .select('assignment_id,score,total').eq('student_id', s.user_id).in('assignment_id', ids);
      (r.data || []).forEach(function (x) { resMap[x.assignment_id] = x; });
    }
    cache.html = rows.length
      ? '<div class="an-assign">' + rows.map(function (x) {
          const res = resMap[x.id];
          const ico = x.kind === 'exam' ? '📋' : '📝';
          const sub = esc(x.topic_label || '') +
            ' · ' + x.question_count + ' Q · sent ' + esc(fmtDate(new Date(x.created_at))) +
            (x.deadline ? ' · due ' + esc(x.deadline) : '') +
            (x.note ? '<br>💬 ' + esc(x.note) : '');
          return '<div class="an-arow"><span>' + ico + ' <b>' + esc(x.title) + '</b><br>' +
            '<small class="muted">' + sub + '</small></span>' +
            '<span>' + (res ? '<b class="ok">✓ ' + res.score + '/' + res.total + '</b>'
                            : '<span class="muted">⏳ pending</span>') + '</span></div>';
        }).join('') + '</div>' +
        '<button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '" style="margin-top:.4rem">Hide</button>'
      : '<div class="empty">Nothing sent to this student yet.</div>';
    cache.open = true;
    host.innerHTML = cache.html;
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load sent items.</div>' +
      '<button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '">Retry</button>';
  }
}
async function loadTeacherStudentAnalytics(i, s) {
  const host = document.getElementById('tch-an-' + i);
  if (!host) return;
  try {
    const name = s.display_name || (s.email || '?').split('@')[0];
    const pack = await buildStudentPack(s.user_id, true, name);
    const h = document.getElementById('tch-an-' + i);
    if (!h) return;
    (state._tPacks = state._tPacks || {})[i] = pack;
    let html = '';
    if ((pack.assignments || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">📝 Homework scores</div><div class="an-assign">' +
        pack.assignments.slice(0, 6).map(function (x, k) {
          const pct = x.total ? Math.round((x.score / x.total) * 100) : 0;
          const nw = (x.wrong || []).length;
          return '<div class="an-arow' + (nw ? ' an-click' : '') + '"' +
            (nw ? ' data-action="an-wrong" data-i="' + i + '" data-k="' + k + '" role="button" tabindex="0"' : '') + '>' +
            '<span>' + esc(x.topic) + (nw ? ' <span class="an-warn">· ' + nw + ' wrong ▸</span>' : '') + '</span>' +
            '<span class="muted">' + esc(x.date) + '</span>' +
            '<b class="' + (pct >= 70 ? 'ok' : 'bad') + '">' + x.score + '/' + x.total + '</b></div>' +
            (nw ? '<div class="an-wrong hidden" id="an-w-' + i + '-' + k + '">' +
              x.wrong.map(function (w) {
                return '<div class="an-wq"><div class="an-wqq">❓ ' + esc(w.q) + '</div>' +
                  '<div class="an-wa"><span class="bad">✕ picked: ' + esc(w.picked || '—') + '</span>' +
                  '<span class="ok">✓ correct: ' + esc(w.correct || '—') + '</span></div></div>';
              }).join('') + '</div>' : '');
        }).join('') + '</div>';
    }
    if ((pack.topicAccuracy || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">🎯 Accuracy by topic</div>' + topicBarsHTML(pack.topicAccuracy);
    }
    if ((pack.quizTrend || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">📝 Quiz history</div><div class="an-assign">' +
        pack.quizTrend.slice(0, 8).map(function (x) {
          const pct = x.total ? Math.round((x.score / x.total) * 100) : 0;
          return '<div class="an-arow"><span>' + esc(quizKindLabel(x.kind)) + '</span>' +
            '<span class="muted">' + esc(x.date) + '</span>' +
            '<b class="' + (pct >= 70 ? 'ok' : 'bad') + '">' + x.score + '/' + x.total + '</b></div>';
        }).join('') + '</div>';
    }
    if ((pack.openMistakes || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">⚠️ Still struggling with</div>' +
        pack.openMistakes.slice(0, 6).map(function (m) {
          return '<div class="an-wq"><div class="an-wqq">❓ ' + esc(m.q) + '</div></div>';
        }).join('');
    }
    h.innerHTML = html || '<div class="empty">No homework data yet.</div>';
  } catch (e) { /* keep the activity view */ }
}
async function aiReportTeacherStudent(i, btn) {
  const s = (state.teacherStudents || [])[i];
  if (!s) return;
  const name = s.display_name || (s.email || '?').split('@')[0];
  try {
    const pack = await buildStudentPack(s.user_id, true, name);
    requestAIReport('teacher-student', pack, btn);
  } catch (e) {
    requestAIReport('teacher-student', { name: name, note: 'no data' }, btn);
  }
}
async function buildClassPack() {
  const students = (state.teacherStudents || []).slice(0, 15);
  const rows = [];
  for (const s of students) {
    const name = s.display_name || (s.email || '?').split('@')[0];
    try {
      const pack = await buildStudentPack(s.user_id, true, name);
      const sc = pack.assignments.map(function (x) { return x.total ? x.score / x.total : 0; });
      rows.push({
        name: name,
        assignments: pack.assignments.length,
        avgPct: sc.length ? Math.round(sc.reduce(function (a, b) { return a + b; }, 0) / sc.length * 100) : null,
        weak: pack.topicAccuracy.slice(0, 3).map(function (t) {
          return { topic: t.topic, pct: Math.round((t.correct / t.total) * 100) };
        })
      });
    } catch (e) { rows.push({ name: name, assignments: 0, avgPct: null, weak: [] }); }
  }
  return { classSize: (state.teacherStudents || []).length, students: rows };
}
async function aiReportClass(btn) {
  try {
    const pack = await buildClassPack();
    requestAIReport('teacher-class', pack, btn);
  } catch (e) {
    requestAIReport('teacher-class', { note: 'no data' }, btn);
  }
}

/* ---------------- Teacher inbox (phase 4): one-way teacher -> student messages ---------------- */
async function refreshInboxBadge() {
  const btn = document.getElementById('btn-inbox');
  const badge = document.getElementById('inbox-badge');
  if (!btn) return;
  if (!cloudReady()) { btn.classList.add('hidden'); return; }
  try {
    const r = await sb.rpc('my_messages');
    if (r.error) throw r.error;
    const msgs = r.data || [];
    const unread = msgs.filter(function (m) { return !m.read_at; }).length;
    state.inboxMessages = msgs;
    state.unreadMessages = unread;
    btn.classList.toggle('hidden', !msgs.length);
    badge.classList.toggle('hidden', !unread);
    if (unread) badge.textContent = unread > 9 ? '9+' : String(unread);
  } catch (e) { btn.classList.add('hidden'); }
}
function maybeShowInboxPrompt() {
  if (state._inboxPrompted || document.getElementById('app-modal')) return;
  const n = state.unreadMessages || 0;
  if (!n || state.view !== 'home') return;
  state._inboxPrompted = true;
  showModal(
    '<div class="inbox-prompt">' +
    '<div class="ip-deco" aria-hidden="true"></div>' +
    '<div class="ip-bubble" aria-hidden="true"><span></span><span></span><span></span>' +
    '<i class="ip-spark s1">✦</i><i class="ip-spark s2">✦</i><i class="ip-spark s3">✦</i><i class="ip-spark s4">✦</i></div>' +
    '<h2>You have ' + n + ' new message' + (n > 1 ? 's' : '') + '</h2>' +
    '<p class="ip-sub">From your teacher — tap below to read.</p>' +
    '<div class="ip-cta"><div class="ip-btns">' +
    '<button class="ip-primary" data-action="inbox-open">Read messages</button>' +
    '<button class="ip-secondary" data-action="modal-close">Later</button>' +
    '</div>' +
    '<img class="ip-mascot" src="/media/inbox-mascot.webp" alt="" aria-hidden="true">' +
    '</div>' +
    '</div>'
  );
  const ov = document.getElementById('app-modal');
  if (ov && ov.firstChild) ov.firstChild.classList.add('modal-card-inbox');
}
function fmtMsgTime(ts) {
  try {
    const d = new Date(ts);
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? 'today ' + hm : fmtDate(d) + ' ' + hm;
  } catch (e) { return ''; }
}
function inboxListHTML(msgs) {
  if (!msgs.length) return '<div class="empty">No messages yet. When your teacher writes to you, it shows up here. 💌</div>';
  return msgs.map(function (m) {
    /* Assignment notifications (sent by the teacher composer) get a direct
       link — otherwise the student reads the message but can't find the quiz. */
    const isAssignment = (m.body || '').indexOf('📝 Your teacher sent you ') === 0 ||
      (m.body || '').indexOf('📚 Your teacher sent you vocabulary ') === 0;
    let bodyHTML;
    if (isAssignment) {
      const mm = /^📝 Your teacher sent you (homework|an exam): (📝|📚) (.*) — open Muse English to start\.$/.exec(m.body || '');
      const mv = /^📚 Your teacher sent you vocabulary (homework|exam): (.*) — open Muse English to start\.$/.exec(m.body || '');
      bodyHTML = mm
        ? '<span class="msg2-line">📝 Your teacher sent you ' + esc(mm[1]) + ':</span>' +
          '<span class="msg2-line">' + esc(mm[2]) + ' ' + esc(mm[3]) + '</span>' +
          '<span class="msg2-line msg2-dim">Open Muse English to start.</span>'
        : (mv
          ? '<span class="msg2-line">📚 Your teacher sent you vocabulary ' + esc(mv[1]) + ':</span>' +
            '<span class="msg2-line">' + esc(mv[2]) + '</span>' +
            '<span class="msg2-line msg2-dim">Open Muse English to start.</span>'
          : esc(m.body));
    } else {
      /* Plain messages: keep the sender's line breaks, one block per line,
         each with its own bidi base direction so mixed Persian/English
         (e.g. the weekly recap) renders in the right order. */
      bodyHTML = esc(m.body).split('\n').map(function (ln) {
        return ln.trim()
          ? '<span class="msg2-line" dir="auto">' + ln + '</span>'
          : '<span class="msg2-gap"></span>';
      }).join('');
    }
    return '<div class="msg2-card' + (m.read_at ? '' : ' unread') + '">' +
      '<div class="msg-head"><b>' + esc(m.teacher_name) + '</b><span class="muted">' + esc(fmtMsgTime(m.created_at)) + '</span></div>' +
      '<p>' + bodyHTML + '</p>' +
      (isAssignment ? '<a class="msg2-cta" href="#/homework"><span class="msg2-cta-ico">📝</span><span>Open homework →</span><span class="msg2-cta-go">›</span></a>' : '') + '</div>';
  }).join('');
}
async function renderInbox(v) {
  var cached = state.inboxMessages;
  v.innerHTML = '<div class="tch-wrap msg2-wrap">' +
    '<h1 class="msg2-title"><span class="msg2-bubble">💬</span> Messages<i class="msg2-spark s1"></i><i class="msg2-spark s2"></i></h1>' +
    '<div id="inbox-list">' +
    ((cached && cached.length) ? inboxListHTML(cached) : '<div class="empty">Loading…</div>') + '</div>' +
    '<div class="msg2-bg" aria-hidden="true"><span class="msg2-blob"></span><img src="/media/inbox-mascot.webp" alt=""></div></div>';
  var host = document.getElementById('inbox-list');
  if (!sb) {
    if (host && !(cached && cached.length)) host.innerHTML = '<div class="empty">You appear to be offline. Connect to the internet to load messages.</div>';
    return;
  }
  var msgs = null, loadErr = null;
  try {
    const r = await sb.rpc('my_messages');
    if (r.error) throw r.error;
    msgs = r.data || [];
    state.inboxMessages = msgs;
  } catch (e) {
    loadErr = e;
    if (cached && cached.length) msgs = cached;
  }
  if (!msgs) {
    if (host) host.innerHTML = '<div class="empty">Could not load messages.' +
      '<div class="muted" style="font-size:0.8rem;margin-top:0.4rem">' + esc((loadErr && loadErr.message) || String(loadErr)) + '</div>' +
      '<button class="btn btn-block" data-action="inbox-retry" style="max-width:220px;margin:1rem auto 0">Try again</button></div>';
    return;
  }
  if (host) host.innerHTML = inboxListHTML(msgs);
  // Mark as read no matter where the messages came from (fresh fetch or cache),
  // otherwise the unread badge and the login prompt keep coming back.
  try { await sb.rpc('mark_messages_read'); }
  catch (e1) {
    try { await new Promise(function (res) { setTimeout(res, 1200); }); await sb.rpc('mark_messages_read'); }
    catch (e2) {}
  }
  // Optimistic clear: the server was asked to mark everything read, so drop the
  // badge now instead of depending on the recount fetch below.
  state.unreadMessages = 0;
  var _badge = document.getElementById('inbox-badge');
  if (_badge) _badge.classList.add('hidden');
  refreshInboxBadge();
}
/* Teacher -> student composer (from the student detail card). */
function teacherMessageComposer(i) {
  const s = (state.teacherStudents || [])[i];
  if (!s) return;
  const name = s.display_name || (s.email || '?').split('@')[0];
  showModal(
    '<div class="modal-ico">💬</div>' +
    '<h2>Message to ' + esc(name) + '</h2>' +
    '<div class="field" style="text-align:left"><label for="msg-body">Message</label>' +
    '<textarea id="msg-body" rows="4" maxlength="500" placeholder="Write something encouraging…"></textarea></div>' +
    '<div class="form-error" id="msg-error" role="alert"></div>' +
    '<button class="btn btn-block" data-action="teacher-message-send" data-i="' + i + '">Send</button>' +
    '<button class="btn btn-ghost btn-block" data-action="modal-close">Cancel</button>'
  );
  setTimeout(function () { const t = document.getElementById('msg-body'); if (t) t.focus(); }, 120);
}
async function teacherMessageSend(i, btn) {
  const s = (state.teacherStudents || [])[i];
  const ta = document.getElementById('msg-body');
  const err = document.getElementById('msg-error');
  const body = ta ? ta.value.trim() : '';
  if (!s) return;
  if (!body) { if (err) err.textContent = 'Write something first.'; return; }
  if (err) err.textContent = '';
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body });
    if (r.error) throw r.error;
    if (r.data === true) closeModal();
    else { if (err) err.textContent = 'Could not send.'; btn.disabled = false; btn.textContent = 'Send'; }
  } catch (e) {
    if (err) err.textContent = 'Could not send — check your connection.';
    btn.disabled = false; btn.textContent = 'Send';
  }
}

/* ---------------- Teacher assignments: homework & exams (phase 5) ----------------
   Teacher picks v2 topic/points + level + count -> questions sampled from the
   grammar_bank table -> snapshot stored in public.assignments -> student plays
   it -> result lands in public.assignment_results. */
const ASSIGN_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];


/* ---- Grammar v2 pilot metadata (family -> topics, linked points) ---- */
var V2_FAMILIES = {};
var V2_TOPICS = {};
var V2_INDEX_LOADED = false;
/* Load the generated v2 topic index (21 families, 107 topics) once */
async function loadV2Index() {
  if (V2_INDEX_LOADED) return;
  try {
    const r = await fetch('data/grammar/v2-index.json');
    if (!r.ok) return;
    const idx = await r.json();
    V2_FAMILIES = idx.families || {};
    V2_TOPICS = idx.topics || {};
    V2_INDEX_LOADED = true;
  } catch (e) {}
}

/* Legacy topics hidden when v2 covers them (spec mapping table) */


/* ---- teacher composer ---- */
/* Shared assignment-composer form (used by the modal and by the /teachers full-page composer). */
function assignmentComposerBodyHTML(list) {
  return (
    '<div class="as2-modes" role="tablist">' +
    '<button type="button" class="as2-mode on" data-amode="homework"><span class="as2-mode-ico">📝</span><span class="as2-mode-txt"><b>Homework</b><small>Practice and reinforce learning</small></span></button>' +
    '<button type="button" class="as2-mode" data-amode="exam"><span class="as2-mode-ico">📋</span><span class="as2-mode-txt"><b>Exam</b><small>Assess student knowledge</small></span></button></div>' +
    '<div class="field" id="as-level-field"><label for="as-level">Level</label>' +
    '<select id="as-level" class="input">' +
    ASSIGN_LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (lv === 'a2' ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="field"><label>Content</label><div id="as-source">' +
    '<label class="chk as2-type-card"><input type="radio" name="as-source" value="grammar" checked> <span class="as2-type-ico">📖</span> Grammar</label>' +
    '<label class="chk as2-type-card"><input type="radio" name="as-source" value="vocab"> <span class="as2-type-ico">📚</span> Vocabulary</label>' +
    '</div></div>' +
    '<div id="as-vocab-panel" class="hidden">' +
    '<div class="field"><label for="as-vocab-cat">Word category</label>' +
    '<select id="as-vocab-cat" class="input"><option value="">Loading categories…</option></select></div>' +
    '<div class="field"><label>Word levels</label><div id="as-vocab-levels">' +
    ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (lv) {
      return '<label class="chk"><input type="checkbox" class="as-vocab-lv" value="' + lv + '"' + (lv === 'a2' ? ' checked' : '') + '> ' + lv.toUpperCase() + '</label>';
    }).join('') +
    '</div></div>' +
    '<div class="muted" id="as-vocab-poolinfo" style="font-size:.85rem"></div>' +
    '<div class="field"><label>Words <span class="as2-opt">— uncheck any you don\'t want</span></label>' +
    '<div id="as-vocab-words" class="as-vocab-words"><div class="empty">Pick a category to see its words.</div></div></div>' +
    '<div class="field"><label>Question types</label><div id="as-vocab-types">' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="meaning" checked> <span class="as2-type-ico">🔤</span> Word → meaning</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="reverse" checked> <span class="as2-type-ico">🔁</span> Meaning → word</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="gap"> <span class="as2-type-ico">⌨️</span> Fill the gap</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="listen"> <span class="as2-type-ico">🎧</span> Listen &amp; choose</label>' +
    '</div></div>' +
    '<div class="field"><label>Wrong options come from</label><div id="as-vocab-dist">' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-vocab-dist" value="same" checked> <span class="as2-diff-txt"><b>Same category</b><small>Harder — similar words</small></span></label>' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-vocab-dist" value="any"> <span class="as2-diff-txt"><b>Any words</b><small>Easier — mixed words</small></span></label>' +
    '</div></div>' +
    '<div class="field"><label for="as-vocab-count">Questions</label>' +
    '<select id="as-vocab-count" class="input">' +
    [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (n === 10 ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
    '</select></div>' +
    '</div>' +
    '<div id="as-hw-fields">' +
    '<div class="field"><label for="as-topic">Topic</label>' +
    '<select id="as-topic" class="input"></select></div>' +
    '<div id="as-v2-panel" class="hidden">' +
    '<div class="field"><label>Points <span class="as2-opt">— select teaching points</span></label>' +
    '<div id="as-v2-points"></div></div>' +
    '<div class="field"><label>Levels</label><div id="as-v2-levels"></div></div>' +
    '<div class="field"><label>Question types</label><div id="as-v2-types">' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-v2-type" value="mcq" checked> <span class="as2-type-ico">👥</span> Multiple choice</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-v2-type" value="gap" checked> <span class="as2-type-ico">⌨️</span> Typing</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-v2-type" value="error" checked> <span class="as2-type-ico">🔍</span> Find the mistake</label>' +
    '</div></div>' +
    '<div class="field"><label>Difficulty</label><div id="as-v2-diff">' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-v2-diff" value="easy"> <span class="as2-diff-txt"><b>Easy</b><small>Simpler questions</small></span></label>' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-v2-diff" value="mixed" checked> <span class="as2-diff-txt"><b>Mixed</b><small>A mix of easy and challenging questions</small></span></label>' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-v2-diff" value="hard"> <span class="as2-diff-txt"><b>Hard</b><small>More challenging questions</small></span></label>' +
    '</div></div>' +
    '<div class="muted" id="as-v2-pool" style="font-size:.85rem"></div>' +
    '</div>' +
    '<div class="field"><label for="as-count">Questions</label>' +
    '<select id="as-count" class="input">' +
    [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (n === 10 ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
    '</select></div></div>' +
    '<div id="as-exam-fields" class="hidden">' +
    '<div class="field"><label>Topics mix <span class="as2-opt">— e.g. 5 from X, 5 from Y</span></label>' +
    '<div id="as-mixrows"></div>' +
    '<button type="button" class="btn btn-sm" id="as-addrow">＋ Add topic</button>' +
    '<div class="muted" id="as-mixtotal" style="margin-top:.45rem;font-size:.85rem">Total: 0 questions</div>' +
    '</div></div>' +
    '<div class="field"><label>Students</label><div class="as2-students">' +
    '<label class="chk as2-student-all"><input type="checkbox" id="as-all" checked> <span class="as2-type-ico">👥</span> <span class="as2-student-txt"><b>All students (' + list.length + ')</b><small>Send to your entire class</small></span></label>' +
    '<div id="as-students" class="as-pick hidden">' +
    list.map(function (s) {
      const nm = s.display_name || (s.email || '?').split('@')[0];
      return '<label class="chk"><input type="checkbox" class="as-st" value="' + esc(s.user_id) + '" checked> ' + esc(nm) + '</label>';
    }).join('') + '</div></div></div>' +
    '<div class="as2-row2">' +
    '<div class="field"><label for="as-note">Note for students <span class="as2-opt">(optional)</span></label>' +
    '<input id="as-note" class="input" maxlength="200" placeholder="e.g. Focus on the verb forms!"></div>' +
    '<div class="field"><label for="as-deadline">Deadline <span class="as2-opt">(optional)</span></label>' +
    '<input id="as-deadline" class="input" type="date" placeholder="yyyy-mm-dd"></div>' +
    '</div>' +
    '<div class="form-error" id="as-error" role="alert"></div>' +
    '<button class="as2-send" data-action="assignment-create">✈ Send to students</button>'
  );
}

/* Wire composer events. Works in the modal and in the /teachers full-page composer. */
function assignmentComposerWire() {
  assignMode = 'homework';
  Array.prototype.forEach.call(document.querySelectorAll('.as2-mode'), function (b) {
    b.addEventListener('click', function () { setAssignMode(b.getAttribute('data-amode')); });
  });
  document.getElementById('as-addrow').addEventListener('click', function () { examAddRow(); });
  document.getElementById('as-mixrows').addEventListener('change', examUpdateTotal);
  document.getElementById('as-mixrows').addEventListener('click', function (e) {
    const del = e.target.closest('.as-mix-del');
    if (del && del.closest('.as2-mixrow')) { del.closest('.as2-mixrow').remove(); examUpdateTotal(); }
  });
  examAddRow();
  assignmentFillTopics();
  document.getElementById('as-level').addEventListener('change', assignmentFillTopics);
  document.getElementById('as-topic').addEventListener('change', asV2PanelUpdate);
  document.getElementById('as-count').addEventListener('change', asV2PoolUpdate);
  document.getElementById('as-all').addEventListener('change', function () {
    document.getElementById('as-students').classList.toggle('hidden', this.checked);
  });
  /* vocabulary content source */
  Array.prototype.forEach.call(document.querySelectorAll('input[name="as-source"]'), function (r) {
    r.addEventListener('change', asSourceUpdate);
  });
  var vcat = document.getElementById('as-vocab-cat');
  if (vcat) vcat.addEventListener('change', asVocabPoolLoad);
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-lv'), function (cb) {
    cb.addEventListener('change', asVocabPoolLoad);
  });
  var vwords = document.getElementById('as-vocab-words');
  if (vwords) vwords.addEventListener('change', asVocabSelCount);
  asVocabInit();
  asSourceUpdate();
}

async function teacherAssignmentComposer() {
  if (twReadOnly()) { twReadOnlyNotice(); return; }
  await loadV2Index();
  const list = state.teacherStudents || [];
  if (!state.teacher) return;
  if (!list.length) {    showModal('<div class="modal-ico">📝</div><h2>New assignment</h2>' +
      '<p class="muted">You have no students yet — share your invite link first. 🌱</p>' +
      '<button class="btn btn-ghost btn-block" data-action="modal-close">Close</button>');
    return;
  }
  showModal(
    '<div class="as2">' +
    '<div class="as2-head"><div class="as2-ico"><span>📝</span></div>' +
    '<i class="as2-spark s1"></i><i class="as2-spark s2"></i>' +
    '<button class="as2-close" data-action="modal-close" aria-label="Close">✕</button></div>' +
    '<h2>New assignment</h2>' +
    assignmentComposerBodyHTML(list) +
    '<button class="as2-cancel" data-action="modal-close">Cancel</button>' +
    '</div>'
  );
  const as2card = document.querySelector('#app-modal .modal-card');
  if (as2card) as2card.classList.add('as2-card');
  assignmentComposerWire();
}
/* ---- assignment composer: homework | exam mode + mixed-topic rows ---- */
var assignMode = 'homework';
function setAssignMode(m) {
  assignMode = (m === 'exam') ? 'exam' : 'homework';
  /* container-agnostic: works in the modal and in the /teachers full-page composer */
  Array.prototype.forEach.call(document.querySelectorAll('.as2-mode'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-amode') === assignMode);
  });
  const hw = document.getElementById('as-hw-fields'), ex = document.getElementById('as-exam-fields');
  if (hw) hw.classList.toggle('hidden', assignMode !== 'homework');
  if (ex) ex.classList.toggle('hidden', assignMode !== 'exam');
  const ico = document.querySelector('.as2-ico span');
  if (ico) ico.textContent = assignMode === 'exam' ? '📋' : '📝';
  if (typeof asV2PanelUpdate === 'function') asV2PanelUpdate();
  if (typeof asSourceUpdate === 'function') asSourceUpdate();
}
/* After a successful send: close the modal (legacy) or return to the
   assignments list (the /teachers full-page composer). */
function asComposeDone() {
  closeModal();
  var twc = document.getElementById('tw-content');
  if (twc && (state.twSection === 'compose' || state.twSection === 'assignments' || state.twSection === 'assignment-detail')) {
    state.twAssignments = null; /* invalidate portal cache */
    twShowSection('assignments');
  } else {
    loadTeacherAssignments();
  }
}
function examTopicOptions(selected) {
  let html = '';
  Object.keys(V2_FAMILIES).forEach(function (famSlug) {
    const fam = V2_FAMILIES[famSlug];
    html += '<optgroup label="' + esc(fam.title) + ' (v2)">';
    fam.topics.forEach(function (tslug) {
      const t = V2_TOPICS[tslug];
      const val = 'v2:' + tslug;
      if (t) html += '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(t.h1) + '</option>';
    });
    html += '</optgroup>';
  });
  return html;
}
function examAddRow(topic, count) {
  const host = document.getElementById('as-mixrows');
  if (!host) return;
  const d = document.createElement('div');
  d.className = 'as2-mixrow';
  d.innerHTML = '<select class="input as-mix-topic">' + examTopicOptions(topic) + '</select>' +
    '<input type="number" class="input as-mix-count" min="1" max="30" value="' + (count || 5) + '" aria-label="Questions">' +
    '<button type="button" class="btn btn-sm as-mix-del" aria-label="Remove topic">✕</button>';
  host.appendChild(d);
  examUpdateTotal();
}
function examUpdateTotal() {
  const host = document.getElementById('as-mixtotal');
  if (!host) return;
  let total = 0, rows = 0;
  Array.prototype.forEach.call(document.querySelectorAll('#as-mixrows .as2-mixrow'), function (r) {
    const c = parseInt(r.querySelector('.as-mix-count').value, 10);
    if (c > 0) { total += c; rows++; }
  });
  host.textContent = 'Total: ' + total + ' questions' + (rows ? ' across ' + rows + ' topic' + (rows > 1 ? 's' : '') : '');
}
function assignmentFillTopics() {
  const sel = document.getElementById('as-topic');
  let html = '';
  /* v2 topics grouped by family */
  Object.keys(V2_FAMILIES).forEach(function (famSlug) {
    const fam = V2_FAMILIES[famSlug];
    html += '<optgroup label="' + esc(fam.title) + ' (v2)">';
    html += '<option value="v2family:' + esc(famSlug) + '">Whole family: ' + esc(fam.title) + '</option>';
    fam.topics.forEach(function (tslug) {
      const t = V2_TOPICS[tslug];
      if (t) html += '<option value="v2:' + esc(tslug) + '">' + esc(t.h1) + '</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  /* show/hide v2 panel */
  asV2PanelUpdate();
  /* keep exam mix rows in sync with the level */
  Array.prototype.forEach.call(document.querySelectorAll('#as-mixrows .as-mix-topic'), function (s) {
    const cur = s.value;
    s.innerHTML = examTopicOptions(cur);
  });
}
/* v2 topic value helpers */
function asTopicVal() {
  const sel = document.getElementById('as-topic');
  return sel ? sel.value : '';
}
function asIsV2() {
  const v = asTopicVal();
  return v.indexOf('v2:') === 0 || v.indexOf('v2family:') === 0;
}
function asV2Slugs() {
  const v = asTopicVal();
  if (v.indexOf('v2family:') === 0) {
    const fam = V2_FAMILIES[v.slice(9)];
    return fam ? fam.topics.slice() : [];
  }
  if (v.indexOf('v2:') === 0) return [v.slice(3)];
  return [];
}
/* v2 panel: points checkboxes, level chips, pool count */
function asV2PanelUpdate() {
  const panel = document.getElementById('as-v2-panel');
  const isV2 = asIsV2();
  const mode = (typeof assignMode !== 'undefined' && assignMode === 'exam') ? 'exam' : 'homework';
  /* v2 panel only in homework mode; level dropdown hidden for v2 homework */
  if (panel) panel.classList.toggle('hidden', !isV2 || mode !== 'homework');
  const lvField = document.getElementById('as-level');
  if (lvField) {
    const lvWrap = lvField.closest('.field');
    if (lvWrap) lvWrap.style.display = (isV2 && mode === 'homework') ? 'none' : '';
  }
  if (!isV2 || mode !== 'homework') return;
  const slugs = asV2Slugs();
  /* collect points */
  const pointsHost = document.getElementById('as-v2-points');
  const levelsHost = document.getElementById('as-v2-levels');
  if (!pointsHost || !levelsHost) return;
  let ptsHtml = '';
  const allLevels = {};
  const secColors = ['peach', 'green', 'blue'];
  slugs.forEach(function (slug, sidx) {
    const t = V2_TOPICS[slug];
    if (!t) return;
    const color = secColors[sidx % 3];
    ptsHtml += '<div class="as2-sec as2-sec-' + color + '">';
    ptsHtml += '<div class="as-v2-topic-head">' + esc(t.h1) + '</div>';
    ptsHtml += '<div class="as2-pt-grid">';
    (t.points || []).forEach(function (p) {
      allLevels[p.level] = true;
      ptsHtml += '<label class="as2-pt-card"><input type="checkbox" class="as-v2-pt" value="' + esc(p.id) +
        '" data-level="' + esc(p.level) + '" checked> ' +
        '<span class="gh-lv">' + esc(p.level.toUpperCase()) + '</span> ' +
        '<span class="as2-pt-body"><b>' + esc(p.title) + '</b>' +
        '<span class="muted">' + esc(p.summary) + '</span></span></label>';
    });
    /* linked points as optional extras */
    (t.linked_points || []).forEach(function (pid) {
      /* find the point in any v2 topic */
      let found = null;
      Object.keys(V2_TOPICS).forEach(function (s2) {
        (V2_TOPICS[s2].points || []).forEach(function (p2) {
          if (p2.id === pid) found = { p: p2, topic: V2_TOPICS[s2].h1 };
        });
      });
      if (found) {
        allLevels[found.p.level] = true;
        ptsHtml += '<label class="as2-pt-card as-v2-linked"><input type="checkbox" class="as-v2-pt" value="' + esc(found.p.id) +
          '" data-level="' + esc(found.p.level) + '"> ' +
          '<span class="gh-lv">' + esc(found.p.level.toUpperCase()) + '</span> ' +
          '<span class="as2-pt-body"><b>' + esc(found.p.title) + '</b> <span class="as2-opt">(from ' + esc(found.topic) + ')</span>' +
          '<span class="muted">' + esc(found.p.summary) + '</span></span></label>';
      }
    });
    ptsHtml += '</div></div>';
  });
  pointsHost.innerHTML = ptsHtml;
  /* level chips */
  const lvls = Object.keys(allLevels).sort();
  levelsHost.innerHTML = lvls.map(function (lv) {
    return '<label class="chk as-v2-lvchip as2-lv-card"><input type="checkbox" class="as-v2-lv" value="' + esc(lv) + '" checked> ' +
      lv.toUpperCase() + '</label>';
  }).join('');
  /* wire up changes */
  Array.prototype.forEach.call(pointsHost.querySelectorAll('.as-v2-pt'), function (cb) {
    cb.addEventListener('change', asV2PoolUpdate);
  });
  Array.prototype.forEach.call(levelsHost.querySelectorAll('.as-v2-lv'), function (cb) {
    cb.addEventListener('change', asV2PoolUpdate);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-type'), function (cb) {
    cb.addEventListener('change', asV2PoolUpdate);
  });
  asV2PoolUpdate();
}
/* update pool count display */
function asV2PoolUpdate() {
  const poolEl = document.getElementById('as-v2-pool');
  if (!poolEl) return;
  const pool = asV2GetPool();
  const count = parseInt((document.getElementById('as-count') || {}).value, 10) || 10;
  if (pool.length < count) {
    poolEl.innerHTML = '<span style="color:#c62828">Only ' + pool.length + ' questions available for this selection.</span>';
  } else {
    poolEl.textContent = pool.length + ' questions available.';
  }
}
/* get filtered exercise pool for v2 selection */
function asV2GetPool() {
  const slugs = asV2Slugs();
  const selPts = {};
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-pt:checked'), function (cb) {
    selPts[cb.value] = true;
  });
  const selLvls = {};
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-lv:checked'), function (cb) {
    selLvls[cb.value] = true;
  });
  const selTypes = {};
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-type:checked'), function (cb) {
    selTypes[cb.value] = true;
  });
  const diffEl = document.querySelector('input[name="as-v2-diff"]:checked');
  const diff = diffEl ? diffEl.value : 'mixed';
  /* collect site exercises from app data (state.grammarCache) */
  const pool = [];
  slugs.forEach(function (slug) {
    /* find in grammar cache */
    let topic = null;
    if (typeof findGrammarTopic === 'function') topic = findGrammarTopic(slug);
    if (!topic || !topic.v2) return;
    const items = (topic.exercises && topic.exercises.items) || [];
    items.forEach(function (ex) {
      const exLv = (ex.level || '').toLowerCase();
      const exType = ex.type || 'mcq';
      if (!selLvls[exLv]) return;
      if (!selTypes[exType]) return;
      /* point filter */
      const exPts = ex.points || [];
      const matchPt = exPts.some(function (pid) { return selPts[pid]; });
      if (!matchPt) return;
      /* difficulty filter */
      if (diff === 'easy' && ex.difficulty !== 1) return;
      if (diff === 'hard' && ex.difficulty !== 3) return;
      pool.push(ex);
    });
  });
  return pool;
}
/* fetch bank exercises from Supabase: server-side points overlap + pagination */
async function asV2FetchBank(pointIds) {
  try {
    if (typeof sb === 'undefined' || !pointIds || !pointIds.length) return [];
    var all = [];
    var from = 0;
    var PAGE = 1000;
    for (;;) {
      var res = await sb.from('grammar_bank').select('data')
        .eq('status', 'active')
        .overlaps('points', pointIds)
        .range(from, from + PAGE - 1);
      if (res.error) break;
      var rows = res.data || [];
      all = all.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return all.map(function (row) { return row.data; });
  } catch (e) {
    return [];
  }
}
async function createAssignment(btn) {
  const errBox = document.getElementById('as-error');
  const err = function (m) { if (errBox) errBox.textContent = m; };
  err('');
  const level = document.getElementById('as-level').value;
  const roster = state.teacherStudents || [];
  const useAll = document.getElementById('as-all').checked;
  const targets = useAll ? roster.slice() : roster.filter(function (s) {
    const cb = document.querySelector('.as-st[value="' + s.user_id + '"]');
    return cb && cb.checked;
  });
  if (!targets.length) { err('Pick at least one student.'); return; }
  const mode = (typeof assignMode !== 'undefined' && assignMode === 'exam') ? 'exam' : 'homework';
  const srcEl = document.querySelector('input[name="as-source"]:checked');
  if (srcEl && srcEl.value === 'vocab') { await createVocabAssignment(btn, { err: err, targets: targets, orig: btn.textContent, mode: mode }); return; }
  if (mode === 'exam') { await createExamAssignment(btn, { err: err, level: level, targets: targets, orig: btn.textContent }); return; }
  /* all topics are v2 now: homework always uses the v2 bank flow */
  await createV2Assignment(btn, { err: err, targets: targets, orig: btn.textContent });
}


/* ---- v2 assignment creation ---- */
function asV2SnapshotQ(ex, topicSlug) {
  /* Build v2 snapshot question with full fields + legacy q alias */
  const t = V2_TOPICS[topicSlug];
  const label = t ? t.h1 : topicSlug;
  const snap = {
    id: ex.id,
    points: ex.points || [],
    level: (ex.level || '').toLowerCase(),
    type: ex.type || 'mcq',
    difficulty: ex.difficulty || 1,
    prompt: ex.prompt || ex.q || '',
    explanation: ex.explanation || '',
    topic_label: label,
    /* legacy aliases for old player compatibility */
    q: ex.prompt || ex.q || '',
    options: ex.options || [],
    answer: ex.answer
  };
  if (ex.type === 'gap') snap.accept = ex.accept || [];
  if (ex.type === 'error') {
    snap.segments = ex.segments || [];
    snap.correction = ex.correction || '';
  }
  return snap;
}
async function createV2Assignment(btn, ctx) {
  const err = ctx.err, targets = ctx.targets, orig = ctx.orig;
  const slugs = asV2Slugs();
  if (!slugs.length) { err('Select a topic.'); return; }
  const count = parseInt(document.getElementById('as-count').value, 10) || 10;
  /* bank-first pool (site exercises only top up when the bank is short) */
  const selPts = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-pt:checked'), function (cb) {
    selPts.push(cb.value);
  });
  let pool = [];
  try {
    const bankQs = await asV2FetchBank(selPts);
    /* filter bank by selected levels/types/difficulty */
    const selLvls = {};
    Array.prototype.forEach.call(document.querySelectorAll('.as-v2-lv:checked'), function (cb) { selLvls[cb.value] = true; });
    const selTypes = {};
    Array.prototype.forEach.call(document.querySelectorAll('.as-v2-type:checked'), function (cb) { selTypes[cb.value] = true; });
    const diffEl = document.querySelector('input[name="as-v2-diff"]:checked');
    const diff = diffEl ? diffEl.value : 'mixed';
    bankQs.forEach(function (ex) {
      const exLv = String(ex.level || '').toLowerCase();
      if (!selLvls[exLv]) return;
      if (!selTypes[ex.type || 'mcq']) return;
      if (diff === 'easy' && ex.difficulty !== 1) return;
      if (diff === 'hard' && ex.difficulty !== 3) return;
      pool.push(ex);
    });
  } catch (e) {}
  if (pool.length < count) {
    /* top up with site exercises only */
    const seen = {};
    pool.forEach(function (ex) { seen[ex.id] = true; });
    asV2GetPool().forEach(function (ex) {
      if (!seen[ex.id]) { pool.push(ex); seen[ex.id] = true; }
    });
  }
  if (!pool.length) { err('No questions available for this selection.'); return; }
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  /* spread evenly across points */
  const byPoint = {};
  pool.forEach(function (ex) {
    (ex.points || ['_none']).forEach(function (pid) {
      (byPoint[pid] = byPoint[pid] || []).push(ex);
    });
  });
  const ptIds = Object.keys(byPoint);
  const picked = [];
  const seen = {};
  let round = 0;
  while (picked.length < count && round < 10) {
    let added = false;
    /* shuffle point order each round */
    shuffleArr(ptIds.slice()).forEach(function (pid) {
      if (picked.length >= count) return;
      const avail = shuffleArr(byPoint[pid].filter(function (ex) { return !seen[ex.id]; }));
      if (avail.length) {
        seen[avail[0].id] = true;
        picked.push(avail[0]);
        added = true;
      }
    });
    if (!added) break;
    round++;
  }
  if (picked.length < count) {
    /* pool too small - warn but continue */
    err('Only ' + picked.length + ' questions available for this selection.');
  }
  /* build snapshots */
  const isFamily = asTopicVal().indexOf('v2family:') === 0;
  const topicSlug = isFamily ? 'mixed' : slugs[0];
  const t = V2_TOPICS[slugs[0]];
  const topicLabel = isFamily ? 'Mixed (' + slugs.length + ' topics)' : (t ? t.h1 : slugs[0]);
  /* levels from selection */
  const lvls = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-lv:checked'), function (cb) {
    lvls.push(cb.value);
  });
  const questions = shuffleArr(picked).map(function (ex) {
    return asV2SnapshotQ(ex, slugs[0]);
  });
  const title = '📝 ' + topicLabel + ' (' + lvls.map(function (l) { return l.toUpperCase(); }).join(',') + ')';
  const noteEl = document.getElementById('as-note');
  const dlEl = document.getElementById('as-deadline');
  const note = noteEl ? noteEl.value.trim() : '';
  const deadline = dlEl && dlEl.value ? dlEl.value : null;
  btn.textContent = 'Sending…';
  try {
    const ins = await sb.from('assignments').insert({
      teacher_id: tchViewId(),
      teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
      kind: 'homework', title: title,
      level: lvls.join(','),
      topic: topicSlug, topic_label: topicLabel,
      question_count: questions.length, questions: questions,
      student_ids: targets.map(function (s) { return s.user_id; }),
      note: note || null, deadline: deadline
    }).select('id').single();
    if (ins.error) throw ins.error;
    const body = '📝 Your teacher sent you homework: ' + title + ' — open Muse English to start.';
    await Promise.all(targets.map(function (s) {
      return Promise.allSettled([
        sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body }),
        sb.rpc('send_nudge', { p_student: s.user_id })
      ]);
    }));
    asComposeDone();
  } catch (e) {
    err('Could not send: ' + (e && e.message ? e.message : 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---- vocabulary assignments (2026-10-21, his order) ----
   Teacher picks a word category + levels from the 9,136-word bank; questions
   are generated from word data at send time and stored in the same
   `assignments` row shape as grammar homework/exams (topic='vocab'). */
function asSource() {
  var el = document.querySelector('input[name="as-source"]:checked');
  return el ? el.value : 'grammar';
}
function asSourceUpdate() {
  var panel = document.getElementById('as-vocab-panel');
  if (!panel) return;
  var vocab = asSource() === 'vocab';
  panel.classList.toggle('hidden', !vocab);
  var hw = document.getElementById('as-hw-fields'), ex = document.getElementById('as-exam-fields');
  var lf = document.getElementById('as-level-field');
  if (vocab) {
    if (hw) hw.classList.add('hidden');
    if (ex) ex.classList.add('hidden');
    if (lf) lf.classList.add('hidden');
  } else {
    if (lf) lf.classList.remove('hidden');
    var m = (typeof assignMode !== 'undefined') ? assignMode : 'homework';
    if (hw) hw.classList.toggle('hidden', m !== 'homework');
    if (ex) ex.classList.toggle('hidden', m !== 'exam');
  }
}
async function asVocabInit() {
  var sel = document.getElementById('as-vocab-cat');
  if (!sel) return;
  try {
    if (!state.asVocabCats) {
      var res = await fetch('/data/vocab/categories.json');
      state.asVocabCats = await res.json();
    }
    sel.innerHTML = state.asVocabCats.map(function (ct) {
      return '<option value="' + esc(ct.slug) + '">' + esc(ct.icon || '📚') + ' ' + esc(ct.title) + ' (' + ct.word_count + ' words)</option>';
    }).join('');
    asVocabPoolLoad();
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load categories</option>';
  }
}
function asVocabLevels() {
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-lv:checked'), function (cb) { out.push(cb.value); });
  return out;
}
async function asVocabPoolLoad() {
  var sel = document.getElementById('as-vocab-cat');
  var host = document.getElementById('as-vocab-words');
  var info = document.getElementById('as-vocab-poolinfo');
  if (!sel || !host) return;
  var slug = sel.value;
  var lvls = asVocabLevels();
  if (!slug) { host.innerHTML = '<div class="empty">Pick a category to see its words.</div>'; state.asVocabPool = []; return; }
  if (!lvls.length) { host.innerHTML = '<div class="empty">Pick at least one level.</div>'; if (info) info.textContent = ''; state.asVocabPool = []; return; }
  host.innerHTML = '<div class="empty">Loading words…</div>';
  try {
    var res = await fetch('/data/vocab/by-category/' + slug + '.json');
    var words = await res.json();
    var pool = words.filter(function (w) {
      return (w.levels || []).some(function (l) { return lvls.indexOf(String(l).toLowerCase()) !== -1; });
    });
    state.asVocabPool = pool;
    state.asVocabCatWords = words;
    if (!pool.length) {
      if (info) info.textContent = '';
      host.innerHTML = '<div class="empty">No words at these levels in this category.</div>';
      return;
    }
    host.innerHTML = pool.map(function (w, i) {
      return '<label class="as-vw"><input type="checkbox" class="as-vocab-word" value="' + i + '" checked> ' +
        '<b>' + esc(w.word) + '</b> <span class="muted">' + esc((w.levels || []).join('/').toUpperCase()) + ' · ' + esc(w.meaning_fa || w.meaning_en || '') + '</span></label>';
    }).join('');
    asVocabSelCount();
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load words for this category.</div>';
  }
}
function asVocabSelCount() {
  var info = document.getElementById('as-vocab-poolinfo');
  var pool = state.asVocabPool || [];
  if (!info || !pool.length) return;
  var n = document.querySelectorAll('.as-vocab-word:checked').length;
  info.textContent = n + ' of ' + pool.length + ' words selected.';
}
function asVocabSelectedWords() {
  var pool = state.asVocabPool || [];
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-word:checked'), function (cb) {
    var w = pool[parseInt(cb.value, 10)];
    if (w) out.push(w);
  });
  return out;
}
var VOCAB_LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
function vocabMaxLevel(w) {
  var best = 'a1', br = 0;
  (w.levels || []).forEach(function (l) {
    var r = VOCAB_LV_RANK[String(l).toLowerCase()] || 0;
    if (r > br) { br = r; best = String(l).toLowerCase(); }
  });
  return best;
}
function vocabMeaning(w) {
  /* fa for A1/A2 words, en for B1+ — same rule as the vocab practice quiz */
  var lv = vocabMaxLevel(w);
  return (lv === 'a1' || lv === 'a2') ? (w.meaning_fa || w.meaning_en || '') : (w.meaning_en || w.meaning_fa || '');
}
function vocabSlugOf(w) { return String(w.word || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function vocabDistractors(target, samePool, anyPool, mode, field) {
  var seen = {};
  seen[field(target)] = true;
  var picks = [];
  var take = function (src) {
    shuffleArr((src || []).slice()).forEach(function (w) {
      if (picks.length >= 3) return;
      if (!w || w.word === target.word) return;
      var v = field(w);
      if (!v || seen[v]) return;
      seen[v] = true;
      picks.push(v);
    });
  };
  if (mode === 'any') { take(anyPool); take(samePool); } else { take(samePool); take(anyPool); }
  return picks;
}
function vocabGapSentence(w) {
  var sents = [w.example_en].concat(w.examples_extra || []);
  var word = String(w.word || '');
  if (!word) return null;
  for (var i = 0; i < sents.length; i++) {
    var s = sents[i];
    if (!s) continue;
    var idx = s.toLowerCase().indexOf(word.toLowerCase());
    if (idx !== -1) return s.slice(0, idx) + '___' + s.slice(idx + word.length);
  }
  return null;
}
function genVocabQuestions(selected, opts) {
  var types = opts.types.length ? opts.types : ['meaning'];
  var samePool = state.asVocabCatWords || selected;
  var anyPool = opts.anyPool || [];
  var words = shuffleArr(selected.slice());
  var qs = [];
  var ti = 0, wi = 0;
  while (qs.length < opts.count && wi < words.length * 2) {
    var w = words[wi % words.length];
    wi++;
    var type = types[ti % types.length];
    ti++;
    var q = null;
    if (type === 'meaning') {
      var m = vocabMeaning(w);
      var ds = vocabDistractors(w, samePool, anyPool, opts.dist, vocabMeaning);
      if (m && ds.length === 3) {
        var o1 = shuffleArr([m].concat(ds));
        q = { type: 'mcq', q: 'What does "' + w.word + '" mean?', options: o1, answer: o1.indexOf(m) };
      }
    } else if (type === 'reverse') {
      var m2 = vocabMeaning(w);
      var ds2 = vocabDistractors(w, samePool, anyPool, opts.dist, function (x) { return x.word; });
      if (m2 && ds2.length === 3) {
        var o2 = shuffleArr([w.word].concat(ds2));
        q = { type: 'mcq', q: 'Which word means "' + m2 + '"?', options: o2, answer: o2.indexOf(w.word) };
      }
    } else if (type === 'gap') {
      var sent = vocabGapSentence(w);
      var ds3 = vocabDistractors(w, samePool, anyPool, opts.dist, function (x) { return x.word; });
      if (sent && ds3.length === 3) {
        var o3 = shuffleArr([w.word].concat(ds3));
        q = { type: 'mcq', q: 'Choose the missing word: ' + sent, options: o3, answer: o3.indexOf(w.word) };
      }
    } else if (type === 'listen') {
      var ds4 = vocabDistractors(w, samePool, anyPool, opts.dist, function (x) { return x.word; });
      if (w.audio && ds4.length === 3) {
        var o4 = shuffleArr([w.word].concat(ds4));
        q = { type: 'listen', q: '🎧 Listen — which word do you hear?', audio: w.audio, options: o4, answer: o4.indexOf(w.word) };
      }
    }
    if (q) {
      q.id = 'vocab:' + vocabSlugOf(w) + ':' + type + ':' + qs.length;
      q.prompt = q.q;
      q.word = w.word;
      q.level = vocabMaxLevel(w);
      q.topic_label = opts.catTitle;
      q.explanation = w.word + ' — ' + (w.meaning_en || '') + (w.meaning_fa ? ' · ' + w.meaning_fa : '') +
        (w.example_en ? ' Example: ' + w.example_en : '');
      qs.push(q);
    }
  }
  return qs;
}
async function createVocabAssignment(btn, ctx) {
  var err = ctx.err, targets = ctx.targets, orig = ctx.orig;
  var catSel = document.getElementById('as-vocab-cat');
  var cat = null;
  (state.asVocabCats || []).forEach(function (x) { if (x.slug === (catSel ? catSel.value : '')) cat = x; });
  if (!cat) { err('Pick a word category.'); return; }
  var lvls = asVocabLevels();
  if (!lvls.length) { err('Pick at least one word level.'); return; }
  var selected = asVocabSelectedWords();
  if (!selected.length) { err('Select at least one word.'); return; }
  var types = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-type:checked'), function (cb) { types.push(cb.value); });
  if (!types.length) { err('Pick at least one question type.'); return; }
  var countEl = document.getElementById('as-vocab-count');
  var count = parseInt(countEl ? countEl.value : '10', 10) || 10;
  var distEl = document.querySelector('input[name="as-vocab-dist"]:checked');
  var dist = distEl ? distEl.value : 'same';
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  var anyPool = [];
  if (dist === 'any') {
    try {
      var others = (state.asVocabCats || []).filter(function (x) { return x.slug !== cat.slug; })
        .sort(function (a, b) { return (b.word_count || 0) - (a.word_count || 0); });
      if (others.length) {
        var res = await fetch('/data/vocab/by-category/' + others[0].slug + '.json');
        anyPool = await res.json();
      }
    } catch (e) {}
  }
  var questions = genVocabQuestions(selected, { count: count, types: types, dist: dist, anyPool: anyPool, catTitle: cat.title });
  if (!questions.length) {
    err('Could not build questions from this selection — try more words or question types.');
    btn.disabled = false; btn.textContent = orig;
    return;
  }
  if (questions.length < count) err('Only ' + questions.length + ' questions could be built for this selection.');
  var title = '📚 ' + cat.title + ' vocabulary (' + lvls.map(function (l) { return l.toUpperCase(); }).join(',') + ')';
  var noteEl = document.getElementById('as-note');
  var dlEl = document.getElementById('as-deadline');
  var note = noteEl ? noteEl.value.trim() : '';
  var deadline = dlEl && dlEl.value ? dlEl.value : null;
  btn.textContent = 'Sending…';
  try {
    var ins = await sb.from('assignments').insert({
      teacher_id: tchViewId(),
      teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
      kind: ctx.mode, title: title,
      level: lvls.join(','),
      topic: 'vocab', topic_label: cat.title + ' vocabulary',
      question_count: questions.length, questions: questions,
      student_ids: targets.map(function (s) { return s.user_id; }),
      note: note || null, deadline: deadline
    }).select('id').single();
    if (ins.error) throw ins.error;
    var body = '📝 Your teacher sent you ' + (ctx.mode === 'exam' ? 'an exam' : 'homework') + ': ' + title + ' — open Muse English to start.';
    await Promise.all(targets.map(function (s) {
      return Promise.allSettled([
        sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body }),
        sb.rpc('send_nudge', { p_student: s.user_id })
      ]);
    }));
    asComposeDone();
  } catch (e) {
    err('Could not send: ' + (e && e.message ? e.message : 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---- teacher: mixed-topic exam ----
   Rows of [topic × count] -> one bank fetch per topic (fail-soft: a 404 bank
   is skipped and reported) -> N sampled per topic, each tagged with its
   topic_label -> shuffled into a single exam snapshot stored in
   public.assignments with kind='exam', topic='mixed'. No new columns. */
async function createExamAssignment(btn, ctx) {
  const err = ctx.err, level = ctx.level, targets = ctx.targets, orig = ctx.orig;
  const rows = Array.prototype.slice.call(document.querySelectorAll('#as-mixrows .as2-mixrow'));
  const mix = [];
  rows.forEach(function (r) {
    let t = r.querySelector('.as-mix-topic').value;
    const c = parseInt(r.querySelector('.as-mix-count').value, 10) || 0;
    if (t && c > 0) {
      /* v2 topic values look like v2:<slug> */
      let slug = t;
      if (t.indexOf('v2:') === 0) { slug = t.slice(3); }
      mix.push({ topic: slug, count: c, raw: t });
    }
  });
  if (!mix.length) { err('Add at least one topic with at least 1 question.'); return; }
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  const settled = await Promise.all(mix.map(async function (m) {
    /* v2: bank questions for this topic's points, filtered by the exam level */
    const t = V2_TOPICS[m.topic];
    const ptIds = ((t && t.points) || []).map(function (p) { return p.id; });
    let bankQs = [];
    try { bankQs = await asV2FetchBank(ptIds); } catch (e) {}
    const lvItems = bankQs.filter(function (ex) {
      return String(ex.level || '').toLowerCase() === level;
    });
    return { m: m, bankQs: lvItems };
  }));
  const skipped = [];
  let questions = [];
  settled.forEach(function (s) {
    const qs = s.bankQs || [];
    if (!qs.length) { skipped.push(s.m.topic); return; }
    shuffleArr(qs.slice()).slice(0, Math.min(s.m.count, qs.length)).forEach(function (q) {
      questions.push(asV2SnapshotQ(q, s.m.topic));
    });
  });
  if (!questions.length) {
    err('None of the selected topics has a question bank yet.');
    btn.disabled = false; btn.textContent = orig; return;
  }
  questions = shuffleArr(questions);
  const perTopic = {};
  questions.forEach(function (q) { perTopic[q.topic_label] = (perTopic[q.topic_label] || 0) + 1; });
  const compLabel = Object.keys(perTopic).map(function (t) { return t + ' ×' + perTopic[t]; }).join(' · ');
  const title = '📋 Mixed exam (' + level.toUpperCase() + ' · ' + Object.keys(perTopic).length +
    ' topic' + (Object.keys(perTopic).length > 1 ? 's' : '') + ' · ' + questions.length + ' Q)';
  const noteEl = document.getElementById('as-note');
  const dlEl = document.getElementById('as-deadline');
  const note = noteEl ? noteEl.value.trim() : '';
  const deadline = dlEl && dlEl.value ? dlEl.value : null;
  btn.textContent = 'Sending…';
  try {
    const ins = await sb.from('assignments').insert({
      teacher_id: tchViewId(),
      teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
      kind: 'exam', title: title, level: level,
      topic: 'mixed', topic_label: compLabel,
      question_count: questions.length, questions: questions,
      student_ids: targets.map(function (s) { return s.user_id; }),
      note: note || null, deadline: deadline
    }).select('id').single();
    if (ins.error) throw ins.error;
    /* inbox regex expects: 📝 Your teacher sent you an exam: 📝 <title> — open Muse English to start. */
    const body = '📝 Your teacher sent you an exam: 📝 ' + title + ' — open Muse English to start.';
    await Promise.all(targets.map(function (s) {
      return Promise.allSettled([
        sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body }),
        sb.rpc('send_nudge', { p_student: s.user_id })
      ]);
    }));
    asComposeDone();
    if (skipped.length) alert('Exam sent, but these topics were skipped (no question bank yet):\n• ' + skipped.join('\n• '));
  } catch (e) {
    err('Could not send: ' + (e && e.message ? e.message : 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---- teacher: weekly planner ----
   One screen, seven day-rows. The teacher picks a topic per day (their call —
   topics are never auto-advanced); count/time/students default to the usual.
   Each filled row becomes one assignment with status='scheduled' + send_at.
   The assignment-sender cron delivers them on time. */
/* ---- student-local scheduling ----
   The planner time (e.g. 07:00) means 07:00 in EACH STUDENT's timezone.
   wallTimeToUtc() converts a wall-clock time on a calendar date in a given
   IANA timezone to a UTC Date (iterative offset resolution, DST-safe). */
function wallTimeToUtc(dateStr, timeStr, tz) {
  const dp = String(dateStr || '').split('-'), tp = String(timeStr || '08:00').split(':');
  const Y = +dp[0] || 2000, M = +dp[1] || 1, D = +dp[2] || 1;
  const h = +tp[0] || 0, mi = +tp[1] || 0;
  const target = Date.UTC(Y, M - 1, D, h, mi);
  let guess = target;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    for (let i = 0; i < 4; i++) {
      const parts = {};
      fmt.formatToParts(new Date(guess)).forEach(function (p) { parts[p.type] = p.value; });
      const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
        (+parts.hour) % 24, +parts.minute, +parts.second);
      const diff = target - asUtc;
      if (!diff) break;
      guess += diff;
    }
  } catch (e) { /* unknown tz -> fall back to treating the wall time as UTC */ }
  return new Date(guess);
}
function tzShort(tz) {
  return String(tz || '').split('/').pop().replace(/_/g, ' ') || '';
}
function teacherTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (e) { return 'UTC'; }
}
function dowInTz(iso, tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(iso));
    const m = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    if (s in m) return m[s];
  } catch (e) {}
  return new Date(iso).getDay();
}
function timeInTz(iso, tz) {
  try {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.hour + ':' + p.minute;
  } catch (e) { return '08:00'; }
}
/* 'Sends Mon 07:00 · Tehran' — the student-local send moment of a scheduled row. */
function schedLabel(sendAt, sendTz) {
  if (!sendTz) return '⏰ Sends ' + fmtDateTime(sendAt);
  try {
    const d = new Date(sendAt);
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: sendTz, weekday: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    return '⏰ Sends ' + parts.weekday + ' ' + parts.hour + ':' + parts.minute + ' · ' + tzShort(sendTz);
  } catch (e) { return '⏰ Sends ' + fmtDateTime(sendAt); }
}
const PLANNER_DAYS = [
  { dow: 6, label: 'شنبه · Sat' }, { dow: 0, label: 'یکشنبه · Sun' },
  { dow: 1, label: 'دوشنبه · Mon' }, { dow: 2, label: 'سه‌شنبه · Tue' },
  { dow: 3, label: 'چهارشنبه · Wed' }, { dow: 4, label: 'پنجشنبه · Thu' },
  { dow: 5, label: 'جمعه · Fri' }
];
function plannerNextDate(dow, timeStr) {
  const parts = String(timeStr || '08:00').split(':');
  const hh = parseInt(parts[0], 10) || 8, mm = parseInt(parts[1], 10) || 0;
  const now = new Date();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, hh, mm, 0);
    if (d.getDay() === dow && d.getTime() > now.getTime() + 3600000) return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, hh, mm, 0);
}
function plannerDayLabel(dow, timeStr) {
  const d = plannerNextDate(dow, timeStr || '08:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
async function renderPlanner(v) {
  if (!state.teacher) { go('become-teacher'); return; }
  await loadV2Index();
  v.innerHTML = '<div class="tch-wrap"><a class="pl-back" href="#/teacher">← Teacher dashboard</a>' +
    '<h1 class="pl-title">📅 Weekly planner</h1>' +
    '<p class="muted" style="margin-top:-0.4rem">Pick a topic for each day — the rest uses your usual settings. Empty days are skipped.</p>' +
    '<div id="pl-body"><div class="empty">Loading…</div></div></div>';
  window.scrollTo(0, 0);
  try {
    if (!state.teacherStudents) {
      const r = await sb.rpc('get_my_students');
      if (r.error) throw r.error;
      state.teacherStudents = r.data || [];
    }
    const list = state.teacherStudents || [];
    if (!list.length) {
      document.getElementById('pl-body').innerHTML =
        '<div class="empty">You have no students yet — share your invite link first. 🌱</div>';
      return;
    }
    const lastMap = await plannerLastMap();
    const schedMap = await plannerSchedMap();
    /* If every scheduled day shares one level, start the week on that level. */
    const schedLevels = {};
    Object.keys(schedMap).forEach(function (d) { if (schedMap[d].level) schedLevels[schedMap[d].level] = 1; });
    const schedLevelKeys = Object.keys(schedLevels);
    const startLevel = schedLevelKeys.length === 1 ? schedLevelKeys[0] : 'a2';
    const host = document.getElementById('pl-body');
    host.innerHTML = '<div class="as2"><div class="card pl-card">' +
      '<div class="field"><label for="pl-level">Level <span class="as2-opt">(whole week)</span></label>' +
      '<select id="pl-level" class="input">' +
      ASSIGN_LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (lv === startLevel ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Students <span class="pl-selwrap"><button type="button" class="pl-selbtn" id="pl-select-all">Select all</button> · <button type="button" class="pl-selbtn" id="pl-deselect-all">Deselect all</button></span></label><div class="as2-students">' +
      '<label class="chk"><input type="checkbox" id="pl-all" checked> All students (' + list.length + ')</label>' +
      '<div id="pl-students" class="hidden">' +
      list.map(function (s) {
        const nm = s.display_name || (s.email || '?').split('@')[0];
        return '<label class="chk"><input type="checkbox" class="pl-st" value="' + esc(s.user_id) + '" checked> ' + esc(nm) + '</label>';
      }).join('') + '</div></div></div>' +
      '<div id="pl-days">' + PLANNER_DAYS.map(function (dy) {
        return '<div class="pl-day" data-dow="' + dy.dow + '">' +
          '<div class="pl-dayhead"><b>' + dy.label + '</b>' +
          '<span class="muted pl-date" data-dow="' + dy.dow + '">' + plannerDayLabel(dy.dow, '08:00') + '</span>' +
          (lastMap[dy.dow] ? '<span class="pl-last">Last: ' + esc(lastMap[dy.dow]) + '</span>' : '') + '</div>' +
          '<div class="pl-row">' +
          '<select class="input pl-topic" data-dow="' + dy.dow + '" aria-label="Topic"><option value="">— no homework —</option></select>' +
          '<select class="input pl-count" data-dow="' + dy.dow + '" aria-label="Questions">' +
          [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (n === 10 ? ' selected' : '') + '>' + n + ' Q</option>'; }).join('') +
          '</select>' +
          '<input type="time" class="input pl-time" data-dow="' + dy.dow + '" value="08:00" aria-label="Send time">' +
          '</div><div class="pl-sched muted" data-dow="' + dy.dow + '"></div></div>';
      }).join('') + '</div>' +
      '<div class="form-error" id="pl-error" role="alert"></div>' +
      '<button class="as2-send" data-action="planner-save">⏰ Schedule week</button>' +
      '</div></div>';
    plannerFillTopics();
    plannerPrefillSched(schedMap);
    document.getElementById('pl-level').addEventListener('change', plannerFillTopics);
    document.getElementById('pl-all').addEventListener('change', function () {
      document.getElementById('pl-students').classList.toggle('hidden', this.checked);
    });
    var plSelAll = document.getElementById('pl-select-all');
    if (plSelAll) plSelAll.addEventListener('click', function () {
      document.getElementById('pl-all').checked = true;
      document.getElementById('pl-students').classList.add('hidden');
      Array.prototype.forEach.call(document.querySelectorAll('.pl-st'), function (cb) { cb.checked = true; });
    });
    var plDeselAll = document.getElementById('pl-deselect-all');
    if (plDeselAll) plDeselAll.addEventListener('click', function () {
      document.getElementById('pl-all').checked = false;
      document.getElementById('pl-students').classList.remove('hidden');
      Array.prototype.forEach.call(document.querySelectorAll('.pl-st'), function (cb) { cb.checked = false; });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.pl-time'), function (t) {
      t.addEventListener('change', function () {
        const dow = parseInt(t.getAttribute('data-dow'), 10);
        const lbl = document.querySelector('.pl-date[data-dow="' + dow + '"]');
        if (lbl) lbl.textContent = plannerDayLabel(dow, t.value);
      });
    });
  } catch (e) {
    document.getElementById('pl-body').innerHTML =
      '<div class="empty">Could not load the planner: ' + esc(e.message || e) + '</div>';
  }
}
/* Pre-fill planner rows from already-scheduled days so leaving and coming
   back never looks like a reset. */
function plannerPrefillSched(schedMap) {
  Object.keys(schedMap).forEach(function (dow) {
    const g = schedMap[dow];
    const dayEl = document.querySelector('.pl-day[data-dow="' + dow + '"]');
    if (!dayEl) return;
    const topicSel = dayEl.querySelector('.pl-topic');
    if (topicSel && g.topic) {
      const hasOpt = Array.prototype.some.call(topicSel.options, function (o) { return o.value === g.topic; });
      if (hasOpt) topicSel.value = g.topic;
    }
    const countSel = dayEl.querySelector('.pl-count');
    if (countSel && g.count) countSel.value = String(g.count);
    const timeEl = dayEl.querySelector('.pl-time');
    if (timeEl && g.time) {
      timeEl.value = g.time;
      const lbl = document.querySelector('.pl-date[data-dow="' + dow + '"]');
      if (lbl) lbl.textContent = plannerDayLabel(parseInt(dow, 10), g.time);
    }
    const note = dayEl.querySelector('.pl-sched');
    if (note && g.groups.length) {
      note.textContent = '⏰ Scheduled: ' + g.time + ' · ' +
        g.groups.map(function (x) { return tzShort(x.tz) + ' (' + x.n + ')'; }).join(', ');
    }
  });
}
function plannerFillTopics() {
  Array.prototype.forEach.call(document.querySelectorAll('.pl-topic'), function (sel) {
    const cur = sel.value;
    let html = '<option value="">— no homework —</option>';
    Object.keys(V2_FAMILIES).forEach(function (famSlug) {
      const fam = V2_FAMILIES[famSlug];
      html += '<optgroup label="' + esc(fam.title) + '">';
      fam.topics.forEach(function (tslug) {
        const t = V2_TOPICS[tslug];
        if (t) html += '<option value="v2:' + esc(tslug) + '">' + esc(t.h1) + '</option>';
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    sel.value = cur;
  });
}
async function plannerLastMap() {
  const map = {};
  try {
    const r = await sb.from('assignments').select('topic_label,send_at,created_at')
      .eq('teacher_id', state.user.id).order('created_at', { ascending: false }).limit(40);
    if (r.error) throw r.error;
    (r.data || []).forEach(function (x) {
      const dow = new Date(x.send_at || x.created_at).getDay();
      if (!(dow in map) && x.topic_label) map[dow] = x.topic_label;
    });
  } catch (e) {}
  return map;
}
/* Already-scheduled (not yet sent) rows, keyed by weekday in their own
   student-local timezone: { topic, count, level, time, groups: [{tz, n}] }. */
async function plannerSchedMap() {
  const map = {};
  try {
    const r = await sb.from('assignments')
      .select('topic_label,question_count,level,send_at,send_tz,student_ids')
      .eq('teacher_id', state.user.id).eq('status', 'scheduled')
      .gt('send_at', new Date().toISOString())
      .order('send_at', { ascending: true }).limit(60);
    if (r.error) throw r.error;
    (r.data || []).forEach(function (x) {
      const tz = x.send_tz || teacherTz();
      const dow = dowInTz(x.send_at, tz);
      const g = (map[dow] = map[dow] || {
        topic: x.topic_label, count: x.question_count || 10, level: x.level,
        time: timeInTz(x.send_at, tz), groups: []
      });
      g.groups.push({ tz: tz, n: (x.student_ids || []).length });
    });
  } catch (e) {}
  return map;
}
async function savePlanner(btn) {
  const errBox = document.getElementById('pl-error');
  const err = function (m) { if (errBox) errBox.textContent = m; };
  err('');
  const level = document.getElementById('pl-level').value;
  const roster = state.teacherStudents || [];
  const useAll = document.getElementById('pl-all').checked;
  const targets = useAll ? roster.slice() : roster.filter(function (s) {
    const cb = document.querySelector('.pl-st[value="' + s.user_id + '"]');
    return cb && cb.checked;
  });
  if (!targets.length) { err('Pick at least one student.'); return; }
  /* Group students by timezone (unknown -> teacher's). The picked time means
     that local time for each student, so each group gets its own send_at. */
  const tTz = teacherTz();
  const groups = {};
  targets.forEach(function (s) {
    const tz = s.timezone || tTz;
    (groups[tz] = groups[tz] || []).push(s);
  });
  const tzList = Object.keys(groups);
  const rows = [];
  Array.prototype.forEach.call(document.querySelectorAll('.pl-day'), function (dayEl) {
    const topic = dayEl.querySelector('.pl-topic').value;
    if (!topic) return;
    const dow = parseInt(dayEl.getAttribute('data-dow'), 10);
    const timeStr = dayEl.querySelector('.pl-time').value || '08:00';
    const d = plannerNextDate(dow, timeStr);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    rows.push({
      dow: dow, topic: topic, dateStr: dateStr, timeStr: timeStr,
      count: parseInt(dayEl.querySelector('.pl-count').value, 10) || 10
    });
  });
  btn.disabled = true;
  const orig = btn.textContent;
  try {
    /* Replace semantics: cancel this teacher's still-pending scheduled rows
       first, so the planner always reflects the current plan (and re-saving
       never duplicates). Rows already due stay for the sender.
       NOTE: this runs even when every day is "no homework", so clearing the
       whole week actually clears the schedule. */
    btn.textContent = 'Clearing old schedule…';
    try {
      const old = await sb.from('assignments').select('id')
        .eq('teacher_id', state.user.id).eq('status', 'scheduled')
        .gt('send_at', new Date().toISOString()).limit(100);
      const ids = (old.data || []).map(function (x) { return x.id; });
      if (ids.length) {
        const del = await sb.from('assignments').delete().in('id', ids);
        if (del.error) throw del.error;
      }
    } catch (e2) { /* pre-migration or RLS: continue, worst case duplicates */ }
    if (!rows.length) {
      document.getElementById('pl-body').innerHTML =
        '<div class="card pl-done"><div class="pl-done-ico">✅</div><h2>Schedule cleared!</h2>' +
        '<p class="muted">All pending scheduled assignments were removed.</p>' +
        '<a class="btn btn-block" href="#/teacher">← Back to dashboard</a></div>';
      window.scrollTo(0, 0);
      return;
    }
    let n = 0;
    const total = rows.length * tzList.length;
    for (const r of rows) {
      /* v2 topic value looks like v2:<slug> */
      const slug = r.topic.indexOf('v2:') === 0 ? r.topic.slice(3) : r.topic;
      const t = V2_TOPICS[slug];
      const ptIds = ((t && t.points) || []).map(function (p) { return p.id; });
      let bankQs = [];
      try { bankQs = await asV2FetchBank(ptIds); } catch (e) {}
      const lvItems = bankQs.filter(function (ex) {
        return String(ex.level || '').toLowerCase() === level;
      });
      const picked = shuffleArr(lvItems.slice()).slice(0, Math.min(r.count, lvItems.length));
      if (!picked.length) throw new Error('empty');
      const questions = picked.map(function (ex) { return asV2SnapshotQ(ex, slug); });
      const topicLabel = t ? t.h1 : slug;
      for (const tz of tzList) {
        btn.textContent = 'Scheduling ' + (++n) + '/' + total + '…';
        const sendAt = wallTimeToUtc(r.dateStr, r.timeStr, tz);
        const ins = await sb.from('assignments').insert({
          teacher_id: tchViewId(),
          teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
          kind: 'homework', title: '📝 ' + topicLabel + ' (' + level.toUpperCase() + ')',
          level: level, topic: slug, topic_label: topicLabel,
          question_count: questions.length, questions: questions,
          student_ids: groups[tz].map(function (s) { return s.user_id; }),
          note: null, deadline: null,
          status: 'scheduled', send_at: sendAt.toISOString(), send_tz: tz
        });
        if (ins.error) throw ins.error;
      }
    }
    const gNote = tzList.length > 1
      ? ' Each day goes out at ' + esc(rows[0].timeStr) + ' in every student\'s own timezone (' +
        tzList.map(tzShort).map(esc).join(', ') + ').'
      : ' Each day goes out at ' + esc(rows[0].timeStr) + ' ' + esc(tzShort(tzList[0])) + ' time.';
    document.getElementById('pl-body').innerHTML =
      '<div class="card pl-done"><div class="pl-done-ico">✅</div><h2>Week scheduled!</h2>' +
      '<p class="muted">' + rows.length + ' day' + (rows.length > 1 ? 's' : '') +
      ' scheduled (' + total + ' send' + (total > 1 ? 's' : '') + ').' + gNote + '</p>' +
      '<a class="btn btn-block" href="#/teacher">← Back to dashboard</a></div>';
    window.scrollTo(0, 0);
  } catch (e) {
    const msg = (e && e.message) || '';
    err(/column|schema/i.test(msg)
      ? 'The planner migration has not been run yet — run supabase-planner-tz-migration.sql first.'
      : 'Could not schedule: ' + (msg || 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---------------- learning analytics ----------------
   One data pack per student, built only from tables the caller can already
   read (RLS). It feeds BOTH the in-app charts and the /api/report LLM.
   - student: assignments+results, quiz_attempts, mistakes, streak
   - teacher viewing a student: the teacher's own assignments+results for
     that student (quiz_attempts/mistakes are user-private by RLS) */
async function buildStudentPack(studentId, forTeacher, name) {
  const pack = { name: name || '', periodDays: 30, assignments: [], topicAccuracy: [] };
  try {
    let aq = sb.from('assignments')
      .select('id,title,topic_label,level,created_at,questions')
      .contains('student_ids', [studentId])
      .order('created_at', { ascending: false }).limit(40);
    if (forTeacher && state.user) aq = aq.eq('teacher_id', tchViewId());
    const a = await aq;
    if (a.error) throw a.error;
    const assigns = (a.data || []).filter(function (x) { return x.status !== 'scheduled'; });
    const byId = {};
    assigns.forEach(function (x) { byId[x.id] = x; });
    const ids = assigns.map(function (x) { return x.id; });
    let results = [];
    if (ids.length) {
      let rq = sb.from('assignment_results')
        .select('assignment_id,score,total,answers,completed_at')
        .in('assignment_id', ids).order('completed_at', { ascending: false });
      rq = rq.eq('student_id', studentId);
      const r = await rq;
      if (!r.error) results = r.data || [];
    }
    const tacc = {};
    pack.assignments = results.slice(0, 20).map(function (r) {
      const asg = byId[r.assignment_id] || {};
      const qs = asg.questions || [];
      const topic = asg.topic_label || asg.level || '';
      (r.answers || []).forEach(function (an) {
        const t = tacc[topic] || (tacc[topic] = { topic: topic, correct: 0, total: 0 });
        t.total++;
        if (an && an.picked === an.correct) t.correct++;
      });
      const wrong = [];
      (r.answers || []).forEach(function (an, i) {
        if (wrong.length >= 5 || !an || an.picked === an.correct || !qs[i]) return;
        wrong.push({
          q: String(qs[i].q || '').slice(0, 140),
          picked: String((qs[i].options || [])[an.picked] || '').slice(0, 60),
          correct: String((qs[i].options || [])[an.correct] || '').slice(0, 60)
        });
      });
      return {
        topic: topic, level: asg.level || '',
        date: String(r.completed_at || '').slice(0, 10),
        score: r.score, total: r.total, wrong: wrong
      };
    });
    pack.topicAccuracy = Object.keys(tacc).map(function (k) { return tacc[k]; })
      .sort(function (x, y) { return (x.correct / x.total) - (y.correct / y.total); })
      .slice(0, 12);
    /* quiz attempts + open mistakes: the student's own pack always has them;
       a teacher's pack has them once supabase-teacher-read-migration.sql is run
       (RLS denies quietly before that — the catches keep the pack working). */
    try {
      const q = await sb.from('quiz_attempts').select('date,kind,score,total')
        .eq('user_id', studentId).order('created_at', { ascending: false }).limit(40);
      pack.quizTrend = (q.data || []).map(function (x) {
        return { date: String(x.date || '').slice(0, 10), kind: x.kind || '', score: x.score, total: x.total };
      });
    } catch (e) {}
    try {
      const m = await sb.from('mistakes').select('question,kind')
        .eq('user_id', studentId).order('created_at', { ascending: false }).limit(12);
      pack.openMistakes = (m.data || []).map(function (x) {
        return { q: String(x.question || '').slice(0, 120), kind: x.kind || '' };
      });
    } catch (e) {}
  } catch (e) { pack.error = String((e && e.message) || e).slice(0, 120); }
  return pack;
}
/* Simple SVG trend chart: points = [{label, pct}] oldest -> newest */
function trendChartHTML(points) {
  if (!points || points.length < 2) return '';
  const W = 320, H = 90, P = 8;
  const n = points.length;
  const xs = function (i) { return P + (i * (W - 2 * P)) / Math.max(1, n - 1); };
  const ys = function (p) { return H - P - (Math.max(0, Math.min(100, p)) / 100) * (H - 2 * P); };
  const line = points.map(function (pt, i) { return xs(i).toFixed(1) + ',' + ys(pt.pct).toFixed(1); }).join(' ');
  const dots = points.map(function (pt, i) {
    return '<circle cx="' + xs(i).toFixed(1) + '" cy="' + ys(pt.pct).toFixed(1) + '" r="3.2" fill="#f59e0b"/>';
  }).join('');
  return '<svg class="an-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score trend">' +
    '<polyline points="' + line + '" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/>' + dots +
    '<text x="' + P + '" y="' + (H - 1) + '" class="an-cl">' + esc(points[0].label) + '</text>' +
    '<text x="' + (W - P) + '" y="' + (H - 1) + '" class="an-cl an-cr">' + esc(points[n - 1].label) + '</text></svg>';
}
function topicBarsHTML(tacc) {
  if (!tacc || !tacc.length) return '';
  return '<div class="an-bars">' + tacc.map(function (t) {
    const pct = t.total ? Math.round((t.correct / t.total) * 100) : 0;
    const cls = pct >= 80 ? 'g' : pct >= 55 ? 'y' : 'r';
    return '<div class="an-barrow"><span class="an-btopic">' + esc(t.topic) + '</span>' +
      '<span class="an-bartrack"><span class="an-barfill ' + cls + '" style="width:' + pct + '%"></span></span>' +
      '<span class="an-bpct">' + pct + '%</span></div>';
  }).join('') + '</div>';
}
function quizKindLabel(k) {
  return k === 'word' ? 'Word quiz' : k === 'grammar' ? 'Grammar quiz'
    : k === 'mistakes' ? 'Mistake review' : k === 'assignment' ? 'Homework' : (k || 'Quiz');
}
function reportTextHTML(text) {  return esc(text).split(/\n{2,}/).map(function (para) {
    return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}
async function requestAIReport(kind, pack, btn) {
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ در حال تهیه‌ی گزارش…'; }
  try {
    const r = await fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, pack: pack })
    });
    const d = await r.json().catch(function () { return null; });
    if (!r.ok || !d || !d.report) throw new Error((d && d.error) || 'failed');
    showModal('<div class="rpt"><div class="rpt-head">🤖 گزارش پیشرفت</div>' +
      '<div class="rpt-body">' + reportTextHTML(d.report) + '</div>' +
      '<button class="btn btn-ghost btn-block" data-action="modal-close">بستن</button></div>');
  } catch (e) {
    showModal('<div class="rpt"><div class="rpt-head">🤖 گزارش پیشرفت</div>' +
      '<div class="empty">نتونستم گزارش رو بسازم — ' + esc(e.message || 'دوباره تلاش کن.') + '</div>' +
      '<button class="btn btn-ghost btn-block" data-action="modal-close">بستن</button></div>');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

/* ---- teacher: assignment list + results ---- */
async function loadTeacherAssignments() {
  const host = document.getElementById('tch-assign');
  if (!host || !(state.teacher || state.viewTeacher)) return;
  /* roster may not have loaded yet (parallel init) — fetch for name mapping */
  if (!state.teacherStudents && state.teacher && !state.viewTeacher) {
    try {
      const rr = await sb.rpc('get_my_students');
      if (!rr.error) state.teacherStudents = rr.data || [];
    } catch (e) {}
  }
  try {
    let a;
    try {
      a = await sb.from('assignments')
        .select('id,kind,title,created_at,deadline,student_ids,question_count,status,send_at,send_tz')
        .eq('teacher_id', tchViewId()).order('created_at', { ascending: false }).limit(30);
      if (a.error) throw a.error;
    } catch (e2) {
      /* pre-scheduling-migration fallback */
      a = await sb.from('assignments')
        .select('id,kind,title,created_at,deadline,student_ids,question_count')
        .eq('teacher_id', tchViewId()).order('created_at', { ascending: false }).limit(30);
    }
    if (a.error) throw a.error;
    const rows = a.data || [];
    state.teacherAssignments = rows;
    if (!rows.length) { host.innerHTML = ''; return; }
    let doneMap = {};
    try {
      const r = await sb.from('assignment_results').select('assignment_id,student_id')
        .in('assignment_id', rows.map(function (x) { return x.id; }));
      (r.data || []).forEach(function (x) {
        (doneMap[x.assignment_id] = doneMap[x.assignment_id] || []).push(x.student_id);
      });
    } catch (e) {}
    /* ---- grouped by student (2026-10-11) ---- */
    const roster = state.teacherStudents || [];
    const nameOf = {};
    roster.forEach(function (s) { nameOf[s.user_id] = s.display_name || (s.email || '?').split('@')[0]; });
    const now = Date.now();
    const groups = {}; /* uid -> {name, items:[{i,x,overdue,doneFor}]} */
    rows.forEach(function (x, i) {
      const doneIds = doneMap[x.id] || [];
      (x.student_ids || []).forEach(function (uid) {
        const g = groups[uid] || (groups[uid] = { name: nameOf[uid] || '—', items: [] });
        const doneFor = doneIds.indexOf(uid) !== -1;
        const overdue = !doneFor && x.status !== 'scheduled' && x.deadline && new Date(x.deadline).getTime() < now;
        g.items.push({ i: i, x: x, overdue: !!overdue, doneFor: doneFor });
      });
    });
    const gids = Object.keys(groups);
    /* sort: overdue first, then most pending, then name */
    gids.sort(function (a, b) {
      const ga = groups[a], gb = groups[b];
      const oa = ga.items.filter(function (t) { return t.overdue; }).length;
      const ob = gb.items.filter(function (t) { return t.overdue; }).length;
      if (ob !== oa) return ob - oa;
      const pa = ga.items.filter(function (t) { return !t.doneFor; }).length;
      const pb = gb.items.filter(function (t) { return !t.doneFor; }).length;
      if (pb !== pa) return pb - pa;
      return String(ga.name).localeCompare(String(gb.name));
    });
    const collapsed = state._asCollapsed || (state._asCollapsed = {});
    host.innerHTML = '<div class="section-title"><h2>📝 Assignments</h2>' +
      '<button class="btn btn-sm" data-action="ai-report-class">🤖 Class report</button></div>' +
      gids.map(function (uid) {
        const g = groups[uid];
        const pend = g.items.filter(function (t) { return !t.doneFor && t.x.status !== 'scheduled'; }).length;
        const over = g.items.filter(function (t) { return t.overdue; }).length;
        const schedN = g.items.filter(function (t) { return t.x.status === 'scheduled'; }).length;
        const isCol = !!collapsed[uid];
        const initial = (g.name || '?').charAt(0).toUpperCase();
        const badges = (over ? '<span class="as-badge as-bad-over">' + over + ' overdue</span>' : '') +
          (pend ? '<span class="as-badge">' + pend + ' pending</span>' : '') +
          (schedN ? '<span class="as-badge as-bad-sched">' + schedN + ' scheduled</span>' : '') +
          (!pend && !over && !schedN ? '<span class="as-badge as-bad-done">all done ✓</span>' : '');
        const bodyRows = g.items.map(function (t) {
          const x = t.x, sched = x.status === 'scheduled';
          const meta = sched && x.send_at
            ? schedLabel(x.send_at, x.send_tz)
            : esc(fmtDate(new Date(x.created_at))) +
              (t.doneFor ? ' · <b class="ok">done ✓</b>' : (t.overdue ? ' · <b class="as-over-txt">overdue ⏰</b>' : ''));
          return '<button class="as-row' + (sched ? ' as-sched' : '') + (t.overdue ? ' as-overdue' : '') +
            '" data-action="assignment-open" data-i="' + t.i + '">' +
            '<span class="as-ico">' + (sched ? '⏰' : (x.kind === 'exam' ? '📋' : '📝')) + '</span>' +
            '<span class="as-main"><span class="as-title">' + esc(x.title) + '</span>' +
            '<span class="as-meta">' + meta + '</span></span>' +
            '<span class="as-go">→</span></button>';
        }).join('');
        return '<div class="as-student' + (isCol ? ' as-collapsed' : '') + '">' +
          '<button class="as-student-head" data-action="as-toggle" data-uid="' + esc(uid) + '">' +
          '<span class="as-avatar">' + esc(initial) + '</span>' +
          '<span class="as-sname">' + esc(g.name) + '</span>' +
          '<span class="as-badges">' + badges + '</span>' +
          '<span class="as-caret">' + (isCol ? '▸' : '▾') + '</span></button>' +
          '<div class="as-student-body">' + bodyRows + '</div></div>';
      }).join('');
  } catch (e) { host.innerHTML = ''; }
}

/* ---- admin: view any teacher's panel (read-only) ---- */
function renderAdminTeacherView(v, teacherId) {
  state.viewTeacher = null;
  state.teacherStudents = null;
  state._tSent = {};
  v.innerHTML = '<div class="tch-wrap">' +
    '<a class="pl-back" href="#/admin">← Admin</a>' +
    '<div id="vat-head"><div class="empty">Loading teacher…</div></div>' +
    '<div id="tch-weekly"></div>' +
    '<div id="tch-daily"></div>' +
    '<div id="tch-assign"></div>' +
    '<div class="section-title"><h2>Students <span id="tch-count" class="muted"></span></h2></div>' +
    '<div id="tch-roster"><div class="empty">Loading…</div></div>' +
    '<div id="tch-detail"></div>' +
  '</div>';
  loadAdminTeacherView(teacherId);
}
async function loadAdminTeacherView(teacherId) {
  const head = document.getElementById('vat-head');
  const rosterHost = document.getElementById('tch-roster');
  try {
    if (!teacherId) throw new Error('no teacher selected');
    const t = await sb.from('teachers').select('user_id,ref_code,display_name,status')
      .eq('user_id', teacherId).maybeSingle();
    if (t.error) throw t.error;
    if (!t.data) throw new Error('teacher not found');
    const teacher = t.data;
    state.viewTeacher = { user_id: teacher.user_id, display_name: teacher.display_name, ref_code: teacher.ref_code };
    head.innerHTML = '<div class="card"><div class="tch-weekly-title">👁 ' + esc(teacher.display_name) + '’s panel</div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0">Read-only admin view — actions are disabled.</p></div>';
    /* roster: students linked via the teacher's invite code.
       last_active is NOT a profiles column — derive it from daily_stats. */
    const p = await sb.from('profiles')
      .select('id,display_name,email,level,current_streak')
      .eq('referred_by', teacher.ref_code)
      .order('display_name', { ascending: true });
    if (p.error) throw p.error;
    const students = (p.data || []).map(function (u) {
      return {
        user_id: u.id, display_name: u.display_name, email: u.email, level: u.level,
        current_streak: u.current_streak || 0, last_active: null,
        xp_7d: 0, lessons_7d: 0, podcast_min_7d: 0, shadowing_7d: 0
      };
    });
    /* 7-day stats + last active day from daily_stats (one query) */
    if (students.length) {
      const ids = students.map(function (s) { return s.user_id; });
      const since = daysAgoStr(6);
      const d = await sb.from('daily_stats')
        .select('user_id,day,xp_earned,lessons_opened,podcast_seconds')
        .in('user_id', ids).order('day', { ascending: false }).limit(2000);
      if (d.error) throw d.error;
      const byId = {};
      students.forEach(function (s) { byId[s.user_id] = s; s._podSec = 0; });
      ((d && d.data) || []).forEach(function (r) {
        const s = byId[r.user_id];
        if (!s) return;
        if (!s.last_active) s.last_active = r.day; /* rows are day-desc */
        if (r.day >= since) {
          s.xp_7d += Number(r.xp_earned) || 0;
          s.lessons_7d += Number(r.lessons_opened) || 0;
          s._podSec += Number(r.podcast_seconds) || 0;
        }
      });
      students.forEach(function (s) { s.podcast_min_7d = Math.round(s._podSec / 60); delete s._podSec; });
      /* shadowing speaking attempts in the last 7 days (needs the teacher-read
         SQL migration; silently stays 0 until it is run) */
      try {
        const sinceTs = new Date(Date.now() - 6 * 864e5).toISOString();
        const att = await sb.from('shadowing_attempts').select('user_id').in('user_id', ids)
          .gte('created_at', sinceTs).limit(3000);
        if (!att.error) {
          const cnt = {};
          (att.data || []).forEach(function (r) { cnt[r.user_id] = (cnt[r.user_id] || 0) + 1; });
          students.forEach(function (s) { s.shadowing_7d = cnt[s.user_id] || 0; });
        }
      } catch (e) {}
      students.sort(function (a, b) {
        return String(b.last_active || '').localeCompare(String(a.last_active || ''));
      });
    }
    state.teacherStudents = students;
    renderTeacherRoster();
    renderTeacherWeekly();
    loadTeacherDaily();
    loadTeacherAssignments();
  } catch (e) {
    if (head) head.innerHTML = '<div class="empty">Could not load teacher panel: ' + esc((e && e.message) || e) + '</div>';
    if (rosterHost) rosterHost.innerHTML = '';
  }
}
async function openTeacherAssignment(i) {
  const r = (state.teacherAssignments || [])[i];
  if (!r) return;
  const roster = state.teacherStudents || state.twStudents || [];
  const nameOf = {};
  roster.forEach(function (s) {
    nameOf[s.user_id] = s.display_name || (s.email || '?').split('@')[0];
  });
  let results = [];
  try {
    const q = await sb.from('assignment_results')
      .select('student_id,score,total,completed_at').eq('assignment_id', r.id);
    results = q.data || [];
  } catch (e) {}
  const byId = {};
  results.forEach(function (x) { byId[x.student_id] = x; });
  const targets = (r.student_ids || []).length;
  const done = results.length;
  const sub = r.status === 'scheduled' && r.send_at
    ? esc(schedLabel(r.send_at, r.send_tz)).replace(/^⏰ /, '') + ' — not sent yet.'
    : targets + ' student' + (targets === 1 ? '' : 's') + ' · ' + done + ' completed';
  let statusBox;
  if (r.status === 'scheduled') {
    statusBox = '<div class="tw-m-status"><span class="tw-m-status-ico">⏰</span>' +
      '<div><b class="tw-m-status-t">Scheduled</b>' +
      '<p>Sends automatically at the planned time.<br>You can cancel it below.</p></div></div>';
  } else if (!done) {
    statusBox = '<div class="tw-m-status"><span class="tw-m-status-ico">⏳</span>' +
      '<div><b class="tw-m-status-t">Pending</b>' +
      '<p>No student activity yet.<br>Once students start, their progress will appear here.</p></div></div>';
  } else {
    statusBox = '<div class="tw-m-rows">' + (r.student_ids || []).map(function (uid) {
      const res = byId[uid];
      const nm = nameOf[uid] || '—';
      return '<div class="tw-m-row">' + twAvatar(nm) + '<b>' + esc(nm) + '</b>' +
        (res ? '<span class="tw-pill tw-pill-green">✓ ' + res.score + '/' + res.total + '</span>'
             : '<span class="tw-pill tw-pill-gray">⏳ pending</span>') + '</div>';
    }).join('') + '</div>';
  }
  showModal(
    '<div class="tw-modal">' +
    '<button class="tw-m-x" data-action="modal-close" aria-label="Close">✕</button>' +
    '<div class="tw-m-ill"><span class="tw-m-clip">📋</span><span class="tw-m-sp1">✨</span><span class="tw-m-sp2">✨</span></div>' +
    '<h2 class="tw-m-title">' + esc(r.title) + '</h2>' +
    '<p class="tw-m-sub">' + sub + '</p>' +
    statusBox +
    (twReadOnly() ? '<p class="muted" style="font-size:0.85rem">👁 Read-only admin view.</p>'
      : (r.status === 'scheduled'
        ? '<button class="tw-m-del" data-action="assignment-cancel" data-i="' + i + '">✕ Cancel scheduled send</button>'
        : '<button class="tw-m-del" data-action="assignment-delete" data-i="' + i + '">🗑 Delete assignment</button>')) +
    '<button class="tw-m-closebtn" data-action="modal-close">Close</button>' +
    '</div>'
  );
}

function twReadOnlyNotice() {
  showModal('<div class="tw-modal"><div class="tw-m-ill"><span class="tw-m-clip">👁</span></div>' +
    '<h2 class="tw-m-title">Read-only</h2>' +
    '<p class="tw-m-sub">You’re viewing another teacher’s dashboard.<br>Switch back to your own to make changes.</p>' +
    '<button class="tw-m-closebtn" data-action="modal-close">OK</button></div>');
}
async function deleteTeacherAssignment(i, btn) {
  if (twReadOnly()) { twReadOnlyNotice(); return; }
  const r = (state.teacherAssignments || [])[i];
  if (!r || r.status === 'scheduled') return;
  const n = (r.student_ids || []).length;
  if (!confirm('Delete "' + r.title + '"? It will be removed for all ' + n + ' students, including their inbox messages. This cannot be undone.')) return;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    /* Results first (exact link via assignment_id). */
    try { await sb.from('assignment_results').delete().eq('assignment_id', r.id); } catch (e) {}
    /* Inbox messages: body embeds the assignment title
       ('📝 Your teacher sent you homework: <title> — …'). */
    try {
      const like = '%' + String(r.title).replace(/[%_\\]/g, '\\$&') + '%';
      await sb.from('messages').delete()
        .eq('teacher_id', tchViewId())
        .in('student_id', (r.student_ids || []).length ? r.student_ids : ['00000000-0000-0000-0000-000000000000'])
        .like('body', like);
    } catch (e) {}
    /* The assignment itself (RLS: own assignments — same as cancelScheduledAssignment). */
    const d = await sb.from('assignments').delete().eq('id', r.id).eq('teacher_id', tchViewId());
    if (d.error) throw d.error;
    asComposeDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🗑 Delete assignment';
    alert('Could not delete: ' + (e.message || e));
  }
}

async function cancelScheduledAssignment(i, btn) {
  if (twReadOnly()) { twReadOnlyNotice(); return; }
  const r = (state.teacherAssignments || [])[i];
  if (!r || r.status !== 'scheduled') return;
  if (!confirm('Cancel this scheduled assignment? It will not be sent.')) return;
  btn.disabled = true;
  try {
    const d = await sb.from('assignments').delete().eq('id', r.id);
    if (d.error) throw d.error;
    asComposeDone();
  } catch (e) {
    btn.disabled = false;
    alert('Could not cancel: ' + (e.message || e));
  }
}

/* ---- student: homework card, list, player ---- */
async function refreshHomeworkCard() {
  const host = document.getElementById('home-hw-wrap');
  if (!host || !cloudReady() || !state.user || state.user.demo) return;
  try {
    let ids;
    try {
      const a = await sb.from('assignments').select('id,status')
        .contains('student_ids', [state.user.id]).limit(50);
      if (a.error) throw a.error;
      ids = (a.data || []).filter(function (x) { return x.status !== 'scheduled'; }).map(function (x) { return x.id; });
    } catch (e2) {
      /* pre-scheduling-migration fallback */
      const a = await sb.from('assignments').select('id')
        .contains('student_ids', [state.user.id]).limit(50);
      ids = (a.data || []).map(function (x) { return x.id; });
    }
    if (!ids.length) { host.innerHTML = ''; return; }
    const r = await sb.from('assignment_results').select('assignment_id')
      .eq('student_id', state.user.id).in('assignment_id', ids);
    const done = {};
    (r.data || []).forEach(function (x) { done[x.assignment_id] = true; });
    const pending = ids.filter(function (id) { return !done[id]; }).length;
    host.innerHTML = pending
      ? '<a class="hw-banner" href="#/homework" aria-label="Open homework">📝 <b>' + pending + '</b> assignment' +
        (pending > 1 ? 's' : '') + ' from your teacher <span>→</span></a>'
      : '';
  } catch (e) { /* leave empty on failure */ }
}
async function renderHomework(v) {
  v.innerHTML = '<div class="hw2-wrap"><h1 class="hw2-title"><span aria-hidden="true">📝</span> Homework</h1>' +
    '<div id="hw-list"><div class="empty">Loading…</div></div></div>';
  window.scrollTo(0, 0);
  if (!cloudReady()) {
    document.getElementById('hw-list').innerHTML = '<div class="empty">Sign in to see your assignments.</div>';
    return;
  }
  try {
    const a = await sb.from('assignments').select('*')
      .contains('student_ids', [state.user.id]).order('created_at', { ascending: false }).limit(30);
    let rows = a.data || [];
    /* scheduled (not yet sent) assignments stay invisible until send time.
       JS-side filter: safe before the scheduling migration is run. */
    rows = rows.filter(function (x) { return x.status !== 'scheduled'; });
    const r = await sb.from('assignment_results')
      .select('assignment_id,score,total,completed_at').eq('student_id', state.user.id);
    const done = {};
    (r.data || []).forEach(function (x) { done[x.assignment_id] = x; });
    state.homeworkList = rows;
    const host = document.getElementById('hw-list');
    if (!host) return;
    host.innerHTML = rows.length ? rows.map(function (x, i) {
      const res = done[x.id];
      const lvl = (x.level || '').toUpperCase();
      const isExam = x.kind === 'exam';
      const kindIco = isExam ? '📋' : '📝';
      const name = x.topic_label || x.title;
      return '<div class="hw2-card">' +
        '<div class="hw2-deco" aria-hidden="true">' +
        '<svg viewBox="0 0 220 150"><g fill="none" stroke="#d97b2b" stroke-width="5" stroke-linecap="round" opacity="0.10">' +
        '<path d="M110 45 C 90 32, 60 32, 40 40 L40 115 C 60 107, 90 107, 110 120 C 130 107, 160 107, 180 115 L180 40 C 160 32, 130 32, 110 45 Z"/>' +
        '<path d="M110 45 L110 120"/></g>' +
        '<g stroke="#d97b2b" stroke-width="4" stroke-linecap="round" opacity="0.14">' +
        '<path d="M170 22 l0 14 M163 29 l14 0"/><path d="M196 62 l0 10 M191 67 l10 0"/></g></svg></div>' +
        '<div class="hw2-top"><span class="hw2-ico">' + kindIco + '</span>' +
        '<div class="hw2-head"><div class="hw2-name">' + esc(name) + '</div>' +
        (lvl ? '<span class="hw2-lvl">' + esc(lvl) + '</span>' : '') +
        (isExam ? '<span class="hw2-lvl">EXAM</span>' : '') + '</div></div>' +
        '<div class="hw2-meta">From ' + esc(x.teacher_name || 'your teacher') +
        (x.deadline ? ' · due ' + esc(x.deadline) : '') +
        (x.note ? '<br>💬 ' + esc(x.note) : '') + '</div>' +
        (res ? '<div class="hw2-done">✓ Done · <b>' + res.score + '/' + res.total + '</b></div>'
             : '<button class="hw2-cta" data-action="assignment-start" data-i="' + i + '">Start · ' +
               x.question_count + ' questions<span class="hw2-go">›</span></button>') +
      '</div>';
    }).join('') : '<div class="empty">No assignments yet — enjoy the calm. 🌱</div>';
  } catch (e) {
    const host = document.getElementById('hw-list');
    if (host) host.innerHTML = '<div class="empty">Could not load assignments.</div>';
  }
}
/* ---- Assignment progress persistence ----
   A student who runs out of hearts, goes to review, and comes back must
   resume the exam where they left off — never from question 1. */
function assignProgKey(aid) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_assign_prog_' + email + '_' + aid;
}
function saveAssignProgress() {
  const q = state.quiz;
  if (!q || q.kind !== 'assignment' || !q.assignmentId) return;
  try {
    localStorage.setItem(assignProgKey(q.assignmentId), JSON.stringify({
      idx: q.idx, correct: q.correct, log: q.log || [], savedAt: Date.now()
    }));
  } catch (e) {}
}
function loadAssignProgress(aid) {
  try {
    const v = JSON.parse(localStorage.getItem(assignProgKey(aid)) || 'null');
    return (v && typeof v.idx === 'number' && v.idx > 0) ? v : null;
  } catch (e) { return null; }
}
function clearAssignProgress(aid) {
  try { localStorage.removeItem(assignProgKey(aid)); } catch (e) {}
}
/* ---- Word/grammar quiz progress persistence (Fix 2) ----
   Same idea as assignments: a student who runs out of hearts, exits to earn
   more in review, and comes back must resume where they left off — never from
   question 1. The full question set is saved because buildDuoDeck() shuffles,
   so a rebuilt deck would not match. Saved on every question transition and
   on exit/pause; cleared only on completion or explicit "start over". */
function quizProgKey(kind, date) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_quizprog_' + email + '_' + kind + '_' + (date || todayStr());
}
function saveQuizProgress() {
  const q = state.quiz;
  if (!q || (q.kind !== 'word' && q.kind !== 'grammar')) return;
  try {
    localStorage.setItem(quizProgKey(q.kind, q.date), JSON.stringify({
      questions: q.questions, idx: q.idx, correct: q.correct,
      hearts: q.hearts, log: q.log || [], kind: q.kind, date: q.date,
      level: q.level, theme: q.theme, savedAt: Date.now()
    }));
  } catch (e) {}
}
function loadQuizProgress(kind, date) {
  try {
    const v = JSON.parse(localStorage.getItem(quizProgKey(kind, date || todayStr())) || 'null');
    /* Only resume if the student actually progressed (idx > 0); a fresh
       session saved at question 1 must not trigger the resume prompt. */
    if (v && v.questions && v.questions.length &&
        typeof v.idx === 'number' && v.idx > 0 && v.idx < v.questions.length) return v;
    return null;
  } catch (e) { return null; }
}
function clearQuizProgress(kind, date) {
  try { localStorage.removeItem(quizProgKey(kind, date || todayStr())); } catch (e) {}
}
/* Save whichever quiz progress applies (assignment and/or word/grammar). */
function saveProgressAny() {
  saveAssignProgress();
  saveQuizProgress();
}
/* ---- Hearts policy by account age (Fix 3) ----
   Every NEW quiz session grants hearts based on account age: 30 hearts for
   accounts <= 30 days old, 10 hearts after that. Per-session grant, not daily.
   Resumed sessions keep their progress (see beginQuizSession). */
function accountAgeDays() {
  try {
    const u = state.user;
    if (u && u.createdAt) {
      const ms = Date.now() - new Date(u.createdAt).getTime();
      if (!isNaN(ms) && ms >= 0) return ms / 86400000;
    }
    // Fallback: first-seen marker (generous default -> 30 hearts).
    const k = 'el_first_seen_' + (u && u.id ? u.id : 'anon');
    let fs = null;
    try { fs = localStorage.getItem(k); } catch (e) {}
    if (!fs) {
      fs = new Date().toISOString();
      try { localStorage.setItem(k, fs); } catch (e) {}
      return 0;
    }
    const ms2 = Date.now() - new Date(fs).getTime();
    return (isNaN(ms2) || ms2 < 0) ? 0 : ms2 / 86400000;
  } catch (e) { return 0; }
}
function sessionHeartGrant() {
  return accountAgeDays() <= 30 ? 30 : 10;
}
function startAssignment(i) {
  const a = (state.homeworkList || [])[i];
  if (!a || !a.questions || !a.questions.length) return;
  state.pausedQuiz = null;
  const prog = loadAssignProgress(a.id);
  if (prog && prog.idx < a.questions.length) { assignmentResumePrompt(a, prog); return; }
  if (prog) clearAssignProgress(a.id);
  beginAssignment(a, null);
}
function beginAssignment(a, prog) {
  /* Duolingo-style player: assignment questions map onto 'select'/'typein'
     challenges (same shape the word quiz uses). Shared daily hearts. */
  state.quiz = {
    kind: 'assignment', assignmentId: a.id, log: (prog && prog.log) || [],
    questions: a.questions.map(function (q) {
      const qtype = q.type || 'mcq';
      if (qtype === 'gap') {
        return {
          qtype: 'typein', question: q.prompt || q.q, accept: q.accept || [],
          kind: 'assignment', explanation: q.explanation || '',
          v2: { qid: q.id, points: q.points || [], type: 'gap' }
        };
      }
      if (qtype === 'error') {
        /* error: segments become selectable options */
        const segs = q.segments || [];
        return {
          qtype: 'select', question: (q.prompt || q.q || 'Find the mistake — tap the wrong part.'),
          options: segs.slice(), answer: q.answer,
          kind: 'assignment', explanation: (q.correction ? 'Correct: ' + q.correction + '. ' : '') + (q.explanation || ''),
          v2: { qid: q.id, points: q.points || [], type: 'error' }
        };
      }
      if (qtype === 'listen') {
        /* vocabulary listening: the duo player already supports 'listen'
           (auto-play + replay button) — map audio/word through. */
        return {
          qtype: 'listen', question: q.q || q.prompt || 'Listen — which word do you hear?',
          audio: q.audio || '', word: q.word || '',
          options: (q.options || []).slice(), answer: q.answer,
          kind: 'assignment', explanation: q.explanation || '',
          v2: q.id ? { qid: q.id, points: [], type: 'listen' } : undefined
        };
      }
      /* mcq (default) */
      return {
        qtype: 'select', question: q.q, options: (q.options || []).slice(), answer: q.answer,
        kind: 'assignment', explanation: q.explanation || '',
        v2: q.id ? { qid: q.id, points: q.points || [], type: 'mcq' } : undefined
      };
    }),
    idx: (prog && prog.idx) || 0, correct: (prog && prog.correct) || 0,
    answered: false, picked: -1, wasCorrect: false,
    hearts: getHearts(),
    date: todayStr(), level: a.level, theme: a.title
  };
  saveAssignProgress();
  renderQuizView();
}
function assignmentResumePrompt(a, prog) {
  if (document.getElementById('assign-resume-modal')) return;
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'assign-resume-modal';
  d.innerHTML = '<div class="duo-modal"><h3>Continue where you left off?</h3>' +
    '<p>You reached question ' + (prog.idx + 1) + ' of ' + a.questions.length + '.</p>' +
    '<button class="duo-continue btn-block" id="assign-resume-yes">▶ Continue</button>' +
    '<button class="btn btn-ghost btn-block" id="assign-resume-no">↺ Start over</button></div>';
  $('#view').appendChild(d);
  document.getElementById('assign-resume-yes').onclick = function () {
    d.remove(); beginAssignment(a, prog);
  };
  document.getElementById('assign-resume-no').onclick = function () {
    d.remove(); clearAssignProgress(a.id); beginAssignment(a, null);
  };
}
async function saveAssignmentResult() {
  const q = state.quiz;
  if (!q || q.kind !== 'assignment' || !q.assignmentId || !cloudReady()) return;
  clearAssignProgress(q.assignmentId);
  try {
    await sb.from('assignment_results').upsert({
      assignment_id: q.assignmentId, student_id: state.user.id,
      score: q.correct, total: q.questions.length,
      answers: (q.log || []).map(function (l) {
        /* v2: include qid/points/type/response/isCorrect alongside legacy picked/correct */
        const a = { picked: l.picked, correct: l.correct };
        if (l.qid) a.qid = l.qid;
        if (l.points) a.points = l.points;
        if (l.type) a.type = l.type;
        if (l.response !== undefined) a.response = l.response;
        if (l.isCorrect !== undefined) a.isCorrect = l.isCorrect;
        return a;
      })
    }, { onConflict: 'assignment_id,student_id' });
  } catch (e) {}
}

/* ---------------- Admin analytics (phase 2) ---------------- */
const ADM_METRICS = [
  { id: 'dau', label: 'Daily active' },
  { id: 'new_users', label: 'New users' },
  { id: 'xp', label: 'XP earned' },
  { id: 'podcast_min', label: 'Podcast min' },
  { id: 'lessons', label: 'Lessons' },
];
const ADM_EV_LABELS = {
  lesson_open: 'Opened a lesson',
  quiz_completed: 'Finished a quiz',
  podcast_milestone: 'Podcast milestone',
  teacher_requested: 'Requested teacher access',
  shadowing_listen: 'Listened to a shadowing sentence',
  shadowing_attempt: 'Shadowing speaking attempt'
};
function admEvLabel(e) {
  const base = ADM_EV_LABELS[e.event] || e.event;
  const m = e.meta || {};
  const theme = String(m.theme || '').replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F)+\s*/u, '');
  const tSuffix = theme ? ' · ' + theme : '';
  if (e.event === 'quiz_completed' && m.score != null) return base + ' — ' + m.score + '/' + (m.total || '?') + ' (' + (m.kind || '') + ')' + tSuffix;
  if (e.event === 'podcast_milestone' && m.minutes != null) return base + ' — ' + m.minutes + ' min listened';
  if (e.event === 'lesson_open' && m.date) return base + ' — ' + m.date + tSuffix;
  if (e.event === 'shadowing_listen' && m.sentence) return base + ' — sentence ' + m.sentence;
  if (e.event === 'shadowing_attempt' && m.score != null) return base + ' — ' + m.score + '% (sentence ' + (m.sentence || '?') + ')';
  return base;
}
async function loadAdminAnalytics() {
  const host = document.getElementById('admin-analytics');
  if (!host) return;
  try {
    const res = await Promise.all([
      sb.rpc('admin_overview'),
      sb.rpc('admin_daily_series', { p_days: 30 }),
      sb.rpc('admin_user_stats'),
      sb.rpc('admin_teacher_board')
    ]);
    const bad = res.find(function (r) { return r.error; });
    if (bad) throw bad.error;
    if (!state.adminFilter) state.adminFilter = { q: '', level: '', teacher: '', activity: 'all', sort: 'recent' };
    if (!state.adminMetric) state.adminMetric = 'dau';
    state.adminStats = {
      overview: (res[0].data || [])[0] || {},
      series: res[1].data || [],
      users: res[2].data || [],
      board: res[3].data || []
    };
    renderAdminAnalytics();
    loadAdminFunnel();
  } catch (e) {
    host.innerHTML = '<div class="empty">Analytics unavailable: ' + esc(e.message || e) + '</div>';
  }
}
function admNum(n) {
  n = Number(n || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function renderAdminAnalytics() {
  const host = document.getElementById('admin-analytics');
  const st = state.adminStats;
  if (!host || !st) return;
  const o = st.overview;
  const cards = [
    ['Users', admNum(o.total_users)],
    ['New (7d)', admNum(o.new_7d)],
    ['DAU', admNum(o.dau)],
    ['WAU', admNum(o.wau)],
    ['Teachers', admNum(o.total_teachers)],
    ['XP (30d)', admNum(o.xp_30d)]
  ];
  host.innerHTML =
    '<div class="adm-cards">' + cards.map(function (c) {
      return '<div class="adm-card"><b>' + c[1] + '</b><span>' + c[0] + '</span></div>';
    }).join('') + '</div>' +
    '<div class="adm-chart-wrap"><div class="adm-tabs">' + ADM_METRICS.map(function (m) {
      return '<button class="adm-tab' + (state.adminMetric === m.id ? ' on' : '') + '" data-action="adm-metric" data-m="' + m.id + '">' + m.label + '</button>';
    }).join('') + '</div><div class="tch-bars" id="adm-chart">' + admChartBars() + '</div></div>' +
    '<div class="section-title" style="margin-top:1.2rem"><h2>👩‍🏫 Teacher leaderboard</h2></div>' +
    '<div id="adm-board">' + admBoardHTML() + '</div>' +
    '<div class="section-title" style="margin-top:1.2rem"><h2>👥 Users</h2></div>' +
    '<div class="adm-filters">' +
      '<input id="adm-q" type="search" placeholder="Search name or email…" value="' + esc(state.adminFilter.q) + '" aria-label="Search users">' +
      '<select id="adm-f-level" aria-label="Filter by level"><option value="">All levels</option>' +
        LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (state.adminFilter.level === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') + '</select>' +
      '<select id="adm-f-teacher" aria-label="Filter by teacher"><option value="">All teachers</option>' +
        st.board.map(function (t) { return '<option value="' + esc(t.ref_code) + '"' + (state.adminFilter.teacher === t.ref_code ? ' selected' : '') + '>' + esc(t.display_name) + '</option>'; }).join('') + '</select>' +
      '<select id="adm-f-activity" aria-label="Filter by activity">' +
        [['all', 'All activity'], ['active7', 'Active (7d)'], ['inactive30', 'Inactive (30d)'], ['never', 'Never active']].map(function (x) {
          return '<option value="' + x[0] + '"' + (state.adminFilter.activity === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select>' +
      '<select id="adm-f-sort" aria-label="Sort users">' +
        [['recent', 'Newest'], ['xp_total', 'Total XP'], ['xp_7d', 'XP (7d)'], ['streak', 'Streak'], ['active', 'Last active']].map(function (x) {
          return '<option value="' + x[0] + '"' + (state.adminFilter.sort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select>' +
    '</div>' +
    '<div id="adm-users">' + admUsersHTML() + '</div>' +
    '<div id="adm-funnel"></div>' +
    '<div id="adm-detail"></div>';
  // wire filter inputs (input/change events, not data-action)
  const q = document.getElementById('adm-q');
  if (q) q.addEventListener('input', function () { state.adminFilter.q = q.value; renderAdmUsers(); });
  ['adm-f-level', 'adm-f-teacher', 'adm-f-activity', 'adm-f-sort'].forEach(function (id, i) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', function () {
      const keys = ['level', 'teacher', 'activity', 'sort'];
      state.adminFilter[keys[i]] = el.value;
      renderAdmUsers();
    });
  });
}
function admChartBars() {
  const st = state.adminStats, m = state.adminMetric;
  const rows = st.series || [];
  const maxV = Math.max.apply(null, [1].concat(rows.map(function (r) { return Number(r[m]) || 0; })));
  const ml = ADM_METRICS.find(function (x) { return x.id === m; });
  return rows.map(function (r) {
    const v = Number(r[m]) || 0;
    const h = Math.max(3, Math.round(v / maxV * 90));
    return '<div class="tch-bar" title="' + esc(r.day) + ': ' + v + ' ' + (ml ? ml.label : '') + '">' +
      '<div class="tch-bar-fill" style="height:' + h + 'px"></div>' +
      '<div class="tch-bar-d">' + esc(String(r.day).slice(5)) + '</div></div>';
  }).join('');
}
function admBoardHTML() {
  const board = (state.adminStats || {}).board || [];
  if (!board.length) return '<div class="empty">No approved teachers yet.</div>';
  return '<div class="card tch-table-card"><div class="tch-table"><div class="tch-tr tch-th">' +
    '<span>Teacher</span><span>Students</span><span>Active 7d</span><span>XP 7d</span><span>Code</span><span></span></div>' +
    board.map(function (t) {
      return '<div class="tch-tr" data-action="adm-teacher-view" data-ref="' + esc(t.ref_code || '') + '" role="button" tabindex="0" title="View teacher panel">' +
        '<span class="tch-name">' + esc(t.display_name) + '</span>' +
        '<span>' + (t.students || 0) + '</span><span>' + (t.active_7d || 0) + '</span>' +
        '<span>' + (t.xp_7d || 0) + '</span><span><code>' + esc(t.ref_code) + '</code></span>' +
        '<span class="muted">👁</span></div>';
    }).join('') + '</div></div>';
}
function admFilteredUsers() {
  const st = state.adminStats, f = state.adminFilter;
  let list = (st.users || []).slice();
  const q = (f.q || '').toLowerCase().trim();
  if (q) list = list.filter(function (u) {
    return ((u.display_name || '') + ' ' + (u.email || '')).toLowerCase().indexOf(q) !== -1;
  });
  if (f.level) list = list.filter(function (u) { return normalizeLevel(u.level) === f.level; });
  if (f.teacher) list = list.filter(function (u) { return u.referred_by === f.teacher; });
  if (f.activity === 'active7') list = list.filter(function (u) { return u.last_active && u.last_active >= daysAgoStr(6); });
  if (f.activity === 'inactive30') list = list.filter(function (u) { return !u.last_active || u.last_active < daysAgoStr(29); });
  if (f.activity === 'never') list = list.filter(function (u) { return !u.last_active; });
  const sorts = {
    recent: function (a, b) { return new Date(b.created_at) - new Date(a.created_at); },
    xp_total: function (a, b) { return (b.xp_total || 0) - (a.xp_total || 0); },
    xp_7d: function (a, b) { return (b.xp_7d || 0) - (a.xp_7d || 0); },
    streak: function (a, b) { return (b.current_streak || 0) - (a.current_streak || 0); },
    active: function (a, b) { return String(b.last_active || '') > String(a.last_active || '') ? 1 : -1; }
  };
  list.sort(sorts[f.sort] || sorts.recent);
  return list;
}
function admUsersHTML() {
  const list = admFilteredUsers().slice(0, 200);
  if (!list.length) return '<div class="empty">No users match.</div>';
  return '<div class="card tch-table-card"><div class="tch-table adm-utable">' +
    '<div class="tch-tr tch-th"><span>User</span><span>🔥</span><span>XP</span><span>XP 7d</span><span>🎧m 30d</span><span>Active</span></div>' +
    list.map(function (u) {
      const name = u.display_name || (u.email || '?').split('@')[0];
      return '<div class="tch-tr" data-action="adm-user" data-id="' + esc(u.user_id) + '" role="button" tabindex="0">' +
        '<span class="tch-name">' + esc(name) + '<small>' + esc(u.email || '') +
        (u.referred_by ? ' · 📣' + esc(u.referred_by) : '') + '</small></span>' +
        '<span>' + (u.current_streak || 0) + '</span>' +
        '<span>' + admNum(u.xp_total) + '</span>' +
        '<span>' + admNum(u.xp_7d) + '</span>' +
        '<span>' + (u.podcast_min_30d || 0) + '</span>' +
        '<span class="muted">' + esc(fmtLastActive(u.last_active)) + '</span></div>';
    }).join('') + '</div></div>' +
    '<p class="muted" style="font-size:0.8rem">Showing ' + list.length + ' · tap a user for full detail.</p>';
}
function renderAdmUsers() {
  const host = document.getElementById('adm-users');
  if (host) host.innerHTML = admUsersHTML();
}
/* ---------------- Funnel + cohort retention (phase 4, admin) ---------------- */
async function loadAdminFunnel() {
  const host = document.getElementById('adm-funnel');
  if (!host) return;
  try {
    const res = await Promise.all([
      sb.rpc('admin_funnel').then(function (r) { return r.data || []; }, function () { return []; }),
      sb.rpc('admin_cohorts').then(function (r) { return r.data || []; }, function () { return []; })
    ]);
    const steps = res[0], cohorts = res[1];
    if (!steps.length && !cohorts.length) { host.innerHTML = ''; return; }
    const base = Number((steps[0] || {}).users) || 1;
    let html = '';
    if (steps.length) {
      html += '<div class="section-title" style="margin-top:1.2rem"><h2>📉 Signup funnel <span class="muted" style="font-weight:400;font-size:0.8rem">(last 30 days)</span></h2></div>' +
        '<div class="card"><div class="adm-funnel">' + steps.map(function (s) {
          const n = Number(s.users) || 0;
          const pct = Math.round(n / base * 100);
          return '<div class="adm-funnel-row"><span>' + esc(s.step) + '</span>' +
            '<div class="adm-funnel-bar"><div style="width:' + pct + '%"></div></div>' +
            '<b>' + n + '</b><span class="muted">' + pct + '%</span></div>';
        }).join('') + '</div></div>';
    }
    if (cohorts.length) {
      html += '<div class="section-title" style="margin-top:1.2rem"><h2>🔁 Cohort retention <span class="muted" style="font-weight:400;font-size:0.8rem">(% active in weeks 1–4 after signup)</span></h2></div>' +
        '<div class="card tch-table-card"><div class="tch-table adm-cohort">' +
        '<div class="tch-tr tch-th"><span>Cohort</span><span>Users</span><span>W1</span><span>W2</span><span>W3</span><span>W4</span></div>' +
        cohorts.map(function (c) {
          const cell = function (v) {
            v = Number(v) || 0;
            const cls = v >= 40 ? 'hot' : (v >= 20 ? 'warm' : 'cold');
            return '<span class="adm-coh ' + cls + '">' + v + '%</span>';
          };
          return '<div class="tch-tr"><span class="muted">' + esc(c.cohort) + '</span><span>' + c.users + '</span>' +
            cell(c.w1) + cell(c.w2) + cell(c.w3) + cell(c.w4) + '</div>';
        }).join('') + '</div></div>';
    }
    host.innerHTML = html;
  } catch (e) { host.innerHTML = ''; }
}
async function openAdminUser(id) {
  const host = document.getElementById('adm-detail');
  if (!host) return;
  const u = ((state.adminStats || {}).users || []).find(function (x) { return x.user_id === id; });
  if (!u) return;
  host.innerHTML = '<div class="empty">Loading…</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const res = await Promise.all([
      sb.rpc('get_student_daily', { p_student: id }).then(function (r) { return { rows30: r.data || [] }; }, function () { return { rows30: [] }; }),
      sb.from('daily_stats').select('*').eq('user_id', id).order('day', { ascending: false }).limit(30)
        .then(function (r) { return { rows: r.data || [] }; }, function () { return { rows: [] }; }),
      sb.from('app_events').select('event,meta,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(40)
        .then(function (r) { return { evs: r.data || [] }; }, function () { return { evs: [] }; }),
      sb.from('shadowing_attempts').select('lesson_date,transcript,score,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20)
        .then(function (r) { return { att: r.error ? [] : (r.data || [] ) }; }, function () { return { att: [] }; }),
      sb.from('summary_attempts').select('lesson_date,score,duration_sec,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20)
        .then(function (r) { return { sums: r.error ? [] : (r.data || [] ) }; }, function () { return { sums: [] }; })
    ]);
    const rows = res[1].rows.length ? res[1].rows : res[0].rows30;
    const evs = res[2].evs;
    const att = res[3].att;
    const sums = res[4].sums;
    const listens = evs.filter(function (e) { return e.event === 'shadowing_listen'; }).length;
    const shAvg = att.length ? Math.round(att.reduce(function (a, x) { return a + (Number(x.score) || 0); }, 0) / att.length) : 0;
    const name = u.display_name || (u.email || '?').split('@')[0];
    const sum = function (k) { return rows.reduce(function (a, x) { return a + (Number(x[k]) || 0); }, 0); };
    const maxSec = Math.max.apply(null, [1].concat(rows.map(function (x) { return x.seconds_in_app || 0; })));
    const ordered = rows.slice().sort(function (a, b) { return String(a.day) > String(b.day) ? 1 : -1; }).slice(-30);
    host.innerHTML = '<div class="card"><h3 style="margin-top:0">' + esc(name) +
      ' <span class="muted" style="font-weight:400">· ' + esc(u.email || '') + '</span></h3>' +
      '<p class="muted" style="font-size:0.85rem;margin-top:-0.4rem">' +
        esc(u.level ? levelLabel(normalizeLevel(u.level)) : 'level pending') +
        (u.referred_by ? ' · 📣 <code>' + esc(u.referred_by) + '</code>' : '') +
        ' · joined ' + esc(String(u.created_at || '').slice(0, 10)) + '</p>' +
      '<div class="tch-totals">' +
        '<div><b>' + admNum(u.xp_total) + '</b><span>total XP</span></div>' +
        '<div><b>' + (u.current_streak || 0) + '</b><span>day streak</span></div>' +
        '<div><b>' + Math.round(sum('seconds_in_app') / 60) + '</b><span>min (30d)</span></div>' +
        '<div><b>' + Math.round(sum('podcast_seconds') / 60) + '</b><span>podcast min</span></div>' +
        '<div><b>' + sum('lessons_opened') + '</b><span>lessons</span></div>' +
        '<div><b>' + sum('quizzes_completed') + '</b><span>quizzes</span></div>' +
        '<div><b>' + att.length + '</b><span>shadowing tries</span></div>' +
        '<div><b>' + shAvg + '%</b><span>shadowing avg</span></div>' +
        '<div><b>' + listens + '</b><span>shadowing listens</span></div>' +
      '</div>' +
      (ordered.length ? '<p class="muted" style="font-size:0.85rem;margin-bottom:0.3rem"><b>Daily time in app</b> (last 30 days)</p><div class="tch-bars">' +
        ordered.map(function (x) {
          const h = Math.max(4, Math.round((x.seconds_in_app || 0) / maxSec * 90));
          return '<div class="tch-bar" title="' + esc(x.day) + ': ' + Math.round((x.seconds_in_app || 0) / 60) + ' min">' +
            '<div class="tch-bar-fill" style="height:' + h + 'px"></div>' +
            '<div class="tch-bar-d">' + esc(String(x.day).slice(5)) + '</div></div>';
        }).join('') + '</div>' : '<div class="empty">No activity in the last 30 days.</div>') +
      (evs.length ? '<p class="muted" style="font-size:0.85rem;margin:1rem 0 0.3rem"><b>Recent activity</b></p><div class="adm-events">' +
        evs.map(function (e) {
          return '<div class="adm-ev"><span>' + esc(admEvLabel(e)) + '</span><span class="muted">' +
            esc(String(e.created_at || '').slice(0, 16).replace('T', ' ')) + '</span></div>';
        }).join('') + '</div>' : '') +
      (att.length ? '<p class="muted" style="font-size:0.85rem;margin:1rem 0 0.3rem"><b>🎤 Recent shadowing tries</b></p><div class="an-assign">' +
        att.slice(0, 8).map(function (x) {
          const mm = String(x.transcript || '').match(/^\[s(\d+)\]/);
          const said = String(x.transcript || '').replace(/^\[s\d+\]\s*/, '').slice(0, 60);
          const sc = Number(x.score) || 0;
          return '<div class="an-arow"><span>🔤 sentence ' + esc(mm ? mm[1] : '?') +
            ' <span class="muted">· ' + esc(said) + (said.length >= 60 ? '…' : '') + '</span></span>' +
            '<span class="muted">' + esc(String(x.created_at || '').slice(0, 16).replace('T', ' ')) + '</span>' +
            '<b class="' + (sc >= 70 ? 'ok' : 'bad') + '">' + sc + '%</b></div>';
        }).join('') + '</div>' : '') +
      (sums.length ? '<p class="muted" style="font-size:0.85rem;margin:1rem 0 0.3rem"><b>🎙️ Recent podcast summaries</b></p><div class="an-assign">' +
        sums.slice(0, 8).map(function (x) {
          const sc = Number(x.score) || 0;
          return '<div class="an-arow"><span>🎙️ <span class="muted">' + esc(String(x.lesson_date || '').slice(0, 10)) +
            ' · ' + (Number(x.duration_sec) || 0) + 's</span></span>' +
            '<span class="muted">' + esc(String(x.created_at || '').slice(0, 16).replace('T', ' ')) + '</span>' +
            '<b class="' + (sc >= 70 ? 'ok' : 'bad') + '">' + sc + '</b></div>';
        }).join('') + '</div>' : '') +
      '<button class="btn btn-ghost btn-sm" data-action="adm-user-close" style="margin-top:0.8rem">Close</button></div>';
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load user detail.</div>';
  }
}

/* ---------------- Google SSO ----------------
   "Continue with Google" on signin/signup. Supabase handles the OAuth dance;
   on return init() -> getSession() picks up the session from the URL and
   enterApp() runs. New Google users get: nickname prompt (ensureNickname),
   level picker (waiting view), and first-touch teacher attribution below. */
function googleButtonHTML(prefix) {
  return '<button class="btn btn-block btn-google" data-action="google-signin" data-prefix="' + prefix + '" type="button">' +
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path fill="#EA4335" d="M12 5.04c1.7 0 3.2.58 4.38 1.73l3.25-3.25C17.7 1.7 15.06.5 12 .5 7.7.5 3.99 3.08 2.18 6.6l3.78 2.93C7.02 6.9 9.28 5.04 12 5.04z"/>' +
    '<path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45c-.28 1.48-1.12 2.73-2.39 3.57v2.97h3.87c2.26-2.09 3.57-5.16 3.57-8.73z"/>' +
    '<path fill="#FBBC05" d="M5.96 14.47c-.22-.66-.35-1.37-.35-2.1s.13-1.44.35-2.1V7.3H2.18C1.43 8.79 1 10.35 1 12s.43 3.21 1.18 4.7l3.78-2.23z"/>' +
    '<path fill="#34A853" d="M12 23.5c3.04 0 5.6-1 7.46-2.72l-3.87-2.97c-1.08.72-2.45 1.15-3.59 1.15-2.72 0-4.98-1.86-6.04-4.49l-3.78 2.93C3.99 21.42 7.7 23.5 12 23.5z"/>' +
    '</svg><span>Continue with Google</span></button>' +
    '<div class="auth-or"><span>or</span></div>';
}
async function signInWithGoogle(prefix, btn) {
  if (!sb) { authError(prefix, 'Sign-in service couldn\u2019t load. Check your connection and try again.'); return; }
  authError(prefix, '');
  if (btn) btn.disabled = true;
  try {
    /* Carry the referral code through the OAuth round-trip. redirectTo used to
       be the bare origin, so ?ref= was lost on return; and localStorage often
       does NOT survive the mobile browser switch (in-app browser -> system
       browser for the Google screen). With ?ref= in redirectTo, getRefCode()
       picks it up from the URL again on return, in any browser. */
    const ref = getRefCode();
    const redirectTo = window.location.origin + '/' + (ref ? '?ref=' + encodeURIComponent(ref) : '');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo }
    });
    if (error) throw error;
    // The browser leaves for Google now; on return init() picks up the session.
  } catch (e) {
    if (btn) btn.disabled = false;
    authError(prefix, (e && e.message) || 'Google sign-in failed. Try again.');
  }
}
/* Suggest a valid nickname from the OAuth profile (Google full name). */
function suggestNickname(u) {
  try {
    const meta = (u && u.user_metadata) || {};
    const raw = String(meta.full_name || meta.name || '').trim();
    let s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    if (s.length < 3) {
      s = String((u && u.email) || 'learner').split('@')[0].toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    }
    return s.length >= 3 ? s : '';
  } catch (e) { return ''; }
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
    // Server-side write: profiles has no user UPDATE policy, so a direct
    // upsert is denied by RLS. The RPC writes only the caller's own row.
    await sb.rpc('set_country', { code: c.code, name: c.name, source: c.source });
  } catch (e) { /* RPC missing or offline -> retry next open */ }
}

/* Saves the device IANA timezone (e.g. 'Asia/Tehran') on the profile, updating
   it whenever it changes (travel). Used for student-local scheduled delivery.
   Same pattern as ensureCountrySaved: RPC-only write, never breaks the boot. */
async function ensureTimezoneSaved() {
  const u = state.user;
  if (!sb || !u || u.demo) return;
  let tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  if (!tz || u.timezone === tz) return;
  u.timezone = tz;
  try { await sb.rpc('set_timezone', { tz: tz }); }
  catch (e) { /* RPC missing or offline -> retry next open */ }
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
      // Server-side writes: profiles has no user UPDATE/INSERT policy.
      try { await sb.rpc('set_level', { p_level: chosenLevel }); } catch (e) {}
      try { const r = getRefCode(); if (r) await sb.rpc('set_referred_by', { p_code: r }); } catch (e) {}
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
  if (!u) { window.location.replace('/'); return; }  // session gone -> static landing
  let level = null;
  let prof = null;
  try {
    const res = await sb.from('profiles').select('level,display_name,referred_by,country_code,country,country_source,welcome_seen_at,created_at').eq('id', u.id).single();
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
          await sb.rpc('set_level', { p_level: p.level });
          try { if (p.ref) await sb.rpc('set_referred_by', { p_code: p.ref }); } catch (e2) {}
          level = p.level;
          localStorage.removeItem('el_pending_level');
        }
      }
    } catch (e) {}
  }
  // First-touch teacher attribution for OAuth sign-ins (the email flow stashes
  // the ref code in el_pending_level instead; this covers Google SSO).
  // Server-side write via RPC: profiles has no user UPDATE policy.
  // Best-effort: runs in the background, never blocks first paint.
  try {
    const rc = getRefCode();
    if (rc && (!prof || !prof.referred_by)) {
      sb.rpc('set_referred_by', { p_code: rc }).then(function () {}, function () {});
    }
  } catch (e) {}
  const adminEmails = APP_CONFIG.ADMIN_EMAILS || [];
  const isAdmin = adminEmails.indexOf((u.email || '').toLowerCase()) !== -1;
  state.user = {
    id: u.id, email: u.email, level: level, isAdmin: isAdmin, demo: false,
    displayName: (prof && prof.display_name) || null,
    countryCode: (prof && prof.country_code) || null,
    country: (prof && prof.country) || null,
    countrySource: (prof && prof.country_source) || null,
    timezone: (prof && prof.timezone) || null,
    welcomeSeenAt: (prof && prof.welcome_seen_at) || null,
    createdAt: (prof && prof.created_at) || null,
  };
  try { localStorage.setItem('el_last_user', u.email); } catch (e) {}
  /* First paint ASAP: the syncs below don't affect the first screen, so they
     run in the background instead of blocking the boot sequence. */
  try { identifyPushUser(u.id, u.email, normalizeLevel(level)); } catch (e) {}
  ensureCountrySaved().catch(function () {});
  ensureTimezoneSaved().catch(function () {});
  migrateLocalToCloud().catch(function () {});
  flushPointsQueue().then(function () { refreshMyPoints().catch(function () {}); },
                          function () { refreshMyPoints().catch(function () {}); });
  loadTeacherStatus().catch(function () {});
  // Existing users without a nickname pick one now (blocking) — the
  // Challenge leaderboard needs a display name. Google users get their
  // Google name suggested.
  if (!state.user.demo && !state.user.displayName) {
    await ensureNickname(suggestNickname(u));
  }
  await afterLogin();
}

async function afterLogin() {
  if (!state.user.level && !state.user.isAdmin) { go('waiting'); hideSplashSoon(); return; }
  /* Teacher invite auto-link (Alireza 2026-10-10): a visitor arriving with
     ?ref=TEACHER_CODE is linked to that teacher immediately via
     resolve_teacher_offer (sets referred_by + teacher_offer_seen), so the
     choose-teacher page is NEVER shown to them. Non-teacher ref codes
     (e.g. blogger links) raise 'unknown teacher' and are ignored here —
     the normal offer flow below still applies to those users. */
  if (!state.user.isAdmin && !state.user.demo) {
    try {
      const ref = getRefCode();
      if (ref) await sb.rpc('resolve_teacher_offer', { p_ref_code: ref });
    } catch (e) { /* not a teacher code: fall through to the offer check */ }
  }
  /* One-time teacher offer for existing users who never chose/skipped. */
  if (!state.user.isAdmin && state.view !== 'choose-teacher') {
    try { if (await teacherOfferNeeded()) { go('choose-teacher'); hideSplashSoon(); return; } } catch (e) {}
  }
  const level = normalizeLevel(state.user.level) || 'b2';
  state.lessons = await loadLessons(level);
  state.lesson = state.lessons[0] || null;
  if (pendingDeepLink === 'latest') {
    // Push notification deep link -> newest lesson
    pendingDeepLink = null;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('lesson');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    if (state.lessons.length) go('lesson', state.lessons[0].date);
    else go('home');
  } else {
    // Stay where a reload happened (e.g. pull-to-refresh on mobile);
    // fresh logins land on home.
    const r = parseHash();
    if (r.name && LEARNER_VIEWS.indexOf(r.name) !== -1) onRoute();
    else go('home');
  }
  /* Placement test return: a student who signed up/logged in from a teacher's
     #/ptest/<ref> link lands back on the test after auth (incl. after the
     level picker in the waiting view). */
  try {
    var ptestBack = sessionStorage.getItem('ptest_return');
    if (ptestBack && /^#\/ptest\/[A-Za-z0-9_-]{1,32}$/.test(ptestBack)) {
      sessionStorage.removeItem('ptest_return');
      if (window.location.hash !== ptestBack) { window.location.hash = ptestBack; return; }
    }
  } catch (e) {}
  hideSplashSoon();
  maybeShowWelcome();
  // Teacher inbox: badge in the header + a prompt if unread messages arrived.
  refreshInboxBadge().then(function () { maybeShowInboxPrompt(); }, function () {});
}

/* First-entry welcome popup: Persian for a1/a2 learners, English for b1+.
   Shown once per user (tracked in profiles.welcome_seen_at + a local backup). */
/* Onboarding v2 (2026-10-04, his design): cream card, flame-reading illustration,
   squiggle title, orange gradient CTA. */
function welcomeModalHTML(fa, offerTour) {
  var img = '<img class="onb-img" src="/media/mascot/flame-reading-book.webp" alt="">';
  var x = '<button class="onb-x" data-action="modal-close" aria-label="Close">\u2715</button>';
  if (fa) {
    return '<div class="onb" dir="rtl" lang="fa">' +
      '<div class="onb-top"><span class="onb-brand">\uD83D\uDCD6 Muse English</span>' + x + '</div>' +
      '<div class="onb-body"><div class="onb-text">' +
      '<h1 class="onb-title">خوش اومدی!<span class="onb-squiggle" aria-hidden="true"></span></h1>' +
      '<p>درس جدیدت هر روز ساعت <b class="onb-hl">۸ صبح</b> به وقت خودت آماده‌ست.</p>' +
      '<p>فقط کافیه روزی حدود <b>۱۰ دقیقه</b> وقت بذاری — کلی کلمه، جمله و نکته جدید یاد می‌گیری.</p>' +
      '</div>' + img + '</div>' +
      (offerTour
        ? '<button class="onb-cta" data-action="welcome-tour">بزن بریم، یه دور بزنیم 🌱</button>' +
          '<button class="onb-skip" data-action="modal-close">فعلاً نه</button>'
        : '<button class="onb-cta" data-action="modal-close">شروع کن</button>') +
      '</div>';
  }
  return '<div class="onb">' +
    '<div class="onb-top"><span class="onb-brand">\uD83D\uDCD6 Muse English</span>' + x + '</div>' +
    '<div class="onb-body"><div class="onb-text">' +
    '<h1 class="onb-title">Welcome!<span class="onb-squiggle" aria-hidden="true"></span></h1>' +
    '<p>Your new lesson is ready every day at <b class="onb-hl">8:00 AM</b>, your time.</p>' +
    '<p>Just spend about <b>10 minutes</b> a day — you\u2019ll pick up loads of new words, sentences and tips.</p>' +
    '</div>' + img + '</div>' +
    (offerTour
      ? '<button class="onb-cta" data-action="welcome-tour">Take the tour <span aria-hidden="true">\u2192</span></button>' +
        '<button class="onb-skip" data-action="modal-close">Not now</button>'
      : '<button class="onb-cta" data-action="modal-close">Let\u2019s start</button>') +
    '</div>';
}

async function maybeShowWelcome() {
  const u = state.user;
  if (!u || u.demo || u.isAdmin || !u.level) return;
  if (u.welcomeSeenAt) return;
  try { if (localStorage.getItem('el_welcome_seen_' + u.id)) return; } catch (e) {}
  const lvl = normalizeLevel(u.level);
  const fa = (lvl === 'a1' || lvl === 'a2');
  const offerTour = !tutorialSeen();
  showModal(welcomeModalHTML(fa, offerTour), true);
  // Mark as seen (DB first, localStorage as backup so it never double-shows).
  const now = new Date().toISOString();
  u.welcomeSeenAt = now;
  try { localStorage.setItem('el_welcome_seen_' + u.id, '1'); } catch (e) {}
  try { if (sb) await sb.rpc('set_welcome_seen'); } catch (e) {}
}

/* ---------------- guided first-run tutorial ----------------
   New users get a hands-on tour instead of a lecture: words -> quiz ->
   podcast -> challenge -> progress -> review. Action steps spotlight the
   real control and advance when the user taps it; info steps are read-and-go.
   Shown once per user (localStorage); replayable from Profile > Help. */
const tutState = { active: false, i: 0 };
function tutorialSeen() {
  try { return !!localStorage.getItem('el_tutorial_seen_' + (state.user && state.user.id)); }
  catch (e) { return false; }
}
function markTutorialSeen() {
  try { localStorage.setItem('el_tutorial_seen_' + (state.user && state.user.id), '1'); } catch (e) {}
}
function tutLang() {
  const lvl = normalizeLevel(state.user && state.user.level);
  return (lvl === 'a1' || lvl === 'a2') ? 'fa' : 'en';
}
function buildTutorialSteps() {
  const fa = tutLang() === 'fa';
  const T = function (f, e) { return fa ? f : e; };
  /* 4-step core-loop tour: words -> quiz -> streak -> podcast.
     Each step highlights one stable UI target (tab buttons + streak banner),
     one sentence each, skippable, ends at today's lesson. */
  return [
    { id: 'words', view: 'lesson', selector: '.lesson-tab[data-tab="words"]',
      kicker: '📝', title: T('کلمات', 'Words'),
      text: T('کلمات امروز رو اینجا یاد بگیر', 'Learn today\u2019s words here') },
    { id: 'quiz', selector: '.lesson-tab[data-tab="quiz"]',
      kicker: '🎯', title: T('کوییز', 'Quiz'),
      text: T('کوییز بده و XP بگیر', 'Take the quiz and earn XP') },
    { id: 'streak', view: 'home', selector: '.stk-link',
      kicker: '🔥', title: T('استریک', 'Streak'),
      text: T('هر روز بیا تا استریکت نپره', 'Come back every day to keep your streak') },
    { id: 'podcast', view: 'lesson', selector: '.lesson-tab[data-tab="podcast"]',
      kicker: '🎧', title: T('پادکست', 'Podcast'),
      text: T('کلمات امروز رو توی مکالمه بشنو', 'Hear today\u2019s words in conversation') }
  ];
}
/* One persistent overlay for the whole tour: the dim NEVER lifts between
   steps (fixes the unlocked-screen gap). The hole glides to each target,
   text crossfades next to it. Tap anywhere (or Next) advances. */
function startTutorial() {
  if (tutState.active || !state.user || state.user.demo) return;
  tutState.active = true; tutState.i = 0;
  const fa = tutLang() === 'fa';
  const ov = document.createElement('div');
  ov.id = 'tut-ov';
  ov.innerHTML =
    '<div id="tut-catcher"></div><div id="tut-hole"></div><div id="tut-text"></div>';
  document.body.appendChild(ov);
  document.getElementById('tut-catcher').addEventListener('click', function () { tutorialNext(); });
  window.addEventListener('resize', tutReposition);
  tutorialStep();
}
function endTutorial() {
  tutState.active = false;
  window.removeEventListener('resize', tutReposition);
  closeTutorialUI();
  markTutorialSeen();
}
function tutorialNext() {
  if (!tutState.active) return;
  const steps = buildTutorialSteps();
  tutState.i++;
  if (tutState.i >= steps.length) { showTutorialDone(); return; }
  tutorialStep();
}
function tutGo(view) {
  /* Tutorial navigation: intentionally leaves any half-answered demo quiz
     behind (nothing is saved until a quiz finishes), so no confirm dialog. */
  state.quiz = null;
  const h = '#/' + view;
  if (window.location.hash === h) { onRoute(); }
  else { window.location.hash = h; }
}
/* Robust tab switch: wait for the tab strip, click the real tab (so the user
   sees it activate), then verify lessonTab actually changed. */
function tutEnsureTab(tab) {
  return tutWaitForEl('.lesson-tab[data-tab="' + tab + '"]', 4000).then(function (btn) {
    if (!tutState.active) return false;
    if (!btn) return false;
    try { btn.click(); } catch (e) { return false; }
    return new Promise(function (resolve) {
      const t0 = Date.now();
      (function poll() {
        if (!tutState.active) return resolve(false);
        if (state.lessonTab === tab) return resolve(true);
        if (Date.now() - t0 > 3000) return resolve(state.lessonTab === tab);
        setTimeout(poll, 150);
      })();
    });
  });
}
function tutWaitForEl(selector, ms) {
  return new Promise(function (resolve) {
    const t0 = Date.now();
    (function poll() {
      let el = null;
      try { el = document.querySelector(selector); } catch (e) {}
      if (el) return resolve(el);
      if (Date.now() - t0 > (ms || 4000)) return resolve(null);
      setTimeout(poll, 200);
    })();
  });
}
async function tutorialStep() {
  const myStep = tutState.i;
  const steps = buildTutorialSteps();
  const s = steps[myStep];
  if (!s) { showTutorialDone(); return; }
  tutFadeStep(true);
  if (s.view && state.view !== s.view) tutGo(s.view);
  if (s.tab) {
    const tabOk = await tutEnsureTab(s.tab);
    if (!tutState.active || tutState.i !== myStep) return;
    if (!tabOk) { tutorialNext(); return; }
  }
  const el = s.selector ? await tutWaitForEl(s.selector, 4000) : null;
  if (!tutState.active || tutState.i !== myStep) return;
  if (s.selector && !el) { tutorialNext(); return; } // missing target -> skip gracefully
  tutRenderStep(s, el, steps.length);
}
/* Fade the hole+text out while the next target loads — the dim stays up,
   so the screen is never interactive mid-tour. */
function tutFadeStep(out) {
  const hole = document.getElementById('tut-hole');
  const text = document.getElementById('tut-text');
  if (hole) hole.style.opacity = '0';
  if (text) text.style.opacity = '0';
}
function tutRenderStep(s, el, n) {
  const fa = tutLang() === 'fa';
  const hole = document.getElementById('tut-hole');
  const text = document.getElementById('tut-text');
  if (!hole || !text || !el) return;
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  const r = el.getBoundingClientRect();
  const pad = 8;
  hole.style.left = Math.max(6, r.left - pad) + 'px';
  hole.style.top = Math.max(6, r.top - pad) + 'px';
  hole.style.width = (r.width + pad * 2) + 'px';
  hole.style.height = (r.height + pad * 2) + 'px';
  hole.style.opacity = '1';
  /* One block: counter + title + body + Next + Skip, positioned in the
     largest free area (above or below the hole) and clamped to the viewport.
     The button can never cover the text, hide behind it, or fly off-screen. */
  text.innerHTML = '<div class="tut-counter">' + tutCounter(tutState.i, n, fa) + '</div>' +
    '<div class="tut-title">' + esc(s.kicker + ' ' + s.title) + '</div>' +
    '<div class="tut-body">' + esc(s.text) + '</div>' +
    '<button id="tut-next">' + (fa ? 'بعدی' : 'Next') + '</button>' +
    '<button id="tut-skip">' + (fa ? 'رد شو' : 'Skip tour') + '</button>';
  text.setAttribute('dir', fa ? 'rtl' : 'ltr');
  text.setAttribute('lang', fa ? 'fa' : 'en');
  const w = Math.min(340, window.innerWidth - 40);
  text.style.width = w + 'px';
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(20, Math.min(window.innerWidth - w - 20, left));
  text.style.left = left + 'px';
  text.style.visibility = 'hidden';
  text.style.opacity = '0';
  text.style.transform = 'translateY(8px)';
  const vh = window.innerHeight;
  const h = text.offsetHeight || 230;
  const above = r.top, below = vh - r.bottom;
  let top = above >= below ? Math.max(12, above - h - 20) : r.bottom + 20;
  top = Math.max(12, Math.min(vh - h - 12, top));
  text.style.top = top + 'px';
  text.style.bottom = 'auto';
  text.style.visibility = '';
  const nx = document.getElementById('tut-next');
  if (nx) nx.addEventListener('click', function (e) { e.stopPropagation(); tutorialNext(); });
  const sk = document.getElementById('tut-skip');
  if (sk) sk.addEventListener('click', function (e) { e.stopPropagation(); endTutorial(); });
  requestAnimationFrame(function () {
    if (!tutState.active) return;
    text.style.opacity = '1';
    text.style.transform = 'translateY(0)';
  });
}
function tutCounter(i, n, fa) {
  if (fa) {
    const f = function (x) { return String(x).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[+d]; }); };
    return f(i + 1) + ' از ' + f(n);
  }
  return (i + 1) + ' of ' + n;
}
function tutReposition() {
  if (!tutState.active) return;
  const steps = buildTutorialSteps();
  const s = steps[tutState.i];
  const hole = document.getElementById('tut-hole');
  if (!s || !hole || !s.selector || hole.style.opacity === '0') return;
  let el = null;
  try { el = document.querySelector(s.selector); } catch (e) {}
  if (!el) return;
  tutRenderStep(s, el, steps.length); /* repositions hole + text block together */
}
/* Finale (Peak–End rule): centered message + one clear CTA. */
function showTutorialDone() {
  const hole = document.getElementById('tut-hole');
  const text = document.getElementById('tut-text');
  const fa = tutLang() === 'fa';
  if (hole) hole.style.opacity = '0';
  const catcher = document.getElementById('tut-catcher');
  if (catcher) catcher.style.background = 'rgba(7,10,24,.88)';
  if (!text) return;
  text.innerHTML = '<div class="tut-done-emoji">🎉</div>' +
    '<div class="tut-done-title">' + (fa ? 'تمومه!' : 'That\u2019s it!') + '</div>' +
    '<div class="tut-body">' + esc(fa ? 'بزن بریم سر درس امروز 🌱'
                                      : 'Let\u2019s dive into today\u2019s lesson 🌱') + '</div>' +
    '<button id="tut-cta">' + (fa ? 'شروع 🚀' : 'Let\u2019s go 🚀') + '</button>';
  text.setAttribute('dir', fa ? 'rtl' : 'ltr');
  text.setAttribute('lang', fa ? 'fa' : 'en');
  const w = Math.min(340, window.innerWidth - 40);
  text.style.width = w + 'px';
  text.style.left = ((window.innerWidth - w) / 2) + 'px';
  text.style.top = '36%';
  text.style.bottom = 'auto';
  text.style.transform = 'translateY(0)';
  text.style.opacity = '1';
  const cta = document.getElementById('tut-cta');
  if (cta) cta.addEventListener('click', function (e) { e.stopPropagation(); endTutorial(); state.lessonTab = 'words'; go('lesson'); });
}
function closeTutorialUI() {
  const ov = document.getElementById('tut-ov');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}

async function doLogout() {
  if (!quizGuardOk()) return;
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  logoutPushUser();
  state.user = null; state.lessons = []; state.lesson = null;
  state.adminUsers = []; state.quiz = null; state.justSignedUp = false;
  try { localStorage.removeItem('el_last_user'); } catch (e) {}
  /* Logout clears the muse_app_used flag too: after logout the landing
     returns, even for a browser that used the app before. The flag is
     set again the next time the visitor enters any app route. */
  try { localStorage.removeItem('muse_app_used'); } catch (e) {}
  // Logout -> static landing at '/', no hash. The old '#/landing' route is retired;
  // the static landing in index.html IS the homepage.
  window.location.replace('/');
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
    email: asAdmin ? String((APP_CONFIG.ADMIN_EMAILS || [])[0] || 'admin@example.com') : 'demo-learner@example.com',
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
  '<div class="onb onb-wait">' +
    '<div class="onb-top"><span class="onb-brand">\uD83D\uDCD6 Muse English</span></div>' +
    '<h1 class="onb-title">One last step \uD83C\uDFAF<span class="onb-squiggle" aria-hidden="true"></span></h1>' +
    (state.justSignedUp ? '<p class="form-note">\u2713 Your account is created.</p>' : '') +
    '<p class="onb-sub">What\u2019s your English level? Pick the closest — your lessons start right away.</p>' +
    levelPickerHTML('wait-level') +
    '<div class="form-error" id="wait-error" role="alert"></div>' +
    '<button class="onb-cta" data-action="save-level">Start learning <span aria-hidden="true">\u2192</span></button>' +
    '<p class="onb-signed">Signed in as ' + esc(state.user.email) + '</p>' +
  '</div>';
}

async function saveWaitingLevel() {
  const el = document.querySelector('input[name="wait-level"]:checked');
  const errEl = document.getElementById('wait-error');
  if (!el) { if (errEl) errEl.textContent = 'Please pick your English level.'; return; }
  if (errEl) errEl.textContent = '';
  try {
    const { data: u } = await sb.auth.getUser();
    /* Server-side write via set_level RPC: profiles has no user
       UPDATE/INSERT policy, so a direct upsert is denied by RLS. */
    const r = await sb.rpc('set_level', { p_level: el.value });
    if (r.error || r.data !== true) throw new Error('set_level failed');
    state.user.level = el.value;
    state.justSignedUp = false;
    try { localStorage.removeItem('el_pending_level'); } catch (e) {}
    identifyPushUser(u.user.id, u.user.email, normalizeLevel(el.value));
    await maybeOfferTeacher();
  } catch (e) { if (errEl) errEl.textContent = 'Couldn\'t save — check your connection and try again.'; }
}

/* Teacher offer: after the level is picked (new users) and once for existing
   users without a teacher (checked in afterLogin). One-time: choosing or
   skipping marks profiles.teacher_offer_seen so it never shows again. */
async function teacherOfferNeeded() {
  if (!sb || !state.user || state.user.demo || state.user.isAdmin || state.teacher) return false;
  try {
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return false;
    const { data: prof } = await sb.from('profiles')
      .select('referred_by,teacher_offer_seen').eq('id', u.user.id).maybeSingle();
    if (!prof || prof.referred_by || prof.teacher_offer_seen) return false;
    const t = await sb.rpc('approved_teachers_for_offer');
    return !t.error && (t.data || []).length > 0;
  } catch (e) { return false; }
}
async function maybeOfferTeacher() {
  /* Teacher invite auto-link (Alireza 2026-10-10): same as in afterLogin —
     ?ref=TEACHER_CODE links immediately, choose-teacher never shown. */
  if (!state.user.isAdmin && !state.user.demo) {
    try {
      const ref = getRefCode();
      if (ref) await sb.rpc('resolve_teacher_offer', { p_ref_code: ref });
    } catch (e) { /* not a teacher code: fall through */ }
  }
  try {
    if (await teacherOfferNeeded()) { go('choose-teacher'); hideSplashSoon(); return; }
  } catch (e) {}
  await afterLogin();
}

/* ---------------- choose your teacher (Persian, one-time offer) ---------------- */
function tchOfferCardHTML(t) {
  const photo = t.photo_url
    ? '<img class="tch-offer-photo" src="' + esc(t.photo_url) + '" alt="' + esc(t.display_name || '') + '">'
    : '<div class="tch-offer-photo tch-offer-initial">' + esc((t.display_name || '?').trim().charAt(0)) + '</div>';
  const exp = (t.experience_years !== null && t.experience_years !== undefined && t.experience_years !== '')
    ? '<div class="muted">🎓 ' + t.experience_years + ' سال سابقه تدریس</div>' : '';
  const students = t.student_count
    ? '<div class="muted">👥 ' + t.student_count + ' زبان‌آموز</div>' : '';
  const bio = t.bio ? '<p class="tch-offer-bio">' + esc(t.bio) + '</p>' : '';
  return '<div class="tch-offer-card">' + photo +
    '<b class="tch-offer-name">' + esc(t.display_name || '?') + '</b>' +
    exp + students + bio +
    '<button class="onb-cta tch-offer-pick" data-tch-pick="' + esc(t.ref_code || '') + '">انتخاب</button></div>';
}
/* ---------------- choose your teacher v2 — mobile design (one-time offer) ---------------- */
var ct2Teachers = [];
var ct2Selected = null;
function ct2PhotoHTML(t, cls) {
  if (t.photo_url) return '<img class="' + cls + '" src="' + esc(t.photo_url) + '" alt="' + esc(t.display_name || '') + '" loading="lazy">';
  return '<div class="' + cls + ' ct2-initial">' + esc((t.display_name || '?').trim().charAt(0).toUpperCase()) + '</div>';
}
function ct2PeopleSVG() {
  return '<svg class="ct2-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.4" fill="#7C6AF0"/><path d="M2.8 19.2c.7-3.2 3.3-5 6.2-5s5.5 1.8 6.2 5" stroke="#7C6AF0" stroke-width="2.2" stroke-linecap="round"/><circle cx="16.8" cy="9.2" r="2.7" fill="#9A8CF8"/><path d="M15.4 14.4c2.9.3 5 2 5.6 4.8" stroke="#9A8CF8" stroke-width="2.2" stroke-linecap="round"/></svg>';
}
function ct2CardHTML(t) {
  var sub = t.specialty ? esc(t.specialty) : (t.bio ? esc(t.bio) : '');
  var meta = '<span class="ct2-meta-bit">' + ct2PeopleSVG() + '<span>' + esc(String(t.student_count == null ? '' : t.student_count)) + ' \u0632\u0628\u0627\u0646\u200c\u0622\u0645\u0648\u0632</span></span>';
  if (t.experience_years) meta += '<span class="ct2-meta-bit"><span aria-hidden="true">👥</span><span>' + esc(String(t.experience_years)) + ' \u0633\u0627\u0644 \u0633\u0627\u0628\u0642\u0647</span></span>';
  var sel = ct2Selected === t.ref_code ? ' sel' : '';
  return '<button class="ct2-card' + sel + '" data-ct2-open="' + esc(t.ref_code || '') + '">' +
    ct2PhotoHTML(t, 'ct2-ava') +
    '<span class="ct2-info"><b class="ct2-name">' + esc(t.display_name || '?') + '</b>' +
    (sub ? '<span class="ct2-sub">' + sub + '</span>' : '') +
    '<span class="ct2-meta">' + meta + '</span></span>' +
    '<span class="ct2-check' + sel + '" aria-hidden="true">' + (sel ? '\u2713' : '') + '</span></button>';
}
function ct2FeatRows() {
  var feats = [
    { i: '\u2B50', t: '\u06A9\u0627\u0645\u0644\u0627\u064B \u0631\u0627\u06CC\u06AF\u0627\u0646\u0647', s: '\u0647\u06CC\u0686 \u0647\u0632\u06CC\u0646\u0647\u200C\u0627\u06CC \u0646\u062F\u0627\u0631\u0647.' },
    { i: '🎯', t: '\u067E\u06CC\u0634\u0631\u0641\u062A\u062A \u0632\u06CC\u0631 \u0646\u0638\u0631 \u0627\u0633\u062A\u0627\u062F\u0647', s: '\u0627\u0633\u062A\u0627\u062F \u0645\u0633\u06CC\u0631 \u06CC\u0627\u062F\u06AF\u06CC\u0631\u06CC\u062A \u0631\u0648 \u062F\u0646\u0628\u0627\u0644 \u0645\u06CC\u200C\u06A9\u0646\u0647.' },
    { i: '\u26A1', t: '\u0633\u0631\u06CC\u0639\u200C\u062A\u0631 \u0628\u0647\u062A\u0631 \u0634\u0648', s: '\u0628\u0627 \u06A9\u0645\u06A9 \u0627\u0633\u062A\u0627\u062F\u060C \u0632\u0628\u0627\u0646\u062A \u062E\u06CC\u0644\u06CC \u0632\u0648\u062F\u062A\u0631 \u0642\u0648\u06CC \u0645\u06CC\u200C\u0634\u0647.' }
  ];
  return feats.map(function (f) {
    return '<div class="ct2-feat"><span class="ct2-feat-ico">' + f.i + '</span>' +
      '<span class="ct2-feat-txt"><b>' + f.t + '</b><span>' + f.s + '</span></span>' +
      '<span class="ct2-feat-ok">\u2713</span></div>';
  }).join('');
}
function ct2Find(code) {
  for (var i = 0; i < ct2Teachers.length; i++) if (ct2Teachers[i].ref_code === code) return ct2Teachers[i];
  return null;
}
function paintCt2List(v) {
  var list = v.querySelector('#ct2-list');
  if (!list) return;
  list.innerHTML = ct2Teachers.map(ct2CardHTML).join('');
  list.querySelectorAll('[data-ct2-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = ct2Find(b.getAttribute('data-ct2-open'));
      if (t) { ct2Selected = t.ref_code; renderCt2Detail(v, t); }
    });
  });
}
async function renderChooseTeacher(v) {
  ct2Selected = null;
  v.innerHTML =
    '<div class="ct2-wrap" dir="rtl" lang="fa">' +
    '<div class="ct2-banner"><div class="ct2-banner-txt"><h1>\u06CC\u06A9 \u0627\u0633\u062A\u0627\u062F \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646</h1>' +
    '<p>\u0627\u0633\u0627\u062A\u06CC\u062F \u0645\u0633\u06CC\u0631 \u06CC\u0627\u062F\u06AF\u06CC\u0631\u06CC\u062A \u0631\u0648 \u062F\u0646\u0628\u0627\u0644 \u0645\u06CC\u200C\u06A9\u0646\u0646\u060C \u062A\u0645\u0631\u06CC\u0646 \u0645\u06CC\u200C\u062F\u0646 \u0648 \u0631\u0627\u0647\u0646\u0645\u0627\u06CC\u06CC\u062A \u0645\u06CC\u200C\u06A9\u0646\u0646.</p></div>' +
    '<img class="ct2-mascot" src="/media/teachers/mascot-graduate.png" alt=""></div>' +
    '<div id="ct2-list"><div class="empty">\u062F\u0631 \u062D\u0627\u0644 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0627\u0633\u062A\u0627\u062F\u0647\u0627\u2026</div></div>' +
    '<div class="ct2-skipwrap"><button class="onb-skip" id="ct2-skip">\u0641\u0639\u0644\u0627\u064B \u0627\u0633\u062A\u0627\u062F \u0646\u0645\u06CC\u200C\u062E\u0648\u0627\u0645</button></div>' +
    '</div>';
  v.querySelector('#ct2-skip').addEventListener('click', function () { resolveTeacherOffer(null); });
  try {
    var r = await sb.rpc('approved_teachers_for_offer');
    if (r.error) throw r.error;
    ct2Teachers = r.data || [];
    if (!ct2Teachers.length) { resolveTeacherOffer(null); return; }
    paintCt2List(v);
  } catch (e) {
    var list = v.querySelector('#ct2-list');
    list.innerHTML = '<div class="empty">\u062E\u0637\u0627 \u062F\u0631 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC — <button class="btn btn-sm" id="ct2-retry">\u062A\u0644\u0627\u0634 \u062F\u0648\u0628\u0627\u0631\u0647</button></div>';
    var rb = list.querySelector('#ct2-retry');
    if (rb) rb.addEventListener('click', function () { renderChooseTeacher(v); });
  }
}
function renderCt2Detail(v, t) {
  var dstudents = '<div class="ct2-dstudents">' + ct2PeopleSVG() + '<span>' + esc(String(t.student_count == null ? '' : t.student_count)) + ' \u0632\u0628\u0627\u0646\u200C\u0622\u0645\u0648\u0632</span>';
  if (t.experience_years) dstudents += '<span class="ct2-dot">·</span><span>' + esc(String(t.experience_years)) + ' \u0633\u0627\u0644 \u0633\u0627\u0628\u0642\u0647</span>';
  dstudents += '</div>';
  v.innerHTML =
    '<div class="ct2-wrap" dir="rtl" lang="fa">' +
    '<div class="ct2-topbar"><button class="ct2-back" id="ct2-back" aria-label="\u0628\u0627\u0632\u06AF\u0634\u062A">' +
    '<svg viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5 8 12l6.5 6.5" stroke="#1E2A4E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
    '<div class="ct2-hero"><div class="ct2-blob" aria-hidden="true"></div>' +
    '<div class="ct2-hi" aria-hidden="true">Hi! 👋</div>' +
    ct2PhotoHTML(t, 'ct2-photo') + '</div>' +
    '<h1 class="ct2-dname">' + esc(t.display_name || '?') + '</h1>' +
    dstudents +
    (t.bio ? '<p class="ct2-bio">' + esc(t.bio) + '</p>' : '') +
    '<div class="ct2-feats">' + ct2FeatRows() + '</div>' +
    '<button class="ct2-select" id="ct2-select"><span>\u0627\u0646\u062A\u062E\u0627\u0628</span>' +
    '<svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5m6-6-6 6 6 6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
    '</div>';
  v.querySelector('#ct2-back').addEventListener('click', function () { renderChooseTeacher(v); });
  var btn = v.querySelector('#ct2-select');
  btn.addEventListener('click', function () { btn.disabled = true; resolveTeacherOffer(t.ref_code); });
}
async function resolveTeacherOffer(refCode) {
  try {
    const r = await sb.rpc('resolve_teacher_offer', { p_ref_code: refCode || '' });
    if (r.error) throw r.error;
  } catch (e) { /* offline: offer will show again next login; still let them in */ }
  /* FIX 2026-10-09: navigate into the app. Before this, afterLogin() re-rendered
     #/choose-teacher (hash never changed), so choosing a teacher looped back
     to the same page forever. */
  go('home');
  await afterLogin();
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
        (m.review ? ' <span class="badge-level" style="background:rgba(46,134,193,.14);color:#2E86C1">🔁 Review day</span>' : '') +
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

/* ---------------- HOME v5 (mockup rebuild, 2026-10-02) ---------------- */
const HOME_STEP_ORDER = ['words', 'podcast', 'shadowing', 'grammar', 'quiz'];
const HOME_STEP_STYLE = {
  words:     { icon: 'book',       bg: '#22C55E' },
  podcast:   { icon: 'mic',        bg: '#8B5CF6' },
  shadowing: { icon: 'headphones', bg: '#F59E0B' },
  grammar:   { icon: 'doc',        bg: '#EF4444' },
  quiz:      { icon: 'trophy',     bg: '#3B82F6' },
};

/* Streak banner v2 (2026-10-09): cream illustrated card after Alireza's mockup.
   The day count is dynamic HTML from the streak state (DB-synced), never baked in. */
function streakBannerHTML(st, dates) {
  st = st || {};
  const n = st.current_streak || 0;
  const sub = n > 0 ? 'Keep going! Learn a little every day ❤️' : 'Finish a lesson to ignite it 🔥';
  /* Desktop keeps the old artwork-style banner. */
  if (typeof isDesktop === 'function' && isDesktop()) {
    const numline = '<b>' + n + '</b>&nbsp;' + (n === 1 ? 'day!' : 'days!');
    return '<a class="stk-link" href="#/scores" dir="ltr" lang="en" aria-label="View your progress">' +
      '<img class="stk-bg" src="/media/home/streak-banner-art.webp" alt="">' +
      '<span class="stk-scrim" aria-hidden="true"></span>' +
      '<span class="stk-txt">' +
        '<span class="stk-kicker">Your streak is</span>' +
        '<span class="stk-num">' + numline + '</span>' +
        '<span class="stk-sub">' + sub + '</span>' +
      '</span>' +
      '<span class="stk-go" aria-hidden="true">›</span>' +
    '</a>';
  }
  /* Mobile: Alireza's 2026-10-20 mockup — big mascot, "Your streak is / N days!". */
  const numline = '<b>' + n + '</b> ' + (n === 1 ? 'day!' : 'days!');
  return '<a class="hm-streak" href="#/scores" dir="ltr" lang="en" aria-label="View your progress">' +
    '<span class="hm-streak-mascot"><img src="/media/home/streak-mascot.webp" alt="Streak mascot"></span>' +
    '<span class="hm-streak-txt">' +
      '<span class="hm-streak-kicker">Your streak is</span>' +
      '<span class="hm-streak-num">' + numline + '</span>' +
      '<span class="hm-streak-sub">' + sub + '</span>' +
    '</span>' +
    '<span class="hm-streak-go" aria-hidden="true">›</span>' +
  '</a>';
}

function lessonBannerHTML(m) {
  const p = getDayProgress(m.date);
  const done = dayDoneCount(m.date);
  const total = HOME_STEP_ORDER.length;
  const pct = Math.round((done / total) * 100);
  const ns = nextStep(m.date);

  const rows = HOME_STEP_ORDER.map(function (s, i) {
    const isDone = !!p[s];
    const isNext = !isDone && s === ns;
    const st = HOME_STEP_STYLE[s];
    const right = isDone
      ? '<span class="h-step-check" aria-hidden="true">✓</span>'
      : (isNext ? '<span class="h-step-pill">CONTINUE <span aria-hidden="true">›</span></span>'
                : '<span class="h-step-go" aria-hidden="true">›</span>');
    return '<li class="h-step' + (isNext ? ' next' : '') + '">' +
      '<button data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + s + '" aria-label="Go to ' + STEP_LABELS[s] + '">' +
      '<span class="h-step-icon" style="background:' + st.bg + '">' + ICO[st.icon] + '</span>' +
      (isNext ? '<span class="h-step-num">' + (i + 1) + '</span>' : '') +
      '<span class="h-step-name">' + STEP_LABELS[s] + '</span>' +
      right +
      '</button></li>';
  }).join('');

  let cta, ctaSub, tabFor;
  if (ns) {
    cta = done > 0 ? 'Continue with ' + STEP_LABELS[ns] : 'Start today\u2019s lesson';
    ctaSub = done > 0 ? 'Pick up where you left off.' : 'Words, podcast, shadowing, grammar and quiz.';
    tabFor = ns;
  } else {
    cta = 'Lesson complete 🎉';
    ctaSub = 'Nice work — come back tomorrow for a new lesson.';
    tabFor = 'words';
  }

  return '' +
  '<section class="h-lesson" aria-label="Today\u2019s lesson">' +
    '<button class="h-lesson-hero" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="words" aria-label="Open today\u2019s lesson"></button>' +
    '<ul class="h-steps">' + rows + '</ul>' +
    '<div class="h-progress">' +
      '<div class="h-progress-top"><span>Daily progress</span><span>' + done + ' of ' + total + ' steps</span></div>' +
      '<div class="h-progress-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Daily progress"><div style="width:' + pct + '%"></div></div>' +
    '</div>' +
    '<button class="h-cta" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + tabFor + '">' +
      '<span class="h-cta-play" aria-hidden="true">▶</span>' + esc(cta) + ' <span aria-hidden="true">›</span></button>' +
    '<p class="h-cta-sub">' + esc(ctaSub) + '</p>' +
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

function prevIconFor(theme) {
  const t = String(theme || '').toLowerCase();
  if (/travel|transport|trip|journey|airport|flight|hotel/.test(t)) return '📍';
  if (/money|shop|price|market|food|meal|grocer/.test(t)) return '🛒';
  if (/school|education|study|learn|book|class/.test(t)) return '📖';
  if (/health|doctor|body|sport|fitness/.test(t)) return '💪';
  if (/work|job|office|business|meeting/.test(t)) return '💼';
  return '📚';
}

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
      const done = dayDoneCount(m.date);
      const pct = Math.round((done / STEPS.length) * 100);
      return '<button class="prev-card v2" data-action="open-lesson" data-date="' + esc(m.date) + '" aria-label="Open lesson ' + esc(m.theme || m.date) + '">' +
        '<span class="pcv-photo">' +
          (cover
            ? '<img src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
            : '<span class="prev-ph" aria-hidden="true">📚</span>') +
          '<span class="pcv-date">' + esc(fmtDateShort(m.date)) + '</span>' +
        '</span>' +
        '<span class="pcv-body">' +
          '<span class="pcv-theme">' + esc(m.theme || 'Lesson') + (m.review ? ' 🔁' : '') + '</span>' +
          '<span class="pcv-row">' +
            '<span class="pcv-bar" role="progressbar" aria-label="Lesson progress" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + STEPS.length + '"><span style="width:' + pct + '%"></span></span>' +
            '<span class="pcv-ico" aria-hidden="true">' + prevIconFor(m.theme) + '</span>' +
          '</span>' +
        '</span>' +
      '</button>';
    }).join('') + '</div>';
  }
  return html + '</section>';
}

function archiveCardHTML(m) {
  const cover = lessonCover(m);
  const done = dayDoneCount(m.date);
  const pct = Math.round((done / STEPS.length) * 100);
  return '<button class="prev-card v2" data-action="open-lesson" data-date="' + esc(m.date) + '" aria-label="Open lesson ' + esc(m.theme || m.date) + '">' +
    '<span class="pcv-photo">' +
      (cover
        ? '<img src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<span class="prev-ph" aria-hidden="true">📚</span>') +
      '<span class="pcv-date">' + esc(fmtDateShort(m.date)) + '</span>' +
    '</span>' +
    '<span class="pcv-body">' +
      '<span class="pcv-theme">' + esc(m.theme || 'Lesson') + '</span>' +
      '<span class="arc-meta">' + esc((normalizeLevel(m.level) || 'b2').toUpperCase()) + ' · ' + lessonWordCount(m) + ' words</span>' +
      '<span class="pcv-row">' +
        '<span class="pcv-bar" role="progressbar" aria-label="Lesson progress" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + STEPS.length + '"><span style="width:' + pct + '%"></span></span>' +
        '<span class="pcv-ico" aria-hidden="true">' + prevIconFor(m.theme) + '</span>' +
      '</span>' +
    '</span>' +
  '</button>';
}

function renderLessons(v) {
  const lessons = state.lessons;
  let html = '<div class="archive-page">' +
    '<div class="archive-head"><h1>Past lessons</h1>' +
    '<p>' + lessons.length + (lessons.length === 1 ? ' lesson' : ' lessons') + ' · ' + esc(levelLabel(normalizeLevel(state.user.level))) + '</p></div>';
  if (!lessons.length) {
    html += '<div class="empty empty-dark">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += '<div class="archive-grid">' + lessons.map(archiveCardHTML).join('') + '</div>';
  }
  v.innerHTML = html + '</div>';
}

/* ================= Grammar section (2026-10-17) =================
   Entry: home banner (#home-grammar-wrap) → #/grammar (hub) → #/grammar/<slug> (topic).
   Content: /data/grammar/<level>.json — built by bin/build-grammar-app.py from
   ~/workspace/user/files/grammar-all-pages.json (89 vetted pages, muse-grammar-page/1).
   Progress: localStorage 'muse_grammar_v1' →
     {slug: {h1, best, total, done, claimed, attempts, lastTs}, _last: slug}.
   Points (Alireza 2026-10-17): 5 XP per correct exercise on the FIRST attempt of a
   topic (ref gex-<slug>-<itemId>, idempotent via action|ref), +20 on first topic
   completion (ref gtd-<slug>). Retries are practice mode: 0 XP.
   Mistakes: wrong answers → saveMistake() → Review Your Mistakes.
   Cloud record: saveAttempt({kind:'grammar_topic', theme:slug, ...}). */

var GRAMMAR_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
var GRAMMAR_TOTAL = 89;
state.grammarCache = state.grammarCache || {};
state.gquiz = null;
state.gFilter = null;

function grammarProgress() {
  var p = lsGet('muse_grammar_v1');
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
}
function setGrammarProgress(p) { lsSet('muse_grammar_v1', p); }

function loadGrammarLevel(lv) {
  if (state.grammarCache[lv]) return Promise.resolve(state.grammarCache[lv]);
  return fetch('/data/grammar/' + lv + '.json').then(function (res) {
    if (!res.ok) throw new Error('grammar bundle ' + lv + ' missing');
    return res.json();
  }).then(function (data) {
    state.grammarCache[lv] = data.topics;
    return data.topics;
  });
}
function loadAllGrammar() {
  return Promise.all(GRAMMAR_LEVELS.map(loadGrammarLevel)).then(function (lists) {
    return lists.reduce(function (a, b) { return a.concat(b); }, []);
  });
}
function findGrammarTopic(slug) {
  for (var i = 0; i < GRAMMAR_LEVELS.length; i++) {
    var topics = state.grammarCache[GRAMMAR_LEVELS[i]] || [];
    for (var j = 0; j < topics.length; j++) if (topics[j].slug === slug) return topics[j];
  }
  return null;
}

/* Inline markdown used by the grammar pages: **bold**, *italic*, [text](url).
   Internal /blog/grammar/<slug>/ links become in-app #/grammar/<slug> links. */
function gMd(s) {
  var h = esc(String(s == null ? '' : s));
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, t, u) {
    if (u.indexOf('/blog/grammar/') === 0) {
      var parts = u.split('/').filter(Boolean);
      return '<a href="#/grammar/' + esc(parts[parts.length - 1]) + '">' + t + '</a>';
    }
    return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>';
  });
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return h;
}

function grammarBlocksHTML(blocks) {
  return (blocks || []).map(function (b) {
    var t = b.type;
    if (t === 'p') return '<p>' + gMd(b.md) + '</p>';
    if (t === 'tip') return '<div class="g-tip">' + gMd(b.md) + '</div>';
    if (t === 'list') return '<ul class="g-list">' + (b.items || []).map(function (it) {
      return '<li>' + gMd(it) + '</li>';
    }).join('') + '</ul>';
    if (t === 'examples') return '<ol class="g-examples">' + (b.items || []).map(function (it) {
      return '<li><div class="g-ex-text">' + gMd(it.text) + '</div>' +
        (it.note ? '<div class="g-ex-note">' + gMd(it.note) + '</div>' : '') + '</li>';
    }).join('') + '</ol>';
    if (t === 'table') {
      var heads = (b.headers || []).map(function (hh) { return '<th>' + gMd(hh) + '</th>'; }).join('');
      var rows = (b.rows || []).map(function (r) {
        return '<tr>' + r.map(function (c, ci) {
          var lab = (b.headers || [])[ci] || '';
          return '<td' + (lab ? ' data-label="' + esc(lab) + '"' : '') + '>' + gMd(c) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="gwrap"><table class="g-table"><thead><tr>' + heads + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return '';
  }).join('');
}

/* ---------------- grammar hub (#/grammar) ---------------- */

/* Hub v2 design tokens (mockup 2026-10-17) */
var GH_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2' },
  { id: 'b1', label: 'B1' }, { id: 'b2', label: 'B2' }, { id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }
];
var GH_LV_COLORS = { a1: '#D9A21B', a2: '#E8833A', b1: '#3FA46A', b2: '#F26522', c1: '#4A90D9', c2: '#8E6FC8' };
var GH_LV_GRAD = {
  a1: ['#F0CE63', '#D9A21B'], a2: ['#F6AC68', '#E8833A'], b1: ['#6CC48C', '#3FA46A'],
  b2: ['#FF8145', '#F26522'], c1: ['#7DB4EC', '#4A90D9'], c2: ['#B39DE4', '#8E6FC8'],
  all: ['#AEB6C9', '#8A93A6']
};
var GH_LV_SUB = {
  all: 'Every grammar topic from A1 to C2 \u2014 read, practise, earn points.',
  a1: 'Essential grammar basics with clear explanations and practice exercises.',
  a2: 'Everyday grammar topics with clear explanations and practice exercises.',
  b1: 'Intermediate grammar topics with clear explanations and practice exercises.',
  b2: 'Advanced grammar topics with clear explanations and practice exercises.',
  c1: 'Complex grammar topics for fluent use, with clear explanations and practice exercises.',
  c2: 'Mastery-level grammar topics with clear explanations and practice exercises.'
};
var GH_ICON_ALIAS = {
  'comparatives-superlatives': 'comparatives', 'much-many-a-few-a-little': 'much-many',
  'must-have-to-should': 'must-have-to', 'passive-present-past': 'passive',
  'prepositions-of-time-in-on-at': 'prepositions-of-time',
  /* release-3 slugs without their own icon yet — closest family icon */
  'adjective-order': 'ed-ing-adjectives', 'and-but-or-so-because': 'advanced-cohesion',
  'be-going-to': 'future-forms', 'be-to-be-about-to': 'future-in-the-past',
  'because-as-since': 'advanced-cohesion', 'can-could-be-able-to': 'be-able-to',
  'countable-uncountable-nouns': 'countable-uncountable-some-any',
  'for-since': 'present-perfect-for-since-just-yet-already',
  'gradable-adjectives': 'modifying-comparatives', 'indirect-questions': 'question-words-and-forms',
  'introductory-it': 'there-is-there-are', 'like-as-as-if': 'like-love-hate-ing',
  'make-or-do': 'verbs-and-prepositions', 'may-might': 'advanced-probability',
  'modals-of-deduction': 'modals-of-deduction-present', 'narrative-tenses': 'past-continuous',
  'nouns-and-prepositions': 'noun-modifiers-compound-nouns', 'passive-voice': 'passive',
  'past-perfect': 'past-perfect-narrative-tenses', 'past-perfect-continuous': 'present-perfect-continuous',
  'past-simple-vs-past-continuous': 'past-simple', 'present-perfect-vs-past-simple': 'present-perfect',
  'present-simple-vs-present-continuous': 'present-simple', 'quite-rather-fairly': 'hedging-distancing',
  'requests-offers-permission': 'would-like', 'should-ought-to': 'should-have-could-have-neednt-have',
  'so-do-i-neither-do-i': 'both-either-neither-not-only', 'some-any': 'countable-uncountable-some-any',
  'still-yet-already': 'present-perfect-for-since-just-yet-already',
  'subject-verb-agreement': 'subject-pronouns-possessive-adjectives',
  'time-conjunctions': 'future-time-clauses', 'too-enough': 'so-such-so-that',
  'will-and-shall': 'future-forms', 'will-vs-going-to': 'future-forms',
  'word-order': 'phrasal-verbs-word-order', 'zero-and-first-conditional': 'zero-first-conditional'
};
function ghIconSrc(slug) { return '/media/grammar/guides/guide-' + (GH_ICON_ALIAS[slug] || slug) + '.webp'; }
function ghLvBadge(lv) {
  var label = lv === 'all' ? 'A1\u2013C2' : lv.toUpperCase();
  var g = GH_LV_GRAD[lv] || GH_LV_GRAD.all;
  return '<span class="gh-lv" style="background:linear-gradient(180deg,' + g[0] + ',' + g[1] + ')">' + label + '</span>';
}
function paintGhHeader() {
  var f = state.gFilter || { level: 'all', q: '' };
  var crumb = document.getElementById('gh-crumb-lv');
  if (crumb) crumb.textContent = f.level === 'all' ? 'All levels' : f.level.toUpperCase();
  var secLv = document.getElementById('gh-sec-lv');
  if (secLv) secLv.innerHTML = ghLvBadge(f.level);
  var sub = document.getElementById('gh-sec-sub');
  if (sub) sub.textContent = GH_LV_SUB[f.level] || GH_LV_SUB.all;
}

function renderGrammar(v, slug) {
  if (slug) { renderGrammarTopic(v, slug); return; }
  if (!state.gFilter) state.gFilter = { level: normalizeLevel(state.user && state.user.level) || 'a1', q: '' };
  var f = state.gFilter;
  v.innerHTML = '<div class="g-hub">' +
    '<div class="gh-crumb"><span>\uD83D\uDCD6</span> Grammar <span class="gh-crumb-sep">\u203A</span> <b id="gh-crumb-lv"></b></div>' +
    '<div class="gh-hero"><div class="gh-hero-t">' +
      '<h1>Grammar <em>Guides</em></h1>' +
      '<p>Clear explanations, real examples and practice exercises for every level.</p>' +
    '</div><img class="gh-mascot" src="/media/grammar/mascot-guides.webp" alt="Grammar mascot"></div>' +
    '<img class="gh-feats-img" src="/media/grammar/feats-strip.webp" alt="Simple explanations, real examples, practice exercises">' +
    '<div id="gtest-banner-wrap"></div>' +
    '<div class="gh-filters" role="tablist">' +
    GH_LEVELS.map(function (lv) {
      return '<button class="gh-pill gh-pill-lv-' + lv.id + (f.level === lv.id ? ' on' : '') + '" data-glevel="' + lv.id + '">' + lv.label + '</button>';
    }).join('') + '</div>' +
    '<div class="gh-search"><span class="gh-search-ico"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#232B4D" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="7"></circle><path d="M16 16 L21.5 21.5"></path></svg></span>' +
      '<input id="g-search" type="search" placeholder="Search grammar topics..." value="' + esc(f.q) + '" aria-label="Search grammar topics"></div>' +
    '<div class="gh-sec"><span id="gh-sec-lv"></span>' +
      '<div class="gh-sec-t"><h2>Grammar Guides</h2><p id="gh-sec-sub"></p></div>' +
      '<span class="gh-count" id="gh-count"></span></div>' +
    '<div id="g-list"><div class="empty">Loading\u2026</div></div></div>';
  paintGhHeader();
  paintGrammarList();
  paintGTestBanner();
  Array.prototype.forEach.call(v.querySelectorAll('[data-glevel]'), function (btn) {
    btn.addEventListener('click', function () {
      state.gFilter.level = btn.getAttribute('data-glevel');
      Array.prototype.forEach.call(v.querySelectorAll('[data-glevel]'), function (bb) {
        bb.classList.toggle('on', bb === btn);
      });
      paintGhHeader();
      paintGrammarList();
    });
  });
  var input = v.querySelector('#g-search'), deb = null;
  input.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { state.gFilter.q = input.value.trim(); paintGrammarList(); }, 250);
  });
}

function paintGrammarList() {
  var wrap = document.getElementById('g-list');
  if (!wrap) return;
  var f = state.gFilter || { level: 'all', q: '' };
  var needAll = f.level === 'all' || !!f.q;
  (needAll ? loadAllGrammar() : loadGrammarLevel(f.level)).then(function (topics) {
    var prog = grammarProgress();
    var q = (f.q || '').toLowerCase();
    var list = topics.filter(function (t) {
      if (f.level !== 'all' && t.level !== f.level) return false;
      if (q && (t.h1 || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!list.length) { wrap.innerHTML = '<div class="empty">No topics match.</div>'; return; }
    var count = document.getElementById('gh-count');
    if (count) count.textContent = list.length + ' topic' + (list.length === 1 ? '' : 's');
    wrap.innerHTML = '<div class="gh-cards">' + list.map(function (t) {
      return grammarCardHTML(t, prog[t.slug]);
    }).join('') + '</div>';
  }).catch(function () {
    wrap.innerHTML = '<div class="empty">Could not load grammar guides. Check your connection and try again.</div>';
  });
}

function grammarCardHTML(t, p) {
  var status;
  if (p && p.done) status = '<span class="gh-status done">✓ ' + p.best + '/' + (p.total || 16) + '</span>';
  else if (p && p.attempts) status = '<span class="gh-status prog">Best ' + p.best + '/' + (p.total || 16) + '</span>';
  else status = '<span class="gh-status">\uD83D\uDCC4 16 exercises</span>';
  return '<a class="gh-card" href="#/grammar/' + esc(t.slug) + '">' +
    '<span class="gh-ico"><img src="' + ghIconSrc(t.slug) + '" alt="" loading="lazy"></span>' +
    '<span class="gh-card-main"><span class="gh-titlerow">' + ghLvBadge(t.level) + '<b>' + esc(t.h1) + '</b></span>' + status + '</span>' +
    '<span class="gh-chev" aria-hidden="true">›</span></a>';
}

/* ---------------- grammar topic (#/grammar/<slug>) ---------------- */

function renderGrammarTopic(v, slug) {
  v.innerHTML = '<div class="g-topic"><div class="empty">Loading…</div></div>';
  var cached = findGrammarTopic(slug);
  var ready = cached ? Promise.resolve(cached)
    : loadAllGrammar().then(function () { return findGrammarTopic(slug); });
  ready.then(function (t) {
    if (!t) {
      v.innerHTML = '<div class="g-topic"><div class="empty">Guide not found. <a href="#/grammar">Back to all guides</a></div></div>';
      return;
    }
    if (t.v2) { renderGrammarTopicV3(v, t); return; }
    var prog = grammarProgress()[t.slug];
    var sections = (t.sections || []).map(function (s) {
      return '<section class="g-section"><h2>' + esc(s.h2) + '</h2>' + grammarBlocksHTML(s.blocks) + '</section>';
    }).join('');
    var mistakes = (t.mistakes || []).map(function (m) {
      return '<div class="g-mistake"><div class="g-mline bad">❌ ' + gMd(m.wrong) + '</div>' +
        '<div class="g-mline good">✅ ' + gMd(m.right) + '</div>' +
        (m.why ? '<div class="g-mwhy">' + gMd(m.why) + '</div>' : '') + '</div>';
    }).join('');
    var intro = (t.intro || []).map(function (p) { return '<p>' + gMd(p) + '</p>'; }).join('');
    var best = prog && prog.done
      ? '<span class="g-best">✓ Completed · best ' + prog.best + '/' + (prog.total || 16) + '</span>' : '';
    var related = (t.related_grammar || []).map(function (rs) {
      var rt = findGrammarTopic(rs);
      return '<a class="g-rel" href="#/grammar/' + esc(rs) + '">' + esc(rt ? rt.h1 : rs) + '</a>';
    }).join('');
    v.innerHTML = '<div class="g-topic">' +
      '<a class="g-back" href="#/grammar">‹ All guides</a>' +
      '<div class="g-hero"><span class="g-lv g-lv-' + t.level + '">' + t.level.toUpperCase() + '</span>' +
      '<h1>' + esc(t.h1) + '</h1>' + best + '</div>' +
      '<div class="g-intro">' + intro + '</div>' + sections +
      (mistakes ? '<section class="g-section"><h2>Common mistakes</h2>' + mistakes + '</section>' : '') +
      '<button class="btn btn-primary g-start" id="g-start-btn">' +
      (prog && prog.done ? 'Practise again ↻' : 'Start exercises →') + '</button>' +
      '<p class="g-xp-note">16 exercises · 5 points per correct answer' +
      (prog && prog.claimed ? ' · practice mode (no points)' : ' · +20 completion bonus') + '</p>' +
      (related ? '<section class="g-section"><h2>Related guides</h2><div class="g-rels">' + related + '</div></section>' : '') +
      '</div>';
    document.getElementById('g-start-btn').addEventListener('click', function () { startGrammarQuiz(t); });
    window.scrollTo(0, 0);
  }).catch(function () {
    v.innerHTML = '<div class="g-topic"><div class="empty">Could not load this guide.</div></div>';
  });
}

/* v2 topic renderer: level bar, one section per level, H3 per point, practice per level */
var G2_LEVEL_LABELS = { a1: 'A1 · Beginner', a2: 'A2 · Elementary', b1: 'B1 · Intermediate',
  b2: 'B2 · Upper-intermediate', c1: 'C1 · Advanced', c2: 'C2 · Proficiency' };
var G2_LEVEL_ORDER = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];

function renderGrammarTopicV2(v, t) {
  var levels = t.v2_levels || [];
  // Level bar
  var bar = '<div class="g2-levelbar">' + levels.map(function (lv) {
    return '<a href="#/grammar/' + esc(t.slug) + '" data-g2lv="' + lv + '">' + lv.toUpperCase() + '</a>';
  }).join('') + '</div>';
  // Group points by level
  var byLevel = {};
  (t.points || []).forEach(function (p) {
    var lv = (p.level || '').toLowerCase();
    (byLevel[lv] = byLevel[lv] || []).push(p);
  });
  // Group exercises by level
  var exByLevel = {};
  ((t.exercises && t.exercises.items) || []).forEach(function (ex) {
    var lv = (ex.level || '').toLowerCase();
    (exByLevel[lv] = exByLevel[lv] || []).push(ex);
  });
  var sections = levels.map(function (lv) {
    var pts = (byLevel[lv] || []).map(function (p) {
      var blocks = grammarBlocksHTML(p.blocks);
      var examples = (p.examples || []).map(function (e) {
        return '<li><div class="g-ex-text">' + gMd(e.text) + '</div>' +
          (e.note ? '<div class="g-ex-note">' + gMd(e.note) + '</div>' : '') + '</li>';
      }).join('');
      var mistakes = (p.mistakes || []).map(function (m) {
        return '<div class="g-mistake"><div class="g-mline bad">❌ ' + gMd(m.wrong) + '</div>' +
          '<div class="g-mline good">✅ ' + gMd(m.right) + '</div>' +
          (m.why ? '<div class="g-mwhy">' + gMd(m.why) + '</div>' : '') + '</div>';
      }).join('');
      return '<h3 id="' + esc(p.id) + '">' + esc(p.title) + ' <span class="gh-lv">' + lv.toUpperCase() + '</span></h3>' +
        (p.summary ? '<p class="g2-summary">' + gMd(p.summary) + '</p>' : '') +
        blocks +
        (examples ? '<ol class="g-examples">' + examples + '</ol>' : '') +
        (mistakes ? '<div class="g2-mistakes">' + mistakes + '</div>' : '');
    }).join('');
    var exs = exByLevel[lv] || [];
    var practice = exs.length ? '<h3>Practice: ' + lv.toUpperCase() + '</h3>' +
      '<p class="g2-practice-note">' + exs.length + ' exercises</p>' +
      '<button class="btn btn-primary g-start" data-g2quiz="' + lv + '">Start ' + lv.toUpperCase() + ' exercises →</button>' : '';
    return '<section class="g-section" id="g2-' + lv + '"><h2>' + (G2_LEVEL_LABELS[lv] || lv.toUpperCase()) + '</h2>' +
      '<div class="g-fa-audio" data-fa-lv="' + lv + '"></div>' +
      '<div class="g-en-audio" data-en-lv="' + lv + '"></div>' +
      pts + practice + '</section>';
  }).join('');
  var intro = (t.intro || []).map(function (p) { return '<p>' + gMd(p) + '</p>'; }).join('');
  v.innerHTML = '<div class="g-topic g2-topic">' +
    '<a class="g-back" href="#/grammar">‹ All guides</a>' +
    '<div class="g-hero"><h1>' + esc(t.h1) + '</h1></div>' +
    bar + '<div class="g-intro">' + intro + '</div>' + sections + '</div>';
  // Level bar scroll
  Array.prototype.forEach.call(v.querySelectorAll('[data-g2lv]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var el = document.getElementById('g2-' + a.getAttribute('data-g2lv'));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  });
  // Practice buttons
  Array.prototype.forEach.call(v.querySelectorAll('[data-g2quiz]'), function (btn) {
    btn.addEventListener('click', function () {
      startGrammarQuizV2(t, btn.getAttribute('data-g2quiz'));
    });
  });
  // Persian audio lessons (2026-10-20)
  paintFaAudioBars(v, t.slug);
  paintEnAudioBars(v, t.slug);
  window.scrollTo(0, 0);
}

/* Persian grammar audio lessons: one button per level section, reveals native <audio> */
var _faAudioCache = {};
function paintFaAudioBars(v, slug) {
  var secs = v.querySelectorAll('.g-fa-audio');
  if (!secs.length) return;
  var lvs = {};
  Array.prototype.forEach.call(secs, function (d) { lvs[d.getAttribute('data-fa-lv')] = 1; });
  var maps = {};
  var ps = Object.keys(lvs).map(function (lv) {
    if (_faAudioCache[lv]) { maps[lv] = _faAudioCache[lv]; return Promise.resolve(); }
    return fetch('/data/grammar/fa-audio/' + lv + '.json').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) { _faAudioCache[lv] = m; maps[lv] = m; })
      .catch(function () { _faAudioCache[lv] = {}; maps[lv] = {}; });
  });
  Promise.all(ps).then(function () {
    Array.prototype.forEach.call(secs, function (d) {
      var lv = d.getAttribute('data-fa-lv');
      var e = (maps[lv] || {})[slug];
      if (!e) return;
      var m = Math.floor(e.sec / 60), s = e.sec % 60;
      d.innerHTML = '<button class="g-fa-btn" type="button" dir="auto">\uD83C\uDFA7 \u0622\u0645\u0648\u0632\u0634 \u0635\u0648\u062A\u06CC \u0641\u0627\u0631\u0633\u06CC' +
        ' <span class="g-fa-dur">' + m + ':' + (s < 10 ? '0' : '') + s + '</span></button>' +
        '<audio class="g-fa-player" controls preload="none" src="' + esc(e.url) + '"></audio>';
      var btn = d.querySelector('.g-fa-btn');
      btn.addEventListener('click', function () {
        btn.style.display = 'none';
        var a = d.querySelector('.g-fa-player');
        a.style.display = 'block';
        a.play().catch(function () {});
      });
    });
  });
}

/* English audio lessons (2026-10-21): B1–C2 sections, built-in TTS.
   Same pattern as the Persian bars, separate data + blue styling. */
var _enAudioCache = {};
function paintEnAudioBars(v, slug) {
  var secs = v.querySelectorAll('.g-en-audio');
  if (!secs.length) return;
  var lvs = {};
  Array.prototype.forEach.call(secs, function (d) { lvs[d.getAttribute('data-en-lv')] = 1; });
  var maps = {};
  var ps = Object.keys(lvs).map(function (lv) {
    if (_enAudioCache[lv]) { maps[lv] = _enAudioCache[lv]; return Promise.resolve(); }
    return fetch('/data/grammar/en-audio/' + lv + '.json').then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (m) { _enAudioCache[lv] = m; maps[lv] = m; })
      .catch(function () { _enAudioCache[lv] = {}; maps[lv] = {}; });
  });
  Promise.all(ps).then(function () {
    Array.prototype.forEach.call(secs, function (d) {
      var lv = d.getAttribute('data-en-lv');
      var e = (maps[lv] || {})[slug];
      if (!e) return;
      var m = Math.floor(e.sec / 60), s = e.sec % 60;
      d.innerHTML = '<button class="g-en-btn" type="button">🎧 Listen in English' +
        ' <span class="g-en-dur">' + m + ':' + (s < 10 ? '0' : '') + s + '</span></button>' +
        '<audio class="g-en-player" controls preload="none" src="' + esc(e.url) + '"></audio>';
      var btn = d.querySelector('.g-en-btn');
      btn.addEventListener('click', function () {
        btn.style.display = 'none';
        var a = d.querySelector('.g-en-player');
        a.style.display = 'block';
        a.play().catch(function () {});
      });
    });
  });
}

/* Topic page V3 (2026-10-20): anti-wall-of-text layout — quick-rule card per point,
   visual blocks, examples & details behind an accordion. LIVE for all v2 topics
   since 2026-10-20 (his order); renderGrammarTopicV2 kept for rollback. */
function renderGrammarTopicV3(v, t) {
  var levels = t.v2_levels || [];
  var bar = '<div class="g2-levelbar">' + levels.map(function (lv) {
    return '<a href="#/grammar/' + esc(t.slug) + '" data-g2lv="' + lv + '">' + lv.toUpperCase() + '</a>';
  }).join('') + '</div>';
  var byLevel = {};
  (t.points || []).forEach(function (p) {
    var lv = (p.level || '').toLowerCase();
    (byLevel[lv] = byLevel[lv] || []).push(p);
  });
  var exByLevel = {};
  ((t.exercises && t.exercises.items) || []).forEach(function (ex) {
    var lv = (ex.level || '').toLowerCase();
    (exByLevel[lv] = exByLevel[lv] || []).push(ex);
  });
  var sections = levels.map(function (lv) {
    var grad = GH_LV_GRAD[lv] || GH_LV_GRAD.all;
    var pts = (byLevel[lv] || []).map(function (p) {
      var blocks = grammarBlocksHTML(p.blocks);
      var examples = (p.examples || []).map(function (e) {
        return '<li><div class="g-ex-text">' + gMd(e.text) + '</div>' +
          (e.note ? '<div class="g-ex-note">' + gMd(e.note) + '</div>' : '') + '</li>';
      }).join('');
      var mistakes = (p.mistakes || []).map(function (m) {
        return '<div class="g-mistake"><div class="g-mline bad">❌ ' + gMd(m.wrong) + '</div>' +
          '<div class="g-mline good">✅ ' + gMd(m.right) + '</div>' +
          (m.why ? '<div class="g-mwhy">' + gMd(m.why) + '</div>' : '') + '</div>';
      }).join('');
      var body = blocks +
        (examples ? '<ol class="g-examples">' + examples + '</ol>' : '') +
        (mistakes ? '<div class="g2-mistakes">' + mistakes + '</div>' : '');
      return '<div class="gt3-point">' +
        '<h3 id="' + esc(p.id) + '">' + esc(p.title) + ' <span class="gh-lv">' + lv.toUpperCase() + '</span></h3>' +
        (p.summary ? '<div class="gt3-quick"><div class="gt3-quick-tag"><svg class="gt3-bolt" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z" fill="currentColor"/></svg> The rule in 10 seconds</div><div class="gt3-quick-body">' + gMd(p.summary) + '</div></div>' : '') +
        (body ? '<button class="gt3-more" type="button">Show examples &amp; details <span class="gt3-chev">›</span></button>' +
          '<div class="gt3-body">' + body + '</div>' : '') +
        '</div>';
    }).join('');
    var exs = exByLevel[lv] || [];
    var practice = exs.length ? '<div class="gt3-practice"><div class="gt3-practice-t">Ready to practise?</div>' +
      '<p class="gt3-practice-n">' + exs.length + ' exercises for ' + lv.toUpperCase() + '</p>' +
      '<button class="btn btn-primary g-start" data-g2quiz="' + lv + '">Start ' + lv.toUpperCase() + ' exercises →</button></div>' : '';
    return '<section class="gt3-sec" id="g2-' + lv + '" style="--lv:' + (GH_LV_COLORS[lv] || '#8A93A6') + '">' +
      '<div class="gt3-sec-head"><span class="gt3-lv-badge" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' + lv.toUpperCase() + '</span>' +
      '<h2>' + (TW_LEVEL_LABEL[lv] || lv.toUpperCase()) + '</h2></div>' +
      '<div class="g-fa-audio" data-fa-lv="' + lv + '"></div>' +
      '<div class="g-en-audio" data-en-lv="' + lv + '"></div>' +
      pts + practice + '</section>';
  }).join('');
  var intro = (t.intro || []).map(function (p) { return '<p>' + gMd(p) + '</p>'; }).join('');
  v.innerHTML = '<div class="g-topic gt3-topic">' +
    '<a class="g-back" href="#/grammar">‹ All guides</a>' +
    '<div class="g-hero"><h1>' + esc(t.h1) + '</h1></div>' +
    bar + '<div class="g-intro">' + intro + '</div>' + sections + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-g2lv]'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var el = document.getElementById('g2-' + a.getAttribute('data-g2lv'));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  });
  Array.prototype.forEach.call(v.querySelectorAll('[data-g2quiz]'), function (btn) {
    btn.addEventListener('click', function () {
      startGrammarQuizV2(t, btn.getAttribute('data-g2quiz'));
    });
  });
  Array.prototype.forEach.call(v.querySelectorAll('.gt3-more'), function (btn) {
    btn.addEventListener('click', function () {
      var body = btn.nextElementSibling;
      var open = body.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.firstChild.textContent = open ? 'Hide examples & details ' : 'Show examples & details ';
    });
  });
  paintFaAudioBars(v, t.slug);
  paintEnAudioBars(v, t.slug);
  window.scrollTo(0, 0);
}

/* v2 quiz: per-level exercises, supports mcq / gap / error types */
function startGrammarQuizV2(topic, level) {
  var items = ((topic.exercises && topic.exercises.items) || []).filter(function (ex) {
    return (ex.level || '').toLowerCase() === level;
  });
  if (!items.length) return;
  var prog = grammarProgress();
  var rec = prog[topic.slug] || {};
  rec.attempts = (rec.attempts || 0) + 1;
  rec.h1 = topic.h1; rec.lastTs = Date.now();
  prog._last = topic.slug; prog[topic.slug] = rec;
  setGrammarProgress(prog);
  state.gquiz = {
    topic: topic, idx: 0, correct: 0, answered: false, picked: -1,
    firstRun: !rec.claimed, v2: true, v2level: level,
    items: shuffleArr(items)
  };
  document.body.classList.add('duo-playing');
  window.scrollTo(0, 0);
  renderGrammarQuizV2();
}
/* v2 quiz renderer: supports mcq / gap / error types */
function renderGrammarQuizV2() {
  var q = state.gquiz; if (!q || !q.v2) return;
  var v = document.getElementById('view');
  var it = q.items[q.idx];
  var n = q.items.length;
  var letters = ['A', 'B', 'C', 'D'];
  
  var inputHTML = '';
  if (it.type === 'mcq') {
    inputHTML = '<div class="gt-opts">' + it.options.map(function (op, i) {
      var cls = 'gt-opt';
      if (q.answered) {
        if (i === it.answer) cls += ' ok';
        else if (i === q.picked) cls += ' no';
        else cls += ' dim';
      }
      return '<button class="' + cls + '"' + (q.answered ? ' disabled' : '') + ' data-gopt="' + i + '">' +
        '<span class="gt-opt-letter">' + letters[i] + '</span>' +
        '<span class="gt-opt-text">' + esc(op) + '</span></button>';
    }).join('') + '</div>';
  } else if (it.type === 'gap') {
    inputHTML = '<div class="gt-gap-wrap"><input type="text" id="g2-gap-input" class="gt-gap-input" ' +
      'placeholder="Type your answer" ' + (q.answered ? 'disabled' : '') + ' value="' + esc(q.typed || '') + '">' +
      (q.answered ? '' : '<button class="gt-btn gt-btn-green" id="g2-gap-check">CHECK</button>') + '</div>';
  } else if (it.type === 'error') {
    inputHTML = '<div class="gt-opts gt-error-segs">' + (it.segments || []).map(function (seg, i) {
      var cls = 'gt-opt';
      if (q.answered) {
        if (i === it.answer) cls += ' ok';
        else if (i === q.picked) cls += ' no';
        else cls += ' dim';
      } else if (i === q.picked) cls += ' picked';
      return '<button class="' + cls + '"' + (q.answered ? ' disabled' : '') + ' data-gseg="' + i + '">' +
        '<span class="gt-opt-text">' + esc(seg) + '</span></button>';
    }).join('') + '</div>';
  }
  
  var sheet = '';
  if (q.answered) {
    var good = q.correct_flag;
    var correctText = '';
    if (it.type === 'mcq' || it.type === 'error') {
      correctText = it.type === 'mcq' ? esc(it.options[it.answer]) : esc(it.correction || '');
    } else {
      correctText = esc((it.accept || []).join(' / '));
    }
    sheet = '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
      '<div class="gt-sheet-msg">' + (good ? '🎉 Correct!' : '💡 Correct answer: <b>' + correctText + '</b>') + '</div>' +
      (it.explanation ? '<div class="gt-sheet-explain">' + gMd(it.explanation) + '</div>' : '') +
      '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="g-next-btn">' +
      (q.idx + 1 >= n ? 'SEE RESULTS' : 'CONTINUE') + '</button>' +
      '</div></div>';
  }
  
  var barPct = Math.round((q.idx + (q.answered ? 1 : 0)) / n * 100);
  v.innerHTML = '<div class="g-quiz gt-wrap">' +
    '<div class="gt-card"><div class="gt-top"><button class="gt-x" id="g-quiz-quit" aria-label="Back to guide">✕</button>' +
    '<div class="gt-progress"><span style="width:' + barPct + '%"></span></div>' +
    '<div class="gt-qcount">' + (q.idx + 1) + '/' + n + '</div></div>' +
    (q.firstRun ? '' : '<div class="gt-mode">Practice mode — no points</div>') +
    '<div class="gt-q">' + esc(it.prompt).replace(/___/g, '…') + '</div>' +
    inputHTML + '</div>' + sheet + '</div>';
  
  // Wire up events
  Array.prototype.forEach.call(v.querySelectorAll('[data-gopt]'), function (btn) {
    btn.addEventListener('click', function () { answerGrammarQuizV2(parseInt(btn.getAttribute('data-gopt'), 10)); });
  });
  Array.prototype.forEach.call(v.querySelectorAll('[data-gseg]'), function (btn) {
    btn.addEventListener('click', function () { answerGrammarQuizV2(parseInt(btn.getAttribute('data-gseg'), 10)); });
  });
  var gapCheck = document.getElementById('g2-gap-check');
  if (gapCheck) {
    gapCheck.addEventListener('click', function () {
      var input = document.getElementById('g2-gap-input');
      answerGrammarQuizV2(input.value);
    });
  }
  var next = document.getElementById('g-next-btn');
  if (next) next.addEventListener('click', nextGrammarQuiz);
  document.getElementById('g-quiz-quit').addEventListener('click', function () {
    if (!quizGuardOk()) return;
    state.gquiz = null;
    document.body.classList.remove('duo-playing');
    go('grammar', q.topic.slug);
  });
  window.scrollTo(0, 0);
}

function answerGrammarQuizV2(val) {
  var q = state.gquiz;
  if (!q || !q.v2 || q.answered) return;
  q.answered = true;
  var it = q.items[q.idx];
  var correct = false;
  
  if (it.type === 'mcq' || it.type === 'error') {
    q.picked = val;
    correct = (val === it.answer);
  } else if (it.type === 'gap') {
    q.typed = val;
    var norm = function(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/\.$/, ''); };
    var vnorm = norm(val);
    correct = (it.accept || []).some(function(a) { return norm(a) === vnorm; });
  }
  
  q.correct_flag = correct;
  if (correct) {
    q.correct++;
    if (q.firstRun) awardPoints('grammar_exercise', 5, 'gex-' + it.id);
  } else {
    saveMistake({ date: todayStr(), level: q.v2level, kind: 'grammar', topic: q.topic.slug,
      question: it.prompt, options: it.options || [], answer: it.answer, picked: val });
  }
  renderGrammarQuizV2();
  window.scrollTo(0, 0);
}


/* ---------------- grammar quiz ---------------- */

function shuffleArr(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function startGrammarQuiz(topic) {
  var prog = grammarProgress();
  var rec = prog[topic.slug] || {};
  rec.attempts = (rec.attempts || 0) + 1;
  rec.h1 = topic.h1; rec.lastTs = Date.now();
  prog._last = topic.slug; prog[topic.slug] = rec;
  setGrammarProgress(prog);
  state.gquiz = {
    topic: topic, idx: 0, correct: 0, answered: false, picked: -1,
    firstRun: !rec.claimed,
    items: shuffleArr(topic.exercises.items)
  };
  document.body.classList.add('duo-playing');
  window.scrollTo(0, 0);
  renderGrammarQuiz();
}

function renderGrammarQuiz() {
  var q = state.gquiz; if (!q) return;
  if (q.v2) { renderGrammarQuizV2(); return; }
  var v = document.getElementById('view');
  var it = q.items[q.idx];
  var n = q.items.length;
  var letters = ['A', 'B', 'C', 'D'];
  var opts = it.options.map(function (op, i) {
    var cls = 'gt-opt';
    if (q.answered) {
      if (i === it.answer) cls += ' ok';
      else if (i === q.picked) cls += ' no';
      else cls += ' dim';
    }
    return '<button class="' + cls + '"' + (q.answered ? ' disabled' : '') + ' data-gopt="' + i + '">' +
      '<span class="gt-opt-letter">' + letters[i] + '</span>' +
      '<span class="gt-opt-text">' + esc(op) + '</span></button>';
  }).join('');
  var sheet = '';
  if (q.answered) {
    var good = q.picked === it.answer;
    sheet = '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
      '<div class="gt-sheet-msg">' + (good ? '🎉 Correct!' : '💡 Correct answer: <b>' + esc(it.options[it.answer]) + '</b>') + '</div>' +
      (it.explanation ? '<div class="gt-sheet-explain">' + gMd(it.explanation) + '</div>' : '') +
      '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="g-next-btn">' +
      (q.idx + 1 >= n ? 'SEE RESULTS' : 'CONTINUE') + '</button>' +
      '</div></div>';
  }
  var barPct = Math.round((q.idx + (q.answered ? 1 : 0)) / n * 100);
  v.innerHTML = '<div class="g-quiz gt-wrap">' +
    '<div class="gt-card"><div class="gt-top"><button class="gt-x" id="g-quiz-quit" aria-label="Back to guide">✕</button>' +
    '<div class="gt-progress"><span style="width:' + barPct + '%"></span></div>' +
    '<div class="gt-qcount">' + (q.idx + 1) + '/' + n + '</div></div>' +
    (q.firstRun ? '' : '<div class="gt-mode">Practice mode — no points</div>') +
    '<div class="gt-q">' + esc(it.prompt).replace(/___/g, '…') + '</div>' +
    '<div class="gt-opts">' + opts + '</div></div>' + sheet + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-gopt]'), function (btn) {
    btn.addEventListener('click', function () { answerGrammarQuiz(parseInt(btn.getAttribute('data-gopt'), 10)); });
  });
  var next = document.getElementById('g-next-btn');
  if (next) next.addEventListener('click', nextGrammarQuiz);
  (function () {
    var slug = q.topic.slug;
    document.getElementById('g-quiz-quit').addEventListener('click', function () {
      if (!quizGuardOk()) return;
      state.gquiz = null;
      document.body.classList.remove('duo-playing');
      go('grammar', slug);
    });
  })();
  window.scrollTo(0, 0);
}

function answerGrammarQuiz(i) {
  var q = state.gquiz;
  if (!q || q.answered) return;
  q.answered = true; q.picked = i;
  var it = q.items[q.idx];
  if (i === it.answer) {
    q.correct++;
    if (q.firstRun) awardPoints('grammar_exercise', 5, 'gex-' + q.topic.slug + '-' + it.id);
  } else {
    saveMistake({ date: todayStr(), level: q.topic.level, kind: 'grammar', topic: q.topic.slug,
      question: it.prompt, options: it.options, answer: it.answer, picked: i });
  }
  renderGrammarQuiz();
  window.scrollTo(0, 0);
}

function nextGrammarQuiz() {
  var q = state.gquiz; if (!q) return;
  if (q.idx + 1 >= q.items.length) { finishGrammarQuiz(); return; }
  q.idx++; q.answered = false; q.picked = -1;
  renderGrammarQuiz();
  window.scrollTo(0, 0);
}

function finishGrammarQuiz() {
  var q = state.gquiz; if (!q) return;
  var topic = q.topic;
  var slug = topic.slug, total = q.items.length, correct = q.correct;
  var prog = grammarProgress();
  var rec = prog[slug] || {};
  rec.done = true;
  rec.best = Math.max(rec.best || 0, correct);
  rec.total = total; rec.h1 = topic.h1; rec.lastTs = Date.now();
  var bonus = q.firstRun && !rec.claimed;
  if (bonus) { rec.claimed = true; awardPoints('grammar_topic_done', 20, 'gtd-' + slug); }
  prog[slug] = rec; setGrammarProgress(prog);
  saveAttempt({ kind: 'grammar_topic', theme: slug, level: topic.level, score: correct, total: total, date: todayStr() });
  state.gquiz = null;
  document.body.classList.remove('duo-playing');
  var v = document.getElementById('view');
  var msg = correct === total ? 'Perfect!'
    : correct >= total * 0.7 ? 'Great job!'
    : correct >= total * 0.4 ? 'Good effort!'
    : 'Keep practising!';
  var mascot = correct === total ? '🏆' : correct >= total * 0.7 ? '🎉' : '📝';
  v.innerHTML = '<div class="g-quiz gt-wrap"><div class="gt-report">' +
    '<div class="gt-mascot">' + mascot + '</div>' +
    '<h1>' + msg + '</h1>' +
    '<div class="gt-score"><b>' + correct + '</b><span>/' + total + '</span></div>' +
    '<p class="gt-sub">' + esc(topic.h1) + '</p>' +
    (bonus ? '<p class="g-xp-note">+20 completion bonus earned!</p>' : '') +
    '<div class="gt-end-btns"><button class="gt-btn gt-btn-green gt-btn-big" id="g-retry-btn">TRY AGAIN</button>' +
    '<a class="gt-btn gt-btn-ghost" href="#/grammar">All guides</a></div>' +
    '</div></div>';
  document.getElementById('g-retry-btn').addEventListener('click', function () {
    if (q.v2) startGrammarQuizV2(topic, q.v2level);
    else startGrammarQuiz(topic);
  });
  window.scrollTo(0, 0);
}

/* ---------------- grammar home banner ---------------- */

function paintGrammarBanner() {
  var wrap = document.getElementById('home-grammar-wrap');
  if (!wrap) return;
  var prog = grammarProgress();
  var doneCount = 0;
  Object.keys(prog).forEach(function (k) {
    if (k.charAt(0) === '_') return;
    if (prog[k] && prog[k].done) doneCount++;
  });
  var lastSlug = prog._last;
  var lastRec = (lastSlug && prog[lastSlug] && !prog[lastSlug].done) ? prog[lastSlug] : null;
  /* Mobile: 2026-10-20 mockup card (CONTINUE / GRAMMAR). Desktop keeps g-banner. */
  if (!isDesktop()) {
    if (doneCount >= GRAMMAR_TOTAL) {
      wrap.innerHTML = '<a class="hm-card" href="#/grammar">' +
        '<span class="hm-icon">🎉</span><span class="hm-main"><span class="hm-kicker">Grammar</span>' +
        '<span class="hm-title">All ' + GRAMMAR_TOTAL + ' grammar guides completed!</span>' +
        '<span class="hm-subtxt">Review any topic any time.</span></span>' +
        '<span class="hm-btn hm-btn-soft">Review →</span></a>';
    } else if (lastRec) {
      var pct2 = Math.round(((lastRec.best || 0) / (lastRec.total || 16)) * 100);
      wrap.innerHTML = '<a class="hm-card" href="#/grammar/' + esc(lastSlug) + '">' +
        '<span class="hm-icon">📖</span><span class="hm-main"><span class="hm-kicker">Continue</span>' +
        '<span class="hm-title">' + esc(lastRec.h1 || lastSlug) + '</span>' +
        '<span class="hm-bar"><span style="width:' + pct2 + '%"></span></span></span>' +
        '<span class="hm-btn hm-btn-solid">Continue →</span></a>';
    } else {
      wrap.innerHTML = '<a class="hm-card" href="#/grammar">' +
        '<span class="hm-icon">📖</span><span class="hm-main"><span class="hm-kicker">Grammar</span>' +
        '<span class="hm-title">Grammar Guides</span>' +
        '<span class="hm-subtxt">' + GRAMMAR_TOTAL + ' topics · A1–C2 · read, practise, earn points</span></span>' +
        '<span class="hm-btn hm-btn-soft">Explore →</span></a>';
    }
    return;
  }
  var inner;
  if (doneCount >= GRAMMAR_TOTAL) {
    inner = '<span class="g-b-icon">🎉</span><span class="g-b-main"><b>All ' + GRAMMAR_TOTAL + ' grammar guides completed!</b>' +
      '<span>Review any topic any time.</span></span><span class="g-b-cta">Review →</span>';
    wrap.innerHTML = '<a class="g-banner" href="#/grammar">' + inner + '</a>';
  } else if (lastRec) {
    var pct = Math.round(((lastRec.best || 0) / (lastRec.total || 16)) * 100);
    inner = '<span class="g-b-icon">📖</span><span class="g-b-main"><b>Continue: ' + esc(lastRec.h1 || lastSlug) + '</b>' +
      '<span class="g-b-bar"><span style="width:' + pct + '%"></span></span></span><span class="g-b-cta">Continue →</span>';
    wrap.innerHTML = '<a class="g-banner" href="#/grammar/' + esc(lastSlug) + '">' + inner + '</a>';
  } else {
    inner = '<span class="g-b-icon">📖</span><span class="g-b-main"><b>Grammar Guides</b>' +
      '<span>' + GRAMMAR_TOTAL + ' topics · A1–C2 · read, practise, earn points</span></span><span class="g-b-cta">Explore →</span>';
    wrap.innerHTML = '<a class="g-banner" href="#/grammar">' + inner + '</a>';
  }
}

/* ---------------- grammar placement test (#/grammar-test) ----------------
   Duolingo-style: 30 questions (6 per level, A1 -> C1, easy to hard),
   20-minute timer, instant feedback with a CONTINUE sheet.
   The result is a weak-spot REPORT only — no level label is ever shown. */

var GTEST_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'];
var GTEST_PER_LEVEL = 6;
var GTEST_SECONDS = 20 * 60;

function getGTestStore() {
  var s = lsGet('muse_grammar_test_v1');
  return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
}
function setGTestStore(s) { lsSet('muse_grammar_test_v1', s); }

function gtestStopTimer() {
  if (state.gtest && state.gtest.timerId) { clearInterval(state.gtest.timerId); state.gtest.timerId = null; }
}
function gtestFmt(s) {
  s = Math.max(0, s);
  var m = Math.floor(s / 60), r = s % 60;
  return (m < 10 ? '0' + m : '' + m) + ':' + (r < 10 ? '0' + r : '' + r);
}

/* Round-robin across topics so the 6 questions per level come from 6 different topics. */
function sampleGTestQuestions(bundles) {
  var out = [];
  GTEST_LEVELS.forEach(function (lv) {
    var perTopic = shuffleArr((bundles[lv] || []).slice()).map(function (t) {
      return { topic: t, items: shuffleArr(((t.exercises || {}).items || []).slice()) };
    }).filter(function (pt) { return pt.items.length; });
    var picked = [], round = 0;
    while (picked.length < GTEST_PER_LEVEL && round < 60) {
      var moved = false;
      for (var k = 0; k < perTopic.length && picked.length < GTEST_PER_LEVEL; k++) {
        var pt = perTopic[(round + k) % perTopic.length];
        if (pt.items.length) {
          picked.push({ lv: lv, topic: pt.topic, item: pt.items.pop() });
          moved = true;
        }
      }
      round++;
      if (!moved) break;
    }
    out = out.concat(picked);
  });
  return out;
}

function renderGrammarTest(v, arg) {
  if (arg === 'report') { renderGTestReport(v, null); return; }
  /* Fresh entry (or re-entry after leaving): show the intro screen. */
  if (!state.gtest || state.gtest.done) { gtestIntro(v); return; }
  renderGTestQ();
}

function gtestIntro(v) {
  var last = getGTestStore().last;
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro">' +
    '<div class="gt-mascot">🎯</div>' +
    '<h1>Check your grammar!</h1>' +
    '<p class="gt-sub">30 questions · A1 to C1 · about 20 minutes</p>' +
    '<p>Take your time — when you finish you get a personal report showing exactly which grammar topics to work on.</p>' +
    (last ? '<p class="gt-last">Your last report: <b>' + last.correct + '/' + last.total + '</b> correct · ' +
      last.weak.length + ' weak spot' + (last.weak.length === 1 ? '' : 's') +
      ' · <a href="#/grammar-test/report">view</a></p>' : '') +
    '<div id="gt-intro-err"></div>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="gt-start">START</button>' +
    '<div><a class="gt-quit-link" href="#/grammar">‹ Back to grammar guides</a></div>' +
    '</div></div>';
  document.getElementById('gt-start').addEventListener('click', startGTest);
  window.scrollTo(0, 0);
}

function startGTest() {
  var btn = document.getElementById('gt-start');
  if (btn) { btn.disabled = true; btn.textContent = 'LOADING…'; }
  var loads = {};
  Promise.all(GTEST_LEVELS.map(function (lv) {
    return loadGrammarLevel(lv).then(function (topics) { loads[lv] = topics; });
  })).then(function () {
    var items = sampleGTestQuestions(loads);
    if (items.length < GTEST_LEVELS.length * GTEST_PER_LEVEL) throw new Error('not enough questions');
    state.gtest = {
      items: items, idx: 0, answered: false, picked: -1,
      results: [], timerId: null, secsLeft: GTEST_SECONDS, done: false
    };
    renderGTestQ();
    document.body.classList.add('duo-playing');
    state.gtest.timerId = setInterval(gtestTick, 1000);
  }).catch(function () {
    var err = document.getElementById('gt-intro-err');
    if (err) err.innerHTML = '<div class="gt-err">Could not load the questions. Check your connection and try again.</div>';
    if (btn) { btn.disabled = false; btn.textContent = 'START'; }
  });
}

function gtestTick() {
  var q = state.gtest;
  if (!q || q.done) { gtestStopTimer(); return; }
  q.secsLeft--;
  var el = document.getElementById('gt-timer');
  if (el) el.textContent = gtestFmt(q.secsLeft);
  if (q.secsLeft <= 0) finishGTest(true);
}

function renderGTestQ() {
  var q = state.gtest; if (!q || q.done) return;
  var v = document.getElementById('view');
  var cur = q.items[q.idx], it = cur.item;
  var n = q.items.length;
  var letters = ['A', 'B', 'C', 'D'];
  var opts = it.options.map(function (op, i) {
    var cls = 'gt-opt';
    if (q.answered) {
      if (i === it.answer) cls += ' ok';
      else if (i === q.picked) cls += ' no';
      else cls += ' dim';
    }
    return '<button class="' + cls + '"' + (q.answered ? ' disabled' : '') + ' data-gopt="' + i + '">' +
      '<span class="gt-opt-letter">' + letters[i] + '</span>' +
      '<span class="gt-opt-text">' + esc(op) + '</span></button>';
  }).join('');
  var sheet = '';
  if (q.answered) {
    var good = q.picked === it.answer;
    sheet = '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
      '<div class="gt-sheet-msg">' + (good ? '🎉 Correct!' : '💡 Correct answer: <b>' + esc(it.options[it.answer]) + '</b>') + '</div>' +
      '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="gt-continue">CONTINUE</button>' +
      '</div></div>';
  }
  var barPct = Math.round((q.idx + (q.answered ? 1 : 0)) / n * 100);
  v.innerHTML = '<div class="gt-wrap">' +
    '<div class="gt-top"><button class="gt-x" id="gt-quit" aria-label="Quit test">✕</button>' +
    '<div class="gt-progress"><span style="width:' + barPct + '%"></span></div>' +
    '<div class="gt-timer" id="gt-timer" title="Time left">' + gtestFmt(q.secsLeft) + '</div></div>' +
    '<div class="gt-q">' + esc(it.prompt).replace(/___/g, '…') + '</div>' +
    '<div class="gt-opts">' + opts + '</div>' + sheet + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-gopt]'), function (btn) {
    btn.addEventListener('click', function () { answerGTest(parseInt(btn.getAttribute('data-gopt'), 10)); });
  });
  var cont = document.getElementById('gt-continue');
  if (cont) cont.addEventListener('click', nextGTest);
  document.getElementById('gt-quit').addEventListener('click', function () { go('grammar'); });
  window.scrollTo(0, 0);
}

function answerGTest(i) {
  var q = state.gtest;
  if (!q || q.done || q.answered) return;
  q.answered = true; q.picked = i;
  var cur = q.items[q.idx], it = cur.item;
  var ok = (i === it.answer);
  q.results[q.idx] = { picked: i, ok: ok };
  if (ok) {
    /* Same idempotent ref as the topic quiz: no double-farming across retakes. */
    awardPoints('grammar_exercise', 5, 'gex-' + cur.topic.slug + '-' + it.id);
  } else {
    saveMistake({ date: todayStr(), level: cur.lv, kind: 'grammar', topic: cur.topic.slug,
      question: it.prompt, options: it.options, answer: it.answer, picked: i });
  }
  renderGTestQ();
}

function nextGTest() {
  var q = state.gtest; if (!q || q.done) return;
  if (q.idx + 1 >= q.items.length) { finishGTest(false); return; }
  q.idx++; q.answered = false; q.picked = -1;
  renderGTestQ();
}

function finishGTest(timeUp) {
  var q = state.gtest; if (!q || q.done) return;
  q.done = true;
  gtestStopTimer();
  document.body.classList.remove('duo-playing');
  /* Unanswered questions (time ran out) count as missed. */
  for (var i = 0; i < q.items.length; i++) {
    if (!q.results[i]) q.results[i] = { picked: -1, ok: false, skipped: true };
  }
  var correct = q.results.filter(function (r) { return r.ok; }).length;
  var total = q.items.length;
  /* Per-level performance + weak spots grouped by topic. No level verdict. */
  var perLevel = {}, byTopic = {}, order = [];
  q.items.forEach(function (cur, idx) {
    var r = q.results[idx];
    var pl = perLevel[cur.lv] = perLevel[cur.lv] || { c: 0, t: 0 };
    pl.t++; if (r.ok) pl.c++;
    var k = cur.topic.slug;
    if (!byTopic[k]) { byTopic[k] = { slug: k, h1: cur.topic.h1, lv: cur.lv, wrong: 0, total: 0 }; order.push(k); }
    byTopic[k].total++;
    if (!r.ok) byTopic[k].wrong++;
  });
  var weak = order.map(function (k) { return byTopic[k]; })
    .filter(function (t) { return t.wrong > 0; })
    .sort(function (a, b) { return (b.wrong - a.wrong) || (GTEST_LEVELS.indexOf(a.lv) - GTEST_LEVELS.indexOf(b.lv)); });
  var report = {
    ts: Date.now(), correct: correct, total: total, timeUp: !!timeUp,
    perLevel: GTEST_LEVELS.map(function (lv) {
      return { lv: lv, c: (perLevel[lv] || {}).c || 0, t: (perLevel[lv] || {}).t || 0 };
    }),
    weak: weak
  };
  var store = getGTestStore();
  store.last = report;
  store.count = (store.count || 0) + 1;
  setGTestStore(store);
  saveAttempt({ kind: 'grammar_test', theme: 'placement', score: correct, total: total, date: todayStr() });
  state.gtest = null;
  renderGTestReport(document.getElementById('view'), report);
}

function renderGTestReport(v, report) {
  if (!report) {
    var last = getGTestStore().last;
    if (!last) { go('grammar-test'); return; }
    report = last;
  }
  var weakHTML;
  if (!report.weak.length) {
    weakHTML = '<div class="gt-flawless">🎉 <b>Flawless!</b><br>You got every question right — nothing to fix here.</div>';
  } else {
    weakHTML = '<div class="gt-weak-head">🎯 <b>Focus on these topics:</b></div>' +
      '<div class="gt-weak-list">' + report.weak.map(function (w) {
        return '<div class="gt-weak-row"><span class="g-lv g-lv-' + w.lv + '">' + w.lv.toUpperCase() + '</span>' +
          '<span class="gt-weak-main"><b>' + esc(w.h1) + '</b>' +
          '<span>' + w.wrong + ' missed</span></span>' +
          '<a class="gt-btn gt-btn-blue gt-btn-sm" href="#/grammar/' + esc(w.slug) + '">REVIEW</a></div>';
      }).join('') + '</div>';
  }
  var bars = '<div class="gt-levels"><div class="gt-weak-head">📊 <b>By level:</b></div>' +
    report.perLevel.map(function (p) {
      var pct = p.t ? Math.round(p.c / p.t * 100) : 0;
      return '<div class="gt-level-row"><span class="g-lv g-lv-' + p.lv + '">' + p.lv.toUpperCase() + '</span>' +
        '<div class="gt-level-bar"><span style="width:' + pct + '%"></span></div>' +
        '<span class="gt-level-num">' + p.c + '/' + p.t + '</span></div>';
    }).join('') + '</div>';
  v.innerHTML = '<div class="gt-wrap"><div class="gt-report">' +
    '<div class="gt-mascot">📊</div>' +
    '<h1>Your grammar report</h1>' +
    (report.timeUp ? '<p class="gt-sub">Time ran out — unanswered questions count as missed.</p>' : '') +
    '<div class="gt-score"><b>' + report.correct + '</b><span>/' + report.total + ' correct</span></div>' +
    weakHTML + bars +
    '<div class="gt-end-btns"><button class="gt-btn gt-btn-green gt-btn-big" id="gt-retake">RETAKE TEST</button>' +
    '<a class="gt-btn gt-btn-ghost" href="#/grammar">Back to grammar guides</a></div>' +
    '</div></div>';
  document.getElementById('gt-retake').addEventListener('click', function () { go('grammar-test'); });
  window.scrollTo(0, 0);
}

/* Hub banner: "Check your grammar!" first time, last-report summary after. */
function paintGTestBanner() {
  var wrap = document.getElementById('gtest-banner-wrap');
  if (!wrap) return;
  var last = getGTestStore().last;
  var inner;
  if (last) {
    inner = '<span class="g-b-icon">🎯</span><span class="g-b-main"><b>Grammar check-up</b>' +
      '<span>Last report: <b>' + last.correct + '/' + last.total + '</b> · ' +
      last.weak.length + ' weak spot' + (last.weak.length === 1 ? '' : 's') + '</span></span>' +
      '<span class="g-b-ctas"><a class="g-b-link" href="#/grammar-test/report">View report</a>' +
      '<a class="g-b-cta" href="#/grammar-test">Retake →</a></span>';
    wrap.innerHTML = '<div class="g-banner">' + inner + '</div>';
  } else {
    inner = '<span class="g-b-icon">🎯</span><span class="g-b-main"><b>Check your grammar!</b>' +
      '<span>30 questions · A1–C1 · get your personal weak-spot report</span></span>' +
      '<span class="g-b-cta">Start →</span>';
    wrap.innerHTML = '<a class="g-banner" href="#/grammar-test">' + inner + '</a>';
  }
}

/* ============ Teacher placement test (#/ptest/<ref>) ============
   A teacher sends their link to a new student. The student signs up
   (attributed to the teacher via the existing el_ref flow), fills in
   name + mobile, then takes 5 sections: vocabulary (15), listening (10),
   grammar (20), writing (1), speaking/shadowing (10). Each finished
   section is saved immediately so the test can be resumed later.
   The student NEVER sees scores or a level. The teacher sees everything
   in their dashboard, including a suggested level (teacher-only). */

var PTEST_VERSION = 'v1';
var PTEST_BUNDLE_URL = '/data/placement/v1.json';
/* Suggested-level bands over the 55 auto-scored points. Teacher sees only. */
var PTEST_BANDS = [[13, 'A1'], [26, 'A2'], [38, 'B1'], [48, 'B2'], [55, 'C1']];
var PTEST_SECTIONS = [
  { id: 'vocab', title: 'Vocabulary', sub: '15 questions · look at the picture and definition, pick the word' },
  { id: 'listening', title: 'Listening', sub: '10 questions · a short podcast and everyday dialogues' },
  { id: 'grammar', title: 'Grammar', sub: '20 questions' },
  { id: 'writing', title: 'Writing', sub: 'describe the picture in 5–8 sentences' },
  { id: 'shadowing', title: 'Speaking', sub: '10 sentences · listen and repeat aloud' },
];

function teacherPlacementLink(code) {
  return window.location.origin + '/#/ptest/' + encodeURIComponent(code);
}
function ptestSuggestedLevel(total) {
  for (var i = 0; i < PTEST_BANDS.length; i++) {
    if (total <= PTEST_BANDS[i][0]) return PTEST_BANDS[i][1];
  }
  return 'C1';
}
function ptestLoadBundle() {
  if (state.ptestBundle) return Promise.resolve(state.ptestBundle);
  return fetch(PTEST_BUNDLE_URL).then(function (r) {
    if (!r.ok) throw new Error('bundle missing');
    return r.json();
  }).then(function (b) { state.ptestBundle = b; return b; });
}
function ptestIsDemo() { return !sb || !state.user || state.user.demo; }

/* ---- entry ---- */
function renderPTest(v, ref) {
  ref = (ref || '').trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(ref)) {
    v.innerHTML = '<div class="gt-wrap"><div class="gt-intro"><div class="gt-mascot">🔗</div>' +
      '<h1>Invalid test link</h1><p>Ask your teacher for a fresh link.</p></div></div>';
    return;
  }
  /* First-touch referral attribution: the student is linked to the teacher. */
  try { if (!localStorage.getItem('el_ref')) localStorage.setItem('el_ref', ref); } catch (e) {}
  state.ptestRef = ref;
  if (!state.user) { ptestIntroAnon(v, ref); return; }
  ptestBoot(v, ref);
}

function ptestPartsHTML() {
  return '<div class="ptest-parts">' + PTEST_SECTIONS.map(function (s, i) {
    var n = { vocab: 15, listening: 10, grammar: 20, writing: 1, shadowing: 10 }[s.id];
    return '<div class="ptest-part"><span class="ptest-part-n">' + (i + 1) + '</span>' +
      '<span class="ptest-part-t"><b>' + s.title + '</b><span>' + n + (n === 1 ? ' task' : ' questions') + '</span></span></div>';
  }).join('') + '</div>';
}

function ptestIntroAnon(v, ref) {
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro">' +
    '<div class="gt-mascot">🎓</div>' +
    '<h1>English placement test</h1>' +
    '<p class="gt-sub">Your teacher invited you to take this test.</p>' +
    '<p>It has 5 parts and takes about 45–60 minutes. You can pause between parts — each finished part is saved.</p>' +
    ptestPartsHTML() +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ptest-signup">Sign up free</button>' +
    '<div><a class="gt-quit-link" href="javascript:void(0)" id="ptest-login">I already have an account — log in</a></div>' +
    '</div></div>';
  var goAuth = function (where) {
    try { sessionStorage.setItem('ptest_return', '#/ptest/' + ref); } catch (e) {}
    go(where);
  };
  document.getElementById('ptest-signup').addEventListener('click', function () { goAuth('signup'); });
  document.getElementById('ptest-login').addEventListener('click', function () { goAuth('signin'); });
  window.scrollTo(0, 0);
}

/* ---- logged-in boot: resume, identity, or already-done ---- */
async function ptestBoot(v, ref) {
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro"><div class="empty">Loading your test…</div></div></div>';
  var bundle;
  try { bundle = await ptestLoadBundle(); }
  catch (e) {
    v.innerHTML = '<div class="gt-wrap"><div class="gt-intro"><div class="gt-err">Could not load the test. Check your connection and try again.</div></div></div>';
    return;
  }
  var row = await ptestLoadRow();
  if (row && row.status === 'completed') { ptestAlreadyDone(v, row); return; }
  if (row && row.status === 'in_progress') { ptestResume(v, ref, bundle, row); return; }
  ptestIdentity(v, ref, bundle, row);
}

async function ptestLoadRow() {
  if (ptestIsDemo()) {
    try {
      var raw = localStorage.getItem('ptest_row_' + PTEST_VERSION);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  try {
    var r = await sb.from('placement_results')
      .select('*').eq('student_id', state.user.id).eq('test_version', PTEST_VERSION)
      .maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  } catch (e) { return null; }
}

async function ptestSaveRow(patch) {
  var row = state.ptestRow = Object.assign({}, state.ptestRow || {}, patch, { updated_at: new Date().toISOString() });
  if (ptestIsDemo()) {
    try { localStorage.setItem('ptest_row_' + PTEST_VERSION, JSON.stringify(row)); } catch (e) {}
    return row;
  }
  try {
    var payload = Object.assign({}, row);
    delete payload.id;
    var r = await sb.from('placement_results').upsert(
      Object.assign({ student_id: state.user.id, test_version: PTEST_VERSION }, payload),
      { onConflict: 'student_id,test_version' }
    ).select().maybeSingle();
    if (r.error) throw r.error;
    if (r.data) state.ptestRow = r.data;
  } catch (e) { /* offline: local copy kept; next section save retries */ }
  return state.ptestRow;
}

function ptestAlreadyDone(v, row) {
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro"><div class="gt-mascot">✅</div>' +
    '<h1>Test already completed</h1>' +
    '<p>You finished this placement test' + (row.completed_at ? ' on ' + esc(row.completed_at.slice(0, 10)) : '') + '. Your teacher has your results.</p>' +
    '<a class="gt-btn gt-btn-green" href="#/home">Back to home</a></div></div>';
  window.scrollTo(0, 0);
}

function ptestResume(v, ref, bundle, row) {
  var doneIds = Object.keys(row.sections || {});
  var nextIdx = 0;
  for (var i = 0; i < PTEST_SECTIONS.length; i++) {
    if (doneIds.indexOf(PTEST_SECTIONS[i].id) === -1) break;
    nextIdx = i + 1;
  }
  state.ptestRow = row;
  var list = PTEST_SECTIONS.map(function (s, i) {
    var done = doneIds.indexOf(s.id) !== -1;
    return '<div class="ptest-part' + (done ? ' done' : '') + '"><span class="ptest-part-n">' +
      (done ? '✓' : (i + 1)) + '</span>' +
      '<span class="ptest-part-t"><b>' + s.title + '</b><span>' +
      (done ? 'completed' : (i === nextIdx ? 'up next' : 'pending')) + '</span></span></div>';
  }).join('');
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro">' +
    '<div class="gt-mascot">👋</div>' +
    '<h1>Welcome back' + (row.student_name ? ', ' + esc(row.student_name.split(' ')[0]) : '') + '!</h1>' +
    '<p>You can continue your placement test where you left off.</p>' +
    '<div class="ptest-parts">' + list + '</div>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ptest-continue">Continue</button>' +
    '</div></div>';
  document.getElementById('ptest-continue').addEventListener('click', function () {
    ptestSectionIntro(document.getElementById('view'), ref, bundle, nextIdx);
  });
  window.scrollTo(0, 0);
}

/* ---- identity: name + mobile (teacher needs to find the student) ---- */
function ptestIdentity(v, ref, bundle, row) {
  var nm = (row && row.student_name) || '';
  var mo = (row && row.student_mobile) || '';
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro">' +
    '<div class="gt-mascot">👋</div>' +
    '<h1>Before we start…</h1>' +
    '<p>Tell us who you are so your teacher can find your results.</p>' +
    '<div class="ptest-form">' +
    '<label>Your full name<input id="ptest-name" type="text" maxlength="60" value="' + esc(nm) + '" placeholder="e.g. Sara Ahmadi" autocomplete="name"></label>' +
    '<label>Mobile number<input id="ptest-mobile" type="tel" maxlength="20" value="' + esc(mo) + '" placeholder="e.g. +1 416 555 0132" autocomplete="tel"></label>' +
    '<div class="ptest-privacy">🔒 Only your teacher sees this, so they can contact you about your results.</div>' +
    '<div class="gt-err hidden" id="ptest-id-err"></div>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ptest-id-go">Start the test</button>' +
    '</div></div></div>';
  document.getElementById('ptest-id-go').addEventListener('click', async function () {
    var name = document.getElementById('ptest-name').value.trim();
    var mobile = document.getElementById('ptest-mobile').value.trim();
    var err = document.getElementById('ptest-id-err');
    var digits = mobile.replace(/\D/g, '');
    if (name.length < 2) { err.textContent = 'Please enter your name.'; err.classList.remove('hidden'); return; }
    if (digits.length < 7) { err.textContent = 'Please enter a valid mobile number.'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    var btn = document.getElementById('ptest-id-go');
    btn.disabled = true; btn.textContent = 'Saving…';
    await ptestSaveRow({
      teacher_ref: ref, status: 'in_progress',
      student_name: name, student_mobile: mobile,
      sections: (state.ptestRow && state.ptestRow.sections) || {},
      started_at: (state.ptestRow && state.ptestRow.started_at) || new Date().toISOString(),
    });
    ptestSectionIntro(document.getElementById('view'), ref, bundle, 0);
  });
  window.scrollTo(0, 0);
}

/* ---- section intros = natural pause points ---- */
function ptestSectionIntro(v, ref, bundle, idx) {
  var s = PTEST_SECTIONS[idx];
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro">' +
    '<div class="gt-mascot">' + ['📚', '🎧', '📝', '✍️', '🎤'][idx] + '</div>' +
    '<p class="gt-sub">Part ' + (idx + 1) + ' of ' + PTEST_SECTIONS.length + '</p>' +
    '<h1>' + s.title + '</h1>' +
    '<p>' + s.sub + '.</p>' +
    (idx > 0 ? '<p class="gt-sub">You can stop after this part — your progress is saved.</p>' : '') +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ptest-sec-go">Start</button>' +
    '<div><a class="gt-quit-link" href="#/home">‹ Leave the test for now</a></div>' +
    '</div></div>';
  document.getElementById('ptest-sec-go').addEventListener('click', function () {
    ptestStartSection(ref, bundle, idx);
  });
  window.scrollTo(0, 0);
}

function ptestStartSection(ref, bundle, idx) {
  state.ptest = { ref: ref, bundle: bundle, secIdx: idx, qIdx: 0, answers: [], t0: Date.now() };
  document.body.classList.add('duo-playing');
  var id = PTEST_SECTIONS[idx].id;
  if (id === 'vocab') ptestVocabQ();
  else if (id === 'listening') ptestListeningQ();
  else if (id === 'grammar') ptestGrammarQ();
  else if (id === 'writing') ptestWriting();
  else if (id === 'shadowing') ptestShadowing();
}
function ptestQuitSection() {
  document.body.classList.remove('duo-playing');
  state.ptest = null;
}

/* shared Duolingo chrome for one-question-at-a-time sections */
function ptestTopHTML(answeredCount, total) {
  var pct = Math.round(answeredCount / total * 100);
  return '<div class="gt-top"><button class="gt-x" id="ptest-quit" aria-label="Leave test">✕</button>' +
    '<div class="gt-progress"><span style="width:' + pct + '%"></span></div>' +
    '<div class="gt-qcount">' + answeredCount + '/' + total + '</div></div>';
}
function ptestWireQuit() {
  document.getElementById('ptest-quit').addEventListener('click', function () {
    if (window.confirm('Leave the test? Your finished parts are saved.')) {
      ptestQuitSection();
      go('home');
    }
  });
}
function ptestOptsHTML(options, answered, picked, correctIdx) {
  var letters = ['A', 'B', 'C', 'D'];
  return options.map(function (op, i) {
    var cls = 'gt-opt';
    if (answered) {
      if (i === correctIdx) cls += ' ok';
      else if (i === picked) cls += ' no';
      else cls += ' dim';
    }
    return '<button class="' + cls + '"' + (answered ? ' disabled' : '') + ' data-popt="' + i + '">' +
      '<span class="gt-opt-letter">' + letters[i] + '</span>' +
      '<span class="gt-opt-text">' + esc(op) + '</span></button>';
  }).join('');
}
function ptestSheetHTML(good, correctText, btnLabel) {
  return '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
    '<div class="gt-sheet-msg">' + (good ? '🎉 Correct!' : '💡 Correct answer: <b>' + esc(correctText) + '</b>') + '</div>' +
    '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="ptest-next">' +
    (btnLabel || 'CONTINUE') + '</button></div></div>';
}

/* ---- Part 1: vocabulary — photo + definition shown, pick the word ---- */
function ptestVocabQ() {
  var st = state.ptest, items = st.bundle.vocab.items, it = items[st.qIdx], n = items.length;
  var v = document.getElementById('view');
  var answered = st.answered;
  var opts = ptestOptsHTML(it.options, answered, st.picked, it.answer);
  var sheet = answered ? ptestSheetHTML(st.picked === it.answer, it.word,
    st.qIdx + 1 >= n ? 'FINISH PART' : 'CONTINUE') : '';
  v.innerHTML = '<div class="gt-wrap">' + ptestTopHTML(st.qIdx + (answered ? 1 : 0), n) +
    '<div class="ptest-vocab-photo"><img src="/' + esc(it.photo) + '" alt=""></div>' +
    '<div class="gt-q ptest-def">&ldquo;' + esc(it.meaning) + '&rdquo;</div>' +
    '<div class="gt-opts">' + opts + '</div>' + sheet + '</div>';
  ptestWireQuit();
  Array.prototype.forEach.call(v.querySelectorAll('[data-popt]'), function (btn) {
    btn.addEventListener('click', function () {
      if (st.answered) return;
      var pick = parseInt(btn.getAttribute('data-popt'), 10);
      st.answered = true; st.picked = pick;
      st.answers.push({ ok: pick === it.answer, word: it.word, level: it.level });
      ptestVocabQ();
    });
  });
  var nx = document.getElementById('ptest-next');
  if (nx) nx.addEventListener('click', function () {
    st.answered = false; st.picked = -1;
    if (st.qIdx + 1 >= n) ptestFinishSection('vocab');
    else { st.qIdx++; ptestVocabQ(); }
  });
  window.scrollTo(0, 0);
}

/* ---- Part 2: listening — podcast (5) + dialogues (5), flattened to 10 ---- */
function ptestListeningItems(bundle) {
  var out = [];
  var pc = bundle.listening.podcast;
  pc.questions.forEach(function (q) {
    out.push({ audio: pc.audio, title: pc.title, q: q.q, options: q.options, answer: q.answer, kind: 'podcast' });
  });
  bundle.listening.dialogues.forEach(function (d) {
    out.push({ audio: d.audio, title: d.title, q: d.question.q, options: d.question.options, answer: d.question.answer, kind: 'dialogue' });
  });
  return out;
}
function ptestListeningQ() {
  var st = state.ptest;
  if (!st.litems) st.litems = ptestListeningItems(st.bundle);
  var items = st.litems, cur = items[st.qIdx], n = items.length;
  var v = document.getElementById('view');
  /* Preserve audio playback position when re-rendering (same audio file) */
  var prevAudio = v.querySelector('audio.ptest-audio');
  var savedTime = 0, savedSrc = '';
  if (prevAudio && !prevAudio.paused) { prevAudio.pause(); }
  if (prevAudio) { savedTime = prevAudio.currentTime || 0; savedSrc = prevAudio.getAttribute('src') || ''; }
  var answered = st.answered;
  var opts = ptestOptsHTML(cur.options, answered, st.picked, cur.answer);
  var sheet = answered ? ptestSheetHTML(st.picked === cur.answer, cur.options[cur.answer],
    st.qIdx + 1 >= n ? 'FINISH PART' : 'CONTINUE') : '';
  v.innerHTML = '<div class="gt-wrap">' + ptestTopHTML(st.qIdx + (answered ? 1 : 0), n) +
    '<div class="ptest-audio-card"><div class="ptest-audio-title">🔊 ' + esc(cur.title) + '</div>' +
    '<audio controls preload="auto" src="/' + esc(cur.audio) + '" class="ptest-audio"></audio>' +
    '<div class="ptest-audio-hint">Listen carefully — you can replay it.</div></div>' +
    '<div class="gt-q">' + esc(cur.q) + '</div>' +
    '<div class="gt-opts">' + opts + '</div>' + sheet + '</div>';
  /* Restore playback position if same audio file */
  var newAudio = v.querySelector('audio.ptest-audio');
  if (newAudio && savedSrc && newAudio.getAttribute('src') === savedSrc && savedTime > 0) {
    newAudio.currentTime = savedTime;
  }
  ptestWireQuit();
  Array.prototype.forEach.call(v.querySelectorAll('[data-popt]'), function (btn) {
    btn.addEventListener('click', function () {
      if (st.answered) return;
      var pick = parseInt(btn.getAttribute('data-popt'), 10);
      st.answered = true; st.picked = pick;
      st.answers.push({ ok: pick === cur.answer, title: cur.title, kind: cur.kind });
      ptestListeningQ();
    });
  });
  var nx = document.getElementById('ptest-next');
  if (nx) nx.addEventListener('click', function () {
    st.answered = false; st.picked = -1;
    if (st.qIdx + 1 >= n) ptestFinishSection('listening');
    else { st.qIdx++; ptestListeningQ(); }
  });
  window.scrollTo(0, 0);
}

/* ---- Part 3: grammar — 20 questions from the vetted bank ---- */
function ptestGrammarQ() {
  var st = state.ptest, items = st.bundle.grammar.items, it = items[st.qIdx], n = items.length;
  var v = document.getElementById('view');
  var answered = st.answered;
  var opts = ptestOptsHTML(it.options, answered, st.picked, it.answer);
  var sheet = answered ? ptestSheetHTML(st.picked === it.answer, it.options[it.answer],
    st.qIdx + 1 >= n ? 'FINISH PART' : 'CONTINUE') : '';
  v.innerHTML = '<div class="gt-wrap">' + ptestTopHTML(st.qIdx + (answered ? 1 : 0), n) +
    '<div class="gt-q">' + esc(it.prompt).replace(/___/g, '…') + '</div>' +
    '<div class="gt-opts">' + opts + '</div>' + sheet + '</div>';
  ptestWireQuit();
  Array.prototype.forEach.call(v.querySelectorAll('[data-popt]'), function (btn) {
    btn.addEventListener('click', function () {
      if (st.answered) return;
      var pick = parseInt(btn.getAttribute('data-popt'), 10);
      st.answered = true; st.picked = pick;
      st.answers.push({ ok: pick === it.answer, topic: it.topic, h1: it.h1, level: it.level });
      ptestGrammarQ();
    });
  });
  var nx = document.getElementById('ptest-next');
  if (nx) nx.addEventListener('click', function () {
    st.answered = false; st.picked = -1;
    if (st.qIdx + 1 >= n) ptestFinishSection('grammar');
    else { st.qIdx++; ptestGrammarQ(); }
  });
  window.scrollTo(0, 0);
}

/* ---- Part 4: writing — describe the picture ---- */
function ptestWordCount(t) { return (String(t || '').trim().match(/\S+/g) || []).length; }
function ptestWriting() {
  var st = state.ptest, w = st.bundle.writing;
  var v = document.getElementById('view');
  var draft = '';
  try { draft = localStorage.getItem('ptest_draft_' + (state.user.id || 'anon')) || ''; } catch (e) {}
  v.innerHTML = '<div class="gt-wrap">' + ptestTopHTML(4, 5) +
    '<div class="ptest-vocab-photo"><img src="/' + esc(w.photo) + '" alt="Describe this picture"></div>' +
    '<div class="gt-q">' + esc(w.prompt) + '</div>' +
    (w.hint ? '<p class="ptest-hint">' + esc(w.hint) + '</p>' : '') +
    '<textarea id="ptest-writing" class="ptest-textarea" rows="8" placeholder="Write here…"></textarea>' +
    '<div class="ptest-wcount"><span id="ptest-wc">0</span> / ' + w.min_words + ' words minimum</div>' +
    '<button class="gt-btn gt-btn-green gt-btn-block" id="ptest-wsubmit" disabled>Submit writing</button>' +
    '</div>';
  ptestWireQuit();
  var ta = document.getElementById('ptest-writing');
  ta.value = draft;
  var upd = function () {
    var c = ptestWordCount(ta.value);
    document.getElementById('ptest-wc').textContent = c;
    document.getElementById('ptest-wsubmit').disabled = c < w.min_words;
    try { localStorage.setItem('ptest_draft_' + (state.user.id || 'anon'), ta.value); } catch (e) {}
  };
  ta.addEventListener('input', upd);
  upd();
  document.getElementById('ptest-wsubmit').addEventListener('click', function () {
    var text = ta.value.trim();
    var sentences = text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 0; }).length;
    var words = ptestWordCount(text);
    st.writingResult = {
      text: text,
      stats: {
        words: words, sentences: sentences,
        avg_len: sentences ? Math.round(words / sentences * 10) / 10 : 0,
        seconds: Math.round((Date.now() - st.t0) / 1000),
      },
    };
    try { localStorage.removeItem('ptest_draft_' + (state.user.id || 'anon')); } catch (e) {}
    ptestFinishSection('writing');
  });
  window.scrollTo(0, 0);
}

/* ---- Part 5: speaking — listen & repeat, scored via transcription ---- */
function ptestShadowing() {
  var st = state.ptest, items = st.bundle.shadowing.items, cur = items[st.qIdx], n = items.length;
  var v = document.getElementById('view');
  var phase = st.phase || 'listen'; // listen | recording | scoring | scored
  var html = '<div class="gt-wrap">' + ptestTopHTML(st.qIdx + (st.scored ? 1 : 0), n) +
    '<div class="ptest-audio-card"><div class="ptest-audio-title">🔊 Listen and repeat:</div>' +
    '<div class="ptest-sentence">“' + esc(cur.text) + '”</div>' +
    '<audio controls preload="auto" src="/' + esc(cur.audio) + '" class="ptest-audio"></audio></div>';
  if (phase === 'listen') {
    html += '<button class="gt-btn gt-btn-red gt-btn-block" id="ptest-rec">🎤 Repeat aloud</button>' +
      '<div class="ptest-audio-hint">Tap, say the sentence, then tap stop.</div>';
  } else if (phase === 'recording') {
    html += '<button class="gt-btn gt-btn-red gt-btn-block" id="ptest-stop">⏹ Stop recording</button>' +
      '<div class="ptest-rec-live"><span class="sp-pulse"></span> Recording…</div>';
  } else if (phase === 'scoring') {
    html += '<div class="ptest-rec-live"><span class="sp-pulse"></span> 🔍 Checking your pronunciation…</div>';
  } else if (phase === 'scored') {
    var r = st.lastResult;
    html += '<div class="ptest-score-chip ' + (r.accuracy >= 70 ? 'great' : r.accuracy >= 40 ? 'ok' : 'low') + '">' +
      r.accuracy + '% pronunciation match</div>' +
      '<button class="gt-btn gt-btn-green gt-btn-block" id="ptest-next">' +
      (st.qIdx + 1 >= n ? 'FINISH PART' : 'CONTINUE') + '</button>';
  }
  html += '</div>';
  v.innerHTML = html;
  ptestWireQuit();
  if (phase === 'listen') document.getElementById('ptest-rec').addEventListener('click', function () { ptestRecStart(); });
  if (phase === 'recording') document.getElementById('ptest-stop').addEventListener('click', function () { ptestRecStop(); });
  var nx = document.getElementById('ptest-next');
  if (nx) nx.addEventListener('click', function () {
    st.phase = 'listen'; st.scored = false;
    if (st.qIdx + 1 >= n) ptestFinishSection('shadowing');
    else { st.qIdx++; ptestShadowing(); }
  });
  window.scrollTo(0, 0);
}

function ptestRecStart() {
  var st = state.ptest;
  var md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { ptestRecSkip('no-mic'); return; }
  md.getUserMedia({ audio: true }).then(function (stream) {
    var rec;
    try { rec = new MediaRecorder(stream); } catch (e) { ptestRecSkip('no-mic'); return; }
    st.recStream = stream; st.recChunks = [];
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) st.recChunks.push(ev.data); };
    rec.onstop = function () { ptestRecTranscribe(); };
    st.rec = rec;
    try { rec.start(500); } catch (e) {}
    st.phase = 'recording';
    ptestShadowing();
  }).catch(function () { ptestRecSkip('blocked'); });
}
function ptestRecStop() {
  var st = state.ptest;
  try { if (st.rec && st.rec.state !== 'inactive') st.rec.stop(); } catch (e) { ptestRecSkip('error'); }
}
function ptestRecSkip(reason) {
  var st = state.ptest;
  try { if (st.recStream) st.recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  st.rec = null; st.recStream = null;
  st.answers.push({ accuracy: null, skipped: reason, text: st.bundle.shadowing.items[st.qIdx].text });
  st.phase = 'scored'; st.scored = true;
  st.lastResult = { accuracy: 0, skipped: true };
  ptestShadowing();
}
async function ptestRecTranscribe() {
  var st = state.ptest;
  try { if (st.recStream) st.recStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  var blob = new Blob(st.recChunks || [], { type: (st.rec && st.rec.mimeType) || 'audio/mp4' });
  st.rec = null; st.recStream = null; st.recChunks = [];
  st.phase = 'scoring';
  ptestShadowing();
  var target = st.bundle.shadowing.items[st.qIdx].text;
  var said = '', accuracy = 0;
  if (blob.size > 2000) {
    try {
      var fd = new FormData();
      fd.append('audio', blob, 'ptest.mp4');
      var r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      var j = null;
      try { j = await r.json(); } catch (e) {}
      if (r.ok && j && j.text) said = String(j.text).trim();
    } catch (e) {}
    if (said) {
      try { accuracy = analyzeSpeech(target, said, SHADOW_SCORING).accuracy || 0; } catch (e) {}
    }
  }
  if (!state.ptest || state.ptest !== st) return; // user left meanwhile
  st.answers.push({ accuracy: accuracy, transcript: said, text: target });
  st.phase = 'scored'; st.scored = true;
  st.lastResult = { accuracy: accuracy };
  ptestShadowing();
}

/* ---- section completion: saved immediately (resume-safe) ---- */
async function ptestFinishSection(id) {
  var st = state.ptest;
  ptestQuitSection();
  var v = document.getElementById('view');
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro"><div class="empty">Saving…</div></div></div>';
  var sections = Object.assign({}, (state.ptestRow && state.ptestRow.sections) || {});
  if (id === 'vocab') {
    sections.vocab = { score: st.answers.filter(function (a) { return a.ok; }).length, answers: st.answers };
  } else if (id === 'listening') {
    sections.listening = { score: st.answers.filter(function (a) { return a.ok; }).length, answers: st.answers };
  } else if (id === 'grammar') {
    sections.grammar = { score: st.answers.filter(function (a) { return a.ok; }).length, answers: st.answers };
  } else if (id === 'writing') {
    sections.writing = st.writingResult;
  } else if (id === 'shadowing') {
    sections.shadowing = {
      score: st.answers.filter(function (a) { return (a.accuracy || 0) >= 50; }).length,
      items: st.answers,
      avg_accuracy: st.answers.length ? Math.round(st.answers.reduce(function (s, a) { return s + (a.accuracy || 0); }, 0) / st.answers.length) : 0,
    };
  }
  await ptestSaveRow({ sections: sections });
  var nextIdx = st.secIdx + 1;
  if (nextIdx >= PTEST_SECTIONS.length) { ptestFinishAll(); return; }
  ptestSectionIntro(v, st.ref, st.bundle, nextIdx);
}

async function ptestFinishAll() {
  var row = state.ptestRow || {};
  var s = row.sections || {};
  var scores = {
    vocab: (s.vocab && s.vocab.score) || 0,
    listening: (s.listening && s.listening.score) || 0,
    grammar: (s.grammar && s.grammar.score) || 0,
    shadowing: (s.shadowing && s.shadowing.score) || 0,
  };
  scores.total = scores.vocab + scores.listening + scores.grammar + scores.shadowing;
  var level = ptestSuggestedLevel(scores.total);
  await ptestSaveRow({ status: 'completed', scores: scores, suggested_level: level, completed_at: new Date().toISOString() });
  /* resolve the teacher id for convenience (best effort) */
  try {
    if (sb && !ptestIsDemo() && row.teacher_ref) {
      var t = await sb.from('teachers').select('user_id').eq('ref_code', row.teacher_ref).maybeSingle();
      if (t.data && t.data.user_id) await ptestSaveRow({ teacher_id: t.data.user_id });
    }
  } catch (e) {}
  var v = document.getElementById('view');
  v.innerHTML = '<div class="gt-wrap"><div class="gt-intro"><div class="gt-mascot">🎉</div>' +
    '<h1>You did it!</h1>' +
    '<p>You finished all 5 parts of the placement test. Your teacher will review your results and be in touch.</p>' +
    '<a class="gt-btn gt-btn-green" href="#/home">Back to home</a></div></div>';
  window.scrollTo(0, 0);
}

/* ---- teacher side: placement link card + results ---- */
function copyPlacementLink() {
  var link = teacherPlacementLink(state.teacher.ref_code);
  function done(btn) { if (btn) { var o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(function () { btn.textContent = o; }, 1500); } }
  var btn = document.querySelector('[data-action="copy-ptest-link"]');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function () { done(btn); }, function () { fallback(); });
  } else fallback();
  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done(btn);
    } catch (e) {}
  }
}

function ptestScoreBadge(scores) {
  if (!scores) return '<span class="ptest-badge muted">in progress</span>';
  return '<span class="ptest-badge">✓ ' + scores.total + '/55</span>';
}

async function loadPlacementResults() {
  var host = document.getElementById('tch-ptest');
  if (!host || !state.teacher) return;
  var rows = [];
  try {
    var r = await sb.from('placement_results')
      .select('id,student_name,student_mobile,status,scores,suggested_level,sections,started_at,completed_at,updated_at')
      .eq('teacher_ref', state.teacher.ref_code)
      .order('updated_at', { ascending: false }).limit(100);
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    host.innerHTML = '<div class="empty">Placement results need the latest database update (placement_results table).</div>';
    return;
  }
  state.ptestRows = rows;
  if (!rows.length) {
    host.innerHTML = '<div class="empty">No placement tests yet — share your test link with a new student.</div>';
    return;
  }
  host.innerHTML = '<div class="ptest-rows">' + rows.map(function (w, i) {
    var sc = w.scores;
    var when = (w.completed_at || w.updated_at || '').slice(0, 10);
    return '<div class="ptest-row" data-action="ptest-detail" data-i="' + i + '" role="button" tabindex="0">' +
      '<span class="ptest-row-main"><b>' + esc(w.student_name || '—') + '</b>' +
      '<span class="muted">' + esc(w.student_mobile || '') + (when ? ' · ' + when : '') + '</span></span>' +
      (w.status === 'completed'
        ? '<span class="ptest-row-scores">V ' + sc.vocab + '/15 · L ' + sc.listening + '/10 · G ' + sc.grammar + '/20 · S ' + sc.shadowing + '/10</span>' +
          '<span class="ptest-lv">~' + esc(w.suggested_level || '') + '</span>'
        : '<span class="ptest-badge muted">in progress</span>') +
      '</div>';
  }).join('') + '</div><div id="tch-ptest-detail"></div>';
}

function openPlacementDetail(i) {
  var w = (state.ptestRows || [])[i];
  var host = document.getElementById('tch-ptest-detail');
  if (!w || !host) return;
  var s = w.sections || {};
  var parts = [];
  if (s.vocab) parts.push('<div class="ptest-dsec"><b>📚 Vocabulary: ' + s.vocab.score + '/15</b>' +
    '<div class="ptest-dlist">' + (s.vocab.answers || []).map(function (a) {
      return '<span class="ptest-chip ' + (a.ok ? 'ok' : 'no') + '">' + esc(a.word) + ' (' + (a.level || '').toUpperCase() + ')</span>';
    }).join('') + '</div></div>');
  if (s.listening) parts.push('<div class="ptest-dsec"><b>🎧 Listening: ' + s.listening.score + '/10</b>' +
    '<div class="ptest-dlist">' + (s.listening.answers || []).map(function (a) {
      return '<span class="ptest-chip ' + (a.ok ? 'ok' : 'no') + '">' + esc(a.title || a.kind || '') + '</span>';
    }).join('') + '</div></div>');
  if (s.grammar) {
    var weak = {};
    (s.grammar.answers || []).forEach(function (a) {
      if (!a.ok) weak[a.topic] = weak[a.topic] || { h1: a.h1, lv: a.level, n: 0 }, weak[a.topic].n++;
    });
    var weakList = Object.keys(weak).map(function (k) {
      return '<span class="ptest-chip no">' + esc(weak[k].h1) + ' ×' + weak[k].n + '</span>';
    }).join('') || '<span class="muted">no weak topics — all correct or unanswered</span>';
    parts.push('<div class="ptest-dsec"><b>📝 Grammar: ' + s.grammar.score + '/20</b>' +
      '<div class="muted" style="margin:.3rem 0">Weak topics:</div><div class="ptest-dlist">' + weakList + '</div></div>');
  }
  if (s.writing) parts.push('<div class="ptest-dsec"><b>✍️ Writing</b> <span class="muted">' +
    s.writing.stats.words + ' words · ' + s.writing.stats.sentences + ' sentences</span>' +
    '<div class="ptest-writing">' + esc(s.writing.text).replace(/\n/g, '<br>') + '</div></div>');
  if (s.shadowing) parts.push('<div class="ptest-dsec"><b>🎤 Speaking: ' + s.shadowing.score + '/10</b> <span class="muted">avg ' +
    (s.shadowing.avg_accuracy || 0) + '% match</span>' +
    '<div class="ptest-dlist">' + (s.shadowing.items || []).map(function (a) {
      var t = a.skipped ? 'skipped' : (a.accuracy || 0) + '%';
      return '<span class="ptest-chip ' + (a.skipped ? '' : (a.accuracy >= 70 ? 'ok' : a.accuracy >= 40 ? '' : 'no')) + '" title="' + esc(a.text || '') + '">' + t + '</span>';
    }).join('') + '</div></div>');
  host.innerHTML = '<div class="card ptest-detail"><div class="ptest-dhead"><div>' +
    '<b style="font-size:1.1rem">' + esc(w.student_name || '—') + '</b>' +
    '<div class="muted">' + esc(w.student_mobile || '') + '</div></div>' +
    (w.status === 'completed'
      ? '<div class="ptest-dtotal"><span class="ptest-badge big">✓ ' + w.scores.total + '/55</span>' +
        '<span class="ptest-lv big">suggested: ' + esc(w.suggested_level || '') + '</span></div>'
      : '<span class="ptest-badge muted">in progress</span>') +
    '<button class="btn btn-sm" data-action="ptest-detail-close">✕</button></div>' +
    parts.join('') + '</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* Paint instantly from local data, then refresh from cloud in the background.
   Awaiting Supabase before the first paint made tab switches feel sluggish. */
function renderHome(v) {
  paintHome(v, lsGet('mistakes'), lsGet('scores'));
  refreshHomeStreak();
  refreshHomeworkCard();
  refreshQuests();
  if (cloudReady()) {
    Promise.all([getMistakes(), getAttempts()]).then(function (res) {
      if (state.view === 'home' && !state.quiz) { paintHome(v, res[0], res[1]); refreshQuests(); }
    }).catch(function () { /* keep the local paint */ });
  }
}

/* ---------------- Mobile Home v2 (2026-10-19 redesign) ---------------- */
function paintHome(v, mistakes, attempts) {
  if (isDesktop()) { paintHomeDesktop(v, mistakes, attempts); return; }
  const lessons = state.lessons;
  const today = lessons[0] || null;

  let html = '';

  // 0b — Streak banner (mockup v5): mascot artwork bg, painted with local
  // data first, then refreshed with cloud state by refreshHomeStreak().
  html += '<div id="home-streak-wrap">' + streakBannerHTML(getStreakLocal()) + '</div>';

  // 0b2 — Grammar guides banner (smart: explore / continue / completed)
  html += '<div id="home-grammar-wrap"></div>';
  html += '<div id="home-vocab-wrap"></div>';
  html += '<div id="home-words-wrap"></div>';

  // 0c — Homework from teacher (filled async; empty when none pending)
  html += '<div id="home-hw-wrap"></div>';

  // 0d — Daily quests (painted with local progress)
  html += '<div id="home-quests-wrap"></div>';

  // 1 — Today's lesson (mockup v5 lesson card with illustrated hero)
  if (!today) {
    html += '<div class="empty">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += lessonBannerHTML(today);
  }

  // 1b — Previous lessons (days before today) → archive page
  html += prevLessonsHTML(lessons);

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

  v.innerHTML = html;
  paintGrammarBanner();
  paintVocabBanner();
  paintWordsBanner();
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
  return '<section class="dh-card dh-quests" dir="ltr" lang="en" aria-label="Daily quests">' +
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
  html += '<div id="home-grammar-wrap"></div>';
  html += '<div id="home-vocab-wrap"></div>';
  html += '<div id="home-words-wrap"></div>';
  html += '<div id="home-hw-wrap"></div>';
  html += '<div class="dh-grid">' + dhQuestsHTML() +
    '<div class="dh-col">' + dhLessonHTML(today) + dhMistakesHTML(mistakes) + '</div></div>';
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
  v.innerHTML = html;
  wireDhPlayer();
  refreshDhProgress();
  paintGrammarBanner();
  paintVocabBanner();
  paintWordsBanner();
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

  '<div class="section-title"><h2>Help</h2></div>' +
  '<div class="card plain"><button class="btn btn-ghost btn-block" data-action="tut-replay" style="margin-top:0">🎓 App tour — show me around</button></div>' +
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
    await sb.rpc('set_country', { code: code, name: name, source: 'manual' });
  } catch (e) { /* RPC missing or offline -> kept locally, retried later */ }
  renderProfile(document.getElementById('view'));
}

/* ---------------- lesson view ---------------- */
function lessonTabsHTML() {
  const tabs = [
    ['words', 'Words', ICO.book],
    ['quiz', 'Quiz', ICO.quiz],
    ['podcast', 'Podcast', ICO.headphones],
    ['shadowing', 'Shadowing', ICO.mic],
    ['grammar', 'Grammar', ICO.grid]
  ];
  return '<div class="lesson-tabs" role="tablist" aria-label="Lesson sections">' + tabs.map(function (t) {
    return '<button class="lesson-tab" role="tab" aria-selected="' + (state.lessonTab === t[0]) + '" data-action="lesson-tab" data-tab="' + t[0] + '"><span class="lt-ico">' + t[2] + '</span><span>' + t[1] + '</span></button>';
  }).join('') + '</div>';
}

function renderLesson(v, dateStr) {
  if (dateStr) {
    const found = state.lessons.find(function (m) { return m.date === dateStr; });
    if (found) state.lesson = found;
  }
  const m = state.lesson;
  if (!m) { v.innerHTML = '<div class="empty">No lesson available.</div>'; return; }
  if (m.date) awardPoints('lesson_open', 5, m.date, false, { theme: m.theme || '' });

  let html = '<div class="lesson-head"><div class="hero-date">' + esc(m.date) + (m.date === todayStr() ? ' · <b>Today</b>' : '') + '</div>' +
    '<h1 class="lesson-title">' + esc(m.theme || 'Daily lesson') + '</h1>' +
    '<p><span class="badge-level">' + esc(levelLabel(normalizeLevel(m.level))) + '</span></p></div>' +
    lessonTabsHTML() + '<div id="lesson-body"></div>';
  v.innerHTML = html;
  renderLessonTab($('#lesson-body'));
}

function renderLessonTab(body) {
  const m = state.lesson;
  const tab = state.lessonTab;
  /* Steps are marked only on genuine completion (2026-10-14 rule):
     words = scrolled to the last word (observeWordsEnd), quiz = finished,
     podcast = fully listened (checkTrackCompletion) or summary done,
     shadowing = all sentences practiced, grammar = grammar quiz finished.
     Opening a tab no longer marks anything. */
  if (tab === 'words') { body.innerHTML = wordsTabHTML(m); observeWordsEnd(body, m); refreshSavedWordButtons(body); }
  else if (tab === 'podcast') { body.innerHTML = podcastTabHTML(m); wireAudioCards(body); warmPodcast(m); wireSummaryChallenge(body, m); }
  else if (tab === 'shadowing') { body.innerHTML = shadowingTabHTML(m); wireAudioCards(body); wireShadowingPractice(body, m); }
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
  const cards = (m.words || []).map(function (w) {
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
        '<button class="save-word-btn" data-action="toggle-save-word" data-word="' + esc(w.word) + '" data-date="' + esc(m.date || '') + '" aria-label="Bookmark this word" title="Save for later practice"><img src="/icons/bookmark.png" alt=""></button>' +
      '</div>' +
      (w.pos ? '<div class="word-pos">' + esc(w.pos) + '</div>' : '') +
      (w.pronunciation ? '<div class="word-pron">/' + esc(w.pronunciation) + '/</div>' : '') +
      (w.meaning ? '<div class="word-meaning">' + esc(w.meaning) + '</div>' : '') +
      (w.example ? '<div class="word-example">"' + esc(w.example) + '"</div>' : '') +
      (w.persian ? '<div class="word-fa" dir="auto">' + esc(w.persian) + '</div>' : '') +
    '</div>';
  }).join('') || '<div class="empty">No words in this lesson.</div>';
  /* Enticing Start-Quiz CTA at the end of the words list (flame mascot button).
     Reuses the lesson-tab action so it behaves exactly like tapping the Quiz tab. */
  const cta = (m.words && m.words.length)
    ? '<button class="start-quiz-cta" data-action="lesson-tab" data-tab="quiz" aria-label="Start the word quiz">' +
      '<img src="/media/celebration/start-quiz.webp" alt="Start Quiz"></button>'
    : '';
  /* All-words pronunciation audio after the last word card (moved from podcast tab 2026-10-11). */
  const pronCard = m.pronunciation_audio
    ? audioCardHTML({
        id: 'card-pron', src: m.pronunciation_audio,
        title: 'Pronunciation — all words',
        sub: 'Listen to all ' + (m.words || []).length + ' words read aloud',
        speeds: false, download: true
      })
    : '';
  return cards + pronCard + cta;
}

/* Inner HTML of the designed "Start recording" button (Alireza's asset, 2026-10-15).
   Used for the initial render and every reset after recording/processing. */
var SUM_BTN_HTML = '<svg class="sum-btn-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg><span>Start recording</span><span class="sum-btn-chev">›</span>';

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
  if (!html) html = '<div class="empty">No audio in this lesson yet.</div>';
  /* Podcast summary challenge: record a spoken summary (up to 2 min), get AI transcription + grammar scoring. */
  /* Podcast summary challenge: designed card (Alireza's asset set, 2026-10-15). */
  html += '<div class="sum-card">' +
    '<div class="sum-photo"><img class="sum-wave" src="media/summary/sum-wave.png" alt=""></div>' +
    '<div class="sum-panel">' +
      '<div class="sum-head">' +
        '<img class="sum-mic" src="media/summary/sum-mic.png" alt="">' +
        '<h3 class="sum-title">Summarize<br><span>the podcast</span></h3>' +
        '<img class="sum-spark" src="media/summary/sum-spark.png" alt="">' +
      '</div>' +
      '<p>Listen to the episode, then record yourself summarizing it in English (up to 2 minutes).</p>' +
      '<p>Speak for at least 20 seconds — the longer you speak, the better your score analysis.</p>' +
      '<p>You\'ll get a transcript, grammar corrections and a score.</p>' +
      '<div class="sum-controls"><button class="sum-btn" id="sum-rec-btn" data-action="sum-record">' + SUM_BTN_HTML + '</button>' +
      '<span class="sum-timer hidden" id="sum-timer">2:00</span></div>' +
      '<div class="sum-live hidden" id="sum-live"><span class="sp-pulse"></span> <span id="sum-live-text">🎤 Recording… summarize the podcast!</span></div>' +
      '<div id="sum-result"></div>' +
    '</div></div>';
  return html;
}

/* Global English TTS for tap-to-hear (used by summary pronunciation section). */
function speakEnglish(w) {
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(w);
    u.lang = 'en-US';
    u.rate = 0.85;
    speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---- podcast summary challenge: 2-min recording -> Whisper -> AI grammar scoring ---- */
var sumState = { rec: null, stream: null, chunks: [], timerId: null, left: 120, recording: false, manifest: null };

function wireSummaryChallenge(body, m) {
  sumState.manifest = m || null;
  const btn = body.querySelector('#sum-rec-btn');
  if (btn) btn.disabled = false;
}

function sumFmt(s) {
  s = Math.max(0, s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function toggleSummaryRecording() {
  if (sumState.recording) { stopSummaryRecording(); return; }
  startSummaryRecording();
}

function startSummaryRecording() {
  const btn = document.getElementById('sum-rec-btn');
  const live = document.getElementById('sum-live');
  const timer = document.getElementById('sum-timer');
  const resBox = document.getElementById('sum-result');
  if (!btn) return;
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) {
    if (resBox) resBox.innerHTML = '<div class="empty">🎤 Microphone is not available on this device.</div>';
    return;
  }
  if (resBox) resBox.innerHTML = '';
  try { speechSynthesis.cancel(); } catch (e) {}
  document.querySelectorAll('audio').forEach(function (a) { try { a.pause(); } catch (e) {} });
  md.getUserMedia({ audio: true }).then(function (stream) {
    let rec;
    try { rec = new MediaRecorder(stream); }
    catch (e) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {}
      if (resBox) resBox.innerHTML = '<div class="empty">🎤 Could not start recording. Try again.</div>';
      return;
    }
    sumState.stream = stream;
    sumState.rec = rec;
    sumState.chunks = [];
    sumState.left = 120;
    sumState.recording = true;
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) sumState.chunks.push(ev.data); };
    rec.onstop = function () { finishSummaryRecording(); };
    try { rec.start(500); } catch (e) {}
    btn.innerHTML = '⏹ Stop recording';
    if (live) live.classList.remove('hidden');
    if (timer) { timer.classList.remove('hidden'); timer.textContent = sumFmt(120); }
    sumState.timerId = setInterval(function () {
      sumState.left--;
      if (timer) timer.textContent = sumFmt(sumState.left);
      if (sumState.left <= 0) stopSummaryRecording();
    }, 1000);
  }).catch(function () {
    if (resBox) resBox.innerHTML = '<div class="empty">🎤 Microphone blocked — allow microphone access and try again.</div>';
  });
}

function stopSummaryRecording() {
  if (!sumState.recording) return;
  sumState.recording = false;
  if (sumState.timerId) { clearInterval(sumState.timerId); sumState.timerId = null; }
  try { if (sumState.rec && sumState.rec.state !== 'inactive') sumState.rec.stop(); }
  catch (e) { finishSummaryRecording(); }
  const btn = document.getElementById('sum-rec-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Processing…'; }
}

async function finishSummaryRecording() {
  const btn = document.getElementById('sum-rec-btn');
  const live = document.getElementById('sum-live');
  const timer = document.getElementById('sum-timer');
  const resBox = document.getElementById('sum-result');
  /* How long they actually spoke (timer counts down from 120). */
  const durSec = Math.max(0, 120 - (sumState.left || 0));
  try { if (sumState.stream) sumState.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  if (live) live.classList.add('hidden');
  if (timer) timer.classList.add('hidden');
  const blob = new Blob(sumState.chunks, { type: (sumState.rec && sumState.rec.mimeType) || 'audio/mp4' });
  sumState.rec = null; sumState.stream = null; sumState.chunks = [];
  let audioUrl = '';
  try { audioUrl = URL.createObjectURL(blob); } catch (e) {}
  if (!resBox) return;
  if (!blob.size || blob.size < 2000) {
    resBox.innerHTML = '<div class="empty">🎤 No audio captured. Try again.</div>';
    if (btn) { btn.disabled = false; btn.innerHTML = SUM_BTN_HTML; }
    return;
  }
  resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Transcribing your summary…</div>';
  let text = '', err = '';
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'summary.mp4');
    const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (r.ok && j && j.text) text = String(j.text).trim();
    else err = (j && j.error) || ('http ' + r.status);
  } catch (e) { err = 'network'; }
  if (!text) {
    resBox.innerHTML = '<div class="empty">🎤 ' +
      (err === 'No speech detected.' ? 'We didn\'t catch any words. Try again.'
        : 'Transcription failed' + (err ? ' (' + esc(err) + ')' : '') + '. Try again.') + '</div>';
    if (btn) { btn.disabled = false; btn.innerHTML = SUM_BTN_HTML; }
    return;
  }
  resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 📝 Analyzing grammar & scoring…</div>';
  const m = sumState.manifest || {};
  let score = null;
  try {
    const r2 = await fetch('/api/summary-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: text,
        podcastTitle: (m.podcast && m.podcast.title) || '',
        podcastTranscript: (m.podcast && m.podcast.transcript) || '',
        level: m.level || ''
      })
    });
    let j2 = null;
    try { j2 = await r2.json(); } catch (e) {}
    if (r2.ok && j2 && typeof j2.score === 'number') score = j2;
    else err = (j2 && j2.error) || ('http ' + r2.status);
  } catch (e) { err = 'network'; }
  if (btn) { btn.disabled = false; btn.innerHTML = '🎤 Record again'; }
  if (!score) {
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const shortMsg = err === 'Transcript too short.'
      ? 'We only heard ' + wordCount + ' word' + (wordCount === 1 ? '' : 's') + ' (' + esc(text) + '). ' +
        'Please speak longer (at least 20 seconds), louder and closer to the microphone, then try again.'
      : 'Scoring failed' + (err ? ' (' + esc(err) + ')' : '') + '. Your transcript:<br><br><i>' + esc(text) + '</i>';
    resBox.innerHTML = '<div class="empty">📝 ' + shortMsg + '</div>';
    return;
  }
  /* never show (or store) raw model JSON/fences — server fallback safety net */
  let summaryText = String(score.summary || '');
  if (/^\s*```/.test(summaryText) || /^\s*\{/.test(summaryText)) {
    summaryText = 'Your summary was scored ' + score.score + ' out of 100. Detailed feedback didn\'t come through — try recording again.';
  }
  const corr = (score.corrections || []).map(function (c) {
    return '<div class="sum-corr"><div class="sum-wrong">❌ ' + esc(c.wrong || '') + '</div>' +
      '<div class="sum-right">✅ ' + esc(c.right || '') + '</div>' +
      (c.why ? '<div class="muted sum-why">' + esc(c.why) + '</div>' : '') + '</div>';
  }).join('');
  const strengths = (score.strengths || []).map(function (s) {
    return '<li>💪 ' + esc(s) + '</li>';
  }).join('');
  const pron = (score.pronunciation || []).map(function (x) {
    return '<div class="sum-corr"><div class="sum-wrong">🗣️ Heard: "' + esc(x.heard || '') +
      '" → likely you meant: <b>' + esc(x.likely || '') + '</b> ' +
      '<button class="sp-hear" data-action="sum-hear" data-w="' + esc(x.likely || '') + '" aria-label="Hear correct pronunciation">🔊</button></div>' +
      (x.why ? '<div class="muted sum-why">' + esc(x.why) + '</div>' : '') + '</div>';
  }).join('');
  const ring = score.score >= 80 ? '#4caf50' : (score.score >= 60 ? '#ff9800' : '#f44336');
  /* inline highlight: wrap mispronounced words in the transcript like shadowing does */
  let hiText = esc(text);
  (score.pronunciation || []).forEach(function (x) {
    const heard = esc(x.heard || '');
    if (!heard || heard.length < 2) return;
    const idx = hiText.toLowerCase().indexOf(heard.toLowerCase());
    if (idx !== -1) {
      hiText = hiText.slice(0, idx) +
        '<span class="sum-mispron">' + hiText.slice(idx, idx + heard.length) +
        ' <button class="sp-hear" data-w="' + esc(x.likely || '') + '" aria-label="Hear: ' + esc(x.likely || '') + '">🔊</button></span>' +
        hiText.slice(idx + heard.length);
    }
  });
  resBox.innerHTML =
    '<div class="sum-score-card"><div class="sum-ring" style="--p:' + score.score + ';--c:' + ring + '">' +
    '<span>' + score.score + '</span></div>' +
    '<div class="sum-score-info"><h4>Your summary score</h4><p>' + esc(summaryText) + '</p></div></div>' +
    (audioUrl ? '<div class="sum-audio"><span class="muted">🎧 Your recording:</span><audio controls src="' + audioUrl + '" style="width:100%;margin-top:.3rem"></audio></div>' : '') +
    '<details class="sum-details" open><summary>📝 Your transcript</summary><p><i>' + hiText + '</i></p>' +
    '<p class="muted sum-legend"><span class="sum-mispron">red</span> = mispronounced — tap 🔊 to hear the correct word</p></details>' +
    (pron ? '<h4 class="sum-h">🗣️ Pronunciation — tap 🔊 to hear</h4>' + pron : '') +
    (corr ? '<h4 class="sum-h">🔧 Grammar corrections</h4>' + corr : '') +
    (strengths ? '<h4 class="sum-h">✨ Strengths</h4><ul class="sum-strengths">' + strengths + '</ul>' : '');
  resBox.querySelectorAll('.sp-hear').forEach(function (b) {
    b.addEventListener('click', function (ev) { ev.stopPropagation(); speakEnglish(b.getAttribute('data-w')); });
  });
  try { markStep((sumState.manifest || {}).date, 'podcast'); } catch (e) {}
  /* Persist the attempt for Progress + teacher review (Alireza, 2026-10-15).
     The table is optional until the migration is run — failures are silent. */
  if (state.user && state.user.id && sb) {
    try {
      await sb.from('summary_attempts').insert({
        user_id: state.user.id,
        lesson_date: (sumState.manifest || {}).date || null,
        transcript: text.slice(0, 2000),
        score: score.score,
        summary: summaryText.slice(0, 2000),
        corrections: score.corrections || [],
        pronunciation: score.pronunciation || [],
        strengths: score.strengths || [],
        duration_sec: durSec
      });
    } catch (e) {}
  }
  /* XP scales with quality: score/10, once per lesson per day (first summary
     of the day counts — retries improve the record, not the XP). */
  try {
    const sxp = Math.round(score.score / 10);
    if (sxp > 0) awardPoints('summary_complete', sxp, ((sumState.manifest || {}).date || 'lesson') + '#summary');
  } catch (e) {}
}

function shadowingTabHTML(m) {
  if (!m.shadowing || !m.shadowing.audio) return '<div class="empty">No shadowing story for this lesson.</div>';
  /* The old full-story audio player was removed: each sentence now has its own
     play + record buttons below, which is the whole shadowing flow.
     Speaking practice: per-sentence recorder + transcription + analysis. */
  return '<div class="card plain sp-card"><h3 class="serif">🎤 Speaking practice</h3>' +
    '<p class="muted">Tap the play button to hear a sentence, then the mic button ' +
    'to record yourself reading it aloud (up to 15 seconds). ' +
    'You get a score for each sentence — tap 🔊 on a red word to hear it.</p>' +
    '<div id="sp-sentences"></div></div>';
}

/* Speech-loop guard: on Android Chrome the Web Speech service sometimes
   re-emits growing repeats of what it already sent ("when", "when Sarah",
   "when Sarah became", …). Append a new final chunk, but when it is just a
   re-emission of the accumulated transcript, keep the longer one instead of
   concatenating (word-boundary aware, so a lone "a" is not swallowed by
   "became"). */
function spNormWords(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function spContainsWords(hay, needle) {
  if (!needle) return false;
  return (' ' + hay + ' ').indexOf(' ' + needle + ' ') >= 0;
}
function spAppendFinal(prev, chunk) {
  const c = String(chunk || '').trim();
  if (!c) return prev || '';
  const nPrev = spNormWords(prev), nChunk = spNormWords(c);
  if (!nPrev) return c;
  if (spContainsWords(nChunk, nPrev)) return c;        /* growing re-emission: keep the fuller one */
  if (spContainsWords(nPrev, nChunk)) return prev || ''; /* re-sent tail: drop the repeat */
  return ((prev || '') + ' ' + c).trim();
}

/* Collapse consecutive repeated word-runs ("no no" -> "no", "a b a b" -> "a b").
   Safety net for staircase transcripts the append guard couldn't merge. */
function spCollapseRepeats(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const low = words.map(function (w) { return w.toLowerCase(); });
  if (words.length < 2) return words.join(' ');
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < words.length) {
      const maxN = Math.floor((words.length - i) / 2);
      let n = maxN, hit = 0;
      while (n >= 1 && !hit) {
        let same = true;
        for (let j = 0; j < n; j++) {
          if (low[i + j] !== low[i + n + j]) { same = false; break; }
        }
        if (same) hit = n; else n--;
      }
      if (hit) {
        words.splice(i, hit);
        low.splice(i, hit);
        changed = true; /* stay at i: a new repeat may now be adjacent */
      } else i++;
    }
  }
  return words.join(' ');
}

/* Shadowing scoring strictness — tune these to make grading harsher/softer.
   fuzzy: match plurals/conjugations ("cats"~"cat", "running"~"run") and
          contractions ("dont"~"don't") so speech-recognition wobbles don't
          tank the score.
   minRun: words only count when part of a run of N+ consecutive story words.
           1 = every matched word counts (lenient), 2 = strict (old behavior).
   greatAt/okAt: score thresholds for the "great"/"ok" bands and XP. */
const SHADOW_SCORING = { fuzzy: true, minRun: 1, greatAt: 70, okAt: 40 };
/* First attempt of a sentence is graded strictly; retries are lenient. */
const SHADOW_SCORING_FIRST = { fuzzy: true, minRun: 2, greatAt: 80, okAt: 50 };

/* Word-level analysis: LCS between the story transcript and what the user
   said. Returns accuracy (of the words you said, how many matched the story
   in order), coverage (how much of the story you covered) and the set of
   matched target-word indexes for highlighting. */
function shadowWordMatch(a, b, scoring) {
  if (a === b) return true;
  if (!(scoring || SHADOW_SCORING).fuzzy) return false;
  /* Contractions: speech recognition often drops the apostrophe. */
  const c = function (w) { return w.replace(/'/g, ''); };
  if (c(a) === c(b)) return true;
  /* Light stemming: plurals and common conjugations. Conservative on short
     words to avoid false friends ("is"~"i", "as"~"a"). */
  const stem = function (w) {
    if (w.length <= 3) return w;
    if (w.length > 4 && w.slice(-3) === 'ing') return w.slice(0, -3);
    if (w.length > 3 && w.slice(-2) === 'ed') return w.slice(0, -2);
    if (w.length > 3 && w.slice(-2) === 'es') return w.slice(0, -2);
    if (w.length > 3 && w.slice(-1) === 's') return w.slice(0, -1);
    return w;
  };
  return stem(c(a)) === stem(c(b));
}
function analyzeSpeech(target, said, scoring) {
  scoring = scoring || SHADOW_SCORING;
  const norm = function (s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
  };
  const T = norm(target), H = norm(said);
  const n = T.length, m = H.length;
  const out = { accuracy: 0, coverage: 0, matched: new Set(), targetWords: T, saidWords: H, scoring: scoring };
  if (!n || !m) return out;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = shadowWordMatch(T[i], H[j], scoring) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (shadowWordMatch(T[i], H[j], scoring)) { matched.add(i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  /* A word counts when it is part of a run of minRun+ consecutive story
     words. minRun 2+ discards scattered single-word hits (usually coincidental
     common words from a noisy transcript); minRun 1 counts every match. */
  const green = new Set();
  let run = [];
  const flushRun = function () {
    if (run.length >= scoring.minRun) run.forEach(function (k) { green.add(k); });
    run = [];
  };
  for (let k = 0; k < n; k++) {
    if (matched.has(k)) {
      if (run.length && k !== run[run.length - 1] + 1) flushRun();
      run.push(k);
    } else flushRun();
  }
  flushRun();
  out.matched = green;
  out.accuracy = Math.round(100 * green.size / n);
  out.coverage = Math.round(100 * matched.size / n);
  return out;
}

/* Word-by-word attempt result (shared by live results and restored history). */
function spSentResultHTML(a, said, pts, slim) {
  const sc = a.scoring || SHADOW_SCORING;
  const cls = a.accuracy >= sc.greatAt ? 'great' : (a.accuracy >= sc.okAt ? 'ok' : 'low');
  let head = '';
  if (!slim) {
    if (!a.saidWords.length) {
      head = '<div class="sp-score ' + cls + '"><div class="sp-score-num">—</div>' +
        '<div class="sp-score-label">We couldn\'t catch any words. Try again.</div></div>';
    } else {
      head = '<div class="sp-score ' + cls + '"><div class="sp-score-num">' + a.accuracy + '%</div>' +
        '<div class="sp-score-label">of this sentence' + (pts ? ' · +' + pts + ' pts' : '') + '</div>' +
        (sc === SHADOW_SCORING_FIRST
          ? '<div class="sp-score-mode">🎯 First try — strict grading. Try again for lenient scoring.</div>'
          : '<div class="sp-score-mode">🌱 Practice round — lenient scoring.</div>') + '</div>';
    }
  }
  const words = a.targetWords.map(function (w, idx) {
    if (a.matched.has(idx)) return '<span class="sp-w ok">' + esc(w) + '</span>';
    return '<button class="sp-hear" data-w="' + esc(w) + '" title="Hear this word">' + esc(w) + ' 🔊</button>';
  }).join(' ');
  return head +
    (said ? '<div class="sp-said"><b>You said:</b> <span dir="auto">' + esc(said) + '</span></div>' : '') +
    (a.targetWords.length ? '<p class="sp-target" dir="auto">' + words + '</p>' : '');
}

/* Split a story transcript into sentences. Handles numbered lines
   ("1. Hello.") and plain lines; drops a leading title line. */
function splitSentences(text) {
  const lines = String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  const out = [];
  lines.forEach(function (ln, idx) {
    const numbered = ln.match(/^\d+\.\s*(.+)$/);
    const s = (numbered ? numbered[1] : ln).trim();
    if (idx === 0 && !numbered && !/[.!?…]$/.test(s)) return; /* title line */
    const parts = s.match(/[^.!?]+[.!?]+["'”’]?/g) || [s];
    parts.forEach(function (p) {
      p = p.trim();
      if (p.length > 1) out.push(p);
    });
  });
  return out;
}

/* Per-sentence speaking practice: live transcription (Web Speech API) +
   word-level analysis vs that sentence.
   NOTE: transcription runs ALONE on the mic — no simultaneous MediaRecorder.
   On Android Chrome, two concurrent mic consumers fight and the recognizer
   gets silence (observed: zero words transcribed). */
async function wireShadowingPractice(body, m) {
  const list = body.querySelector('#sp-sentences');
  if (!list) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  /* iOS routing: on iPhone/iPad every browser is WebKit, and its speech
     recognizer is a dead stub (exists but never returns words). iOS goes the
     record-and-transcribe route (MediaRecorder -> /api/transcribe -> Whisper);
     Android/desktop keep the instant live-recognition path. */
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1); /* iPadOS desktop mode */
  const useServerSTT = isIOS && typeof window.MediaRecorder !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  let targetText = '';
  if (m.shadowing && m.shadowing.transcript) {
    try { targetText = await (await fetch(m.shadowing.transcript)).text(); }
    catch (e) { /* sentences fall back to empty */ }
  }
  const sentences = splitSentences(targetText);

  if (!SR && !useServerSTT) {
    list.innerHTML = '<div class="empty">🎤 Voice practice needs Chrome or Edge (Android or desktop).</div>';
    return;
  }
  if (!sentences.length) {
    list.innerHTML = '<div class="empty">No transcript for this story yet.</div>';
    return;
  }

  const MAXS = 15; /* seconds per sentence */
  list.innerHTML = sentences.map(function (s, i) {
    return '<div class="sp-sent" data-i="' + i + '">' +
      '<div class="sp-sent-top"><p class="sp-sent-text" dir="auto"><span class="sp-sent-num">' + (i + 1) + '</span>' + esc(s) + '</p>' +
      '<div class="sp-btns">' +
      '<button class="sp-play" data-i="' + i + '" aria-label="Play sentence ' + (i + 1) + '"><img src="/icons/sp-play.png" alt=""></button>' +
      '<button class="sp-mic" data-i="' + i + '" aria-label="Record sentence ' + (i + 1) + '"><img src="/icons/sp-rec.png" alt=""></button>' +
      '<button class="save-word-btn sp-save" data-i="' + i + '" aria-label="Save sentence ' + (i + 1) + ' for review" title="Save for later practice"><img src="/icons/bookmark.png" alt=""></button>' +
      '</div></div>' +
      '<div class="sp-sent-live hidden"><span class="sp-pulse"></span>' +
      '<span class="sp-sent-live-text" dir="auto"></span><span class="sp-sent-count"></span></div>' +
      '<div class="sp-sent-result"></div></div>';
  }).join('');
  refreshSpSaveButtons(m.date);

  let active = null; /* one recording at a time */

  function setMicUI() {
    list.querySelectorAll('.sp-mic').forEach(function (b) {
      const isActive = active && +b.getAttribute('data-i') === active.i;
      b.classList.toggle('recording', !!isActive);
      b.disabled = !!active && !isActive;
      b.setAttribute('aria-label', isActive ? 'Stop recording' : ('Record sentence ' + (+b.getAttribute('data-i') + 1)));
    });
    /* No sentence playback while recording — the speaker would bleed into the mic. */
    list.querySelectorAll('.sp-play').forEach(function (b) {
      b.disabled = !!active;
      if (active) b.classList.remove('speaking');
    });
  }

  let speakingI = -1;
  let sentAudioEl = null;
  function stopSpeaking() {
    try { speechSynthesis.cancel(); } catch (e) {}
    try { if (sentAudioEl) { sentAudioEl.pause(); sentAudioEl.src = ''; sentAudioEl = null; } } catch (e) {}
    speakingI = -1;
    list.querySelectorAll('.sp-play.speaking').forEach(function (b) { b.classList.remove('speaking'); });
  }
  function playSentenceAudio(i, url) {
    stopSpeaking();
    trackEvent('shadowing_listen', { sentence: i + 1, date: m.date || null });
    speakingI = i;
    const btn = list.querySelector('.sp-play[data-i="' + i + '"]');
    if (btn) btn.classList.add('speaking');
    try {
      sentAudioEl = new Audio(url);
      sentAudioEl.onended = sentAudioEl.onerror = function () { if (speakingI === i) stopSpeaking(); };
      const p = sentAudioEl.play();
      if (p && p.catch) p.catch(function () { stopSpeaking(); });
    } catch (e) { stopSpeaking(); }
  }
  function playSentence(i) {
    if (active) return;
    if (speakingI === i) { stopSpeaking(); return; } /* toggle */
    /* Prefer the pre-generated studio audio; fall back to phone TTS for
       lessons built before per-sentence audio existed (2026-10-10). */
    const sentAudio = m.shadowing && m.shadowing.sentence_audio && m.shadowing.sentence_audio[i];
    if (sentAudio) { playSentenceAudio(i, sentAudio); return; }
    if (!('speechSynthesis' in window)) return;
    stopSpeaking();
    trackEvent('shadowing_listen', { sentence: i + 1, date: m.date || null });
    const u = new SpeechSynthesisUtterance(sentences[i]);
    u.lang = 'en-US';
    u.rate = 0.9;
    speakingI = i;
    const btn = list.querySelector('.sp-play[data-i="' + i + '"]');
    if (btn) btn.classList.add('speaking');
    u.onend = u.onerror = function () { if (speakingI === i) stopSpeaking(); };
    try { speechSynthesis.speak(u); }
    catch (e) { stopSpeaking(); }
  }

  function speakWord(w) {
    try {
      if (!('speechSynthesis' in window)) return;
      stopSpeaking();
      const u = new SpeechSynthesisUtterance(w);
      u.lang = 'en-US';
      u.rate = 0.85;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  function startRecording(i) {
    if (useServerSTT) { startRecordingServer(i); return; }
    stopSpeaking(); /* never play into the mic */
    const row = list.querySelector('.sp-sent[data-i="' + i + '"]');
    const resBox = row.querySelector('.sp-sent-result');
    const live = row.querySelector('.sp-sent-live');
    const liveText = row.querySelector('.sp-sent-live-text');
    const count = row.querySelector('.sp-sent-count');
    resBox.innerHTML = '';
    const a = { i: i, row: row, resBox: resBox, live: live, saidFinal: '', lastInterim: '', waitEnd: null, restarts: 0, lastError: '', left: MAXS, timerId: null, recog: null };
    active = a;
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = true;
    r.onresult = function (ev) {
      if (!active || active.i !== i) return;
      let interim = '';
      for (let k = ev.resultIndex; k < ev.results.length; k++) {
        const tr = ev.results[k][0].transcript;
        if (ev.results[k].isFinal) a.saidFinal = spAppendFinal(a.saidFinal, tr);
        else interim += tr;
      }
      const t = (a.saidFinal + ' ' + interim).trim();
      a.lastInterim = interim; /* keep the latest hypotheses: on early stop they may never finalize */
      liveText.textContent = t || 'Listening…';
    };
    r.onerror = function (ev) {
      if (!active || active.i !== i) return;
      a.lastError = (ev && ev.error) || 'unknown';
      if (a.lastError === 'not-allowed' || a.lastError === 'service-not-allowed') {
        const msg = a.lastError;
        stopActive(true);
        resBox.innerHTML = '<div class="empty">🎤 Microphone blocked (' + esc(msg) +
          ') — allow microphone access and try again.</div>';
      }
    };
    r.onend = function () {
      /* Chrome may end recognition on a long pause — resume while recording,
         with a cap so a hard failure can't loop forever. */
      if (active && active.i === i && a.restarts < 3 &&
          a.lastError !== 'not-allowed' && a.lastError !== 'service-not-allowed') {
        a.restarts++;
        try { r.start(); } catch (e) {}
        return;
      }
      /* Stopped (manually or by timer): let stopActive's waiter proceed. */
      if (a.waitEnd) { const w = a.waitEnd; a.waitEnd = null; try { w(); } catch (e) {} }
    };
    a.recog = r;
    try { r.start(); }
    catch (e) {
      active = null;
      setMicUI();
      resBox.innerHTML = '<div class="empty">🎤 Could not start listening. Try again.</div>';
      return;
    }
    live.classList.remove('hidden');
    liveText.textContent = 'Listening… speak now!';
    count.textContent = '0:' + String(MAXS).padStart(2, '0');
    setMicUI();
    a.timerId = setInterval(function () {
      if (!active || active.i !== i) return;
      a.left--;
      count.textContent = '0:' + String(Math.max(a.left, 0)).padStart(2, '0');
      if (a.left <= 0) stopActive(false);
    }, 1000);
  }

  /* iOS path: record with MediaRecorder (Web Speech is a dead stub on iOS),
     upload the clip to /api/transcribe (Whisper), then run the same analysis,
     scoring and persistence as the live path. */
  function startRecordingServer(i) {
    stopSpeaking(); /* never play into the mic */
    const row = list.querySelector('.sp-sent[data-i="' + i + '"]');
    const resBox = row.querySelector('.sp-sent-result');
    const live = row.querySelector('.sp-sent-live');
    const liveText = row.querySelector('.sp-sent-live-text');
    const count = row.querySelector('.sp-sent-count');
    resBox.innerHTML = '';
    const a = { i: i, row: row, resBox: resBox, live: live, left: MAXS, timerId: null,
                stream: null, rec: null, chunks: [], uploaded: false };
    active = a;
    setMicUI();
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      active = null; setMicUI();
      resBox.innerHTML = '<div class="empty">🎤 Microphone is not available on this device.</div>';
      return;
    }
    md.getUserMedia({ audio: true }).then(function (stream) {
      if (!active || active.i !== i) {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        return;
      }
      a.stream = stream;
      let rec;
      try { rec = new MediaRecorder(stream); }
      catch (e) {
        active = null; setMicUI();
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) {}
        resBox.innerHTML = '<div class="empty">🎤 Could not start recording. Try again.</div>';
        return;
      }
      a.rec = rec;
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) a.chunks.push(ev.data); };
      rec.onstop = function () { uploadAndFinish(a); };
      try { rec.start(250); } catch (e) { /* onstop may not fire; stopActive covers it */ }
      live.classList.remove('hidden');
      liveText.textContent = '🎤 Recording… speak now!';
      count.textContent = '0:' + String(MAXS).padStart(2, '0');
      setMicUI();
      a.timerId = setInterval(function () {
        if (!active || active.i !== i) return;
        a.left--;
        count.textContent = '0:' + String(Math.max(a.left, 0)).padStart(2, '0');
        if (a.left <= 0) stopActive(false);
      }, 1000);
    }).catch(function () {
      if (active && active.i === i) {
        active = null; setMicUI();
        resBox.innerHTML = '<div class="empty">🎤 Microphone blocked — allow microphone access and try again.</div>';
      }
    });
  }

  async function uploadAndFinish(a) {
    if (a.uploaded) return;
    a.uploaded = true;
    if (a.timerId) clearInterval(a.timerId);
    try { if (a.stream) a.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    const blob = new Blob(a.chunks, { type: (a.rec && a.rec.mimeType) || 'audio/mp4' });
    a.resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Transcribing…</div>';
    let text = '', err = '';
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'speech.mp4');
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      let j = null;
      try { j = await r.json(); } catch (e) {}
      if (r.ok && j && j.text) text = String(j.text);
      else err = (j && j.error) || ('http ' + r.status);
    } catch (e) { err = 'network'; }
    if (!text.trim()) {
      a.resBox.innerHTML = '<div class="empty">🎤 ' +
        (err === 'No speech detected.' || err === 'No usable audio received.'
          ? 'We didn\'t catch any words. Try again.'
          : 'Transcription failed' + (err ? ' (' + esc(err) + ')' : '') + '. Try again.') + '</div>';
      return;
    }
    /* Same pipeline as the live path: collapse repeats, analyze, score, persist. */
    await finishAttempt(a.i, spCollapseRepeats(text.trim()), a.resBox, '');
  }

  async function stopActive(silent) {
    const a = active;
    active = null;
    if (!a) return;
    if (a.timerId) clearInterval(a.timerId);
    try { if (a.recog) a.recog.stop(); } catch (e) {}
    setMicUI();
    a.live.classList.add('hidden');
    if (silent) return;
    /* iOS server path: stopping the recorder fires onstop -> uploadAndFinish. */
    if (a.rec) {
      let direct = false;
      try {
        if (a.rec.state === 'inactive') direct = true;
        else a.rec.stop();
      } catch (e) { direct = true; }
      if (direct) uploadAndFinish(a);
      return;
    }
    /* Wait for the recognizer to flush its final results (onend), with a cap.
       Stopping early often leaves the last words as interim-only hypotheses —
       harvest them too so nothing the user said gets wiped. */
    await new Promise(function (resolve) {
      let done = false;
      const to = setTimeout(function () { if (!done) { done = true; resolve(); } }, 2500);
      a.waitEnd = function () { if (!done) { done = true; clearTimeout(to); resolve(); } };
    });
    a.waitEnd = null;
    let said = a.saidFinal.trim();
    const li = (a.lastInterim || '').trim();
    if (li && !spContainsWords(spNormWords(said), spNormWords(li))) {
      said = (said + ' ' + li).trim();
    }
    /* Collapse any staircase repeats the loop guard couldn't merge. */
    await finishAttempt(a.i, spCollapseRepeats(said), a.resBox, a.lastError);
  }

  async function finishAttempt(i, said, resBox, lastError) {
    try {
      if (!said) {
        resBox.innerHTML = '<div class="empty">🎤 We didn\'t catch any words' +
          (lastError ? ' (mic note: ' + esc(lastError) + ')' : '') + '. Try again.</div>';
        return;
      }
      resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Analyzing…</div>';
      /* Let the status paint before the analysis. */
      await new Promise(function (resolve) { setTimeout(resolve, 60); });
      /* First attempt of a sentence is graded strictly; retries are lenient. */
      const sentN = i + 1;
      let prior = 0;
      try {
        (list._spRows || []).forEach(function (r) {
          const mm = String(r.transcript || '').match(/^\[s(\d+)\]/);
          if (mm && parseInt(mm[1], 10) === sentN) prior++;
        });
      } catch (e) {}
      const scoring = prior === 0 ? SHADOW_SCORING_FIRST : SHADOW_SCORING;
      const a = analyzeSpeech(sentences[i], said, scoring);
      trackEvent('shadowing_attempt', { sentence: sentN, score: a.accuracy, date: m.date || null, attempt: prior + 1 });
      let pts = 0, awarded = false;
      if (a.accuracy >= scoring.greatAt) pts = 5;
      else if (a.accuracy >= scoring.okAt) pts = 3;
      else if (a.accuracy > 0) pts = 1;
      if (state.user && state.user.id && pts > 0) {
        /* Alireza, 2026-10-15: only the FIRST scoring attempt of each sentence
           earns points — retries still show the score but award nothing. */
        const pKey = 'sp_p_' + (m.date || 'lesson');
        let scored = [];
        try { scored = JSON.parse(localStorage.getItem(pKey) || '[]'); } catch (e) { scored = []; }
        if (scored.indexOf(i) === -1) {
          scored.push(i);
          try { localStorage.setItem(pKey, JSON.stringify(scored)); } catch (e) {}
          awardPoints('shadowing_speaking', pts, (m.date || 'lesson') + '#s' + i);
          awarded = true;
        }
      }
      resBox.innerHTML = spSentResultHTML(a, said, awarded ? pts : 0);
      resBox.querySelectorAll('.sp-hear').forEach(function (b) {
        b.addEventListener('click', function () { speakWord(b.getAttribute('data-w')); });
      });
      /* Persist the attempt for teacher review. */
      if (state.user && state.user.id && sb) {
        try {
          await sb.from('shadowing_attempts').insert({
            user_id: state.user.id,
            lesson_date: m.date || null,
            audio_path: '',
            transcript: ('[s' + (i + 1) + '] ' + said).slice(0, 2000),
            score: a.accuracy
          });
        } catch (e) { /* table optional until the migration is run */ }
      }
      markSpSentenceDone(i);
      /* Feed the progress report instantly (works for demo users too). */
      const spList = document.getElementById('sp-sentences');
      if (spList && typeof paintSpReport === 'function') {
        (spList._spRows = spList._spRows || []).unshift({ transcript: '[s' + (i + 1) + '] ' + said, score: a.accuracy, strict: prior === 0 });
        paintSpReport(spList);
      }
    } catch (e) {
      resBox.innerHTML = '<div class="empty">⚠️ Something went wrong: ' +
        esc(String((e && e.message) || e)) + '. Try again.</div>';
    }
  }


  list.addEventListener('click', function (ev) {
    const hear = ev.target.closest('.sp-hear');
    if (hear) { speakWord(hear.getAttribute('data-w')); return; }
    const spSave = ev.target.closest('.sp-save');
    if (spSave) { toggleSaveSpSentence(m, sentences, +spSave.getAttribute('data-i')); return; }
    const play = ev.target.closest('.sp-play');
    if (play && !play.disabled) { playSentence(+play.getAttribute('data-i')); return; }
    const mic = ev.target.closest('.sp-mic');
    if (!mic || mic.disabled) return;
    const i = +mic.getAttribute('data-i');
    if (active) {
      if (active.i === i) stopActive(false);
      return;
    }
    startRecording(i);
  });
  /* Restore this lesson's progress: sentences already attempted stay marked
     as done, with a banner to continue from the first unfinished one. */
  restoreSpProgress(list, m, sentences);
}

/* Shadowing progress persistence: attempts are already stored per lesson in
   `shadowing_attempts` (transcript "[sN] ..."), so progress is derived from
   them — no new table, works across devices. */
async function restoreSpProgress(list, m, sentences) {
  if (!list) return;
  list._spRows = list._spRows || [];
  list._spSentences = sentences || [];
  paintSpReport(list);
  if (!cloudReady() || !m || !m.date || !sb) return;
  try {
    const res = await sb.from('shadowing_attempts').select('transcript,score')
      .eq('user_id', state.user.id).eq('lesson_date', m.date)
      .order('created_at', { ascending: false }).limit(300);
    if (res.error) return;
    list._spRows = res.data || [];
  } catch (e) { return; }
  const info = paintSpReport(list);
  const done = info.done;
  const sents = list.querySelectorAll('.sp-sent');
  if (!sents.length) return;
  sents.forEach(function (el) {
    const n = parseInt(el.getAttribute('data-i'), 10) + 1;
    if (done[n]) el.classList.add('sp-done');
  });
  /* Restored progress may already cover every sentence (done on another
     device) — the shadowing step completes without re-practicing. */
  try { if (m && m.date) checkShadowingStepDone(m.date); } catch (e) {}
  let firstOpen = 1;
  while (firstOpen <= sents.length && done[firstOpen]) firstOpen++;
  if (firstOpen > 1 && firstOpen <= sents.length && !list.parentNode.querySelector('.sp-continue')) {
    const b = document.createElement('button');
    b.className = 'sp-continue';
    b.innerHTML = '▶ Continue from sentence ' + firstOpen + ' of ' + sents.length;
    b.addEventListener('click', function () {
      const el = list.querySelector('.sp-sent[data-i="' + (firstOpen - 1) + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    list.parentNode.insertBefore(b, list);
  }
}
/* Progress report strip above the sentences: practiced count, progress bar,
   average best score. Recomputed from list._spRows, so attempts made in this
   session update it instantly (works for demo users too). */
function paintSpReport(list) {
  const done = {}, best = {}, said = {}, wasStrict = {};
  (list._spRows || []).forEach(function (r) {
    const mm = String(r.transcript || '').match(/^\[s(\d+)\]\s?(.*)$/);
    if (!mm) return;
    const n = parseInt(mm[1], 10);
    done[n] = 1;
    const sc = Number(r.score) || 0;
    if (!(n in best) || sc > best[n]) best[n] = sc;
    if (!(n in said)) { said[n] = mm[2] || ''; wasStrict[n] = !!r.strict; } /* rows are newest-first: first wins */
  });
  list._spSaid = said;
  const total = list.querySelectorAll('.sp-sent').length;
  const count = Object.keys(done).length;
  const scores = Object.keys(best).map(function (k) { return best[k]; });
  const avg = scores.length ? Math.round(scores.reduce(function (x, y) { return x + y; }, 0) / scores.length) : 0;
  const pct = total ? Math.round(count / total * 100) : 0;
  let host = list.parentNode.querySelector('#sp-report');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sp-report';
    host.className = 'sp-report';
    list.parentNode.insertBefore(host, list);
  }
  host.innerHTML = '<div class="sp-report-top"><span>📊 <b>' + count + '/' + total + '</b> practiced</span>' +
    (count ? '<span>avg score <b>' + avg + '%</b></span>' : '<span class="muted">not started yet</span>') + '</div>' +
    '<div class="sp-pbar"><div class="sp-pfill" style="width:' + pct + '%"></div></div>';
  /* Always-open last-attempt detail under each practiced sentence: "You said"
     plus the target with missed words highlighted (tappable 🔊). No score
     numbers — just what to fix. Skipped while the live result box is showing
     (same info), so nothing is duplicated. */
  list.querySelectorAll('.sp-sent').forEach(function (el) {
    const n = parseInt(el.getAttribute('data-i'), 10) + 1;
    let det = el.querySelector('.sp-sent-detail');
    const said = (list._spSaid || {})[n];
    const target = (list._spSentences || [])[n - 1];
    const liveBox = el.querySelector('.sp-sent-result');
    const liveVisible = liveBox && liveBox.innerHTML.trim().length > 0;
    if (said && target && !liveVisible && typeof analyzeSpeech === 'function') {
      if (!det) {
        det = document.createElement('div');
        det.className = 'sp-sent-detail';
        const top = el.querySelector('.sp-sent-top');
        if (top && top.parentNode) top.parentNode.insertBefore(det, top.nextSibling);
        else el.insertBefore(det, el.querySelector('.sp-sent-live'));
      }
      const a = analyzeSpeech(target, said, wasStrict[n] ? SHADOW_SCORING_FIRST : SHADOW_SCORING);
      det.innerHTML = '<div class="sp-detail-title">Last attempt — what to fix</div>' +
        spSentResultHTML(a, said, 0, true);
    } else if (det) det.remove();
  });
  return { done: done, count: count, total: total };
}
function markSpSentenceDone(i) {
  const el = document.querySelector('#sp-sentences .sp-sent[data-i="' + i + '"]');
  if (el) el.classList.add('sp-done');
  try {
    if (state.lesson && state.lesson.date) checkShadowingStepDone(state.lesson.date);
  } catch (e) {}
}
/* Shadowing step = every sentence exercise practiced (all .sp-sent done). */
function checkShadowingStepDone(dateStr) {
  try {
    const list = document.getElementById('sp-sentences');
    if (!list || !dateStr) return;
    const sents = list.querySelectorAll('.sp-sent');
    if (!sents.length) return;
    for (let k = 0; k < sents.length; k++) {
      if (!sents[k].classList.contains('sp-done')) return;
    }
    markStep(dateStr, 'shadowing');
  } catch (e) {}
}

function quizTabHTML(m) {
  const n = (m.quiz || []).length;
  if (!n) return '<div class="empty">No quiz for this lesson.</div>';
  return '<button class="quiz-banner" data-action="quiz-start" data-kind="word" aria-label="Start the word quiz"></button>';
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
    ? '<button class="grammar-quiz-banner" data-action="quiz-start" data-kind="grammar" aria-label="Start grammar quiz">' +
      '<img src="/media/grammar/quiz-banner.jpg" alt="Quick Practice — Ready to test yourself? Start grammar quiz" loading="lazy"></button>'
    : '';
  const enAudio = (normalizeLevel(m.level) === 'a1' || normalizeLevel(m.level) === 'a2') && g.audio
    ? audioCardHTML({ id: 'grammar-en-' + m.date, src: g.audio,
        title: '🎧 Grammar explained simply', sub: 'Slow and easy English', speeds: true, download: true })
    : '';
  return '<div class="grammar-page"><div class="grammar-hero"><span class="hero-kicker">🗂 Grammar of the day</span>' +
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
    questions = buildDuoDeck(m);
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
  } else if (kind === 'saved') {
    if (!m) m = { date: todayStr(), level: (state.user && state.user.level) || '', theme: '' };
    questions = buildSavedDeck(await getSavedWords());
  }
  if (!questions.length) return;
  /* Fix 2: resume an in-progress word/grammar quiz instead of restarting it. */
  if (kind === 'word' || kind === 'grammar') {
    const prog = loadQuizProgress(kind, m.date);
    if (prog) { showQuizResumePrompt(kind, m, questions, prog); return; }
  }
  beginQuizSession(kind, m, questions, null);
}

/* Start (or resume) a quiz session. prog = saved progress to resume, or null
   for a brand-new session. Fix 3: new sessions grant hearts by account age
   (30 for <=30 days, 10 after); resumed sessions keep the better of the saved
   hearts and the current daily hearts, so hearts earned in review apply. */
function beginQuizSession(kind, m, questions, prog) {
  let qHearts;
  if (prog) {
    qHearts = Math.max(prog.hearts || 0, getHearts());
  } else if (kind === 'word' || kind === 'grammar' || kind === 'saved') {
    qHearts = sessionHeartGrant();
    setHearts(qHearts);
  } else {
    qHearts = 0;
  }
  state.quiz = {
    kind: kind, questions: prog ? prog.questions : questions,
    idx: prog ? prog.idx : 0, correct: prog ? prog.correct : 0,
    log: (prog && prog.log) || [],
    answered: false, picked: -1, wasCorrect: false,
    hearts: qHearts,
    date: m.date, level: m.level, theme: m.theme
  };
  saveQuizProgress();
  renderQuizView();
}

/* "Continue where you left off?" — shown when re-entering a word/grammar quiz
   with saved in-progress state. Never silently restarts. */
function showQuizResumePrompt(kind, m, freshQuestions, prog) {
  if (document.getElementById('quiz-resume-modal')) return;
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'quiz-resume-modal';
  d.innerHTML = '<div class="duo-modal"><h3>Continue where you left off?</h3>' +
    '<p>You reached question ' + (prog.idx + 1) + ' of ' + prog.questions.length + '.</p>' +
    '<button class="duo-continue btn-block" id="quiz-resume-yes">▶ Continue</button>' +
    '<button class="btn btn-ghost btn-block" id="quiz-resume-no">↺ Start over</button></div>';
  $('#view').appendChild(d);
  document.getElementById('quiz-resume-yes').onclick = function () {
    d.remove();
    beginQuizSession(kind, m, null, prog);
  };
  document.getElementById('quiz-resume-no').onclick = function () {
    d.remove();
    clearQuizProgress(kind, m.date);
    beginQuizSession(kind, m, freshQuestions, null);
  };
}

function renderQuizView() {
  const q = state.quiz;
  /* Fix 4: the mistakes review uses the same full-screen Duolingo-style player
     as the word/grammar quizzes (one question at a time, instant feedback,
     hearts, progress bar, XP/result screen). */
  if (q.kind === 'word' || q.kind === 'assignment' || q.kind === 'grammar' || q.kind === 'mistakes' || q.kind === 'saved') { renderDuoQuizView(); return; }
  const v = $('#view');
  const cur = q.questions[q.idx];
  const total = q.questions.length;
  const letters = ['A', 'B', 'C', 'D'];
  let dots = '';
  for (let i = 0; i < total; i++) {
    dots += '<i class="' + (i < q.idx ? 'done' : (i === q.idx ? 'cur' : '')) + '"></i>';
  }
  let html = '<div class="quiz-progress2"><div class="qp-dots">' + dots + '</div>' +
    '<span class="qp-count">' + (q.idx + 1) + ' / ' + total + '</span></div>' +
    '<div class="card quiz-qcard"><div class="quiz-q">' + esc(cur.question) + '</div><div class="quiz-opts">' +
    cur.options.map(function (opt, i) {
      let cls = 'opt2';
      let tick = '';
      if (q.answered) {
        if (i === cur.answer) { cls += ' correct'; tick = '<span class="opt-tick">✓</span>'; }
        else if (i === q.picked) { cls += ' wrong'; tick = '<span class="opt-tick">✗</span>'; }
        else cls += ' dim';
      }
      return '<button class="' + cls + '" data-action="quiz-opt" data-idx="' + i + '"' +
        (q.answered ? ' disabled' : '') + '><span class="opt-key">' + letters[i] + '</span>' +
        '<span class="opt-text">' + esc(opt) + '</span>' + tick + '</button>';
    }).join('') + '</div></div>';

  if (q.answered && cur.explanation) {
    html += '<div class="quiz-explain">💡 ' + esc(cur.explanation) + '</div>';
  }
  if (q.answered) {
    html += '<button class="btn btn-orange btn-block quiz-next" data-action="quiz-next">' +
      (q.idx + 1 < total ? 'Next question <span>→</span>' : 'See my score <span>→</span>') + '</button>';
  }
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
  if (q.log) q.log.push({ picked: idx, correct: cur.answer });
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
  document.body.classList.remove('duo-playing');
  /* Fix 2: completion clears the saved in-progress state. */
  if (q && (q.kind === 'word' || q.kind === 'grammar')) clearQuizProgress(q.kind, q.date);
  if (q && q.kind === 'assignment' && q.assignmentId) clearAssignProgress(q.assignmentId);
  const total = q.questions.length;
  const pct = Math.round((q.correct / total) * 100);
  let heartEarned = false;
  saveAttempt({
    date: q.date, level: q.level, theme: q.theme,
    kind: q.kind, score: q.correct, total: total
  });
  bumpStat('quizzes_completed', 1);
  trackEvent('quiz_completed', { kind: q.kind, score: q.correct, total: total, date: q.date, level: q.level, theme: q.theme || '' });
  if (q.kind === 'word' && q.date) {
    const firstTime = !((getDayProgress(q.date) || {}).quiz);
    markStep(q.date, 'quiz', { score: q.correct, total: total });
    if (firstTime) {
      /* Rank-climb celebration: snapshot rank before the XP lands, award it,
         then animate the climb. Falls back to the classic celebration when
         the board is unreachable. The classic celebration runs after. */
      state.quiz = null;
      launchRankClimb({ correct: q.correct, total: total, date: q.date, xp: 10 + q.correct, action: 'word_quiz' });
      return;
    }
    awardPoints('word_quiz', 10 + q.correct, q.date);
  } else if (q.kind === 'grammar' && q.date) {
    /* Grammar step = the grammar quiz is finished (2026-10-14 rule). */
    markStep(q.date, 'grammar');
    if (!rkcDone('grammar', q.date)) {
      state.quiz = null;
      launchRankClimb({ correct: q.correct, total: total, date: q.date, xp: 10, action: 'grammar_quiz' });
      return;
    }
    awardPoints('grammar_quiz', 10, q.date);
  } else if (q.kind === 'mistakes') {
    awardPoints('deck_review', 10, q.date || todayStr());
    /* Duolingo loop: reviewing mistakes earns a heart back (max 5/day). */
    heartEarned = getHearts() < 5;
    if (heartEarned) setHearts(getHearts() + 1);
  } else if (q.kind === 'assignment') {
    const aId = q.assignmentId || ('noid-' + (q.date || todayStr()));
    if (!rkcDone('assign', aId)) {
      /* saveAssignmentResult reads state.quiz, so save before nulling it */
      saveAssignmentResult();
      state.quiz = null;
      launchRankClimb({ correct: q.correct, total: total, date: q.date || todayStr(), xp: 10, action: 'assignment_quiz' });
      return;
    }
    awardPoints('assignment_quiz', 10, q.date || todayStr());
    saveAssignmentResult();
  }
  state.quiz = null;
  const praise = pct >= 85 ? 'Excellent work! ✨' : pct >= 60 ? 'Good — keep practicing! 💪' : 'Keep going — you\'ve got this! 📚';
  const xpGain = q.kind === 'word' ? 10 + q.correct : 10;
  /* resuming a quiz paused for a hearts review (Fix 2: word/grammar too) */
  const resumeA = (q.kind === 'mistakes' && state.pausedQuiz && state.pausedQuiz.kind !== 'mistakes') ? state.pausedQuiz : null;
  const resumeLabel = resumeA
    ? (resumeA.kind === 'assignment' ? '📝 Continue homework · Q' : '▶ Continue quiz · Q') +
      (resumeA.idx + 1) + '/' + resumeA.questions.length
    : '';
  $('#view').innerHTML =
  '<div class="duo-results"><div class="duo-rcard">' +
    '<div class="duo-hero"><img src="/media/quiz/trophy.png" alt="" loading="lazy"></div>' +
    '<div class="duo-score-big">' + q.correct + '/' + total + '</div>' +
    '<div class="duo-score-sub">' + pct + '% · ' + praise +
    (heartEarned ? '<br>❤️ +1 heart earned!' : '') + '</div>' +
    '<div class="duo-pills">' +
      '<div class="duo-pill green"><span class="pi">✓</span><span class="pn">' + q.correct + '</span><span class="pl">correct</span></div>' +
      '<div class="duo-pill red"><span class="pi">✕</span><span class="pn">' + (total - q.correct) + '</span><span class="pl">to review</span></div>' +
      '<div class="duo-pill gold"><span class="pi">★</span><span class="pn">+' + xpGain + '</span><span class="pl">XP</span></div>' +
    '</div>' +
    '<div class="duo-rbtns">' +
      (resumeA ? '<button class="btn duo-btn-review" data-action="resume-paused">' + resumeLabel + '</button>' : '') +
      '<a class="btn duo-btn-home" href="#/home">🏠 Home</a>' +
      '<button class="btn duo-btn-review" data-action="practice-again">🔁 Review →</button>' +
    '</div></div></div>';
  window.scrollTo(0, 0);
}

/* ---------------- Duolingo-style game player (word quiz) ----------------
   Hearts + progress bar + instant feedback + mixed challenge types
   (select / reverse / listen / assist). Grammar & mistakes quizzes keep
   the classic renderer below. */
function shuffleArr(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function heartsKey() {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_hearts_' + email + '_' + todayStr();
}
function getHearts() {
  try {
    const v = parseInt(localStorage.getItem(heartsKey()), 10);
    return isNaN(v) ? 5 : Math.max(0, Math.min(99, v));
  } catch (e) { return 5; }
}
function setHearts(n) {
  try { localStorage.setItem(heartsKey(), String(Math.max(0, Math.min(99, n)))); } catch (e) {}
}

function buildDuoDeck(m) {
  const deck = [];
  (m.quiz || []).forEach(function (q) {
    deck.push({ qtype: 'select', question: q.question, options: q.options.slice(), answer: q.answer, kind: 'word' });
  });
  const words = (m.words || []).filter(function (w) { return w && w.word; });
  function distractors(word, n) {
    return shuffleArr(words.filter(function (x) { return x.word !== word; }))
      .slice(0, n).map(function (x) { return x.word; });
  }
  /* REVERSE: Persian meaning -> English word */
  shuffleArr(words).slice(0, 3).forEach(function (w) {
    if (!w.persian) return;
    const opts = shuffleArr([w.word].concat(distractors(w.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'reverse', question: '\u00AB' + w.persian + '\u00BB به انگلیسی چی میشه؟', rtl: true,
      options: opts, answer: opts.indexOf(w.word), kind: 'word', word: w.word
    });
  });
  /* LISTEN: hear the pronunciation -> pick the word */
  shuffleArr(words.filter(function (w) { return w.word_audio; })).slice(0, 2).forEach(function (w) {
    const opts = shuffleArr([w.word].concat(distractors(w.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'listen', question: 'Which word did you hear?', audio: w.word_audio,
      persian: w.persian,
      options: opts, answer: opts.indexOf(w.word), kind: 'word', word: w.word
    });
  });
  /* ASSIST: tap the words in order to build the example sentence */
  shuffleArr(words.filter(function (w) {
    if (!w.example) return false;
    const n = w.example.replace(/["\u201C\u201D']/g, '').trim().split(/\s+/).length;
    return n >= 4 && n <= 12;
  })).slice(0, 2).forEach(function (w) {
    const tokens = w.example.replace(/["\u201C\u201D']/g, '').trim().split(/\s+/);
    deck.push({
      qtype: 'assist', question: 'Tap the words in order', hint: w.persian,
      tokens: tokens,
      bank: shuffleArr(tokens.map(function (t, i) { return { t: t, k: i }; })),
      placed: [], kind: 'word', word: w.word
    });
  });
  return shuffleArr(deck).slice(0, 14);
}

function duoTopbar(q) {
  const pct = Math.round((q.idx / q.questions.length) * 100);
  /* Mistakes review never costs hearts (it earns them) — hide the counter. */
  const heartsHtml = (q.kind === 'mistakes') ? '' : '<span class="duo-hearts">❤️ ' + q.hearts + '</span>';
  return '<div class="duo-top">' +
    '<button class="duo-x" data-action="duo-exit" aria-label="Quit quiz">✕</button>' +
    '<div class="duo-pbar"><div class="duo-pfill" style="width:' + pct + '%"></div></div>' +
    heartsHtml + '</div>';
}

function duoAssistHTML(q, cur) {
  let html = '<div class="duo-q">' + esc(cur.question) + '</div>';
  if (cur.hint) html += '<div class="duo-hint-wrap"><span class="duo-hint">💡 ' + esc(cur.hint) + '</span></div>';
  html += '<div class="duo-slots">' + (cur.placed.length
    ? cur.placed.map(function (bi) {
      return '<button class="duo-tok" data-action="duo-unpick" data-bi="' + bi + '"' +
        (q.answered ? ' disabled' : '') + '>' + esc(cur.bank[bi].t) + '</button>';
    }).join('')
    : '<span class="duo-slots-empty">Tap the words below…</span>') + '</div>';
  const used = {};
  cur.placed.forEach(function (bi) { used[bi] = true; });
  html += '<div class="duo-bank">' + cur.bank.map(function (b, bi) {
    return '<button class="duo-tok' + (used[bi] ? ' used' : '') + '" data-action="duo-pick" data-bi="' + bi + '"' +
      (used[bi] || q.answered ? ' disabled' : '') + '>' + esc(b.t) + '</button>';
  }).join('') + '</div>';
  if (!q.answered) {
    const ready = cur.placed.length === cur.tokens.length;
    html += '<button class="btn btn-block duo-check" data-action="duo-check"' +
      (ready ? '' : ' disabled') + '>CHECK</button>';
  }
  return html;
}

function duoTrayText(q, cur) {
  /* short explanation line shown under the tray title */
  if (q.wasCorrect) {
    if (cur.qtype === 'select') return 'Nice! "' + cur.options[cur.answer] + '" is right.';
    if (cur.qtype === 'reverse' || cur.qtype === 'listen') return 'Well done! 🎉';
    if (cur.qtype === 'typein') return 'Perfect! 🎉';
    return 'Perfect sentence! 🎉';
  }
  if (cur.qtype === 'assist') return cur.tokens.join(' ');
  if (cur.qtype === 'typein') return (cur.accept || []).join(' / ');
  return cur.options[cur.answer];
}

function duoFooter(q, cur) {
  const ok = q.wasCorrect;
  const title = ok ? 'Correct answer!' : (cur.qtype === 'assist' ? 'Not quite!' : 'Correct answer:');
  const ico = ok ? '✓' : '✕';
  const last = q.idx + 1 >= q.questions.length;
  return '<div class="duo-tray-wrap"><div class="duo-tray-inner">' +
    '<div class="duo-tray ' + (ok ? 'ok' : 'bad') + '">' +
    '<span class="duo-tray-ico">' + ico + '</span>' +
    '<div><div class="duo-tray-title">' + title + '</div>' +
    '<div class="duo-tray-text">' + esc(duoTrayText(q, cur)) + '</div></div></div>' +
    ((!ok && cur.explanation) ? '<div class="duo-explain">💡 ' + esc(cur.explanation) + '</div>' : '') +
    '<button class="duo-continue ' + (ok ? 'ok' : 'bad') + '" data-action="duo-next">' +
    (last ? 'See my score' : 'Continue') + ' <span>→</span></button>' +
    '</div></div>';
}

/* typein: typed-answer question (v2 gap) */
function duoTypeinHTML(q, cur) {
  const val = q.typed || '';
  let html = '<div class="duo-q">' + esc(cur.question).replace(/___/g, '…') + '</div>';
  html += '<div class="duo-typein-wrap"><input type="text" id="duo-typein-input" class="duo-typein-input" ' +
    'placeholder="Type your answer…" value="' + esc(val) + '"' + (q.answered ? ' disabled' : '') + ' autocomplete="off"></div>';
  if (!q.answered) {
    html += '<button class="btn btn-block duo-check" data-action="duo-typein-check">CHECK</button>';
  }
  return html;
}
function duoNormalize(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/\.$/, '');
}
function renderDuoQuizView() {
  const q = state.quiz;
  const v = $('#view');
  document.body.classList.add('duo-playing');
  const cur = q.questions[q.idx];
  const letters = ['A', 'B', 'C', 'D'];
  let html = duoTopbar(q) + '<div class="duo-body">';
  if (cur.qtype === 'assist') {
    html += duoAssistHTML(q, cur);
  } else if (cur.qtype === 'typein') {
    html += duoTypeinHTML(q, cur);
  } else {
    if (cur.qtype === 'listen') {
      html += '<div class="duo-listen"><div class="duo-q">' + esc(cur.question) + '</div>';
      if (!q.answered) {
        html += '<button class="duo-replay" data-action="play-track" data-src="' + esc(cur.audio) +
          '" data-title="' + esc(cur.word) + '">↻ Listen again</button>';
      }
      html += '</div>';
    } else {
      html += '<div class="duo-q"' + (cur.rtl ? ' dir="rtl"' : '') + '>' + esc(cur.question) + '</div>';
    }
    html += '<div class="duo-opts">' + cur.options.map(function (opt, i) {
      let cls = 'duo-opt', badge = '';
      if (q.answered) {
        if (i === cur.answer) { cls += ' ok'; badge = '<span class="opt-badge">✓</span>'; }
        else if (i === q.picked) { cls += ' bad'; badge = '<span class="opt-badge">✕</span>'; }
        else cls += ' dim';
      }
      return '<button class="' + cls + '" data-action="duo-opt" data-idx="' + i + '"' +
        (q.answered ? ' disabled' : '') + '><span class="opt-key">' + letters[i] + '</span>' +
        '<span class="opt-text">' + esc(opt) + '</span>' + badge + '</button>';
    }).join('') + '</div>';
  }
  html += '</div>';
  if (q.answered) html += duoFooter(q, cur);
  v.innerHTML = html;
  window.scrollTo(0, 0);
  if (cur.qtype === 'listen' && !q.answered) playTrack(cur.audio, cur.word);
}

function duoLoseHeart(q) {
  q.hearts = Math.max(0, q.hearts - 1);
  setHearts(q.hearts);
  return q.hearts;
}

/* Chain of pending mistake-saves: the hearts-out "review" button waits for it,
   so a just-lost heart's mistake is always reviewable (no race). */
var duoSavePending = Promise.resolve();

function duoTypeinCheck() {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  if (cur.qtype !== 'typein') return;
  const input = document.getElementById('duo-typein-input');
  const val = input ? input.value : '';
  q.typed = val;
  q.answered = true;
  const norm = duoNormalize(val);
  const correct = (cur.accept || []).some(function (a) { return duoNormalize(a) === norm; });
  q.wasCorrect = correct;
  q.picked = val; /* store typed text */
  if (q.log) {
    const entry = { picked: val, correct: correct };
    if (cur.v2) {
      entry.qid = cur.v2.qid;
      entry.points = cur.v2.points;
      entry.type = cur.v2.type;
      entry.response = val;
      entry.isCorrect = correct;
    }
    q.log.push(entry);
  }
  if (correct) {
    q.correct++;
  } else {
    duoSavePending = duoSavePending.catch(function () {}).then(function () {
      return saveDuoMistake(q, cur, val);
    });
    if (duoLoseHeart(q) <= 0) { saveProgressAny(); renderHeartsOut(); return; }
  }
  saveProgressAny();
  renderDuoQuizView();
}
async function duoAnswer(idx) {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  q.answered = true;
  q.picked = idx;
  q.wasCorrect = (idx === cur.answer);
  if (q.log) {
    const entry = { picked: idx, correct: cur.answer };
    if (cur.v2) {
      entry.qid = cur.v2.qid;
      entry.points = cur.v2.points;
      entry.type = cur.v2.type;
      entry.response = idx;
      entry.isCorrect = q.wasCorrect;
    }
    q.log.push(entry);
  }
  /* listening: answering dismisses the mini-player bar */
  if (cur.qtype === 'listen') closePlayer();
  if (q.wasCorrect) {
    q.correct++;
    /* Fix 4: answering a review question correctly clears that mistake. */
    if (q.kind === 'mistakes' && cur.mistakeId) removeMistake(cur.mistakeId);
  } else if (q.kind !== 'mistakes') {
    /* every wrong answer becomes reviewable; chained so the review button never races it.
       (A mistakes-review question is already a mistake: never re-save it, and a
       wrong review answer never costs a heart — Fix 4.) */
    duoSavePending = duoSavePending.catch(function () {}).then(function () {
      return saveDuoMistake(q, cur, idx);
    });
    if (duoLoseHeart(q) <= 0) { saveProgressAny(); renderHeartsOut(); return; }
  }
  saveProgressAny();
  renderDuoQuizView();
}

async function saveDuoMistake(q, cur, picked) {
  const base = { date: q.date, level: q.level, kind: cur.kind || 'word', picked: picked };
  if (cur.qtype === 'select' || cur.qtype === 'reverse') {
    await saveMistake(Object.assign({}, base, {
      question: cur.question, options: cur.options, answer: cur.answer
    }));
  } else if (cur.qtype === 'listen' && cur.persian) {
    await saveMistake(Object.assign({}, base, {
      question: '\u00AB' + cur.persian + '\u00BB به انگلیسی چی میشه؟',
      options: cur.options, answer: cur.answer
    }));
  } else if (cur.qtype === 'typein') {
    await saveMistake(Object.assign({}, base, {
      question: cur.question, options: [], answer: 0,
      typed: picked, accept: cur.accept || []
    }));
  } else if (cur.qtype === 'assist') {
    const correct = cur.tokens.join(' ');
    const seen = {}, distract = [];
    seen[correct] = true;
    let guard = 0;
    while (distract.length < 3 && guard++ < 25) {
      const s = shuffleArr(cur.tokens).join(' ');
      if (!seen[s]) { seen[s] = true; distract.push(s); }
    }
    if (!distract.length) return;
    const opts = shuffleArr([correct].concat(distract));
    await saveMistake(Object.assign({}, base, {
      question: 'Put the words in order:',
      options: opts, answer: opts.indexOf(correct)
    }));
  } else {
    /* plain multiple-choice (e.g. grammar quiz) */
    await saveMistake(Object.assign({}, base, {
      question: cur.question, options: cur.options, answer: cur.answer
    }));
  }
}

function duoPick(bi) {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  if (cur.placed.indexOf(bi) === -1 && cur.placed.length < cur.tokens.length) {
    cur.placed.push(bi);
    renderDuoQuizView();
  }
}

function duoUnpick(bi) {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  cur.placed = cur.placed.filter(function (x) { return x !== bi; });
  renderDuoQuizView();
}

function duoCheck() {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  if (cur.placed.length !== cur.tokens.length) return;
  const built = cur.placed.map(function (bi) { return cur.bank[bi].t; }).join(' ');
  q.answered = true;
  q.wasCorrect = (built === cur.tokens.join(' '));
  if (q.wasCorrect) q.correct++;
  else if (q.kind !== 'mistakes' && duoLoseHeart(q) <= 0) { saveProgressAny(); renderHeartsOut(); return; }
  saveProgressAny();
  renderDuoQuizView();
}

function duoNext() {
  const q = state.quiz;
  if (!q) return;
  if (q.idx + 1 < q.questions.length) {
    q.idx++; q.answered = false; q.picked = -1; q.wasCorrect = false;
    saveProgressAny();
    renderDuoQuizView();
  } else {
    finishQuiz();
  }
}

function renderHeartsOut() {
  const q = state.quiz;
  document.body.classList.add('duo-playing');
  const done = q.idx + 1;
  $('#view').innerHTML =
    '<div class="duo-out"><div class="duo-out-card"><div class="duo-out-emoji">💔</div>' +
    '<h2>Out of hearts!</h2>' +
    '<p>You got <strong>' + q.correct + ' / ' + done + '</strong> right.</p>' +
    '<div class="duo-out-btns">' +
    '<button class="btn duo-btn-buy" data-action="duo-buy-hearts">⚡ Refill hearts · ' + HEART_REFILL_COST + ' XP</button>' +
    '<div id="duo-buy-note" class="duo-earn-note" style="display:none"></div>' +
    '<button class="btn duo-btn-review" data-action="duo-earn-heart">🔁 Review · earn ❤️</button>' +
    '<div id="duo-earn-note" class="duo-earn-note" style="display:none"></div>' +
    '<button class="btn duo-btn-home" data-action="duo-quit">🏠 Lesson</button>' +
    '</div></div></div>';
  window.scrollTo(0, 0);
}

function duoExit() {
  if (document.getElementById('duo-exit-modal')) return;
  const k = state.quiz && state.quiz.kind;
  const saved = (k === 'assignment' || k === 'word' || k === 'grammar');
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'duo-exit-modal';
  d.innerHTML = '<div class="duo-modal"><h3>Quit this quiz?</h3>' +
    '<p>' + (saved ? 'Your progress is saved — you can continue later.' : 'Your progress will be lost.') + '</p>' +
    '<button class="duo-continue bad btn-block" data-action="duo-quit">Quit</button>' +
    '<button class="btn btn-ghost btn-block" data-action="duo-keep">Keep playing</button></div>';
  $('#view').appendChild(d);
}

function duoQuit() {
  const q = state.quiz;
  const date = q && q.date;
  /* Fix 2: quitting saves progress (resume on re-entry); only completion or
     an explicit "start over" clears it. */
  saveProgressAny();
  state.quiz = null;
  document.body.classList.remove('duo-playing');
  const m = document.getElementById('duo-exit-modal');
  if (m) m.remove();
  try { if (player.el && !player.el.paused) player.el.pause(); } catch (e) {}
  go('lesson', date);
}

function duoKeep() {
  const m = document.getElementById('duo-exit-modal');
  if (m) m.remove();
}

/* Buy a full hearts refill with XP (30 XP). */
var HEART_REFILL_COST = 30;
async function buyHearts(btn) {
  const note = document.getElementById('duo-buy-note');
  const say = function (msg) {
    if (note) { note.textContent = msg; note.style.display = 'block'; }
  };
  const wasAssignment = state.quiz && state.quiz.kind === 'assignment';
  if (btn) btn.disabled = true;
  try {
    await refreshMyPoints();
    const bal = state.myPoints;
    if (typeof bal !== 'number') {
      say('Couldn\'t check your XP — check your connection and try again.');
      if (btn) btn.disabled = false;
      return;
    }
    if (bal < HEART_REFILL_COST) {
      say('Not enough XP — you have ' + bal + ', need ' + HEART_REFILL_COST + '. 💪');
      if (btn) btn.disabled = false;
      return;
    }
    await awardPoints('hearts_refill', -HEART_REFILL_COST, 'hr-' + Date.now(), true);
    await refreshMyPoints();
    /* Refill to the session grant (30 for new accounts, 10 after 30 days). */
    setHearts(sessionHeartGrant());
    say('❤️ Hearts refilled! Starting a new run…');
    setTimeout(function () {
      if (wasAssignment && state.quiz && state.quiz.kind === 'assignment') {
        /* resume the exam where it stopped, retrying the heart-killing question */
        const pq = state.quiz;
        if (pq.log && pq.log.length > pq.idx) pq.log.pop();
        pq.answered = false; pq.picked = -1; pq.wasCorrect = false;
        pq.hearts = getHearts();
        document.body.classList.add('duo-playing');
        saveAssignProgress();
        renderDuoQuizView();
      } else {
        startQuiz('word');
      }
    }, 900);
  } catch (e) {
    say('Something went wrong — please try again.');
    if (btn) btn.disabled = false;
  }
}

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
    const zs = PODMS_ZONES[stage];
    if (!zs) return;
    const W = root.clientWidth, H = root.clientHeight;
    const iw = 941, ih = 1672;
    const sc = Math.max(W / iw, H / ih);
    const dw = iw * sc, dh = ih * sc, ox = (W - dw) / 2, oy = (H - dh) / 2;
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

/* ---------------- My Rewards (Progress tab) ---------------- */
function rewardsPlaceholderHTML() {
  return '<div class="card rewards-card"><div class="section-title" style="margin:0 0 0.4rem"><h2>🏆 My Rewards</h2></div>' +
    '<div id="rewards-body"><p class="muted">Loading…</p></div></div>';
}
function badgeHTML(icon, name, earned) {
  return '<div class="badge' + (earned ? ' earned' : ' locked') + '">' +
    '<span class="badge-icon">' + icon + '</span>' +
    '<span class="badge-name">' + name + '</span>' +
    '<span class="badge-tick">' + (earned ? '✓' : '🔒') + '</span></div>';
}
function shortDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch (e) { return ''; }
}
async function refreshRewardsSection() {
  const body = document.getElementById('rewards-body');
  if (!body || state.view !== 'scores') return;
  try {
    const res = await Promise.all([getMyPoints(), getStreakState(), getMyPrizes()]);
    if (!document.getElementById('rewards-body') || state.view !== 'scores') return;
    const pts = res[0], st = res[1], prizes = res[2];
    const longest = st.longest_streak || 0;
    const hasStar = prizes.some(function (p) { return p.points === 30; });
    const hasFreeze = prizes.some(function (p) { return p.points === 0; });
    let html = '<div class="rewards-top">' +
      '<div class="rewards-stat"><span class="rp-num">' + pts + '</span><span class="rp-label">total points</span></div>' +
      '<div class="rewards-stat"><span class="rp-num">🔥 ' + (st.current_streak || 0) + '</span><span class="rp-label">day streak</span></div>' +
      '<div class="rewards-stat"><span class="rp-num">🎁 ' + prizes.length + '</span><span class="rp-label">prizes won</span></div></div>';
    html += '<div class="badge-row">' +
      badgeHTML('🔥', '7-day streak', longest >= 7) +
      badgeHTML('🔥', '30-day streak', longest >= 30) +
      badgeHTML('🔥', '100-day streak', longest >= 100) +
      badgeHTML('⭐', 'Weekly Star', hasStar) +
      badgeHTML('🧊', 'Freeze Keeper', hasFreeze) + '</div>';
    if (prizes.length) {
      html += '<div class="prize-title">Mystery box prizes</div><div class="prize-list">' +
        prizes.map(function (p) {
          return '<div class="prize-row"><span class="prize-ico">🎁</span>' +
            '<span class="prize-name">' + esc(prizeLabel(p.points)) + '</span>' +
            '<span class="prize-date">' + esc(shortDate(p.created_at)) + '</span></div>';
        }).join('') + '</div>';
    } else {
      html += '<p class="muted" style="margin:0.6rem 0 0">No mystery prizes yet — finish today\'s quiz to earn a Mystery Box! 🎁</p>';
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<p class="muted">Could not load rewards.</p>';
  }
}

/* ---------------- scores view (Progress) ---------------- */
function avgOfAttempts(arr) {
  let c = 0, t = 0;
  arr.forEach(function (a) { c += a.score; t += a.total; });
  return t ? Math.round((c / t) * 100) : null;
}

function renderScores(v) {
  paintScores(v, lsGet('scores'), null);
  if (cloudReady()) {
    const progP = sb.rpc('my_progress').then(function (r) {
      return (r.error || !r.data) ? null : r.data;
    }, function () { return null; });
    const frP = sb.from('profiles').select('streak_freezes').eq('user_id', state.user.id).maybeSingle().then(function (fr) {
      return (!fr.error && fr.data && fr.data.streak_freezes != null) ? fr.data.streak_freezes : null;
    }, function () { return null; });
    Promise.all([getAttempts(), progP, frP]).then(function (res) {
      if ((state.view !== 'scores' && state.view !== 'progress') || state.quiz) return;
      const prog = res[1];
      if (prog && res[2] != null) prog.streak_freezes = res[2];
      paintScores(v, res[0], prog);
    }).catch(function () { /* keep the local paint */ });
  }
}

function paintScores(v, arr, prog) {
  const avg = avgOfAttempts(arr);
  let html = '<h1 class="tut-anchor">Progress</h1>';
  html += progStatsHTML(prog);
  html += '<div class="section-title"><h2>🏅 My certificates</h2></div>' +
    '<div id="my-certs"><div class="empty">Loading certificates…</div></div>';
  html += rewardsPlaceholderHTML();
  html += '<div class="section-title"><h2>🎙️ Podcast summaries</h2></div>' +
    '<div id="sum-history"><div class="empty">Loading summaries…</div></div>';
  html += '<div class="section-title"><h2>🎤 Shadowing</h2></div>' +
    '<div id="sp-history"><div class="empty">Loading shadowing…</div></div>';
  if (avg === null) {
    html += '<div class="empty">No quiz attempts yet.<br>Finish a quiz and your scores will appear here.</div>';
  } else {
    html += '<div class="card avg-card"><div class="avg-num">' + avg + '%</div><div class="muted">overall average · ' + arr.length + ' attempts</div></div>';
    html += '<div class="section-title"><h2>📊 Analytics</h2>' +
      '<button class="btn btn-sm" data-action="ai-report-student">🤖 AI report</button></div>' +
      '<div id="score-analytics"><div class="empty">Loading analytics…</div></div>';
    html += arr.map(attemptCardHTML).join('');
  }
  v.innerHTML = html;
  refreshRewardsSection();
  loadMyCerts();
  loadScoreAnalytics();
  loadSummaryHistory();
  loadShadowingStats();
}

/* ---------------- Progress stats (merged 2026-10-09): the old #/progress
   dashboard's stat cards + 7-day XP chart, now in English on the Scores page. - */
var PG_WDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function pgWeekdayLabel(dayStr) {
  try {
    const d = new Date(dayStr + 'T12:00:00');
    return PG_WDAYS_EN[d.getDay()] || '';
  } catch (e) { return ''; }
}
function pgStatCard(ico, num, label) {
  return '<div class="pg-stat"><span class="pg-ico" aria-hidden="true">' + ico + '</span>' +
    '<b class="pg-num">' + num + '</b><span class="pg-lbl">' + label + '</span></div>';
}
function progStatsHTML(d) {
  if (!d || !d.ok) return '';
  const totalXP = Number(d.total_xp) || 0;
  let html = '<div class="pg-grid">' +
    pgStatCard('⚡', totalXP, 'Total XP') +
    pgStatCard('🔥', Number(d.current_streak) || 0, 'Current streak') +
    pgStatCard('🏆', Number(d.longest_streak) || 0, 'Best streak') +
    pgStatCard('📅', Number(d.active_days) || 0, 'Active days') +
    pgStatCard('⏱️', Number(d.total_minutes) || 0, 'Training minutes') +
    pgStatCard('📚', Number(d.saved_words) || 0, 'Saved words') +
    (d.streak_freezes != null ? pgStatCard('🧊', Number(d.streak_freezes) || 0, 'Streak freezes') : '') +
    '</div>';
  const week = Array.isArray(d.week) ? d.week : [];
  const maxXP = Math.max.apply(null, week.map(function (w) { return Number(w.xp) || 0; }).concat([1]));
  html += '<div class="section-title"><h2>📊 Last 7 days</h2></div>';
  if (!week.length || maxXP <= 1) {
    html += '<div class="card plain"><p class="muted" style="margin:0">No activity this week yet — start today! 💪</p></div>';
  } else {
    html += '<div class="card plain"><div class="pg-chart">' + week.map(function (w) {
      const xp = Number(w.xp) || 0;
      const h = Math.max(4, Math.round((xp / maxXP) * 90));
      return '<div class="pg-bar" title="' + esc(String(w.day)) + ': ' + xp + ' XP">' +
        '<div class="pg-fill" style="height:' + h + 'px"></div>' +
        '<div class="pg-xp">' + (xp > 0 ? xp : '') + '</div>' +
        '<div class="pg-d">' + pgWeekdayLabel(String(w.day)) + '</div></div>';
    }).join('') + '</div></div>';
  }
  if (totalXP > 0 && Number(d.active_days) > 0) {
    html += '<div class="card plain pg-note">Average <b>' + Math.round(totalXP / Number(d.active_days)) + ' XP</b> per active day — keep it up! 🔥</div>';
  }
  return html;
}
async function loadScoreAnalytics() {
  const host = document.getElementById('score-analytics');
  if (!host || !cloudReady() || !state.user) return;
  try {
    const pack = await buildStudentPack(state.user.id, false, '');
    if (!document.getElementById('score-analytics')) return;
    state._myPack = pack;
    let html = '';
    const pts = (pack.quizTrend || []).slice().reverse().map(function (x) {
      return { label: String(x.date || '').slice(5), pct: x.total ? Math.round((x.score / x.total) * 100) : 0 };
    });
    if (pts.length >= 2) {
      html += '<div class="card"><div class="an-title">📈 Score trend</div>' + trendChartHTML(pts.slice(-20)) + '</div>';
    }
    if ((pack.topicAccuracy || []).length) {
      html += '<div class="card"><div class="an-title">🎯 Accuracy by topic</div>' + topicBarsHTML(pack.topicAccuracy) + '</div>';
    }
    host.innerHTML = html || '<div class="empty">Do a few quizzes and homework — your analytics will appear here.</div>';
  } catch (e) { host.innerHTML = ''; }
}
/* Podcast summary history (Alireza, 2026-10-15): stat cards (count, spoken
   time, avg + best score) plus an expandable per-attempt mistake review,
   all from the summary_attempts ledger. */
async function loadSummaryHistory() {
  const host = document.getElementById('sum-history');
  if (!host) return;
  if (!cloudReady() || !state.user || !state.user.id || !sb) { host.innerHTML = ''; return; }
  let rows = [];
  try {
    const r = await sb.from('summary_attempts')
      .select('lesson_date,score,duration_sec,transcript,summary,corrections,pronunciation,strengths,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(50);
    if (!r.error) rows = r.data || [];
  } catch (e) { rows = []; }
  if (!document.getElementById('sum-history')) return;
  if (!rows.length) {
    host.innerHTML = '<div class="card plain"><p class="muted" style="margin:0">No summaries yet — record one from the podcast tab! 🎙️</p></div>';
    return;
  }
  const scores = rows.map(function (x) { return Number(x.score) || 0; });
  const totalSec = rows.reduce(function (s, x) { return s + (Number(x.duration_sec) || 0); }, 0);
  const avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
  const best = Math.max.apply(null, scores);
  const mmss = Math.floor(totalSec / 60) + ':' + String(totalSec % 60).padStart(2, '0');
  let html = '<div class="pg-grid">' +
    pgStatCard('🎙️', rows.length, 'Summaries') +
    pgStatCard('⏱️', mmss, 'Spoken') +
    pgStatCard('📊', avg, 'Avg score') +
    pgStatCard('🏆', best, 'Best score') +
    '</div>';
  html += '<div class="sum-hist">' + rows.slice(0, 20).map(function (x) {
    const d = String(x.lesson_date || String(x.created_at || '').slice(0, 10) || '');
    const cor = Array.isArray(x.corrections) ? x.corrections : [];
    const pro = Array.isArray(x.pronunciation) ? x.pronunciation : [];
    let det = '';
    if (x.transcript) det += '<p class="muted" style="font-size:.85rem"><i dir="auto">“' + esc(String(x.transcript).slice(0, 300)) + '”</i></p>';
    if (cor.length) det += '<h4 class="sum-h">🔧 Grammar (' + cor.length + ')</h4>' + cor.slice(0, 5).map(function (c) {
      return '<div class="sum-corr"><div class="sum-wrong">❌ ' + esc(c.wrong || '') + '</div>' +
        '<div class="sum-right">✅ ' + esc(c.right || '') + '</div></div>';
    }).join('');
    if (pro.length) det += '<h4 class="sum-h">🗣️ Pronunciation (' + pro.length + ')</h4>' + pro.slice(0, 5).map(function (p) {
      return '<div class="sum-corr"><div class="sum-wrong">🗣️ “' + esc(p.heard || '') + '” → <b>' + esc(p.likely || '') + '</b></div></div>';
    }).join('');
    if (!det) det = '<p class="muted" style="font-size:.85rem">No mistakes recorded — nice! ✨</p>';
    return '<details class="card sum-hist-item"><summary class="sum-hist-sum"><b>' + (Number(x.score) || 0) + '</b>' +
      '<span class="muted"> · ' + esc(d) + ' · ' + (Number(x.duration_sec) || 0) + 's' +
      (cor.length || pro.length ? ' · ' + (cor.length + pro.length) + ' mistakes' : ' · clean ✨') +
      '</span></summary><div class="sum-hist-det">' + det + '</div></details>';
  }).join('') + '</div>';
  host.innerHTML = html;
}
/* Shadowing stats (Alireza, 2026-10-15): attempts, distinct lessons, distinct
   sentences practiced and average score, from the shadowing_attempts ledger. */
async function loadShadowingStats() {
  const host = document.getElementById('sp-history');
  if (!host) return;
  if (!cloudReady() || !state.user || !state.user.id || !sb) { host.innerHTML = ''; return; }
  let rows = [];
  try {
    const r = await sb.from('shadowing_attempts')
      .select('lesson_date,transcript,score,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(500);
    if (!r.error) rows = r.data || [];
  } catch (e) { rows = []; }
  if (!document.getElementById('sp-history')) return;
  if (!rows.length) {
    host.innerHTML = '<div class="card plain"><p class="muted" style="margin:0">No shadowing yet — practice from the shadowing tab! 🎤</p></div>';
    return;
  }
  const lessons = {}, sents = {};
  let sum = 0;
  rows.forEach(function (x) {
    if (x.lesson_date) lessons[x.lesson_date] = 1;
    const mm = String(x.transcript || '').match(/^\[s(\d+)\]/);
    if (mm) sents[String(x.lesson_date || '') + '#s' + mm[1]] = 1;
    sum += Number(x.score) || 0;
  });
  const avg = Math.round(sum / rows.length);
  host.innerHTML = '<div class="pg-grid">' +
    pgStatCard('🎤', rows.length, 'Attempts') +
    pgStatCard('📚', Object.keys(lessons).length, 'Lessons') +
    pgStatCard('🔤', Object.keys(sents).length, 'Sentences') +
    pgStatCard('📊', avg + '%', 'Avg score') +
    '</div>';
}
async function aiReportStudent(btn) {
  try {
    const pack = state._myPack || await buildStudentPack(state.user.id, false, '');
    state._myPack = pack;
    requestAIReport('student', pack, btn);
  } catch (e) {
    requestAIReport('student', { note: 'no data' }, btn);
  }
}

/* ---------------- review view (mistakes) ---------------- */
function renderMistakes(v) {
  paintMistakes(v, lsGet('mistakes'));
  if (cloudReady()) {
    getMistakes().then(function (arr) {
      if (state.view === 'review' && !state.quiz) paintMistakes(v, arr);
    }).catch(function () { /* keep the local paint */ });
  }
}

function paintMistakes(v, arr) {
  let html = '<h1>Review</h1><div id="saved-words-sec"><div class="empty">Loading saved words…</div></div><div id="saved-sp-sec"></div>' +
    '<p class="muted">Words you missed, ready to practice again. Get one right and it leaves the list.</p>';
  if (!arr.length) {
    html += '<div class="empty">Nothing to review — nice work! 🎉</div>';
  } else {
    html += '<button class="review-banner" data-action="practice-again" aria-label="Practice your mistakes">' +
      '<span class="review-banner-count">' + arr.length + ' to review</span>' +
    '</button>';
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
  loadSavedWordsSection();
  loadSavedSpSection();
}

/* Bookmarked words block at the top of Review: list + practice quiz. */
async function loadSavedWordsSection() {
  const host = document.getElementById('saved-words-sec');
  if (!host) return;
  const arr = await getSavedWords();
  host.innerHTML = savedWordsHTML(arr);
}
function savedWordsHTML(arr) {
  if (!arr.length) return '';
  const practicable = arr.length >= 2;
  return '<div class="card"><div class="tch-weekly-title"><img src="/icons/bookmark.png" alt="" class="bm-ico"> Saved words <span class="muted">(' + arr.length + ')</span></div>' +
    '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0.6rem">Hard words you bookmarked — review them here, or run a practice quiz.</p>' +
    (practicable
      ? '<div style="margin:0 0 0.6rem"><button class="btn btn-sm" data-action="practice-saved">▶ Practice ' + arr.length + ' words</button></div>'
      : '<p class="muted" style="font-size:0.8rem">Bookmark at least 2 words to unlock the practice quiz.</p>') +
    arr.map(function (x) {
      return '<div class="saved-row">' +
        '<div class="saved-word"><b>' + esc(x.word) + '</b>' +
        (x.pronunciation ? '<span class="muted"> /' + esc(x.pronunciation) + '/</span>' : '') +
        (x.persian ? '<div dir="auto" style="font-size:0.85rem">' + esc(x.persian) + '</div>' : '') +
        (x.meaning ? '<div class="muted" style="font-size:0.82rem">' + esc(x.meaning) + '</div>' : '') +
        '<div class="muted" style="font-size:0.75rem">' + esc(x.lesson_date || '') + (x.level ? ' · ' + esc(String(x.level).toUpperCase()) : '') + '</div></div>' +
        '<div class="saved-actions">' +
        (x.word_audio ? '<button class="speaker-btn" data-action="play-track" data-src="' + esc(x.word_audio) + '" data-title="' + esc(x.word) + '" aria-label="Hear ' + esc(x.word) + '">🔊</button>' : '') +
        '<button class="save-word-btn saved" data-action="unsave-word" data-id="' + esc(x.id || '') + '" data-word="' + esc(x.word) + '" data-date="' + esc(x.lesson_date || '') + '" aria-label="Remove bookmark" title="Remove bookmark"><img src="/icons/bookmark.png" alt=""></button>' +
        '</div></div>';
    }).join('') + '</div>';
}
/* Bookmarked shadowing sentences (Alireza, 2026-10-15): sentences he wants
   to practice more, saved from the shadowing tab via the bookmark button.
   localStorage-only, mirrored on the word-bookmark pattern. Entry:
   { d: lesson date, i: sentence index, t: text, a: audio url }. */
var SP_SAVED_KEY = 'muse_sp_saved_v1';
function getSavedSpSentences() {
  try {
    const arr = JSON.parse(localStorage.getItem(SP_SAVED_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function setSavedSpSentences(arr) {
  try { localStorage.setItem(SP_SAVED_KEY, JSON.stringify(arr || [])); } catch (e) {}
}
function toggleSaveSpSentence(m, sentences, i) {
  const d = (m && m.date) || '';
  const arr = getSavedSpSentences();
  const k = arr.findIndex(function (x) { return x.d === d && x.i === i; });
  if (k !== -1) { arr.splice(k, 1); }
  else {
    const audio = (m.shadowing && m.shadowing.sentence_audio && m.shadowing.sentence_audio[i]) || '';
    arr.unshift({ d: d, i: i, t: (sentences && sentences[i]) || '', a: audio });
  }
  setSavedSpSentences(arr);
  refreshSpSaveButtons(d);
}
function removeSavedSp(date, i) {
  setSavedSpSentences(getSavedSpSentences().filter(function (x) {
    return !(x.d === date && String(x.i) === String(i));
  }));
}
/* Paint the saved state on the shadowing sentence cards (called after the
   list renders; mirrors refreshSavedWordButtons). */
function refreshSpSaveButtons(date) {
  try {
    const list = document.getElementById('sp-sentences');
    if (!list) return;
    const d = date || (state.lesson && state.lesson.date) || '';
    const saved = getSavedSpSentences();
    list.querySelectorAll('.sp-save').forEach(function (b) {
      const i = +b.getAttribute('data-i');
      b.classList.toggle('saved', saved.some(function (x) { return x.d === d && x.i === i; }));
    });
  } catch (e) {}
}
/* Saved-sentences block in Review: list with listen + remove. */
function loadSavedSpSection() {
  const host = document.getElementById('saved-sp-sec');
  if (!host) return;
  host.innerHTML = savedSpHTML(getSavedSpSentences());
}
function savedSpHTML(arr) {
  if (!arr.length) return '';
  return '<div class="card"><div class="tch-weekly-title"><img src="/icons/bookmark.png" alt="" class="bm-ico"> Saved shadowing sentences <span class="muted">(' + arr.length + ')</span></div>' +
    '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0.6rem">Sentences you saved for extra practice — tap 🔊 to hear, then say it aloud.</p>' +
    arr.map(function (x) {
      return '<div class="saved-sp-item"><div class="saved-sp-row">' +
        '<div class="saved-word"><div dir="auto">' + esc(x.t) + '</div>' +
        '<div class="muted" style="font-size:0.75rem">' + esc(x.d || '') + ' · sentence ' + (Number(x.i) + 1) + '</div></div>' +
        '<div class="saved-actions">' +
        (x.a
          ? '<button class="speaker-btn" data-action="play-track" data-src="' + esc(x.a) + '" data-title="Saved sentence" aria-label="Hear sentence">🔊</button>'
          : '<button class="speaker-btn" data-action="sp-say-saved" data-text="' + esc(x.t) + '" aria-label="Hear sentence">🔊</button>') +
        '<button class="sp-rec-btn" data-action="sp-practice-saved" data-d="' + esc(x.d || '') + '" data-i="' + x.i + '" data-t="' + esc(x.t) + '" aria-label="Record and practice this sentence" title="Practice aloud"><img src="/icons/sp-rec.png" alt=""></button>' +
        '<button class="save-word-btn saved" data-action="unsave-sp" data-date="' + esc(x.d || '') + '" data-i="' + x.i + '" aria-label="Remove bookmark" title="Remove bookmark"><img src="/icons/bookmark.png" alt=""></button>' +
        '</div></div><div class="sp-saved-result"></div></div>';
    }).join('') + '</div>';
}
/* Inline recording practice for a saved shadowing sentence (Review tab,
   Alireza 2026-10-15): record right here, get the score and word-level
   feedback. Mirrors the shadowing tab's flow — live speech recognition on
   Android/desktop, MediaRecorder -> Whisper on iOS; same scoring bands and
   the same first-attempt-only points rule (shared sp_p_<date> key). */
let savedSpActive = null;
function practiceSavedSentence(btn) {
  if (savedSpActive) {
    const wasBtn = savedSpActive.btn;
    stopSavedSpRec();
    if (wasBtn === btn) return;
  }
  const item = btn.closest('.saved-sp-item');
  if (!item) return;
  const target = btn.getAttribute('data-t') || '';
  const date = btn.getAttribute('data-d') || '';
  const i = parseInt(btn.getAttribute('data-i'), 10) || 0;
  if (!target) return;
  const resBox = item.querySelector('.sp-saved-result');
  if (!resBox) return;
  resBox.innerHTML = '';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const useServerSTT = isIOS && typeof window.MediaRecorder !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!SR && !useServerSTT) {
    resBox.innerHTML = '<div class="empty">🎤 Voice practice needs Chrome or Edge (Android or desktop).</div>';
    return;
  }
  const a = { btn: btn, resBox: resBox, target: target, date: date, i: i,
    saidFinal: '', lastInterim: '', timerId: null, recog: null, rec: null,
    stream: null, chunks: [], uploaded: false, done: false, left: 15 };
  savedSpActive = a;
  btn.classList.add('recording');
  resBox.innerHTML = '<div class="sp-sent-live"><span class="sp-pulse"></span>' +
    '<span class="sp-sent-live-text">🎤 Recording… speak now! (tap 🎤 to stop)</span></div>';
  if (useServerSTT) startSavedSpServer(a); else startSavedSpLive(a);
}
function stopSavedSpRec() {
  const a = savedSpActive;
  if (!a) return;
  savedSpActive = null;
  if (a.timerId) clearInterval(a.timerId);
  a.btn.classList.remove('recording');
  if (a.rec) {
    /* Server path: stopping the recorder fires onstop -> savedSpUpload. */
    try {
      if (a.rec.state !== 'inactive') a.rec.stop();
      else savedSpUpload(a);
    } catch (e) { savedSpUpload(a); }
    try { if (a.stream) a.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    return;
  }
  try { if (a.recog) a.recog.stop(); } catch (e) {}
  finishSavedSp(a, spCollapseRepeats(((a.saidFinal || '') + ' ' + (a.lastInterim || '')).trim()));
}
function startSavedSpLive(a) {
  const r = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  a.recog = r;
  r.lang = 'en-US';
  r.interimResults = true;
  r.continuous = true;
  const liveText = a.resBox.querySelector('.sp-sent-live-text');
  r.onresult = function (ev) {
    if (savedSpActive !== a) return;
    let interim = '';
    for (let k = ev.resultIndex; k < ev.results.length; k++) {
      const tr = ev.results[k][0].transcript;
      if (ev.results[k].isFinal) a.saidFinal = spAppendFinal(a.saidFinal, tr);
      else interim += tr;
    }
    a.lastInterim = interim;
    const t = (a.saidFinal + ' ' + interim).trim();
    if (liveText) liveText.textContent = '🎤 ' + (t || 'Listening…');
  };
  r.onerror = function (ev) {
    if (savedSpActive !== a) return;
    const err = (ev && ev.error) || 'unknown';
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      savedSpActive = null;
      a.btn.classList.remove('recording');
      a.resBox.innerHTML = '<div class="empty">🎤 Microphone blocked — allow microphone access and try again.</div>';
    }
  };
  r.onend = function () { if (savedSpActive === a) stopSavedSpRec(); };
  try { r.start(); }
  catch (e) {
    savedSpActive = null;
    a.btn.classList.remove('recording');
    a.resBox.innerHTML = '<div class="empty">🎤 Could not start recording. Try again.</div>';
    return;
  }
  a.timerId = setInterval(function () {
    if (savedSpActive !== a) return;
    a.left--;
    if (a.left <= 0) stopSavedSpRec();
  }, 1000);
}
function startSavedSpServer(a) {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    if (savedSpActive !== a) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      return;
    }
    a.stream = stream;
    let rec;
    try { rec = new MediaRecorder(stream); }
    catch (e) {
      savedSpActive = null;
      a.btn.classList.remove('recording');
      a.resBox.innerHTML = '<div class="empty">🎤 Could not start recording. Try again.</div>';
      return;
    }
    a.rec = rec;
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) a.chunks.push(ev.data); };
    rec.onstop = function () { savedSpUpload(a); };
    try { rec.start(250); } catch (e) {}
    a.timerId = setInterval(function () {
      if (savedSpActive !== a) return;
      a.left--;
      if (a.left <= 0) stopSavedSpRec();
    }, 1000);
  }).catch(function () {
    if (savedSpActive === a) {
      savedSpActive = null;
      a.btn.classList.remove('recording');
      a.resBox.innerHTML = '<div class="empty">🎤 Microphone blocked — allow microphone access and try again.</div>';
    }
  });
}
async function savedSpUpload(a) {
  if (a.uploaded) return;
  a.uploaded = true;
  if (a.timerId) clearInterval(a.timerId);
  try { if (a.stream) a.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  savedSpActive = null;
  a.btn.classList.remove('recording');
  const blob = new Blob(a.chunks, { type: (a.rec && a.rec.mimeType) || 'audio/mp4' });
  a.resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Transcribing…</div>';
  let text = '';
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'speech.mp4');
    const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (r.ok && j && j.text) text = String(j.text);
  } catch (e) {}
  if (!text.trim()) {
    a.resBox.innerHTML = '<div class="empty">🎤 We didn\'t catch any words. Try again.</div>';
    return;
  }
  finishSavedSp(a, spCollapseRepeats(text.trim()));
}
/* Score a saved-sentence attempt: same bands/points/ledger as the lesson tab. */
async function finishSavedSp(a, said) {
  if (a.done) return;
  a.done = true;
  const resBox = a.resBox;
  try {
    said = String(said || '').trim();
    if (!said) {
      resBox.innerHTML = '<div class="empty">🎤 We didn\'t catch any words. Try again.</div>';
      return;
    }
    resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Analyzing…</div>';
    const pKey = 'sp_p_' + (a.date || 'lesson');
    let scored = [];
    try { scored = JSON.parse(localStorage.getItem(pKey) || '[]'); } catch (e) { scored = []; }
    const prior = scored.indexOf(a.i) !== -1 ? 1 : 0;
    const scoring = prior === 0 ? SHADOW_SCORING_FIRST : SHADOW_SCORING;
    const an = analyzeSpeech(a.target, said, scoring);
    try { trackEvent('shadowing_attempt', { sentence: a.i + 1, score: an.accuracy, date: a.date || null, attempt: prior + 1, from: 'review' }); } catch (e) {}
    let pts = 0, awarded = false;
    if (an.accuracy >= scoring.greatAt) pts = 5;
    else if (an.accuracy >= scoring.okAt) pts = 3;
    else if (an.accuracy > 0) pts = 1;
    if (state.user && state.user.id && pts > 0 && prior === 0) {
      scored.push(a.i);
      try { localStorage.setItem(pKey, JSON.stringify(scored)); } catch (e) {}
      awardPoints('shadowing_speaking', pts, (a.date || 'lesson') + '#s' + a.i);
      awarded = true;
    }
    resBox.innerHTML = spSentResultHTML(an, said, awarded ? pts : 0);
    resBox.querySelectorAll('.sp-hear').forEach(function (b) {
      b.addEventListener('click', function () {
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(b.getAttribute('data-w'));
          u.lang = 'en-US'; u.rate = 0.85;
          speechSynthesis.speak(u);
        } catch (e) {}
      });
    });
    if (state.user && state.user.id && sb) {
      try {
        await sb.from('shadowing_attempts').insert({
          user_id: state.user.id,
          lesson_date: a.date || null,
          audio_path: '',
          transcript: ('[s' + (a.i + 1) + '] ' + said).slice(0, 2000),
          score: an.accuracy
        });
      } catch (e) { /* table optional */ }
    }
  } catch (e) {
    resBox.innerHTML = '<div class="empty">⚠️ Something went wrong. Try again.</div>';
  }
}
/* Practice quiz built from bookmarked words: Persian->English + listening,
   distractors drawn from the user's own saved pool. */
function buildSavedDeck(arr) {
  const deck = [];
  const words = arr.filter(function (x) { return x && x.word; });
  const distractors = function (word, n) {
    return shuffleArr(words.filter(function (x) { return x.word !== word; }))
      .slice(0, n).map(function (x) { return x.word; });
  };
  shuffleArr(words.slice()).forEach(function (x) {
    if (!x.persian) return;
    const opts = shuffleArr([x.word].concat(distractors(x.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'reverse', question: '«' + x.persian + '» به انگلیسی چی میشه؟', rtl: true,
      options: opts, answer: opts.indexOf(x.word), kind: 'saved', word: x.word
    });
  });
  shuffleArr(words.filter(function (x) { return x.word_audio; })).slice(0, 3).forEach(function (x) {
    const opts = shuffleArr([x.word].concat(distractors(x.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'listen', question: 'Which word did you hear?', audio: x.word_audio,
      persian: x.persian, options: opts, answer: opts.indexOf(x.word), kind: 'saved', word: x.word
    });
  });
  return shuffleArr(deck).slice(0, 14);
}

/* ---------------- admin view ---------------- */
/* ---------------- Daily study report (admin + teacher) ----------------
   Per-day, per-user: minutes in app, lessons opened, quizzes, XP, podcast
   minutes, shadowing speaking tries and shadowing sentence listens.
   `day` is the viewer's LOCAL calendar date. daily_stats rows are keyed by
   DB (UTC) date, so the stats columns match exactly except 20:00-24:00 local
   (that slice lands in the next UTC row); the shadowing tries/listens
   columns use exact local-day boundaries. */
function utcTodayStr() { return new Date().toISOString().slice(0, 10); }
function dayAfterStr(day) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function localDayRangeUTC(day) {
  const start = new Date(day + 'T00:00:00');
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
function addDaysStr(day, delta) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const p = function (x) { return String(x).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function rangeLabel(range) {
  return range === '7' ? 'last 7 days' : range === '30' ? 'last 30 days' : range === 'all' ? 'all time' : 'this day';
}
/* Range-aware study fetch. range: 'day' | '7' | '30' | 'all'.
   'day' keeps the exact single-day behavior (local-day shadowing window,
   UTC-keyed daily_stats row). '7'/'30' aggregate from (n-1) days ago through
   today; 'all' has no lower bound (rows only exist since registration). */
async function fetchStudyRange(range, day, userIds) {
  const scoped = function (q) { return (userIds && userIds.length) ? q.in('user_id', userIds) : q; };
  const statsById = {}, triesById = {}, listensById = {};
  let statsQ = scoped(sb.from('daily_stats').select('user_id,seconds_in_app,lessons_opened,quizzes_completed,xp_earned,podcast_seconds'));
  let triesQ = scoped(sb.from('shadowing_attempts').select('user_id'));
  let listensQ = scoped(sb.from('app_events').select('user_id').eq('event', 'shadowing_listen'));
  if (range === 'day') {
    const rg = localDayRangeUTC(day);
    statsQ = statsQ.eq('day', day).limit(2000);
    triesQ = triesQ.gte('created_at', rg.start).lt('created_at', rg.end).limit(5000);
    listensQ = listensQ.gte('created_at', rg.start).lt('created_at', rg.end).limit(5000);
  } else {
    if (range === '7' || range === '30') {
      const startDay = addDaysStr(day, -(parseInt(range, 10) - 1));
      statsQ = statsQ.gte('day', startDay);
      const startISO = localDayRangeUTC(startDay).start;
      triesQ = triesQ.gte('created_at', startISO);
      listensQ = listensQ.gte('created_at', startISO);
    }
    statsQ = statsQ.limit(10000);
    triesQ = triesQ.limit(10000);
    listensQ = listensQ.limit(10000);
  }
  const res = await Promise.all([statsQ, triesQ, listensQ]);
  (res[0].data || []).forEach(function (r) {
    const o = statsById[r.user_id] || (statsById[r.user_id] = { seconds_in_app: 0, lessons_opened: 0, quizzes_completed: 0, xp_earned: 0, podcast_seconds: 0 });
    o.seconds_in_app += Number(r.seconds_in_app) || 0;
    o.lessons_opened += Number(r.lessons_opened) || 0;
    o.quizzes_completed += Number(r.quizzes_completed) || 0;
    o.xp_earned += Number(r.xp_earned) || 0;
    o.podcast_seconds += Number(r.podcast_seconds) || 0;
  });
  (res[1].data || []).forEach(function (r) { triesById[r.user_id] = (triesById[r.user_id] || 0) + 1; });
  (res[2].data || []).forEach(function (r) { listensById[r.user_id] = (listensById[r.user_id] || 0) + 1; });
  return { statsById: statsById, triesById: triesById, listensById: listensById };
}
function dailyStudyShell(prefix, day, range, title) {
  const opts = [['day', 'Day'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']]
    .map(function (o) { return '<option value="' + o[0] + '"' + (range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  return '<div class="card"><div class="tch-weekly-title">' + title + '</div>' +
    '<div class="adm-filters" style="margin:0.6rem 0 0.2rem;align-items:center">' +
    '<label class="muted" style="font-size:0.85rem">Range <select id="' + prefix + '-daily-range">' + opts + '</select></label>' +
    '<label class="muted" id="' + prefix + '-daily-daywrap" style="font-size:0.85rem' + (range !== 'day' ? ';display:none' : '') + '">Day <input type="date" id="' + prefix + '-daily-day" value="' + esc(day) + '" max="' + todayStr() + '"></label>' +
    '<span class="muted" id="' + prefix + '-daily-sum" style="font-size:0.85rem"></span></div>' +
    '<div id="' + prefix + '-daily-body"><div class="empty">Loading…</div></div></div>';
}
function dailyStudyTableHTML(rows, emptyText) {
  if (!rows.length) return '<div class="empty">' + esc(emptyText || 'No study activity.') + '</div>';
  return '<div class="card tch-table-card" style="margin-top:0.5rem"><div class="tch-table daily-table">' +
    '<div class="tch-tr tch-th"><span>#</span><span>Student</span><span>⏱ min</span><span>📖</span>' +
    '<span>❓</span><span>⚡ XP</span><span>🎧 min</span><span>🎤</span><span>👂</span></div>' +
    rows.map(function (r, i) {
      return '<div class="tch-tr"><span class="muted">' + (i + 1) + '</span>' +
        '<span class="tch-name">' + esc(r.name) + (r.level ? '<small>' + esc(String(r.level).toUpperCase()) + '</small>' : '') + '</span>' +
        '<span><b>' + r.min + '</b></span><span>' + r.lessons + '</span><span>' + r.quizzes + '</span>' +
        '<span>' + r.xp + '</span><span>' + r.podMin + '</span><span>' + r.tries + '</span><span>' + r.listens + '</span></div>';
    }).join('') + '</div></div>';
}
function dailyStudyRow(id, f, name, level) {
  const s = f.statsById[id] || {};
  return {
    name: name, level: level,
    min: Math.round((Number(s.seconds_in_app) || 0) / 60),
    lessons: Number(s.lessons_opened) || 0,
    quizzes: Number(s.quizzes_completed) || 0,
    xp: Number(s.xp_earned) || 0,
    podMin: Math.round((Number(s.podcast_seconds) || 0) / 60),
    tries: f.triesById[id] || 0,
    listens: f.listensById[id] || 0
  };
}
function dailyStudyActive(r) { return r.min > 0 || r.lessons > 0 || r.tries > 0 || r.listens > 0; }
async function loadAdminDaily() {
  const host = document.getElementById('admin-daily');
  if (!host) return;
  const day = state.adminDailyDay || todayStr();
  const range = state.adminDailyRange || 'day';
  state.adminDailyDay = day;
  state.adminDailyRange = range;
  host.innerHTML = dailyStudyShell('adm', day, range, '📊 Daily study — who studied how much');
  const rangeSel = document.getElementById('adm-daily-range');
  if (rangeSel) rangeSel.addEventListener('change', function () {
    state.adminDailyRange = rangeSel.value; loadAdminDaily();
  });
  const dayInput = document.getElementById('adm-daily-day');
  if (dayInput) dayInput.addEventListener('change', function () {
    if (dayInput.value) { state.adminDailyDay = dayInput.value; loadAdminDaily(); }
  });
  const body = document.getElementById('adm-daily-body');
  const sum = document.getElementById('adm-daily-sum');
  try {
    const f = await fetchStudyRange(range, day, null);
    const nameOf = {};
    ((state.adminStats || {}).users || []).forEach(function (u) {
      nameOf[u.user_id] = { name: u.display_name || (u.email || '?').split('@')[0], level: u.level };
    });
    const idSet = {};
    [f.statsById, f.triesById, f.listensById].forEach(function (m) {
      Object.keys(m).forEach(function (id) { idSet[id] = 1; });
    });
    const ids = Object.keys(idSet);
    const missing = ids.filter(function (id) { return !nameOf[id]; }).slice(0, 500);
    if (missing.length) {
      const pr = await sb.from('profiles').select('id,display_name,level').in('id', missing);
      (pr.data || []).forEach(function (p) { nameOf[p.id] = { name: p.display_name || '?', level: p.level }; });
    }
    const rows = ids.map(function (id) {
      const nm = nameOf[id] || { name: 'User ' + String(id).slice(0, 6), level: '' };
      return dailyStudyRow(id, f, nm.name, nm.level);
    }).filter(dailyStudyActive);
    rows.sort(function (a, b) { return b.min - a.min; });
    const totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
    if (sum) sum.textContent = rows.length + ' active · ' + totalMin + ' total min · ' + rangeLabel(range);
    if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(range) + '.');
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
  }
}
async function loadTeacherDaily() {
  const host = document.getElementById('tch-daily');
  if (!host) return;
  const roster = state.teacherStudents || [];
  const day = state.teacherDailyDay || todayStr();
  const range = state.teacherDailyRange || 'day';
  state.teacherDailyDay = day;
  state.teacherDailyRange = range;
  host.innerHTML = dailyStudyShell('tch', day, range, '📅 Daily study — your students');
  const rangeSel = document.getElementById('tch-daily-range');
  if (rangeSel) rangeSel.addEventListener('change', function () {
    state.teacherDailyRange = rangeSel.value; loadTeacherDaily();
  });
  const dayInput = document.getElementById('tch-daily-day');
  if (dayInput) dayInput.addEventListener('change', function () {
    if (dayInput.value) { state.teacherDailyDay = dayInput.value; loadTeacherDaily(); }
  });
  const body = document.getElementById('tch-daily-body');
  const sum = document.getElementById('tch-daily-sum');
  if (!roster.length) { if (body) body.innerHTML = '<div class="empty">No students yet.</div>'; return; }
  try {
    const f = await fetchStudyRange(range, day, roster.map(function (s) { return s.user_id; }));
    const rows = roster.map(function (s) {
      return dailyStudyRow(s.user_id, f, s.display_name || '?', s.level);
    });
    rows.sort(function (a, b) { return b.min - a.min; });
    const active = rows.filter(dailyStudyActive).length;
    const totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
    if (sum) sum.textContent = active + ' / ' + rows.length + ' studied · ' + totalMin + ' total min · ' + rangeLabel(range);
    if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(range) + '.');
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
  }
}

function renderAdmin(v) {
  v.innerHTML = '<h1>Admin</h1>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>📊 Analytics</b> — everyone, everything.</p>' +
    '<div id="admin-analytics"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>📊 Daily study</b> — who studied how much, per day or range.</p>' +
    '<div id="admin-daily"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>🍎 Teachers</b> — requests, invite codes and manual add.</p>' +
    '<div id="admin-teachers"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>🤖 Telegram Bot</b> — @muse_eng_bot schedule & content.</p>' +
    '<div id="admin-bot"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0">Set each user\'s level. New users appear as <b>pending</b> first.</p></div>' +
    '<div id="admin-list"><div class="empty">Loading…</div></div>';
  loadAdminAnalytics().then(function () { loadAdminDaily(); });
  loadAdminUsers().then(function () { loadAdminTeachers(); loadAdminBot(); });
}

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'teacher';
}

/* ---------------- admin: telegram bot control (@muse_eng_bot) ---------------- */
async function loadAdminBot() {
  const host = document.getElementById('admin-bot');
  if (!host) return;
  let cfg = null;
  try {
    const r = await sb.from('bot_config').select('*').eq('id', 1).maybeSingle();
    if (r.error) throw r.error;
    cfg = r.data;
  } catch (e) { cfg = null; }
  if (!cfg) {
    host.innerHTML = '<p class="muted">Bot config table not found. Run <code>supabase-bot-config-migration.sql</code> in the Supabase SQL Editor first.</p>';
    return;
  }
  const lv = cfg.levels || [];
  const cb = function (id, label, isOn) {
    return '<label class="bot-check"><input type="checkbox" id="' + id + '"' + (isOn ? ' checked' : '') + '> ' + label + '</label>';
  };
  host.innerHTML =
    '<div class="bot-grid">' +
    '<label class="bot-row"><span>Bot enabled</span><input type="checkbox" id="bot-enabled" class="bot-switch"' + (cfg.enabled ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Posting hours (Tehran)</span><span class="bot-hours"><input type="number" id="bot-start" min="0" max="23" value="' + cfg.start_hour + '"> – <input type="number" id="bot-end" min="1" max="24" value="' + cfg.end_hour + '"></span></label>' +
    '<label class="bot-row"><span>Post every N hours</span><input type="number" id="bot-interval" min="1" max="12" value="' + cfg.interval_hours + '"></label>' +
    '<div class="bot-row"><span>Content</span><span class="bot-checks">' + cb('bot-words', '📇 Word cards', cfg.send_words) + cb('bot-quiz', '❓ Quizzes', cfg.send_quiz) + cb('bot-podcast', '🎧 Podcast', cfg.send_podcast) + cb('bot-shadowing', '🗣️ Shadowing', cfg.send_shadowing) + '</span></div>' +
    '<label class="bot-row"><span>Podcast every N posts</span><input type="number" id="bot-podevery" min="1" max="24" value="' + cfg.podcast_every + '"></label>' +
    '<label class="bot-row"><span>Shadowing every N posts</span><input type="number" id="bot-shevery" min="1" max="24" value="' + cfg.shadowing_every + '"></label>' +
    '<label class="bot-row"><span>📢 Promo banners</span><input type="checkbox" id="bot-promo" class="bot-switch"' + (cfg.send_promo ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Promo every N hours</span><input type="number" id="bot-promoevery" min="1" max="12" value="' + cfg.promo_every_hours + '"></label>' +
    '<label class="bot-row"><span>Quiz every N posts</span><input type="number" id="bot-quizevery" min="2" max="12" value="' + cfg.quiz_every + '"></label>' +
    '<div class="bot-row"><span>Word levels</span><span class="bot-checks">' +
      ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (l) { return cb('bot-lv-' + l, l.toUpperCase(), lv.indexOf(l) !== -1); }).join('') +
    '</span></div>' +
    '</div>' +
    '<div style="margin-top:0.7rem"><button class="btn btn-sm" data-action="bot-save">Save bot settings</button> ' +
    '<span class="muted" id="bot-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
    '<p class="muted" style="font-size:0.8rem;margin:0.6rem 0 0">Settings take effect on the next hourly bot run. Hours are Asia/Tehran. Promo banners (jpg/png/webp) go in <code>media/promo/</code> — a promo replaces the regular post in its slot.</p>' +
    '<div class="bot-chat-sec"><p style="margin:0.9rem 0 0.4rem"><b>💬 Per-chat settings</b> <span class="muted" style="font-size:0.85rem">— custom footer & pause per group/channel. Chats you never configure keep the global default footer.</span></p>' +
    '<div id="bot-chat-list"><div class="empty">Loading…</div></div></div>';
  loadAdminBotChats();
}

async function saveAdminBot(btn) {
  const status = document.getElementById('bot-status');
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const val = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
  const isOn = function (id) { const el = document.getElementById(id); return !!(el && el.checked); };
  const start = parseInt(val('bot-start'), 10), end = parseInt(val('bot-end'), 10);
  const interval = parseInt(val('bot-interval'), 10), qe = parseInt(val('bot-quizevery'), 10);
  const pe = parseInt(val('bot-promoevery'), 10);
  const pode = parseInt(val('bot-podevery'), 10), she = parseInt(val('bot-shevery'), 10);
  const levels = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].filter(function (l) { return isOn('bot-lv-' + l); });
  if (!(start >= 0 && start < 24 && end > 0 && end <= 24 && start < end)) { say('Start hour must be before end hour.', false); return; }
  if (!(interval >= 1 && interval <= 12)) { say('Interval must be 1–12.', false); return; }
  if (!(qe >= 2 && qe <= 12)) { say('Quiz-every must be 2–12.', false); return; }
  if (!(pe >= 1 && pe <= 12)) { say('Promo-every must be 1–12.', false); return; }
  if (!(pode >= 1 && pode <= 24) || !(she >= 1 && she <= 24)) { say('Podcast/Shadowing-every must be 1–24.', false); return; }
  if (!isOn('bot-words') && !isOn('bot-quiz') && !isOn('bot-podcast') && !isOn('bot-shadowing')) { say('Enable at least one content type.', false); return; }
  if (!levels.length) { say('Pick at least one level.', false); return; }
  if (btn) btn.disabled = true;
  say('Saving…', true);
  try {
    const r = await sb.from('bot_config').upsert({
      id: 1, enabled: isOn('bot-enabled'), start_hour: start, end_hour: end,
      interval_hours: interval, send_words: isOn('bot-words'), send_quiz: isOn('bot-quiz'),
      send_podcast: isOn('bot-podcast'), send_shadowing: isOn('bot-shadowing'),
      podcast_every: pode, shadowing_every: she,
      send_promo: isOn('bot-promo'), promo_every_hours: pe,
      quiz_every: qe, levels: levels, updated_at: new Date().toISOString()
    });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
  if (btn) btn.disabled = false;
}

/* ---------------- admin: telegram bot per-chat config ----------------
   Footer semantics (mirrors post.py):
   - no row / footer NULL  -> global default footer (legacy behavior)
   - footer '' (empty)     -> NO footer on that chat's posts
   - footer text set       -> custom footer for that chat            */
async function loadAdminBotChats() {
  const host = document.getElementById('bot-chat-list');
  if (!host) return;
  let rows;
  try {
    const r = await sb.from('bot_chat_config').select('chat_id,title,footer_text,paused').order('title');
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    host.innerHTML = '<p class="muted">Per-chat table not found. Run <code>supabase-bot-chat-config-migration.sql</code> in the Supabase SQL Editor first.</p>';
    return;
  }
  if (!rows.length) {
    host.innerHTML = '<p class="muted">No chats tracked yet — they appear here automatically after the next bot run.</p>';
    return;
  }
  host.innerHTML = rows.map(function (r) {
    const cid = String(r.chat_id);
    const ft = r.footer_text;
    const mode = (ft === null || ft === undefined) ? 'global' : (ft === '' ? 'none' : 'custom');
    return '<div class="bot-chat-row" data-chat="' + esc(cid) + '">' +
      '<div class="bot-chat-head"><b>' + esc(r.title || '(untitled)') + '</b> <code>' + esc(cid) + '</code>' +
      (r.paused ? ' <span style="background:#7C6AF0;color:#fff;border-radius:99px;padding:0.1rem 0.55rem;font-size:0.72rem">paused</span>' : '') + '</div>' +
      '<label class="bot-row"><span>Footer</span><select id="botmode-' + esc(cid) + '" data-chat="' + esc(cid) + '">' +
        '<option value="global"' + (mode === 'global' ? ' selected' : '') + '>Global default footer</option>' +
        '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom footer</option>' +
        '<option value="none"' + (mode === 'none' ? ' selected' : '') + '>No footer</option>' +
      '</select></label>' +
      '<textarea id="botft-' + esc(cid) + '" rows="2" style="' + (mode === 'custom' ? '' : 'display:none') + '" placeholder="Custom footer text for this chat…">' + esc(mode === 'custom' ? ft : '') + '</textarea>' +
      '<div class="bot-chat-actions"><label class="bot-check"><input type="checkbox" id="botpaused-' + esc(cid) + '"' + (r.paused ? ' checked' : '') + '> Pause this chat</label> ' +
      '<button class="btn btn-sm" data-action="bot-chat-save" data-chat="' + esc(cid) + '">Save this chat</button> ' +
      '<span class="muted bot-chat-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
      '</div>';
  }).join('');
  host.querySelectorAll('select[id^="botmode-"]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      const ta = document.getElementById('botft-' + sel.getAttribute('data-chat'));
      if (ta) ta.style.display = sel.value === 'custom' ? '' : 'none';
    });
  });
}

async function saveAdminBotChat(btn) {
  const cid = btn.getAttribute('data-chat');
  const row = btn.closest('.bot-chat-row');
  const status = row ? row.querySelector('.bot-chat-status') : null;
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const modeEl = document.getElementById('botmode-' + cid);
  const ta = document.getElementById('botft-' + cid);
  const pa = document.getElementById('botpaused-' + cid);
  const mode = modeEl ? modeEl.value : 'global';
  const paused = !!(pa && pa.checked);
  let footer_text = null; // global default
  if (mode === 'custom') {
    footer_text = ta ? ta.value.trim() : '';
    if (!footer_text) { say('Custom footer is empty — pick Global default or No footer instead.', false); return; }
  } else if (mode === 'none') {
    footer_text = ''; // explicit: no footer on this chat's posts
  }
  say('Saving…', true);
  try {
    const r = await sb.from('bot_chat_config').upsert(
      { chat_id: cid, footer_text: footer_text, paused: paused, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
    loadAdminBotChats();
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
}

async function loadAdminTeachers() {
  const host = document.getElementById('admin-teachers');
  if (!host) return;
  try {
    const t = await sb.from('teachers').select('id,user_id,ref_code,display_name,status,requested_at').order('requested_at', { ascending: true });
    if (t.error) throw t.error;
    const teachers = t.data || [];
    const ids = teachers.map(function (x) { return x.user_id; });
    let emailById = {};
    if (ids.length) {
      const p = await sb.from('profiles').select('id,email').in('id', ids);
      (p.data || []).forEach(function (x) { emailById[x.id] = x.email; });
    }
    // student counts from the already-loaded admin users
    const counts = {};
    (state.adminUsers || []).forEach(function (u) {
      if (u.referred_by) counts[u.referred_by] = (counts[u.referred_by] || 0) + 1;
    });
    const pending = teachers.filter(function (x) { return x.status === 'pending'; });
    const active = teachers.filter(function (x) { return x.status === 'approved'; });
    const rejected = teachers.filter(function (x) { return x.status === 'rejected'; });
    host.innerHTML =
      (pending.length ? '<p class="muted" style="margin:0 0 0.5rem"><b>⏳ Pending requests (' + pending.length + ')</b></p>' +
        pending.map(function (x) {
          const sug = slugify(x.display_name);
          return '<div class="tch-admin-row"><div><b>' + esc(x.display_name) + '</b><br>' +
            '<span class="muted" style="font-size:0.8rem">' + esc(emailById[x.user_id] || '') + ' · ' + esc(String(x.requested_at || '').slice(0, 10)) + '</span></div>' +
            '<div class="tch-admin-actions"><input class="tch-code-input" id="tcode-' + x.id + '" value="' + esc(sug) + '" maxlength="32" aria-label="Invite code">' +
            '<button class="btn btn-sm" data-action="approve-teacher" data-id="' + x.id + '">Approve</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="reject-teacher" data-id="' + x.id + '">Reject</button></div></div>';
        }).join('') : '<p class="muted">No pending requests.</p>') +
      (active.length ? '<p class="muted" style="margin:1rem 0 0.5rem"><b>✓ Active teachers (' + active.length + ')</b></p>' +
        active.map(function (x) {
          return '<div class="tch-admin-row"><div><b>' + esc(x.display_name) + '</b><br>' +
            '<span class="muted" style="font-size:0.8rem"><code>' + esc(x.ref_code) + '</code> · ' + (counts[x.ref_code] || 0) + ' students</span></div>' +
            '<div class="tch-admin-actions"><button class="btn btn-ghost btn-sm" data-action="reject-teacher" data-id="' + x.id + '">Remove</button></div></div>';
        }).join('') : '') +
      (rejected.length ? '<p class="muted" style="margin:1rem 0 0.5rem">Rejected (' + rejected.length + ')</p>' : '') +
      '<p class="muted" style="margin:1.2rem 0 0.5rem"><b>Add teacher manually</b> (they must already have an account)</p>' +
      '<form id="form-teacher-add" class="tch-add-form">' +
        '<input id="ta-email" type="email" placeholder="teacher@email.com" required aria-label="Email">' +
        '<input id="ta-name" type="text" placeholder="Display name" maxlength="40" required aria-label="Display name">' +
        '<input id="ta-code" type="text" placeholder="invite-code" maxlength="32" required aria-label="Invite code">' +
        '<button class="btn btn-sm" type="submit">Add</button></form>' +
      '<div class="form-error" id="ta-error" role="alert"></div>';
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load teachers: ' + esc(e.message || e) + '</div>';
  }
}

async function adminApproveTeacher(id) {
  const input = document.getElementById('tcode-' + id);
  const code = slugify(input ? input.value : '');
  try {
    const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'approved', p_ref_code: code });
    if (r.error) throw r.error;
    loadAdminTeachers();
  } catch (e) {
    alert('Approve failed: ' + (e.message || e));
  }
}
async function adminRejectTeacher(id) {
  if (!window.confirm('Remove / reject this teacher? Their students keep their accounts.')) return;
  try {
    const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'rejected', p_ref_code: '' });
    if (r.error) throw r.error;
    loadAdminTeachers();
  } catch (e) {
    alert('Failed: ' + (e.message || e));
  }
}
async function adminAddTeacher() {
  const errEl = document.getElementById('ta-error');
  const email = (document.getElementById('ta-email').value || '').trim();
  const name = (document.getElementById('ta-name').value || '').trim();
  const code = slugify((document.getElementById('ta-code').value || '').trim());
  if (errEl) errEl.textContent = '';
  if (!email || name.length < 2 || !code) { if (errEl) errEl.textContent = 'Fill all three fields.'; return; }
  try {
    const r = await sb.rpc('admin_create_teacher', { p_email: email, p_display_name: name, p_ref_code: code });
    if (r.error) throw r.error;
    document.getElementById('form-teacher-add').reset();
    loadAdminTeachers();
  } catch (e) {
    if (errEl) errEl.textContent = 'Failed: ' + (e.message || e);
  }
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
    else if (a === 'tut-replay') startTutorial();
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
    else if (a === 'duo-opt') duoAnswer(parseInt(t.getAttribute('data-idx'), 10));
    else if (a === 'duo-next') duoNext();
    else if (a === 'duo-pick') duoPick(parseInt(t.getAttribute('data-bi'), 10));
    else if (a === 'duo-unpick') duoUnpick(parseInt(t.getAttribute('data-bi'), 10));
    else if (a === 'duo-check') duoCheck();
    else if (a === 'duo-typein-check') duoTypeinCheck();
    else if (a === 'duo-exit') duoExit();
    else if (a === 'duo-quit') duoQuit();
    else if (a === 'duo-keep') duoKeep();
    else if (a === 'duo-earn-heart') {
      /* wait for the just-saved mistake (max ~5s), then open the review quiz.
         An in-progress quiz is stashed so the student can resume it exactly
         where they left off after the review (Fix 2: word/grammar too). */
      t.disabled = true;
      if (state.quiz && (state.quiz.kind === 'assignment' || state.quiz.kind === 'word' || state.quiz.kind === 'grammar')) {
        state.pausedQuiz = state.quiz;
        saveProgressAny();
      }
      var waitSave = duoSavePending.catch(function () {});
      var timeout = new Promise(function (res) { setTimeout(res, 5000); });
      Promise.race([waitSave, timeout]).then(function () { return getMistakes(); }).then(function (arr) {
        if (arr.length) {
          state.quiz = null;
          document.body.classList.remove('duo-playing');
          startQuiz('mistakes');
        } else {
          t.disabled = false;
          var note = document.getElementById('duo-earn-note');
          if (note) {
            note.textContent = 'No mistakes to review yet — hearts refill tomorrow! 🌅';
            note.style.display = 'block';
          }
        }
      });
    }
    else if (a === 'duo-buy-hearts') { buyHearts(t); }
    else if (a === 'resume-paused') {
      const pq = state.pausedQuiz;
      state.pausedQuiz = null;
      if (pq && (pq.kind === 'assignment' || pq.kind === 'word' || pq.kind === 'grammar' || pq.kind === 'saved')) {
        /* the heart-killing question was answered wrong — let them retry it fresh.
           Hearts earned in review apply: keep the better of saved/current (Fix 2). */
        if (pq.log && pq.log.length > pq.idx) pq.log.pop();
        pq.answered = false; pq.picked = -1; pq.wasCorrect = false;
        pq.hearts = Math.max(pq.hearts || 0, getHearts());
        state.quiz = pq;
        document.body.classList.add('duo-playing');
        saveProgressAny();
        renderDuoQuizView();
      } else { go('home'); }
    }
    else if (a === 'practice-again') {
      getMistakes().then(function (arr) {
        if (arr.length) startQuiz('mistakes');
        else go('review');
      });
    }
    else if (a === 'practice-saved') {
      getSavedWords().then(function (arr) {
        if (arr.length >= 2) startQuiz('saved');
        else go('review');
      });
    }
    else if (a === 'toggle-save-word') { toggleSaveWordBtn(t); }
    else if (a === 'unsave-word') {
      removeSavedWord(t.getAttribute('data-id'), t.getAttribute('data-word'), t.getAttribute('data-date')).then(function () {
        if (state.view === 'review') renderMistakes($('#view'));
        else if (state.view === 'lesson' && state.lessonTab === 'words') renderLessonTab($('#lesson-body'));
      });
    }
    else if (a === 'unsave-sp') {
      removeSavedSp(t.getAttribute('data-date'), t.getAttribute('data-i'));
      if (state.view === 'review') renderMistakes($('#view'));
    }
    else if (a === 'sp-say-saved') {
      /* TTS fallback for saved sentences from lessons without per-sentence
         audio (same fallback the shadowing tab itself uses). */
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(t.getAttribute('data-text') || '');
        u.lang = 'en-US'; u.rate = 0.9;
        speechSynthesis.speak(u);
      } catch (e) {}
    }
    else if (a === 'sp-practice-saved') { practiceSavedSentence(t); }
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
    else if (a === 'copy-teacher-link') copyTeacherLink(t);
    else if (a === 'copy-ptest-link') copyPlacementLink();
    else if (a === 'ptest-detail') openPlacementDetail(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'ptest-detail-close') { const pd = document.getElementById('tch-ptest-detail'); if (pd) pd.innerHTML = ''; }
    else if (a === 'teacher-student') openTeacherStudent(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'teacher-student-close') { const d = document.getElementById('tch-detail'); if (d) d.innerHTML = ''; }
    else if (a === 'teacher-set-level') teacherSetLevel(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-cert-issue') teacherIssueCert(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-remove-student') teacherRemoveStudent(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-cert-revoke') teacherRevokeCert(t.getAttribute('data-code'), parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'cert-print') printCertificate();
    else if (a === 'cert-share') shareCertificate(t.getAttribute('data-code'), t);
    else if (a === 'vc-say') playVocabAudio(t.getAttribute('data-audio'));
    else if (a === 'teacher-nudge') teacherNudge(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-sent') toggleTeacherSent(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-message') teacherMessageComposer(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'assignment-compose') teacherAssignmentComposer();
    else if (a === 'tw-logout') twLogout();
    else if (a === 'assignment-create') createAssignment(t);
    else if (a === 'planner-save') savePlanner(t);
    else if (a === 'ai-report-student') aiReportStudent(t);
    else if (a === 'ai-report-tstudent') aiReportTeacherStudent(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'ai-report-class') aiReportClass(t);
    else if (a === 'an-wrong') {
      const w = document.getElementById('an-w-' + t.getAttribute('data-i') + '-' + t.getAttribute('data-k'));
      if (w) w.classList.toggle('hidden');
    }
    else if (a === 'assignment-open') openTeacherAssignment(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'sum-record') toggleSummaryRecording();
    else if (a === 'as-toggle') {
      const uid = t.getAttribute('data-uid');
      state._asCollapsed = state._asCollapsed || {};
      state._asCollapsed[uid] = !state._asCollapsed[uid];
      loadTeacherAssignments();
    }
    else if (a === 'assignment-cancel') cancelScheduledAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'assignment-delete') deleteTeacherAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'assignment-start') startAssignment(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'inbox-open') { closeModal(); go('inbox'); }
    else if (a === 'inbox-retry') { renderInbox(document.getElementById('view')); }
    else if (a === 'bot-save') { saveAdminBot(t); }
    else if (a === 'bot-chat-save') { saveAdminBotChat(t); }
    else if (a === 'google-signin') signInWithGoogle(t.getAttribute('data-prefix'), t);
    else if (a === 'approve-teacher') adminApproveTeacher(t.getAttribute('data-id'));
    else if (a === 'reject-teacher') adminRejectTeacher(t.getAttribute('data-id'));
    else if (a === 'adm-metric') { state.adminMetric = t.getAttribute('data-m'); renderAdminAnalytics(); }
    else if (a === 'adm-user') openAdminUser(t.getAttribute('data-id'));
    else if (a === 'adm-teacher-view') {
      const ref = t.getAttribute('data-ref');
      sb.from('teachers').select('user_id').eq('ref_code', ref).maybeSingle().then(function (r) {
        if (r.data && r.data.user_id) go('admin-teacher', r.data.user_id);
      });
    }
    else if (a === 'adm-user-close') { const d = document.getElementById('adm-detail'); if (d) d.innerHTML = ''; }
  });

  $('#view').addEventListener('change', function (e) {
    const t = e.target.closest('[data-user-id]');
    if (t) setUserLevel(t.getAttribute('data-user-id'), t.value);
  });

  $('#view').addEventListener('submit', function (e) {
    if (e.target.id === 'form-signin') { e.preventDefault(); doLogin(); }
    else if (e.target.id === 'form-signup') { e.preventDefault(); doSignup(); }
    else if (e.target.id === 'form-teacher-add') { e.preventDefault(); adminAddTeacher(); }
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


  // Modal popups live on document.body (outside #view), so they need their own handler.
  document.addEventListener('click', function (e) {
    const t = e.target.closest('#app-modal [data-action]');
    if (!t) return;
    const ma = t.getAttribute('data-action');
    if (ma === 'modal-close') closeModal();
    else if (ma === 'welcome-tour') { closeModal(); startTutorial(); }
    else if (ma === 'teacher-message-send') teacherMessageSend(parseInt(t.getAttribute('data-i'), 10), t);
    else if (ma === 'assignment-create') createAssignment(t);
    else if (ma === 'assignment-cancel') cancelScheduledAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (ma === 'assignment-delete') deleteTeacherAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (ma === 'inbox-open') { closeModal(); go('inbox'); }
  });
  // Tutorial overlay buttons live on document.body too, but they wire their
  // own listeners in startTutorial() (the dim advances on tap).
  $('#mp-toggle').addEventListener('click', function () {
    if (!player.src) return;
    if (player.el.paused) player.el.play().catch(function () {});
    else player.el.pause();
  });
  $('#mp-close').addEventListener('click', function () { closePlayer(); });
  const mpProg = $('#mp-progress');
  if (mpProg) {
    mpProg.addEventListener('click', seekFromEvent);
    mpProg.addEventListener('keydown', function (e) {
      const dur = player.el.duration;
      if (!dur || !isFinite(dur)) return;
      if (e.key === 'ArrowRight') { player.el.currentTime = Math.min(dur, player.el.currentTime + 10); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { player.el.currentTime = Math.max(0, player.el.currentTime - 10); e.preventDefault(); }
      refreshTrackCards();
    });
  }

  window.addEventListener('hashchange', onRoute);
}

/* ---------------- init ---------------- */
/* Auto-refresh on new deploy (2026-10-09): APP_VERSION is baked into this bundle
   at push time. If the server's version.json is newer, reload once so the user
   never keeps running a stale cached bundle. Skipped mid-quiz. */
var APP_VERSION = '202610251922';
function checkAppVersion() {
  try {
    if (!APP_VERSION || APP_VERSION === '__APP_VERSION__') return;
    if (state.quiz) return;
    fetch('/version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.v && j.v !== APP_VERSION) {
        let seen = null;
        try { seen = sessionStorage.getItem('appv_seen'); } catch (e) {}
        if (seen !== j.v) {
          try { sessionStorage.setItem('appv_seen', j.v); } catch (e) {}
          window.location.reload();
        }
      }
    }).catch(function () {});
  } catch (e) {}
}

async function init() {
  initAudio();
  bindEvents();
  checkAppVersion();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkAppVersion();
  });
  initPwaPrompt();
  initHeartbeat();
  initSupabase();
  initOneSignal();
  syncPushState();
  playerUI();
  /* The splash stays until the first content is on screen (min ~900ms so it
     still reads as a splash); the 6s inline fallback remains as a backstop. */
  window._splashAt = Date.now();
  window._appReady = false;

  /* Teacher portal: own path, own gate, own chrome — never the learner boot. */
  if (isTeachersPath()) { renderTeachers(); hideSplashSoon(); return; }

  if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session && data.session.user) {
        /* Panel path skips the heavy learner boot — it has its own gate. */
        if (isPanelPath()) { renderAdminPanel(); hideSplashSoon(); return; }
        await enterApp(); return;
      }
    } catch (e) {}
  }
  /* Panel path without a session: the panel renders its own login screen. */
  if (isPanelPath()) { renderAdminPanel(); hideSplashSoon(); return; }
  // Logged out: respect the hash (deep links to #/signin etc.), default landing.
  onRoute();
  hideSplashSoon();
}

/* Hide the splash once the first paint happened. */
function hideSplashSoon() {
  window._appReady = true;
  const elapsed = Date.now() - (window._splashAt || Date.now());
  setTimeout(hideSplash, Math.max(0, 900 - elapsed));
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s || s.classList.contains('hide')) return;
  s.classList.add('hide');
  setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 600);
}

/* ==================== Teacher portal (/teachers) — v2 redesign ====================
   Warm editorial design per supplied mockups (2026-10-17): cream background,
   Lora serif display headings, orange primary buttons, pill statuses.
   Same Supabase session as the learner app: teachers log in with their
   normal account; an approved `teachers` row unlocks the workspace.
   Learner chrome is hidden via body.tw-mode. */
function isTeachersPath() { return /^\/teachers(\/|$)/.test(window.location.pathname); }

var TW_SECTIONS = [
  ['overview', '📊', 'Overview'],
  ['students', '👥', 'Students'],
  ['daily', '📅', 'Daily study'],
  ['assignments', '✈️', 'Assignments'],
  ['placement', '📝', 'Placement tests'],
  ['links', '🔗', 'Invite & links']
];

var TW_LEVEL_LABEL = { a1: 'Beginner', a2: 'Elementary', b1: 'Intermediate', b2: 'Upper-Intermediate', c1: 'Advanced', c2: 'Proficient' };
function twLevelLabel(l) {
  l = String(l || '').toLowerCase();
  return (l ? l.toUpperCase() : '—') + (TW_LEVEL_LABEL[l] ? ' · ' + TW_LEVEL_LABEL[l] : '');
}
/* Deterministic pastel avatar palette (bg, fg). */
var TW_AV = [
  ['#FDE3E3', '#D34F4F'], ['#E7E4FB', '#6C5CE7'], ['#DDF0FB', '#1D7FBF'],
  ['#E4F5DB', '#4C9A2A'], ['#FFF0D6', '#C77F0A'], ['#E6F4F0', '#1F9D74']
];
function twAvatar(name, cls) {
  var n = String(name || '?');
  var h = 0, i;
  for (i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
  var c = TW_AV[h % TW_AV.length];
  return '<span class="tw-av ' + (cls || '') + '" style="background:' + c[0] + ';color:' + c[1] + '">' +
    esc(n.trim().charAt(0).toUpperCase() || '?') + '</span>';
}
function twDaysSince(d) {
  if (!d) return null;
  var t = new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
function twAgo(d) {
  var n = twDaysSince(d);
  if (n === null) return 'never';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return n + ' days ago';
}
function twDate(d) { return String(d || '').slice(0, 10) || '—'; }
function twRing(pct, sz) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  sz = sz || 64;
  var r = (sz - 8) / 2, circ = 2 * Math.PI * r;
  var col = pct >= 80 ? '#4C9A2A' : (pct >= 50 ? '#58B368' : '#F0A030');
  return '<span class="tw-ring" style="width:' + sz + 'px;height:' + sz + 'px">' +
    '<svg viewBox="0 0 ' + sz + ' ' + sz + '">' +
    '<circle cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" fill="none" stroke="#EDE7DB" stroke-width="7"/>' +
    '<circle cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="7" ' +
    'stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + (circ * (1 - pct / 100)).toFixed(1) + '" ' +
    'transform="rotate(-90 ' + sz / 2 + ' ' + sz / 2 + ')"/></svg>' +
    '<b>' + pct + '%</b></span>';
}
function twCopy(text, btn) {
  var done = function () {
    if (!btn) return;
    var o = btn.innerHTML;
    btn.innerHTML = '✓ Copied';
    setTimeout(function () { btn.innerHTML = o; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallback(); });
  } else fallback();
  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    } catch (e) {}
    done();
  }
}
/* Warm decorative header illustration (books + mug + plant), abstract SVG. */
function twDeco() {
  return '<div class="tw-deco" aria-hidden="true">' +
    '<svg viewBox="0 0 320 150">' +
    '<ellipse cx="200" cy="70" rx="120" ry="62" fill="#FBEEDF"/>' +
    '<ellipse cx="235" cy="45" rx="46" ry="30" fill="#FDF6EC"/>' +
    '<circle cx="120" cy="40" r="7" fill="#F6DFC2"/><circle cx="140" cy="24" r="5" fill="#F9E8D2"/>' +
    '<g><rect x="150" y="92" width="110" height="16" rx="3" fill="#5E8F5A"/>' +
    '<rect x="150" y="92" width="110" height="5" rx="2" fill="#6FA06B"/>' +
    '<rect x="158" y="76" width="96" height="16" rx="3" fill="#E8935A"/>' +
    '<rect x="158" y="76" width="96" height="5" rx="2" fill="#F0A468"/></g>' +
    '<g><rect x="196" y="44" width="34" height="32" rx="5" fill="#FFFFFF" stroke="#EAD9C2"/>' +
    '<path d="M230 50 h10 a4 4 0 0 1 0 16 h-10" fill="none" stroke="#EAD9C2" stroke-width="4"/>' +
    '<circle cx="213" cy="60" r="7" fill="#E2574C"/></g>' +
    '<g stroke="#5E8F5A" stroke-width="5" stroke-linecap="round" fill="none">' +
    '<path d="M282 96 C 282 70, 280 50, 272 30"/><path d="M282 96 C 284 72, 290 54, 300 40"/>' +
    '<path d="M282 96 C 280 78, 274 66, 264 58"/></g>' +
    '<g fill="#6FA06B"><ellipse cx="268" cy="28" rx="13" ry="7" transform="rotate(-35 268 28)"/>' +
    '<ellipse cx="302" cy="38" rx="13" ry="7" transform="rotate(30 302 38)"/>' +
    '<ellipse cx="261" cy="56" rx="11" ry="6" transform="rotate(-25 261 56)"/></g>' +
    '<path d="M268 96 h28 l-5 22 h-18 z" fill="#F3E4CE"/>' +
    '</svg></div>';
}
/* Dotted paper-plane flourish for bottom banners. */
function twPlane() {
  return '<svg class="tw-plane" viewBox="0 0 220 60" aria-hidden="true">' +
    '<path d="M8 44 C 60 44, 90 40, 120 26 S 170 10, 196 12" fill="none" stroke="#E8B96A" ' +
    'stroke-width="2.5" stroke-dasharray="1 9" stroke-linecap="round"/>' +
    '<circle cx="8" cy="44" r="4.5" fill="#E8B96A"/>' +
    '<g transform="translate(186,2) rotate(18)"><path d="M0 0 L34 10 L0 22 L7 11 Z" fill="#F0854C"/></g>' +
    '</svg>';
}
function twPageHead(eyebrow, title, sub) {
  return '<div class="tw-phead"><div><div class="tw-eyebrow">' + eyebrow + '</div>' +
    '<h1 class="tw-title">' + title + '</h1>' +
    (sub ? '<p class="tw-sub">' + sub + '</p>' : '') + '</div>' + twDeco() + '</div>';
}

/* ---------------- portal gate ---------------- */

async function renderTeachers() {
  document.body.classList.add('tw-mode');
  document.body.classList.remove('ap-mode');
  /* Hide the static marketing landing in index.html (same mechanism the app uses). */
  document.documentElement.classList.add('app-mode');
  var v = document.getElementById('view');
  v.innerHTML = '<div class="tw-loading"><div class="tw-spin"></div><p class="muted">Loading…</p></div>';
  var user = null;
  try {
    if (sb) { var r = await sb.auth.getUser(); user = (r.data && r.data.user) || null; }
  } catch (e) {}
  if (!user) { v.innerHTML = twLandingHTML(false); twWireLanding(); return; }
  var adminEmails = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.ADMIN_EMAILS) || [];
  state.user = { id: user.id, email: user.email, demo: false, displayName: null,
    isAdmin: adminEmails.indexOf((user.email || '').toLowerCase()) !== -1 };
  try {
    var p = await sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    if (p.data && p.data.display_name) state.user.displayName = p.data.display_name;
  } catch (e) {}
  await loadTeacherStatus();
  if (state.teacher || state.user.isAdmin) { twRenderWorkspace(v); return; }
  if (state.teacherRequest) {
    v.innerHTML = '<div class="tw-narrow">' +
      '<div class="tw-brandrow">🍎 <b>Muse English</b><span>for Teachers</span></div>' +
      '<div class="card tw-card"><h2 class="tw-title-sm">⏳ Request under review</h2>' +
      '<p class="muted">Thanks for applying! We approve teachers manually — usually within a day. We will email you at <b>' + esc(user.email || '') + '</b> once you are in.</p>' +
      '<button class="btn btn-ghost" data-action="tw-logout">Log out</button></div></div>';
    return;
  }
  v.innerHTML = twLandingHTML(true);
  twWireLanding();
  var host = document.getElementById('tw-apply');
  if (host) {
    renderBecomeTeacher(host);
    var back = host.querySelector('a[href="#/profile"]');
    if (back) { back.setAttribute('href', '#tw-apply'); back.textContent = '← Back'; }
  }
}

function twLandingHTML(loggedIn) {
  var feats = [
    ['📝', 'Placement test link', 'Send new students a 5-part test — vocabulary, listening, grammar, writing, speaking. Results land in your dashboard with a suggested level.'],
    ['📊', 'Student activity', 'Streaks, XP, lessons completed and 14-day history for every student — updated automatically, no spreadsheets.'],
    ['✈️', 'Assignments', 'Build quizzes from any topic and schedule them across the week. They come back graded, per student and per question.'],
    ['🔗', 'Invite links', 'One link connects students to you. Everyone who signs up through it shows up on your roster.']
  ];
  var steps = [
    ['1', 'Request access', 'Log in with your Muse English account and apply in one click. We approve teachers manually.'],
    ['2', 'Share your link', 'Send your invite link — or the placement-test link — to your students.'],
    ['3', 'Track & teach', 'Watch progress, nudge quiet students, and assign work from your dashboard.']
  ];
  return '<div class="tw-land">' +
    '<header class="tw-top"><div class="tw-top-in">' +
      '<div class="tw-brandrow">🍎 <b>Muse English</b><span>for Teachers</span></div>' +
      '<nav class="tw-toplinks"><a href="#tw-features">Features</a><a href="#tw-how">How it works</a>' +
      (loggedIn ? '<a class="tw-btn tw-btn-sm" href="#tw-apply">Request access</a>' : '<a class="tw-btn tw-btn-sm" href="#tw-login">Log in</a>') +
      '</nav></div></header>' +
    '<section class="tw-hero"><div class="tw-hero-in">' +
      '<div class="tw-eyebrow">FOR ENGLISH TEACHERS</div>' +
      '<h1 class="tw-title">Your students, their progress,<br>one dashboard.</h1>' +
      '<p class="tw-sub">Give every new student a placement test, watch their activity day by day, and send assignments — Muse English handles the busywork while you teach.</p>' +
      '<div class="tw-cta">' +
        (loggedIn ? '<a class="tw-btn" href="#tw-apply">Request teacher access →</a>'
                  : '<a class="tw-btn" href="#tw-login">Log in →</a>') +
        '<a class="tw-btn tw-btn-ghost" href="#tw-how">How it works</a></div>' +
      '<p class="tw-note">Already teaching with Muse English? Your login is the same account you use in the app.</p>' +
    '</div></section>' +
    '<section class="tw-sec" id="tw-features"><div class="tw-sec-in">' +
      '<h2 class="tw-title-sm">Everything a teacher needs</h2>' +
      '<div class="tw-feats">' + feats.map(function (f) {
        return '<div class="tw-feat"><div class="tw-feat-ico">' + f[0] + '</div><h3>' + f[1] + '</h3><p>' + f[2] + '</p></div>';
      }).join('') + '</div></div></section>' +
    '<section class="tw-sec tw-sec-alt" id="tw-how"><div class="tw-sec-in">' +
      '<h2 class="tw-title-sm">Get started in minutes</h2>' +
      '<div class="tw-steps">' + steps.map(function (s) {
        return '<div class="tw-step"><div class="tw-step-n">' + s[0] + '</div><h3>' + s[1] + '</h3><p>' + s[2] + '</p></div>';
      }).join('') + '</div></div></section>' +
    (loggedIn
      ? '<section class="tw-sec" id="tw-apply"><div class="tw-narrow"><div class="tw-applybox" id="tw-apply"></div></div></section>'
      : '<section class="tw-sec" id="tw-login"><div class="tw-narrow"><div class="tw-logincard">' +
        '<h2 class="tw-title-sm">Teacher login</h2>' +
        '<p class="muted">Use the same email and password as your Muse English account.</p>' +
        '<form id="tw-login-form" novalidate>' +
        '<div class="field"><label for="tw-email">Email</label><input id="tw-email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label for="tw-pass">Password</label><input id="tw-pass" type="password" autocomplete="current-password" placeholder="••••••••" required></div>' +
        '<div class="form-error" id="tw-error" role="alert"></div>' +
        '<button class="tw-btn tw-btn-block" type="submit" id="tw-submit">Log in</button></form>' +
        '<p class="muted" style="margin-bottom:0">New to Muse English? <a class="link" href="/#/signup">Create a free account</a>, then come back here and log in.</p>' +
        '</div></div></section>') +
    '<footer class="tw-foot"><div class="tw-sec-in"><span>© 2026 Muse English · Built for teachers</span></div></footer>' +
  '</div>';
}

function twWireLanding() {
  var f = document.getElementById('tw-login-form');
  if (f) f.addEventListener('submit', twDoLogin);
}

async function twDoLogin(e) {
  e.preventDefault();
  var em = document.getElementById('tw-email'), pw = document.getElementById('tw-pass');
  var err = document.getElementById('tw-error'), btn = document.getElementById('tw-submit');
  err.textContent = '';
  var email = em.value.trim(), pass = pw.value;
  if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
  if (!sb) { err.textContent = 'Login service could not load. Check your connection and try again.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    var r = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (r.error) throw r.error;
    trackEvent('teacher_portal_login', {});
    await renderTeachers();
  } catch (ex) {
    err.textContent = (ex && ex.message) || 'Sign in failed.';
    btn.disabled = false; btn.textContent = 'Log in';
  }
}

async function twLogout() {
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  state.user = null; state.teacher = null; state.teacherRequest = null;
  state.twSection = null; state.twStudents = null; state.twPtest = null; state.twAssignments = null;
  state.twViewTeacher = null; state.viewTeacher = null; state.twTeacherList = null;
  window.location.href = '/teachers';
}

/* ---------------- workspace shell ---------------- */

function twRenderWorkspace(v) {
  if (!state.twSection) state.twSection = 'overview';
  var t = state.teacher || {};
  var em = (state.user && state.user.email) || '';
  var isAdmin = !!(state.user && state.user.isAdmin);
  v.innerHTML =
    '<div class="tw-work">' +
    '<aside class="tw-side">' +
      '<div class="tw-brandrow tw-brandrow-side"><span class="tw-apple">🍎</span><span><b>Muse English</b><small>for Teachers</small></span></div>' +
      (isAdmin ? '<div class="tw-switchwrap"><label for="tw-teacher-switch">👁 Viewing</label>' +
        '<select id="tw-teacher-switch" class="tw-select"><option value="">Loading teachers…</option></select></div>' : '') +
      '<nav class="tw-nav">' + TW_SECTIONS.map(function (s) {
        return '<button class="tw-navbtn' + (state.twSection === s[0] ? ' on' : '') + '" data-twsec="' + s[0] + '">' +
          '<span class="tw-navico">' + s[1] + '</span>' + s[2] + '</button>';
      }).join('') + '</nav>' +
      '<div class="tw-side-foot">' +
        '<div class="tw-me">' + twAvatar(t.display_name || em, 'tw-av-lg') +
          '<span class="tw-me-txt"><b>' + esc(t.display_name || (isAdmin ? 'Admin' : 'Teacher')) + '</b><small>' + esc(em) + '</small></span></div>' +
        '<button class="tw-footlink" data-twsec="settings"><span>⚙️</span> Settings</button>' +
        '<a class="tw-footlink" href="/"><span>⬈</span> Learner app</a>' +
        '<button class="tw-footlink" data-action="tw-logout"><span>⎋</span> Log out</button>' +
      '</div>' +
    '</aside>' +
    '<main class="tw-main"><div id="tw-viewbanner"></div><div class="tw-main-in" id="tw-content"></div></main>' +
    '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-twsec]'), function (b) {
    b.addEventListener('click', function () { twShowSection(b.getAttribute('data-twsec')); });
  });
  if (isAdmin) twInitTeacherSwitch();
  twShowSection(state.twSection);
}

/* ---------------- admin: view-as-teacher ----------------
   Admin-only teacher switcher inside the /teachers portal.
   Viewing another teacher is strictly read-only. */
async function twGetTeacherList() {
  if (state.twTeacherList) return state.twTeacherList;
  var list = [];
  try {
    var r = await sb.from('teachers').select('user_id,ref_code,display_name,status')
      .eq('status', 'approved').order('display_name', { ascending: true });
    if (!r.error) list = r.data || [];
  } catch (e) {}
  state.twTeacherList = list;
  return list;
}
/* Effective teacher context: the viewed teacher, or the logged-in teacher. */
function twEffTeacher() { return state.twViewTeacher || state.teacher; }
/* True when the admin is looking at someone else's dashboard. */
function twReadOnly() {
  /* Admins get full write access when viewing as a teacher. */
  if (state.user && state.user.isAdmin) return false;
  var v = state.twViewTeacher;
  var me = state.teacher;
  return !!(v && (!me || v.user_id !== me.user_id));
}
async function twInitTeacherSwitch() {
  var sel = document.getElementById('tw-teacher-switch');
  if (!sel) return;
  var list = await twGetTeacherList();
  var meId = state.teacher && state.teacher.user_id;
  var others = list.filter(function (x) { return x.user_id !== meId; });
  if (!state.teacher && others.length && !state.twViewTeacher) {
    /* Admin without a teacher row: default to the first teacher. */
    twSetViewTeacher(others[0]);
    return;
  }
  sel.innerHTML = (state.teacher ? '<option value="">My dashboard</option>' : '') +
    others.map(function (x) {
      return '<option value="' + x.user_id + '"' +
        (state.twViewTeacher && state.twViewTeacher.user_id === x.user_id ? ' selected' : '') + '>' +
        esc(x.display_name) + '</option>';
    }).join('') || '<option value="">No teachers yet</option>';
  sel.addEventListener('change', function () {
    var picked = others.filter(function (x) { return x.user_id === sel.value; })[0] || null;
    twSetViewTeacher(picked);
  });
}
function twSetViewTeacher(t) {
  state.twViewTeacher = t;
  /* Reuse the legacy view-as-teacher plumbing: tchViewId() then resolves to
     the viewed teacher, and action buttons hide in the student detail. */
  state.viewTeacher = t ? { user_id: t.user_id, display_name: t.display_name, ref_code: t.ref_code } : null;
  state.twStudents = null; state.twPtest = null; state.twAssignments = null;
  state.twSection = 'overview';
  twRenderWorkspace(document.getElementById('view'));
}
function twPaintViewBanner() {
  var host = document.getElementById('tw-viewbanner');
  if (!host) return;
  if (twReadOnly()) {
    var t = state.twViewTeacher;
    host.innerHTML = '<div class="tw-viewbanner">👁 You’re viewing <b>' + esc(t.display_name) +
      '’s dashboard</b> — read-only. <button class="tw-btn tw-btn-sm tw-btn-white" id="tw-backmine">Back to my dashboard</button></div>';
    document.getElementById('tw-backmine').addEventListener('click', function () { twSetViewTeacher(null); });
  } else if (state.twViewTeacher && state.user && state.user.isAdmin) {
    var t2 = state.twViewTeacher;
    host.innerHTML = '<div class="tw-viewbanner" style="background:#E8F5E9">✏️ You’re acting as <b>' + esc(t2.display_name) +
      '</b> (admin). <button class="tw-btn tw-btn-sm tw-btn-white" id="tw-backmine2">Back to my dashboard</button></div>';
    document.getElementById('tw-backmine2').addEventListener('click', function () { twSetViewTeacher(null); });
  } else host.innerHTML = '';
}

function twShowSection(name) {
  state.twSection = name;
  /* Detail pages keep the parent nav highlighted. */
  var navName = (name === 'assignment-detail') ? 'assignments' : name;
  Array.prototype.forEach.call(document.querySelectorAll('[data-twsec]'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-twsec') === navName);
  });
  var c = document.getElementById('tw-content');
  if (!c) return;
  window.scrollTo(0, 0);
  twPaintViewBanner();
  if (name === 'overview') twPageOverview(c);
  else if (name === 'students') twPageStudents(c);
  else if (name === 'daily') twPageDaily(c);
  else if (name === 'assignments') twPageAssignments(c);
  else if (name === 'assignment-detail') twPageAssignmentDetail(c);
  else if (name === 'compose') twPageCompose(c);
  else if (name === 'placement') twPagePlacement(c);
  else if (name === 'links') twPageLinks(c);
  else if (name === 'settings') twPageSettings(c);
}

/* ---------------- data ---------------- */

async function twGetStudents() {
  if (state.twStudents) return state.twStudents;
  var list = [];
  try {
    var params = state.twViewTeacher ? { p_teacher: state.twViewTeacher.user_id } : {};
    var r = await sb.rpc('get_my_students', params);
    if (r.error) throw r.error;
    list = r.data || [];
    state.twStudentsError = null;
  } catch (e) {
    state.twStudentsError = (e && e.message) || String(e);
  }
  state.twStudents = list;
  state.teacherStudents = list; /* keep legacy detail renderer in sync */
  return list;
}
async function twGetPtest() {
  if (state.twPtest) return state.twPtest;
  var rows = [];
  var t = twEffTeacher();
  try {
    var r = await sb.from('placement_results')
      .select('id,student_id,student_name,student_mobile,status,scores,suggested_level,sections,started_at,completed_at,updated_at')
      .eq('teacher_ref', t ? t.ref_code : '')
      .order('updated_at', { ascending: false }).limit(100);
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  state.twPtest = rows;
  state.ptestRows = rows; /* keep legacy detail renderer in sync */
  return rows;
}
async function twGetAssignments() {
  if (state.twAssignments) return state.twAssignments;
  var assigns = [], doneMap = {};
  var t = twEffTeacher();
  try {
    var a = await sb.from('assignments')
      .select('id,kind,title,created_at,deadline,student_ids,question_count,status,send_at,send_tz')
      .eq('teacher_id', t ? t.user_id : state.user.id).order('created_at', { ascending: false }).limit(40);
    if (a.error) throw a.error;
    assigns = a.data || [];
    var ids = assigns.map(function (x) { return x.id; });
    if (ids.length) {
      var rr = await sb.from('assignment_results').select('assignment_id,student_id').in('assignment_id', ids);
      if (!rr.error) (rr.data || []).forEach(function (x) {
        (doneMap[x.assignment_id] = doneMap[x.assignment_id] || {})[x.student_id] = 1;
      });
    }
  } catch (e) {}
  state.twAssignments = assigns;
  state.teacherAssignments = assigns;
  state.twDoneMap = doneMap;
  return assigns;
}
function twAsgStatus(a) {
  var doneMap = state.twDoneMap || {};
  if (a.status === 'scheduled') return ['Scheduled', 'sched'];
  var targets = (a.student_ids || []).length;
  var done = Object.keys(doneMap[a.id] || {}).length;
  if (done === 0) return ['Pending', 'pending'];
  if (targets && done >= targets) return ['Completed', 'done'];
  return ['In review', 'review'];
}
function twPill(text, kind) {
  return '<span class="tw-pill tw-pill-' + kind + '">' + text + '</span>';
}

/* ---------------- page: overview ---------------- */

async function twPageOverview(c) {
  var t = state.teacher;
  var first = esc((t.display_name || 'Teacher').split(' ')[0]);
  c.innerHTML = twPageHead('OVERVIEW', 'Welcome back, ' + first + ' 👋',
      'Here is what is happening with your students.') +
    '<div class="tw-stats" id="tw-stats">' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#FFE8D6">👥</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-students">…</span><span class="tw-stat-l">Students</span></div>' +
        '<div class="tw-stat-s">Total students in your class</div></div>' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#E3F5D8">📊</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-active">…</span><span class="tw-stat-l">Active this week</span></div>' +
        '<div class="tw-stat-s">Students with recent activity</div></div>' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#FFEFD2">📝</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-pending">…</span><span class="tw-stat-l">Tests to review</span></div>' +
        '<div class="tw-stat-s">Placement tests waiting</div></div>' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#EDE7FB">🕐</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-quiet">…</span><span class="tw-stat-l">Quiet 7+ days</span></div>' +
        '<div class="tw-stat-s">Students with no activity</div></div>' +
    '</div>' +
    '<div class="tw-grid2">' +
      '<div class="tw-panel"><div class="tw-cardhead"><div><h3>📄 Latest placement tests</h3>' +
      '<p class="muted">Recent placement test results from your students.</p></div>' +
      '<button class="tw-btn tw-btn-sm tw-btn-ghost" data-twsec="placement">View all →</button></div>' +
      '<div id="tw-recent-ptest"><div class="empty">Loading…</div></div></div>' +
      '<div class="tw-panel"><div class="tw-cardhead"><div><h3>⚠️ Needs attention</h3>' +
      '<p class="muted">Students who have not been active recently.</p></div>' +
      '<button class="tw-btn tw-btn-sm tw-btn-ghost" data-twsec="students">View all →</button></div>' +
      '<div id="tw-attn"><div class="empty">Loading…</div></div></div>' +
    '</div>' +
    '<div class="tw-banner"><div class="tw-banner-txt"><span class="tw-banner-ico">💡</span>' +
      '<div><b>Get your students started</b><p>Share your class link so students can join and take a placement test.</p></div></div>' +
      twPlane() +
      '<button class="tw-btn tw-btn-orange" id="tw-copy-ptest">🔗 Copy placement link</button></div>';
  Array.prototype.forEach.call(c.querySelectorAll('[data-twsec]'), function (b) {
    b.addEventListener('click', function () { twShowSection(b.getAttribute('data-twsec')); });
  });
  c.querySelector('#tw-copy-ptest').addEventListener('click', function () {
    twCopy(teacherPlacementLink((twEffTeacher() || {}).ref_code), this);
  });
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  var students = await twGetStudents();
  var quiet = students.filter(function (s) { var n = twDaysSince(s.last_active); return n === null || n >= 7; });
  var active = students.filter(function (s) { var n = twDaysSince(s.last_active); return n !== null && n < 7; });
  set('tw-s-students', students.length);
  set('tw-s-active', active.length);
  set('tw-s-quiet', quiet.length);
  var attn = document.getElementById('tw-attn');
  if (attn) {
    attn.innerHTML = quiet.length ? quiet.slice(0, 4).map(function (s) {
      var nm = s.display_name || (s.email || '?').split('@')[0];
      return '<div class="tw-attnrow">' + twAvatar(nm) +
        '<span class="tw-attn-name"><b>' + esc(nm) + '</b><small>' + esc(twLevelLabel(s.level)) + '</small></span>' +
        '<span class="tw-attn-when"><small class="muted">Last active</small><b>' + esc(twDate(s.last_active)) + '</b></span>' +
        twPill(esc(twAgo(s.last_active)), 'red') + '</div>';
    }).join('') : '<div class="empty">Everyone is active. 🎉</div>';
  }
  var rp = document.getElementById('tw-recent-ptest');
  var rows = await twGetPtest();
  var pending = rows.filter(function (x) { return x.status !== 'completed'; }).length;
  set('tw-s-pending', pending);
  if (rp) {
    if (!rows.length) {
      rp.innerHTML = '<div class="tw-empty-ill">📝</div><b>No tests yet</b>' +
        '<p class="muted">When your students take a placement test,<br>their results will appear here.</p>' +
        '<button class="tw-btn tw-btn-sm tw-btn-ghost" id="tw-share-ptest">🔗 Share your placement link</button>';
      var sh = document.getElementById('tw-share-ptest');
      if (sh) sh.addEventListener('click', function () { twCopy(teacherPlacementLink((twEffTeacher() || {}).ref_code), this); });
    } else {
      rp.innerHTML = rows.slice(0, 4).map(function (x) {
        var sc = x.scores || {};
        return '<div class="tw-attnrow">' + twAvatar(x.student_name) +
          '<span class="tw-attn-name"><b>' + esc(x.student_name || 'Student') + '</b>' +
          '<small>' + (x.status === 'completed' ? 'Score ' + (sc.total || 0) + '/55' : 'In progress') + '</small></span>' +
          (x.suggested_level ? twPill(esc(x.suggested_level), 'green') : twPill('In progress', 'gray')) + '</div>';
      }).join('');
    }
  }
}

/* ---------------- page: students ---------------- */

function twStudentRow(s, oi, ptestByStudent) {
  var nm = s.display_name || (s.email || '?').split('@')[0];
  var n = twDaysSince(s.last_active);
  var st = s.last_active;
  var statusPill, statusSub;
  if (n !== null && n <= 0) { statusPill = twPill('● Active today', 'green'); statusSub = ''; }
  else if (n !== null && n < 7) { statusPill = twPill('Active ' + twAgo(st), 'gray'); statusSub = ''; }
  else { statusPill = twPill('● Needs attention', 'red'); statusSub = '<small class="muted">' + esc(twAgo(st)) + '</small>'; }
  var pt = ptestByStudent[s.user_id];
  var ptPill = pt ? twPill('✓ Completed', 'green') : twPill('🕐 Not started', 'gray');
  var mins = s.podcast_min_7d || 0;
  return '<div class="tw-trow" data-i="' + oi + '" role="button" tabindex="0">' +
    '<div class="tw-tcell tw-tstudent">' + twAvatar(nm) +
      '<span><b>' + esc(nm) + '</b><small>' + esc(twLevelLabel(s.level)) + '</small>' +
      '<small class="muted">Last active ' + esc(twDate(st)) + '</small></span></div>' +
    '<div class="tw-tcell tw-tnum">' + (s.current_streak > 0 ? '🔥' : '<span class="tw-dim">💧</span>') + ' ' + (s.current_streak || 0) + '</div>' +
    '<div class="tw-tcell tw-tnum">' + (s.xp_7d || 0) + '</div>' +
    '<div class="tw-tcell tw-tnum">' + (s.lessons_7d || 0) + '</div>' +
    '<div class="tw-tcell tw-tnum">' + mins + 'm</div>' +
    '<div class="tw-tcell">' + ptPill + '</div>' +
    '<div class="tw-tcell"><span class="tw-statuswrap">' + statusPill + statusSub + '</span></div>' +
    '<div class="tw-tcell tw-tmenu"><button class="tw-dots" data-twmenu="' + oi + '" aria-label="More">⋯</button></div>' +
  '</div>';
}

async function twPageStudents(c) {
  var students = await twGetStudents();
  var ptest = await twGetPtest();
  var ptestByStudent = {};
  ptest.forEach(function (x) { if (x.student_id && x.status === 'completed') ptestByStudent[x.student_id] = x; });
  var ro = twReadOnly();
  c.innerHTML = twPageHead('STUDENTS', 'My students <span class="tw-count">(' + students.length + ')</span>',
      'View and manage your students’ progress, activity and placement test results.') +
    (state.twStudentsError ? '<div class="tw-errbox">⚠️ Could not load students: ' + esc(state.twStudentsError) +
      '<br><span class="muted">If you are viewing another teacher, run the admin migration in Supabase first.</span></div>' : '') +
    '<div class="tw-toolbar">' +
      '<div class="tw-search"><span>🔍</span><input id="tw-q" type="search" placeholder="Search students by name…"></div>' +
      '<select id="tw-flevel" class="tw-select"><option value="">All levels</option>' +
        ['a1', 'a2', 'b1', 'b2', 'c1'].map(function (l) {
          return '<option value="' + l + '">' + l.toUpperCase() + ' · ' + TW_LEVEL_LABEL[l] + '</option>';
        }).join('') + '</select>' +
      '<select id="tw-sort" class="tw-select"><option value="active">Last active</option>' +
        '<option value="name">Name A–Z</option><option value="xp">XP (7d)</option><option value="streak">Streak</option></select>' +
      (ro ? '' : '<button class="tw-btn tw-btn-orange" id="tw-invite">＋ Invite student</button>') +
    '</div>' +
    '<div class="tw-tablecard"><div class="tw-table-scroll"><div class="tw-table">' +
      '<div class="tw-thead"><span>STUDENT</span><span>🔥 STREAK</span><span>📊 XP 7D</span><span>📖 LESSONS</span>' +
      '<span>🎧 LISTENING</span><span>📝 PLACEMENT TEST</span><span>STATUS</span><span></span></div>' +
      '<div id="tw-tbody"></div>' +
    '</div></div></div>' +
    '<div id="tch-detail"></div>' +
    '<div class="tw-banner"><div class="tw-banner-txt"><span class="tw-banner-ico">💡</span>' +
      '<div><b>Tap a student to see their 14-day activity.</b>' +
      '<p>View detailed progress, lessons, and placement test results for each student.</p></div></div>' +
      twPlane() + '</div>' +
    '<div class="tw-menu" id="tw-menu" hidden></div>';
  var render = function () {
    var q = (document.getElementById('tw-q').value || '').toLowerCase();
    var lv = document.getElementById('tw-flevel').value;
    var sort = document.getElementById('tw-sort').value;
    var idx = students.map(function (s, i) { return i; }).filter(function (i) {
      var s = students[i];
      var nm = (s.display_name || s.email || '').toLowerCase();
      if (q && nm.indexOf(q) < 0) return false;
      if (lv && String(s.level || '').toLowerCase() !== lv) return false;
      return true;
    });
    idx.sort(function (a, b) {
      var sa = students[a], sb2 = students[b];
      if (sort === 'name') return String(sa.display_name || sa.email || '').localeCompare(String(sb2.display_name || sb2.email || ''));
      if (sort === 'xp') return (sb2.xp_7d || 0) - (sa.xp_7d || 0);
      if (sort === 'streak') return (sb2.current_streak || 0) - (sa.current_streak || 0);
      return String(sb2.last_active || '').localeCompare(String(sa.last_active || ''));
    });
    document.getElementById('tw-tbody').innerHTML = idx.length
      ? idx.map(function (i) { return twStudentRow(students[i], i, ptestByStudent); }).join('')
      : '<div class="empty">No students match.</div>';
  };
  ['tw-q', 'tw-flevel', 'tw-sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });
  var invBtn = document.getElementById('tw-invite');
  if (invBtn) invBtn.addEventListener('click', function () {
    var t = twEffTeacher();
    if (t) twCopy(teacherInviteLink(t.ref_code), this);
  });
  document.getElementById('tw-tbody').addEventListener('click', function (e) {
    var mb = e.target.closest('[data-twmenu]');
    if (mb) { twStudentMenu(mb, students); e.stopPropagation(); return; }
    var row = e.target.closest('.tw-trow');
    if (row) openTeacherStudent(parseInt(row.getAttribute('data-i'), 10));
  });
  document.addEventListener('click', function h(e) {
    var m = document.getElementById('tw-menu');
    if (m && !m.hidden && !e.target.closest('#tw-menu') && !e.target.closest('[data-twmenu]')) m.hidden = true;
  });
  render();
}

function twStudentMenu(btn, students) {
  var m = document.getElementById('tw-menu');
  var i = btn.getAttribute('data-twmenu');
  var s = students[parseInt(i, 10)];
  var nm = s.display_name || (s.email || '?').split('@')[0];
  m.innerHTML = '<b>' + esc(nm) + '</b>' +
    '<button data-m="view">📊 View 14-day activity</button>' +
    (twReadOnly() ? '' : '<button data-m="nudge">🔔 Send nudge</button>');
  var r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + window.scrollY + 6) + 'px';
  m.style.left = Math.max(8, r.right + window.scrollX - 220) + 'px';
  m.hidden = false;
  Array.prototype.forEach.call(m.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      m.hidden = true;
      if (b.getAttribute('data-m') === 'nudge') twSendNudge(i);
      else openTeacherStudent(parseInt(i, 10));
    });
  });
}

async function twSendNudge(i) {
  var s = (state.teacherStudents || [])[parseInt(i, 10)];
  if (!s) return;
  try {
    var r = await sb.rpc('send_nudge', { p_student: s.user_id });
    showModal('<div class="modal-ico">🔔</div><h2>' +
      (r.data === true ? 'Nudge sent!' : 'Already sent today') + '</h2>' +
      '<p class="muted">' + esc(s.display_name || 'Your student') + ' will see your nudge in the app.</p>' +
      '<button class="tw-btn tw-btn-block" data-action="modal-close">OK</button>');
  } catch (e) {
    showModal('<div class="modal-ico">⚠️</div><h2>Could not send</h2>' +
      '<p class="muted">' + esc((e && e.message) || 'Try again later.') + '</p>' +
      '<button class="tw-btn tw-btn-block" data-action="modal-close">OK</button>');
  }
}

/* ---------------- page: assignments ---------------- */

/* Daily study — the admin panel's table, scoped to this teacher's students.
   Same shared renderer/fetch as the admin + in-app teacher versions. */
async function twPageDaily(c) {
  c.innerHTML = twPageHead('DAILY STUDY', 'Daily study',
      'Who studied how much, per day or range — your students only.') +
    '<div id="twd-daily"><div class="tw-empty">Loading…</div></div>';
  twLoadDaily();
}
async function twLoadDaily() {
  var host = document.getElementById('twd-daily');
  if (!host) return;
  var roster = await twGetStudents();
  var day = state.twDailyDay || todayStr();
  var range = state.twDailyRange || 'day';
  state.twDailyDay = day;
  state.twDailyRange = range;
  host.innerHTML = dailyStudyShell('twd', day, range, '📊 Daily study — who studied how much');
  var rangeSel = document.getElementById('twd-daily-range');
  if (rangeSel) rangeSel.addEventListener('change', function () {
    state.twDailyRange = rangeSel.value; twLoadDaily();
  });
  var dayInput = document.getElementById('twd-daily-day');
  if (dayInput) dayInput.addEventListener('change', function () {
    if (dayInput.value) { state.twDailyDay = dayInput.value; twLoadDaily(); }
  });
  var body = document.getElementById('twd-daily-body');
  var sum = document.getElementById('twd-daily-sum');
  if (!roster.length) {
    if (body) body.innerHTML = '<div class="empty">No students yet — share your invite link to get your first student.</div>';
    return;
  }
  try {
    var f = await fetchStudyRange(range, day, roster.map(function (s) { return s.user_id; }));
    var rows = roster.map(function (s) {
      return dailyStudyRow(s.user_id, f, s.display_name || '?', s.level);
    });
    rows.sort(function (a, b) { return b.min - a.min; });
    var active = rows.filter(dailyStudyActive).length;
    var totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
    if (sum) sum.textContent = active + ' / ' + rows.length + ' studied · ' + totalMin + ' total min · ' + rangeLabel(range);
    if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(range) + '.');
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
  }
}

async function twPageAssignments(c) {
  var assigns = await twGetAssignments();
  var students = await twGetStudents();
  var ro = twReadOnly();
  c.innerHTML = twPageHead('ASSIGNMENTS', 'Assignments',
      'Create, send and track assignments for your students.') +
    '<div class="tw-asg-top"><div class="tw-tabs">' +
      '<button class="tw-tab on" data-twtab="list">Sent</button>' +
      (ro ? '' : '<button class="tw-tab" data-twtab="planner">📅 Weekly planner</button>') + '</div>' +
      '<div class="tw-asg-actions"><button class="tw-btn tw-btn-white" id="tw-classreport">📊 Class report</button>' +
      (ro ? '' : '<button class="tw-btn tw-btn-orange" id="tw-new-assignment">＋ New assignment</button>') + '</div></div>' +
    '<div id="tw-assign-list"></div>' +
    '<div id="tw-assign-planner" hidden></div>';
  var paint = function () {
    var host = document.getElementById('tw-assign-list');
    if (!assigns.length) {
      host.innerHTML = '<div class="tw-emptybox"><div class="tw-empty-ill">✈️</div><b>No assignments yet</b>' +
        '<p class="muted">Create your first assignment and send it to your students.</p></div>';
      return;
    }
    host.innerHTML = assigns.map(function (a, i) {
      var st = twAsgStatus(a);
      var targets = (a.student_ids || []).length;
      var done = Object.keys((state.twDoneMap || {})[a.id] || {}).length;
      var pct = targets ? Math.round(done / targets * 100) : 0;
      var due = a.deadline || a.send_at;
      var kindIcon = a.kind === 'exam' ? '📋' : '📝';
      var tint = a.status === 'scheduled' ? '#EDE7FB' : (st[1] === 'pending' ? '#FFF0D6' : '#E4F5DB');
      var who = targets >= students.length && students.length ? 'All students' : targets + ' student' + (targets === 1 ? '' : 's');
      return '<div class="tw-asg" data-i="' + i + '" role="button" tabindex="0">' +
        '<span class="tw-asg-ico" style="background:' + tint + '">' + kindIcon + '</span>' +
        '<span class="tw-asg-main"><b>' + esc(a.title || 'Assignment') + '</b>' +
        '<small>📅 ' + (due ? 'Due ' + esc(twDueLabel(due)) : 'No due date') +
        ' <i>·</i> 👥 ' + esc(who) + '</small></span>' +
        '<span class="tw-asg-prog">' + twRing(pct) +
        '<span class="tw-asg-frac"><b>' + done + ' / ' + targets + '</b><small>completed</small></span></span>' +
        twPill(st[0], st[1]) + '<span class="tw-asg-arrow">→</span></div>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.tw-asg'), function (el) {
      el.addEventListener('click', function () {
        state.twAssignmentIdx = parseInt(el.getAttribute('data-i'), 10);
        twShowSection('assignment-detail');
      });
    });
  };
  paint();
  Array.prototype.forEach.call(c.querySelectorAll('[data-twtab]'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(c.querySelectorAll('[data-twtab]'), function (x) {
        x.classList.toggle('on', x === b);
      });
      var which = b.getAttribute('data-twtab');
      document.getElementById('tw-assign-list').hidden = which !== 'list';
      var ph = document.getElementById('tw-assign-planner');
      ph.hidden = which !== 'planner';
      if (which === 'planner' && !ph.getAttribute('data-loaded')) {
        ph.setAttribute('data-loaded', '1');
        renderPlanner(ph);
      }
    });
  });
  document.getElementById('tw-classreport').addEventListener('click', function () {
    twClassReport(assigns, students);
  });
  var newBtn = document.getElementById('tw-new-assignment');
  if (newBtn) newBtn.addEventListener('click', function () { twShowSection('compose'); });
}
/* ---------------- page: assignment detail (full-page, replaces the modal) ---------------- */
async function twPageAssignmentDetail(c) {
  var idx = state.twAssignmentIdx;
  var assigns = await twGetAssignments();
  var r = assigns[idx];
  if (r == null) { twShowSection('assignments'); return; }
  var roster = state.twStudents || state.teacherStudents || [];
  var nameOf = {};
  roster.forEach(function (s) {
    nameOf[s.user_id] = s.display_name || (s.email || '?').split('@')[0];
  });
  var results = [];
  try {
    var q = await sb.from('assignment_results')
      .select('student_id,score,total,completed_at,answers').eq('assignment_id', r.id);
    results = q.data || [];
  } catch (e) {}
  var byId = {};
  results.forEach(function (x) { byId[x.student_id] = x; });
  var targets = (r.student_ids || []).length;
  var done = results.length;
  var kindIcon = r.kind === 'exam' ? '📋' : '📝';
  var sub = r.status === 'scheduled' && r.send_at
    ? esc(schedLabel(r.send_at, r.send_tz)).replace(/^⏰ /, '') + ' — not sent yet.'
    : targets + ' student' + (targets === 1 ? '' : 's') + ' · ' + done + ' completed';
  var statusBox;
  if (r.status === 'scheduled') {
    statusBox = '<div class="tw-m-status"><span class="tw-m-status-ico">⏰</span>' +
      '<div><b class="tw-m-status-t">Scheduled</b>' +
      '<p>Sends automatically at the planned time.<br>You can cancel it below.</p></div></div>';
  } else if (!done) {
    statusBox = '<div class="tw-m-status"><span class="tw-m-status-ico">⏳</span>' +
      '<div><b class="tw-m-status-t">Pending</b>' +
      '<p>No student activity yet.<br>Once students start, their progress will appear here.</p></div></div>';
  } else {
    statusBox = '<div class="tw-m-rows">' + (r.student_ids || []).map(function (uid) {
      var res = byId[uid];
      var nm = nameOf[uid] || '—';
      return '<div class="tw-m-row">' + twAvatar(nm) + '<b>' + esc(nm) + '</b>' +
        (res ? '<span class="tw-pill tw-pill-green">✓ ' + res.score + '/' + res.total + '</span>'
             : '<span class="tw-pill tw-pill-gray">⏳ pending</span>') + '</div>';
    }).join('') + '</div>';
  }
  var actionBtn = '';
  if (twReadOnly()) {
    actionBtn = '<p class="muted" style="font-size:0.85rem">👁 Read-only admin view.</p>';
  } else if (r.status === 'scheduled') {
    actionBtn = '<button class="tw-m-del" id="tw-ad-cancel">✕ Cancel scheduled send</button>';
  } else {
    actionBtn = '<button class="tw-m-del" id="tw-ad-delete">🗑 Delete assignment</button>';
  }
  c.innerHTML = twPageHead('ASSIGNMENTS', kindIcon + ' ' + esc(r.title || 'Assignment'), sub) +
    '<div class="tw-backrow"><button class="tw-btn tw-btn-white" id="tw-back-assign">← Back to assignments</button></div>' +
    '<div class="tw-card tw-adetail">' + statusBox + '<div id="tw-ad-missed"></div>' + actionBtn + '</div>';
  twFillMissedWords(r, results, nameOf);
  document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
  var del = document.getElementById('tw-ad-delete');
  if (del) del.addEventListener('click', function () { deleteTeacherAssignment(idx, del); });
  var can = document.getElementById('tw-ad-cancel');
  if (can) can.addEventListener('click', function () { cancelScheduledAssignment(idx, can); });
  window.scrollTo(0, 0);
}
/* Vocabulary assignments: per-student missed words on the detail page.
   Answers carry qid ('vocab:<slug>:<type>:<n>'); questions carry word +
   explanation (word — meaning_en · meaning_fa · example). */
async function twFillMissedWords(r, results, nameOf) {
  var host = document.getElementById('tw-ad-missed');
  if (!host || !results.length) return;
  try {
    var aq = await sb.from('assignments').select('topic,questions').eq('id', r.id).single();
    if (aq.error || !aq.data || aq.data.topic !== 'vocab') return;
    var byQid = {};
    (aq.data.questions || []).forEach(function (q) { if (q.id) byQid[q.id] = q; });
    var blocks = results.map(function (res) {
      var missed = [];
      var seenW = {};
      (res.answers || []).forEach(function (a) {
        var wrong = (a.isCorrect !== undefined) ? !a.isCorrect : (typeof a.correct === 'boolean' ? !a.correct : false);
        if (!wrong || !a.qid) return;
        var q = byQid[a.qid];
        if (!q || !q.word || seenW[q.word]) return;
        seenW[q.word] = true;
        missed.push(q);
      });
      var nm = nameOf[res.student_id] || 'Student';
      if (!missed.length) {
        return '<div class="tw-missed"><b>' + esc(nm) + '</b> <span class="tw-pill tw-pill-green">✓ All words correct</span></div>';
      }
      return '<div class="tw-missed"><b>' + esc(nm) + '</b> <span class="muted">missed ' + missed.length + ' word' + (missed.length === 1 ? '' : 's') + ':</span>' +
        '<div class="tw-missed-chips">' + missed.map(function (q) {
          var m = String(q.explanation || '').split(' Example:')[0];
          return '<span class="tw-missed-chip"><b>' + esc(q.word) + '</b>' + (m ? ' · ' + esc(m.replace(q.word + ' — ', '')) : '') + '</span>';
        }).join('') + '</div></div>';
    }).join('');
    if (blocks) host.innerHTML = '<div class="an-title" style="margin-top:1rem">📚 Words to review</div>' + blocks;
  } catch (e) {}
}

/* ---------------- page: new assignment (full-page composer) ---------------- */
/* Full-page version of the assignment composer for the /teachers portal.
   Reuses assignmentComposerBodyHTML() + assignmentComposerWire() (shared with the modal). */
async function twPageCompose(c) {
  if (twReadOnly()) { twShowSection('assignments'); return; }
  await loadV2Index();
  var list = await twGetStudents();
  var head = twPageHead('ASSIGNMENTS', 'New assignment',
      'Pick a topic, choose teaching points and send it to your students.') +
    '<div class="tw-backrow"><button class="tw-btn tw-btn-white" id="tw-back-assign">← Back to assignments</button></div>';
  if (!list.length) {
    c.innerHTML = head +
      '<div class="tw-emptybox"><div class="tw-empty-ill">🌱</div><b>No students yet</b>' +
      '<p class="muted">Share your invite link first, then create assignments.</p></div>';
    document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
    return;
  }
  c.innerHTML = head +
    '<div class="tw-compose as2">' + assignmentComposerBodyHTML(list) + '</div>';
  document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
  assignmentComposerWire();
  window.scrollTo(0, 0);
}

function twDueLabel(d) {
  var dt = new Date(d.length <= 10 ? d + 'T12:00:00' : d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function twClassReport(assigns, students) {
  var doneMap = state.twDoneMap || {};
  var sent = assigns.filter(function (a) { return a.status !== 'scheduled'; }).slice(0, 8);
  var body;
  if (!sent.length || !students.length) {
    body = '<div class="empty">Nothing to report yet.</div>';
  } else {
    body = '<div class="tw-table-scroll"><table class="tw-matrix"><tr><th>Student</th>' +
      sent.map(function (a) { return '<th title="' + esc(a.title || '') + '">' + esc(String(a.title || '').slice(0, 14)) + '…</th>'; }).join('') + '</tr>' +
      students.map(function (s) {
        var nm = s.display_name || (s.email || '?').split('@')[0];
        return '<tr><td><b>' + esc(nm) + '</b></td>' + sent.map(function (a) {
          var dm = doneMap[a.id] || {};
          if ((a.student_ids || []).indexOf(s.user_id) < 0) return '<td class="muted">–</td>';
          return '<td>' + (dm[s.user_id] ? '<span class="tw-ok">✓</span>' : '<span class="tw-pend">○</span>') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table></div>';
  }
  showModal('<div class="modal-ico">📊</div><h2>Class report</h2>' +
    '<p class="muted">Completion per student across recent assignments.</p>' + body +
    '<button class="tw-btn tw-btn-block" data-action="modal-close" style="margin-top:1rem">Close</button>');
}

/* ---------------- page: placement tests ---------------- */

async function twPagePlacement(c) {
  var rows = await twGetPtest();
  c.innerHTML = twPageHead('PLACEMENT TESTS', 'Placement tests',
      'Review your students’ 5-part placement tests — vocabulary, listening, grammar, writing, speaking.') +
    '<div class="tw-banner"><div class="tw-banner-txt"><span class="tw-banner-ico">📝</span>' +
      '<div><b>New student? Send them your placement link.</b>' +
      '<p>Their results will appear here with a suggested level.</p></div></div>' +
      twPlane() +
      '<button class="tw-btn tw-btn-orange" id="tw-copy-ptest2">🔗 Copy placement link</button></div>' +
    '<div id="tw-ptest-list"></div><div id="tch-ptest-detail"></div>';
  document.getElementById('tw-copy-ptest2').addEventListener('click', function () {
    twCopy(teacherPlacementLink((twEffTeacher() || {}).ref_code), this);
  });
  var host = document.getElementById('tw-ptest-list');
  if (!rows.length) {
    host.innerHTML = '<div class="tw-emptybox"><div class="tw-empty-ill">📝</div><b>No tests yet</b>' +
      '<p class="muted">When your students take a placement test,<br>their results will appear here.</p></div>';
    return;
  }
  host.innerHTML = '<div class="tw-ptests">' + rows.map(function (x, i) {
    var sc = x.scores || {};
    var done = x.status === 'completed';
    return '<div class="tw-ptest" data-i="' + i + '" role="button" tabindex="0">' +
      twAvatar(x.student_name) +
      '<span class="tw-ptest-main"><b>' + esc(x.student_name || 'Student') + '</b>' +
      '<small>' + esc(twDate(x.completed_at || x.updated_at)) +
      (x.student_mobile ? ' · ' + esc(x.student_mobile) : '') + '</small></span>' +
      (done ? '<span class="tw-ptest-score"><b>' + (sc.total || 0) + '/55</b><small>total</small></span>' +
        (x.suggested_level ? twPill(esc(x.suggested_level), 'green') : '') : twPill('In progress', 'gray')) +
      '<span class="tw-asg-arrow">→</span></div>';
  }).join('') + '</div>';
  Array.prototype.forEach.call(host.querySelectorAll('.tw-ptest'), function (el) {
    el.addEventListener('click', function () {
      openPlacementDetail(parseInt(el.getAttribute('data-i'), 10));
      setTimeout(function () {
        var d = document.getElementById('tch-ptest-detail');
        if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    });
  });
}

/* ---------------- page: invite & links + settings ---------------- */

function twProfileEditor(host) {
  host.innerHTML = '<div class="empty">Loading…</div>';
  (async function () {
    var p = {};
    try {
      var r = await sb.from('teachers')
        .select('display_name,photo_url,experience_years,bio')
        .eq('user_id', state.user.id).maybeSingle();
      if (!r.error) p = r.data || {};
    } catch (e) {}
    var previewURL = null, pendingFile = null;
    var photoHTML = function (url, name) {
      return url
        ? '<img id="tw-photo-prev" class="tw-prof-photo" src="' + esc(url) + '" alt="">'
        : '<div id="tw-photo-prev" class="tw-prof-photo">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>';
    };
    host.innerHTML =
      '<div class="tw-prof-grid"><div>' +
        '<div class="tw-prof-photowrap">' + photoHTML(p.photo_url, p.display_name) +
        '<label class="tw-btn tw-btn-sm tw-btn-white" style="cursor:pointer">⬆ Upload photo<input type="file" id="tw-photo-file" accept="image/*" hidden></label>' +
        '<small class="muted">JPG, PNG up to 2MB</small></div></div>' +
      '<div class="tw-prof-fields">' +
        '<div class="field"><label>Display name</label><input id="tw-f-name" maxlength="40" value="' + esc(p.display_name || '') + '"></div>' +
        '<div class="field"><label>Years of teaching experience</label><input id="tw-f-exp" inputmode="numeric" placeholder="e.g. 5" value="' + esc(p.experience_years == null ? '' : p.experience_years) + '"></div>' +
        '<div class="field"><label>Short bio (one line, max 200)</label>' +
        '<textarea id="tw-f-bio" rows="2" maxlength="200" placeholder="e.g. IELTS coach — I help adults speak with confidence">' + esc(p.bio || '') + '</textarea>' +
        '<small class="muted" id="tw-bio-count">' + (p.bio || '').length + '/200</small></div>' +
        '<div><button class="tw-btn tw-btn-orange" id="tw-prof-save">Save profile</button> ' +
        '<span class="muted" id="tw-prof-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
      '</div>' +
      '<div class="tw-prof-preview"><div class="tw-cardhead"><h3 style="margin:0">👁 Profile preview</h3>' +
      '<a class="tw-btn tw-btn-sm tw-btn-white" href="/#/choose-teacher" target="_blank" rel="noopener">View public profile ⬈</a></div>' +
      '<div class="tw-pvcard" id="tw-pv"></div>' +
      '<p class="muted" style="font-size:0.82rem">Here’s how students will see you.</p></div>' +
      '</div>';
    var paintPreview = function () {
      var nm = host.querySelector('#tw-f-name').value.trim() || '?';
      var bio = host.querySelector('#tw-f-bio').value.trim();
      var url = previewURL || p.photo_url;
      document.getElementById('tw-pv').innerHTML =
        '<div class="tw-pv-top">' + (url
          ? '<img class="tw-pv-photo" src="' + esc(url) + '" alt="">'
          : '<div class="tw-pv-photo tw-pv-initial">' + esc(nm.charAt(0).toUpperCase()) + '</div>') +
        '<div><b>' + esc(nm) + '</b><small>Teacher</small>' +
        '<div>' + twPill('● New on Muse English', 'green') + '</div></div></div>' +
        '<div class="tw-pv-meta"><span>📖 <b>' + (state.twStudents || []).length + '+ students</b></span>' +
        '<span>⭐ <b>0.0</b> (0 reviews)</span></div>' +
        '<p class="tw-pv-bio">' + esc(bio || 'No bio yet.') + '</p>';
    };
    host.querySelector('#tw-f-bio').addEventListener('input', function () {
      host.querySelector('#tw-bio-count').textContent = this.value.length + '/200';
      paintPreview();
    });
    host.querySelector('#tw-f-name').addEventListener('input', paintPreview);
    host.querySelector('#tw-photo-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      pendingFile = f;
      var rd = new FileReader();
      rd.onload = function () { previewURL = rd.result; paintPreview(); };
      rd.readAsDataURL(f);
    });
    host.querySelector('#tw-prof-save').addEventListener('click', async function () {
      var status = host.querySelector('#tw-prof-status');
      var say = function (t, ok) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; };
      var name = host.querySelector('#tw-f-name').value.trim();
      var expRaw = host.querySelector('#tw-f-exp').value.trim();
      var bio = host.querySelector('#tw-f-bio').value.trim();
      if (name.length < 2) { say('Display name is too short.', false); return; }
      var exp = expRaw === '' ? null : parseInt(expRaw, 10);
      if (expRaw !== '' && !(exp >= 0 && exp <= 60)) { say('Experience must be 0–60 years.', false); return; }
      if (bio.length > 200) { say('Bio is too long (max 200).', false); return; }
      say('Saving…', true);
      try {
        var photoURL = p.photo_url || null;
        if (pendingFile) {
          var ext = ((pendingFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
          var path = state.user.id + '/photo.' + ext;
          var up = await sb.storage.from('teacher-photos').upload(path, pendingFile, { upsert: true, contentType: pendingFile.type || 'image/jpeg' });
          if (up.error) throw up.error;
          photoURL = sb.storage.from('teacher-photos').getPublicUrl(path).data.publicUrl;
        }
        var rr = await sb.rpc('update_teacher_profile', {
          p_display_name: name, p_experience_years: exp, p_bio: bio, p_photo_url: photoURL || ''
        });
        if (rr.error || rr.data !== true) throw new Error('save failed');
        p = { display_name: name, photo_url: photoURL, experience_years: exp, bio: bio };
        if (state.teacher) state.teacher.display_name = name;
        pendingFile = null; previewURL = photoURL;
        say('Saved ✓', true);
        paintPreview();
        twRenderWorkspace(document.getElementById('view'));
      } catch (e) { say('Save failed: ' + (e.message || e), false); }
    });
    paintPreview();
  })();
}

async function twPageLinks(c) {
  var t = twEffTeacher();
  if (!t) {
    c.innerHTML = twPageHead('INVITE & LINKS', 'Invite & links',
      'Share your links, bring in new students and build your profile.') +
      '<div class="tw-emptybox"><div class="tw-empty-ill">🔗</div><b>No teacher selected</b>' +
      '<p class="muted">Pick a teacher from the switcher above.</p></div>';
    return;
  }
  var ro = twReadOnly();
  await twGetStudents();
  c.innerHTML = twPageHead('INVITE & LINKS', 'Invite & links',
      'Share your links, bring in new students and build your profile.') +
    '<div class="tw-linkcard"><span class="tw-link-ico" style="background:#FFE8D6">🔗</span>' +
      '<div class="tw-link-main"><b>Your personal invite link</b>' +
      '<p class="muted">Share it with your students — everyone who signs up through it shows up on your roster.</p>' +
      '<div class="tw-linkrow"><code>' + esc(teacherInviteLink(t.ref_code)) + '</code>' +
      '<button class="tw-btn tw-btn-orange tw-btn-sm" id="tw-copy-invite">⧉ Copy</button></div></div>' +
      '<div class="tw-link-side"><div class="tw-link-note">New students who sign up with this link will be added to your class roster.</div></div></div>' +
    '<div class="tw-linkcard"><span class="tw-link-ico" style="background:#E4F5DB">📝</span>' +
      '<div class="tw-link-main"><b>Placement test link for new students</b>' +
      '<p class="muted">Send it to a new student — they take a 5-part test and the results land in your dashboard.</p>' +
      '<div class="tw-linkrow"><code>' + esc(teacherPlacementLink(t.ref_code)) + '</code>' +
      '<button class="tw-btn tw-btn-orange tw-btn-sm" id="tw-copy-ptest3">⧉ Copy</button></div></div>' +
      '<div class="tw-link-side"><div class="tw-link-note tw-link-note-p">Students take a 5-part placement test and their results will appear in your dashboard.</div></div></div>' +
    (ro ? '<div class="tw-profcard"><p class="muted" style="margin:0">👁 Read-only — you’re viewing ' + esc(t.display_name) + '’s links.</p></div>'
      : '<div class="tw-profcard"><div class="tw-cardhead"><div><h3 style="margin:0">👤 My public profile</h3>' +
      '<p class="muted">Students see this when choosing a teacher.</p></div></div>' +
      '<div id="tw-prof-edit"></div></div>');
  document.getElementById('tw-copy-invite').addEventListener('click', function () {
    twCopy(teacherInviteLink(t.ref_code), this);
  });
  document.getElementById('tw-copy-ptest3').addEventListener('click', function () {
    twCopy(teacherPlacementLink(t.ref_code), this);
  });
  if (!ro) twProfileEditor(document.getElementById('tw-prof-edit'));
}

function twPageSettings(c) {
  c.innerHTML = twPageHead('SETTINGS', 'Settings', 'Your public teacher profile.') +
    '<div class="tw-profcard"><div class="tw-cardhead"><div><h3 style="margin:0">👤 My public profile</h3>' +
    '<p class="muted">Students see this when choosing a teacher.</p></div></div>' +
    '<div id="tw-prof-edit"></div></div>';
  twProfileEditor(document.getElementById('tw-prof-edit'));
}

/* ==================== Admin panel (/manage) — Phase 1 ====================
   Dedicated admin surface at the /manage path (served via _redirects).
   SECURITY MODEL (defense in depth):
   1. Nothing renders until /api/admin/verify confirms is_admin() server-side
      using the visitor's own Supabase JWT (the client-side email list is UI
      sugar only and is never trusted here).
   2. Every data call goes through SECURITY DEFINER admin_* RPCs that re-check
      is_admin() inside the database — copied HTML/JS alone yields zero data.
   3. Successful verifications are written to admin_audit_log (who / when / IP).
   4. Idle 30 minutes -> forced sign-out. */

let apVerified = null;   /* { email } once /api/admin/verify passes this load */
let apPopBound = false;
let apIdleArmed = false;
let apIdleTimer = null;

function isPanelPath() { return window.location.pathname.indexOf('/manage') === 0; }
function apSubpath() {
  const parts = window.location.pathname.replace(/^\/manage\/?/, '').split('/').filter(Boolean);
  return { section: parts[0] || 'dashboard', arg: parts[1] ? decodeURIComponent(parts[1]) : '' };
}
function apGo(section, arg) {
  let url = '/manage';
  if (section && section !== 'dashboard') url += '/' + section;
  if (arg) url += '/' + encodeURIComponent(arg);
  if (window.location.pathname !== url) window.history.pushState({}, '', url);
  renderAdminPanel();
}
/* Lightweight boot: session -> server verify. Never trusts client state. */
async function apBoot() {
  if (!sb) return { ok: false, reason: 'nodb' };
  let sess = null;
  try { const r = await sb.auth.getSession(); sess = r.data.session; } catch (e) {}
  if (!sess || !sess.access_token) return { ok: false, reason: 'login' };
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + sess.access_token },
    });
    if (res.ok) {
      const j = await res.json();
      if (j && j.ok) return { ok: true, email: j.email || '' };
    }
  } catch (e) {}
  return { ok: false, reason: 'denied' };
}
function apArmIdle() {
  if (apIdleArmed) return;
  apIdleArmed = true;
  const reset = function () {
    if (apIdleTimer) clearTimeout(apIdleTimer);
    apIdleTimer = setTimeout(function () {
      try { sb.auth.signOut(); } catch (e) {}
      window.location.href = '/manage';
    }, 30 * 60 * 1000);
  };
  ['click', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, reset, { passive: true });
  });
  reset();
}
function apShell(active, bodyHTML) {
  const items = [['dashboard', '📊 Dashboard'], ['users', '👥 Users'], ['daily', '📊 Daily study'], ['teachers', '🍎 Teachers'], ['telegram', '🤖 Telegram']];
  const nav = items.map(function (it) {
    const href = '/manage' + (it[0] === 'dashboard' ? '' : '/' + it[0]);
    return '<a href="' + href + '" data-apnav="' + it[0] + '"' +
      (active === it[0] ? ' class="on"' : '') + '>' + it[1] + '</a>';
  }).join('');
  return '<div class="ap-wrap"><aside class="ap-side">' +
    '<div class="ap-brand">🛠 Admin panel</div>' +
    (apVerified ? '<div class="ap-who">' + esc(apVerified.email) + '</div>' : '') +
    '<nav class="ap-nav">' + nav + '</nav>' +
    '<div class="ap-foot"><button class="ap-logout" id="ap-logout" type="button">Sign out</button>' +
    '<div class="ap-note">audited access</div></div>' +
    '</aside><main class="ap-main">' + bodyHTML + '</main></div>';
}
function apWireChrome(v) {
  v.querySelectorAll('[data-apnav]').forEach(function (a) {
    a.addEventListener('click', function (ev) { ev.preventDefault(); apGo(a.getAttribute('data-apnav')); });
  });
  const out = v.querySelector('#ap-logout');
  if (out) out.addEventListener('click', function () {
    try { sb.auth.signOut(); } catch (e) {}
    apVerified = null;
    window.location.href = '/manage';
  });
}
function apLoginHTML() {
  return '<div class="ap-center"><div class="ap-login card">' +
    '<h1>🛠 Admin panel</h1><p class="muted">Restricted area. Sign in with an administrator account.</p>' +
    '<label>Email<input type="email" id="ap-email" autocomplete="username"></label>' +
    '<label>Password<input type="password" id="ap-pass" autocomplete="current-password"></label>' +
    '<div class="ap-err" id="ap-err"></div>' +
    '<button class="btn-primary" id="ap-login-btn" type="button">Sign in</button>' +
    '</div></div>';
}
function apDeniedHTML() {
  return '<div class="ap-center"><div class="ap-login card">' +
    '<h1>⛔ Access denied</h1>' +
    '<p class="muted">This area is restricted to administrators. If you believe this is a mistake, sign in with a different account.</p>' +
    '<button class="btn-primary" id="ap-denied-out" type="button">Sign out &amp; switch account</button>' +
    '</div></div>';
}
function apWireLogin(v) {
  const btn = v.querySelector('#ap-login-btn');
  const denied = v.querySelector('#ap-denied-out');
  if (denied) denied.addEventListener('click', function () {
    try { sb.auth.signOut(); } catch (e) {}
    apVerified = null;
    window.location.href = '/manage';
  });
  if (!btn || !sb) return;
  const go = async function () {
    const err = v.querySelector('#ap-err');
    const email = (v.querySelector('#ap-email').value || '').trim();
    const pass = v.querySelector('#ap-pass').value || '';
    if (err) err.textContent = '';
    btn.disabled = true;
    try {
      const r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw r.error;
      apVerified = null;
      renderAdminPanel();
    } catch (e) {
      if (err) err.textContent = 'Sign-in failed: ' + ((e && e.message) || e);
      btn.disabled = false;
    }
  };
  btn.addEventListener('click', go);
  v.querySelector('#ap-pass').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
}
function apDaysBetween(a, b) {
  return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
}
function apBarsSVG(rows, getVal, color, label) {
  const W = 620, H = 150, padL = 8, padB = 20, padT = 18;
  const vals = rows.map(getVal);
  const max = Math.max.apply(null, vals.concat([1]));
  const bw = (W - padL * 2) / Math.max(1, rows.length);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ap-chart" role="img" aria-label="' + esc(label) + '">';
  rows.forEach(function (r, i) {
    const h = Math.max(1, (H - padB - padT) * (vals[i] / max));
    const x = padL + i * bw + 1;
    const y = H - padB - h;
    s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) +
      '" height="' + h.toFixed(1) + '" rx="2" fill="' + color + '"><title>' + esc(String(r.day)) + ': ' + vals[i] + '</title></rect>';
  });
  s += '<text x="' + padL + '" y="13" class="ap-chart-cap">' + esc(label) + ' · max ' + max + '</text></svg>';
  return s;
}
function apKpi(label, value, sub) {
  return '<div class="ap-kpi"><div class="ap-kpi-v">' + value + '</div>' +
    '<div class="ap-kpi-l">' + label + '</div>' +
    (sub ? '<div class="ap-kpi-s">' + sub + '</div>' : '') + '</div>';
}
/* ---------------- admin panel: dashboard ---------------- */
let apMetric = 'dau';
const AP_METRIC_COLORS = { dau: '#4f8ef7', new_users: '#22b07d', xp: '#7c5cd6', podcast_min: '#e09112', lessons: '#c84b31' };
function apChartHTML(series) {
  const m = ADM_METRICS.find(function (x) { return x.id === apMetric; });
  const label = m ? m.label : apMetric;
  const color = AP_METRIC_COLORS[apMetric] || '#4f8ef7';
  const tabs = ADM_METRICS.map(function (x) {
    return '<button type="button" class="adm-tab' + (x.id === apMetric ? ' on' : '') + '" data-apmetric="' + x.id + '">' + x.label + '</button>';
  }).join('');
  return '<div class="adm-tabs" style="margin-bottom:.6rem">' + tabs + '</div>' +
    apBarsSVG(series, function (r) { return Number(r[apMetric]) || 0; }, color, label);
}
function apWireMetricTabs(v, series) {
  v.querySelectorAll('[data-apmetric]').forEach(function (b) {
    b.addEventListener('click', function () {
      apMetric = b.getAttribute('data-apmetric');
      const host = v.querySelector('#ap-chart');
      if (host) { host.innerHTML = apChartHTML(series); apWireMetricTabs(v, series); }
    });
  });
}
function apBoardHTML(board) {
  if (!board.length) return '<div class="empty">No approved teachers yet.</div>';
  return '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Teacher</th><th>Students</th><th>Active 7d</th><th>XP 7d</th><th>Code</th></tr></thead><tbody>' +
    board.map(function (t) {
      return '<tr><td><b>' + esc(t.display_name || '?') + '</b></td><td>' + (t.students || 0) + '</td><td>' +
        (t.active_7d || 0) + '</td><td>' + (t.xp_7d || 0) + '</td><td><code>' + esc(t.ref_code || '') + '</code></td></tr>';
    }).join('') + '</tbody></table></div>';
}
function apFunnelHTML(steps, cohorts) {
  let html = '';
  if (steps.length) {
    const base = Number((steps[0] || {}).users) || 1;
    html += '<div class="card"><h3>📉 Signup funnel <span class="muted" style="font-weight:400;font-size:0.8rem">(last 30 days)</span></h3>' +
      '<div class="adm-funnel">' + steps.map(function (s) {
        const n = Number(s.users) || 0;
        const pct = Math.round(n / base * 100);
        return '<div class="adm-funnel-row"><span>' + esc(s.step) + '</span>' +
          '<div class="adm-funnel-bar"><div style="width:' + pct + '%"></div></div>' +
          '<b>' + n + '</b><span class="muted">' + pct + '%</span></div>';
      }).join('') + '</div></div>';
  }
  if (cohorts.length) {
    html += '<div class="card"><h3>🔁 Cohort retention <span class="muted" style="font-weight:400;font-size:0.8rem">(% active in weeks 1–4 after signup)</span></h3>' +
      '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Cohort</th><th>Users</th><th>W1</th><th>W2</th><th>W3</th><th>W4</th></tr></thead><tbody>' +
      cohorts.map(function (c) {
        const cell = function (val) {
          val = Number(val) || 0;
          const cls = val >= 40 ? 'hot' : (val >= 20 ? 'warm' : 'cold');
          return '<td><span class="adm-coh ' + cls + '">' + val + '%</span></td>';
        };
        return '<tr><td class="muted">' + esc(c.cohort) + '</td><td>' + c.users + '</td>' +
          cell(c.w1) + cell(c.w2) + cell(c.w3) + cell(c.w4) + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  return html;
}
async function apRenderDashboard(v) {
  v.innerHTML = apShell('dashboard',
    '<div class="ap-head"><h1>Dashboard</h1><p class="muted">Whole-product overview.</p></div>' +
    '<div class="empty">Loading…</div>');
  apWireChrome(v);
  try {
    const rs = await Promise.all([
      sb.rpc('admin_overview'),
      sb.rpc('admin_daily_series', { p_days: 30 }),
      sb.rpc('admin_user_stats'),
      sb.rpc('admin_teacher_board'),
      sb.rpc('admin_funnel').then(function (r) { return r.data || []; }, function () { return []; }),
      sb.rpc('admin_cohorts').then(function (r) { return r.data || []; }, function () { return []; }),
    ]);
    if (rs[0].error) throw rs[0].error;
    if (rs[1].error) throw rs[1].error;
    if (rs[2].error) throw rs[2].error;
    if (rs[3].error) throw rs[3].error;
    const ov = (rs[0].data && rs[0].data[0]) || {};
    const series = rs[1].data || [];
    const users = rs[2].data || [];
    const board = rs[3].data || [];
    const today = todayStr();
    const atRisk = users
      .filter(function (u) { return u.last_active && apDaysBetween(today, String(u.last_active).slice(0, 10)) >= 7; })
      .sort(function (a, b) { return String(a.last_active).localeCompare(String(b.last_active)); })
      .slice(0, 12);
    v.innerHTML = apShell('dashboard',
      '<div class="ap-head"><h1>Dashboard</h1><p class="muted">Whole-product overview.</p></div>' +
      '<div class="ap-kpis">' +
      apKpi('Total users', ov.total_users || 0, (ov.new_7d || 0) + ' new in 7d') +
      apKpi('Active today', ov.dau || 0, (ov.wau || 0) + ' in 7d') +
      apKpi('XP · 30d', ov.xp_30d || 0, '') +
      apKpi('Lessons · 30d', ov.lessons_30d || 0, '') +
      apKpi('Podcast hrs · 30d', ov.podcast_hours_30d || 0, '') +
      apKpi('Teachers', (ov.total_teachers || 0) + ' approved', (ov.pending_teachers || 0) + ' pending') +
      '</div>' +
      '<div class="card"><h3>Product activity · 30 days</h3><div id="ap-chart">' + apChartHTML(series) + '</div></div>' +
      '<div class="card"><h3>👩‍🏫 Teacher leaderboard</h3>' + apBoardHTML(board) + '</div>' +
      apFunnelHTML(rs[4], rs[5]) +
      '<div class="card"><h3>⚠️ At risk — inactive 7+ days (' + atRisk.length + ')</h3>' +
      (atRisk.length ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>User</th><th>Level</th><th>Last active</th><th>Days idle</th><th>XP total</th></tr></thead><tbody>' +
      atRisk.map(function (u) {
        const idle = apDaysBetween(today, String(u.last_active).slice(0, 10));
        return '<tr data-apuser="' + esc(u.user_id) + '"><td><b>' + esc(u.display_name || (u.email || '?').split('@')[0]) +
          '</b><br><small class="muted">' + esc(u.email || '') + '</small></td>' +
          '<td>' + esc(String(u.level || '—').toUpperCase()) + '</td>' +
          '<td>' + esc(String(u.last_active).slice(0, 10)) + '</td>' +
          '<td><b>' + idle + '</b></td><td>' + (u.xp_total || 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Nobody idle. 🎉</div>') +
      '</div>');
    apWireChrome(v);
    apWireMetricTabs(v, series);
    apWireUserRows(v);
  } catch (e) {
    v.innerHTML = apShell('dashboard',
      '<div class="ap-head"><h1>Dashboard</h1></div>' +
      '<div class="empty">Could not load dashboard: ' + esc((e && e.message) || e) + '</div>');
    apWireChrome(v);
  }
}
function apWireUserRows(v) {
  v.querySelectorAll('[data-apuser]').forEach(function (tr) {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function () { apGo('users', tr.getAttribute('data-apuser')); });
  });
}
/* ---------------- admin panel: users ---------------- */
let apUserFilter = { q: '', level: '', teacher: '', activity: 'all', sort: 'recent' };
function apFilteredUsers(users) {
  const f = apUserFilter;
  let list = users.slice();
  const q = (f.q || '').toLowerCase().trim();
  if (q) list = list.filter(function (u) {
    return ((u.display_name || '') + ' ' + (u.email || '')).toLowerCase().indexOf(q) !== -1;
  });
  if (f.level) list = list.filter(function (u) { return normalizeLevel(u.level) === f.level; });
  if (f.teacher) list = list.filter(function (u) { return u.referred_by === f.teacher; });
  if (f.activity === 'active7') list = list.filter(function (u) { return u.last_active && u.last_active >= daysAgoStr(6); });
  if (f.activity === 'inactive30') list = list.filter(function (u) { return !u.last_active || u.last_active < daysAgoStr(29); });
  if (f.activity === 'never') list = list.filter(function (u) { return !u.last_active; });
  const sorts = {
    recent: function (a, b) { return new Date(b.created_at) - new Date(a.created_at); },
    xp_total: function (a, b) { return (b.xp_total || 0) - (a.xp_total || 0); },
    xp_7d: function (a, b) { return (b.xp_7d || 0) - (a.xp_7d || 0); },
    streak: function (a, b) { return (b.current_streak || 0) - (a.current_streak || 0); },
    active: function (a, b) { return String(b.last_active || '') > String(a.last_active || '') ? 1 : -1; }
  };
  list.sort(sorts[f.sort] || sorts.recent);
  return list;
}
function apUsersTableHTML(users) {
  const refCounts = {};
  users.forEach(function (u) { if (u.referred_by) refCounts[u.referred_by] = (refCounts[u.referred_by] || 0) + 1; });
  const refKeys = Object.keys(refCounts);
  const refSummary = refKeys.length
    ? '<p class="muted" style="margin:.2rem 0 .6rem">📣 Referrals: ' +
      refKeys.map(function (k) { return '📣 ' + esc(k) + ': <b>' + refCounts[k] + '</b>'; }).join(' &nbsp;·&nbsp; ') + '</p>' : '';
  const rows = apFilteredUsers(users).slice(0, 300);
  if (!rows.length) return refSummary + '<div class="empty">No users match.</div>';
  return refSummary +
    '<div class="muted" style="margin:.4rem 0">' + rows.length + ' users · tap a row for full detail</div>' +
    '<div class="ap-tablewrap"><table class="ap-table"><thead><tr>' +
    '<th>User</th><th>Level</th><th>🔥</th><th>XP</th><th>XP 7d</th><th>Min 30d</th><th>Last active</th><th>Joined</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (u) {
      return '<tr data-apuser="' + esc(u.user_id) + '"><td><b>' + esc(u.display_name || (u.email || '?').split('@')[0]) +
        '</b><br><small class="muted">' + esc(u.email || '') + (u.referred_by ? ' · 📣' + esc(u.referred_by) : '') + '</small></td>' +
        '<td>' + esc(String(u.level || '—').toUpperCase()) + '</td>' +
        '<td>' + (u.current_streak || 0) + '</td>' +
        '<td><b>' + (u.xp_total || 0) + '</b></td><td>' + (u.xp_7d || 0) + '</td>' +
        '<td>' + Math.round((Number(u.seconds_30d) || 0) / 60) + '</td>' +
        '<td>' + esc(u.last_active ? String(u.last_active).slice(0, 10) : '—') + '</td>' +
        '<td>' + esc(String(u.created_at || '').slice(0, 10)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
async function apRenderUsers(v) {
  v.innerHTML = apShell('users',
    '<div class="ap-head"><h1>Users</h1><p class="muted">Everyone on the product. Click a row for the full profile.</p></div>' +
    '<div class="adm-filters">' +
    '<input type="search" id="ap-q" placeholder="Search name or email…" value="' + esc(apUserFilter.q) + '" aria-label="Search users">' +
    '<select id="ap-f-level" aria-label="Filter by level"><option value="">All levels</option>' +
    LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (apUserFilter.level === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') + '</select>' +
    '<select id="ap-f-teacher" aria-label="Filter by teacher"><option value="">All teachers</option></select>' +
    '<select id="ap-f-activity" aria-label="Filter by activity">' +
    [['all', 'All activity'], ['active7', 'Active (7d)'], ['inactive30', 'Inactive (30d)'], ['never', 'Never active']].map(function (x) {
      return '<option value="' + x[0] + '"' + (apUserFilter.activity === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select>' +
    '<select id="ap-f-sort" aria-label="Sort users">' +
    [['recent', 'Newest'], ['xp_total', 'Total XP'], ['xp_7d', 'XP (7d)'], ['streak', 'Streak'], ['active', 'Last active']].map(function (x) {
      return '<option value="' + x[0] + '"' + (apUserFilter.sort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select>' +
    '</div>' +
    '<div id="ap-users-body"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const body = v.querySelector('#ap-users-body');
  let users = [];
  try {
    const r = await sb.rpc('admin_user_stats');
    if (r.error) throw r.error;
    users = r.data || [];
  } catch (e) {
    body.innerHTML = '<div class="empty">Could not load users: ' + esc((e && e.message) || e) + '</div>';
    return;
  }
  const tsel = v.querySelector('#ap-f-teacher');
  const codes = {};
  users.forEach(function (u) { if (u.referred_by) codes[u.referred_by] = 1; });
  Object.keys(codes).sort().forEach(function (c) {
    const o = document.createElement('option');
    o.value = c; o.textContent = '📣 ' + c;
    if (apUserFilter.teacher === c) o.selected = true;
    tsel.appendChild(o);
  });
  const paint = function () { body.innerHTML = apUsersTableHTML(users); apWireUserRows(v); };
  v.querySelector('#ap-q').addEventListener('input', function (ev) { apUserFilter.q = ev.target.value; paint(); });
  [['#ap-f-level', 'level'], ['#ap-f-teacher', 'teacher'], ['#ap-f-activity', 'activity'], ['#ap-f-sort', 'sort']].forEach(function (pair) {
    const el = v.querySelector(pair[0]);
    if (el) el.addEventListener('change', function () { apUserFilter[pair[1]] = el.value; paint(); });
  });
  paint();
}
async function apRenderUserDetail(v, id) {
  v.innerHTML = apShell('users',
    '<div class="ap-head"><a href="/manage/users" data-apnav="users" class="ap-back">← All users</a><h1>User</h1></div>' +
    '<div class="empty">Loading…</div>');
  apWireChrome(v);
  try {
    const r = await sb.rpc('admin_panel_user_detail', { p_user_id: id });
    if (r.error) throw r.error;
    const d = r.data;
    if (!d || !d.profile) throw new Error('No access or user not found.');
    const p = d.profile, t = d.totals || {}, sh = d.shadowing || {}, w = d.words || {};
    const recent = (sh.recent || []).map(function (a) {
      return '<tr><td>' + esc(String(a.lesson_date || '').slice(0, 10)) + '</td><td>' + (a.score || 0) + '%</td>' +
        '<td class="muted">' + esc(String(a.created_at || '').slice(0, 16).replace('T', ' ')) + '</td></tr>';
    }).join('');
    /* Podcast summaries (Alireza, 2026-10-15): direct query — the RPC predates the table. */
    let sumRows = [];
    try {
      const sr = await sb.from('summary_attempts').select('lesson_date,score,duration_sec,created_at')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(20);
      if (!sr.error) sumRows = sr.data || [];
    } catch (e) {}
    const sumRecent = sumRows.map(function (a) {
      return '<tr><td>' + esc(String(a.lesson_date || '').slice(0, 10)) + '</td><td>' + (a.score || 0) + '</td>' +
        '<td>' + (a.duration_sec || 0) + 's</td>' +
        '<td class="muted">' + esc(String(a.created_at || '').slice(0, 16).replace('T', ' ')) + '</td></tr>';
    }).join('');
    v.innerHTML = apShell('users',
      '<div class="ap-head"><a href="/manage/users" data-apnav="users" class="ap-back">← All users</a>' +
      '<h1>' + esc(p.display_name || (p.email || '?').split('@')[0]) + '</h1>' +
      '<p class="muted">' + esc(p.email || '') + ' · joined ' + esc(String(p.created_at || '').slice(0, 10)) +
      (p.referred_by ? ' · 📣 ' + esc(p.referred_by) : '') + '</p></div>' +
      '<div class="ap-cards">' +
      '<div class="card"><h3>Profile</h3>' +
      '<div class="ap-kv"><span>Level</span><b>' + esc(String(p.level || '—').toUpperCase()) + '</b></div>' +
      '<div class="ap-kv"><span>Streak</span><b>🔥 ' + (p.current_streak || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Active days</span><b>' + (t.active_days || 0) + '</b></div>' +
      '<div class="ap-kv"><span>First / last active</span><b>' + esc(String(t.first_active || '—').slice(0, 10)) + ' → ' + esc(String(t.last_active || '—').slice(0, 10)) + '</b></div>' +
      '<label class="ap-levelset">Set level <select id="ap-setlevel">' +
      '<option value="">—</option>' + LEVELS.map(function (lv) {
        return '<option value="' + lv + '"' + (String(p.level) === lv ? ' selected' : '') + '>' + levelLabel(lv) + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="card"><h3>Totals</h3>' +
      '<div class="ap-kv"><span>XP total</span><b>' + (t.xp_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Minutes in app</span><b>' + (t.minutes_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Lessons opened</span><b>' + (t.lessons_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Quizzes completed</span><b>' + (t.quizzes_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Podcast minutes</span><b>' + (t.podcast_min_total || 0) + '</b></div></div>' +
      '<div class="card"><h3>🎤 Shadowing</h3>' +
      '<div class="ap-kv"><span>Attempts</span><b>' + (sh.attempts || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Avg score</span><b>' + (sh.avg_score || 0) + '%</b></div>' +
      '<div class="ap-kv"><span>Listens</span><b>' + (sh.listens || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Saved words</span><b>' + (w.saved || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Mistakes</span><b>' + (w.mistakes || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Quiz attempts</span><b>' + (w.quiz_attempts || 0) + '</b></div></div>' +
      '</div>' +
      '<div class="card"><h3>Recent shadowing attempts</h3>' +
      (recent ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Lesson</th><th>Score</th><th>When</th></tr></thead><tbody>' + recent + '</tbody></table></div>'
        : '<div class="empty">No attempts yet.</div>') + '</div>' +
      '<div class="card"><h3>🎙️ Recent summary attempts</h3>' +
      (sumRecent ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Lesson</th><th>Score</th><th>Duration</th><th>When</th></tr></thead><tbody>' + sumRecent + '</tbody></table></div>'
        : '<div class="empty">No summaries yet.</div>') + '</div>' +
      '<div class="card" style="border-color:#F3C6C0"><h3 style="color:#B3382E">🗑 Danger zone</h3>' +
      '<p class="muted" style="margin:.2rem 0 .6rem">Permanently delete this user and <b>all</b> their data (profile, progress, XP, results, certificates and login) from the database. This cannot be undone.</p>' +
      ((state.user && id === state.user.id)
        ? '<div class="empty">You can\'t delete your own account.</div>'
        : '<button class="btn btn-sm" id="ap-delete-user" style="background:#FDECEA;color:#B3382E;border:1px solid #F3C6C0">Delete this user permanently</button>') +
      '</div>');
    apWireChrome(v);
    const sel = v.querySelector('#ap-setlevel');
    if (sel) sel.addEventListener('change', async function () {
      if (!sel.value) return;
      sel.disabled = true;
      try {
        const rr = await sb.rpc('admin_set_user_level', { p_user_id: id, p_level: sel.value });
        if (rr.error) throw rr.error;
        apRenderUserDetail(v, id);
      } catch (e) {
        alert('Could not set level: ' + ((e && e.message) || e));
        sel.disabled = false;
      }
    });
    const delBtn = v.querySelector('#ap-delete-user');
    if (delBtn) delBtn.addEventListener('click', function () { apDeleteUser(id, p); });
  } catch (e) {
    v.innerHTML = apShell('users',
      '<div class="ap-head"><a href="/manage/users" data-apnav="users" class="ap-back">← All users</a><h1>User</h1></div>' +
      '<div class="empty">Could not load user: ' + esc((e && e.message) || e) + '</div>');
    apWireChrome(v);
  }
}
/* Admin: permanently delete a user + all their data (admin_delete_user RPC).
   Double-guarded: confirm dialog + must type DELETE. */
async function apDeleteUser(id, p) {
  var name = (p && (p.display_name || (p.email || '?').split('@')[0])) || 'this user';
  if (!confirm('Permanently delete ' + name + ' (' + ((p && p.email) || '') + ')?\n\nALL their data will be removed from the database — profile, progress, XP, results, certificates and their login. This cannot be undone.')) return;
  var typed = prompt('Type DELETE to confirm permanent deletion of ' + name + ':');
  if (typed !== 'DELETE') { alert('Deletion cancelled — you must type DELETE exactly.'); return; }
  try {
    var r = await sb.rpc('admin_delete_user', { p_user: id });
    if (r.error) throw r.error;
    if (r.data !== true) throw new Error('Not allowed.');
    alert('✅ ' + name + ' has been permanently deleted.');
    window.location.assign('/manage/users');
  } catch (e) {
    var m = (e && e.message) || String(e);
    alert(/admin_delete_user/.test(m)
      ? 'Needs the database migration first (delete-user-migration.sql).'
      : 'Could not delete: ' + m);
  }
}
/* ---------------- admin panel: daily study ---------------- */
let apDaily = { day: todayStr(), range: 'day' };
async function apRenderDaily(v) {
  v.innerHTML = apShell('daily',
    '<div class="ap-head"><h1>📊 Daily study</h1><p class="muted">Who studied how much, per day or range.</p></div>' +
    '<div id="ap-daily-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const host = v.querySelector('#ap-daily-host');
  const nameOf = {};
  try {
    const u = await sb.rpc('admin_user_stats');
    (u.data || []).forEach(function (x) {
      nameOf[x.user_id] = { name: x.display_name || (x.email || '?').split('@')[0], level: x.level };
    });
  } catch (e) {}
  const paint = async function () {
    host.innerHTML = dailyStudyShell('apd', apDaily.day, apDaily.range, '📊 Daily study — who studied how much');
    const rangeSel = host.querySelector('#apd-daily-range');
    if (rangeSel) rangeSel.addEventListener('change', function () { apDaily.range = rangeSel.value; paint(); });
    const dayInput = host.querySelector('#apd-daily-day');
    if (dayInput) dayInput.addEventListener('change', function () { if (dayInput.value) { apDaily.day = dayInput.value; paint(); } });
    const body = host.querySelector('#apd-daily-body');
    const sum = host.querySelector('#apd-daily-sum');
    try {
      const f = await fetchStudyRange(apDaily.range, apDaily.day, null);
      const idSet = {};
      [f.statsById, f.triesById, f.listensById].forEach(function (m) {
        Object.keys(m).forEach(function (id) { idSet[id] = 1; });
      });
      const ids = Object.keys(idSet);
      const missing = ids.filter(function (id) { return !nameOf[id]; }).slice(0, 500);
      if (missing.length) {
        const pr = await sb.from('profiles').select('id,display_name,level').in('id', missing);
        (pr.data || []).forEach(function (p) { nameOf[p.id] = { name: p.display_name || '?', level: p.level }; });
      }
      const rows = ids.map(function (id) {
        const nm = nameOf[id] || { name: 'User ' + String(id).slice(0, 6), level: '' };
        return dailyStudyRow(id, f, nm.name, nm.level);
      }).filter(dailyStudyActive);
      rows.sort(function (a, b) { return b.min - a.min; });
      const totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
      if (sum) sum.textContent = rows.length + ' active · ' + totalMin + ' total min · ' + rangeLabel(apDaily.range);
      if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(apDaily.range) + '.');
    } catch (e) {
      if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
    }
  };
  await paint();
}
/* ---------------- admin panel: teachers ---------------- */
async function apRenderTeachers(v) {
  v.innerHTML = apShell('teachers',
    '<div class="ap-head"><h1>🍎 Teachers</h1><p class="muted">Requests, invite codes and manual add.</p></div>' +
    '<div id="ap-teachers-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const host = v.querySelector('#ap-teachers-host');
  try {
    const t = await sb.from('teachers').select('id,user_id,ref_code,display_name,status,requested_at,photo_url,experience_years,bio').order('requested_at', { ascending: true });
    if (t.error) throw t.error;
    const teachers = t.data || [];
    const ids = teachers.map(function (x) { return x.user_id; });
    const emailById = {};
    if (ids.length) {
      const p = await sb.from('profiles').select('id,email').in('id', ids);
      (p.data || []).forEach(function (x) { emailById[x.id] = x.email; });
    }
    const ur = await sb.rpc('admin_user_stats');
    const counts = {};
    (ur.data || []).forEach(function (u) { if (u.referred_by) counts[u.referred_by] = (counts[u.referred_by] || 0) + 1; });
    const pending = teachers.filter(function (x) { return x.status === 'pending'; });
    const active = teachers.filter(function (x) { return x.status === 'approved'; });
    const rejected = teachers.filter(function (x) { return x.status === 'rejected'; });
    host.innerHTML =
      '<div class="card"><h3>⏳ Pending requests (' + pending.length + ')</h3>' +
      (pending.length ? pending.map(function (x) {
        const sug = slugify(x.display_name);
        return '<div class="tch-admin-row"><div><b>' + esc(x.display_name) + '</b><br>' +
          '<span class="muted" style="font-size:0.8rem">' + esc(emailById[x.user_id] || '') + ' · ' + esc(String(x.requested_at || '').slice(0, 10)) + '</span></div>' +
          '<div class="tch-admin-actions"><input class="tch-code-input" id="aptcode-' + x.id + '" value="' + esc(sug) + '" maxlength="32" aria-label="Invite code">' +
          '<button class="btn btn-sm" data-apt-approve="' + x.id + '">Approve</button> ' +
          '<button class="btn btn-ghost btn-sm" data-apt-reject="' + x.id + '">Reject</button></div></div>';
      }).join('') : '<p class="muted">No pending requests.</p>') + '</div>' +
      (active.length ? '<div class="card"><h3>✓ Active teachers (' + active.length + ')</h3>' +
        active.map(function (x) {
          var hasProf = x.photo_url || x.experience_years || x.bio;
          var profHtml = hasProf
            ? '<div class="apt-prof">' +
              (x.photo_url ? '<img class="apt-prof-photo" src="' + esc(x.photo_url) + '" alt="">' : '') +
              '<div class="apt-prof-txt">' +
              (x.experience_years ? '<div>🎓 <b>' + esc(String(x.experience_years)) + '</b> years teaching experience</div>' : '<div class="muted">Experience not set</div>') +
              (x.bio ? '<div class="muted">' + esc(x.bio) + '</div>' : '<div class="muted">No bio yet</div>') +
              '</div></div>'
            : '<div class="muted" style="font-size:0.8rem">⚠️ No public profile yet — students see a default card.</div>';
          return '<div class="tch-admin-row"><div style="flex:1;min-width:0"><b>' + esc(x.display_name) + '</b><br>' +
            '<span class="muted" style="font-size:0.8rem"><code>' + esc(x.ref_code) + '</code> · ' + (counts[x.ref_code] || 0) + ' students</span>' +
            '<div style="margin-top:0.45rem">' + profHtml + '</div></div>' +
            '<div class="tch-admin-actions"><button class="btn btn-ghost btn-sm" data-apt-reject="' + x.id + '">Remove</button></div></div>';
        }).join('') + '</div>' : '') +
      (rejected.length ? '<p class="muted">Rejected (' + rejected.length + ')</p>' : '') +
      '<div class="card"><h3>Add teacher manually</h3><p class="muted" style="font-size:0.85rem">They must already have an account.</p>' +
      '<form id="apt-add-form" class="tch-add-form">' +
      '<input id="apt-email" type="email" placeholder="teacher@email.com" required aria-label="Email">' +
      '<input id="apt-name" type="text" placeholder="Display name" maxlength="40" required aria-label="Display name">' +
      '<input id="apt-code" type="text" placeholder="invite-code" maxlength="32" required aria-label="Invite code">' +
      '<button class="btn btn-sm" type="submit">Add</button></form>' +
      '<div class="form-error" id="apt-error" role="alert"></div></div>';
    host.querySelectorAll('[data-apt-approve]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const id = b.getAttribute('data-apt-approve');
        const input = host.querySelector('#aptcode-' + CSS.escape(id));
        const code = slugify(input ? input.value : '');
        b.disabled = true;
        try {
          const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'approved', p_ref_code: code });
          if (r.error) throw r.error;
          apRenderTeachers(v);
        } catch (e) { alert('Approve failed: ' + (e.message || e)); b.disabled = false; }
      });
    });
    host.querySelectorAll('[data-apt-reject]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!window.confirm('Remove / reject this teacher? Their students keep their accounts.')) return;
        const id = b.getAttribute('data-apt-reject');
        try {
          const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'rejected', p_ref_code: '' });
          if (r.error) throw r.error;
          apRenderTeachers(v);
        } catch (e) { alert('Failed: ' + (e.message || e)); }
      });
    });
    const form = host.querySelector('#apt-add-form');
    if (form) form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const errEl = host.querySelector('#apt-error');
      const email = (host.querySelector('#apt-email').value || '').trim();
      const name = (host.querySelector('#apt-name').value || '').trim();
      const code = slugify((host.querySelector('#apt-code').value || '').trim());
      if (errEl) errEl.textContent = '';
      if (!email || name.length < 2 || !code) { if (errEl) errEl.textContent = 'Fill all three fields.'; return; }
      try {
        const r = await sb.rpc('admin_create_teacher', { p_email: email, p_display_name: name, p_ref_code: code });
        if (r.error) throw r.error;
        apRenderTeachers(v);
      } catch (e) { if (errEl) errEl.textContent = 'Failed: ' + (e.message || e); }
    });
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load teachers: ' + esc((e && e.message) || e) + '</div>';
  }
}
/* ---------------- admin panel: telegram bot ---------------- */
async function apRenderTelegram(v) {
  v.innerHTML = apShell('telegram',
    '<div class="ap-head"><h1>🤖 Telegram Bot</h1><p class="muted">@muse_eng_bot schedule &amp; content.</p></div>' +
    '<div id="ap-bot-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const host = v.querySelector('#ap-bot-host');
  let cfg = null;
  try {
    const r = await sb.from('bot_config').select('*').eq('id', 1).maybeSingle();
    if (r.error) throw r.error;
    cfg = r.data;
  } catch (e) { cfg = null; }
  if (!cfg) {
    host.innerHTML = '<div class="empty">Bot config table not found. Run <code>supabase-bot-config-migration.sql</code> in the Supabase SQL Editor first.</div>';
    return;
  }
  const lv = cfg.levels || [];
  const cb = function (id, label, isOn) {
    return '<label class="bot-check"><input type="checkbox" id="' + id + '"' + (isOn ? ' checked' : '') + '> ' + label + '</label>';
  };
  host.innerHTML =
    '<div class="card"><h3>Schedule &amp; content</h3><div class="bot-grid">' +
    '<label class="bot-row"><span>Bot enabled</span><input type="checkbox" id="apb-enabled" class="bot-switch"' + (cfg.enabled ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Posting hours (Tehran)</span><span class="bot-hours"><input type="number" id="apb-start" min="0" max="23" value="' + cfg.start_hour + '"> – <input type="number" id="apb-end" min="1" max="24" value="' + cfg.end_hour + '"></span></label>' +
    '<label class="bot-row"><span>Post every N hours</span><input type="number" id="apb-interval" min="1" max="12" value="' + cfg.interval_hours + '"></label>' +
    '<div class="bot-row"><span>Content</span><span class="bot-checks">' + cb('apb-words', '📇 Word cards', cfg.send_words) + cb('apb-quiz', '❓ Quizzes', cfg.send_quiz) + cb('apb-podcast', '🎧 Podcast', cfg.send_podcast) + cb('apb-shadowing', '🗣️ Shadowing', cfg.send_shadowing) + '</span></div>' +
    '<label class="bot-row"><span>Podcast every N posts</span><input type="number" id="apb-podevery" min="1" max="24" value="' + cfg.podcast_every + '"></label>' +
    '<label class="bot-row"><span>Shadowing every N posts</span><input type="number" id="apb-shevery" min="1" max="24" value="' + cfg.shadowing_every + '"></label>' +
    '<label class="bot-row"><span>📢 Promo banners</span><input type="checkbox" id="apb-promo" class="bot-switch"' + (cfg.send_promo ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Promo every N hours</span><input type="number" id="apb-promoevery" min="1" max="12" value="' + cfg.promo_every_hours + '"></label>' +
    '<label class="bot-row"><span>Quiz every N posts</span><input type="number" id="apb-quizevery" min="2" max="12" value="' + cfg.quiz_every + '"></label>' +
    '<div class="bot-row"><span>Word levels</span><span class="bot-checks">' +
    ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (l) { return cb('apb-lv-' + l, l.toUpperCase(), lv.indexOf(l) !== -1); }).join('') +
    '</span></div>' +
    '</div>' +
    '<div style="margin-top:0.7rem"><button class="btn btn-sm" id="apb-save">Save bot settings</button> ' +
    '<span class="muted" id="apb-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
    '<p class="muted" style="font-size:0.8rem;margin:0.6rem 0 0">Settings take effect on the next hourly bot run. Hours are Asia/Tehran. Promo banners (jpg/png/webp) go in <code>media/promo/</code> — a promo replaces the regular post in its slot.</p></div>' +
    '<div class="card"><h3>💬 Per-chat settings</h3><p class="muted" style="font-size:0.85rem">Custom footer &amp; pause per group/channel. Chats you never configure keep the global default footer.</p>' +
    '<div id="apb-chat-list"><div class="empty">Loading…</div></div></div>';
  const saveBtn = host.querySelector('#apb-save');
  if (saveBtn) saveBtn.addEventListener('click', function () { apSaveBot(host, saveBtn); });
  apLoadBotChats(host);
}
async function apSaveBot(host, btn) {
  const status = host.querySelector('#apb-status');
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const val = function (id) { const el = host.querySelector('#' + id); return el ? el.value : ''; };
  const isOn = function (id) { const el = host.querySelector('#' + id); return !!(el && el.checked); };
  const start = parseInt(val('apb-start'), 10), end = parseInt(val('apb-end'), 10);
  const interval = parseInt(val('apb-interval'), 10), qe = parseInt(val('apb-quizevery'), 10);
  const pe = parseInt(val('apb-promoevery'), 10);
  const pode = parseInt(val('apb-podevery'), 10), she = parseInt(val('apb-shevery'), 10);
  const levels = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].filter(function (l) { return isOn('apb-lv-' + l); });
  if (!(start >= 0 && start < 24 && end > 0 && end <= 24 && start < end)) { say('Start hour must be before end hour.', false); return; }
  if (!(interval >= 1 && interval <= 12)) { say('Interval must be 1–12.', false); return; }
  if (!(qe >= 2 && qe <= 12)) { say('Quiz-every must be 2–12.', false); return; }
  if (!(pe >= 1 && pe <= 12)) { say('Promo-every must be 1–12.', false); return; }
  if (!(pode >= 1 && pode <= 24) || !(she >= 1 && she <= 24)) { say('Podcast/Shadowing-every must be 1–24.', false); return; }
  if (!isOn('apb-words') && !isOn('apb-quiz') && !isOn('apb-podcast') && !isOn('apb-shadowing')) { say('Enable at least one content type.', false); return; }
  if (!levels.length) { say('Pick at least one level.', false); return; }
  if (btn) btn.disabled = true;
  say('Saving…', true);
  try {
    const r = await sb.from('bot_config').upsert({
      id: 1, enabled: isOn('apb-enabled'), start_hour: start, end_hour: end,
      interval_hours: interval, send_words: isOn('apb-words'), send_quiz: isOn('apb-quiz'),
      send_podcast: isOn('apb-podcast'), send_shadowing: isOn('apb-shadowing'),
      podcast_every: pode, shadowing_every: she,
      send_promo: isOn('apb-promo'), promo_every_hours: pe,
      quiz_every: qe, levels: levels, updated_at: new Date().toISOString()
    });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
  if (btn) btn.disabled = false;
}
async function apLoadBotChats(host) {
  const list = host.querySelector('#apb-chat-list');
  if (!list) return;
  let rows;
  try {
    const r = await sb.from('bot_chat_config').select('chat_id,title,footer_text,paused').order('title');
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    list.innerHTML = '<p class="muted">Per-chat table not found. Run <code>supabase-bot-chat-config-migration.sql</code> in the Supabase SQL Editor first.</p>';
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<p class="muted">No chats tracked yet — they appear here automatically after the next bot run.</p>';
    return;
  }
  list.innerHTML = rows.map(function (r) {
    const cid = String(r.chat_id);
    const ft = r.footer_text;
    const mode = (ft === null || ft === undefined) ? 'global' : (ft === '' ? 'none' : 'custom');
    return '<div class="bot-chat-row" data-chat="' + esc(cid) + '">' +
      '<div class="bot-chat-head"><b>' + esc(r.title || '(untitled)') + '</b> <code>' + esc(cid) + '</code>' +
      (r.paused ? ' <span style="background:#7C6AF0;color:#fff;border-radius:99px;padding:0.1rem 0.55rem;font-size:0.72rem">paused</span>' : '') + '</div>' +
      '<label class="bot-row"><span>Footer</span><select data-apbmode="' + esc(cid) + '">' +
      '<option value="global"' + (mode === 'global' ? ' selected' : '') + '>Global default footer</option>' +
      '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom footer</option>' +
      '<option value="none"' + (mode === 'none' ? ' selected' : '') + '>No footer</option>' +
      '</select></label>' +
      '<textarea data-apbft="' + esc(cid) + '" rows="2" style="' + (mode === 'custom' ? '' : 'display:none') + '" placeholder="Custom footer text for this chat…">' + esc(mode === 'custom' ? ft : '') + '</textarea>' +
      '<div class="bot-chat-actions"><label class="bot-check"><input type="checkbox" data-apbpaused="' + esc(cid) + '"' + (r.paused ? ' checked' : '') + '> Pause this chat</label> ' +
      '<button class="btn btn-sm" data-apbchatsave="' + esc(cid) + '">Save this chat</button> ' +
      '<span class="muted bot-chat-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
      '</div>';
  }).join('');
  list.querySelectorAll('[data-apbmode]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      const ta = list.querySelector('[data-apbft="' + sel.getAttribute('data-apbmode') + '"]');
      if (ta) ta.style.display = sel.value === 'custom' ? '' : 'none';
    });
  });
  list.querySelectorAll('[data-apbchatsave]').forEach(function (btn) {
    btn.addEventListener('click', function () { apSaveBotChat(host, btn); });
  });
}
async function apSaveBotChat(host, btn) {
  const cid = btn.getAttribute('data-apbchatsave');
  const row = btn.closest('.bot-chat-row');
  const status = row ? row.querySelector('.bot-chat-status') : null;
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const q = function (attr) { return host.querySelector('[' + attr + '="' + cid + '"]'); };
  const modeEl = q('data-apbmode');
  const ta = q('data-apbft');
  const pa = q('data-apbpaused');
  const mode = modeEl ? modeEl.value : 'global';
  const paused = !!(pa && pa.checked);
  let footer_text = null;
  if (mode === 'custom') {
    footer_text = ta ? ta.value.trim() : '';
    if (!footer_text) { say('Custom footer is empty — pick Global default or No footer instead.', false); return; }
  } else if (mode === 'none') {
    footer_text = '';
  }
  say('Saving…', true);
  try {
    const r = await sb.from('bot_chat_config').upsert(
      { chat_id: cid, footer_text: footer_text, paused: paused, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
    apLoadBotChats(host);
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
}
async function renderAdminPanel() {
  document.body.classList.add('ap-mode');
  if (!apPopBound) {
    apPopBound = true;
    window.addEventListener('popstate', function () { if (isPanelPath()) renderAdminPanel(); if (isTeachersPath()) renderTeachers(); });
  }
  apArmIdle();
  const v = document.getElementById('view');
  window.scrollTo(0, 0);
  if (!apVerified) {
    v.innerHTML = apShell('dashboard', '<div class="empty" style="margin-top:3rem">🔐 Verifying admin access…</div>');
    apWireChrome(v);
    const chk = await apBoot();
    if (!chk.ok) {
      v.innerHTML = apShell('dashboard', chk.reason === 'login' ? apLoginHTML() : apDeniedHTML());
      apWireChrome(v);
      apWireLogin(v);
      hideSplashSoon();
      return;
    }
    apVerified = { email: chk.email };
  }
  const sp = apSubpath();
  if (sp.section === 'users' && sp.arg) apRenderUserDetail(v, sp.arg);
  else if (sp.section === 'users') apRenderUsers(v);
  else if (sp.section === 'daily') apRenderDaily(v);
  else if (sp.section === 'teachers') apRenderTeachers(v);
  else if (sp.section === 'telegram') apRenderTelegram(v);
  else apRenderDashboard(v);
  hideSplashSoon();
}

document.addEventListener('DOMContentLoaded', init);

/* Test/debug hooks (harmless in production). */
window.MuseApp = {
  state: state, player: player, showModal: showModal, closeModal: closeModal,
  detectCountry: detectCountry, maybeShowWelcome: maybeShowWelcome,
  renderSignin: renderSignin, renderProfile: renderProfile,
  ensureCountrySaved: ensureCountrySaved,
  queuePointsPopup: queuePointsPopup, ensureNickname: ensureNickname,
  renderChallenge: renderChallenge, awardPoints: awardPoints, demoLogin: demoLogin,
  launchCelebration: launchCelebration, maybeShowInboxPrompt: maybeShowInboxPrompt,
  renderInbox: renderInbox, loadAdminBot: loadAdminBot, saveAdminBot: saveAdminBot,
};

/* ---------------- vocabulary (#/vocab) ----------------
   66 deduped categories from English Vocabulary in Use
   (Elementary A1-A2, Pre-intermediate & Intermediate A2-B1, Upper-intermediate B2).
   Entry: home banner (#home-vocab-wrap) -> #/vocab (hub) -> #/vocab/<slug>.
   Practice quiz: up to 10 questions, word -> Persian meaning, practice mode (no XP). */

var VC_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2' },
  { id: 'b1', label: 'B1' }, { id: 'b2', label: 'B2' }
];
var VC_LV_COLORS = { a1: '#D9A21B', a2: '#E8833A', b1: '#3FA46A', b2: '#F26522' };
var VC_LV_SUB = {
  all: 'Every vocabulary topic from A1 to B2 \u2014 words with meanings and examples.',
  a1: 'Essential everyday words with meanings and examples.',
  a2: 'Everyday words with meanings and examples.',
  b1: 'Intermediate words with meanings and examples.',
  b2: 'Upper-intermediate words with meanings and examples.'
};

function vocabProgress() {
  var p = lsGet('muse_vocab_v1');
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
}
function setVocabProgress(p) { lsSet('muse_vocab_v1', p); }

function loadVocabCats() {
  if (state.vocabCats) return Promise.resolve(state.vocabCats);
  return fetch('/data/vocab/categories.json').then(function (res) {
    if (!res.ok) throw new Error('vocab categories missing');
    return res.json();
  }).then(function (data) {
    state.vocabCats = data;
    return data;
  });
}
function loadVocabWords(slug) {
  state.vocabWords = state.vocabWords || {};
  if (state.vocabWords[slug]) return Promise.resolve(state.vocabWords[slug]);
  return fetch('/data/vocab/by-category/' + slug + '.json').then(function (res) {
    if (!res.ok) throw new Error('vocab category missing');
    return res.json();
  }).then(function (data) {
    state.vocabWords[slug] = data;
    return data;
  });
}
function vcLvBadge(lv) {
  var label = lv === 'all' ? 'A1\u2013B2' : lv.toUpperCase();
  var color = lv === 'all' ? '#8A93A6' : (VC_LV_COLORS[lv] || '#8A93A6');
  return '<span class="vc-lv" style="background:' + color + '">' + label + '</span>';
}
function vcLevelBadges(levels) {
  return (levels || []).map(vcLvBadge).join('');
}

function renderVocab(v, slug) {
  if (slug) { renderVocabCat(v, slug); return; }
  if (!state.vcFilter) state.vcFilter = { level: normalizeLevel(state.user && state.user.level) || 'a1', q: '' };
  if (state.vcFilter.level === 'c1' || state.vcFilter.level === 'c2') state.vcFilter.level = 'b2';
  var f = state.vcFilter;
  var totalWords = (state.vocabCats || []).reduce(function (a, c) { return a + (c.word_count || 0); }, 0);
  v.innerHTML = '<div class="vc-hub">' +
    '<div class="vc-crumb"><span>\uD83D\uDCDA</span> Vocabulary <span class="vc-crumb-sep">\u203A</span> <b id="vc-crumb-lv"></b></div>' +
    '<div class="vc-hero"><div class="vc-hero-t">' +
      '<h1>Vocabulary <em>Builder</em></h1>' +
      '<p>9,136 words from the Vocabulary in Use books, grouped into 69 topics \u2014 with meanings and examples.</p>' +
    '</div><div class="vc-mascot" aria-hidden="true">\uD83D\uDCDA</div></div>' +
    '<div class="vc-feats">' +
      '<span class="vc-feat"><i>\uD83D\uDCD6</i><b>Real<br>meanings</b></span>' +
      '<span class="vc-feat"><i>\uD83D\uDCAC</i><b>Example<br>sentences</b></span>' +
      '<span class="vc-feat"><i>\uD83C\uDFAF</i><b>Quick<br>practice</b></span>' +
    '</div>' +
    '<div class="vc-filters" role="tablist">' +
    VC_LEVELS.map(function (lv) {
      return '<button class="vc-pill vc-pill-lv-' + lv.id + (f.level === lv.id ? ' on' : '') + '" data-vlevel="' + lv.id + '">' + lv.label + '</button>';
    }).join('') + '</div>' +
    '<div class="vc-search"><span class="vc-search-ico">\uD83D\uDD0D</span>' +
      '<input id="vc-search" type="search" placeholder="Search vocabulary topics..." value="' + esc(f.q) + '" aria-label="Search vocabulary topics"></div>' +
    '<div class="vc-sec"><span id="vc-sec-lv"></span>' +
      '<div class="vc-sec-t"><h2>Vocabulary Topics</h2><p id="vc-sec-sub"></p></div>' +
      '<span class="vc-count" id="vc-count"></span></div>' +
    '<div id="vc-list"><div class="empty">Loading\u2026</div></div></div>';
  paintVcHeader();
  paintVocabList();
  Array.prototype.forEach.call(v.querySelectorAll('[data-vlevel]'), function (btn) {
    btn.addEventListener('click', function () {
      state.vcFilter.level = btn.getAttribute('data-vlevel');
      Array.prototype.forEach.call(v.querySelectorAll('[data-vlevel]'), function (bb) {
        bb.classList.toggle('on', bb === btn);
      });
      paintVcHeader();
      paintVocabList();
    });
  });
  var input = v.querySelector('#vc-search'), deb = null;
  input.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { state.vcFilter.q = input.value.trim(); paintVocabList(); }, 250);
  });
}

function paintVcHeader() {
  var f = state.vcFilter || { level: 'all', q: '' };
  var crumb = document.getElementById('vc-crumb-lv');
  if (crumb) crumb.textContent = f.level === 'all' ? 'All levels' : f.level.toUpperCase();
  var secLv = document.getElementById('vc-sec-lv');
  if (secLv) secLv.innerHTML = vcLvBadge(f.level);
  var sub = document.getElementById('vc-sec-sub');
  if (sub) sub.textContent = VC_LV_SUB[f.level] || VC_LV_SUB.all;
}

function paintVocabList() {
  var wrap = document.getElementById('vc-list');
  if (!wrap) return;
  var f = state.vcFilter || { level: 'all', q: '' };
  loadVocabCats().then(function (cats) {
    var prog = vocabProgress();
    var q = (f.q || '').toLowerCase();
    var list = cats.filter(function (c) {
      if (f.level !== 'all' && c.levels.indexOf(f.level) === -1) return false;
      if (q && c.title.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!list.length) { wrap.innerHTML = '<div class="empty">No topics match.</div>'; return; }
    var count = document.getElementById('vc-count');
    if (count) count.textContent = list.length + ' topic' + (list.length === 1 ? '' : 's');
    wrap.innerHTML = '<div class="vc-cards">' + list.map(function (c) {
      return vocabCardHTML(c, prog[c.slug]);
    }).join('') + '</div>';
  }).catch(function () {
    wrap.innerHTML = '<div class="empty">Could not load vocabulary topics. Check your connection and try again.</div>';
  });
}

function vocabCardHTML(c, p) {
  var status;
  if (p && p.done) status = '<span class="vc-status done">\u2713 practised</span>';
  else status = '<span class="vc-status">' + c.word_count + ' words</span>';
  return '<a class="vc-card" href="#/vocab/' + esc(c.slug) + '">' +
    '<span class="vc-ico">' + esc(c.icon || '\uD83D\uDCD6') + '</span>' +
    '<span class="vc-card-main"><span class="vc-titlerow">' + vcLevelBadges(c.levels) + '<b>' + esc(c.title) + '</b></span>' + status + '</span>' +
    '<span class="vc-chev" aria-hidden="true">\u203A</span></a>';
}

/* ---------------- vocabulary category (#/vocab/<slug>) ---------------- */

function renderVocabCat(v, slug) {
  v.innerHTML = '<div class="vc-topic"><div class="empty">Loading\u2026</div></div>';
  loadVocabCats().then(function (cats) {
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i].slug === slug) cat = cats[i];
    if (!cat) {
      v.innerHTML = '<div class="vc-topic"><div class="empty">Topic not found. <a href="#/vocab">Back to all topics</a></div></div>';
      return;
    }
    return loadVocabWords(slug).then(function (words) {
      var prog = vocabProgress()[slug];
      var best = prog && prog.done ? '<span class="vc-best">\u2713 Practised</span>' : '';
      var rows = words.map(function (w) {
        return '<div class="vc-word">' +
          (w.photo ? '<img class="vc-word-img" src="' + (/^https?:\/\//.test(w.photo) ? w.photo : '/' + w.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
          '<div class="vc-word-body">' +
          '<div class="vc-word-top"><b>' + esc(w.word) + '</b>' +
          (w.audio ? '<button class="vc-say" data-action="vc-say" data-audio="' + esc(/^https?:\/\//.test(w.audio) ? w.audio : '/' + w.audio) + '" aria-label="Listen to pronunciation">\uD83D\uDD0A</button>' : '') +
          (w.phonetic ? '<span class="vc-phon">/' + esc(w.phonetic) + '/</span>' : '') +
          (w.pos ? '<span class="vc-pos">' + esc(w.pos) + '</span>' : '') +
          vcLevelBadges(w.levels) + '</div>' +
          (w.meaning_fa ? '<div class="vc-meaning">' + esc(w.meaning_fa) + '</div>' : '') +
          (w.example_en ? '<div class="vc-example">' + esc(w.example_en) + '</div>' : '') +
          '</div></div>';
      }).join('');
      v.innerHTML = '<div class="vc-topic">' +
        '<a class="vc-back" href="#/vocab">\u2039 All topics</a>' +
        '<div class="vc-hero vc-hero-topic"><div class="vc-hero-t">' +
        '<div class="vc-hero-ico">' + esc(cat.icon || '\uD83D\uDCD6') + '</div>' +
        '<h1>' + esc(cat.title) + '</h1>' +
        '<p>' + cat.word_count + ' words \u00B7 ' + vcLevelBadges(cat.levels) + ' ' + best + '</p>' +
        '</div></div>' +
        '<button class="btn btn-primary vc-start" id="vc-start-btn">Practice these words \u2192</button>' +
        '<p class="vc-xp-note">Quick quiz \u00B7 word \u2192 meaning \u00B7 practice mode (no points)</p>' +
        '<div class="vc-words">' + rows + '</div></div>';
      document.getElementById('vc-start-btn').addEventListener('click', function () {
        startVocabQuiz(cat, words);
      });
      window.scrollTo(0, 0);
    });
  }).catch(function () {
    v.innerHTML = '<div class="vc-topic"><div class="empty">Could not load this topic.</div></div>';
  });
}

/* ---------------- vocabulary quiz ---------------- */

/* Play a vocabulary word's TTS audio (single shared element; tap toggles). */
var _vcAudio = null, _vcAudioSrc = '';
function playVocabAudio(src) {
  if (!src) return;
  try {
    if (_vcAudio && _vcAudioSrc === src && !_vcAudio.paused) {
      _vcAudio.pause();
      _vcAudio.currentTime = 0;
      return;
    }
    if (_vcAudio) { try { _vcAudio.pause(); } catch (e) {} }
    _vcAudioSrc = src;
    _vcAudio = new Audio(src);
    _vcAudio.play().catch(function () {});
  } catch (e) {}
}

function startVocabQuiz(cat, words) {
  var LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4 };
  function maxLv(w) {
    var m = 0;
    (w.levels || []).forEach(function (l) { m = Math.max(m, LV_RANK[l] || 0); });
    return m;
  }
  function qLang(w) { return maxLv(w) <= 2 ? 'fa' : 'en'; }
  function hasMeaning(w, lang) { return lang === 'fa' ? w.meaning_fa : w.meaning_en; }
  var pool = words.filter(function (w) { return w.meaning_fa && w.meaning_en; });
  if (pool.length < 4) {
    alert('Not enough words with meanings in this topic yet.');
    return;
  }
  var items = shuffleArr(pool).slice(0, 10).map(function (w) {
    var lang = qLang(w);
    var sameLang = pool.filter(function (x) { return x.word !== w.word && qLang(x) === lang && hasMeaning(x, lang); });
    var distractPool = sameLang.length >= 3 ? sameLang : pool.filter(function (x) { return x.word !== w.word && hasMeaning(x, lang); });
    var distract = shuffleArr(distractPool).slice(0, 3);
    var correct = lang === 'fa' ? w.meaning_fa : w.meaning_en;
    var options = shuffleArr([correct].concat(distract.map(function (x) { return lang === 'fa' ? x.meaning_fa : x.meaning_en; })));
    return { word: w.word, example: w.example_en, options: options, answer: options.indexOf(correct) };
  });
  state.vquiz = { slug: cat.slug, title: cat.title, items: items, idx: 0, picked: -1, answered: false, correct: 0 };
  document.body.classList.add('duo-playing');
  renderVocabQuiz();
}

function renderVocabQuiz() {
  var q = state.vquiz; if (!q) return;
  var v = document.getElementById('view');
  var it = q.items[q.idx];
  var n = q.items.length;
  var letters = ['A', 'B', 'C', 'D'];
  var opts = it.options.map(function (op, i) {
    var cls = 'gt-opt';
    if (q.answered) {
      if (i === it.answer) cls += ' ok';
      else if (i === q.picked) cls += ' no';
      else cls += ' dim';
    }
    return '<button class="' + cls + '"' + (q.answered ? ' disabled' : '') + ' data-vopt="' + i + '">' +
      '<span class="gt-opt-letter">' + letters[i] + '</span>' +
      '<span class="gt-opt-text">' + esc(op) + '</span></button>';
  }).join('');
  var sheet = '';
  if (q.answered) {
    var good = q.picked === it.answer;
    sheet = '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
      '<div class="gt-sheet-msg">' + (good ? '\uD83C\uDF89 Correct!' : '\uD83D\uDCA1 Correct answer: <b>' + esc(it.options[it.answer]) + '</b>') + '</div>' +
      (it.example ? '<div class="gt-sheet-explain"><em>' + esc(it.example) + '</em></div>' : '') +
      '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="vc-next-btn">' +
      (q.idx + 1 >= n ? 'SEE RESULTS' : 'CONTINUE') + '</button>' +
      '</div></div>';
  }
  var barPct = Math.round((q.idx + (q.answered ? 1 : 0)) / n * 100);
  v.innerHTML = '<div class="vc-quiz gt-wrap">' +
    '<div class="gt-top"><button class="gt-x" id="vc-quiz-quit" aria-label="Back to topic">\u2715</button>' +
    '<div class="gt-progress"><span style="width:' + barPct + '%"></span></div>' +
    '<div class="gt-qcount">' + (q.idx + 1) + '/' + n + '</div></div>' +
    '<div class="gt-mode">Practice mode \u2014 no points</div>' +
    '<div class="gt-q">What does <b>\u201C' + esc(it.word) + '\u201D</b> mean?</div>' +
    '<div class="gt-opts">' + opts + '</div>' + sheet + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-vopt]'), function (btn) {
    btn.addEventListener('click', function () { answerVocabQuiz(parseInt(btn.getAttribute('data-vopt'), 10)); });
  });
  var next = document.getElementById('vc-next-btn');
  if (next) next.addEventListener('click', nextVocabQuiz);
  document.getElementById('vc-quiz-quit').addEventListener('click', function () {
    state.vquiz = null;
    document.body.classList.remove('duo-playing');
    go('vocab', q.slug);
  });
  window.scrollTo(0, 0);
}

function answerVocabQuiz(i) {
  var q = state.vquiz; if (!q || q.answered) return;
  q.picked = i; q.answered = true;
  if (i === q.items[q.idx].answer) q.correct++;
  renderVocabQuiz();
}

function nextVocabQuiz() {
  var q = state.vquiz; if (!q) return;
  q.idx++; q.picked = -1; q.answered = false;
  if (q.idx >= q.items.length) { finishVocabQuiz(); return; }
  renderVocabQuiz();
}

function finishVocabQuiz() {
  var q = state.vquiz; if (!q) return;
  var v = document.getElementById('view');
  var n = q.items.length, score = q.correct;
  var prog = vocabProgress();
  var rec = prog[q.slug] || {};
  rec.attempts = (rec.attempts || 0) + 1;
  rec.done = true;
  rec.best = Math.max(rec.best || 0, score);
  rec.total = n;
  prog[q.slug] = rec;
  setVocabProgress(prog);
  state.vquiz = null;
  document.body.classList.remove('duo-playing');
  var pct = Math.round(score / n * 100);
  var msg = pct === 100 ? '\uD83C\uDF89 Perfect!' : (pct >= 70 ? '\uD83D\uDC4D Great job!' : (pct >= 40 ? '\uD83D\uDCAA Keep practising!' : '\uD83D\uDCD6 Review the words and try again!'));
  v.innerHTML = '<div class="gt-wrap gt-done">' +
    '<div class="gt-done-ico">' + (pct >= 70 ? '\uD83C\uDF89' : '\uD83D\uDCD6') + '</div>' +
    '<h2>' + msg + '</h2>' +
    '<p class="gt-done-sub">' + score + ' / ' + n + ' correct \u00B7 ' + esc(q.title) + '</p>' +
    '<div class="gt-done-btns">' +
    '<button class="gt-btn gt-btn-green gt-btn-block" id="vc-again-btn">Practice again \u21BB</button>' +
    '<a class="gt-btn gt-btn-ghost gt-btn-block" href="#/vocab/' + esc(q.slug) + '">Back to topic</a>' +
    '<a class="gt-btn gt-btn-ghost gt-btn-block" href="#/vocab">All topics</a>' +
    '</div></div>';
  document.getElementById('vc-again-btn').addEventListener('click', function () {
    loadVocabWords(q.slug).then(function (words) { startVocabQuiz({ slug: q.slug, title: q.title }, words); });
  });
  window.scrollTo(0, 0);
}

/* ---------------- word map (#/words): WordUp-style vocab study ---------------- */

var WM_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
var WM_LV_COLORS = { a1: '#D9A21B', a2: '#E8833A', b1: '#3FA46A', b2: '#F26522', c1: '#4A90D9', c2: '#8E6FC8' };
var WM_LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };

function wordMapGet() {
  var p = null;
  try { p = JSON.parse(localStorage.getItem('muse_wordmap_v1')); } catch (e) { p = null; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
  if (!p.words || typeof p.words !== 'object') p.words = {};
  return p;
}
function wordMapSet(p) {
  try { localStorage.setItem('muse_wordmap_v1', JSON.stringify(p)); } catch (e) {}
}
function loadAllWords() {
  if (state.allWords) return Promise.resolve(state.allWords);
  return fetch('/data/vocab/words.json').then(function (res) {
    if (!res.ok) throw new Error('words missing');
    return res.json();
  }).then(function (data) {
    state.allWords = data;
    return data;
  });
}
function wmSlug(w) {
  var ph = w.photo || '', m = ph.match(/([^\/]+)\.jpg$/);
  if (m) return m[1];
  return String(w.word || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
function wmPrimaryLevel(w) {
  var best = 'c2', br = 99;
  (w.levels || []).forEach(function (l) {
    var r = WM_LV_RANK[l] || 99;
    if (r < br) { br = r; best = l; }
  });
  return best;
}
function wmPhotoSrc(w) {
  var ph = w.photo || '';
  return /^https?:\/\//.test(ph) ? ph : '/' + ph;
}

function renderWords(v, arg) {
  if (arg === 'test') { renderWordTest(v); return; }
  if (arg === 'discover') { renderDiscover(v); return; }
  renderWordMap(v);
}

/* --- knowledge map hub --- */

function renderWordMap(v) {
  v.innerHTML = '<div class="wm-hub"><div class="empty">Loading\u2026</div></div>';
  loadAllWords().then(function (words) {
    var map = wordMapGet();
    var stats = wmComputeStats(words, map);
    var totalKnown = stats.levels.reduce(function (a, l) { return a + l.known; }, 0);
    var html = '<div class="wm-hub">' +
      '<div class="vc-crumb"><span>\uD83D\uDDFA\uFE0F</span> Word Map</div>' +
      '<div class="vc-hero"><div class="vc-hero-t">' +
      '<h1>Your <em>Word Map</em></h1>' +
      '<p>Discover the words you don\u2019t know yet \u2014 ' + totalKnown.toLocaleString() + ' of ' + words.length.toLocaleString() + ' mapped so far.</p>' +
      '</div><div class="vc-mascot" aria-hidden="true">\uD83D\uDDFA\uFE0F</div></div>';
    if (!map.tested) {
      html += '<div class="wm-cta-card"><div class="wm-cta-t">Find your starting point</div>' +
        '<p>Take a quick 30-word test so we can map what you already know.</p>' +
        '<a class="wm-btn wm-btn-primary" href="#/words/test">Start the test</a></div>';
    } else {
      html += '<div class="wm-level-tag">Your level: <b>' + map.level.toUpperCase() + '</b> <a href="#/words/test">retake</a></div>';
    }
    html += '<div class="wm-map">' + stats.levels.map(function (l) {
      var pctK = l.total ? Math.round(l.known / l.total * 100) : 0;
      var pctL = l.total ? Math.round(l.learning / l.total * 100) : 0;
      return '<div class="wm-row">' +
        '<span class="wm-lv" style="background:' + WM_LV_COLORS[l.lv] + '">' + l.lv.toUpperCase() + '</span>' +
        '<div class="wm-barwrap"><div class="wm-bar">' +
        '<i class="wm-seg-k" style="width:' + pctK + '%"></i>' +
        '<i class="wm-seg-l" style="width:' + pctL + '%"></i>' +
        '</div><div class="wm-row-sub">' + l.known + ' known \u00B7 ' + l.learning + ' learning \u00B7 ' + l.total + ' words</div></div>' +
        '</div>';
    }).join('') + '</div>';
    html += '<div class="wm-legend"><span><i class="wm-dot" style="background:#3FA46A"></i>known</span>' +
      '<span><i class="wm-dot" style="background:#E8A33D"></i>learning</span>' +
      '<span><i class="wm-dot" style="background:#E4DCCB"></i>not mapped</span></div>';
    if (map.tested) {
      html += '<a class="wm-btn wm-btn-primary wm-btn-block" href="#/words/discover">Discover new words \u2192</a>';
    }
    html += '<a class="wm-link" href="#/vocab">Browse the word library \u2192</a></div>';
    v.innerHTML = html;
    window.scrollTo(0, 0);
  }).catch(function () {
    v.innerHTML = '<div class="wm-hub"><div class="empty">Could not load words. Check your connection.</div></div>';
  });
}

function wmComputeStats(words, map) {
  var per = {};
  WM_LEVELS.forEach(function (lv) { per[lv] = { lv: lv, total: 0, known: 0, learning: 0 }; });
  words.forEach(function (w) {
    var lv = wmPrimaryLevel(w), s = wmSlug(w), st = map.words[s] && map.words[s].s;
    per[lv].total++;
    if (st === 'known') per[lv].known++;
    else if (st === 'learning') per[lv].learning++;
  });
  return { levels: WM_LEVELS.map(function (lv) { return per[lv]; }) };
}

/* --- placement test: 30 words, know / don't know --- */

function renderWordTest(v) {
  v.innerHTML = '<div class="wm-wrap"><div class="empty">Loading\u2026</div></div>';
  loadAllWords().then(function (words) {
    var items = [];
    WM_LEVELS.forEach(function (lv) {
      var pool = words.filter(function (w) { return wmPrimaryLevel(w) === lv && w.word; });
      shuffleArr(pool).slice(0, 5).forEach(function (w) { items.push({ w: w, lv: lv }); });
    });
    state.wtest = { items: shuffleArr(items), idx: 0, known: {} };
    WM_LEVELS.forEach(function (lv) { state.wtest.known[lv] = 0; });
    paintWordTest();
    window.scrollTo(0, 0);
  });
}

function paintWordTest() {
  var t = state.wtest; if (!t) return;
  var v = document.getElementById('view');
  if (t.idx >= t.items.length) { finishWordTest(); return; }
  var w = t.items[t.idx].w;
  var photo = w.photo ? '<span class="wm-spark" aria-hidden="true"><i></i><i></i><i></i></span><img class="wm-card-img" src="' + esc(wmPhotoSrc(w)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '';
  v.innerHTML = '<div class="wm-wrap">' +
    '<div class="wm-test-top"><span>' + (t.idx + 1) + ' / ' + t.items.length + '</span>' +
    '<div class="wm-test-bar"><i style="width:' + Math.round(t.idx / t.items.length * 100) + '%"></i></div></div>' +
    '<div class="wm-card">' + (w.photo ? '<div class="wm-photo-wrap">' + photo + '</div>' : '') +
    '<button class="wm-audio" id="wm-test-audio" aria-label="Play pronunciation">\uD83D\uDD0A</button>' +
    '<div class="wm-word">' + esc(w.word) + '</div>' +
    (w.phonetic ? '<div class="wm-phon">' + esc(w.phonetic) + '</div>' : '') +
    '</div>' +
    '<p class="wm-q">Do you know this word?</p>' +
    '<div class="wm-2btn">' +
    '<button class="wm-btn wm-btn-yes" id="wm-yes">\u2705 I know it</button>' +
    '<button class="wm-btn wm-btn-no" id="wm-no">\u274C I don\u2019t know</button>' +
    '</div></div>';
  document.getElementById('wm-test-audio').addEventListener('click', function () { playVocabAudio(w.audio); });
  document.getElementById('wm-yes').addEventListener('click', function () { wmTestAnswer(true); });
  document.getElementById('wm-no').addEventListener('click', function () { wmTestAnswer(false); });
}

function wmTestAnswer(knows) {
  var t = state.wtest; if (!t) return;
  var it = t.items[t.idx];
  if (knows) t.known[it.lv]++;
  // seed the map with the answer
  var map = wordMapGet();
  map.words[wmSlug(it.w)] = { s: knows ? 'known' : 'learning', d: Date.now() };
  wordMapSet(map);
  t.idx++;
  paintWordTest();
}

function finishWordTest() {
  var t = state.wtest; if (!t) return;
  // estimated level: highest with >=3/5 known
  var est = 'a1';
  WM_LEVELS.forEach(function (lv) { if (t.known[lv] >= 3) est = lv; });
  var map = wordMapGet();
  map.tested = true;
  map.level = est;
  wordMapSet(map);
  state.wtest = null;
  var v = document.getElementById('view');
  var rows = WM_LEVELS.map(function (lv) {
    return '<div class="wm-res-row"><span class="wm-lv" style="background:' + WM_LV_COLORS[lv] + '">' + lv.toUpperCase() + '</span>' +
      '<span>' + t.known[lv] + ' / 5</span></div>';
  }).join('');
  v.innerHTML = '<div class="wm-wrap wm-done">' +
    '<div class="wm-done-ico">\uD83D\uDDFA\uFE0F</div>' +
    '<h2>Your map is started!</h2>' +
    '<p class="wm-done-sub">Estimated level: <b>' + est.toUpperCase() + '</b></p>' +
    '<div class="wm-res">' + rows + '</div>' +
    '<a class="wm-btn wm-btn-primary wm-btn-block" href="#/words/discover">Discover new words \u2192</a>' +
    '<a class="wm-btn wm-btn-ghost wm-btn-block" href="#/words">Back to Word Map</a></div>';
  window.scrollTo(0, 0);
}

/* --- discovery flow: know / teach me / test me --- */

function renderDiscover(v) {
  v.innerHTML = '<div class="wm-wrap"><div class="empty">Loading\u2026</div></div>';
  loadAllWords().then(function (words) {
    var map = wordMapGet();
    if (!map.tested) { window.location.hash = '#/words/test'; return; }
    var lv = map.level || 'b1';
    var pool = words.filter(function (w) {
      return wmPrimaryLevel(w) === lv && w.word && w.meaning_fa && !map.words[wmSlug(w)];
    });
    if (!pool.length) {
      v.innerHTML = '<div class="wm-wrap wm-done"><div class="wm-done-ico">\uD83C\uDF89</div>' +
        '<h2>All ' + lv.toUpperCase() + ' words mapped!</h2>' +
        '<p class="wm-done-sub">Amazing. Move up a level or review your map.</p>' +
        '<a class="wm-btn wm-btn-ghost wm-btn-block" href="#/words">Back to Word Map</a></div>';
      return;
    }
    state.wdis = { items: shuffleArr(pool).slice(0, 10), idx: 0, mode: 'ask' };
    paintDiscover();
    window.scrollTo(0, 0);
  });
}

function paintDiscover() {
  var d = state.wdis; if (!d) return;
  var v = document.getElementById('view');
  if (d.idx >= d.items.length) {
    v.innerHTML = '<div class="wm-wrap wm-done"><div class="wm-done-ico">\uD83C\uDF89</div>' +
      '<h2>Session complete!</h2><p class="wm-done-sub">10 words mapped. Keep going!</p>' +
      '<a class="wm-btn wm-btn-primary wm-btn-block" href="#/words/discover">Next 10 \u2192</a>' +
      '<a class="wm-btn wm-btn-ghost wm-btn-block" href="#/words">Back to Word Map</a></div>';
    window.scrollTo(0, 0);
    return;
  }
  var w = d.items[d.idx];
  var photo = w.photo ? '<span class="wm-spark" aria-hidden="true"><i></i><i></i><i></i></span><img class="wm-card-img" src="' + esc(wmPhotoSrc(w)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '';
  var html = '<div class="wm-wrap">' +
    '<div class="wm-test-top"><span>Word ' + (d.idx + 1) + ' / ' + d.items.length + '</span>' +
    '<div class="wm-test-bar"><i style="width:' + Math.round(d.idx / d.items.length * 100) + '%"></i></div></div>' +
    '<div class="wm-card">' + (w.photo ? '<div class="wm-photo-wrap">' + photo + '</div>' : '') +
    '<button class="wm-audio" id="wm-dis-audio" aria-label="Play pronunciation">\uD83D\uDD0A</button>' +
    '<div class="wm-word">' + esc(w.word) + '</div>' +
    (w.phonetic ? '<div class="wm-phon">' + esc(w.phonetic) + '</div>' : '') +
    (w.pos ? '<div class="wm-pos">' + esc(w.pos) + '</div>' : '') +
    '</div>';
  if (d.mode === 'ask') {
    html += '<p class="wm-q">What do you want to do with this word?</p>' +
      '<div class="wm-3btn">' +
      '<button class="wm-btn wm-btn-yes" id="wm-d-know"><i class="wm-bico">\u2705</i> I know it</button>' +
      '<button class="wm-btn wm-btn-teach" id="wm-d-teach"><i class="wm-bico">\uD83D\uDCD6</i> Teach me</button>' +
      '<button class="wm-btn wm-btn-test" id="wm-d-testme"><i class="wm-bico">\uD83C\uDFB2</i> Test me</button>' +
      '</div>';
  } else if (d.mode === 'teach') {
    var syn = (w.synonyms || []).length ? '<div class="wm-syn"><b>Synonyms:</b> ' + w.synonyms.map(esc).join(', ') + '</div>' : '';
    var ant = (w.antonyms || []).length ? '<div class="wm-syn"><b>Opposites:</b> ' + w.antonyms.map(esc).join(', ') + '</div>' : '';
    var fam = (w.family && Object.keys(w.family).length) ? '<div class="wm-syn"><b>Word family:</b> ' +
      Object.keys(w.family).map(function (k) { return esc(w.family[k]) + ' <i>(' + k + ')</i>'; }).join(', ') + '</div>' : '';
    var ex2 = (w.examples_extra || []).map(function (x) { return '<div class="wm-ex">\u201C' + esc(x) + '\u201D</div>'; }).join('');
    var note = w.note_fa ? '<div class="wm-note">\uD83D\uDCA1 ' + esc(w.note_fa) + '</div>' : '';
    html += '<div class="wm-teach">' +
      '<div class="wm-mean">' + esc(w.meaning_fa) + '</div>' +
      '<div class="wm-mean-en">' + esc(w.meaning_en) + '</div>' +
      syn + ant + fam +
      (w.example_en ? '<div class="wm-ex">\u201C' + esc(w.example_en) + '\u201D</div>' : '') + ex2 +
      note +
      '</div>' +
      '<button class="wm-btn wm-btn-primary wm-btn-block wm-next" id="wm-d-gotit">Got it, next \u2192</button>';
  } else if (d.mode === 'quiz') {
    var q = d.quiz;
    html += '<p class="wm-q">What does it mean?</p><div class="wm-opts">' +
      q.options.map(function (o, i) {
        return '<button class="wm-opt' + (q.picked === i ? (i === q.answer ? ' ok' : ' bad') : '') + '" data-wm-opt="' + i + '"' +
          (q.picked >= 0 ? ' disabled' : '') + '>' + esc(o) + '</button>';
      }).join('') + '</div>';
    if (q.picked >= 0) {
      html += '<div class="wm-teach"><div class="wm-mean">' + esc(w.meaning_fa) + '</div></div>' +
        '<button class="wm-btn wm-btn-primary wm-btn-block" id="wm-d-next">Next \u2192</button>';
    }
  }
  html += '<a class="wm-link" href="#/words">End session</a></div>';
  v.innerHTML = html;
  document.getElementById('wm-dis-audio').addEventListener('click', function () { playVocabAudio(w.audio); });
  var b;
  if (d.mode === 'ask') {
    document.getElementById('wm-d-know').addEventListener('click', function () { wmDisMark('known'); });
    document.getElementById('wm-d-teach').addEventListener('click', function () { d.mode = 'teach'; paintDiscover(); });
    document.getElementById('wm-d-testme').addEventListener('click', function () { wmDisQuiz(); });
  } else if (d.mode === 'teach') {
    document.getElementById('wm-d-gotit').addEventListener('click', function () { wmDisMark('learning'); });
  } else if (d.mode === 'quiz') {
    Array.prototype.forEach.call(v.querySelectorAll('[data-wm-opt]'), function (btn) {
      btn.addEventListener('click', function () { wmDisQuizAnswer(parseInt(btn.getAttribute('data-wm-opt'), 10)); });
    });
    b = document.getElementById('wm-d-next');
    if (b) b.addEventListener('click', function () {
      wmDisMark(d.quiz.picked === d.quiz.answer ? 'known' : 'learning');
    });
  }
}

function wmDisMark(status) {
  var d = state.wdis; if (!d) return;
  var map = wordMapGet();
  map.words[wmSlug(d.items[d.idx])] = { s: status, d: Date.now() };
  wordMapSet(map);
  d.idx++;
  d.mode = 'ask';
  paintDiscover();
}

function wmDisQuiz() {
  var d = state.wdis; if (!d) return;
  var w = d.items[d.idx];
  var LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
  function maxLv(x) {
    var m = 0;
    (x.levels || []).forEach(function (l) { m = Math.max(m, LV_RANK[l] || 0); });
    return m;
  }
  var lang = maxLv(w) <= 2 ? 'fa' : 'en';
  var pool = state.allWords.filter(function (x) {
    return x.word !== w.word && (lang === 'fa' ? x.meaning_fa : x.meaning_en);
  });
  var distract = shuffleArr(pool).slice(0, 3);
  var correct = lang === 'fa' ? w.meaning_fa : w.meaning_en;
  var options = shuffleArr([correct].concat(distract.map(function (x) { return lang === 'fa' ? x.meaning_fa : x.meaning_en; })));
  d.quiz = { options: options, answer: options.indexOf(correct), picked: -1 };
  d.mode = 'quiz';
  paintDiscover();
}

function wmDisQuizAnswer(i) {
  var d = state.wdis; if (!d || !d.quiz || d.quiz.picked >= 0) return;
  d.quiz.picked = i;
  paintDiscover();
}

/* ---------------- vocabulary home banner ---------------- */

function paintVocabBanner() {
  var wrap = document.getElementById('home-vocab-wrap');
  if (!wrap) return;
  var prog = vocabProgress();
  var doneCount = 0;
  Object.keys(prog).forEach(function (k) { if (prog[k] && prog[k].done) doneCount++; });
  var sub = '9,136 words \u00B7 69 topics \u00B7 A1\u2013C2' + (doneCount ? ' \u00B7 ' + doneCount + ' practised' : '');
  /* Mobile: 2026-10-20 mockup card. Desktop keeps g-banner. */
  if (!isDesktop()) {
    wrap.innerHTML = '<a class="hm-card" href="#/vocab">' +
      '<span class="hm-icon">🗂️</span><span class="hm-main"><span class="hm-kicker">Vocabulary</span>' +
      '<span class="hm-title">Vocabulary Builder</span>' +
      '<span class="hm-subtxt">' + sub + '</span></span>' +
      '<span class="hm-btn hm-btn-soft">Explore →</span></a>';
    return;
  }
  var inner = '<span class="g-b-icon">\uD83D\uDCDA</span><span class="g-b-main"><b>Vocabulary Builder</b>' +
    '<span>' + sub + '</span></span><span class="g-b-cta">Explore \u2192</span>';
  wrap.innerHTML = '<a class="g-banner" href="#/vocab">' + inner + '</a>';
}

function paintWordsBanner() {
  var wrap = document.getElementById('home-words-wrap');
  if (!wrap) return;
  var map = wordMapGet();
  /* Mobile: 2026-10-20 mockup card. Desktop keeps g-banner. */
  if (!isDesktop()) {
    if (map.tested) {
      var n2 = Object.keys(map.words || {}).length;
      wrap.innerHTML = '<a class="hm-card" href="#/words">' +
        '<span class="hm-icon">🗺️</span><span class="hm-main"><span class="hm-kicker">Practice</span>' +
        '<span class="hm-title">Word Map</span>' +
        '<span class="hm-subtxt">' + n2.toLocaleString() + ' words mapped \u00B7 level ' + (map.level || '?').toUpperCase() + '</span></span>' +
        '<span class="hm-btn hm-btn-soft">Continue →</span></a>';
    } else {
      wrap.innerHTML = '<a class="hm-card" href="#/words">' +
        '<span class="hm-icon">🗺️</span><span class="hm-main"><span class="hm-kicker">Practice</span>' +
        '<span class="hm-title">Word Map</span>' +
        '<span class="hm-subtxt">Map your vocabulary \u00B7 9,136 words \u00B7 A1\u2013C2</span></span>' +
        '<span class="hm-btn hm-btn-soft">Start →</span></a>';
    }
    return;
  }
  var inner;
  if (map.tested) {
    var n = Object.keys(map.words || {}).length;
    inner = '<span class="g-b-icon">\uD83D\uDDFA\uFE0F</span><span class="g-b-main"><b>Word Map</b>' +
      '<span>' + n.toLocaleString() + ' words mapped \u00B7 level ' + (map.level || '?').toUpperCase() + '</span></span><span class="g-b-cta">Continue \u2192</span>';
  } else {
    inner = '<span class="g-b-icon">\uD83D\uDDFA\uFE0F</span><span class="g-b-main"><b>Word Map</b>' +
      '<span>Map your vocabulary \u00B7 9,136 words \u00B7 A1\u2013C2</span></span><span class="g-b-cta">Start \u2192</span>';
  }
  wrap.innerHTML = '<a class="g-banner" href="#/words">' + inner + '</a>';
}

})();
