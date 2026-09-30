/* ============================================================
   English Learning App — static frontend
   Plain JS, no build step. Views: auth / waiting / home /
   lesson / scores / mistakes / admin. Audio: one shared
   element + persistent mini-player. Scores & mistakes in
   localStorage (keyed per user email).
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
  user: null,          // { email, level, isAdmin, demo }
  lessons: [],         // manifests for user's level, newest first
  lesson: null,        // currently open manifest
  view: 'auth',
  lessonTab: 'words',
  showAllCats: false,
  quiz: null,          // active quiz session
  adminUsers: [],
  pushOptedIn: null    // OneSignal subscription state: true/false/null(unknown)
};

/* Deep link from push notifications: ?lesson=latest opens the newest lesson
   for the user's level right after login. */
let pendingDeepLink = null;
try {
  const q = new URLSearchParams(window.location.search);
  if (q.get('lesson') === 'latest') pendingDeepLink = 'latest';
} catch (e) { /* ignore */ }

function consumeDeepLink() {
  if (pendingDeepLink !== 'latest') return false;
  pendingDeepLink = null;
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('lesson');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch (e) { /* ignore */ }
  if (state.lessons.length) {
    state.lessonTab = 'words';
    show('lesson', state.lessons[0].date);
    return true;
  }
  return false;
}

/* ---------------- config / integrations ---------------- */
let sb = null; // supabase client

