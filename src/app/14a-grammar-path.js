/* ---------------- grammar path (#/grammar, Duolingo-style) ----------------
   2026-11-17, Alireza's order: grammar becomes a step-by-step path from the
   first A1 lesson to the last C1/C2 lesson, replacing the flat topic list as
   the main grammar view (the list stays one tap away). Order: each topic sits
   at its entry level (first of its v2 `levels`); inside a level, families
   follow GP_FAMILY_ORDER and topics keep their teaching order inside the
   family (both from data/grammar/v2-index.json). A node unlocks when every
   node before it is complete; completed nodes stay tappable for review.
   Progress = the existing muse_grammar_v1 store (grammarProgress()). */
var GP_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'];
var GP_LEVEL_TITLES = { a1: 'A1 · Beginner', a2: 'A2 · Elementary', b1: 'B1 · Intermediate', b2: 'B2 · Upper Intermediate', c1: 'C1 · C2 · Advanced' };
var GP_FAMILY_ORDER = ['verb-basics', 'present-tenses', 'articles', 'nouns', 'determiners', 'pronouns', 'past-tenses', 'adjectives-and-adverbs', 'prepositions', 'present-perfect-tenses', 'future-forms', 'questions', 'modal-verbs', 'verb-patterns', 'linking-words', 'conditionals', 'passive', 'relative-clauses', 'reporting', 'sentence-structure', 'academic-english'];
var GP_OFFSETS = [0, 46, 78, 46, 0, -46, -78, -46];
/* Level rank for the learner's own start point: the path starts at the
   learner's level (2026-11-17, Alireza's order). Earlier levels stay open
   to browse; the step-by-step unlock chain runs from their level onward. */
var GP_RANK = { a1: 0, a2: 1, b1: 2, b2: 3, c1: 4, c2: 4 };

function gpFa() { try { return uiLang() === 'fa'; } catch (e) { return false; } }
function gpT(fa, en) { return gpFa() ? fa : en; }

function gpLoadIndex() {
  if (state.gpIndex) return Promise.resolve(state.gpIndex);
  return fetch('/data/grammar/v2-index.json').then(function (res) {
    if (!res.ok) throw new Error('grammar path index missing');
    return res.json();
  }).then(function (d) { state.gpIndex = d; return d; });
}

function gpOrder(index) {
  var famIdx = {};
  Object.keys(index.families).forEach(function (fk) {
    index.families[fk].topics.forEach(function (slug, i) { famIdx[slug] = i; });
  });
  var rows = Object.keys(index.topics).map(function (slug) {
    var t = index.topics[slug];
    var lv = (t.levels && t.levels[0]) || 'a1';
    return { slug: slug, h1: t.h1, family: t.family, level: lv };
  });
  rows.sort(function (a, b) {
    var dl = GP_LEVELS.indexOf(a.level) - GP_LEVELS.indexOf(b.level);
    if (dl) return dl;
    var df = GP_FAMILY_ORDER.indexOf(a.family) - GP_FAMILY_ORDER.indexOf(b.family);
    if (df) return df;
    return (famIdx[a.slug] || 0) - (famIdx[b.slug] || 0);
  });
  return rows;
}

function renderGrammarPath(v) {
  var fa = gpFa();
  v.innerHTML = '<div class="g-hub gp-wrap">' +
    '<div class="gh-crumb"><span>\uD83D\uDCD6</span> Grammar <span class="gh-crumb-sep">›</span> <b>' + (fa ? 'مسیر گرامر' : 'Grammar Path') + '</b></div>' +
    '<div class="gp-head"><div class="gp-head-t"><h1>' + (fa ? 'مسیر گرامر' : 'Grammar <em>Path</em>') + '</h1>' +
    '<p>' + (fa ? 'درس‌به‌درس، از اولین درس A1 تا آخر C2 — هر درس رو تموم کن تا درس بعدی باز بشه.' : 'Lesson by lesson, from the first A1 lesson to the end of C2 — finish a lesson to unlock the next.') + '</p></div>' +
    '<img class="gh-mascot" src="/media/grammar/mascot-guides.webp" alt=""></div>' +
    '<div id="gtest-banner-wrap"></div>' +
    '<div class="gp-progress"><div class="gp-progress-txt" id="gp-progress-txt"></div>' +
    '<div class="gp-bar"><div class="gp-bar-fill" id="gp-bar-fill"></div></div></div>' +
    '<div class="gp-hint" id="gp-hint" hidden></div>' +
    '<div id="gp-body"><div class="empty">Loading…</div></div></div>';
  if (typeof paintGTestBanner === 'function') paintGTestBanner();
  Promise.all([gpLoadIndex(), (typeof gFaIndex === 'function' ? gFaIndex() : Promise.resolve())]).then(function (res) {
    paintGrammarPath(res[0]);
  }).catch(function () {
    var b = document.getElementById('gp-body');
    if (b) b.innerHTML = '<div class="empty">Could not load the grammar path. Check your connection and try again.</div>';
  });
}

