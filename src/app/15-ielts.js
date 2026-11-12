/* ---------------- IELTS Academic full mock (#/ielts) ----------------
   Modelled on the official format (ielts.org) and the British Council
   computer familiarisation test: timed sections, one sitting per skill,
   instant Listening/Reading band scores from the published conversion
   tables, Writing/Speaking shown as transparent estimates + model answers.
   Content: data/ielts/academic-mock-1.json (100% original). */

var IELTS_L_BANDS = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [0, 2]];
var IELTS_R_BANDS = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [0, 2]];
var IELTS_LINKERS = ['overall', 'however', 'moreover', 'furthermore', 'in addition', 'on the other hand', 'in contrast', 'for example', 'for instance', 'as a result', 'therefore', 'consequently', 'similarly', 'meanwhile', 'firstly', 'secondly', 'finally', 'in conclusion', 'although', 'whereas', 'while', 'despite', 'in my opinion', 'it is clear that', 'in summary'];

function ieltsBandFor(table, raw) {
  for (var i = 0; i < table.length; i++) { if (raw >= table[i][0]) return table[i][1]; }
  return 2;
}
function ieltsRoundOverall(avg) { return Math.round(avg * 2) / 2; }
function ieltsBandTxt(b) { return (b % 1 === 0) ? b.toFixed(1) : ('' + b); }
function ieltsWc(text) { var m = (text || '').trim().match(/\S+/g); return m ? m.length : 0; }
function ieltsNorm(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/g, '').replace(/^[£$]/, '').trim();
}
function ieltsGapOk(q, val) {
  var v = ieltsNorm(val);
  if (!v) return false;
  return (q.accept || []).some(function (a) { return ieltsNorm(a) === v; });
}
function ieltsCorrectText(q) {
  if (q.type === 'gap') return (q.accept || [])[0] || '';
  return (q.options || [])[q.answer] || '';
}
function ieltsUserText(q, ans) {
  if (ans === undefined || ans === null || ans === '') return '(no answer)';
  if (q.type === 'gap') return '' + ans;
  return (q.options || [])[ans] || '(no answer)';
}

var IELTS_DATA = null;
function loadIeltsData() {
  if (IELTS_DATA) return Promise.resolve(IELTS_DATA);
  return fetch('/data/ielts/academic-mock-1.json').then(function (r) {
    if (!r.ok) throw new Error('mock data ' + r.status);
    return r.json();
  }).then(function (d) { IELTS_DATA = d; return d; });
}

function ieltsGetRun() {
  var r = lsGet('ieltsRun');
  return (r && typeof r === 'object' && !Array.isArray(r) && r.stage) ? r : null;
}
function ieltsSaveRun(r) { lsSet('ieltsRun', r); }
function ieltsNewRun() {
  return {
    stage: 'l-intro', lPart: 0, lAns: {}, rAns: {}, rPassage: 0,
    w1: '', w2: '', wTask: 0,
    spStep: 0, spText: { p1: '', p2: '', p3: '' }, spRecorded: {}, spP2Secs: 0,
    endsAt: 0, startedAt: Date.now(), done: false
  };
}
function ieltsStopTimer() {
  if (state.ielts && state.ielts.timerId) { clearInterval(state.ielts.timerId); state.ielts.timerId = null; }
}
function ieltsStopMedia() {
  ieltsStopTimer();
  if (state.ielts && state.ielts.audio) { try { state.ielts.audio.pause(); } catch (e) {} state.ielts.audio = null; }
  if (state.ielts && state.ielts.rec) { try { state.ielts.rec.stop(); } catch (e) {} state.ielts.rec = null; }
  if (state.ielts && state.ielts.recIv) { clearInterval(state.ielts.recIv); state.ielts.recIv = null; }
  if (state.ielts && state.ielts.mr && state.ielts.mr.state !== 'inactive') { try { state.ielts.mr.stop(); } catch (e) {} }
  if (state.ielts && state.ielts.stream) { try { state.ielts.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} state.ielts.stream = null; }
}
function ieltsView() { return document.getElementById('view'); }

/* Daily-review reminder card (Alireza, 2026-11-06): appears on Home only
   when bookmarked words are due for their spaced-repetition review. */
async function paintReviewDue() {
  const wrap = document.getElementById('home-review-wrap');
  if (!wrap) return;
  let arr = [];
  try { arr = await getSavedWords(); } catch (e) { return; }
  if (!document.getElementById('home-review-wrap')) return;
  const due = srsDueRows(arr).length;
  if (!due) { wrap.innerHTML = ''; return; }
  const label = due + ' saved word' + (due > 1 ? 's' : '') + ' due for review';
  if (!isDesktop()) {
    wrap.innerHTML = '<div class="hm-card">' +
      '<span class="hm-icon">🔁</span><span class="hm-main"><span class="hm-kicker">DAILY REVIEW</span>' +
      '<span class="hm-title">' + label + '</span>' +
      '<span class="hm-subtxt">Spaced repetition — a few minutes keeps them in your memory</span></span>' +
      '<button class="hm-btn" data-action="review-due-start">Review →</button></div>';
    return;
  }
  wrap.innerHTML = '<div class="g-banner">' +
    '<span class="g-b-icon">🔁</span><span class="g-b-main"><b>Daily review</b>' +
    '<span>' + label + ' — spaced repetition keeps them in your memory</span></span>' +
    '<button class="g-b-cta" data-action="review-due-start">Review →</button></div>';
}

function paintIeltsBanner() {
  var wrap = document.getElementById('home-ielts-wrap');
  if (!wrap) return;
  var arch = lsGet('ieltsResults');
  var last = (arch && arch.length) ? arch[0] : null;
  var sub = last ? 'Last overall band: ' + ieltsBandTxt(last.overall) + ' · take it again any time'
    : 'Full Academic test · Listening, Reading, Writing, Speaking · about 2 hours 45 minutes';
  if (!isDesktop()) {
    wrap.innerHTML = '<a class="hm-card" href="#/ielts">' +
      '<span class="hm-icon">🎓</span><span class="hm-main"><span class="hm-kicker">IELTS</span>' +
      '<span class="hm-title">IELTS Mock Test ' + (IELTS_MOCK_FREE ? '<span class="ix-vip-badge">Free</span>' : '<span class="ix-vip-badge">⭐ VIP</span>') + '</span>' +
      '<span class="hm-subtxt">' + esc(sub) + '</span></span>' +
      '<span class="hm-btn hm-btn-soft">Start →</span></a>';
    return;
  }
  wrap.innerHTML = '<a class="g-banner" href="#/ielts">' +
    '<span class="g-b-icon">🎓</span><span class="g-b-main"><b>IELTS Mock Test</b> ' + (IELTS_MOCK_FREE ? '<span class="ix-vip-badge">Free</span>' : '<span class="ix-vip-badge">⭐ VIP</span>') +
    '<span>' + esc(sub) + '</span></span><span class="g-b-cta">Start →</span></a>';
}

/* ---------- VIP gate (Alireza's order 2026-11-04) ----------
   The IELTS mock is a VIP-only feature. Admins and approved teachers
   always pass; students need profiles.is_vip = true (Admin panel toggle). */
/* FREE MODE (Alireza 2026-11-10): the mock is free for every signed-in
   learner "for now". Set IELTS_MOCK_FREE = false to restore the VIP gate.
   If you flip it back, the /fa/ielts/ page copy must change the same day. */
