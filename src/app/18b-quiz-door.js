/* ---------------- quiz door + end-of-words nudge + quiz tracking ----------------
   Claude, 2026-11-25, Alireza's order. The funnel's biggest leak: learners
   scroll to the last word (words_viewed) but never take the quiz (108 of 187
   new learners in 30 days). The old door was an English image button parked
   under the "Pronunciation — all words" card, below the fold when the last
   word was on screen.
   - quizDoorHTML(m): a big text button right after the last word (Persian for
     fa learners), with the real question count and time. Keeps the class
     .start-quiz-cta because the tour (12-onboarding.js) points at it.
   - qzNudgeWatch(body, m): when the last word card comes into view and the
     quiz isn't done, a bottom sheet says "now the quiz, ~N min" once per
     lesson per page load.
   - Tracking (app_events; no DB change):
       quiz_start {kind, date, level, total, resumed, at, from}
       quiz_exit  {kind, date, how: quit|nav|hidden, at, answered, correct, total, hearts, secs}
       quiz_nudge {action: shown|go|later, date}
     quiz_completed (19-quiz.js) now also carries secs.
     Only lesson quizzes (word, grammar) are tracked. */

var _qzSess = null;          /* the running lesson quiz: {kind, date, t0, done, ended, hid} */
var _qzNudged = {};          /* lesson dates already nudged in this page load */
var _qzObs = null;

function qzFa() { try { return uiLang() === 'fa'; } catch (e) { return false; } }
function qzNum(n) { return qzFa() ? faNum(n) : String(n); }

/* How many questions buildDuoDeck() (19-quiz.js) will make for this lesson:
   the lesson's own questions + up to 3 Persian->English + up to 2 listening
   + up to 2 sentence-building, capped at 14. Keep in step with buildDuoDeck. */
function qzDeckSize(m) {
  var words = (m.words || []).filter(function (w) { return w && w.word; });
  var ex = words.filter(function (w) {
    if (!w.example) return false;
    var k = w.example.replace(/["“”']/g, '').trim().split(/\s+/).length;
    return k >= 4 && k <= 12;
  }).length;
  var n = (m.quiz || []).length +
    Math.min(3, words.filter(function (w) { return w.persian; }).length) +
    Math.min(2, words.filter(function (w) { return w.word_audio; }).length) +
    Math.min(2, ex);
  return Math.min(14, n);
}
/* About 10 seconds a question (sentence building is slower, plain choices faster). */
function qzMinutes(n) { return Math.max(1, Math.round(n * 10 / 60)); }
function qzSizeText(m) {
  var n = qzDeckSize(m), t = qzMinutes(n);
  /* Time only, no question count (Alireza 2026-11-25: "14 questions" sounds like a lot). */
  return qzFa() ? ('حدود ' + qzNum(t) + ' دقیقه') : ('about ' + t + ' min');
}
function qzQuizDone(m) { try { return !!((getDayProgress(m.date) || {}).quiz); } catch (e) { return false; } }

function quizDoorHTML(m) {
  if (!(m && m.words && m.words.length && (m.quiz || []).length)) return '';
  var fa = qzFa(), done = qzQuizDone(m);
  var main = done ? (fa ? 'دوباره آزمون بده' : 'Take the quiz again') : (fa ? 'شروع آزمون' : 'Start the quiz');
  var sub = done ? (fa ? '✅ آزمون این درس رو دادی' : '✅ You’ve done this quiz') : qzSizeText(m);
  var streak = (!done && m.date === todayStr())
    ? '<p class="qz-door-note">' + (fa ? 'با تموم کردن آزمون، امروز توی روزهای پیاپیت ثبت میشه 🔥' : 'Finish it and today counts toward your streak 🔥') + '</p>'
    : '';
  return '<div class="qz-door' + (done ? ' is-done' : '') + '" data-fa-skip' + (fa ? ' dir="rtl" lang="fa"' : '') + '>' +
    '<button class="qz-door-btn start-quiz-cta" data-action="quiz-start" data-kind="word" data-from="words_end">' +
      '<img class="qz-door-ico" src="/media/ask-muse/atish-face.webp" alt="" width="56" height="56">' +
      '<span class="qz-door-txt"><b>' + main + '</b><small>' + sub + '</small></span>' +
      '<span class="qz-door-go" aria-hidden="true">›</span>' + /* bidi-mirrored: shows as ‹ in Persian */
    '</button>' + streak + '</div>';
}

/* ---- end-of-words nudge ---- */
/* needLeave: the last card must first leave the screen and come back. Used after the
   pop-up was blocked by the first-lesson tour (its quiz step scrolls the page to the
   quiz button by itself) or by another pop-up: the learner gets the nudge the next
   time THEY scroll to the end, not stacked right after the tour. Fix 2026-11-25. */
function qzNudgeWatch(body, m, needLeave) {
  try {
    if (_qzObs) { try { _qzObs.disconnect(); } catch (e) {} _qzObs = null; }
    if (!m || !m.date || !(m.quiz || []).length || typeof IntersectionObserver === 'undefined') return;
    if (_qzNudged[m.date] || qzQuizDone(m)) return;
    var cards = body.querySelectorAll('.word-card');
    if (!cards.length) return;
    var armed = !needLeave;
    var obs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) { armed = true; continue; }
        if (!armed) continue;
        try { obs.disconnect(); } catch (e) {}
        if (_qzObs === obs) _qzObs = null;
        setTimeout(function () {
          if (qzNudgeShow(m) === 'blocked' && body.isConnected) qzNudgeWatch(body, m, true);
        }, 900);
        break;
      }
    }, { threshold: 0.6 });
    _qzObs = obs;
    obs.observe(cards[cards.length - 1]);
  } catch (e) {}
}

