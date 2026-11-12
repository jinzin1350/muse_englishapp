/* ---------------- HOME dashboard ---------------- */
function todayCardHTML(m) {
  const p = getDayProgress(m.date);
  const done = dayDoneCount(m.date);
  const pct = Math.round((done / stepsForLesson(m).length) * 100);
  const ns = nextStep(m.date);
  const isToday = m.date === todayStr();

  const stepsHTML = stepsForLesson(m).map(function (s, i) {
    const isDone = !!p[s];
    const isNext = !isDone && s === ns;
    const cls = isDone ? 'done' : (isNext ? 'next' : 'todo');
    const mark = isDone ? '✓' : String(i + 1);
    return '<li class="' + cls + '">' +
      '<button class="today-step-btn" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + s + '" aria-label="Go to ' + STEP_LABELS[s] + '">' +
      '<span class="st-ck" aria-hidden="true">' + mark + '</span>' +
      '<span class="st-name">' + STEP_LABELS[s] + '</span>' +
      (isNext ? '<span class="st-pill">CONTINUE</span>' : '') +
      '<span class="st-go" aria-hidden="true">›</span>' +
      '</button></li>';
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
        (m.review ? ' <span class="badge-level" style="background:rgba(46,134,193,.14);color:#2E86C1">🔁 Review day</span>' : '') +
      '</div>' +
    '</div>' +
    '<ul class="today-steps" aria-label="Lesson steps">' + stepsHTML + '</ul>' +
    '<div class="today-progress">' +
      '<div class="tp-label"><span>Daily progress</span><span>' + done + ' of ' + stepsForLesson(m).length + ' steps</span></div>' +
      '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Daily progress"><div style="width:' + pct + '%"></div></div>' +
    '</div>' +
    '<button class="btn btn-block" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + tabFor + '">' + esc(cta) + '</button>' +
    '<p class="muted" style="margin:0.5rem 0 0;text-align:center">' + esc(ctaSub) + '</p>' +
  '</section>';
}

/* ---------------- HOME v5 (mockup rebuild, 2026-10-02) ---------------- */
const HOME_STEP_ORDER = ['words', 'podcast', 'shadowing', 'grammar', 'quiz'];
const HOME_STEP_STYLE = {
  words:     { icon: 'book',       bg: '#22C55E' },
  podcast:   { icon: 'mic',        bg: '#8B5CF6' },
  shadowing: { icon: 'headphones', bg: '#F59E0B' },
  grammar:   { icon: 'doc',        bg: '#EF4444' },
  quiz:      { icon: 'trophy',     bg: '#3B82F6' },
};

/* Streak banner v2 (2026-10-09): cream illustrated card after Alireza's mockup.
   The day count is dynamic HTML from the streak state (DB-synced), never baked in. */
function streakBannerHTML(st, dates) {
  st = st || {};
  const n = st.current_streak || 0;
  const sub = n > 0 ? 'Keep going! Learn a little every day ❤️' : 'Finish a lesson to ignite it 🔥';
  /* Desktop keeps the old artwork-style banner. */
  if (typeof isDesktop === 'function' && isDesktop()) {
    const numline = '<b>' + n + '</b>&nbsp;' + (n === 1 ? 'day!' : 'days!');
    return '<a class="stk-link" href="#/scores"' + (_faOn ? '' : ' dir=\'ltr\' lang=\'en\'') + ' aria-label="View your progress">' +
      '<img class="stk-bg" src="/media/home/streak-banner-art.webp" alt="">' +
      '<span class="stk-scrim" aria-hidden="true"></span>' +
      '<span class="stk-txt">' +
        '<span class="stk-kicker">Your streak is</span>' +
        '<span class="stk-num">' + numline + '</span>' +
        '<span class="stk-sub">' + sub + '</span>' +
      '</span>' +
      '<span class="stk-go" aria-hidden="true">›</span>' +
    '</a>';
  }
  /* Mobile: Alireza's 2026-10-20 mockup — big mascot, "Your streak is / N days!". */
  const numline = '<b>' + n + '</b> ' + (n === 1 ? 'day!' : 'days!');
  return '<a class="hm-streak" href="#/scores"' + (_faOn ? '' : ' dir=\'ltr\' lang=\'en\'') + ' aria-label="View your progress">' +
    '<span class="hm-streak-mascot"><img src="/media/home/streak-mascot.webp" alt="Streak mascot"></span>' +
    '<span class="hm-streak-txt">' +
      '<span class="hm-streak-kicker">Your streak is</span>' +
      '<span class="hm-streak-num">' + numline + '</span>' +
      '<span class="hm-streak-sub">' + sub + '</span>' +
    '</span>' +
    '<span class="hm-streak-go" aria-hidden="true">›</span>' +
  '</a>';
}

function lessonBannerHTML(m) {
  const p = getDayProgress(m.date);
  const done = dayDoneCount(m.date);
  const total = HOME_STEP_ORDER.filter(function (x) { return stepsForLesson(m).indexOf(x) >= 0; }).length;
  const pct = Math.round((done / total) * 100);
  const ns = nextStep(m.date);

  const rows = HOME_STEP_ORDER.filter(function (x) { return stepsForLesson(m).indexOf(x) >= 0; }).map(function (s, i) {
    const isDone = !!p[s];
    const isNext = !isDone && s === ns;
    const st = HOME_STEP_STYLE[s];
    const right = isDone
      ? '<span class="h-step-check" aria-hidden="true">✓</span>'
      : (isNext ? '<span class="h-step-pill">CONTINUE <span aria-hidden="true">›</span></span>'
                : '<span class="h-step-go" aria-hidden="true">›</span>');
    return '<li class="h-step' + (isNext ? ' next' : '') + '">' +
      '<button data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + s + '" aria-label="Go to ' + STEP_LABELS[s] + '">' +
      '<span class="h-step-icon" style="background:' + st.bg + '">' + ICO[st.icon] + '</span>' +
      (isNext ? '<span class="h-step-num">' + (i + 1) + '</span>' : '') +
      '<span class="h-step-name">' + STEP_LABELS[s] + '</span>' +
      right +
      '</button></li>';
  }).join('');

  let cta, ctaSub, tabFor;
  if (ns) {
    cta = done > 0 ? 'Continue with ' + STEP_LABELS[ns] : 'Start today\u2019s lesson';
    ctaSub = done > 0 ? 'Pick up where you left off.' : 'Words, podcast, shadowing, grammar and quiz.';
    tabFor = ns;
  } else {
    cta = 'Lesson complete 🎉';
    ctaSub = 'Nice work — come back tomorrow for a new lesson.';
    tabFor = 'words';
  }

  return '' +
  '<section class="h-lesson" aria-label="Today\u2019s lesson">' +
    '<button class="h-lesson-hero" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="words" aria-label="Open today\u2019s lesson"></button>' +
    '<ul class="h-steps">' + rows + '</ul>' +
    '<div class="h-progress">' +
      '<div class="h-progress-top"><span>Daily progress</span><span>' + done + ' of ' + total + ' steps</span></div>' +
      '<div class="h-progress-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="Daily progress"><div style="width:' + pct + '%"></div></div>' +
    '</div>' +
    '<button class="h-cta" data-action="today-cta" data-date="' + esc(m.date) + '" data-tab="' + tabFor + '">' +
      '<span class="h-cta-play" aria-hidden="true">▶</span>' + esc(cta) + ' <span aria-hidden="true">›</span></button>' +
    '<p class="h-cta-sub">' + esc(ctaSub) + '</p>' +
  '</section>';
}

/* ---------------- lessons archive (previous days) ---------------- */
function lessonCover(m) {
  const w = (m.words && m.words[0]) || {};
  return w.photo || '';
}
function fmtDateShort(ds) {
  try {
    const p = String(ds).split('-');
    const d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10), 12);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return ds; }
}
function lessonWordCount(m) { return (m.words && m.words.length) || 0; }