function paintGrammarPath(index) {
  var body = document.getElementById('gp-body');
  if (!body) return;
  var fa = gpFa();
  var order = gpOrder(index);
  var prog = grammarProgress();
  var doneCount = 0;
  var currentSlug = null;
  var html = '';
  var curLevel = null, curFamily = null, nodeIdx = 0;
  /* Start point = the learner's own level (2026-11-17, Alireza's order):
     earlier levels are always playable so they can browse/review them;
     from their own level onward the chain unlocks step by step, and
     "current" is the first unfinished node at or after their level. */
  var userLv = normalizeLevel(state.user && state.user.level) || 'a1';
  var userRank = GP_RANK[userLv] || 0;
  var startIdx = order.length;
  order.forEach(function (t, k) {
    if (startIdx === order.length && (GP_RANK[t.level] || 0) >= userRank) startIdx = k;
  });
  var chainOk = true;
  var rowIdx = 0;
  order.forEach(function (t) {
    var p = prog[t.slug];
    var done = !!(p && p.done);
    if (done) doneCount++;
    var playable = done || rowIdx < startIdx || chainOk;
    var isCurrent = playable && !done && rowIdx >= startIdx && !currentSlug;
    if (isCurrent) currentSlug = t.slug;
    if (rowIdx >= startIdx && !done) chainOk = false;
    rowIdx++;
    if (t.level !== curLevel) {
      curLevel = t.level; curFamily = null;
      var lvCount = order.filter(function (x) { return x.level === curLevel; }).length;
      var grad = (typeof GH_LV_GRAD !== 'undefined' && GH_LV_GRAD[curLevel]) || ['#F6AC68', '#E8833A'];
      html += '<div class="gp-sec" id="gp-sec-' + curLevel + '" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' +
        '<b>' + esc(GP_LEVEL_TITLES[curLevel] || curLevel.toUpperCase()) + '</b>' +
        '<span>' + lvCount + (fa ? ' درس' : ' lessons') + '</span></div>';
    }
    var fam = index.families[t.family];
    if (fam && t.family !== curFamily) {
      curFamily = t.family;
      html += '<div class="gp-fam">' + esc(fam.title) + '</div>';
    }
    var dx = GP_OFFSETS[nodeIdx % GP_OFFSETS.length]; nodeIdx++;
    var title = (fa && typeof gFaTitle === 'function' && gFaTitle(t.slug)) ? gFaTitle(t.slug) : t.h1;
    var score = done ? '<span class="gp-score">✓ ' + (p.best || 0) + '/' + (p.total || 16) + '</span>'
      : (p && p.attempts ? '<span class="gp-score">' + (fa ? 'بهترین: ' : 'Best: ') + (p.best || 0) + '/' + (p.total || 16) + '</span>' : '');
    var inner = '<span class="gp-node-sym">' + (done ? '✓' : (playable ? '★' : '\uD83D\uDD12')) + '</span>';
    var nodeHtml = playable
      ? '<a class="gp-node' + (done ? ' done' : '') + (isCurrent ? ' current' : '') + '" href="#/grammar/' + esc(t.slug) + '/' + esc(t.level) + '" aria-label="' + esc(t.h1) + '">' + inner + '</a>'
      : '<button class="gp-node locked" type="button" data-gplocked="1" aria-label="' + esc(t.h1) + '">' + inner + '</button>';
    html += '<div class="gp-row" style="transform:translateX(' + dx + 'px)">' +
      (isCurrent ? '<span class="gp-start">' + (fa ? 'شروع' : 'START') + '</span>' : '') +
      nodeHtml +
      '<span class="gp-label"' + (fa && title !== t.h1 ? ' dir="rtl" lang="fa"' : '') + '>' + esc(title) + '</span>' + score +
      '</div>';
  });
  body.innerHTML = html;
  var txt = document.getElementById('gp-progress-txt');
  if (txt) txt.textContent = fa
    ? (doneCount + ' از ' + order.length + ' درس کامل شده')
    : (doneCount + ' of ' + order.length + ' lessons complete');
  var fill = document.getElementById('gp-bar-fill');
  if (fill) fill.style.width = (order.length ? Math.round(doneCount / order.length * 100) : 0) + '%';
  Array.prototype.forEach.call(body.querySelectorAll('[data-gplocked]'), function (btn) {
    btn.addEventListener('click', function () {
      var hint = document.getElementById('gp-hint');
      if (hint) {
        hint.hidden = false;
        hint.textContent = fa ? 'اول درس‌های قبل رو کامل کن تا این درس باز بشه \uD83D\uDD12' : 'Finish the lessons before this one to unlock it \uD83D\uDD12';
      }
      btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake');
    });
  });
  if (currentSlug) {
    var cur = body.querySelector('.gp-node.current');
    if (cur) setTimeout(function () { cur.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);
  } else if (startIdx < order.length) {
    /* Everything from their level on is done: land them on their level. */
    var sec = document.getElementById('gp-sec-' + (GP_LEVELS[userRank] || 'a1'));
    if (sec) setTimeout(function () { sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 350);
  }
}