var IELTS_MOCK_FREE = true;
async function ieltsFetchVip() {
  if (!state.user) return false;
  if (IELTS_MOCK_FREE && !state.user.demo) return true;
  if (state.user.isAdmin) return true;
  if (state.user.demo) return false;
  if (state.user.isVip !== undefined) return state.user.isVip;
  var vip = false;
  if (sb) {
    try { var pr = await sb.from('profiles').select('is_vip').eq('id', state.user.id).single(); if (pr.data) vip = !!pr.data.is_vip; } catch (e) {}
    if (!vip) { try { var tr = await sb.from('teachers').select('status').eq('user_id', state.user.id).single(); if (tr.data && tr.data.status === 'approved') vip = true; } catch (e) {} }
  }
  state.user.isVip = vip;
  return vip;
}

function ieltsLocked(v) {
  v.innerHTML = '<div class="ix-wrap"><div class="ix-intro">' +
    '<div class="gt-mascot">🎓</div>' +
    '<h1>IELTS Academic — Full Mock Test</h1>' +
    '<p class="gt-sub">⭐ This feature is for <b>VIP members</b> only</p>' +
    '<div class="ix-format">' +
    '<div><b>🎧 Listening</b><span>4 parts · 40 questions · ~30 min</span></div>' +
    '<div><b>📖 Reading</b><span>3 passages · 40 questions · 60 min</span></div>' +
    '<div><b>✍️ Writing</b><span>2 tasks · chart + essay · 60 min</span></div>' +
    '<div><b>🎤 Speaking</b><span>3 parts · recorded · scored by your teacher</span></div>' +
    '</div>' +
    '<div class="ix-card ix-center"><div class="gt-mascot">⭐</div><h3>VIP members only</h3>' +
    '<p>The full IELTS mock test — including Speaking scored by a real teacher — is part of the VIP plan.</p>' +
    '<p class="ix-note">Ask your teacher to activate VIP on your account, or contact the Muse English team. The moment you are VIP, this page opens for you.</p>' +
    '<a class="gt-btn" href="#/home">Back to home</a></div></div></div>';
  window.scrollTo(0, 0);
}

function renderIelts(v, arg) {
  ieltsStopMedia();
  if (arg === 'report') { ieltsRenderResults(v, null); return; }
  v.innerHTML = '<div class="ix-wrap"><div class="empty">Loading…</div></div>';
  ieltsFetchVip().then(function (vip) {
    if (!vip) { ieltsLocked(v); return; }
    ieltsFlushPending();
    state.ielts = state.ielts || {};
    var run = ieltsGetRun();
    if (run && !run.done) { ieltsRenderStage(v, run); return; }
    ieltsIntro(v);
  });
}

function ieltsIntro(v) {
  var arch = lsGet('ieltsResults');
  var hasArch = arch && arch.length;
  var last = hasArch ? arch[0] : null;
  var startImg = '<img src="/media/ielts/design/start-button.png" alt="START THE MOCK TEST">';
  v.innerHTML = '<div class="ix-wrap"><div class="ix2">' +
    '<img class="ix2-books" src="/media/ielts/design/books.png" alt="">' +
    '<img class="ix2-cap" src="/media/ielts/design/cap.png" alt="">' +
    '<h1 class="ix2-title">IELTS Academic \u2014 Full Mock Test</h1>' +
    '<img class="ix2-badge" src="/media/ielts/design/badge.png" alt="4 skills \u00B7 real timing \u00B7 band scores">' +
    '<p class="ix2-lede">This mock follows the official IELTS Academic format, like the British Council computer test: ' +
    'each skill is taken in one sitting, the recordings play <b>once</b>, and Listening &amp; Reading are scored ' +
    'instantly with the published band conversion tables. Writing shows a transparent estimate plus model ' +
    'answers. Speaking is different: your answers are <b>recorded and sent to your teacher</b> (or to the Muse English team if you don\u2019t have one), who listens and awards your band \u2014 no AI scoring.</p>' +
    '<div class="ix2-cards">' +
    '<img src="/media/ielts/design/card-listening.png" alt="Listening \u2014 4 parts, 40 questions, about 30 minutes">' +
    '<img src="/media/ielts/design/card-reading.png" alt="Reading \u2014 3 passages, 40 questions, 60 minutes">' +
    '<img src="/media/ielts/design/card-writing.png" alt="Writing \u2014 2 tasks, chart and essay, 60 minutes">' +
    '<img src="/media/ielts/design/card-speaking.png" alt="Speaking \u2014 3 parts, interview, about 14 minutes">' +
    '</div>' +
    (last ? '<p class="gt-last">Your last mock: <b>Overall Band ' + ieltsBandTxt(last.overall) + '</b> \u00B7 ' +
      'L ' + ieltsBandTxt(last.bands.l) + ' \u00B7 R ' + ieltsBandTxt(last.bands.r) + ' \u00B7 W ' + ieltsBandTxt(last.bands.w) + ' \u00B7 S ' + (last.bands.s === null || last.bands.s === undefined ? '\u23F3 teacher' : ieltsBandTxt(last.bands.s)) +
      ' \u00B7 <a href="#/ielts/report">view report</a></p>' : '') +
    '<div id="ix-intro-err"></div>' +
    '<button class="ix2-start" id="ix-start" aria-label="Start the mock test">' + startImg + '</button>' +
    '<div class="ix2-note"><svg class="ix2-hp" viewBox="0 0 24 24" fill="none" stroke="#F26522" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 15v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6.5" rx="1.8"/><rect x="17" y="14" width="4" height="6.5" rx="1.8"/></svg>' +
    '<p>Find a quiet place and use headphones. You need a microphone for Speaking. ' +
    'Your progress is saved on this device, so you can continue if the page reloads.</p></div>' +
    '</div></div>';
  document.getElementById('ix-start').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.innerHTML = '<span class="ix2-loading-txt">LOADING\u2026</span>';
    loadIeltsData().then(function () {
      var run = ieltsNewRun();
      ieltsSaveRun(run);
      ieltsRenderStage(ieltsView(), run);
    }).catch(function () {
      btn.disabled = false; btn.innerHTML = startImg;
      document.getElementById('ix-intro-err').innerHTML = '<div class="empty">Could not load the test. Check your connection and try again.</div>';
    });
  });
  window.scrollTo(0, 0);
}
/* ---------- manual stop (pause / exit / discard) ---------- */
function ieltsShowStop() {
  ieltsStopMedia();
  if (document.getElementById('ix-stop-overlay')) return;
  var ov = document.createElement('div');
  ov.className = 'ix-overlay';
  ov.id = 'ix-stop-overlay';
  ov.innerHTML = '<div class="ix-overlay-card"><h3>\u23F8 Test stopped</h3>' +
    '<p>Your answers so far are saved automatically. Keep going now, pause and resume later from the IELTS page, or discard this test and start over.</p>' +
    '<button class="gt-btn gt-btn-green" id="ix-stop-keep">\u25B6 Keep going</button>' +
    '<button class="gt-btn" id="ix-stop-exit">\u23F8 Pause & exit</button>' +
    '<button class="gt-btn ix-stop-discard" id="ix-stop-discard">\uD83D\uDDD1 Discard this test</button></div>';
  document.body.appendChild(ov);
  document.getElementById('ix-stop-keep').addEventListener('click', function () {
    ov.remove();
    var run = ieltsGetRun();
    if (run && !run.done) ieltsRenderStage(ieltsView(), run);
    else ieltsIntro(ieltsView());
  });
  document.getElementById('ix-stop-exit').addEventListener('click', function () {
    ov.remove();
    window.location.hash = '#/home';
  });
  document.getElementById('ix-stop-discard').addEventListener('click', function () {
    ov.remove();
    lsSet('ieltsRun', {});
    state.ielts = {};
    ieltsIntro(ieltsView());
  });
}
if (!window.__ieltsStopBound) {
  window.__ieltsStopBound = true;
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'ix-stopbtn') ieltsShowStop();
  });
}