function prevIconFor(theme) {
  const t = String(theme || '').toLowerCase();
  if (/travel|transport|trip|journey|airport|flight|hotel/.test(t)) return '📍';
  if (/money|shop|price|market|food|meal|grocer/.test(t)) return '🛒';
  if (/school|education|study|learn|book|class/.test(t)) return '📖';
  if (/health|doctor|body|sport|fitness/.test(t)) return '💪';
  if (/work|job|office|business|meeting/.test(t)) return '💼';
  return '📚';
}

function prevLessonsHTML(lessons) {
  const older = lessons.slice(1, 7);
  let html = '<section aria-labelledby="prev-h">' +
    '<div class="section-title"><h2 id="prev-h">Previous lessons</h2>' +
    (older.length ? '<a class="btn btn-ghost btn-sm" href="#/lessons">View all</a>' : '') + '</div>';
  if (!older.length) {
    html += '<div class="card plain"><p class="muted" style="margin:0">Yesterday’s lesson will appear here — come back tomorrow for a new one.</p></div>';
  } else {
    html += '<div class="prev-strip">' + older.map(function (m) {
      const cover = lessonCover(m);
      const done = dayDoneCount(m.date);
      const pct = Math.round((done / stepsForLesson(m).length) * 100);
      return '<button class="prev-card v2" data-action="open-lesson" data-date="' + esc(m.date) + '" aria-label="Open lesson ' + esc(m.theme || m.date) + '">' +
        '<span class="pcv-photo">' +
          (cover
            ? '<img src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
            : '<span class="prev-ph" aria-hidden="true">📚</span>') +
          '<span class="pcv-date">' + esc(fmtDateShort(m.date)) + '</span>' +
        '</span>' +
        '<span class="pcv-body">' +
          '<span class="pcv-theme">' + esc(m.theme || 'Lesson') + (m.review ? ' 🔁' : '') + '</span>' +
          '<span class="pcv-row">' +
            '<span class="pcv-bar" role="progressbar" aria-label="Lesson progress" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + stepsForLesson(m).length + '"><span style="width:' + pct + '%"></span></span>' +
            '<span class="pcv-ico" aria-hidden="true">' + prevIconFor(m.theme) + '</span>' +
          '</span>' +
        '</span>' +
      '</button>';
    }).join('') + '</div>';
  }
  return html + '</section>';
}

