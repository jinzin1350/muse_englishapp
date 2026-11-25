/* ---------------- Ask Muse (از Muse بپرس): AI tutor chat (Claude, 2026-11-14) ----------------
   Owned by Claude (see CLAUDE_PERSIAN_WORK.md). Don't edit; report changes you need.
   - Server: functions/api/assistant.js (DeepSeek deepseek-flash, thinking off, streamed answers).
   - Database: supabase/ask-muse.sql. ai_chat_today = today's chat + questions left. The server
     checks the daily limit (10 a day, VIP 50) and saves every question and answer.
   - Floating button #askm-fab on learner screens, shown only when GET /api/assistant says enabled
     (that is, once DEEPSEEK_API_KEY is set in Cloudflare).
   - askMuseWhyHTML(): "Ask Muse why" button under a wrong answer (word quizzes, grammar quizzes).
   - Hooks elsewhere: askMuseSync() at the end of show(); askMuseWhyHTML() in duoFooter and the two
     grammar answer sheets; '[data-fa-skip]' keeps the Persian UI engine out of the chat. */
var ASKM = { enabled: null, p: null, open: false, busy: false, loaded: false, msgs: [], quota: null,
  fresh: false, links: null, linksP: null, ctx: null, lastFocus: null };
var ASKM_HIDE = { landing: 1, signin: 1, signup: 1, preview: 1, waiting: 1, ielts: 1, 'grammar-test': 1, ptest: 1,
  certificate: 1, admin: 1, 'admin-teacher': 1, teacher: 1, planner: 1, 'choose-teacher': 1, 'become-teacher': 1, support: 1 };

function askmFa() { try { return uiLang() === 'fa'; } catch (e) { return true; } }
function askmT(fa, en) { return askmFa() ? fa : en; }
function askmNum(n) { var s = String(n); return askmFa() ? s.replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }) : s; }