function ieltsHeadHTML(run, title, sub, timerSecs) {
  var steps = ['Listening', 'Reading', 'Writing', 'Speaking'];
  var cur = { 'l-intro': 0, 'listening': 0, 'r-intro': 1, 'reading': 1, 'w-intro': 2, 'writing': 2, 's-intro': 3, 'speaking': 3 }[run.stage];
  var pills = steps.map(function (s, i) {
    return '<span class="ix-pill' + (i === cur ? ' on' : (i < cur ? ' done' : '')) + '">' + s + '</span>';
  }).join('');
  return '<div class="ix-head"><div class="ix-pills">' + pills + '</div>' +
    '<div class="ix-head-row"><h2>' + esc(title) + '</h2>' +
    (timerSecs !== null && timerSecs !== undefined ? '<div class="ix-timer" id="ix-timer">' + gtestFmt(timerSecs) + '</div>' : '') +
    '<button type="button" class="ix-stop" id="ix-stopbtn">⏹ Stop test</button>' +
    '</div>' + (sub ? '<p class="ix-sub">' + sub + '</p>' : '') + '</div>';
}

function ieltsStartTimer(run, onTimeout) {
  ieltsStopTimer();
  state.ielts = state.ielts || {};
  state.ielts.timerId = setInterval(function () {
    var left = Math.round((run.endsAt - Date.now()) / 1000);
    var el = document.getElementById('ix-timer');
    if (el) { el.textContent = gtestFmt(Math.max(0, left)); el.classList.toggle('low', left <= 60 && left > 0); }
    if (left <= 0) { ieltsStopTimer(); onTimeout(); }
  }, 500);
}

function ieltsRenderStage(v, run) {
  loadIeltsData().then(function (data) {
    state.ielts = state.ielts || {};
    state.ielts.data = data;
    if (run.stage === 'l-intro' || run.stage === 'listening') ieltsRenderListening(v, run, data);
    else if (run.stage === 'r-intro') ieltsSectionIntro(v, run, 'Reading', '📖', '3 passages · 40 questions · 60 minutes. The clock starts when you begin — answer every question, there is no negative marking.', 'reading', 60 * 60);
    else if (run.stage === 'reading') ieltsRenderReading(v, run, data);
    else if (run.stage === 'w-intro') ieltsSectionIntro(v, run, 'Writing', '✍️', '2 tasks · 60 minutes for both. Task 1: describe the chart (150+ words, about 20 min). Task 2: essay (250+ words, about 40 min) — Task 2 counts more.', 'writing', 60 * 60);
    else if (run.stage === 'writing') ieltsRenderWriting(v, run, data);
    else if (run.stage === 's-intro') ieltsSectionIntro(v, run, 'Speaking', '🎤', '3 parts · about 14 minutes. Part 1: questions about you. Part 2: 1 minute to prepare, then talk for up to 2 minutes. Part 3: a discussion. Allow microphone access when asked.', 'speaking', 0);
    else if (run.stage === 'speaking') ieltsRenderSpeaking(v, run, data);
  }).catch(function () {
    v.innerHTML = '<div class="ix-wrap"><div class="empty">Could not load the test data. Check your connection and reload.</div></div>';
  });
}

function ieltsSectionIntro(v, run, name, icon, text, nextStage, secs) {
  v.innerHTML = '<div class="ix-wrap">' + ieltsHeadHTML(run, name, '', null) +
    '<div class="ix-card ix-center"><div class="gt-mascot">' + icon + '</div>' +
    '<h3>Next: ' + name + '</h3><p>' + esc(text) + '</p>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ix-begin">BEGIN ' + name.toUpperCase() + '</button></div></div>';
  document.getElementById('ix-begin').addEventListener('click', function () {
    run.stage = nextStage;
    if (secs > 0) run.endsAt = Date.now() + secs * 1000;
    ieltsSaveRun(run);
    ieltsRenderStage(v, run);
  });
  window.scrollTo(0, 0);
}

/* ---------- objective questions (Listening + Reading) ---------- */

function ieltsQuestionHTML(q, ans, prefix) {
  var num = q.id.replace(/\D/g, '');
  if (q.type === 'gap') {
    var parts = q.q.split('___');
    return '<div class="ix-q"><div class="ix-q-text"><b>' + num + '.</b> ' + esc(parts[0]) +
      '<input class="ix-gap" data-ixq="' + q.id + '" type="text" autocomplete="off" spellcheck="false" value="' + esc(ans || '') + '">' +
      esc(parts[1] || '') + '</div></div>';
  }
  var label = q.type === 'tfng' ? 'True / False / Not Given' : (q.type === 'heading' ? 'Choose the correct heading' : '');
  var opts = (q.options || []).map(function (o, i) {
    return '<button type="button" class="ix-opt' + (ans === i ? ' sel' : '') + '" data-ixq="' + q.id + '" data-ixv="' + i + '">' +
      '<span class="ix-opt-l">' + 'ABCDEFGH'.charAt(i) + '</span>' + esc(o) + '</button>';
  }).join('');
  return '<div class="ix-q"><div class="ix-q-text"><b>' + num + '.</b> ' + esc(q.q) + '</div>' +
    (label ? '<div class="ix-q-label">' + label + '</div>' : '') + '<div class="ix-opts">' + opts + '</div></div>';
}

