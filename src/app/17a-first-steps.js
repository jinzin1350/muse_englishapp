/* ---------------- First lesson in 3 steps (#/first-steps), 2026-11-24 ----------------
   Why: half of new learners leave on day one within 5 minutes (only 18% of them come back);
   those who do something on day one (shadowing, a quiz, a question to Muse) come back far
   more often. So a new learner gets one short, guided win straight away instead of a full lesson:
     1. 5 of today's words (photo, audio, meaning)
     2. say one sentence of today's story out loud (live speech check on Android/desktop;
        iPhone gets listen-and-repeat)
     3. a 3-question quiz on those words, with "Why? Ask Muse" under a wrong answer
     done: what they learned, "when should we remind you tomorrow?" (saved to user_kv
     muse_reminder_v1 + OneSignal tags for the reminder push), notifications, then today's lesson.
   Entry: the welcome modal's main button (new accounts) and a card at the top of home
   (accounts under 7 days old that haven't done it and haven't finished today's quiz).
   Hooks elsewhere: router line in show(), 'first-steps' in LEARNER_VIEWS, firstStepsCardHTML()
   in paintHome/paintHomeDesktop, the welcome modal button (data-fs-start).
   Events: first_win_start, first_win_step, first_win_say, first_win_quiz, first_win_done,
   first_win_exit, reminder_set. */
var FS = null;   /* { words, sentence, i, step, said, score, picks } */
var FS_HOURS = [9, 14, 19, 23];