function askmCheck() {
  if (ASKM.enabled !== null) return Promise.resolve(ASKM.enabled);
  if (!ASKM.p) {
    ASKM.p = fetch('/api/assistant', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
      .then(function (j) { ASKM.enabled = !!(j && j.enabled); return ASKM.enabled; },
            function () { ASKM.enabled = false; return false; });
  }
  return ASKM.p;
}

function askmAllowed() {
  if (!state.user) return false;
  try { if (onboardingNeeded()) return false; } catch (e) {}
  return !ASKM_HIDE[state.view];
}

/* called at the end of show(): show or hide the floating button */
function askMuseSync() {
  if (!askmAllowed()) { askmFab(false); if (ASKM.open && !state.user) askmClose(); return; }
  if (ASKM.enabled) { askmFab(true); return; }
  if (ASKM.enabled === null) askmCheck().then(function (on) { if (on && askmAllowed()) askmFab(true); });
}

function askmFab(show) {
  var b = document.getElementById('askm-fab');
  if (!show) { if (b) b.hidden = true; return; }
  if (!b) {
    b = document.createElement('button');
    b.id = 'askm-fab';
    b.type = 'button';
    b.setAttribute('data-fa-skip', '');
    b.innerHTML = '<img src="/media/ask-muse/atish-face.webp" alt="" width="56" height="56" decoding="async">' +
      '<span class="askm-fab-dot" aria-hidden="true">?</span>';
    b.addEventListener('click', function () { askMuseOpen(null); });
    document.body.appendChild(b);
  }
  var label = askmT('از Muse بپرس', 'Ask Muse');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.hidden = false;
}

/* ---- where the learner is (becomes the [Screen] block on the server) ---- */
function askmContext() {
  var v = state.view || 'home', c = { view: v };
  try {
    var h1 = document.querySelector('#view h1');
    var title = h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (v === 'lesson' && state.lesson) {
      var m = state.lesson;
      c.title = m.theme || title;
      c.level = m.level || m.cefr || '';
      c.tab = state.lessonTab || '';
      c.words = (m.words || []).map(function (w) { return w && w.word; }).filter(Boolean).slice(0, 15);
      if (m.grammar && m.grammar.title) c.grammar = m.grammar.title;
    } else if (v === 'grammar' || v === 'vocab') {
      var ph = parseHash();
      if (ph.arg) { c.slug = ph.arg; c.title = title; }
    } else if (title) {
      c.title = title;
    }
  } catch (e) {}
  return c;
}

/* the question the learner just got wrong (word quizzes and grammar quizzes) */
function askmWrong() {
  try {
    var g = state.gquiz;
    if (g && g.answered) {
      var it = (g.items || [])[g.idx];
      if (!it) return null;
      var opts = it.type === 'error' ? (it.segments || []) : (it.options || []);
      var picked = it.type === 'gap' ? (it.typed || '') : (typeof g.picked === 'number' ? opts[g.picked] : '');
      var correct = it.type === 'gap' ? (it.accept || []).join(' / ')
        : it.type === 'error' ? (it.correction || opts[it.answer] || '') : opts[it.answer];
      return { kind: 'grammar', question: it.prompt || '', options: it.type === 'gap' ? [] : opts,
        picked: picked, correct: correct || '', explanation: it.explanation || '',
        topic: g.topic && (g.topic.slug || '') };
    }
    var q = state.quiz;
    if (q && q.answered && !q.wasCorrect) {
      var cur = (q.questions || [])[q.idx];
      if (!cur) return null;
      var pk = typeof q.picked === 'number' ? (cur.options || [])[q.picked] : (typeof q.picked === 'string' ? q.picked : '');
      var cr = cur.qtype === 'assist' ? (cur.tokens || []).join(' ')
        : cur.qtype === 'typein' ? (cur.accept || []).join(' / ') : (cur.options || [])[cur.answer];
      return { kind: cur.kind || q.kind || 'quiz', question: cur.question || cur.prompt || '',
        options: cur.qtype === 'assist' || cur.qtype === 'typein' ? [] : (cur.options || []),
        picked: pk || '', correct: cr || '', explanation: cur.explanation || '' };
    }
  } catch (e) {}
  return null;
}

/* "Ask Muse why" button for answer sheets ('' while the feature is off) */
function askMuseWhyHTML() {
  if (!ASKM.enabled || !state.user) return '';
  return '<button type="button" class="askm-why" data-askm-why data-fa-skip dir="' + (askmFa() ? 'rtl' : 'ltr') + '"' +
    (askmFa() ? ' lang="fa"' : '') + '>' +
    '<img src="/media/ask-muse/atish-face.webp" alt="" width="26" height="26">' +
    '<span>' + askmT('چرا؟ از Muse بپرس', 'Why? Ask Muse') + '</span></button>';
}
function askMuseWhy() {
  var w = askmWrong();
  var c = askmContext();
  if (w) c.q = w;
  askMuseOpen({ ctx: c, send: askmT('چرا جوابم غلط بود؟', 'Why was my answer wrong?') });
  trackEvent('ask_muse_why', { view: state.view, kind: w ? w.kind : '' });
}

/* ---- links: [[grammar:slug]] [[vocab:slug]] [[lesson]] [[review]] [[support]] ---- */
function askmLoadLinks() {
  if (ASKM.links) return Promise.resolve(ASKM.links);
  if (!ASKM.linksP) {
    ASKM.linksP = fetch('/data/ask-muse-links.json').then(function (r) { return r.ok ? r.json() : { g: {}, v: {} }; })
      .then(function (j) { ASKM.links = j; return j; }, function () { ASKM.linksP = null; return null; });
  }
  return ASKM.linksP;
}
function askmLinkHTML(kind, slug) {
  var L = ASKM.links, label = '', ico = '📘';
  if (kind === 'grammar') {
    if (L && !L.g[slug]) return '';
    var fa = '';
    try { if (askmFa()) fa = gFaTitle(slug); } catch (e) {}
    label = fa || (L && L.g[slug]) || slug.replace(/-/g, ' ');
  } else if (kind === 'vocab') {
    if (L && !L.v[slug]) return '';
    ico = '🗂️';
    label = (L && L.v[slug]) || slug.replace(/-/g, ' ');
  } else if (kind === 'lesson') { ico = '📖'; label = askmT('درس امروز', 'Today\'s lesson'); }
  else if (kind === 'review') { ico = '🔁'; label = askmT('مرور اشتباه‌ها', 'Review my mistakes'); }
  else if (kind === 'support') { ico = '💬'; label = askmT('پشتیبانی', 'Support'); }
  else return '';
  return '<button type="button" class="askm-link" data-askm-go="' + kind + '" data-askm-arg="' + esc(slug || '') + '">' +
    '<span aria-hidden="true">' + ico + '</span><span dir="auto">' + esc(label) + '</span></button>';
}

/* Muse's text -> safe HTML (escape first; then bold, bullets, app links; dir=auto per paragraph) */
function askmFmt(text, streaming) {
  var t = String(text || '');
  if (streaming) t = t.replace(/\[\[[^\]]*$/, '');
  var out = [], list = [];
  var flush = function () { if (list.length) { out.push('<ul dir="auto">' + list.join('') + '</ul>'); list = []; } };
  t.split('\n').forEach(function (raw) {
    var line = raw.replace(/^#{1,6}\s+/, '').replace(/`+/g, '').trim();
    if (!line) { flush(); return; }
    var h = esc(line)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[\[(grammar|vocab):([a-z0-9-]{1,80})\]\]/g, function (_, k, s) { return askmLinkHTML(k, s); })
      .replace(/\[\[(lesson|review|support)\]\]/g, function (_, k) { return askmLinkHTML(k, ''); })
      .replace(/\[\[[^\]]*\]\]/g, '');
    if (!h.replace(/<[^>]+>/g, '').trim() && h.indexOf('askm-link') === -1) return;
    var li = /^(?:[-•*]|\d+[.)])\s+/.test(line);
    if (li) list.push('<li dir="auto">' + h.replace(/^(?:[-•*]|\d+[.)])\s+/, '') + '</li>');
    else { flush(); out.push(h.indexOf('askm-link') !== -1 && !h.replace(/<button[\s\S]*?<\/button>/g, '').trim() ? '<div class="askm-links">' + h + '</div>' : '<p dir="auto">' + h + '</p>'); }
  });
  flush();
  return out.join('');
}