function ieltsBindQuestions(v, run, ansMap) {
  Array.prototype.forEach.call(v.querySelectorAll('.ix-opt'), function (b) {
    b.addEventListener('click', function () {
      var qid = b.getAttribute('data-ixq');
      ansMap[qid] = parseInt(b.getAttribute('data-ixv'), 10);
      ieltsSaveRun(run);
      Array.prototype.forEach.call(b.parentElement.querySelectorAll('.ix-opt'), function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
    });
  });
  Array.prototype.forEach.call(v.querySelectorAll('.ix-gap'), function (inp) {
    inp.addEventListener('input', function () {
      ansMap[inp.getAttribute('data-ixq')] = inp.value;
      ieltsSaveRun(run);
    });
  });
}

function ieltsScoreObjective(questions, ansMap) {
  var raw = 0, missed = [], review = [];
  questions.forEach(function (q) {
    var ans = ansMap[q.id];
    var ok = q.type === 'gap' ? ieltsGapOk(q, ans) : (ans === q.answer);
    if (ok) raw++;
    var rec = { q: q, ok: ok, user: ieltsUserText(q, ans), correct: ieltsCorrectText(q) };
    review.push(rec);
    if (!ok) missed.push({ q: q.q, o: q.options || [], a: (q.type === 'gap' ? -1 : q.answer), p: (q.type === 'gap' ? -1 : (typeof ans === 'number' ? ans : -1)), acc: q.accept || null, ut: rec.user, ct: rec.correct });
  });
  return { raw: raw, missed: missed, review: review };
}

/* ---------- Listening ---------- */

function ieltsRenderListening(v, run, data) {
  run.stage = 'listening';
  var part = data.listening.parts[run.lPart];
  var firstQ = part.questions[0].id, lastQ = part.questions[part.questions.length - 1].id;
  v.innerHTML = '<div class="ix-wrap">' +
    ieltsHeadHTML(run, 'Listening — Part ' + part.part + ' of 4', '', null) +
    '<div class="ix-card"><h3>' + esc(part.title) + '</h3><p class="ix-sub">' + esc(part.setting) + '</p>' +
    '<p class="ix-note">Questions ' + firstQ.replace(/\D/g, '') + '–' + lastQ.replace(/\D/g, '') + '. ' +
    'Press play — in the real test you hear the recording <b>once</b>. Answer while you listen.</p>' +
    '<div class="ix-player"><button type="button" class="ix-play" id="ix-play">▶</button>' +
    '<div class="ix-prog"><div class="ix-prog-bar" id="ix-prog-bar"></div></div>' +
    '<span class="ix-ptime" id="ix-ptime">0:00</span></div>' +
    '<div class="ix-qs">' + part.questions.map(function (q) { return ieltsQuestionHTML(q, run.lAns[q.id], 'l'); }).join('') + '</div>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ix-next">' +
    (run.lPart < 3 ? 'FINISH PART ' + part.part + ' → PART ' + (part.part + 1) : 'FINISH LISTENING → READING') + '</button>' +
    '</div></div>';
  ieltsBindQuestions(v, run, run.lAns);

  var audio = new Audio('/' + part.audio);
  state.ielts = state.ielts || {};
  state.ielts.audio = audio;
  var played = false;
  var playBtn = document.getElementById('ix-play');
  var bar = document.getElementById('ix-prog-bar');
  var ptime = document.getElementById('ix-ptime');
  playBtn.addEventListener('click', function () {
    if (audio.ended) return;
    if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; played = true; }
    else { audio.pause(); playBtn.textContent = '▶'; }
  });
  audio.addEventListener('timeupdate', function () {
    if (audio.duration) bar.style.width = (audio.currentTime / audio.duration * 100) + '%';
    ptime.textContent = gtestFmt(Math.floor(audio.currentTime)) + (audio.duration ? ' / ' + gtestFmt(Math.floor(audio.duration)) : '');
  });
  audio.addEventListener('ended', function () {
    playBtn.textContent = '✓'; playBtn.disabled = true;
    ptime.textContent = 'Recording finished';
  });
  document.getElementById('ix-next').addEventListener('click', function () {
    try { audio.pause(); } catch (e) {}
    state.ielts.audio = null;
    if (run.lPart < 3) { run.lPart++; ieltsSaveRun(run); ieltsRenderListening(v, run, data); window.scrollTo(0, 0); }
    else { run.stage = 'r-intro'; ieltsSaveRun(run); ieltsRenderStage(v, run); }
  });
}

/* ---------- Reading ---------- */

function ieltsRenderReading(v, run, data) {
  var left = Math.max(0, Math.round((run.endsAt - Date.now()) / 1000));
  if (left <= 0 && run.endsAt) { ieltsFinishReading(v, run, data); return; }
  var tabs = data.reading.passages.map(function (p, i) {
    return '<button type="button" class="ix-tab' + (run.rPassage === i ? ' on' : '') + '" data-ixp="' + i + '">Passage ' + (i + 1) + '</button>';
  }).join('');
  var p = data.reading.passages[run.rPassage];
  var paras = p.paragraphs.map(function (pg) {
    return '<p><span class="ix-plab">' + esc(pg.label) + '</span> ' + esc(pg.text) + '</p>';
  }).join('');
  v.innerHTML = '<div class="ix-wrap">' +
    ieltsHeadHTML(run, 'Reading', 'Answer all 40 questions. Switch passages with the tabs — your answers are saved.', left) +
    '<div class="ix-tabs">' + tabs + '</div>' +
    '<div class="ix-read-grid"><div class="ix-card ix-passage"><h3>' + esc(p.title) + '</h3>' + paras + '</div>' +
    '<div class="ix-card"><h3>Questions ' + p.questions[0].id.replace(/\D/g, '') + '–' + p.questions[p.questions.length - 1].id.replace(/\D/g, '') + '</h3>' +
    '<div class="ix-qs">' + p.questions.map(function (q) { return ieltsQuestionHTML(q, run.rAns[q.id], 'r'); }).join('') + '</div></div></div>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ix-submit-r">FINISH READING → WRITING</button></div>';
  ieltsBindQuestions(v, run, run.rAns);
  Array.prototype.forEach.call(v.querySelectorAll('.ix-tab'), function (t) {
    t.addEventListener('click', function () {
      run.rPassage = parseInt(t.getAttribute('data-ixp'), 10);
      ieltsSaveRun(run);
      ieltsRenderReading(v, run, data);
    });
  });
  document.getElementById('ix-submit-r').addEventListener('click', function () { ieltsFinishReading(v, run, data); });
  ieltsStartTimer(run, function () { ieltsFinishReading(v, run, data); });
  window.scrollTo(0, 0);
}

function ieltsFinishReading(v, run, data) {
  ieltsStopTimer();
  run.stage = 'w-intro'; run.endsAt = 0;
  ieltsSaveRun(run);
  ieltsRenderStage(v, run);
}

/* ---------- Writing ---------- */

