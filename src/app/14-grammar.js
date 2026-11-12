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
  Promise.all([needAll ? loadAllGrammar() : loadGrammarLevel(f.level), gFaIndex()]).then(function (res) {
    var topics = res[0];
    var prog = grammarProgress();
    var q = (f.q || '').toLowerCase();
    var list = topics.filter(function (t) {
      if (f.level !== 'all' && t.level !== f.level) return false;
      if (q && (t.h1 || '').toLowerCase().indexOf(q) === -1 && gFaTitle(t.slug).indexOf(f.q) === -1) return false;
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
  else status = '<span class="gh-status">\uD83D\uDCC4 10 exercises per level</span>';
  return '<a class="gh-card" href="#/grammar/' + esc(t.slug) + '">' +
    '<span class="gh-ico"><img src="' + ghIconSrc(t.slug) + '" alt="" loading="lazy"></span>' +
    '<span class="gh-card-main"><span class="gh-titlerow">' + ghLvBadge(t.level) +
      (gFaTitle(t.slug) ? '<b dir="rtl" lang="fa" class="gh-fa-t">' + esc(gFaTitle(t.slug)) + '</b>' : '<b>' + esc(t.h1) + '</b>') + '</span>' +
      (gFaTitle(t.slug) ? '<span class="gh-en-t" dir="ltr">' + esc(t.h1) + '</span>' : '') + status + '</span>' +
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
    if (t.v2) {
      Promise.all([gFaLoad(t.slug), gFaIndex()]).then(function () { renderGrammarTopicV3(v, t); });
      return;
    }
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
  grammarAllItems(t).forEach(function (ex) {
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
      '<p class="g2-practice-note">' + Math.min(exs.length, 10) + ' exercises</p>' +
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
  grammarAllItems(t).forEach(function (ex) {
    var lv = (ex.level || '').toLowerCase();
    (exByLevel[lv] = exByLevel[lv] || []).push(ex);
  });
  var FA = _gFa[t.slug] || null;
  var faLv = FA ? FA.lv : [];
  function faPoint(p, lv) {
    var P = (FA.p && FA.p[p.id]) || {};
    var examples = (p.examples || []).map(function (e, k) {
      var n = P.n && P.n[k];
      return '<li><div class="g-ex-text">' + gMd(e.text) + '</div>' +
        (e.note ? (n ? '<div class="g-ex-note" dir="rtl" lang="fa">' + n + '</div>' : '<div class="g-ex-note">' + gMd(e.note) + '</div>') : '') + '</li>';
    }).join('');
    var mistakes = (p.mistakes || []).map(function (m, k) {
      var w = P.w && P.w[k];
      return '<div class="g-mistake"><div class="g-mline bad">❌ ' + gMd(m.wrong) + '</div>' +
        '<div class="g-mline good">✅ ' + gMd(m.right) + '</div>' +
        (m.why ? (w ? '<div class="g-mwhy" dir="rtl" lang="fa">' + w + '</div>' : '<div class="g-mwhy">' + gMd(m.why) + '</div>') : '') + '</div>';
    }).join('');
    var body = grammarBlocksHTMLFa(p.blocks, P.b) +
      (examples ? '<ol class="g-examples" dir="ltr">' + examples + '</ol>' : '') +
      (mistakes ? '<div class="g2-mistakes" dir="ltr"><div class="g2-mtitle" dir="rtl" lang="fa">اشتباه‌های رایج</div>' + mistakes + '</div>' : '');
    return '<div class="gt3-point">' +
      '<h3 id="' + esc(p.id) + '">' + (P.t || '<span dir="ltr">' + esc(p.title) + '</span>') + ' <span class="gh-lv">' + lv.toUpperCase() + '</span></h3>' +
      (p.summary ? '<div class="gt3-quick"><div class="gt3-quick-tag"><svg class="gt3-bolt" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.8 22 19 10h-6.5L13 2z" fill="currentColor"/></svg> قاعده در ۱۰ ثانیه</div><div class="gt3-quick-body"' + (P.s ? '' : ' dir="ltr"') + '>' + (P.s || gMd(p.summary)) + '</div></div>' : '') +
      (body ? '<button class="gt3-more" type="button" data-show="مثال‌ها و جزئیات" data-hide="بستن مثال‌ها و جزئیات">مثال‌ها و جزئیات <span class="gt3-chev">›</span></button>' +
        '<div class="gt3-body">' + body + '</div>' : '') +
      '</div>';
  }
  var sections = levels.map(function (lv) {
    var grad = GH_LV_GRAD[lv] || GH_LV_GRAD.all;
    var fa = faLv.indexOf(lv) !== -1;
    var pts = (byLevel[lv] || []).map(function (p) {
      if (fa) return faPoint(p, lv);
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
    var nEx = Math.min(exs.length, 10);
    var practice = !exs.length ? '' : fa
      ? '<div class="gt3-practice"><div class="gt3-practice-t">آماده‌ای تمرین کنی؟</div>' +
        '<p class="gt3-practice-n">' + nEx + ' تمرین برای سطح <bdi>' + lv.toUpperCase() + '</bdi></p>' +
        '<button class="btn btn-primary g-start" data-g2quiz="' + lv + '">شروع تمرین‌های <bdi>' + lv.toUpperCase() + '</bdi></button></div>'
      : '<div class="gt3-practice"><div class="gt3-practice-t">Ready to practise?</div>' +
        '<p class="gt3-practice-n">' + nEx + ' exercises for ' + lv.toUpperCase() + '</p>' +
        '<button class="btn btn-primary g-start" data-g2quiz="' + lv + '">Start ' + lv.toUpperCase() + ' exercises →</button></div>';
    return '<section class="gt3-sec' + (fa ? ' gt3-fa" dir="rtl" lang="fa' : '') + '" id="g2-' + lv + '" style="--lv:' + (GH_LV_COLORS[lv] || '#8A93A6') + '">' +
      '<div class="gt3-sec-head"><span class="gt3-lv-badge" dir="ltr" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' + lv.toUpperCase() + '</span>' +
      '<h2>' + (fa ? esc((FA.lvfa && FA.lvfa[lv]) || '') : (TW_LEVEL_LABEL[lv] || lv.toUpperCase())) + '</h2></div>' +
      '<div class="g-fa-audio" data-fa-lv="' + lv + '"></div>' +
      '<div class="g-en-audio" data-en-lv="' + lv + '"></div>' +
      pts + practice + '</section>';
  }).join('');
  var intro = (FA && FA.intro)
    ? '<div class="g-intro g-intro-fa" dir="rtl" lang="fa">' + FA.intro.map(function (p) { return '<p>' + p + '</p>'; }).join('') + '</div>'
    : '<div class="g-intro">' + (t.intro || []).map(function (p) { return '<p>' + gMd(p) + '</p>'; }).join('') + '</div>';
  var faT = faLv.length ? gFaTitle(t.slug) : '';
  v.innerHTML = '<div class="g-topic gt3-topic">' +
    '<a class="g-back" href="#/grammar">‹ ' + (faT ? '<span class="g-back-fa" lang="fa">همهٔ راهنماها</span>' : 'All guides') + '</a>' +
    '<div class="g-hero">' + (faT ? '<h1 dir="rtl" lang="fa" class="g-h1-fa">' + esc(faT) + '</h1><div class="g-h1-en" dir="ltr">' + esc(t.h1) + '</div>'
      : '<h1>' + esc(t.h1) + '</h1>') + '</div>' +
    bar + intro + sections + '</div>';
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
      btn.firstChild.textContent = (open ? (btn.getAttribute('data-hide') || 'Hide examples & details') : (btn.getAttribute('data-show') || 'Show examples & details')) + ' ';
    });
  });
  paintFaAudioBars(v, t.slug);
  paintEnAudioBars(v, t.slug);
  window.scrollTo(0, 0);
}

/* v2 quiz: per-level exercises, supports mcq / gap / error types.
   Pool = site + bank exercises for the level (bank released 2026-11-01,
   Alireza's order); each run is capped at 10 questions (his order). */
function startGrammarQuizV2(topic, level) {
  var items = grammarAllItems(topic).filter(function (ex) {
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
    items: shuffleArr(items).slice(0, 10)
  };
  state.gquiz.items.forEach(function (it) { delete it.typed; });
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
  var F = gFaFor(q.topic.slug, q.v2level);
  
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
    inputHTML = '<div class="gt-gap-wrap"><input type="text" id="g2-gap-input" class="gt-gap-input" dir="ltr" ' +
      'placeholder="' + (F ? 'جواب را بنویسید' : 'Type your answer') + '" ' + (q.answered ? 'disabled' : '') + ' value="' + esc(it.typed || '') + '">' +
      (q.answered ? '' : '<button class="gt-btn gt-btn-green" id="g2-gap-check">' + (F ? 'بررسی' : 'CHECK') + '</button>') + '</div>';
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
    var fx = F && F.x ? F.x[it.id] : null;
    sheet = '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
      (F ? '<div class="gt-sheet-msg" dir="rtl" lang="fa">' + (good ? '🎉 درست است!' : '💡 جواب درست: <b dir="ltr">' + correctText + '</b>') + '</div>'
         : '<div class="gt-sheet-msg">' + (good ? '🎉 Correct!' : '💡 Correct answer: <b>' + correctText + '</b>') + '</div>') +
      (fx ? '<div class="gt-sheet-explain" dir="rtl" lang="fa">' + fx + '</div>'
         : (it.explanation ? '<div class="gt-sheet-explain">' + gMd(it.explanation) + '</div>' : '')) +
      '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="g-next-btn">' +
      (F ? (q.idx + 1 >= n ? 'دیدن نتیجه' : 'ادامه') : (q.idx + 1 >= n ? 'SEE RESULTS' : 'CONTINUE')) + '</button>' +
      '</div></div>';
  }
  var qHTML = esc(it.prompt).replace(/___/g, '…');
  if (F && it.type === 'error') qHTML = '<span dir="rtl" lang="fa" class="gt-q-fa">' + F.err + '</span>';
  else if (F && F.q && F.q[it.id]) qHTML = '<span dir="rtl" lang="fa" class="gt-q-fa">' + F.q[it.id] + '</span>';
  
  var barPct = Math.round((q.idx + (q.answered ? 1 : 0)) / n * 100);
  v.innerHTML = '<div class="g-quiz gt-wrap">' +
    '<div class="gt-card"><div class="gt-top"><button class="gt-x" id="g-quiz-quit" aria-label="Back to guide">✕</button>' +
    '<div class="gt-progress"><span style="width:' + barPct + '%"></span></div>' +
    '<div class="gt-qcount">' + (q.idx + 1) + '/' + n + '</div></div>' +
    (q.firstRun ? '' : (F ? '<div class="gt-mode" dir="rtl" lang="fa">حالت تمرین: بدون امتیاز</div>' : '<div class="gt-mode">Practice mode — no points</div>')) +
    '<div class="gt-q">' + qHTML + '</div>' +
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
    it.typed = val;
    var norm = function(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/\.$/, ''); };
    var vnorm = norm(val);
    correct = (it.accept || []).some(function(a) { return norm(a) === vnorm; });
  }
  
  q.correct_flag = correct;
  (q.log = q.log || []).push({ picked: val, correct: correct });
  if (correct) {
    q.correct++;
    if (q.firstRun) awardPoints('grammar_exercise', 5, 'gex-' + it.id);
  } else {
    /* Error-spotting items have no options — their choices ARE the sentence
       segments. Save segments as the review options, or the Review replay
       shows the question with zero choices (bug found 2026-11-01, after the
       bank release made error items common). */
    saveMistake({ date: todayStr(), level: q.v2level, kind: 'grammar', topic: q.topic.slug,
      question: it.prompt, options: it.type === 'error' ? (it.segments || []) : (it.options || []), answer: it.answer, picked: val });
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
  (q.log = q.log || []).push({ picked: i, correct: i === it.answer });
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
  var missedSnap = [];
  (q.items || []).forEach(function (it, i) {
    var lg = (q.log || [])[i];
    if (lg && !lg.correct) {
      if (it.type === 'gap') missedSnap.push({ q: it.prompt, o: [], a: null, p: String(lg.picked), acc: it.accept || [] });
      else missedSnap.push({ q: it.prompt, o: it.type === 'error' ? (it.segments || []) : (it.options || []), a: it.answer, p: lg.picked });
    }
  });
  saveAttempt({ kind: 'grammar_topic', theme: slug, level: topic.level, score: correct, total: total, date: todayStr(), missed: missedSnap.length ? missedSnap.slice(0, 30) : undefined });
  state.gquiz = null;
  document.body.classList.remove('duo-playing');
  var v = document.getElementById('view');
  var F = q.v2 ? gFaFor(slug, q.v2level) : null;
  var L = F ? ['عالی بود!', 'آفرین!', 'تلاش خوبی بود!', 'باز هم تمرین کن!', '۲۰ امتیاز جایزهٔ تمام کردن گرفتی!', 'دوباره', '📖 برگشت به این راهنما', 'همهٔ راهنماها']
    : ['Perfect!', 'Great job!', 'Good effort!', 'Keep practising!', '+20 completion bonus earned!', 'TRY AGAIN', '📖 Back to this guide', 'All guides'];
  var msg = correct === total ? L[0]
    : correct >= total * 0.7 ? L[1]
    : correct >= total * 0.4 ? L[2]
    : L[3];
  var mascot = correct === total ? '🏆' : correct >= total * 0.7 ? '🎉' : '📝';
  var sub = F && gFaTitle(slug) ? '<p class="gt-sub" dir="rtl" lang="fa">' + esc(gFaTitle(slug)) + '</p>' : '<p class="gt-sub">' + esc(topic.h1) + '</p>';
  v.innerHTML = '<div class="g-quiz gt-wrap"><div class="gt-report"' + (F ? ' dir="rtl" lang="fa"' : '') + '>' +
    '<div class="gt-mascot">' + mascot + '</div>' +
    '<h1>' + msg + '</h1>' +
    '<div class="gt-score" dir="ltr"><b>' + correct + '</b><span>/' + total + '</span></div>' +
    sub +
    (bonus ? '<p class="g-xp-note">' + L[4] + '</p>' : '') +
    '<div class="gt-end-btns"><button class="gt-btn gt-btn-green gt-btn-big" id="g-retry-btn">' + L[5] + '</button>' +
    '<button class="gt-btn gt-btn-ghost" id="g-back-btn">' + L[6] + '</button>' +
    '<a class="gt-btn gt-btn-ghost" href="#/grammar">' + L[7] + '</a></div>' +
    '</div></div>';
  document.getElementById('g-retry-btn').addEventListener('click', function () {
    if (q.v2) startGrammarQuizV2(topic, q.v2level);
    else startGrammarQuiz(topic);
  });
  document.getElementById('g-back-btn').addEventListener('click', function () { go('grammar', slug); });
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
      /* Site exercises only, as before the bank release — and strictly the
         ones this MCQ renderer can show: a real options list and a numeric
         answer. Gap items (options: [], answer: null, accept: [...]) pass a
         plain use!=='bank' filter and render as a dead-end question with no
         way to answer (the 2026-11-01 "The baby ___ (cry)" bug). */
      var siteItems = ((t.exercises || {}).items || []).filter(function (ex) {
        return ex.use !== 'bank' && (ex.options || []).length >= 2 &&
          typeof ex.answer === 'number' && ex.answer >= 0 && ex.answer < ex.options.length;
      });
      return { topic: t, items: shuffleArr(siteItems.slice()) };
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
  /* Safety net: never strand the student on an unanswerable question. */
  if (!it.options || it.options.length < 2) {
    if (q.idx + 1 >= q.items.length) { finishGTest(false); return; }
    q.idx++;
    renderGTestQ();
    return;
  }
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
      question: it.prompt, options: it.type === 'error' ? (it.segments || []) : (it.options || []), answer: it.answer, picked: i });
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
  /* Keep every run (newest first) so Progress can show the full history
     and the score trend — not just the latest report. */
  store.history = [report].concat((store.history || []).filter(function (r) { return r.ts !== report.ts; })).slice(0, 12);
  setGTestStore(store);
  var missedSnap = [];
  q.items.forEach(function (cur, idx) {
    var r = q.results[idx];
    if (r && !r.ok) missedSnap.push({ q: cur.item.prompt, o: cur.item.options, a: cur.item.answer, p: r.picked });
  });
  saveAttempt({ kind: 'grammar_test', theme: 'placement', score: correct, total: total, date: todayStr(), missed: missedSnap.length ? missedSnap.slice(0, 30) : undefined });
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

/* ---------------- grammar check-up on Progress ----------------
   Latest report in full + every past run (date, score) + score trend.
   Detail (per-level bars, weak spots) lives in the local store; the
   date+score history is merged with the cloud quiz_attempts rows
   (kind='grammar_test') so tests taken on another device still appear. */

function gtestDateStr(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function gtestFmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function gtestEntries(cloudRows) {
  var store = getGTestStore();
  var local = (store.history && store.history.length) ? store.history.slice()
    : (store.last ? [store.last] : []);
  var seen = {};
  var out = local.map(function (r) {
    seen[gtestDateStr(r.ts) + '|' + r.correct + '|' + r.total] = 1;
    return { ts: r.ts, correct: r.correct, total: r.total, timeUp: r.timeUp, perLevel: r.perLevel, weak: r.weak };
  });
  (cloudRows || []).forEach(function (row) {
    var ts = row.created_at ? new Date(row.created_at).getTime()
      : new Date((row.date || '') + 'T12:00:00').getTime();
    if (!ts || isNaN(ts)) return;
    var key = (row.date || gtestDateStr(ts)) + '|' + row.score + '|' + row.total;
    if (seen[key]) return;
    seen[key] = 1;
    out.push({ ts: ts, correct: row.score, total: row.total, cloudOnly: true });
  });
  out.sort(function (a, b) { return b.ts - a.ts; });
  return out.slice(0, 12);
}
function gtestProgressCardHTML(entries) {
  if (!entries.length) {
    return '<div class="card plain"><p style="margin:0 0 0.7rem">Find your weak spots with a quick 30-question grammar check-up (A1–C1). Your results will live here.</p>' +
      '<a class="btn btn-primary" href="#/grammar-test">🎯 Start the check-up</a></div>';
  }
  var last = entries[0];
  var pct = last.total ? Math.round((last.correct / last.total) * 100) : 0;
  var html = '<div class="card plain gt-prog">';
  html += '<div class="gt-prog-top"><div><div class="gt-prog-score"><b>' + last.correct + '</b><span>/' + last.total + ' correct · ' + pct + '%</span></div>' +
    '<div class="muted">🗓 ' + gtestFmtDate(last.ts) + (last.timeUp ? ' · ⏰ time ran out' : '') +
    (entries.length > 1 ? ' · test #' + entries.length : '') + '</div></div>' +
    '<div class="gt-prog-btns">' +
    (last.perLevel ? '<a class="btn btn-sm" href="#/grammar-test/report">Full report</a>' : '') +
    '<a class="btn btn-sm btn-primary" href="#/grammar-test">Retake</a></div></div>';
  if (last.perLevel) {
    html += '<div class="gt-levels" style="margin-top:0.9rem">' + last.perLevel.map(function (p) {
      var lp = p.t ? Math.round(p.c / p.t * 100) : 0;
      return '<div class="gt-level-row"><span class="g-lv g-lv-' + p.lv + '">' + p.lv.toUpperCase() + '</span>' +
        '<div class="gt-level-bar"><span style="width:' + lp + '%"></span></div>' +
        '<span class="gt-level-num">' + p.c + '/' + p.t + '</span></div>';
    }).join('') + '</div>';
  }
  if (last.weak && last.weak.length) {
    html += '<div class="gt-prog-weak"><b>🎯 Focus on:</b> ' + last.weak.slice(0, 3).map(function (w) {
      return '<a class="gt-weak-chip" href="#/grammar/' + esc(w.slug) + '">' + esc(w.h1) + ' · ' + w.wrong + ' missed</a>';
    }).join('') + (last.weak.length > 3 ? '<span class="muted">+' + (last.weak.length - 3) + ' more in the full report</span>' : '') + '</div>';
  }
  if (entries.length >= 2) {
    var pts = entries.slice().reverse().map(function (e) {
      return { label: gtestFmtDate(e.ts).replace(/, \d{4}$/, ''), pct: e.total ? Math.round((e.correct / e.total) * 100) : 0 };
    });
    html += '<div class="an-title" style="margin-top:1rem">📈 Score trend</div>' + trendChartHTML(pts);
    html += '<div class="gt-hist">' + entries.map(function (e) {
      var p2 = e.total ? Math.round((e.correct / e.total) * 100) : 0;
      return '<div class="gt-hist-row"><span>🗓 ' + gtestFmtDate(e.ts) + '</span>' +
        '<span class="gt-hist-score">' + e.correct + '/' + e.total + ' · ' + p2 + '%' + '</span>' +
        '<span class="muted">' + (e.weak ? e.weak.length + ' weak spot' + (e.weak.length === 1 ? '' : 's') : (e.cloudOnly ? 'taken on another device' : '')) + '</span></div>';
    }).join('') + '</div>';
  }
  return html + '</div>';
}
async function loadGTestProgress() {
  var host = document.getElementById('gt-progress-card');
  if (!host || !cloudReady() || !state.user) return;
  try {
    var q = await sb.from('quiz_attempts').select('date,score,total,created_at')
      .eq('user_id', state.user.id).eq('kind', 'grammar_test')
      .order('created_at', { ascending: false }).limit(24);
    if (q.error) throw q.error;
    if (!document.getElementById('gt-progress-card')) return;
    host.innerHTML = gtestProgressCardHTML(gtestEntries(q.data || []));
  } catch (e) { /* keep the local paint */ }
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