/* ---- the sheet ---- */
function askmChips(ctx) {
  var v = ctx && ctx.view;
  if (v === 'lesson') return askmFa()
    ? ['لغت‌های این درس رو با مثال یادم بده', 'با لغت‌های امروز ازم سؤال بپرس', 'گرامر این درس رو ساده توضیح بده']
    : ['Teach me this lesson\'s words with examples', 'Quiz me on today\'s words', 'Explain this lesson\'s grammar simply'];
  if (v === 'grammar' && ctx.slug) return askmFa()
    ? ['این مبحث رو ساده توضیح بده', 'سه تا مثال دیگه بزن', 'یه تمرین کوچیک بهم بده']
    : ['Explain this topic simply', 'Give me three more examples', 'Give me a short exercise'];
  if (v === 'vocab' && ctx.slug) return askmFa()
    ? ['مهم‌ترین لغت‌های این موضوع کدوما هستن؟', 'با این لغت‌ها ازم سؤال بپرس']
    : ['Which words in this topic matter most?', 'Quiz me on these words'];
  return askmFa()
    ? ['امروز چی تمرین کنم؟', 'اشتباه‌های اخیرم رو با هم مرور کنیم', 'یه جمله می‌نویسم، درستش کن']
    : ['What should I practise today?', 'Go over my recent mistakes with me', 'I\'ll write a sentence, correct it'];
}