function ieltsChartSVG(chart) {
  var W = 660, H = 380, base = 320, top = 40, leftPad = 44, rightPad = 10;
  var max = 0;
  chart.series.forEach(function (s) { s.values.forEach(function (x) { if (x > max) max = x; }); });
  max = Math.ceil(max / 10) * 10;
  var plotW = W - leftPad - rightPad, plotH = base - top;
  var groupW = plotW / chart.categories.length, barW = Math.min(26, groupW / 3);
  var colors = ['#4A90D9', '#F26522'];
  var out = '<svg class="ix-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(chart.title) + '">';
  for (var g = 0; g <= 4; g++) {
    var yv = max * g / 4, yy = base - plotH * g / 4;
    out += '<line x1="' + leftPad + '" y1="' + yy + '" x2="' + (W - rightPad) + '" y2="' + yy + '" stroke="#E3E7F0" stroke-width="1"/>' +
      '<text x="' + (leftPad - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="12" fill="#667">' + yv + '</text>';
  }
  chart.categories.forEach(function (cat, ci) {
    var gx = leftPad + ci * groupW;
    chart.series.forEach(function (s, si) {
      var val = s.values[ci];
      var bh = plotH * val / max;
      var x = gx + groupW / 2 + (si - (chart.series.length - 1) / 2) * (barW + 3) - barW / 2;
      out += '<rect x="' + x + '" y="' + (base - bh) + '" width="' + barW + '" height="' + bh + '" rx="3" fill="' + colors[si % 2] + '"/>' +
        '<text x="' + (x + barW / 2) + '" y="' + (base - bh - 5) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#232B4D">' + val + '</text>';
    });
    out += '<text x="' + (gx + groupW / 2) + '" y="' + (base + 18) + '" text-anchor="middle" font-size="12" fill="#445">' + esc(cat) + '</text>';
  });
  out += '<text x="' + (leftPad + plotW / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="12" fill="#667">' + esc(chart.unit) + '</text>';
  out += '</svg><div class="ix-legend">' + chart.series.map(function (s, si) {
    return '<span><span class="ix-swatch" style="background:' + colors[si % 2] + '"></span>' + esc(s.name) + '</span>';
  }).join('') + '</div>';
  return out;
}

function ieltsRenderWriting(v, run, data) {
  var left = Math.max(0, Math.round((run.endsAt - Date.now()) / 1000));
  if (left <= 0 && run.endsAt) { ieltsFinishWriting(v, run, data); return; }
  var task = data.writing.tasks[run.wTask];
  var text = run.wTask === 0 ? run.w1 : run.w2;
  var tabs = data.writing.tasks.map(function (t, i) {
    return '<button type="button" class="ix-tab' + (run.wTask === i ? ' on' : '') + '" data-ixw="' + i + '">Task ' + (i + 1) + '</button>';
  }).join('');
  v.innerHTML = '<div class="ix-wrap">' +
    ieltsHeadHTML(run, 'Writing', '60 minutes for both tasks. Task 2 counts more than Task 1.', left) +
    '<div class="ix-tabs">' + tabs + '</div>' +
    '<div class="ix-card"><h3>Task ' + task.n + ' — write at least ' + task.minWords + ' words (about ' + task.suggestedMinutes + ' minutes)</h3>' +
    '<p class="ix-prompt">' + esc(task.prompt) + '</p>' +
    (task.chart ? '<h4>' + esc(task.chart.title) + '</h4>' + ieltsChartSVG(task.chart) : '') +
    '<textarea class="ix-editor" id="ix-editor" placeholder="Write your answer here…">' + esc(text) + '</textarea>' +
    '<div class="ix-wc"><span id="ix-wc">' + ieltsWc(text) + '</span> words · minimum ' + task.minWords + '</div>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ix-submit-w">FINISH WRITING → SPEAKING</button></div></div>';
  var ed = document.getElementById('ix-editor');
  ed.addEventListener('input', function () {
    if (run.wTask === 0) run.w1 = ed.value; else run.w2 = ed.value;
    document.getElementById('ix-wc').textContent = ieltsWc(ed.value);
    ieltsSaveRun(run);
  });
  Array.prototype.forEach.call(v.querySelectorAll('.ix-tab'), function (t) {
    t.addEventListener('click', function () {
      run.wTask = parseInt(t.getAttribute('data-ixw'), 10);
      ieltsSaveRun(run);
      ieltsRenderWriting(v, run, data);
    });
  });
  document.getElementById('ix-submit-w').addEventListener('click', function () { ieltsFinishWriting(v, run, data); });
  ieltsStartTimer(run, function () { ieltsFinishWriting(v, run, data); });
  window.scrollTo(0, 0);
}

function ieltsFinishWriting(v, run, data) {
  ieltsStopTimer();
  run.stage = 's-intro'; run.endsAt = 0;
  ieltsSaveRun(run);
  ieltsRenderStage(v, run);
}

function ieltsTextFeatures(text, minWords, needsOverview) {
  var words = ieltsWc(text);
  var paras = (text || '').split(/\n\s*\n/).filter(function (p) { return p.trim().length > 20; }).length;
  if (!paras && words) paras = 1;
  var lower = ' ' + (text || '').toLowerCase() + ' ';
  var linkers = IELTS_LINKERS.filter(function (l) { return lower.indexOf(' ' + l) !== -1 || lower.indexOf('\n' + l) !== -1; });
  var toks = (text || '').toLowerCase().match(/[a-z']+/g) || [];
  var uniq = {};
  toks.forEach(function (t) { uniq[t] = 1; });
  var ratio = toks.length ? Object.keys(uniq).length / toks.length : 0;
  var sents = (text || '').split(/[.!?]+/).filter(function (s) { return s.trim().length > 3; }).length;
  var avgSent = sents ? words / sents : 0;
  return { words: words, paras: paras, linkers: linkers, ratio: ratio, sents: sents, avgSent: avgSent, minOk: words >= minWords, hasOverview: lower.indexOf('overall') !== -1 };
}

function ieltsWritingEstimate(run, data) {
  var t1 = ieltsTextFeatures(run.w1, data.writing.tasks[0].minWords, true);
  var t2 = ieltsTextFeatures(run.w2, data.writing.tasks[1].minWords, false);
  function taskScore(f, isT1) {
    var s = 4.0, notes = [];
    if (f.minOk) { s += 0.75; notes.push('✓ Long enough (' + f.words + ' words)'); }
    else notes.push('✗ Too short: ' + f.words + ' words (minimum not reached)');
    if (isT1) {
      if (f.hasOverview) { s += 0.75; notes.push('✓ Has an overview'); } else notes.push('✗ No overview sentence ("Overall, …") — essential in Task 1');
      if (f.paras >= 3) { s += 0.5; notes.push('✓ ' + f.paras + ' paragraphs'); } else notes.push('✗ Needs clearer paragraphs (aim for 4)');
    } else {
      if (f.paras >= 4) { s += 0.75; notes.push('✓ ' + f.paras + ' paragraphs'); } else notes.push('✗ Aim for 4–5 paragraphs (intro, 2–3 body, conclusion)');
    }
    if (f.linkers.length >= 8) { s += 1.0; notes.push('✓ Wide range of linking words (' + f.linkers.length + ')'); }
    else if (f.linkers.length >= 5) { s += 0.7; notes.push('◐ Some linking words (' + f.linkers.length + ') — add more variety'); }
    else if (f.linkers.length >= 2) { s += 0.4; notes.push('◐ Few linking words (' + f.linkers.length + ')'); }
    else notes.push('✗ Almost no linking words — ideas will feel disconnected');
    if (f.ratio >= 0.55) { s += 0.75; notes.push('✓ Rich vocabulary range'); }
    else if (f.ratio >= 0.45) { s += 0.5; notes.push('◐ Reasonable vocabulary range'); }
    else if (f.words > 30) notes.push('◐ Vocabulary repeats a lot — vary your word choice');
    if (f.avgSent >= 10 && f.avgSent <= 24) { s += 0.5; notes.push('✓ Healthy sentence length (avg ' + Math.round(f.avgSent) + ' words)'); }
    else if (f.words > 30) notes.push('◐ Sentence length average is ' + Math.round(f.avgSent) + ' words — mix short and long sentences');
    return { score: Math.min(8.5, Math.max(3.5, Math.round(s * 2) / 2)), notes: notes, f: f };
  }
  var a = taskScore(t1, true), b = taskScore(t2, false);
  /* IELTS weights Task 2 at roughly two-thirds of the Writing score. */
  var band = ieltsRoundOverall((a.score + 2 * b.score) / 3);
  return { band: band, t1: a, t2: b };
}

/* ---------- Speaking (recorded → teacher-scored) ---------- */
/* Alireza's order 2026-11-04: speaking answers are RECORDED in the app and
   sent to the student's own teacher, who listens and awards the band.
   AI never scores the Speaking section. */

function ieltsSpKey(run) { return run.spStep === 0 ? 'p1' : (run.spStep === 1 ? 'p2' : 'p3'); }

function ieltsRenderSpeaking(v, run, data) {
  var sp = data.speaking;
  var key = ieltsSpKey(run);
  var top = '', nextLabel = '';
  if (key === 'p1') {
    top = '<h3>Part 1 — Introduction and interview</h3>' +
      '<p class="ix-sub">Press <b>Start recording</b> once, then answer ALL the questions below in order, like a real interview (2–4 sentences each). Press stop when you finish the part.</p>' +
      sp.part1.topics.map(function (t) {
        return '<h4 class="ix-topic">' + esc(t.topic) + '</h4>' + t.questions.map(function (q) {
          return '<div class="ix-q"><div class="ix-q-text">' + esc(q) + '</div></div>';
        }).join('');
      }).join('');
    nextLabel = 'CONTINUE → PART 2';
  } else if (key === 'p2') {
    top = '<h3>Part 2 — Long turn</h3>' +
      '<div class="ix-cue"><b>' + esc(sp.part2.cueCard) + '</b><ul>' +
      sp.part2.points.map(function (pt) { return '<li>' + esc(pt) + '</li>'; }).join('') + '</ul></div>' +
      '<p class="ix-sub">First take <b>1 minute</b> to prepare (write notes below). Then press record and talk for <b>up to 2 minutes</b> — the recording stops by itself.</p>' +
      '<div class="ix-sp-row"><button type="button" class="gt-btn" id="ix-p2-prep">START 1-MINUTE PREPARATION</button>' +
      '<span class="ix-timer ix-timer-sm" id="ix-p2-preptimer"></span></div>' +
      '<textarea class="ix-sp-text" id="ix-p2-notes" placeholder="Your notes (not scored)…"></textarea>';
    nextLabel = 'CONTINUE → PART 3';
  } else {
    top = '<h3>Part 3 — Discussion: ' + esc(sp.part3.theme) + '</h3>' +
      '<p class="ix-sub">Press <b>Start recording</b> once, then answer ALL the questions below in order. Give longer answers — develop your ideas and give examples.</p>' +
      sp.part3.questions.map(function (q) {
        return '<div class="ix-q"><div class="ix-q-text">' + esc(q) + '</div></div>';
      }).join('');
    nextLabel = 'FINISH THE MOCK TEST → SEND TO MY TEACHER';
  }
  var recorded = run.spRecorded && run.spRecorded[key];
  v.innerHTML = '<div class="ix-wrap">' + ieltsHeadHTML(run, 'Speaking', '', null) +
    '<div class="ix-card">' + top +
    '<div class="ix-recpanel"><button type="button" class="ix-rec" id="ix-recbtn">🎤 ' + (recorded ? 'Record again — Part ' + (run.spStep + 1) : 'Start recording — Part ' + (run.spStep + 1)) + '</button>' +
    '<span class="ix-timer ix-timer-sm" id="ix-rectimer"></span>' +
    '<span class="ix-sp-state" id="ix-recstate">' + (recorded ? '✓ Recording saved — it will be sent to your teacher' : '') + '</span></div>' +
    '<p class="ix-note">Your voice is recorded and sent to <b>your teacher</b>, who listens and gives your Speaking band. ' +
    'Keep this page open while you speak. The live transcript below is only a guide for your teacher — the recording is what matters.</p>' +
    '<textarea class="ix-sp-text" id="ix-sptext" placeholder="Live transcript appears here…">' + esc(run.spText[key] || '') + '</textarea>' +
    '<button class="gt-btn gt-btn-green gt-btn-big" id="ix-sp-next">' + nextLabel + '</button></div></div>';
  ieltsBindSpeaking(v, run, data, key);
  window.scrollTo(0, 0);
}

function ieltsBindSpeaking(v, run, data, key) {
  state.ielts = state.ielts || {};
  state.ielts.blobs = state.ielts.blobs || {};
  var maxSecs = key === 'p2' ? (data.speaking.part2.talkSeconds || 120) : 6 * 60;
  var ta = document.getElementById('ix-sptext');
  ta.addEventListener('input', function () { run.spText[key] = ta.value; ieltsSaveRun(run); });

  var prepBtn = document.getElementById('ix-p2-prep');
  if (prepBtn) prepBtn.addEventListener('click', function () {
    prepBtn.disabled = true;
    var left = data.speaking.part2.prepSeconds || 60;
    var label = document.getElementById('ix-p2-preptimer');
    label.textContent = 'Preparing… ' + gtestFmt(left);
    var iv = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(iv); label.textContent = 'Preparation over — start recording!'; }
      else label.textContent = 'Preparing… ' + gtestFmt(left);
    }, 1000);
  });

  var btn = document.getElementById('ix-recbtn');
  var timerEl = document.getElementById('ix-rectimer');
  var stateEl = document.getElementById('ix-recstate');
  var recording = false;

  function stopRec() {
    if (!recording) return;
    recording = false;
    if (state.ielts.recIv) { clearInterval(state.ielts.recIv); state.ielts.recIv = null; }
    if (state.ielts.rec) { try { state.ielts.rec.stop(); } catch (e) {} state.ielts.rec = null; }
    if (state.ielts.mr && state.ielts.mr.state !== 'inactive') { try { state.ielts.mr.stop(); } catch (e) {} }
    btn.textContent = '🎤 Record again — Part ' + (run.spStep + 1);
    btn.classList.remove('recording');
  }

  btn.addEventListener('click', function () {
    if (recording) { stopRec(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Audio recording is not available in this browser. You can still type your answers — but your teacher needs a recording, so please use Chrome or Safari on your phone/computer for the Speaking part.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      state.ielts.stream = stream;
      var chunks = [];
      var mr;
      try { mr = new MediaRecorder(stream); } catch (e) { alert('Could not start the recorder. Please try again.'); return; }
      state.ielts.mr = mr;
      mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = function () {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        state.ielts.mr = null;
        if (chunks.length) {
          state.ielts.blobs[key] = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          run.spRecorded = run.spRecorded || {};
          run.spRecorded[key] = true;
          run.spText[key] = ta.value;
          ieltsSaveRun(run);
          stateEl.textContent = '✓ Recording saved — it will be sent to your teacher';
        }
      };
      try { mr.start(250); } catch (e) { return; }
      recording = true;
      btn.textContent = '⏹ Stop recording';
      btn.classList.add('recording');
      stateEl.textContent = 'Recording… answer all the questions in order.';
      /* Parallel live transcript (guide only, never scored). */
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        try {
          var r = new SR();
          state.ielts.rec = r;
          r.lang = 'en-US'; r.interimResults = true; r.continuous = true;
          var finalT = ta.value ? ta.value + ' ' : '';
          r.onresult = function (ev) {
            var interim = '';
            for (var k = ev.resultIndex; k < ev.results.length; k++) {
              if (ev.results[k].isFinal) finalT += ev.results[k][0].transcript + ' ';
              else interim += ev.results[k][0].transcript;
            }
            ta.value = (finalT + interim).trim();
            run.spText[key] = ta.value;
          };
          r.onend = function () { if (recording && state.ielts.rec === r) { try { r.start(); } catch (e) {} } };
          r.onerror = function () {};
          r.start();
        } catch (e) {}
      }
      var startedAt = Date.now();
      state.ielts.recIv = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        timerEl.textContent = gtestFmt(s) + ' / ' + gtestFmt(maxSecs);
        if (key === 'p2') run.spP2Secs = s;
        if (s >= maxSecs) stopRec();
      }, 250);
    }).catch(function () {
      alert('Microphone blocked — allow microphone access to record your speaking for your teacher.');
    });
  });

  document.getElementById('ix-sp-next').addEventListener('click', function () {
    if (recording) stopRec();
    run.spText[key] = ta.value;
    ieltsSaveRun(run);
    if (run.spStep < 2) { run.spStep++; ieltsSaveRun(run); ieltsRenderSpeaking(v, run, data); }
    else ieltsFinishMock(v, run, data);
  });
}