function fsFa() { try { return uiLang() === 'fa'; } catch (e) { return true; } }
function fsT(fa, en) { return fsFa() ? fa : en; }
function fsNum(n) { var s = String(n); return fsFa() ? s.replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }) : s; }
function fsUrl(p) { p = String(p || ''); return !p || /^(https?:)?\//.test(p) ? p : '/' + p; }
function fsDoneKey() { return 'muse_first_win_' + ((state.user && (state.user.id || state.user.email)) || 'anon'); }
function fsDone() { try { return !!localStorage.getItem(fsDoneKey()); } catch (e) { return false; } }

/* who sees the home card */
function firstStepsEligible() {
  var u = state.user;
  if (!u || u.isAdmin || state.teacher) return false;
  if (fsDone()) return false;
  var today = state.lessons && state.lessons[0];
  if (!today || !(today.words || []).length) return false;
  try { if (getDayProgress(today.date).quiz) return false; } catch (e) {}
  if (u.demo) return true;
  if (!u.createdAt) return false;
  return Date.now() - new Date(u.createdAt).getTime() < 7 * 86400000;
}

function firstStepsCardHTML() {
  if (!firstStepsEligible()) return '';
  return '<button type="button" class="fs-card" data-fs-start="home" data-fa-skip dir="' + (fsFa() ? 'rtl' : 'ltr') + '">' +
    '<span class="fs-card-ico" aria-hidden="true">🚀</span>' +
    '<span class="fs-card-t"><b>' + fsT('اولین درس: ۳ قدم، ۳ دقیقه', 'Your first lesson: 3 steps, 3 minutes') + '</b>' +
    '<span>' + fsT('۵ لغت، یه جمله که بلند می‌گی، و یه آزمون کوچیک', '5 words, one sentence out loud, and a tiny quiz') + '</span></span>' +
    '<span class="fs-card-go" aria-hidden="true">' + (fsFa() ? '←' : '→') + '</span></button>';
}

/* from the welcome modal or the home card */
function startFirstSteps(from) {
  if (from === 'welcome') {
    window._introAfterWelcome = false;     /* the features/install popup waits until the end */
    window._fsDeferIntro = true;
    try { closeModal(); } catch (e) {}
  }
  FS = null;
  trackEvent('first_win_start', { from: from || '' });
  go('first-steps');
}

function fsPickWords(lesson) {
  var ws = (lesson.words || []).filter(function (w) { return w && w.word && (w.persian || w.meaning); });
  return ws.slice(0, 5);
}

async function fsText(url) {
  var r = await fetch(fsUrl(url));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  var t = await r.text();
  if (/^\s*</.test(t)) throw new Error('not a transcript');   /* an HTML error or app page, not the text file */
  return t;
}
async function fsPickSentence(lesson) {
  var sh = lesson.shadowing || {};
  var audios = sh.sentence_audio || [];
  if (sh.transcript && audios.length) {
    try {
      var text = await fsText(sh.transcript);
      var sents = splitSentences(text, audios.length);
      var fa = [];
      if (sh.transcript_fa) {
        try { fa = (await fsText(sh.transcript_fa)).split(/\r?\n/); } catch (e) {}
      }
      for (var i = 0; i < Math.min(sents.length, audios.length); i++) {
        var n = sents[i].split(/\s+/).length;
        if (n >= 4 && n <= 12) return { text: sents[i], audio: fsUrl(audios[i]), fa: (fa[i] || '').trim() };
      }
      if (sents[0] && audios[0]) return { text: sents[0], audio: fsUrl(audios[0]), fa: (fa[0] || '').trim() };
    } catch (e) {}
  }
  var w = (lesson.words || [])[0];
  return w && w.example ? { text: w.example, audio: '', fa: w.example_fa || '' } : null;
}

function fsShuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

function fsBuildQuiz(words) {
  return fsShuffle(words).slice(0, 3).map(function (w) {
    var others = fsShuffle(words.filter(function (x) { return x !== w; })).slice(0, 3).map(function (x) { return x.word; });
    var opts = fsShuffle(others.concat([w.word]));
    return {
      prompt: fsFa() && w.persian ? '«' + w.persian + '» ' + 'به انگلیسی چی میشه؟' : 'Which word means: "' + (w.meaning || w.persian) + '"?',
      options: opts, answer: opts.indexOf(w.word), word: w, picked: -1,
    };
  });
}

async function renderFirstSteps(v) {
  var lesson = state.lessons && state.lessons[0];
  if (!state.user || !lesson) { go('home'); return; }
  if (!FS) {
    var words = fsPickWords(lesson);
    if (words.length < 4) { go('lesson', lesson.date); return; }
    FS = { words: words, sentence: undefined, step: 1, i: 0, said: null, quiz: fsBuildQuiz(words), qi: 0, score: 0, played: 0 };
    fsPickSentence(lesson).then(function (s) { if (FS) { FS.sentence = s; if (FS.step === 2) fsPaint(); } });
  }
  fsPaint();
}

function fsAudio(src) {
  if (!src) return;
  try {
    if (!fsAudio.el) fsAudio.el = new Audio();
    fsAudio.el.pause();
    fsAudio.el.src = src;
    fsAudio.el.play().catch(function () {});
  } catch (e) {}
}

function fsProgressHTML() {
  var labels = fsFa() ? ['لغت‌ها', 'بلند بگو', 'آزمون'] : ['Words', 'Say it', 'Quiz'];
  return '<ol class="fs-steps" aria-label="' + fsT('مرحله‌ها', 'Steps') + '">' + labels.map(function (l, i) {
    var n = i + 1, cls = FS.step > n || FS.step === 4 ? 'done' : (FS.step === n ? 'on' : '');
    return '<li class="' + cls + '"' + (FS.step === n ? ' aria-current="step"' : '') + '><span>' + fsNum(n) + '</span>' + l + '</li>';
  }).join('') + '</ol>';
}

function fsPaint() {
  var v = document.getElementById('view');
  if (!v || state.view !== 'first-steps' || !FS) return;
  var fa = fsFa();
  var head = '<div class="fs-top"><button type="button" class="fs-x" data-fs="exit" aria-label="' + fsT('بستن', 'Close') + '">✕</button>' +
    (FS.step < 4 ? fsProgressHTML() : '') + '</div>';
  var body = '';
  if (FS.step === 1) {
    var w = FS.words[FS.i];
    body = '<p class="fs-kicker">' + fsT('قدم ۱ از ۳: لغت‌های امروز', 'Step 1 of 3: today\'s words') + ' <span>' + fsNum(FS.i + 1) + ' / ' + fsNum(FS.words.length) + '</span></p>' +
      '<div class="fs-word">' +
        (w.photo ? '<img class="fs-photo" src="' + esc(fsUrl(w.photo)) + '" alt="" loading="eager">' : '') +
        '<div class="fs-word-row" dir="ltr" lang="en"><span class="fs-w">' + esc(w.word) + '</span>' +
          (w.word_audio ? '<button type="button" class="fs-play" data-fs="say-word" aria-label="' + fsT('پخش تلفظ', 'Play pronunciation') + '">🔊</button>' : '') + '</div>' +
        (w.pronunciation ? '<p class="fs-pron" dir="ltr">' + esc(w.pronunciation) + '</p>' : '') +
        (fa && w.persian ? '<p class="fs-mean" dir="rtl">' + esc(w.persian) + '</p>' : '<p class="fs-mean" dir="ltr">' + esc(w.meaning || '') + '</p>') +
        (w.example ? '<p class="fs-ex" dir="ltr" lang="en">' + esc(w.example) + '</p>' : '') +
        (fa && w.example_fa ? '<p class="fs-ex-fa" dir="rtl">' + esc(w.example_fa) + '</p>' : '') +
      '</div>' +
      '<button type="button" class="fs-btn" data-fs="next-word">' + (FS.i + 1 < FS.words.length ? fsT('لغت بعدی', 'Next word') : fsT('رفتیم قدم بعد', 'On to step 2')) + '</button>';
  } else if (FS.step === 2) {
    var s = FS.sentence;
    if (s === undefined) {
      body = '<p class="fs-kicker">' + fsT('قدم ۲ از ۳: بلند بگو', 'Step 2 of 3: say it') + '</p><div class="fs-wait">' + fsT('یه لحظه…', 'One moment…') + '</div>';
    } else if (!s) {
      FS.step = 3; trackEvent('first_win_step', { step: 3, skipped: 'no-sentence' }); fsPaint(); return;
    } else {
      var canSR = fsCanListen();
      body = '<p class="fs-kicker">' + fsT('قدم ۲ از ۳: بلند بگو', 'Step 2 of 3: say it') + '</p>' +
        '<div class="fs-say">' +
          '<p class="fs-say-help">' + (canSR
            ? fsT('اول گوش بده، بعد روی میکروفون بزن و همین جمله رو بلند بگو.', 'Listen first, then tap the mic and say this sentence out loud.')
            : fsT('اول گوش بده، بعد همین جمله رو بلند تکرار کن.', 'Listen first, then repeat this sentence out loud.')) + '</p>' +
          '<p class="fs-sent" dir="ltr" lang="en">' + esc(s.text) + '</p>' +
          (fa && s.fa ? '<p class="fs-sent-fa" dir="rtl">' + esc(s.fa) + '</p>' : '') +
          '<div class="fs-say-btns">' +
            (s.audio ? '<button type="button" class="fs-round" data-fs="say-sent" aria-label="' + fsT('گوش بده', 'Listen') + '">🔊<span>' + fsT('گوش بده', 'Listen') + '</span></button>' : '') +
            (canSR ? '<button type="button" class="fs-round fs-mic" data-fs="mic" aria-label="' + fsT('بلند بگو', 'Say it') + '">🎤<span>' + fsT('بلند بگو', 'Say it') + '</span></button>' : '') +
          '</div>' +
          '<div class="fs-heard" id="fs-heard" aria-live="polite">' + fsHeardHTML() + '</div>' +
        '</div>' +
        (FS.said
          ? '<button type="button" class="fs-btn" data-fs="to-quiz">' + fsT('رفتیم آزمون', 'On to the quiz') + '</button>'
          : (canSR
              ? '<button type="button" class="fs-link" data-fs="skip-say">' + fsT('الان نمی‌تونم بلند حرف بزنم', 'I can\'t speak out loud right now') + '</button>'
              : '<button type="button" class="fs-btn" data-fs="said-self">' + fsT('گفتم ✓', 'I said it ✓') + '</button>'));
    }
  } else if (FS.step === 3) {
    var q = FS.quiz[FS.qi];
    var answered = q.picked >= 0, good = answered && q.picked === q.answer;
    body = '<p class="fs-kicker">' + fsT('قدم ۳ از ۳: آزمون کوچیک', 'Step 3 of 3: tiny quiz') + ' <span>' + fsNum(FS.qi + 1) + ' / ' + fsNum(FS.quiz.length) + '</span></p>' +
      '<div class="fs-q"><p class="fs-q-t" dir="auto">' + esc(q.prompt) + '</p>' +
      '<div class="fs-opts" dir="ltr">' + q.options.map(function (o, i) {
        var cls = !answered ? '' : (i === q.answer ? ' ok' : (i === q.picked ? ' bad' : ' dim'));
        return '<button type="button" class="fs-opt' + cls + '" data-fs="pick" data-i="' + i + '"' + (answered ? ' disabled' : '') + ' lang="en">' + esc(o) + '</button>';
      }).join('') + '</div>' +
      (answered
        ? '<div class="fs-fb ' + (good ? 'ok' : 'bad') + '">' +
            (good ? fsT('آفرین، درسته!', 'Correct, well done!')
                  : fsT('جواب درست: ', 'The answer: ') + '<b dir="ltr">' + esc(q.options[q.answer]) + '</b>') +
            (!good && typeof askMuseWhyHTML === 'function' && ASKM.enabled ? '<button type="button" class="fs-why" data-fs="why">' +
              '<img src="/media/ask-muse/atish-face.webp" alt="" width="24" height="24">' + fsT('چرا؟ از Muse بپرس', 'Why? Ask Muse') + '</button>' : '') +
          '</div>' +
          '<button type="button" class="fs-btn" data-fs="next-q">' + (FS.qi + 1 < FS.quiz.length ? fsT('سؤال بعدی', 'Next question') : fsT('تموم شد!', 'Finish')) + '</button>'
        : '') + '</div>';
  } else {
    body = fsDoneHTML();
  }
  v.innerHTML = '<div class="fs" data-fa-skip dir="' + (fa ? 'rtl' : 'ltr') + '" lang="' + (fa ? 'fa' : 'en') + '">' + head + body + '</div>';
}

/* ---- step 2: say it (live speech check where the browser supports it) ---- */
function fsIsIOS() {
  var ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
}
function fsCanListen() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !fsIsIOS(); }
function fsWords(t) { return String(t || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean); }
function fsHeardHTML() {
  if (!FS || !FS.heard) return '';
  if (FS.heard.listening) return '<span class="fs-live">' + fsT('دارم گوش می‌دم…', 'Listening…') + '</span> <span dir="ltr">' + esc(FS.heard.text || '') + '</span>';
  if (FS.heard.error) return '<span class="fs-try">' + esc(FS.heard.error) + '</span>';
  var r = FS.heard;
  var msg = r.hit >= r.total ? fsT('عالی! همه‌ی کلمه‌ها رو درست گفتی 🎉', 'Perfect! You said every word 🎉')
    : r.hit / r.total >= 0.6 ? fsT('خیلی خوب! ' + fsNum(r.hit) + ' از ' + fsNum(r.total) + ' کلمه رو درست گفتی.', 'Nice! You got ' + r.hit + ' of ' + r.total + ' words.')
    : fsT(fsNum(r.hit) + ' از ' + fsNum(r.total) + ' کلمه. یه بار دیگه آروم‌تر بگو.', r.hit + ' of ' + r.total + ' words. Try once more, a bit slower.');
  return '<span class="fs-res">' + msg + '</span>' + (r.text ? '<span class="fs-you" dir="ltr">“' + esc(r.text) + '”</span>' : '');
}
function fsListen() {
  if (!FS || !FS.sentence || FS.listening) return;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  try { if (fsAudio.el) fsAudio.el.pause(); } catch (e) {}
  var rec, heard = '';
  try { rec = new SR(); } catch (e) { return; }
  rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  FS.listening = true;
  FS.heard = { listening: true, text: '' };
  fsUpdateHeard(true);
  var stopTimer = setTimeout(function () { try { rec.stop(); } catch (e) {} }, 12000);
  rec.onresult = function (e) {
    heard = Array.prototype.map.call(e.results, function (r) { return r[0].transcript; }).join(' ');
    FS.heard = { listening: true, text: heard };
    fsUpdateHeard(true);
  };
  rec.onerror = function (e) {
    var denied = e && (e.error === 'not-allowed' || e.error === 'service-not-allowed');
    FS.heard = { error: denied ? fsT('اجازه‌ی میکروفون داده نشد. می‌تونی این قدم رو رد کنی.', 'The microphone is blocked. You can skip this step.')
                               : fsT('صدایی نشنیدم. دوباره روی میکروفون بزن.', 'I didn\'t hear anything. Tap the mic again.') };
  };
  rec.onend = function () {
    clearTimeout(stopTimer);
    FS.listening = false;
    if (heard) {
      var target = fsWords(FS.sentence.text), got = fsWords(heard), pool = got.slice(), hit = 0;
      target.forEach(function (t) { var k = pool.indexOf(t); if (k !== -1) { hit++; pool.splice(k, 1); } });
      FS.heard = { text: heard, hit: hit, total: target.length };
      FS.said = true;
      trackEvent('first_win_say', { sr: 1, hit: hit, total: target.length });
    } else if (!FS.heard || !FS.heard.error) {
      FS.heard = { error: fsT('صدایی نشنیدم. دوباره روی میکروفون بزن.', 'I didn\'t hear anything. Tap the mic again.') };
    }
    fsPaint();
  };
  try { rec.start(); } catch (e) { FS.listening = false; FS.heard = null; fsPaint(); }
}
function fsUpdateHeard(listening) {
  var el = document.getElementById('fs-heard');
  if (el) el.innerHTML = fsHeardHTML();
  var mic = document.querySelector('.fs-mic');
  if (mic) mic.classList.toggle('on', !!listening);
}

