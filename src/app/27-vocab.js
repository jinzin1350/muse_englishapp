/* ---------------- vocabulary (#/vocab) ----------------
   66 deduped categories from English Vocabulary in Use
   (Elementary A1-A2, Pre-intermediate & Intermediate A2-B1, Upper-intermediate B2).
   Entry: home banner (#home-vocab-wrap) -> #/vocab (hub) -> #/vocab/<slug>.
   Practice quiz: up to 10 questions, word -> Persian meaning, practice mode (no XP). */

var VC_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2' },
  { id: 'b1', label: 'B1' }, { id: 'b2', label: 'B2' }, { id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }
];
var VC_LV_COLORS = { a1: '#D9A21B', a2: '#E8833A', b1: '#3FA46A', b2: '#F26522', c1: '#4A90D9', c2: '#8E6FC8' };
var VC_LV_SUB = {
  all: 'Every vocabulary topic from A1 to C2 \u2014 words with meanings and examples.',
  a1: 'Essential everyday words with meanings and examples.',
  a2: 'Everyday words with meanings and examples.',
  b1: 'Intermediate words with meanings and examples.',
  b2: 'Upper-intermediate words with meanings and examples.',
  c1: 'Advanced words with meanings and examples.',
  c2: 'Proficiency words with meanings and examples.'
};

function vocabProgress() {
  var p = lsGet('muse_vocab_v1');
  return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
}
function setVocabProgress(p) { lsSet('muse_vocab_v1', p); }

function loadVocabCats() {
  if (state.vocabCats) return Promise.resolve(state.vocabCats);
  return fetch('/data/vocab/categories.json').then(function (res) {
    if (!res.ok) throw new Error('vocab categories missing');
    return res.json();
  }).then(function (data) {
    state.vocabCats = data;
    return data;
  });
}
function loadVocabWords(slug) {
  state.vocabWords = state.vocabWords || {};
  if (state.vocabWords[slug]) return Promise.resolve(state.vocabWords[slug]);
  return fetch('/data/vocab/by-category/' + slug + '.json').then(function (res) {
    if (!res.ok) throw new Error('vocab category missing');
    return res.json();
  }).then(function (data) {
    state.vocabWords[slug] = data;
    return data;
  });
}
function vcLvBadge(lv) {
  var label = lv === 'all' ? 'A1\u2013C2' : lv.toUpperCase();
  var color = lv === 'all' ? '#8A93A6' : (VC_LV_COLORS[lv] || '#8A93A6');
  return '<span class="vc-lv" style="background:' + color + '">' + label + '</span>';
}
function vcLevelBadges(levels) {
  return (levels || []).map(vcLvBadge).join('');
}

function renderVocab(v, slug) {
  if (slug) { renderVocabCat(v, slug); return; }
  if (!state.vcFilter) state.vcFilter = { level: 'all', q: '' };
  var f = state.vcFilter;
  var totalWords = (state.vocabCats || []).reduce(function (a, c) { return a + (c.word_count || 0); }, 0);
  v.innerHTML = '<div class="vc-hub">' +
    '<div class="vc-crumb"><span>\uD83D\uDCDA</span> Vocabulary <span class="vc-crumb-sep">\u203A</span> <b id="vc-crumb-lv"></b></div>' +
    '<div class="vc-hero"><div class="vc-hero-t">' +
      '<h1>Vocabulary <em>Builder</em></h1>' +
      '<p><span id="vc-bank-count">9,140</span> words — the Vocabulary in Use books plus teacher-added extras, grouped into 69 topics \u2014 with meanings and examples.</p>' +
    '</div><div class="vc-mascot" aria-hidden="true">\uD83D\uDCDA</div></div>' +
    '<div class="vc-feats">' +
      '<span class="vc-feat"><i>\uD83D\uDCD6</i><b>Real<br>meanings</b></span>' +
      '<span class="vc-feat"><i>\uD83D\uDCAC</i><b>Example<br>sentences</b></span>' +
      '<span class="vc-feat"><i>\uD83C\uDFAF</i><b>Quick<br>practice</b></span>' +
    '</div>' +
    '<div class="vc-filters" role="tablist">' +
    VC_LEVELS.map(function (lv) {
      return '<button class="vc-pill vc-pill-lv-' + lv.id + (f.level === lv.id ? ' on' : '') + '" data-vlevel="' + lv.id + '">' + lv.label + '</button>';
    }).join('') + '</div>' +
    '<div class="vc-search"><span class="vc-search-ico">\uD83D\uDD0D</span>' +
      '<input id="vc-search" type="search" placeholder="Search words or topics..." value="' + esc(f.q) + '" aria-label="Search words or topics"></div>' +
    '<div class="vc-sec"><span id="vc-sec-lv"></span>' +
      '<div class="vc-sec-t"><h2>Vocabulary Topics</h2><p id="vc-sec-sub"></p></div>' +
      '<span class="vc-count" id="vc-count"></span></div>' +
    '<div id="vc-list"><div class="empty">Loading\u2026</div></div></div>';
  paintVcHeader();
  paintVocabList();
  /* Live unique-word count for the hero (extras get added over time). */
  loadAllWords().then(function (all) {
    var el = document.getElementById('vc-bank-count');
    if (el && all && all.length) el.textContent = all.length.toLocaleString('en-US');
  }).catch(function () {});
  Array.prototype.forEach.call(v.querySelectorAll('[data-vlevel]'), function (btn) {
    btn.addEventListener('click', function () {
      state.vcFilter.level = btn.getAttribute('data-vlevel');
      Array.prototype.forEach.call(v.querySelectorAll('[data-vlevel]'), function (bb) {
        bb.classList.toggle('on', bb === btn);
      });
      paintVcHeader();
      paintVocabList();
    });
  });
  var input = v.querySelector('#vc-search'), deb = null;
  input.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { state.vcFilter.q = input.value.trim(); paintVocabList(); }, 250);
  });
}

