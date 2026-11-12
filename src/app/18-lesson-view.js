/* ---------------- lesson view ---------------- */
function lessonTabsHTML(m) {
  const tabs = [
    ['words', 'Words', ICO.book],
    ['quiz', 'Quiz', ICO.quiz],
    ['podcast', 'Podcast', ICO.headphones],
    ['shadowing', 'Shadowing', ICO.mic],
    ['grammar', 'Grammar', ICO.grid]
  ].filter(function (t) { return t[0] !== 'podcast' || lessonHasPodcast(m); });
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
    lessonTabsHTML(m) + '<div id="lesson-body"></div>';
  v.innerHTML = html;
  renderLessonTab($('#lesson-body'));
}

/* Task 5 (2026-11-12): one-tap lesson rating, once per lesson. */
function maybeShowLessonRating(body, m) {
  try {
    if (!m || !m.date || !state.user || state.user.demo) return;
    if (localStorage.getItem('el_lesson_rated_' + m.date)) return;
    const d = getDayProgress(m.date);
    const steps = stepsForDate(m.date);
    if (!steps.length || !steps.every(function (x) { return !!d[x]; })) return;
    localStorage.setItem('el_lesson_rated_' + m.date, 'shown');
    const fa = (typeof uiLang === 'function' && uiLang() === 'fa');
    const dict = window.MUSE_FA_UI && window.MUSE_FA_UI.t;
    const T = function (en) { return fa && dict && dict[en] ? dict[en] : en; };
    const card = document.createElement('div');
    card.className = 'card plain rate-card';
    card.innerHTML = (fa ? '<div dir="rtl">' : '<div>') +
      '<h3 class="rate-title">' + T('How was this lesson?') + '</h3>' +
      '<div class="rate-btns">' +
      ['\uD83D\uDE1E', '\uD83D\uDE10', '\uD83D\uDE42', '\uD83D\uDE0D'].map(function (e, i) {
        return '<button class="rate-btn" data-action="lesson-rate" data-score="' + (i + 1) + '" aria-label="Rate ' + (i + 1) + ' of 4">' + e + '</button>';
      }).join('') + '</div></div>';
    body.prepend(card);
  } catch (e) {}
}

function renderLessonTab(body) {
  const m = state.lesson;
  let tab = state.lessonTab;
  if (tab === 'podcast' && !lessonHasPodcast(m)) tab = 'words';
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
  try { body.classList.toggle('fa-tr-off', !faTrVisible(m)); } catch (e) {}
  maybeShowLessonRating(body, m);
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
      (w.example_fa ? '<div class="word-example-fa" dir="rtl">' + esc(w.example_fa) + '</div>' : '') +
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
  return faToggleBtn(m) + cards + pronCard + cta;
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
  if (normalizeLevel(m.level) !== 'a1' && normalizeLevel(m.level) !== 'a2') html += '<div class="sum-card">' +
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
    faToggleBtn(m) + '<div id="sp-sentences"></div></div>';
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
/* Third try onwards (Alireza 2026-11-02): grade very generously so a
   learner who keeps practising can reach the green band and stay
   motivated. Same word matching — only the band thresholds drop. */
const SHADOW_SCORING_EASY = { fuzzy: true, minRun: 1, greatAt: 50, okAt: 25 };
function spScoringFor(prior) {
  return prior <= 0 ? SHADOW_SCORING_FIRST : prior === 1 ? SHADOW_SCORING : SHADOW_SCORING_EASY;
}

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
        '<div class="sp-score-label">of this sentence' + (pts ? ' · +' + pts + ' pts' : '') + '</div></div>';
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

/* Split a story transcript into practice items. Handles numbered lines
   ("1. Hello.") and plain lines; drops a leading title line.
   The per-sentence studio clips are generated ONE PER TRANSCRIPT LINE, so
   line items are the pairing truth. The old code also cut lines at every
   '.', which split "Mr. Lee" into two fake sentences and shifted every
   text<->audio pairing after it (his desync report, 2026-11-06). Now:
   line items win whenever their count matches the clip count; otherwise
   an abbreviation-safe sentence split is tried, and the candidate that
   matches (or comes closest to) the clip count is used. */
function splitSentences(text, audioCount) {
  const lines = String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  const lineItems = [];
  lines.forEach(function (ln, idx) {
    const numbered = ln.match(/^\d+\.\s*(.+)$/);
    const s = (numbered ? numbered[1] : ln).trim();
    if (idx === 0 && !numbered && !/[.!?…]$/.test(s)) return; /* title line */
    if (s.length > 1) lineItems.push(s);
  });
  if (!audioCount || lineItems.length === audioCount) return lineItems;
  const sentItems = [];
  lineItems.forEach(function (s) {
    /* Protect dots that are not sentence ends (Mr., Dr., e.g., 3.5). */
    const safe = s
      .replace(/\b(Mr|Mrs|Ms|Dr|St|Prof|Sr|Jr|vs)\./gi, '$1\uE000')
      .replace(/\b([A-Za-z])\.([A-Za-z])\./g, '$1\uE000$2\uE000')
      .replace(/(\d)\.(\d)/g, '$1\uE000$2');
    const parts = safe.match(/[^.!?]+[.!?]+["'”’]?/g) || [safe];
    parts.forEach(function (p) {
      p = p.replace(/\uE000/g, '.').trim();
      if (p.length > 1) sentItems.push(p);
    });
  });
  if (sentItems.length === audioCount) return sentItems;
  return Math.abs(sentItems.length - audioCount) < Math.abs(lineItems.length - audioCount)
    ? sentItems : lineItems;
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
  const sentences = splitSentences(targetText,
    (m.shadowing && m.shadowing.sentence_audio || []).length);
  let faLines = [];
  if (m.shadowing && m.shadowing.transcript_fa) {
    try { const faText = await (await fetch(m.shadowing.transcript_fa)).text(); faLines = faText.split(/\r?\n/); }
    catch (e) { faLines = []; }
  }

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
      (faLines[i] && faLines[i].trim() ? '<div class="sp-sent-fa" dir="rtl">' + esc(faLines[i].trim()) + '</div>' : '') +
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
      const scoring = spScoringFor(prior);
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