function supabaseConfigured() {
  return APP_CONFIG.SUPABASE_URL &&
    APP_CONFIG.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1 &&
    typeof window.supabase !== 'undefined';
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
    // DOMContentLoaded. Previously we returned early when the SDK hadn't loaded
    // yet, which meant init() was never called and optIn() hung forever.
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

async function promptPush(btn) {
  const statusEl = document.getElementById('push-status');
  const setStatus = function (t) { if (statusEl) statusEl.textContent = t; };
  const resetBtn = function () { if (btn) { btn.disabled = false; btn.textContent = 'Enable notifications'; } };
  try {
    if (!oneSignalReady()) { setStatus('Push is not configured on this site yet.'); return; }
    if (!('Notification' in window)) { setStatus('This browser does not support notifications.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enabling…'; }
    // Ask the browser directly inside the click gesture: Chrome only shows the
    // permission prompt while the tap/click is still "active".
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
    // Make sure init was queued (idempotent) and wait for it to finish;
    // optIn() hangs forever if init() never ran (the original bug).
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
            try { window.__osLogs.push('OPTIN-CALLBACK-START'); } catch (e) {}
            await OneSignal.User.PushSubscription.optIn();
            try { window.__osLogs.push('OPTIN-RESOLVED'); } catch (e) {}
            for (let i = 0; i < 20; i++) {
              try {
                const sub = OneSignal.User.PushSubscription;
                if (sub && sub.optedIn && sub.id) { fin(true); return; }
              } catch (e) {}
              await new Promise(function (r) { setTimeout(r, 500); });
            }
            try {
              const s = OneSignal.User.PushSubscription;
              optInError = 'optedIn=' + (s && s.optedIn) + ' id=' + (s && s.id) + ' perm=' + OneSignal.Notifications.permission;
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
      const initErr = window.__osInitError ? ' OneSignal says: ' + window.__osInitError : '';
      const sdkState = 'sdkCount=' + (window.__oneSignalSdkLoadCount || 0) +
        ' hasOneSignal=' + (typeof window.OneSignal) +
        ' inited=' + (window.OneSignal && window.OneSignal.initialized);
      let osLogStr = '';
      try {
        var logs = (window.__osLogs || []).slice(-6);
        if (logs.length) osLogStr = ' logs=[' + logs.join(' ~ ') + ']';
      } catch (e) {}
      const subDbg = ' [dbg build=20260930i ' + sdkState + osLogStr + ' ' + (optInError || 'no-optin-error') + ']';
      setStatus('Permission is on, but this device did not register. In your OneSignal dashboard check Settings → Push & In-App → Web: the Site URL must be exactly https://muse-englishapp.pages.dev — then tap Enable again.' + initErr + subDbg);
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

/* Reconcile the "enable notifications" card with the real subscription state.
   Runs on boot after OneSignal init: if the device is already subscribed the
   card stays hidden; if the user unsubscribed elsewhere the card comes back. */
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
        if (state.view === 'home' && state.user && !state.user.demo) {
          try { renderHome($('#view')); } catch (e) {}
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
  // avoid exact duplicates
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
  $('#mp-bar').style.width = pct + '%';
  $('#mp-time').textContent = fmtTime(cur);
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
  // o: { id, src, title, sub, cover, speeds:boolean, download:boolean }
  const speeds = o.speeds ? [0.75, 1, 1.25, 1.5].map(function (r) {
    return '<button class="speed-btn" data-action="speed" data-rate="' + r + '">' + r + 'x</button>';
  }).join('') : '';
  return '' +
  '<div class="card audio-card" data-audio-card data-src="' + esc(o.src) + '" id="' + esc(o.id) + '">' +
    '<div class="audio-top">' +
      (o.cover ? '<img class="podcast-cover" src="' + esc(o.cover) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
      '<button class="play-btn" data-action="play-track" data-src="' + esc(o.src) + '" data-title="' + esc(o.title) + '" aria-label="Play">▶</button>' +
      '<div class="audio-meta">' +
        '<div class="audio-title">' + esc(o.title) + '</div>' +
        (o.sub ? '<div class="muted">' + esc(o.sub) + '</div>' : '') +
        '<div class="progress"><div></div></div>' +
        '<div class="audio-times"><span class="t-cur">0:00</span><span class="t-dur">--:--</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="audio-actions">' +
      (speeds ? '<div class="speed-row">' + speeds + '</div>' : '') +
      (o.download ? '<a class="btn btn-ghost btn-sm" href="' + esc(o.src) + '" download>⬇ Download</a>' : '') +
    '</div>' +
    '<div class="coming-soon hidden">🎵 Audio is coming soon — it will appear here automatically once published.</div>' +
  '</div>';
}

function wireAudioCards(root) {
  $$('[data-audio-card]', root).forEach(function (card) {
    const src = card.getAttribute('data-src');
    const btn = $('.play-btn', card);
    const note = $('.coming-soon', card);
    const durEl = $('.t-dur', card);
    // duration probe (non-blocking)
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', function () {
      if (durEl && isFinite(probe.duration)) durEl.textContent = fmtTime(probe.duration);
    });
    probe.src = src;
    // availability check -> graceful "coming soon"
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

/* ---------------- chrome (header / tabs / player) ---------------- */
function setChrome() {
  const logged = !!state.user;
  $('#app-header').classList.toggle('hidden', !logged);
  $('#tabbar').classList.toggle('hidden', !logged);
  if (logged) {
    $('#header-user').textContent = state.user.email;
    $('#tab-admin').classList.toggle('hidden', !state.user.isAdmin);
    $$('#tabbar .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === state.view);
    });
  } else {
    player.src = null;
    try { player.el.pause(); } catch (e) {}
    playerUI();
  }
}

function show(view, arg) {
  state.view = view;
  state.quiz = null;
  setChrome();
  const v = $('#view');
  window.scrollTo(0, 0);
  if (view === 'auth') renderAuth(v);
  else if (view === 'waiting') renderWaiting(v);
  else if (view === 'home') renderHome(v);
  else if (view === 'lesson') renderLesson(v, arg);
  else if (view === 'scores') renderScores(v);
  else if (view === 'mistakes') renderMistakes(v);
  else if (view === 'admin') renderAdmin(v);
}

/* ---------------- auth view ---------------- */
function renderAuth(v) {
  const configured = supabaseConfigured();
  v.innerHTML =
  '<div class="card">' +
    '<h1>Welcome 👋</h1>' +
    '<p class="muted">Sign in to get your daily English lesson.</p>' +
    (configured ?
      '<div class="auth-pane">' +
        '<h3>① New here? Create your account</h3>' +
        '<p class="muted">First time? Start here — pick an email and password.</p>' +
        '<div class="field"><label for="su-email">Email</label>' +
        '<input id="su-email" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
        '<div class="field"><label for="su-pass">Password</label>' +
        '<input id="su-pass" type="password" autocomplete="new-password" placeholder="Choose a password (min 6 characters)"></div>' +
        '<div class="form-error" id="su-error"></div>' +
        '<button class="btn btn-block" data-action="signup">Create account</button>' +
      '</div>' +
      '<div class="auth-divider"><span>or</span></div>' +
      '<div class="auth-pane">' +
        '<h3>② Already have an account? Sign in</h3>' +
        '<p class="muted">Created your account before? Enter it here.</p>' +
        '<div class="field"><label for="li-email">Email</label>' +
        '<input id="li-email" type="email" autocomplete="email" placeholder="you@example.com"></div>' +
        '<div class="field"><label for="li-pass">Password</label>' +
        '<input id="li-pass" type="password" autocomplete="current-password" placeholder="••••••••"></div>' +
        '<div class="form-error" id="li-error"></div>' +
        '<button class="btn btn-ghost btn-block" data-action="login">Sign in</button>' +
      '</div>'
    :
      '<div class="coming-soon">🔑 Real login is not connected yet — add your Supabase keys in <b>js/config.js</b> to enable it.</div>' +
      '<button class="btn btn-block" data-action="demo-learner">Continue in demo mode (learner)</button>' +
      '<button class="btn btn-ghost btn-block" data-action="demo-admin">Continue in demo mode (admin)</button>'
    ) +
  '</div>';
}

function paneError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

async function doLogin() {
  const email = document.getElementById('li-email').value.trim();
  const pass = document.getElementById('li-pass').value;
  if (!email || !pass) { paneError('li-error', 'Enter your email and password.'); return; }
  paneError('li-error', '');
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (error) throw error;
    await enterApp();
  } catch (e) { paneError('li-error', e.message || 'Sign in failed.'); }
}

async function doSignup() {
  const email = document.getElementById('su-email').value.trim();
  const pass = document.getElementById('su-pass').value;
  if (!email || !pass) { paneError('su-error', 'Enter your email and password.'); return; }
  if (pass.length < 6) { paneError('su-error', 'Password must be at least 6 characters.'); return; }
  paneError('su-error', '');
  try {
    const { error } = await sb.auth.signUp({ email: email, password: pass });
    if (error) throw error;
    await enterApp();
  } catch (e) { paneError('su-error', e.message || 'Sign up failed.'); }
}

async function enterApp() {
  const { data } = await sb.auth.getUser();
  const u = data.user;
  if (!u) { show('auth'); return; }
  let level = null;
  try {
    const { data: prof } = await sb.from('profiles').select('level').eq('id', u.id).single();
    if (prof) level = prof.level;
  } catch (e) { /* RLS or missing row -> treat as pending */ }
  const isAdmin = (u.email || '').toLowerCase() === String(APP_CONFIG.ADMIN_EMAIL).toLowerCase();
  state.user = { id: u.id, email: u.email, level: level, isAdmin: isAdmin, demo: false };
  identifyPushUser(u.id, u.email, level);
  await migrateLocalToCloud();
  await afterLogin();
}

async function afterLogin() {
  if (!state.user.level && !state.user.isAdmin) { show('waiting'); return; }
  const level = state.user.level || 'intermediate';
  state.lessons = await loadLessons(level);
  state.lesson = state.lessons[0] || null;
  show('home');
  consumeDeepLink(); // push notification deep link -> newest lesson
}

async function doLogout() {
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  logoutPushUser();
  state.user = null; state.lessons = []; state.lesson = null; state.adminUsers = [];
  show('auth');
}

/* Demo mode (no Supabase configured) */
const DEMO_USERS = [
  { id: 'demo-u1', email: 'sara@example.com', level: null, created_at: Date.now() - 86400000 },
  { id: 'demo-u2', email: 'reza@example.com', level: 'beginner', created_at: Date.now() - 3 * 86400000 },
  { id: 'demo-u3', email: 'mina@example.com', level: 'intermediate', created_at: Date.now() - 5 * 86400000 }
];

async function demoLogin(asAdmin) {
  state.user = {
    email: asAdmin ? String(APP_CONFIG.ADMIN_EMAIL) : 'demo-learner@example.com',
    level: asAdmin ? 'intermediate' : 'intermediate',
    isAdmin: !!asAdmin,
    demo: true
  };
  state.adminUsers = DEMO_USERS.map(function (u) { return Object.assign({}, u); });
  state.lessons = await loadLessons('intermediate');
  state.lesson = state.lessons[0] || null;
  show('home');
  consumeDeepLink();
}

/* ---------------- waiting view ---------------- */
function renderWaiting(v) {
  v.innerHTML =
  '<div class="card">' +
    '<h1>Almost there ⏳</h1>' +
    '<p>Your account is created. Your teacher is assigning your level — check back soon and your daily lessons will appear here.</p>' +
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
      await afterLogin();
    } else {
      show('waiting');
    }
  } catch (e) { show('waiting'); }
}

/* ---------------- home view ---------------- */
function catCardHTML(m) {
  const isToday = m.date === todayStr();
  const first = (m.words && m.words[0]) || {};
  const img = first.photo
    ? '<div class="cat-placeholder">📚</div>' +
      '<img src="' + esc(first.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
    : '<div class="cat-placeholder">📚</div>';
  return '' +
  '<button class="cat-card" data-action="open-lesson" data-date="' + esc(m.date) + '">' +
    (isToday ? '<span class="today-badge">TODAY</span>' : '') +
    img +
    '<div class="cat-scrim"></div>' +
    '<div class="cat-body">' +
      '<div class="cat-theme">' + esc(m.theme || 'Lesson') + '</div>' +
      '<div class="cat-date">' + esc(m.date) + ' · ' + esc(m.level || '') + '</div>' +
    '</div>' +
  '</button>';
}

async function renderHome(v) {
  const lessons = state.lessons;
  const shown = state.showAllCats ? lessons : lessons.slice(0, 4);
  const avg = await getOverallAverage();
  const scores = (await getAttempts()).slice(0, 3);
  const mistakes = await getMistakes();

  let html = '';

  // Only show the enable-push card when the device is not already subscribed.
  // pushOptedIn is synced from OneSignal on boot; the localStorage flag covers
  // the case where the user opted in during an earlier visit.
  let pushDone = state.pushOptedIn === true;
  if (!pushDone) {
    try {
      pushDone = localStorage.getItem('el_push_opted_in') === '1' &&
        (typeof Notification === 'undefined' || Notification.permission === 'granted');
    } catch (e) { /* ignore */ }
  }
  if (oneSignalReady() && !state.user.demo && !pushDone) {
    html += '<div class="card plain"><b>🔔 Lesson notifications</b><p class="muted">Get a short notification when your daily lesson is ready.</p>' +
      '<p class="muted" id="push-status"></p>' +
      '<button class="btn btn-sm" data-action="enable-push">Enable notifications</button></div>';
  }

  // 01 Lesson categories
  html += '<div class="section-title"><h2>01 · Lessons</h2>' +
    (lessons.length > 4 ? '<button class="btn btn-ghost btn-sm" data-action="toggle-cats">' + (state.showAllCats ? 'Show less' : 'More') + '</button>' : '') +
    '</div>';
  if (!lessons.length) {
    html += '<div class="empty">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += '<div class="cat-grid">' + shown.map(catCardHTML).join('') + '</div>';
  }

  // 02 My Scores
  html += '<div class="section-title"><h2>02 · My Scores</h2>' +
    (scores.length ? '<button class="btn btn-ghost btn-sm" data-action="goto" data-view="scores">View all</button>' : '') + '</div>';
  if (avg === null) {
    html += '<div class="card plain"><p class="muted" style="margin:0">No quiz attempts yet. Finish a quiz to see your scores here.</p></div>';
  } else {
    html += '<div class="card avg-card"><div class="avg-num">' + avg + '%</div><div class="muted">overall average</div></div>';
    html += scores.map(attemptCardHTML).join('');
  }

  // 03 My Mistakes
  html += '<div class="section-title"><h2>03 · My Mistakes</h2>' +
    (mistakes.length ? '<button class="btn btn-ghost btn-sm" data-action="goto" data-view="mistakes">View all</button>' : '') + '</div>';
  if (!mistakes.length) {
    html += '<div class="card plain"><p class="muted" style="margin:0">No mistakes yet — nice work! Wrong answers will appear here so you can practice them again.</p></div>';
  } else {
    html += '<div class="card"><b>' + mistakes.length + ' word' + (mistakes.length === 1 ? '' : 's') + ' to review</b>' +
      '<p class="muted">' + esc(mistakes[0].question) + (mistakes.length > 1 ? ' …' : '') + '</p>' +
      '<button class="btn btn-green btn-block" data-action="practice-again">Practice again</button></div>';
  }

  v.innerHTML = html;
}

function attemptCardHTML(a) {
  const pct = a.total ? Math.round((a.score / a.total) * 100) : 0;
  const kindLabel = a.kind === 'grammar' ? 'Grammar quiz' : (a.kind === 'mistakes' ? 'Mistakes review' : 'Word quiz');
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

/* ---------------- lesson view ---------------- */
function lessonTabsHTML() {
  const tabs = [
    ['words', 'Words'],
    ['podcast', 'Podcast'],
    ['shadowing', 'Shadowing'],
    ['quiz', 'Quiz'],
    ['grammar', 'Grammar']
  ];
  return '<div class="lesson-tabs">' + tabs.map(function (t) {
    return '<button class="lesson-tab' + (state.lessonTab === t[0] ? ' active' : '') + '" data-action="lesson-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
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
    '<p><span class="badge-level">' + esc(m.level || '') + (m.cefr ? ' · ' + esc(m.cefr) : '') + '</span></p>' +
    lessonTabsHTML() + '<div id="lesson-body"></div>';
  v.innerHTML = html;
  renderLessonTab($('#lesson-body'));
}

function renderLessonTab(body) {
  const m = state.lesson;
  const tab = state.lessonTab;
  if (tab === 'words') body.innerHTML = wordsTabHTML(m);
  else if (tab === 'podcast') { body.innerHTML = podcastTabHTML(m); wireAudioCards(body); }
  else if (tab === 'shadowing') { body.innerHTML = shadowingTabHTML(m); wireAudioCards(body); }
  else if (tab === 'quiz') body.innerHTML = quizTabHTML(m);
  else if (tab === 'grammar') body.innerHTML = grammarTabHTML(m);
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
          ? '<button class="speaker-btn" data-action="play-track" data-src="' + esc(w.word_audio) + '" data-title="' + esc(w.word) + '" aria-label="Hear pronunciation">🔊</button>'
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
      speeds: false, download: true
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
      speeds: true, download: true
    });
}

function quizTabHTML(m) {
  const n = (m.quiz || []).length;
  if (!n) return '<div class="empty">No quiz for this lesson.</div>';
  return '<div class="card"><h3>📝 Word quiz</h3>' +
    '<p class="muted">' + n + ' questions on today\'s words. One at a time, instant feedback — wrong answers go straight to My Mistakes.</p>' +
    '<button class="btn btn-block" data-action="quiz-start" data-kind="word">Start quiz</button></div>';
}

function grammarTabHTML(m) {
  const g = m.grammar;
  if (!g) return '<div class="empty">No grammar lesson for this date.</div>';
  const paras = String(g.explanation || '').split(/\n\s*\n/).map(function (p) {
    return '<p>' + esc(p) + '</p>';
  }).join('');
  const examples = (g.examples || []).map(function (e) {
    return '<div class="example-card">' + esc(e) + '</div>';
  }).join('');
  const practice = (g.practice || []).map(function (p) {
    return '<details class="practice"><summary>' + esc(p.q) + '</summary><p style="margin:0.5rem 0 0">' + esc(p.a) + '</p></details>';
  }).join('');
  const quizBtn = (g.quiz && g.quiz.length)
    ? '<button class="btn btn-block" data-action="quiz-start" data-kind="grammar">Start grammar quiz (' + g.quiz.length + ' questions)</button>'
    : '';
  return '<div class="card"><h3>' + esc(g.title || 'Grammar') + '</h3>' +
    '<div class="grammar-body">' + paras + '</div>' +
    (examples ? '<h3>Examples</h3>' + examples : '') +
    (practice ? '<h3>Practice</h3>' + practice : '') +
    quizBtn + '</div>';
}

/* ---------------- quiz engine ---------------- */
async function startQuiz(kind) {
  const m = state.lesson;
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
    questions = (await getMistakes()).map(function (mk) {
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
    (q.kind === 'mistakes' ? ' · reviewing mistakes' : '') + '</div>' +
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
    html += '<div class="quiz-feedback ' + (good ? 'good' : 'bad') + '">' +
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
  state.quiz = null;
  $('#view').innerHTML =
  '<div class="card"><div class="score-hero">' +
    '<div class="score-big">' + q.correct + '/' + total + '</div>' +
    '<div class="score-sub">' + pct + '% · ' +
    (pct >= 85 ? 'Excellent work! 🌟' : pct >= 60 ? 'Good — keep practicing! 💪' : 'Keep going — review your mistakes below. 📚') +
    '</div></div>' +
    '<div class="btn-row">' +
      '<button class="btn" data-action="goto" data-view="home">Home</button>' +
      '<button class="btn btn-ghost" data-action="goto" data-view="mistakes">My Mistakes</button>' +
    '</div></div>';
  window.scrollTo(0, 0);
}

/* ---------------- scores view ---------------- */
async function renderScores(v) {
  const arr = await getAttempts();
  const avg = await getOverallAverage();
  let html = '<h1>My Scores</h1>';
  if (avg === null) {
    html += '<div class="empty">No quiz attempts yet.<br>Finish a quiz and your scores will appear here.</div>';
  } else {
    html += '<div class="card avg-card"><div class="avg-num">' + avg + '%</div><div class="muted">overall average · ' + arr.length + ' attempts</div></div>';
    html += arr.map(attemptCardHTML).join('');
  }
  v.innerHTML = html;
}

/* ---------------- mistakes view ---------------- */
async function renderMistakes(v) {
  const arr = await getMistakes();
  let html = '<h1>My Mistakes</h1>';
  if (!arr.length) {
    html += '<div class="empty">No mistakes — everything you got wrong will land here for review. 🎉</div>';
  } else {
    html += '<div class="card plain"><b>' + arr.length + ' to review</b>' +
      '<p class="muted" style="margin:0.4rem 0 0">Answer one correctly and it leaves the list.</p>' +
      '<button class="btn btn-green btn-block" data-action="practice-again">Practice again</button></div>';
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
      '<select class="level-select" data-user-id="' + esc(u.id) + '" aria-label="Set level">' +
        '<option value="">— set level —</option>' +
        ['beginner', 'intermediate', 'advanced'].map(function (lv) {
          return '<option value="' + lv + '"' + (u.level === lv ? ' selected' : '') + '>' + lv + '</option>';
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
  $('#view').addEventListener('click', async function (e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.getAttribute('data-action');

    if (a === 'login') doLogin();
    else if (a === 'signup') doSignup();
    else if (a === 'demo-learner') demoLogin(false);
    else if (a === 'demo-admin') demoLogin(true);
    else if (a === 'check-level') checkLevel();
    else if (a === 'goto') show(t.getAttribute('data-view'));
    else if (a === 'toggle-cats') { state.showAllCats = !state.showAllCats; show('home'); }
    else if (a === 'open-lesson') { state.lessonTab = 'words'; show('lesson', t.getAttribute('data-date')); }
    else if (a === 'lesson-tab') {
      state.lessonTab = t.getAttribute('data-tab');
      document.querySelectorAll('.lesson-tab').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === state.lessonTab);
      });
      renderLessonTab($('#lesson-body'));
    }
    else if (a === 'play-track') playTrack(t.getAttribute('data-src'), t.getAttribute('data-title'));
    else if (a === 'speed') { player.el.playbackRate = parseFloat(t.getAttribute('data-rate')); refreshTrackCards(); }
    else if (a === 'quiz-start') startQuiz(t.getAttribute('data-kind'));
    else if (a === 'quiz-opt') answerQuiz(parseInt(t.getAttribute('data-idx'), 10));
    else if (a === 'quiz-next') nextQuiz();
    else if (a === 'practice-again') {
      getMistakes().then(function (arr) {
        if (arr.length) startQuiz('mistakes');
        else show('mistakes');
      });
    }
    else if (a === 'enable-push') promptPush(t);
  });

  $('#view').addEventListener('change', function (e) {
    const t = e.target.closest('[data-user-id]');
    if (t) setUserLevel(t.getAttribute('data-user-id'), t.value);
  });

  $('#view').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.target.id === 'su-email' || e.target.id === 'su-pass')) doSignup();
    if (e.key === 'Enter' && (e.target.id === 'li-email' || e.target.id === 'li-pass')) doLogin();
  });

  $$('#tabbar .tab').forEach(function (t) {
    t.addEventListener('click', function () { show(t.getAttribute('data-view')); });
  });

  $('#btn-logout').addEventListener('click', doLogout);
  $('#mp-toggle').addEventListener('click', function () {
    if (!player.src) return;
    if (player.el.paused) player.el.play().catch(function () {});
    else player.el.pause();
  });
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
  show('auth');
}

document.addEventListener('DOMContentLoaded', init);

})();