function paintVcHeader() {
  var f = state.vcFilter || { level: 'all', q: '' };
  var crumb = document.getElementById('vc-crumb-lv');
  if (crumb) crumb.textContent = f.level === 'all' ? 'All levels' : f.level.toUpperCase();
  var secLv = document.getElementById('vc-sec-lv');
  if (secLv) secLv.innerHTML = vcLvBadge(f.level);
  var sub = document.getElementById('vc-sec-sub');
  if (sub) sub.textContent = VC_LV_SUB[f.level] || VC_LV_SUB.all;
}

/* One word row — shared by the topic page and hub word-search results.
   catTitleBySlug (optional): when given, the row links to the word's topics. */
function vocabWordRowHTML(w, catTitleBySlug) {
  var topics = '';
  if (catTitleBySlug && w.categories && w.categories.length) {
    var links = w.categories.map(function (s) {
      return catTitleBySlug[s] ? '<a href="#/vocab/' + esc(s) + '">' + esc(catTitleBySlug[s]) + '</a>' : '';
    }).join('');
    if (links) topics = '<div class="vc-word-topics">' + links + '</div>';
  }
  return '<div class="vc-word">' +
    (w.photo ? '<img class="vc-word-img" src="' + (/^https?:\/\//.test(w.photo) ? w.photo : '/' + w.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
    '<div class="vc-word-body">' +
    '<div class="vc-word-top"><b>' + esc(w.word) + '</b>' +
    (w.audio ? '<button class="vc-say" data-action="vc-say" data-audio="' + esc(/^https?:\/\//.test(w.audio) ? w.audio : '/' + w.audio) + '" aria-label="Listen to pronunciation">\uD83D\uDD0A</button>' : '') +
    (w.phonetic ? '<span class="vc-phon">/' + esc(w.phonetic) + '/</span>' : '') +
    (w.pos ? '<span class="vc-pos">' + esc(w.pos) + '</span>' : '') +
    vcLevelBadges(w.levels) +
    '<button class="save-word-btn vc-save' + (isWordSaved(w.word, '') ? ' saved' : '') + '" data-action="vc-toggle-save" data-word="' + esc(w.word) + '" aria-label="Bookmark this word" title="Save for later practice"><img src="/icons/bookmark.png" alt=""></button></div>' +
    (w.meaning_fa ? '<div class="vc-meaning">' + esc(w.meaning_fa) + '</div>' : '') +
    (w.example_en ? '<div class="vc-example">' + esc(w.example_en) + '</div>' : '') +
    topics +
    '</div></div>';
}

/* Word search over the full 9,140-word bank: exact / starts-with / contains
   on the headword first, then Persian meaning, then English meaning. */
function vcSearchWords(all, q, level) {
  var ql = q.toLowerCase();
  var scored = [];
  for (var i = 0; i < all.length; i++) {
    var w = all[i];
    if (level !== 'all' && (w.levels || []).indexOf(level) === -1) continue;
    var wl = (w.word || '').toLowerCase();
    var s = -1;
    if (wl === ql) s = 0;
    else if (wl.indexOf(ql) === 0) s = 1;
    else if (wl.indexOf(ql) !== -1) s = 2;
    else if ((w.meaning_fa || '').indexOf(q) !== -1) s = 3;
    else if ((w.meaning_en || '').toLowerCase().indexOf(ql) !== -1) s = 4;
    if (s >= 0) scored.push({ w: w, s: s });
  }
  scored.sort(function (a, b) {
    if (a.s !== b.s) return a.s - b.s;
    return String(a.w.word).localeCompare(String(b.w.word));
  });
  return scored.slice(0, 30).map(function (x) { return x.w; });
}

function paintVocabList() {
  var wrap = document.getElementById('vc-list');
  if (!wrap) return;
  var f = state.vcFilter || { level: 'all', q: '' };
  loadVocabCats().then(function (cats) {
    var prog = vocabProgress();
    var q = (f.q || '').trim();
    var ql = q.toLowerCase();
    var list = cats.filter(function (c) {
      if (f.level !== 'all' && c.levels.indexOf(f.level) === -1) return false;
      if (ql && c.title.toLowerCase().indexOf(ql) === -1) return false;
      return true;
    });
    var count = document.getElementById('vc-count');
    if (!q) {
      if (!list.length) { wrap.innerHTML = '<div class="empty">No topics match.</div>'; return; }
      if (count) count.textContent = list.length + ' topic' + (list.length === 1 ? '' : 's');
      wrap.innerHTML = '<div class="vc-cards">' + list.map(function (c) {
        return vocabCardHTML(c, prog[c.slug]);
      }).join('') + '</div>';
      return;
    }
    /* Search mode: matching words first (from the full bank), then matching topics. */
    return loadAllWords().then(function (all) {
      var catTitle = {};
      cats.forEach(function (c) { catTitle[c.slug] = c.title; });
      var matches = vcSearchWords(all, q, f.level);
      if (!matches.length && !list.length) {
        if (count) count.textContent = '0 results';
        wrap.innerHTML = '<div class="empty">No words or topics match.</div>';
        return;
      }
      if (count) count.textContent = (matches.length + list.length) + ' result' + ((matches.length + list.length) === 1 ? '' : 's');
      var html = '';
      if (matches.length) {
        html += '<div class="vc-search-h">Words</div><div class="vc-words">' + matches.map(function (w) {
          return vocabWordRowHTML(w, catTitle);
        }).join('') + '</div>';
      }
      if (list.length) {
        html += '<div class="vc-search-h">Topics</div><div class="vc-cards">' + list.map(function (c) {
          return vocabCardHTML(c, prog[c.slug]);
        }).join('') + '</div>';
      }
      wrap.innerHTML = html;
      if (matches.length) refreshVocabSaveButtons(wrap);
    });
  }).catch(function () {
    wrap.innerHTML = '<div class="empty">Could not load vocabulary topics. Check your connection and try again.</div>';
  });
}

function vocabCardHTML(c, p) {
  var status;
  if (p && p.done) status = '<span class="vc-status done">\u2713 practised</span>';
  else status = '<span class="vc-status">' + c.word_count + ' words</span>';
  return '<a class="vc-card" href="#/vocab/' + esc(c.slug) + '">' +
    '<span class="vc-ico">' + esc(c.icon || '\uD83D\uDCD6') + '</span>' +
    '<span class="vc-card-main"><span class="vc-titlerow">' + vcLevelBadges(c.levels) + '<b>' + esc(c.title) + '</b></span>' + status + '</span>' +
    '<span class="vc-chev" aria-hidden="true">\u203A</span></a>';
}

/* ---------------- vocabulary category (#/vocab/<slug>) ---------------- */

function renderVocabCat(v, slug) {
  v.innerHTML = '<div class="vc-topic"><div class="empty">Loading\u2026</div></div>';
  loadVocabCats().then(function (cats) {
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i].slug === slug) cat = cats[i];
    if (!cat) {
      v.innerHTML = '<div class="vc-topic"><div class="empty">Topic not found. <a href="#/vocab">Back to all topics</a></div></div>';
      return;
    }
    return loadVocabWords(slug).then(function (words) {
      var prog = vocabProgress()[slug];
      var best = prog && prog.done ? '<span class="vc-best">\u2713 Practised</span>' : '';
      var rows = words.map(function (w) { return vocabWordRowHTML(w); }).join('');
      v.innerHTML = '<div class="vc-topic">' +
        '<a class="vc-back" href="#/vocab">\u2039 All topics</a>' +
        '<div class="vc-hero vc-hero-topic"><div class="vc-hero-t">' +
        '<div class="vc-hero-ico">' + esc(cat.icon || '\uD83D\uDCD6') + '</div>' +
        '<h1>' + esc(cat.title) + '</h1>' +
        '<p>' + cat.word_count + ' words \u00B7 ' + vcLevelBadges(cat.levels) + ' ' + best + '</p>' +
        '</div></div>' +
        '<button class="btn btn-primary vc-start" id="vc-start-btn">Practice these words \u2192</button>' +
        '<p class="vc-xp-note">Quick quiz \u00B7 word \u2192 meaning \u00B7 practice mode (no points)</p>' +
        '<div class="vc-words">' + rows + '</div></div>';
      document.getElementById('vc-start-btn').addEventListener('click', function () {
        startVocabQuiz(cat, words);
      });
      refreshVocabSaveButtons(v);
      window.scrollTo(0, 0);
    });
  }).catch(function () {
    v.innerHTML = '<div class="vc-topic"><div class="empty">Could not load this topic.</div></div>';
  });
}

/* ---------------- vocabulary quiz ---------------- */

/* Play a vocabulary word's TTS audio (single shared element; tap toggles). */
var _vcAudio = null, _vcAudioSrc = '';
function playVocabAudio(src) {
  if (!src) return;
  try {
    if (_vcAudio && _vcAudioSrc === src && !_vcAudio.paused) {
      _vcAudio.pause();
      _vcAudio.currentTime = 0;
      return;
    }
    if (_vcAudio) { try { _vcAudio.pause(); } catch (e) {} }
    _vcAudioSrc = src;
    _vcAudio = new Audio(src);
    _vcAudio.play().catch(function () {});
  } catch (e) {}
}

function startVocabQuiz(cat, words) {
  var LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
  function maxLv(w) {
    var m = 0;
    (w.levels || []).forEach(function (l) { m = Math.max(m, LV_RANK[l] || 0); });
    return m;
  }
  function qLang(w) { return maxLv(w) <= 2 ? 'fa' : 'en'; }
  function hasMeaning(w, lang) { return lang === 'fa' ? w.meaning_fa : w.meaning_en; }
  var pool = words.filter(function (w) { return w.meaning_fa && w.meaning_en; });
  if (pool.length < 4) {
    alert('Not enough words with meanings in this topic yet.');
    return;
  }
  var items = shuffleArr(pool).slice(0, 10).map(function (w) {
    var lang = qLang(w);
    var sameLang = pool.filter(function (x) { return x.word !== w.word && qLang(x) === lang && hasMeaning(x, lang); });
    var distractPool = sameLang.length >= 3 ? sameLang : pool.filter(function (x) { return x.word !== w.word && hasMeaning(x, lang); });
    var distract = shuffleArr(distractPool).slice(0, 3);
    var correct = lang === 'fa' ? w.meaning_fa : w.meaning_en;
    var options = shuffleArr([correct].concat(distract.map(function (x) { return lang === 'fa' ? x.meaning_fa : x.meaning_en; })));
    return { word: w.word, example: w.example_en, options: options, answer: options.indexOf(correct) };
  });
  state.vquiz = { slug: cat.slug, title: cat.title, items: items, idx: 0, picked: -1, answered: false, correct: 0 };
  document.body.classList.add('duo-playing');
  renderVocabQuiz();
}

function renderVocabQuiz() {
  var q = state.vquiz; if (!q) return;
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
    return '<button class="' + cls + '"' + (q.answered ? ' disabled' : '') + ' data-vopt="' + i + '">' +
      '<span class="gt-opt-letter">' + letters[i] + '</span>' +
      '<span class="gt-opt-text">' + esc(op) + '</span></button>';
  }).join('');
  var sheet = '';
  if (q.answered) {
    var good = q.picked === it.answer;
    sheet = '<div class="gt-sheet ' + (good ? 'good' : 'bad') + '"><div class="gt-sheet-inner">' +
      '<div class="gt-sheet-msg">' + (good ? '\uD83C\uDF89 Correct!' : '\uD83D\uDCA1 Correct answer: <b>' + esc(it.options[it.answer]) + '</b>') + '</div>' +
      (it.example ? '<div class="gt-sheet-explain"><em>' + esc(it.example) + '</em></div>' : '') +
      '<button class="gt-btn ' + (good ? 'gt-btn-green' : 'gt-btn-red') + ' gt-btn-block" id="vc-next-btn">' +
      (q.idx + 1 >= n ? 'SEE RESULTS' : 'CONTINUE') + '</button>' +
      '</div></div>';
  }
  var barPct = Math.round((q.idx + (q.answered ? 1 : 0)) / n * 100);
  v.innerHTML = '<div class="vc-quiz gt-wrap">' +
    '<div class="gt-top"><button class="gt-x" id="vc-quiz-quit" aria-label="Back to topic">\u2715</button>' +
    '<div class="gt-progress"><span style="width:' + barPct + '%"></span></div>' +
    '<div class="gt-qcount">' + (q.idx + 1) + '/' + n + '</div></div>' +
    '<div class="gt-mode">Practice mode \u2014 no points</div>' +
    '<div class="gt-q">What does <b>\u201C' + esc(it.word) + '\u201D</b> mean?</div>' +
    '<div class="gt-opts">' + opts + '</div>' + sheet + '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-vopt]'), function (btn) {
    btn.addEventListener('click', function () { answerVocabQuiz(parseInt(btn.getAttribute('data-vopt'), 10)); });
  });
  var next = document.getElementById('vc-next-btn');
  if (next) next.addEventListener('click', nextVocabQuiz);
  document.getElementById('vc-quiz-quit').addEventListener('click', function () {
    state.vquiz = null;
    document.body.classList.remove('duo-playing');
    go('vocab', q.slug);
  });
  window.scrollTo(0, 0);
}