/* ---- done: reminder hour + notifications ---- */
function fsReminder() { try { return JSON.parse(localStorage.getItem('muse_reminder_v1') || 'null'); } catch (e) { return null; } }
function fsHourLabel(h) {
  if (fsFa()) return { 9: '۹ صبح', 14: '۲ بعدازظهر', 19: '۷ عصر', 23: '۱۱ شب' }[h] || fsNum(h);
  return { 9: '9 am', 14: '2 pm', 19: '7 pm', 23: '11 pm' }[h] || String(h);
}
function fsDoneHTML() {
  var rem = fsReminder();
  var nowH = new Date().getHours();
  var suggest = FS_HOURS.reduce(function (b, h) { return Math.abs(h - nowH) < Math.abs(b - nowH) ? h : b; }, FS_HOURS[0]);
  var chosen = rem && rem.hour;
  var pushBtn = (typeof oneSignalReady === 'function' && oneSignalReady() && !state.pushOptedIn)
    ? '<button type="button" class="fs-btn fs-btn-2" id="fs-push" data-fs="push">🔔 ' + fsT('روشن کردن اعلان یادآوری', 'Turn on reminder notifications') + '</button><p class="fs-push-status" id="push-status" dir="auto"></p>'
    : '';
  var words = FS.words.map(function (w) { return '<span lang="en">' + esc(w.word) + '</span>'; }).join('');
  return '<div class="fs-done">' +
    '<img class="fs-done-img" src="/media/landing/mascot-cta.webp" alt="" width="120" height="120">' +
    '<h1>' + fsT('آفرین! اولین قدمت رو برداشتی', 'Well done! That\'s your first step') + '</h1>' +
    '<p class="fs-done-sub">' + (FS.score > 0
      ? fsT('امروز این ۵ لغت رو یاد گرفتی و ' + fsNum(FS.score) + ' از ' + fsNum(FS.quiz.length) + ' سؤال رو درست جواب دادی:',
            'Today you learned these 5 words and got ' + FS.score + ' of ' + FS.quiz.length + ' right:')
      : fsT('امروز با این ۵ لغت آشنا شدی. فردا که دوباره ببینیشون، راحت‌تر یادت می‌مونن:',
            'Today you met these 5 words. They will stick better when you see them again tomorrow:')) + '</p>' +
    '<div class="fs-chips" dir="ltr">' + words + '</div>' +
    '<div class="fs-rem"><h2>' + fsT('فردا کِی یادت بندازیم؟', 'When should we remind you tomorrow?') + '</h2>' +
      '<p>' + fsT('هر روز یه درس تازه داری. یه ساعت انتخاب کن که معمولاً وقت داری.', 'There\'s a new lesson every day. Pick a time you\'re usually free.') + '</p>' +
      '<div class="fs-hours" role="group">' + FS_HOURS.map(function (h) {
        var on = chosen ? chosen === h : false;
        return '<button type="button" class="fs-hour' + (on ? ' on' : '') + (!chosen && h === suggest ? ' hint' : '') + '" data-fs="hour" data-h="' + h + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + fsHourLabel(h) + '</button>';
      }).join('') + '</div>' +
      (chosen ? '<p class="fs-saved">✓ ' + fsT('ذخیره شد: فردا ساعت ' + fsHourLabel(chosen), 'Saved: tomorrow at ' + fsHourLabel(chosen)) + '</p>' : '') +
      pushBtn +
    '</div>' +
    '<button type="button" class="fs-btn" data-fs="lesson">' + fsT('ادامه‌ی درس امروز', 'Continue today\'s lesson') + '</button>' +
    '<p class="fs-done-note">' + fsT('اگه لغت‌ها و آزمون کامل درس امروز رو تموم کنی، اولین روز از روزهای پیاپیت ثبت میشه 🔥', 'Finish today\'s words and quiz to start your streak 🔥') + '</p>' +
    '<button type="button" class="fs-link" data-fs="home">' + fsT('بعداً', 'Later') + '</button>' +
  '</div>';
}
function fsSaveReminder(h) {
  var tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  var val = { hour: h, tz: tz, set_at: new Date().toISOString(), source: 'first-steps' };
  try { localStorage.setItem('muse_reminder_v1', JSON.stringify(val)); } catch (e) {}
  trackEvent('reminder_set', { hour: h, tz: tz });
  try {
    if (cloudReady() && state.user && !state.user.demo) {
      sb.from('user_kv').upsert({ user_id: state.user.id, key: 'muse_reminder_v1', value: val, updated_at: val.set_at },
        { onConflict: 'user_id,key' }).then(function () {}, function () {});
    }
  } catch (e) {}
  try {
    if (typeof oneSignalReady === 'function' && oneSignalReady()) {
      window.OneSignalDeferred.push(async function (OneSignal) {
        try { await OneSignal.User.addTags({ reminder_hour: String(h), reminder_tz: tz }); } catch (e) {}
      });
    }
  } catch (e) {}
}
function fsFinish(to) {
  try { localStorage.setItem(fsDoneKey(), new Date().toISOString()); } catch (e) {}
  var lesson = state.lessons && state.lessons[0];
  var defer = window._fsDeferIntro;
  window._fsDeferIntro = false;
  FS = null;
  if (to === 'lesson' && lesson) { state.lessonTab = 'words'; go('lesson', lesson.date); }
  else go('home');
  if (defer) setTimeout(function () { try { maybeShowIntroPopup(0); } catch (e) {} }, 900);
}