function archiveCardHTML(m) {
  const cover = lessonCover(m);
  const done = dayDoneCount(m.date);
  const pct = Math.round((done / stepsForLesson(m).length) * 100);
  return '<button class="prev-card v2" data-action="open-lesson" data-date="' + esc(m.date) + '" aria-label="Open lesson ' + esc(m.theme || m.date) + '">' +
    '<span class="pcv-photo">' +
      (cover
        ? '<img src="' + esc(cover) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<span class="prev-ph" aria-hidden="true">📚</span>') +
      '<span class="pcv-date">' + esc(fmtDateShort(m.date)) + '</span>' +
    '</span>' +
    '<span class="pcv-body">' +
      '<span class="pcv-theme">' + esc(m.theme || 'Lesson') + '</span>' +
      '<span class="arc-meta">' + esc((normalizeLevel(m.level) || 'b2').toUpperCase()) + ' · ' + lessonWordCount(m) + ' words</span>' +
      '<span class="pcv-row">' +
        '<span class="pcv-bar" role="progressbar" aria-label="Lesson progress" aria-valuenow="' + done + '" aria-valuemin="0" aria-valuemax="' + stepsForLesson(m).length + '"><span style="width:' + pct + '%"></span></span>' +
        '<span class="pcv-ico" aria-hidden="true">' + prevIconFor(m.theme) + '</span>' +
      '</span>' +
    '</span>' +
  '</button>';
}

function renderLessons(v) {
  const lessons = state.lessons;
  let html = '<div class="archive-page">' +
    '<div class="archive-head"><h1>Past lessons</h1>' +
    '<p>' + lessons.length + (lessons.length === 1 ? ' lesson' : ' lessons') + ' · ' + esc(levelLabel(normalizeLevel(state.user.level))) + '</p></div>';
  if (!lessons.length) {
    html += '<div class="empty empty-dark">No lessons published yet — check back tomorrow.</div>';
  } else {
    html += '<div class="archive-grid">' + lessons.map(archiveCardHTML).join('') + '</div>';
  }
  v.innerHTML = html + '</div>';
}

/* ================= Grammar section (2026-10-17) =================
   Entry: home banner (#home-grammar-wrap) → #/grammar (hub) → #/grammar/<slug> (topic).
   Content: /data/grammar/<level>.json — built by bin/build-grammar-app.py from
   ~/workspace/user/files/grammar-all-pages.json (89 vetted pages, muse-grammar-page/1).
   Progress: localStorage 'muse_grammar_v1' →
     {slug: {h1, best, total, done, claimed, attempts, lastTs}, _last: slug}.
   Points (Alireza 2026-10-17): 5 XP per correct exercise on the FIRST attempt of a
   topic (ref gex-<slug>-<itemId>, idempotent via action|ref), +20 on first topic
   completion (ref gtd-<slug>). Retries are practice mode: 0 XP.
   Mistakes: wrong answers → saveMistake() → Review Your Mistakes.
   Cloud record: saveAttempt({kind:'grammar_topic', theme:slug, ...}). */

var GRAMMAR_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
var GRAMMAR_TOTAL = 89;
state.grammarCache = state.grammarCache || {};
state.gquiz = null;
state.gFilter = null;

function grammarProgress() {
  var p = lsGet('muse_grammar_v1');
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
}
function setGrammarProgress(p) { lsSet('muse_grammar_v1', p); }

function loadGrammarLevel(lv) {
  if (state.grammarCache[lv]) return Promise.resolve(state.grammarCache[lv]);
  return fetch('/data/grammar/' + lv + '.json').then(function (res) {
    if (!res.ok) throw new Error('grammar bundle ' + lv + ' missing');
    return res.json();
  }).then(function (data) {
    state.grammarCache[lv] = data.topics;
    return data.topics;
  });
}
function loadAllGrammar() {
  return Promise.all(GRAMMAR_LEVELS.map(loadGrammarLevel)).then(function (lists) {
    return lists.reduce(function (a, b) { return a.concat(b); }, []);
  });
}
function findGrammarTopic(slug) {
  for (var i = 0; i < GRAMMAR_LEVELS.length; i++) {
    var topics = state.grammarCache[GRAMMAR_LEVELS[i]] || [];
    for (var j = 0; j < topics.length; j++) if (topics[j].slug === slug) return topics[j];
  }
  return null;
}
/* A v2 topic has one copy per level file; each copy carries ALL levels'
   points but only ITS OWN level's exercises. findGrammarTopic returns the
   first (lowest-level) copy, so anything needing a topic's exercises must
   merge across copies — otherwise only the lowest level's quiz works. */
function grammarTopicCopies(slug) {
  var out = [];
  for (var i = 0; i < GRAMMAR_LEVELS.length; i++) {
    var topics = state.grammarCache[GRAMMAR_LEVELS[i]] || [];
    for (var j = 0; j < topics.length; j++) if (topics[j].slug === slug) out.push(topics[j]);
  }
  return out;
}
function grammarAllItems(topic) {
  var items = [];
  grammarTopicCopies(topic.slug).forEach(function (cp) {
    ((cp.exercises && cp.exercises.items) || []).forEach(function (ex) { items.push(ex); });
  });
  if (!items.length) items = (topic.exercises && topic.exercises.items) || [];
  return items;
}

/* Inline markdown used by the grammar pages: **bold**, *italic*, [text](url).
   Internal /blog/grammar/<slug>/ links become in-app #/grammar/<slug> links. */
function gMd(s) {
  var h = esc(String(s == null ? '' : s));
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, t, u) {
    if (u.indexOf('/blog/grammar/') === 0) {
      var parts = u.split('/').filter(Boolean);
      return '<a href="#/grammar/' + esc(parts[parts.length - 1]) + '">' + t + '</a>';
    }
    return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + t + '</a>';
  });
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return h;
}

