/* ---------------- Sentence Builder (#/sentences) ----------------
   Alireza, 2026-10-25: a dedicated section (like Grammar / Vocabulary) where
   EVERY word in the 9,140-word bank becomes a "Tap the words in order" game
   built from its example sentence, on the duo engine (kind 'sentence').
   Entry: home banner (#home-sentence-wrap) -> hub (level + topic) -> topic
   page -> game. Data reuses the vocabulary bank files. */
var SB_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'a1', label: 'A1' }, { id: 'a2', label: 'A2' },
  { id: 'b1', label: 'B1' }, { id: 'b2', label: 'B2' }, { id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }
];
var SB_LV_SUB = {
  all: 'Every topic from A1 to C2 — build the example sentence of each word.',
  a1: 'Short, everyday sentences to build word by word.',
  a2: 'Everyday sentences to build word by word.',
  b1: 'Intermediate sentences to build word by word.',
  b2: 'Upper-intermediate sentences to build word by word.',
  c1: 'Advanced sentences to build word by word.',
  c2: 'Near-native sentences to build word by word.'
};

/* Words of a category whose example sentence can be played (4-12 words),
   optionally restricted to one level. Returns the raw bank word objects. */
function sbPlayableWords(words, level) {
  return (words || []).filter(function (w) {
    if (!w || !w.example_en) return false;
    if (level && level !== 'all' && (w.levels || []).indexOf(level) === -1) return false;
    var n = sentenceTokens(w.example_en).length;
    return n >= 4 && n <= 12;
  });
}

function startSentenceBankGame(cat, words) {
  var level = (state.sbFilter && state.sbFilter.level) || 'all';
  var pool = sbPlayableWords(words, level);
  var pick = shuffleArr(pool.slice()).slice(0, 15).map(function (w) {
    return { word: w.word, persian: w.meaning_fa || '', example: w.example_en };
  });
  var deck = buildSentenceDeck(pick);
  if (!deck.length) return;
  var m = { date: todayStr(), level: (state.user && state.user.level) || '', theme: cat ? cat.title : '' };
  state._sbKey = 'cat:' + (cat ? cat.slug : '');
  beginQuizSession('sentence', m, deck, null);
}

function renderSentences(v, slug) {
  if (slug) { renderSentenceCat(v, slug); return; }
  if (!state.sbFilter) state.sbFilter = { level: normalizeLevel(state.user && state.user.level) || 'a1', q: '' };
  var f = state.sbFilter;
  v.innerHTML = '<div class="vc-hub">' +
    '<div class="vc-crumb"><span>🧩</span> Sentence Builder <span class="vc-crumb-sep">›</span> <b id="sb-crumb-lv"></b></div>' +
    '<div class="vc-hero"><div class="vc-hero-t">' +
      '<h1>Sentence <em>Builder</em></h1>' +
      '<p>All 9,140 words — tap the words in order and rebuild each word\u2019s example sentence.</p>' +
    '</div><div class="vc-mascot" aria-hidden="true">🧩</div></div>' +
    '<div class="vc-feats">' +
      '<span class="vc-feat"><i>🧩</i><b>Build<br>sentences</b></span>' +
      '<span class="vc-feat"><i>💡</i><b>Persian<br>hints</b></span>' +
      '<span class="vc-feat"><i>🎯</i><b>Quick<br>play</b></span>' +
    '</div>' +
    '<div class="vc-filters" role="tablist">' +
    SB_LEVELS.map(function (lv) {
      return '<button class="vc-pill vc-pill-lv-' + lv.id + (f.level === lv.id ? ' on' : '') + '" data-slevel="' + lv.id + '">' + lv.label + '</button>';
    }).join('') + '</div>' +
    '<div class="vc-search"><span class="vc-search-ico">🔍</span>' +
      '<input id="sb-search" type="search" placeholder="Search topics..." value="' + esc(f.q) + '" aria-label="Search topics"></div>' +
    '<div class="vc-sec"><span id="sb-sec-lv"></span>' +
      '<div class="vc-sec-t"><h2>Topics</h2><p id="sb-sec-sub"></p></div>' +
      '<span class="vc-count" id="sb-count"></span></div>' +
    '<div id="sb-list"><div class="empty">Loading…</div></div></div>';
  paintSbHeader();
  paintSbList();
  Array.prototype.forEach.call(v.querySelectorAll('[data-slevel]'), function (btn) {
    btn.addEventListener('click', function () {
      state.sbFilter.level = btn.getAttribute('data-slevel');
      Array.prototype.forEach.call(v.querySelectorAll('[data-slevel]'), function (bb) {
        bb.classList.toggle('on', bb === btn);
      });
      paintSbHeader();
      paintSbList();
    });
  });
  var input = v.querySelector('#sb-search'), deb = null;
  input.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { state.sbFilter.q = input.value.trim(); paintSbList(); }, 250);
  });
}