function askmBuild() {
  var el = document.getElementById('askm');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'askm';
  el.className = 'askm';
  el.hidden = true;
  el.setAttribute('data-fa-skip', '');
  el.innerHTML =
    '<div class="askm-backdrop" data-askm-close></div>' +
    '<section class="askm-panel" role="dialog" aria-modal="true" aria-labelledby="askm-title">' +
      '<header class="askm-head">' +
        '<img class="askm-ava" src="/media/ask-muse/atish-face.webp" alt="" width="40" height="40">' +
        '<div class="askm-head-t"><h2 id="askm-title"></h2><p class="askm-quota" id="askm-quota"></p></div>' +
        '<button type="button" class="askm-ibtn" id="askm-new"></button>' +
        '<button type="button" class="askm-ibtn" data-askm-close id="askm-x"><span aria-hidden="true">✕</span></button>' +
      '</header>' +
      '<div class="askm-list" id="askm-list" aria-live="polite"></div>' +
      '<div class="askm-chips" id="askm-chips"></div>' +
      '<form class="askm-form" id="askm-form">' +
        '<textarea id="askm-in" rows="1" maxlength="800" dir="auto" enterkeyhint="send"></textarea>' +
        '<button type="submit" class="askm-send" id="askm-send"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
          '<path d="M4 12h13M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</form>' +
      '<p class="askm-note" id="askm-note"></p>' +
    '</section>';
  document.body.appendChild(el);
  el.addEventListener('click', function (e) {
    if (e.target.closest('[data-askm-close]')) { askmClose(); return; }
    var chip = e.target.closest('[data-askm-chip]');
    if (chip) { askmSend(chip.getAttribute('data-askm-chip')); return; }
    var lk = e.target.closest('[data-askm-go]');
    if (lk) {
      var k = lk.getAttribute('data-askm-go'), a = lk.getAttribute('data-askm-arg') || undefined;
      trackEvent('ask_muse_link', { kind: k, arg: a || '' });
      askmClose();
      go(k, a);
      return;
    }
    if (e.target.closest('#askm-new')) { askmNewChat(); return; }
    var rt = e.target.closest('[data-askm-retry]');
    if (rt) { askmSend(rt.getAttribute('data-askm-retry')); return; }
    if (e.target.closest('[data-askm-upgrade]')) { askmUpgrade(); return; }
  });
  el.querySelector('#askm-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var ta = document.getElementById('askm-in');
    askmSend(ta.value);
  });
  var ta = el.querySelector('#askm-in');
  ta.addEventListener('input', askmGrow);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      askmSend(ta.value);
    }
  });
  el.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); askmClose(); }
    if (e.key === 'Tab') {   /* keep focus inside the dialog */
      var f = Array.prototype.filter.call(el.querySelectorAll('button, textarea'), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  return el;
}

function askmGrow() {
  var ta = document.getElementById('askm-in');
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

function askmLabels() {
  var fa = askmFa();
  var el = document.getElementById('askm');
  el.setAttribute('dir', fa ? 'rtl' : 'ltr');
  el.setAttribute('lang', fa ? 'fa' : 'en');
  el.querySelector('#askm-title').textContent = askmT('از Muse بپرس', 'Ask Muse');
  var nb = el.querySelector('#askm-new');
  nb.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  nb.setAttribute('aria-label', askmT('گفتگوی تازه', 'New chat'));
  nb.title = askmT('گفتگوی تازه', 'New chat');
  el.querySelector('#askm-x').setAttribute('aria-label', askmT('بستن', 'Close'));
  el.querySelector('#askm-in').placeholder = askmT('سؤالت رو بنویس…', 'Type your question…');
  el.querySelector('#askm-send').setAttribute('aria-label', askmT('ارسال', 'Send'));
  el.querySelector('#askm-note').textContent = askmT('Muse هوش مصنوعیه و ممکنه اشتباه کنه. گفتگوها توی حسابت ذخیره میشن.',
    'Muse is an AI and can make mistakes. Chats are saved in your account.');
}

function askMuseOpen(opts) {
  opts = opts || {};
  var el = askmBuild();
  askmLabels();
  ASKM.ctx = opts.ctx || askmContext();
  ASKM.lastFocus = document.activeElement;
  el.hidden = false;
  document.documentElement.classList.add('askm-on');
  requestAnimationFrame(function () { el.classList.add('open'); });
  ASKM.open = true;
  askmLoadLinks().then(function () { askmRender(); });
  askmRender();
  if (!ASKM.loaded) askmLoadToday().then(function () { if (opts.send) askmSend(opts.send); });
  else if (opts.send) askmSend(opts.send);
  if (!opts.send && window.matchMedia('(pointer: fine)').matches) setTimeout(function () { var t = document.getElementById('askm-in'); if (t) t.focus(); }, 60);
  else setTimeout(function () { var x = document.getElementById('askm-x'); if (x) x.focus({ preventScroll: true }); }, 60);
  trackEvent('ask_muse_open', { view: state.view, why: !!(ASKM.ctx && ASKM.ctx.q) });
}

function askmClose() {
  var el = document.getElementById('askm');
  if (!el) return;
  el.classList.remove('open');
  document.documentElement.classList.remove('askm-on');
  ASKM.open = false;
  setTimeout(function () { if (!ASKM.open) el.hidden = true; }, 220);
  try { if (ASKM.lastFocus && ASKM.lastFocus.focus) ASKM.lastFocus.focus({ preventScroll: true }); } catch (e) {}
}

async function askmToken() {
  try {
    if (!sb) return '';
    var r = await sb.auth.getSession();
    return (r && r.data && r.data.session && r.data.session.access_token) || '';
  } catch (e) { return ''; }
}

async function askmLoadToday() {
  ASKM.loaded = true;
  if (!sb || !state.user || state.user.demo) { askmRender(); return; }
  try {
    var r = await sb.rpc('ai_chat_today');
    var d = r && r.data;
    if (d && d.ok) {
      ASKM.quota = { used: d.used, limit: d.limit, remaining: d.remaining, vip: !!d.vip };
      if (!ASKM.fresh) ASKM.msgs = (d.messages || []).map(function (m) { return { role: m.role, text: m.body }; });
    }
  } catch (e) {}
  askmRender();
}

function askmNewChat() {
  if (ASKM.busy) return;
  ASKM.msgs = [];
  ASKM.fresh = true;
  ASKM.ctx = askmContext();
  askmRender();
  var t = document.getElementById('askm-in');
  if (t) t.focus();
}

function askmQuotaText() {
  var q = ASKM.quota;
  if (!q) return askmT('معلم زبان تو، همیشه در دسترس', 'Your English tutor, any time');
  return askmFa()
    ? askmNum(q.remaining) + ' سؤال از ' + askmNum(q.limit) + ' سؤال امروز مونده'
    : q.remaining + ' of ' + q.limit + ' questions left today';
}

function askmGreeting() {
  var n = (state.user && state.user.displayName) ? String(state.user.displayName).split(/\s+/)[0] : '';
  var ctx = ASKM.ctx || {};
  var where = '';
  if (ctx.q) where = askmT('دیدم این سؤال رو اشتباه زدی. بیا با هم ببینیم چرا.', 'I saw you missed that one. Let\'s see why.');
  else if (ctx.view === 'lesson') where = askmT('درباره‌ی درس امروز هر سؤالی داری بپرس.', 'Ask me anything about today\'s lesson.');
  else if (ctx.view === 'grammar' && ctx.slug) where = askmT('درباره‌ی همین مبحث گرامر هر سؤالی داری بپرس.', 'Ask me anything about this grammar topic.');
  return askmFa()
    ? 'سلام' + (n ? ' ' + n : '') + '! من Muse هستم 👋\nمعلم زبانت توی اپ. معنی لغت، گرامر، تلفظ، یا اینکه جمله‌ات درسته یا نه، هر چی بخوای بپرس.' + (where ? '\n' + where : '')
    : 'Hi' + (n ? ' ' + n : '') + '! I\'m Muse 👋\nYour English tutor in the app. Ask about a word, grammar, pronunciation, or whether your sentence is right.' + (where ? '\n' + where : '');
}

function askmLimitHTML() {
  var q = ASKM.quota || {};
  var vip = !!q.vip;
  var head = askmFa()
    ? (vip ? 'سؤال‌های امروزت تموم شد.' : askmNum(q.limit || 10) + ' سؤال امروزت تموم شد.')
    : (vip ? 'You\'ve used today\'s questions.' : 'You\'ve used your ' + (q.limit || 10) + ' questions for today.');
  var body = vip
    ? askmT('فردا دوباره می‌تونی بپرسی.', 'You can ask again tomorrow.')
    : askmT('برای سؤال‌های بیشتر باید حسابت رو ارتقا بدی و VIP بشی. فردا هم دوباره ۱۰ سؤال تازه داری.',
            'To ask more, upgrade your account to VIP. You also get 10 new questions tomorrow.');
  return '<div class="askm-limit"><b>' + esc(head) + '</b><p>' + esc(body) + '</p>' +
    (vip ? '' : '<button type="button" class="askm-upgrade" data-askm-upgrade>⭐ ' + esc(askmT('درخواست ارتقای حساب', 'Ask to upgrade my account')) + '</button>') +
    '</div>';
}

function askmUpgrade() {
  trackEvent('ask_muse_upgrade', {});
  askmClose();
  go('support');
  var text = askmT('سلام، می‌خوام حسابم رو VIP کنم تا بتونم بیشتر از Muse سؤال بپرسم.',
                   'Hi, I\'d like to upgrade my account to VIP so I can ask Muse more questions.');
  var tries = 0;
  (function fill() {
    var ta = document.getElementById('sup-input');
    if (ta) { if (!ta.value) ta.value = text; ta.focus(); return; }
    if (++tries < 30) setTimeout(fill, 100);
  })();
}

function askmRender() {
  var el = document.getElementById('askm');
  if (!el || el.hidden) return;
  var list = el.querySelector('#askm-list');
  var html = '<div class="askm-msg muse">' + askmFmt(askmGreeting()) + '</div>';
  ASKM.msgs.forEach(function (m, i) {
    if (m.role === 'user') {
      html += '<div class="askm-msg me"><p dir="auto">' + esc(m.text) + '</p></div>';
    } else if (m.role === 'assistant') {
      var typing = m.streaming && !m.text;
      html += '<div class="askm-msg muse' + (typing ? ' typing' : '') + '">' +
        (typing ? '<span class="askm-dots" aria-label="' + esc(askmT('در حال نوشتن', 'Typing')) + '"><i></i><i></i><i></i></span>'
                : askmFmt(m.text, m.streaming)) + '</div>';
    } else if (m.role === 'error') {
      html += '<div class="askm-msg muse err"><p>' + esc(m.text) + '</p>' +
        (m.retry ? '<button type="button" class="askm-retry" data-askm-retry="' + esc(m.retry) + '">' + esc(askmT('دوباره بفرست', 'Try again')) + '</button>' : '') + '</div>';
    } else if (m.role === 'limit') {
      html += askmLimitHTML();
    }
  });
  list.innerHTML = html;
  list.setAttribute('aria-busy', ASKM.busy ? 'true' : 'false');
  list.scrollTop = list.scrollHeight;
  el.querySelector('#askm-quota').textContent = askmQuotaText();
  var out = ASKM.quota && ASKM.quota.remaining <= 0;
  var chips = el.querySelector('#askm-chips');
  var showChips = !ASKM.busy && !out && !ASKM.msgs.some(function (m) { return m.role === 'user'; });
  chips.innerHTML = showChips ? askmChips(ASKM.ctx).map(function (c) {
    return '<button type="button" class="askm-chip" data-askm-chip="' + esc(c) + '" dir="auto">' + esc(c) + '</button>';
  }).join('') : '';
  chips.hidden = !showChips;
  var ta = el.querySelector('#askm-in'), send = el.querySelector('#askm-send');
  ta.disabled = !!out;
  send.disabled = ASKM.busy || !!out;
  if (out && !ASKM.msgs.some(function (m) { return m.role === 'limit'; })) {
    list.insertAdjacentHTML('beforeend', askmLimitHTML());
    list.scrollTop = list.scrollHeight;
  }
}

async function askmSend(text) {
  text = String(text || '').trim();
  if (!text || ASKM.busy) return;
  if (text.length > 800) text = text.slice(0, 800);
  var ta = document.getElementById('askm-in');
  if (ta) { ta.value = ''; askmGrow(); }
  ASKM.msgs = ASKM.msgs.filter(function (m) { return m.role !== 'error'; });
  ASKM.msgs.push({ role: 'user', text: text });
  var ans = { role: 'assistant', text: '', streaming: true };
  ASKM.msgs.push(ans);
  ASKM.busy = true;
  askmRender();
  var ctx = ASKM.ctx || askmContext();
  trackEvent('ask_muse_send', { view: ctx.view, why: !!ctx.q });
  var fail = function (msg, retry) {
    ASKM.msgs = ASKM.msgs.filter(function (m) { return m !== ans; });
    if (retry) ASKM.msgs = ASKM.msgs.filter(function (m, i, a) { return !(m.role === 'user' && m.text === text && i === a.length - 1); });
    ASKM.msgs.push({ role: 'error', text: msg, retry: retry ? text : '' });
  };
  try {
    var token = await askmToken();
    var res = await fetch('/api/assistant', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify({ message: text, context: ctx, newThread: ASKM.fresh, lang: askmFa() ? 'fa' : 'en' }),
    });
    if (res.status === 429) {
      var j = await res.json().catch(function () { return {}; });
      if (j.error === 'limit') {
        ASKM.quota = { used: j.used, limit: j.limit, remaining: 0, vip: !!j.vip };
        ASKM.msgs = ASKM.msgs.filter(function (m) { return m !== ans; });
        ASKM.msgs.pop();
        ASKM.msgs.push({ role: 'limit' });
        trackEvent('ask_muse_limit', { vip: !!j.vip });
      } else {
        fail(askmT('یه کم صبر کن و دوباره بپرس.', 'Please wait a moment and ask again.'), true);
      }
    } else if (res.status === 401) {
      fail(askmT('برای پرسیدن از Muse باید وارد حسابت بشی.', 'Please sign in to ask Muse.'), false);
    } else if (!res.ok || !res.body) {
      fail(askmT('الان نتونستم جواب بدم. این سؤال حساب نشد؛ دوباره امتحان کن.', 'I couldn\'t answer just now. This question wasn\'t counted. Try again.'), true);
    } else {
      ASKM.fresh = false;
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', ended = false, last = 0;
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var parts = buf.split('\n\n');
        buf = parts.pop();
        parts.forEach(function (p) {
          var line = p.trim();
          if (line.indexOf('data:') !== 0) return;
          var ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { return; }
          if (ev.type === 'start') {
            ASKM.quota = { used: (ev.limit || 0) - (ev.remaining || 0), limit: ev.limit, remaining: ev.remaining,
              vip: ASKM.quota ? ASKM.quota.vip : false };
          } else if (ev.type === 'delta') {
            ans.text += ev.t || '';
          } else if (ev.type === 'done') {
            ended = true;
          } else if (ev.type === 'error') {
            ended = true;
            fail(askmT('الان نتونستم جواب بدم. این سؤال حساب نشد؛ دوباره امتحان کن.', 'I couldn\'t answer just now. This question wasn\'t counted. Try again.'), true);
            if (ASKM.quota) ASKM.quota.remaining++;
          }
        });
        var now = Date.now();
        if (now - last > 60) { last = now; askmRender(); }
      }
      ans.streaming = false;
      if (!ended && !ans.text) fail(askmT('ارتباط قطع شد. دوباره امتحان کن.', 'The connection dropped. Try again.'), true);
    }
  } catch (e) {
    ans.streaming = false;
    if (!ans.text) fail(askmT('اینترنتت قطع شده یا ضعیفه. دوباره امتحان کن.', 'You seem to be offline. Try again.'), true);
  }
  ans.streaming = false;
  ASKM.busy = false;
  askmRender();
}

/* the "why" button lives inside quiz screens (not in #askm), so it gets its own listener */
document.addEventListener('click', function (e) {
  var w = e.target && e.target.closest && e.target.closest('[data-askm-why]');
  if (w) { e.preventDefault(); askMuseWhy(); }
});
window.addEventListener('hashchange', function () { if (ASKM.open) askmClose(); });