/* Returns 'blocked' when only a tour / pop-up stood in the way (the watcher re-arms). */
function qzNudgeShow(m) {
  if (_qzNudged[m.date]) return;
  if (state.view !== 'lesson' || state.lessonTab !== 'words' || state.quiz) return;
  if (!state.lesson || state.lesson.date !== m.date || qzQuizDone(m)) return;
  if (document.getElementById('qz-nudge')) return;
  if (document.getElementById('app-modal') || document.getElementById('tut-ov')) return 'blocked';
  _qzNudged[m.date] = 1;
  var fa = qzFa();
  var n = qzDeckSize(m), t = qzMinutes(n);
  var el = document.createElement('div');
  el.id = 'qz-nudge';
  el.className = 'qz-nudge';
  el.setAttribute('data-fa-skip', '');
  el.innerHTML =
    '<div class="qz-nudge-back" data-qn="later"></div>' +
    '<div class="qz-nudge-card" role="dialog" aria-modal="true" aria-labelledby="qz-nudge-t"' + (fa ? ' dir="rtl" lang="fa"' : '') + '>' +
      '<img class="qz-nudge-ico" src="/media/ask-muse/atish-face.webp" alt="" width="72" height="72">' +
      '<h3 id="qz-nudge-t">' + (fa ? 'آفرین! همهٔ لغت‌ها رو دیدی 👏' : 'Nice! You’ve seen all the words 👏') + '</h3>' +
      '<p>' + (fa
        ? 'حالا نوبت آزمونه، <b>فقط حدود ' + qzNum(t) + ' دقیقه</b>. الان که لغت‌ها یادته، بهترین وقتشه.'
        : 'Now the quiz, <b>just about ' + t + ' min</b>. Best time is now, while the words are fresh.') + '</p>' +
      (m.date === todayStr()
        ? '<p class="qz-nudge-streak">' + (fa ? 'با تموم کردنش، امروز توی روزهای پیاپیت ثبت میشه 🔥' : 'Finish it and today counts toward your streak 🔥') + '</p>'
        : '') +
      '<button class="qz-nudge-go" data-qn="go">' + (fa ? 'شروع آزمون' : 'Start the quiz') + '</button>' +
      '<button class="qz-nudge-later" data-qn="later">' + (fa ? 'بعداً' : 'Later') + '</button>' +
    '</div>';
  document.body.appendChild(el);
  requestAnimationFrame(function () { el.classList.add('on'); });
  var go = el.querySelector('.qz-nudge-go');
  try { go.focus({ preventScroll: true }); } catch (e) {}
  try { trackEvent('quiz_nudge', { action: 'shown', date: m.date }); } catch (e) {}
  var close = function (action) {
    document.removeEventListener('keydown', onKey);
    el.classList.remove('on');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    try { trackEvent('quiz_nudge', { action: action, date: m.date }); } catch (e) {}
    if (action === 'go') { state._quizFrom = 'nudge'; startQuiz('word', m.date); }
  };
  var onKey = function (e) { if (e.key === 'Escape') close('later'); };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', function (e) {
    var a = e.target.closest('[data-qn]');
    if (a) close(a.getAttribute('data-qn'));
  });
}
/* Leaving the lesson (or starting the quiz another way) drops a waiting nudge. */
function qzNudgeDrop() {
  var el = document.getElementById('qz-nudge');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ---- quiz tracking ---- */
function qzSecs() { return _qzSess ? Math.round((Date.now() - _qzSess.t0) / 1000) : null; }
function qzTrackStart(q, prog) {
  if (!q || (q.kind !== 'word' && q.kind !== 'grammar')) return;
  qzNudgeDrop();
  _qzSess = { kind: q.kind, date: q.date, t0: Date.now(), done: false, ended: false, hid: false };
  try {
    trackEvent('quiz_start', { kind: q.kind, date: q.date, level: q.level, total: q.questions.length,
      resumed: prog ? 1 : 0, at: (q.idx || 0) + 1, from: state._quizFrom || '' });
  } catch (e) {}
  state._quizFrom = '';
}
function qzTrackDone(q) {
  if (_qzSess && q && q.kind === _qzSess.kind && q.date === _qzSess.date) _qzSess.done = true;
}
/* how: 'quit' (✕ / Quit / back to lesson), 'nav' (went to another screen),
   'hidden' (app or tab put in the background: may still come back). */
function qzTrackLeave(how) {
  var s = _qzSess;
  if (!s || s.done || s.ended) return;
  var q = (state.quiz && state.quiz.kind === s.kind) ? state.quiz
    : ((state.pausedQuiz && state.pausedQuiz.kind === s.kind) ? state.pausedQuiz : null);
  if (how === 'hidden') { if (s.hid || !q) return; s.hid = true; }
  else { s.ended = true; _qzSess = null; }
  try {
    trackEvent('quiz_exit', { kind: s.kind, date: s.date, how: how,
      at: q ? (q.idx || 0) + 1 : null, answered: q ? (q.log || []).filter(Boolean).length : null,
      correct: q ? q.correct : null, total: q ? q.questions.length : null, hearts: q ? q.hearts : null,
      secs: Math.round((Date.now() - s.t0) / 1000) });
  } catch (e) {}
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && state.quiz) qzTrackLeave('hidden');
});