document.addEventListener('click', function (e) {
  var t = e.target && e.target.closest && e.target.closest('[data-fs-start],[data-fs]');
  if (!t) return;
  if (t.hasAttribute('data-fs-start')) { e.preventDefault(); startFirstSteps(t.getAttribute('data-fs-start')); return; }
  if (!FS || state.view !== 'first-steps') return;
  var a = t.getAttribute('data-fs');
  if (a === 'exit') { trackEvent('first_win_exit', { step: FS.step }); var d = window._fsDeferIntro; window._fsDeferIntro = false; FS = null; go('home'); if (d) setTimeout(function () { try { maybeShowIntroPopup(0); } catch (e2) {} }, 900); }
  else if (a === 'say-word') { var w = FS.words[FS.i]; fsAudio(fsUrl(w.word_audio)); FS.played++; }
  else if (a === 'next-word') {
    if (FS.i + 1 < FS.words.length) { FS.i++; fsPaint(); var nw = FS.words[FS.i]; if (nw.word_audio) fsAudio(fsUrl(nw.word_audio)); }
    else { FS.step = 2; trackEvent('first_win_step', { step: 2, played: FS.played }); fsPaint(); }
  }
  else if (a === 'say-sent') { if (FS.sentence) fsAudio(FS.sentence.audio); }
  else if (a === 'mic') fsListen();
  else if (a === 'said-self') { FS.said = true; trackEvent('first_win_say', { sr: 0 }); FS.step = 3; trackEvent('first_win_step', { step: 3 }); fsPaint(); }
  else if (a === 'skip-say') { trackEvent('first_win_say', { sr: 1, skipped: 1 }); FS.step = 3; trackEvent('first_win_step', { step: 3 }); fsPaint(); }
  else if (a === 'to-quiz') { FS.step = 3; trackEvent('first_win_step', { step: 3 }); fsPaint(); }
  else if (a === 'pick') {
    var q = FS.quiz[FS.qi];
    if (q.picked >= 0) return;
    q.picked = +t.getAttribute('data-i');
    if (q.picked === q.answer) FS.score++;
    fsPaint();
  }
  else if (a === 'why') {
    var qq = FS.quiz[FS.qi];
    var lesson = state.lessons && state.lessons[0];
    askMuseOpen({
      ctx: { view: 'first-steps', title: lesson ? lesson.theme : '', level: lesson ? lesson.level : '',
             q: { kind: 'word', question: qq.prompt, options: qq.options, picked: qq.options[qq.picked], correct: qq.options[qq.answer],
                  explanation: qq.word.example || '' } },
      send: fsT('چرا جوابم غلط بود؟', 'Why was my answer wrong?'),
    });
    trackEvent('ask_muse_why', { view: 'first-steps', kind: 'word' });
  }
  else if (a === 'next-q') {
    if (FS.qi + 1 < FS.quiz.length) { FS.qi++; fsPaint(); }
    else {
      FS.step = 4;
      trackEvent('first_win_quiz', { correct: FS.score, total: FS.quiz.length });
      trackEvent('first_win_done', { said: FS.said ? 1 : 0, correct: FS.score });
      try { localStorage.setItem(fsDoneKey(), new Date().toISOString()); } catch (e2) {}
      fsPaint();
    }
  }
  else if (a === 'hour') { fsSaveReminder(+t.getAttribute('data-h')); fsPaint(); }
  else if (a === 'push') { try { promptPush(t); } catch (e3) {} }
  else if (a === 'lesson') fsFinish('lesson');
  else if (a === 'home') fsFinish('home');
});
