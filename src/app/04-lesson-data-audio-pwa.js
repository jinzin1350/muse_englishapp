/* ---------------- lesson progress: lightweight per-user localStorage ----------------
   Tracks which steps of each daily lesson the learner has engaged with.
   Steps: words → quiz (reward!) → bonus: podcast → shadowing → grammar. */
const STEPS = ['words', 'quiz', 'podcast', 'shadowing', 'grammar'];
/* Task 4 (2026-11-12): lessons may have no podcast (A1) and may carry Persian
   help (shadowing.transcript_fa, words[].example_fa). Steps/visibility derive
   from the manifest so old and new formats both work. */
function lessonHasPodcast(m) { return !!(m && m.podcast && m.podcast.audio); }
function stepsForLesson(m) { return lessonHasPodcast(m) ? STEPS : STEPS.filter(function (x) { return x !== 'podcast'; }); }
function stepsForDate(dateStr) {
  const m = (state.lessons || []).find(function (x) { return x.date === dateStr; });
  return m ? stepsForLesson(m) : STEPS;
}
function lessonHasFaTr(m) {
  if (!m) return false;
  if (m.shadowing && m.shadowing.transcript_fa) return true;
  return (m.words || []).some(function (w) { return !!w.example_fa; });
}
function faTrVisible(m) {
  const lvl = normalizeLevel(m && m.level);
  if (lvl === 'a1' || lvl === 'a2') return true;
  if (lvl === 'b1') return !!state.lessonFaShow;
  return false;
}
function faToggleBtn(m) {
  if (normalizeLevel(m && m.level) !== 'b1' || !lessonHasFaTr(m)) return '';
  return '<button class="btn btn-ghost btn-sm lesson-fa-toggle" data-action="toggle-lesson-fa">' +
    (state.lessonFaShow ? 'Hide Persian translation' : 'Show Persian translation') + '</button>';
}
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
  return stepsForDate(dateStr).filter(function (s) { return !!d[s]; }).length;
}
function nextStep(dateStr) {
  const d = getDayProgress(dateStr);
  const steps = stepsForDate(dateStr);
  for (let i = 0; i < steps.length; i++) {
    if (!d[steps[i]]) return steps[i];
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
        trySyncTranscript(panel, btn.getAttribute('data-transcript'));
      }).catch(function () { panel.textContent = 'Could not load the transcript.'; });
    }
  } else {
    panel.classList.add('hidden');
    btn.textContent = '📝 Transcript';
  }
}

/* ---- Synced (karaoke) podcast transcript — Alireza, 2026-10-25 ----
   Timings live next to the episode (podcast-timings.json, generated by
   ~/workspace/bin/podcast-timings.py from real silence boundaries in the
   audio). Episodes without a timings file keep the plain transcript.
   The active sentence is highlighted as the audio plays; tapping a
   sentence seeks there. */
