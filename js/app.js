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
  justSignedUp: false
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
    player.el.src = src;
    player.el.play().catch(function () {});
  }
  playerUI();
}

function initAudio() {
  player.el.preload = 'none';
  player.el.addEventListener('timeupdate', refreshTrackCards);
  player.el.addEventListener('play', function () { playerUI(); refreshTrackCards(); });
  player.el.addEventListener('pause', function () { playerUI(); refreshTrackCards(); });
  player.el.addEventListener('ended', function () { playerUI(); refreshTrackCards(); });
  player.el.addEventListener('error', function () {
    player.title = 'Could not load audio';
    playerUI();
  });
}

async function audioAvailable(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch (e) { return false; }
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
  return '' +
  '<div class="card audio-card" data-audio-card data-src="' + esc(o.src) + '" id="' + esc(o.id) + '">' +
    '<div class="audio-top">' +
      (o.cover ? '<img class="podcast-cover" src="' + esc(o.cover) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<button class="play-btn" data-action="play-track" data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" aria-label="Play ' + esc(o.title) + '">▶</button>' +
      '<div class="audio-meta">' +
        '<div class="audio-title">' + esc(o.title) + '</div>' +
        (o.sub ? '<div class="muted">' + esc(o.sub) + '</div>' : '') +
        '<div class="progress" role="progressbar" aria-label="Playback progress"><div></div></div>' +
        '<div class="audio-times"><span class="t-cur">0:00</span><span class="t-dur">--:--</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="audio-actions">' +
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
const PUBLIC_VIEWS = ['landing', 'signin', 'signup', 'preview'];
const LEARNER_VIEWS = ['home', 'lesson', 'scores', 'review', 'profile', 'admin', 'waiting'];
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
    if (PUBLIC_VIEWS.indexOf(view) !== -1 || LEARNER_VIEWS.indexOf(view) === -1) {
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
  else if (view === 'scores') renderScores(v);
  else if (view === 'review') renderMistakes(v);
  else if (view === 'profile') renderProfile(v);
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
      const active = tv === state.view;
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
        '<input id="si-pass" name="signin-password" type="password" autocomplete="current-password" placeholder="••••••••" required></div>' +
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
}

function renderSignup(v) {
  const configured = supabaseKeysPresent();
  v.innerHTML = authShell(
    '<h1>Create your account ✨</h1>' +
    '<p class="muted">One lesson a day — words, listening, speaking and a quiz, for your level.</p>' +
    (configured ?
      // Distinct form/field names + autocomplete=new-password keep the browser
      // from dropping saved *login* credentials into the signup form.
      '<form id="form-signup" novalidate autocomplete="off">' +
        '<div class="field"><label for="su-email">Email</label>' +
        '<input id="su-email" name="signup-email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label for="su-pass">Password</label>' +
        '<input id="su-pass" name="signup-password" type="password" autocomplete="new-password" placeholder="Choose a password (min 6 characters)" required minlength="6"></div>' +
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
  authError('su', '');
  if (!sb) { authError('su', 'Signup service couldn’t load. Check your connection and try again.'); return; }
  setAuthBusy('su', true, 'Creating your account…');
  try {
    const { error } = await sb.auth.signUp({ email: email, password: pass });
    if (error) throw error;
    state.justSignedUp = true;
    authNote('su', '✓ Account created — loading your lessons…');
    await enterApp();
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
  try {
    const { data: prof } = await sb.from('profiles').select('level').eq('id', u.id).single();
    if (prof) level = prof.level;
  } catch (e) { /* RLS or missing row -> treat as pending */ }
  const isAdmin = (u.email || '').toLowerCase() === String(APP_CONFIG.ADMIN_EMAIL).toLowerCase();
  state.user = { id: u.id, email: u.email, level: level, isAdmin: isAdmin, demo: false };
  try { localStorage.setItem('el_last_user', u.email); } catch (e) {}
  identifyPushUser(u.id, u.email, normalizeLevel(level));
  await migrateLocalToCloud();
  await afterLogin();
}

async function afterLogin() {
  if (!state.user.level && !state.user.isAdmin) { go('waiting'); return; }
  const level = normalizeLevel(state.user.level) || 'b2';
  state.lessons = await loadLessons(level);
  state.lesson = state.lessons[0] || null;
  go('home');
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
    email: asAdmin ? String(APP_CONFIG.ADMIN_EMAIL) : 'demo-learner@example.com',
    level: 'b2',
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
    '<h1>Almost there ⏳</h1>' +
    (state.justSignedUp ? '<p class="form-note">✓ Your account is created.</p>' : '') +
    '<p>Your teacher is assigning your level — check back soon and your daily lessons will appear here.</p>' +
    '<button class="btn btn-block" data-action="check-level">Check again</button>' +
    '<p class="muted" style="margin-top:0.8rem">Signed in as ' + esc(state.user.email) + '</p>' +
  '</div>';
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

  const stepsHTML = STEPS.map(function (s) {
    return '<li class="' + (p[s] ? 'done' : '') + '"><span class="st-ck" aria-hidden="true">✓</span>' +
      '<span class="st-name">' + STEP_LABELS[s] + '</span></li>';
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

  // 5 — Older lessons (accessible, not competing)
  if (lessons.length > 1) {
    html += '<div class="section-title"><h2>Older lessons</h2></div>';
    html += '<div class="older-strip">' + lessons.slice(1, 8).map(function (m) {
      const first = (m.words && m.words[0]) || {};
      return '<button class="older-card" data-action="open-lesson" data-date="' + esc(m.date) + '">' +
        (first.photo ? '<img src="' + esc(first.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div class="oc-body"><div class="oc-theme">' + esc(m.theme || 'Lesson') + '</div>' +
        '<div class="oc-date">' + esc(m.date) + '</div></div></button>';
    }).join('') + '</div>';
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

  '<div class="section-title"><h2>Account</h2></div>' +
  '<div class="card plain"><button class="btn btn-ghost btn-block" data-action="logout" style="margin-top:0">Log out</button></div>';
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
  if (tab === 'words') body.innerHTML = wordsTabHTML(m);
  else if (tab === 'podcast') { body.innerHTML = podcastTabHTML(m); wireAudioCards(body); }
  else if (tab === 'shadowing') { body.innerHTML = shadowingTabHTML(m); wireAudioCards(body); }
  else if (tab === 'quiz') body.innerHTML = quizTabHTML(m);
  else if (tab === 'grammar') { body.innerHTML = grammarTabHTML(m); wireAudioCards(body); }
  refreshTrackCards();
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
  if (q.kind === 'word' && q.date) markStep(q.date, 'quiz', { score: q.correct, total: total });
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
      const { data, error } = await sb.from('profiles').select('id,email,level,created_at').order('created_at', { ascending: true });
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
  list.innerHTML = '<div class="card">' + (users.length ? users.map(function (u) {
    const pending = !u.level;
    return '<div class="user-row">' +
      '<div class="user-info">' +
        '<div class="user-email">' + esc(u.email) + (pending ? '<span class="pending-tag">PENDING</span>' : '') + '</div>' +
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
    else if (a === 'check-level') checkLevel();
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

})();