/* ---------- Finish + results ---------- */

async function ieltsFlushPending() {
  if (!sb || !cloudReady() || !state.user || state.user.demo) return;
  var pend = lsGet('ieltsPending');
  if (!Array.isArray(pend) || !pend.length) return;
  var left = [];
  for (var i = 0; i < pend.length; i++) {
    try {
      var res = await sb.from('ielts_submissions').insert(pend[i]);
      if (res.error) left.push(pend[i]);
    } catch (e) { left.push(pend[i]); }
  }
  lsSet('ieltsPending', left);
  if (left.length !== pend.length) {
    var arch = lsGet('ieltsResults');
    if (Array.isArray(arch)) {
      arch.forEach(function (r) {
        if (r.submission && r.submission.status === 'queued' &&
          !left.some(function (pl) { return pl.client_ts === r.submission.clientTs; })) r.submission.status = 'sent';
      });
      lsSet('ieltsResults', arch);
    }
  }
}

async function ieltsSyncSpeaking(res) {
  if (!res || !res.submission || res.bands.s !== null) return false;
  if (!sb || !cloudReady() || !state.user || state.user.demo) return false;
  try {
    var q = await sb.from('ielts_submissions').select('status, band, feedback')
      .eq('user_id', state.user.id).eq('client_ts', res.submission.clientTs).limit(1);
    if (q.error || !q.data || !q.data.length) return false;
    var row = q.data[0];
    res.submission.status = row.status;
    if (row.status === 'scored' && row.band !== null && row.band !== undefined) {
      res.bands.s = Number(row.band);
      res.submission.band = Number(row.band);
      res.submission.feedback = row.feedback || '';
      res.overall = ieltsRoundOverall((res.bands.l + res.bands.r + res.bands.w + res.bands.s) / 4);
      res.provisional = false;
    }
    var arch = lsGet('ieltsResults');
    if (Array.isArray(arch)) {
      for (var i = 0; i < arch.length; i++) {
        if (arch[i].submission && arch[i].submission.clientTs === res.submission.clientTs) arch[i] = res;
      }
      lsSet('ieltsResults', arch);
    }
    return true;
  } catch (e) { return false; }
}