function answerVocabQuiz(i) {
  var q = state.vquiz; if (!q || q.answered) return;
  q.picked = i; q.answered = true;
  if (i === q.items[q.idx].answer) q.correct++;
  renderVocabQuiz();
}

function nextVocabQuiz() {
  var q = state.vquiz; if (!q) return;
  q.idx++; q.picked = -1; q.answered = false;
  if (q.idx >= q.items.length) { finishVocabQuiz(); return; }
  renderVocabQuiz();
}

function finishVocabQuiz() {
  var q = state.vquiz; if (!q) return;
  var v = document.getElementById('view');
  var n = q.items.length, score = q.correct;
  var prog = vocabProgress();
  var rec = prog[q.slug] || {};
  rec.attempts = (rec.attempts || 0) + 1;
  rec.done = true;
  rec.best = Math.max(rec.best || 0, score);
  rec.total = n;
  prog[q.slug] = rec;
  setVocabProgress(prog);
  state.vquiz = null;
  document.body.classList.remove('duo-playing');
  var pct = Math.round(score / n * 100);
  var msg = pct === 100 ? '\uD83C\uDF89 Perfect!' : (pct >= 70 ? '\uD83D\uDC4D Great job!' : (pct >= 40 ? '\uD83D\uDCAA Keep practising!' : '\uD83D\uDCD6 Review the words and try again!'));
  v.innerHTML = '<div class="gt-wrap gt-done">' +
    '<div class="gt-done-ico">' + (pct >= 70 ? '\uD83C\uDF89' : '\uD83D\uDCD6') + '</div>' +
    '<h2>' + msg + '</h2>' +
    '<p class="gt-done-sub">' + score + ' / ' + n + ' correct \u00B7 ' + esc(q.title) + '</p>' +
    '<div class="gt-done-btns">' +
    '<button class="gt-btn gt-btn-green gt-btn-block" id="vc-again-btn">Practice again \u21BB</button>' +
    '<a class="gt-btn gt-btn-ghost gt-btn-block" href="#/vocab/' + esc(q.slug) + '">Back to topic</a>' +
    '<a class="gt-btn gt-btn-ghost gt-btn-block" href="#/vocab">All topics</a>' +
    '</div></div>';
  document.getElementById('vc-again-btn').addEventListener('click', function () {
    loadVocabWords(q.slug).then(function (words) { startVocabQuiz({ slug: q.slug, title: q.title }, words); });
  });
  window.scrollTo(0, 0);
}

