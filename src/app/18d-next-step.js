/* ---------------- "what's next" pop-up after a lesson quiz ----------------
   Claude, 2026-11-26, Alireza's order. Replaces the two English images that
   followed the first quiz of a lesson ("Awesome! You finished today's lesson"
   + "Want more points? Go to podcast"). Those told learners they were done,
   were English only, and always sent them to the podcast, which A1 lessons
   no longer have (A1 learners landed back on the words they had just done).
   Now one Persian bottom sheet (same look as the quiz pop-up, 18b-quiz-door.js):
   well done + streak line, a small map of this lesson's parts with ticks, and
   the next part this lesson really has and the learner hasn't done yet
   (podcast -> shadowing -> grammar), with Go / Later.
   Called from launchCelebration() (20-streak-celebrations.js), which runs after
   the rank-climb animation. Returns false when it can't help, and the old
   celebration runs instead.
   Event: next_step {action: shown|go|later, step, date, after}. */

function nsLesson(date) {
  var m = (state.lessons || []).find(function (x) { return x && x.date === date; }) || null;
  if (!m && state.lesson && state.lesson.date === date) m = state.lesson;
  return m;
}
function nsHasShadowing(m) {
  var s = m && m.shadowing;
  return !!(s && s.audio);   /* same test as shadowingTabHTML */
}
/* This lesson's parts in app order; grammar always exists (#/lesson grammar tab). */
function nsParts(m) {
  var parts = ['words', 'quiz'];
  if (lessonHasPodcast(m)) parts.push('podcast');
  if (nsHasShadowing(m)) parts.push('shadowing');
  parts.push('grammar');
  return parts;
}
/* First part after the quiz that isn't done yet ('' = all done). */
function nsPick(m, prog) {
  return nsParts(m).filter(function (p) { return p !== 'words' && p !== 'quiz' && !prog[p]; })[0] || '';
}

function nextStepShow(info) {
  try {
    if (!info || !info.date || (info.action !== 'word_quiz' && info.action !== 'grammar_quiz')) return false;
    var m = nsLesson(info.date);
    if (!m) return false;
    var fa = qzFa();
    var T = function (f, e) { return fa ? f : e; };
    var prog = getDayProgress(info.date) || {};
    var afterGrammar = info.action === 'grammar_quiz';
    if (afterGrammar) prog.grammar = true;
    var next = nsPick(m, prog);
    var isToday = info.date === todayStr();
    var streakNow = isToday && prog.words && prog.quiz && !afterGrammar;

    var label = { words: T('لغت‌ها', 'Words'), quiz: T('آزمون', 'Quiz'), podcast: T('پادکست', 'Podcast'), shadowing: T('تمرین تلفظ', 'Shadowing'), grammar: T('گرامر', 'Grammar') };
    var map = nsParts(m).map(function (p) {
      var done = !!prog[p];
      return '<span class="ns-chip' + (done ? ' done' : '') + (p === next ? ' next' : '') + '">' + (done ? '✓ ' : '') + label[p] + '</span>';
    }).join('<span class="ns-sep" aria-hidden="true">' + (fa ? '‹' : '›') + '</span>');

    var nSent = ((m.shadowing && m.shadowing.sentence_audio) || []).length;
    var what = {
      podcast: T('یه مکالمهٔ کوتاه انگلیسی دربارهٔ موضوع امروز. گوش بده تا گوشت به انگلیسیِ واقعی عادت کنه.',
                 'A short English conversation on today’s topic. Listen and get your ear used to real English.'),
      shadowing: T('جمله‌های یه داستان کوتاه رو گوش بده و بلند تکرار کن' + (nSent ? ' (' + faNum(nSent) + ' جمله)' : '') + '. تلفظت قوی‌تر میشه.',
                   'Listen to the sentences of a short story and repeat them out loud' + (nSent ? ' (' + nSent + ' sentences)' : '') + '. Your pronunciation gets stronger.'),
      grammar: T('یه نکتهٔ گرامری کوتاه با تمرین، به زبون ساده.', 'One short grammar point with practice, in plain words.')
    };
    var title = afterGrammar ? T('آفرین! آزمون گرامر رو تموم کردی 👏', 'Nice! You finished the grammar quiz 👏')
                             : T('آفرین! آزمون رو تموم کردی 🎉', 'Nice! You finished the quiz 🎉');
    var xp = info.xp ? '<span class="ns-xp">+' + (fa ? faNum(info.xp) : info.xp) + T(' امتیاز', ' XP') + '</span>' : '';

    var body = next
      ? '<p class="ns-next-k">' + T('مرحلهٔ بعد:', 'Next up:') + ' <b>' + label[next] + '</b></p><p>' + what[next] + '</p>' +
        '<button class="qz-nudge-go" data-ns="go">' + T('برو سراغ ', 'Go to ') + label[next] + (fa ? ' ←' : ' →') + '</button>' +
        '<button class="qz-nudge-later" data-ns="later">' + T('بعداً', 'Later') + '</button>'
      : '<p>' + T('همهٔ بخش‌های این درس رو انجام دادی. فردا یه درس تازه منتظرته 🔥', 'You’ve done every part of this lesson. A new lesson is waiting tomorrow 🔥') + '</p>' +
        '<button class="qz-nudge-go" data-ns="later">' + T('عالی', 'Great') + '</button>';

    closeCelebration();
    celState = { info: info };
    var el = document.createElement('div');
    el.id = 'celebration';              /* same id as the old screens: other pop-ups wait while it's open */
    el.className = 'qz-nudge ns';
    el.setAttribute('data-fa-skip', '');
    el.innerHTML =
      '<div class="qz-nudge-back" data-ns="later"></div>' +
      '<div class="qz-nudge-card" role="dialog" aria-modal="true" aria-labelledby="ns-t"' + (fa ? ' dir="rtl" lang="fa"' : '') + '>' +
        '<img class="qz-nudge-ico" src="/media/ask-muse/atish-face.webp" alt="" width="72" height="72">' +
        '<h3 id="ns-t">' + title + '</h3>' + xp +
        (streakNow ? '<p class="qz-nudge-streak">' + T('امروز توی روزهای پیاپیت ثبت شد 🔥', 'Today counts toward your streak 🔥') + '</p>' : '') +
        '<div class="ns-map">' + map + '</div>' +
        body +
      '</div>';
    document.body.appendChild(el);
    document.body.classList.remove('duo-playing');
    requestAnimationFrame(function () { el.classList.add('on'); });
    try { el.querySelector('.qz-nudge-go').focus({ preventScroll: true }); } catch (e) {}
    try { trackEvent('next_step', { action: 'shown', step: next || 'none', date: info.date, after: info.action || '' }); } catch (e) {}

    var finish = function (action) {
      document.removeEventListener('keydown', onKey);
      try { trackEvent('next_step', { action: action, step: next || 'none', date: info.date, after: info.action || '' }); } catch (e) {}
      closeCelebration();
      if (action === 'go' && next) {
        state.lessonTab = next;
        go('lesson', info.date);
      } else {
        go('home');
      }
    };
    var onKey = function (e) { if (e.key === 'Escape') finish('later'); };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ns]');
      if (b) finish(b.getAttribute('data-ns') === 'go' && next ? 'go' : 'later');
    });
    return true;
  } catch (e) { return false; }
}