function paintSbHeader() {
  var f = state.sbFilter || { level: 'all', q: '' };
  var crumb = document.getElementById('sb-crumb-lv');
  if (crumb) crumb.textContent = f.level === 'all' ? 'All levels' : f.level.toUpperCase();
  var secLv = document.getElementById('sb-sec-lv');
  if (secLv) secLv.innerHTML = vcLvBadge(f.level);
  var sub = document.getElementById('sb-sec-sub');
  if (sub) sub.textContent = SB_LV_SUB[f.level] || SB_LV_SUB.all;
}

function paintSbList() {
  var wrap = document.getElementById('sb-list');
  if (!wrap) return;
  var f = state.sbFilter || { level: 'all', q: '' };
  loadVocabCats().then(function (cats) {
    var q = (f.q || '').toLowerCase();
    var list = cats.filter(function (c) {
      if (f.level !== 'all' && c.levels.indexOf(f.level) === -1) return false;
      if (q && c.title.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    if (!list.length) { wrap.innerHTML = '<div class="empty">No topics match.</div>'; return; }
    var count = document.getElementById('sb-count');
    if (count) count.textContent = list.length + ' topic' + (list.length === 1 ? '' : 's');
    wrap.innerHTML = '<div class="vc-cards">' + list.map(function (c) {
      return '<a class="vc-card" href="#/sentences/' + esc(c.slug) + '">' +
        '<span class="vc-ico">' + esc(c.icon || '📖') + '</span>' +
        '<span class="vc-card-main"><span class="vc-titlerow">' + vcLevelBadges(c.levels) + '<b>' + esc(c.title) + '</b></span>' +
        '<span class="vc-status">' + c.word_count + ' words</span></span>' +
        '<span class="vc-chev" aria-hidden="true">›</span></a>';
    }).join('') + '</div>';
  }).catch(function () {
    wrap.innerHTML = '<div class="empty">Could not load topics. Check your connection and try again.</div>';
  });
}

function renderSentenceCat(v, slug) {
  v.innerHTML = '<div class="vc-topic"><div class="empty">Loading…</div></div>';
  loadVocabCats().then(function (cats) {
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i].slug === slug) cat = cats[i];
    if (!cat) {
      v.innerHTML = '<div class="vc-topic"><div class="empty">Topic not found. <a href="#/sentences">Back to all topics</a></div></div>';
      return null;
    }
    return loadVocabWords(slug).then(function (words) {
      var level = (state.sbFilter && state.sbFilter.level) || 'all';
      var doneBefore = !!ptsGet('done')['sentence_done|cat:' + slug];
      var pool = sbPlayableWords(words, level);
      var rows = pool.map(function (w) {
        return '<div class="vc-word">' +
          (w.photo ? '<img class="vc-word-img" src="' + (/^https?:\/\//.test(w.photo) ? w.photo : '/' + w.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
          '<div class="vc-word-body">' +
          '<div class="vc-word-top"><b>' + esc(w.word) + '</b>' +
          (w.phonetic ? '<span class="vc-phon">/' + esc(w.phonetic) + '/</span>' : '') +
          (w.pos ? '<span class="vc-pos">' + esc(w.pos) + '</span>' : '') +
          vcLevelBadges(w.levels) + '</div>' +
          (w.meaning_fa ? '<div class="vc-meaning">' + esc(w.meaning_fa) + '</div>' : '') +
          (w.example_en ? '<div class="vc-example">“' + esc(w.example_en) + '”</div>' : '') +
          '</div></div>';
      }).join('');
      v.innerHTML = '<div class="vc-topic">' +
        '<a class="vc-back" href="#/sentences">‹ All topics</a>' +
        '<div class="vc-hero vc-hero-topic"><div class="vc-hero-t">' +
        '<div class="vc-hero-ico">' + esc(cat.icon || '📖') + '</div>' +
        '<h1>' + esc(cat.title) + '</h1>' +
        '<p>' + pool.length + ' sentences to build' + (level !== 'all' ? ' · level ' + level.toUpperCase() : ' · all levels') + ' ' + vcLevelBadges(cat.levels) + '</p>' +
        '</div></div>' +
        (doneBefore ? '<div class="sb-done-note">✓ You already completed this topic — replaying is practice; points are earned only once.</div>' : '') +
        (pool.length
          ? '<button class="btn btn-primary vc-start" id="sb-start-btn">🧩 Play · ' + Math.min(15, pool.length) + ' sentences →</button>' +
            '<p class="vc-xp-note">Tap the words in order · the Persian meaning is your hint</p>'
          : '<p class="vc-xp-note">No playable sentences at this level in this topic — pick another level from the Sentence Builder hub.</p>') +
        '<div class="vc-words">' + rows + '</div></div>';
      var btn = document.getElementById('sb-start-btn');
      if (btn) btn.addEventListener('click', function () { startSentenceBankGame(cat, words); });
      window.scrollTo(0, 0);
    });
  }).catch(function () {
    v.innerHTML = '<div class="vc-topic"><div class="empty">Could not load this topic. Check your connection and try again.</div></div>';
  });
}