function grammarBlocksHTML(blocks) {
  return (blocks || []).map(function (b) {
    var t = b.type;
    if (t === 'p') return '<p>' + gMd(b.md) + '</p>';
    if (t === 'tip') return '<div class="g-tip">' + gMd(b.md) + '</div>';
    if (t === 'list') return '<ul class="g-list">' + (b.items || []).map(function (it) {
      return '<li>' + gMd(it) + '</li>';
    }).join('') + '</ul>';
    if (t === 'examples') return '<ol class="g-examples">' + (b.items || []).map(function (it) {
      return '<li><div class="g-ex-text">' + gMd(it.text) + '</div>' +
        (it.note ? '<div class="g-ex-note">' + gMd(it.note) + '</div>' : '') + '</li>';
    }).join('') + '</ol>';
    if (t === 'table') {
      var heads = (b.headers || []).map(function (hh) { return '<th>' + gMd(hh) + '</th>'; }).join('');
      var rows = (b.rows || []).map(function (r) {
        return '<tr>' + r.map(function (c, ci) {
          var lab = (b.headers || [])[ci] || '';
          return '<td' + (lab ? ' data-label="' + esc(lab) + '"' : '') + '>' + gMd(c) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="gwrap"><table class="g-table"><thead><tr>' + heads + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return '';
  }).join('');
}

/* Persian grammar (2026-11-11, Claude, Alireza's order): A1–B1 sections in Persian;
   example sentences, exercise sentences and answers stay English. Data:
   /data/grammar/fa/<slug>.json + index.json, written by seo/fa-pages/grammar_fa.py
   (export_app, run by blog_fa.py — never edit by hand). The strings in it are
   pre-rendered, escaped HTML (English islands as <em dir="ltr">). No file, or a
   level missing from its "lv" list = that part stays English. */
var _gFa = {};
var _gFaIdx = null;
function gFaLoad(slug) {
  if (Object.prototype.hasOwnProperty.call(_gFa, slug)) return Promise.resolve(_gFa[slug]);
  return fetch('/data/grammar/fa/' + encodeURIComponent(slug) + '.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (d) { _gFa[slug] = (d && d.lv && d.lv.length) ? d : null; return _gFa[slug]; });
}
function gFaIndex() {
  if (_gFaIdx) return Promise.resolve(_gFaIdx);
  return fetch('/data/grammar/fa/index.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (d) { _gFaIdx = (d && d.titles) ? d : { titles: {}, fa: [] }; return _gFaIdx; });
}
function gFaTitle(slug) { return (_gFaIdx && _gFaIdx.titles && _gFaIdx.titles[slug]) || ''; }
function gFaFor(slug, lv) {
  var d = _gFa[slug];
  return (d && d.lv && d.lv.indexOf(lv) !== -1) ? d : null;
}
function grammarBlocksHTMLFa(blocks, fb) {
  fb = fb || [];
  return (blocks || []).map(function (b, i) {
    var f = fb[i], t = b.type;
    if (t === 'p') return f ? '<p>' + f + '</p>' : '<p dir="ltr">' + gMd(b.md) + '</p>';
    if (t === 'tip') return f ? '<div class="g-tip">' + f + '</div>' : '<div class="g-tip" dir="ltr">' + gMd(b.md) + '</div>';
    if (t === 'list') {
      var fl = f || {};
      return (b.md ? (fl.md ? '<p>' + fl.md + '</p>' : '<p dir="ltr">' + gMd(b.md) + '</p>') : '') +
        '<ul class="g-list">' + (b.items || []).map(function (it, j) {
          var w = fl.items && fl.items[j];
          return w ? '<li>' + w + '</li>' : '<li dir="ltr">' + gMd(it) + '</li>';
        }).join('') + '</ul>';
    }
    if (t === 'table') {
      var ft = f || {};
      var heads = (b.headers || []).map(function (hh, ci) {
        var fh = ft.h ? ft.h[ci] : null;
        return (fh !== undefined && fh !== null) ? '<th>' + fh + '</th>' : '<th dir="ltr">' + gMd(hh) + '</th>';
      }).join('');
      var rows = (b.rows || []).map(function (r, ri) {
        return '<tr>' + r.map(function (c, ci) {
          var lab = (ft.hl && ft.hl[ci]) || (b.headers || [])[ci] || '';
          var la = lab ? ' data-label="' + esc(lab) + '"' : '';
          var fc = ft.c && ft.c[ri] ? ft.c[ri][ci] : null;
          return fc ? '<td' + la + '>' + fc + '</td>' : '<td dir="ltr"' + la + '>' + gMd(c) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="gwrap"><table class="g-table"><thead><tr>' + heads + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    return grammarBlocksHTML([b]);
  }).join('');
}