function txTimingsUrl(transcriptUrl) {
  if (!transcriptUrl || transcriptUrl.indexOf('podcast-transcript.txt') === -1) return null;
  return transcriptUrl.replace('podcast-transcript.txt', 'podcast-timings.json?v=2');
}
function trySyncTranscript(panel, transcriptUrl) {
  const tu = txTimingsUrl(transcriptUrl);
  if (!tu || panel.dataset.txTried) return;
  panel.dataset.txTried = '1';
  fetch(tu).then(function (r) {
    if (!r.ok) throw new Error('no timings');
    return r.json();
  }).then(function (data) {
    if (!data || !Array.isArray(data.s) || !data.s.length) return;
    renderTxSynced(panel, data.s);
  }).catch(function () { /* plain transcript stays */ });
}
function renderTxSynced(panel, rows) {
  let html = '<div class="tx-hint">✨ Synced transcript — tap any sentence to play from there</div>';
  let curSp = null, open = false;
  rows.forEach(function (row, i) {
    const sp = row[1] || '', x = row[2] || '';
    if (sp !== curSp) {
      if (open) html += '</div>';
      html += '<div class="tx-line">' + (sp ? '<span class="tx-sp">' + esc(sp) + ':</span> ' : '');
      curSp = sp; open = true;
    }
    html += '<span class="tx-s" data-t="' + row[0] + '" data-i="' + i + '">' + esc(x) + '</span> ';
  });
  if (open) html += '</div>';
  panel.innerHTML = html;
  panel.classList.add('tx-synced');
  panel._tx = { rows: rows, idx: -1 };
  panel.addEventListener('click', function (e) {
    const s = e.target && e.target.closest ? e.target.closest('.tx-s') : null;
    if (s) txSeekTo(panel, parseFloat(s.getAttribute('data-t')) || 0);
  });
  syncTxTick();
}
function txCardSrc(panel) {
  const card = panel.closest('[data-audio-card]');
  const btn = card && card.querySelector('[data-action="play-track"]');
  return btn ? btn.getAttribute('data-src') : null;
}
function txSameSrc(a, b) {
  if (!a || !b) return false;
  const norm = function (u) {
    return decodeURIComponent(String(u)).replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
  };
  const na = norm(a), nb = norm(b);
  return nb === na || nb.endsWith('/' + na) || na.endsWith('/' + nb);
}
function txSeekTo(panel, t) {
  const src = txCardSrc(panel);
  if (!src) return;
  const seek = function () {
    try { player.el.currentTime = t; } catch (e) {}
    if (player.el.paused) { try { player.el.play(); } catch (e) {} }
    syncTxTick();
  };
  if (txSameSrc(src, player.src)) { seek(); return; }
  const card = panel.closest('[data-audio-card]');
  const btn = card && card.querySelector('[data-action="play-track"]');
  if (!btn) return;
  btn.click();
  const iv = setInterval(function () {
    if (txSameSrc(src, player.src) && player.el.readyState >= 1) { clearInterval(iv); seek(); }
  }, 200);
  setTimeout(function () { clearInterval(iv); }, 4000);
}
function syncTxTick() {
  const panels = document.querySelectorAll('.transcript-panel.tx-synced');
  if (!panels.length) return;
  panels.forEach(function (panel) {
    if (!panel._tx || panel.classList.contains('hidden')) return;
    const spans = panel.querySelectorAll('.tx-s');
    if (!txSameSrc(txCardSrc(panel), player.src)) {
      if (panel._tx.idx !== -1) {
        panel._tx.idx = -1;
        spans.forEach(function (s) { s.classList.remove('on'); });
      }
      return;
    }
    const t = player.el.currentTime || 0;
    const rows = panel._tx.rows;
    let lo = 0, hi = rows.length - 1, idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid][0] <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (idx === panel._tx.idx) return;
    panel._tx.idx = idx;
    spans.forEach(function (s) {
      s.classList.toggle('on', parseInt(s.getAttribute('data-i'), 10) === idx);
    });
    if (idx >= 0 && spans[idx]) {
      const pr = panel.getBoundingClientRect(), sr = spans[idx].getBoundingClientRect();
      if (sr.top < pr.top + 30 || sr.bottom > pr.bottom - 30) {
        panel.scrollTo({ top: panel.scrollTop + (sr.top - pr.top) - 60, behavior: 'smooth' });
      }
    }
  });
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
  player.el.addEventListener('timeupdate', function () { try { syncTxTick(); } catch (e) {} });
  player.el.addEventListener('seeked', function () { try { syncTxTick(); } catch (e) {} });
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
    if (r.ok) return true;
  } catch (e) {}
  // Hosts without CORS headers (e.g. the R2 public bucket holding the
  // pre-2026-10-10 lesson media) fail the fetch check even when the file
  // exists, but a media element can still load them — probe with one.
  return new Promise(function (resolve) {
    const probe = new Audio();
    let done = false;
    const finish = function (ok) {
      if (done) return;
      done = true;
      try { probe.removeAttribute('src'); probe.load(); } catch (e) {}
      resolve(ok);
    };
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', function () { finish(true); });
    probe.addEventListener('error', function () { finish(false); });
    setTimeout(function () { finish(false); }, 8000);
    probe.src = url;
  });
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
/* Saved-word / saved-sentence snapshots taken before the 2026-10-30 R2
   migration still hold relative media/<level>/<date>/... paths for
   pre-2026-10-10 lessons; those files now live only on R2. Translate the
   stale path at playback time so old snapshots play again. */
var R2_MEDIA_BASE = 'https://pub-b26d6db3b0dd4beeb7e10e9ab20e4012.r2.dev/';
function playableSrc(src) {
  if (src && player._blobFor === src && player._blobUrl) return player._blobUrl;
  if (src && src.indexOf('media/') === 0) {
    var m = /^media\/[^/]+\/(\d{4}-\d{2}-\d{2})\//.exec(src);
    if (m && m[1] < '2026-10-10') return R2_MEDIA_BASE + encodeURI(src);
  }
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
    ? '<button class="btn btn-ghost btn-sm ap-chip" data-action="toggle-transcript" data-transcript="' + esc(o.transcript) + '" aria-expanded="false"' + (o.fa ? ' lang="fa"' : '') + '>📝 ' + (o.fa ? 'متن کامل' : 'Transcript') + '</button>'
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
    '<div class="coming-soon hidden"' + (o.fa ? ' dir="rtl" lang="fa">🎵 صدای این بخش هنوز منتشر نشده و به‌زودی همین‌جا می‌آید.' : '>🎵 Audio is coming soon — it will appear here automatically once published.') + '</div>' +
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