async function ieltsFinishMock(v, run, data) {
  ieltsStopMedia();
  var lQs = [];
  data.listening.parts.forEach(function (p) { lQs = lQs.concat(p.questions); });
  var rQs = [];
  data.reading.passages.forEach(function (p) { rQs = rQs.concat(p.questions); });
  var L = ieltsScoreObjective(lQs, run.lAns);
  var R = ieltsScoreObjective(rQs, run.rAns);
  var W = ieltsWritingEstimate(run, data);
  var bands = { l: ieltsBandFor(IELTS_L_BANDS, L.raw), r: ieltsBandFor(IELTS_R_BANDS, R.raw), w: W.band, s: null };

  /* Speaking: upload the recordings and create the teacher submission.
     No AI band is ever computed for speaking (Alireza's order 2026-11-04). */
  var clientTs = Date.now();
  var subStatus = 'local';
  var blobs = (state.ielts && state.ielts.blobs) || {};
  var hasBlobs = ['p1', 'p2', 'p3'].some(function (k) { return !!blobs[k]; });
  if (sb && cloudReady() && state.user && !state.user.demo && state.user.id) {
    v.innerHTML = '<div class="ix-wrap"><div class="ix-card ix-center"><div class="gt-mascot">🎤</div>' +
      '<h3>Sending your speaking to your teacher…</h3><p class="ix-note">Uploading your recordings — please do not close the app.</p></div></div>';
    var audioUrls = {};
    try {
      for (var ki = 0; ki < 3; ki++) {
        var key = ['p1', 'p2', 'p3'][ki];
        if (!blobs[key]) continue;
        var ext = (blobs[key].type.indexOf('mp4') !== -1) ? 'mp4' : (blobs[key].type.indexOf('ogg') !== -1 ? 'ogg' : 'webm');
        var path = 'ielts-speaking/' + state.user.id + '/' + clientTs + '/' + key + '.' + ext;
        var up = await sb.storage.from('teacher-photos').upload(path, blobs[key], { contentType: blobs[key].type || 'audio/webm', upsert: true });
        if (!up.error) audioUrls[key] = sb.storage.from('teacher-photos').getPublicUrl(path).data.publicUrl;
      }
    } catch (e) {}
    var teacherRef = null;
    try {
      var prof = await sb.from('profiles').select('referred_by').eq('id', state.user.id).single();
      if (prof.data) teacherRef = prof.data.referred_by || null;
    } catch (e) {}
    var payload = {
      user_id: state.user.id, teacher_ref: teacherRef, mock_id: 'academic-mock-1',
      client_ts: clientTs, audio: audioUrls,
      transcripts: { p1: run.spText.p1 || '', p2: run.spText.p2 || '', p3: run.spText.p3 || '' },
      status: 'pending'
    };
    try {
      var ins = await sb.from('ielts_submissions').insert(payload);
      if (ins.error) throw new Error('insert failed');
      subStatus = 'sent';
    } catch (e) {
      var pend = lsGet('ieltsPending');
      if (!Array.isArray(pend)) pend = [];
      pend.push(payload);
      lsSet('ieltsPending', pend.slice(0, 6));
      subStatus = 'queued';
    }
    if (!hasBlobs) subStatus = 'sent-text';
  }

  var res = {
    ts: clientTs, date: todayStr(),
    overall: ieltsRoundOverall((bands.l + bands.r + bands.w) / 3), provisional: true,
    bands: bands, lRaw: L.raw, rRaw: R.raw, lReview: L.review, rReview: R.review,
    wEst: { band: W.band, t1: { score: W.t1.score, notes: W.t1.notes, words: W.t1.f.words }, t2: { score: W.t2.score, notes: W.t2.notes, words: W.t2.f.words }, text1: run.w1, text2: run.w2 },
    submission: { clientTs: clientTs, status: subStatus, band: null, feedback: null },
    spText: { p1: run.spText.p1 || '', p2: run.spText.p2 || '', p3: run.spText.p3 || '' }
  };
  var arch = lsGet('ieltsResults');
  if (!Array.isArray(arch)) arch = [];
  arch.unshift(res);
  lsSet('ieltsResults', arch.slice(0, 12));
  var missed = L.missed.concat(R.missed).slice(0, 30);
  saveAttempt({ kind: 'ielts', theme: 'academic-mock-1', level: (state.user && state.user.level) || null, date: res.date, score: L.raw + R.raw, total: 80, missed: missed });
  run.done = true; run.stage = 'done';
  ieltsSaveRun(run);
  if (state.ielts) state.ielts.blobs = {};
  ieltsRenderResults(v, res);
}

function ieltsReviewHTML(review, title) {
  var rows = review.map(function (rec) {
    var num = rec.q.id.replace(/\D/g, '');
    return '<div class="ix-rev' + (rec.ok ? ' ok' : ' bad') + '"><div class="ix-rev-q"><b>' + num + '.</b> ' + esc(rec.q.q) + '</div>' +
      '<div class="ix-rev-a">' + (rec.ok ? '✓ ' + esc(rec.correct) : '✗ You: ' + esc(rec.user) + ' · ✓ Correct: ' + esc(rec.correct)) + '</div></div>';
  }).join('');
  return '<details class="ix-det"><summary>' + esc(title) + ' (' + review.filter(function (r) { return r.ok; }).length + '/' + review.length + ' correct)</summary>' + rows + '</details>';
}

function ieltsRenderResults(v, res) {
  if (!res) {
    var arch = lsGet('ieltsResults');
    if (arch && arch.length) res = arch[0];
  }
  if (!res) {
    v.innerHTML = '<div class="ix-wrap"><div class="empty">No mock test results yet. <a href="#/ielts">Take the mock test →</a></div></div>';
    return;
  }
  ieltsFlushPending();
  loadIeltsData().then(function (data) {
    ieltsPaintResults(v, res, data);
    ieltsSyncSpeaking(res).then(function (changed) { if (changed) ieltsPaintResults(v, res, data); });
  }).catch(function () {
    ieltsPaintResults(v, res, null);
    ieltsSyncSpeaking(res).then(function (changed) { if (changed) ieltsPaintResults(v, res, null); });
  });
}

function ieltsPaintResults(v, res, data) {
  var b = res.bands;
  var bandCard = function (icon, name, band, sub) {
    return '<div class="ix-band"><div class="ix-band-ic">' + icon + '</div><div class="ix-band-n">' + name + '</div>' +
      '<div class="ix-band-v">' + (band === null || band === undefined ? '⏳' : ieltsBandTxt(band)) + '</div><div class="ix-band-s">' + sub + '</div></div>';
  };
  var notesList = function (notes) { return '<ul class="ix-notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'; };
  var sub = res.submission || { status: 'local' };
  var spStatusHTML;
  if (b.s !== null && b.s !== undefined) {
    spStatusHTML = '<p>Your teacher scored your speaking: <b>Band ' + ieltsBandTxt(b.s) + '</b></p>' +
      (sub.feedback ? '<div class="ix-wtext"><b>Teacher feedback:</b>\n' + esc(sub.feedback) + '</div>' : '');
  } else if (sub.status === 'sent' || sub.status === 'sent-text') {
    spStatusHTML = '<p>⏳ <b>With your teacher.</b> Your recordings were sent — your teacher will listen and award your Speaking band. ' +
      'This page updates automatically when the score arrives.</p>';
  } else if (sub.status === 'queued') {
    spStatusHTML = '<p>⏳ <b>Waiting to send.</b> Your recordings are saved and will be sent to your teacher automatically — check back soon.</p>';
  } else {
    spStatusHTML = '<p>⏳ Your speaking was not sent (demo/offline mode) — the transcript below is saved on this device only.</p>';
  }
  v.innerHTML = '<div class="ix-wrap"><div class="ix-intro">' +
    '<div class="gt-mascot">🎓</div><h1>Your IELTS Mock Results</h1>' +
    '<p class="gt-sub">' + esc(res.date) + ' · Academic Mock Test 1</p>' +
    '<div class="ix-overall"><span>Overall Band' + (res.provisional ? ' (provisional)' : '') + '</span><b>' + ieltsBandTxt(res.overall) + '</b></div>' +
    '<div class="ix-bands">' +
    bandCard('🎧', 'Listening', b.l, res.lRaw + '/40 correct') +
    bandCard('📖', 'Reading', b.r, res.rRaw + '/40 correct') +
    bandCard('✍️', 'Writing', b.w, 'estimate*') +
    bandCard('🎤', 'Speaking', b.s, (b.s === null || b.s === undefined) ? 'with your teacher' : 'teacher score') +
    '</div>' +
    (res.provisional ? '<p class="ix-note">The provisional overall is the average of Listening, Reading and Writing. ' +
      'Your <b>final</b> overall band is calculated when your teacher scores your Speaking.</p>' : '') +
    '<p class="ix-note">* The Writing band is an estimate from measurable features of your texts ' +
    '(length, structure, linking, vocabulary range). In the real test a human examiner marks it — ' +
    'use the model answers and notes below to judge your level honestly.</p></div>' +
    '<div class="ix-card"><h3>🎧 Listening review</h3>' + ieltsReviewHTML(res.lReview, 'Listening answers') +
    '<h3>📖 Reading review</h3>' + ieltsReviewHTML(res.rReview, 'Reading answers') + '</div>' +
    '<div class="ix-card"><h3>✍️ Writing — estimate Band ' + ieltsBandTxt(res.wEst.band) + '</h3>' +
    '<h4>Task 1 (estimate ' + ieltsBandTxt(res.wEst.t1.score) + ' · ' + res.wEst.t1.words + ' words)</h4>' + notesList(res.wEst.t1.notes) +
    '<details class="ix-det"><summary>Your Task 1 text</summary><div class="ix-wtext">' + esc(res.wEst.text1 || '(nothing written)') + '</div></details>' +
    (data ? '<details class="ix-det"><summary>Band 9 model answer — Task 1</summary><div class="ix-wtext">' + esc(data.writing.tasks[0].modelAnswer) + '</div>' + notesList(data.writing.tasks[0].bandNotes || []) + '</details>' : '') +
    '<h4>Task 2 (estimate ' + ieltsBandTxt(res.wEst.t2.score) + ' · ' + res.wEst.t2.words + ' words)</h4>' + notesList(res.wEst.t2.notes) +
    '<details class="ix-det"><summary>Your Task 2 text</summary><div class="ix-wtext">' + esc(res.wEst.text2 || '(nothing written)') + '</div></details>' +
    (data ? '<details class="ix-det"><summary>Band 9 model answer — Task 2</summary><div class="ix-wtext">' + esc(data.writing.tasks[1].modelAnswer) + '</div>' + notesList(data.writing.tasks[1].bandNotes || []) + '</details>' : '') +
    '</div>' +
    '<div class="ix-card"><h3>🎤 Speaking — teacher-scored</h3>' + spStatusHTML +
    '<details class="ix-det"><summary>Part 1 transcript</summary><div class="ix-wtext">' + esc(res.spText.p1 || '(nothing recorded)') + '</div></details>' +
    '<details class="ix-det"><summary>Part 2 transcript</summary><div class="ix-wtext">' + esc(res.spText.p2 || '(nothing recorded)') + '</div></details>' +
    '<details class="ix-det"><summary>Part 3 transcript</summary><div class="ix-wtext">' + esc(res.spText.p3 || '(nothing recorded)') + '</div></details></div>' +
    '<div class="ix-center"><button class="gt-btn gt-btn-green gt-btn-big" id="ix-retake">↻ TAKE THE MOCK AGAIN</button> ' +
    '<a class="gt-btn" href="#/home">Back to home</a></div></div>';
  var rt = document.getElementById('ix-retake');
  if (rt) rt.addEventListener('click', function () {
    lsSet('ieltsRun', {});
    state.ielts = {};
    ieltsIntro(v);
  });
  window.scrollTo(0, 0);
}


