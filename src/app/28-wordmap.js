/* ---------------- word map (#/words): WordUp-style vocab study ----------------
   v2 (2026-11-07, Alireza's screenshots): dashboard (Words Uncovered /
   Knew / To Learn / Started), Today's Reviews card, Knowledge Map over one
   ranked list in ranges of 100 (card / grid / list views + cell strip),
   Discover card flow (Should Learn / Already Knew), Learn sessions, and
   Reviews: 4 illustrated meaning cards + hearts + per-word next-review
   picker. State stays in localStorage muse_wordmap_v1; v1 records migrate
   known->knew, learning->learn. */

var WM_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
var WM_LV_COLORS = { a1: '#D9A21B', a2: '#E8833A', b1: '#3FA46A', b2: '#F26522', c1: '#4A90D9', c2: '#8E6FC8' };
var WM_LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
var WM_RANGE_SIZE = 100;
var WM_REVIEW_OPTS = [
  { d: 1, label: 'Tomorrow' },
  { d: 2, label: 'In 2 days' },
  { d: 7, label: 'In a week' },
  { d: 14, label: 'In 2 weeks' },
  { d: 30, label: 'In a month' },
  { d: 0, label: 'Never, I won\u2019t forget it' }
];

function wordMapGet() {
  var p = null;
  try { p = JSON.parse(localStorage.getItem('muse_wordmap_v1')); } catch (e) { p = null; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
  if (!p.words || typeof p.words !== 'object') p.words = {};
  // v1 -> v2 status migration
  Object.keys(p.words).forEach(function (k) {
    var r = p.words[k];
    if (!r || typeof r !== 'object') { p.words[k] = { s: 'knew', d: Date.now() }; return; }
    if (r.s === 'known') r.s = 'knew';
    else if (r.s === 'learning') r.s = 'learn';
  });
  return p;
}
function wordMapSet(p) {
  try { localStorage.setItem('muse_wordmap_v1', JSON.stringify(p)); } catch (e) {}
  kvSchedulePush('muse_wordmap_v1');
}
function loadAllWords() {
  if (state.allWords) return Promise.resolve(state.allWords);
  return fetch('/data/vocab/words.json').then(function (res) {
    if (!res.ok) throw new Error('words missing');
    return res.json();
  }).then(function (data) {
    state.allWords = data;
    return data;
  });
}
function wmSlug(w) {
  var ph = w.photo || '', m = ph.match(/([^\/]+)\.jpg$/);
  if (m) return m[1];
  return String(w.word || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
function wmPrimaryLevel(w) {
  var best = 'c2', br = 99;
  (w.levels || []).forEach(function (l) {
    var r = WM_LV_RANK[l] || 99;
    if (r < br) { br = r; best = l; }
  });
  return best;
}
function wmPhotoSrc(w) {
  var ph = w.photo || '';
  return /^https?:\/\//.test(ph) ? ph : '/' + ph;
}

/* ranked list: primary level A1->C2, bank order inside a level.
   rank = 1-based position; ranges are blocks of WM_RANGE_SIZE ranks. */
function wmRankedList(words) {
  if (state.wmRanked && state.wmRankedSrc === words) return state.wmRanked;
  var arr = words.map(function (w, i) { return { w: w, i: i }; });
  arr.sort(function (a, b) {
    var d = (WM_LV_RANK[wmPrimaryLevel(a.w)] || 9) - (WM_LV_RANK[wmPrimaryLevel(b.w)] || 9);
    return d !== 0 ? d : a.i - b.i;
  });
  var ranked = arr.map(function (x) { return x.w; });
  var bySlug = {}, rankOf = {};
  ranked.forEach(function (w, i) {
    var s = wmSlug(w);
    if (!bySlug[s]) { bySlug[s] = w; rankOf[s] = i + 1; }
  });
  state.wmRanked = ranked;
  state.wmRankedSrc = words;
  state.wmBySlug = bySlug;
  state.wmRankOf = rankOf;
  return ranked;
}
function wmRangeCount(total) { return Math.ceil(total / WM_RANGE_SIZE); }
function wmRangeOfRank(rank) { return Math.floor((rank - 1) / WM_RANGE_SIZE); }
function wmFrontierRange(ranked, map) {
  for (var r = 0; r < wmRangeCount(ranked.length); r++) {
    var slice = ranked.slice(r * WM_RANGE_SIZE, (r + 1) * WM_RANGE_SIZE);
    for (var i = 0; i < slice.length; i++) {
      if (!map.words[wmSlug(slice[i])]) return r;
    }
  }
  return wmRangeCount(ranked.length) - 1;
}

function wmTodayStr() {
  var d = new Date();
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function wmAddDays(str, n) {
  var p = str.split('-');
  var d = new Date(+p[0], +p[1] - 1, +p[2] + n);
  function p2(x) { return (x < 10 ? '0' : '') + x; }
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}
function wmRelTime(ts) {
  if (!ts) return 'today';
  var days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  if (days < 365) { var m = Math.floor(days / 30); return m <= 1 ? '1 month ago' : m + ' months ago'; }
  var y = Math.floor(days / 365);
  return y <= 1 ? '1 year ago' : y + ' years ago';
}
function wmTimesWord(n) {
  if (!n) return 'not yet';
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return n + ' times';
}
function wmCounts(map) {
  var c = { uncovered: 0, knew: 0, learn: 0, started: 0, due: 0 };
  var today = wmTodayStr();
  Object.keys(map.words).forEach(function (k) {
    var r = map.words[k];
    if (!r || !r.s) return;
    c.uncovered++;
    if (r.s === 'knew') c.knew++;
    else if (r.s === 'learn') c.learn++;
    else if (r.s === 'started') {
      c.started++;
      if (r.due && r.due <= today) c.due++;
    }
  });
  return c;
}
function wmDueSlugs(map, ranked) {
  var today = wmTodayStr();
  var out = [];
  ranked.forEach(function (w) {
    var s = wmSlug(w), r = map.words[s];
    if (r && r.s === 'started' && r.due && r.due <= today) out.push(s);
  });
  out.sort(function (a, b) {
    var ra = map.words[a], rb = map.words[b];
    if (ra.due !== rb.due) return ra.due < rb.due ? -1 : 1;
    return (state.wmRankOf[a] || 0) - (state.wmRankOf[b] || 0);
  });
  return out;
}
function wmSetStatus(map, slug, status) {
  var r = map.words[slug] || { d: Date.now() };
  r.s = status;
  if (!r.d) r.d = Date.now();
  if (status !== 'started') { r.due = null; }
  map.words[slug] = r;
  return r;
}

function renderWords(v, arg) {
  if (arg === 'test') { renderWordTest(v); return; }
  if (arg === 'discover') { renderDiscover(v); return; }
  if (arg === 'map') { renderWmMapPage(v); return; }
  if (arg === 'learn') { renderWmLearn(v); return; }
  if (arg === 'review') { renderWmReview(v); return; }
  renderWordMap(v);
}

function wmLoading(v) {
  v.innerHTML = '<div class="wm2-wrap"><div class="empty">Loading\u2026</div></div>';
}
function wmLoadFail(v) {
  v.innerHTML = '<div class="wm2-wrap"><div class="empty">Could not load words. Check your connection.</div></div>';
}

/* ---------------- dashboard ---------------- */

function renderWordMap(v) {
  wmLoading(v);
  loadAllWords().then(function (words) {
    var ranked = wmRankedList(words);
    var map = wordMapGet();
    var c = wmCounts(map);
    var total = ranked.length;
    var pct = total ? Math.round(c.uncovered / total * 100) : 0;
    var nm = '';
    try { nm = (state.profile && state.profile.display_name) || (state.user && state.user.email) || ''; } catch (e) { nm = ''; }
    var initial = nm ? nm.trim().charAt(0).toUpperCase() : 'W';
    var fr = wmFrontierRange(ranked, map);
    var frEnd = Math.min((fr + 1) * WM_RANGE_SIZE, total);
    var frWords = ranked.slice(fr * WM_RANGE_SIZE, fr * WM_RANGE_SIZE + 4);
    var dueSlugs = wmDueSlugs(map, ranked);
    var nextLearn = null;
    for (var i = 0; i < ranked.length; i++) {
      var r0 = map.words[wmSlug(ranked[i])];
      if (r0 && r0.s === 'learn') { nextLearn = ranked[i]; break; }
    }
    var html = '<div class="wm2-wrap">' +
      '<div class="wm2-hero">' +
        '<div class="wm2-hero-top"><span class="wm2-ava">' + esc(initial) + '</span>' +
        '<span class="wm2-hero-label">Words<br/>Uncovered</span>' +
        '<span class="wm2-hero-num">' + c.uncovered.toLocaleString() + '</span></div>' +
        '<div class="wm2-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="wm2-counts"><span class="wm2-c-knew">Knew ' + c.knew.toLocaleString() + '</span>' +
        '<span class="wm2-c-right"><span class="wm2-c-learn">To Learn ' + c.learn.toLocaleString() + '</span>' +
        '<span class="wm2-c-started">Started ' + c.started.toLocaleString() + '</span></span></div>' +
      '</div>';
    if (!map.tested) {
      html += '<div class="wm-cta-card"><div class="wm-cta-t">Find your starting point</div>' +
        '<p>Take a quick 30-word test so we can map what you already know.</p>' +
        '<a class="wm-btn wm-btn-primary" href="#/words/test">Start the test</a></div>';
    } else {
      html += '<div class="wm-level-tag">Your level: <b>' + (map.level || 'b1').toUpperCase() + '</b> <a href="#/words/test">retake</a></div>';
    }
    html += '<h2 class="wm2-sec-t">Today\u2019s Reviews</h2>' +
      '<p class="wm2-sec-sub">Words and phrases due for review.</p>' +
      '<div class="wm2-rev-card">';
    if (dueSlugs.length) {
      var thumbs = dueSlugs.slice(0, 4).map(function (s) {
        var w = state.wmBySlug[s];
        return w && w.photo ? '<img src="' + esc(wmPhotoSrc(w)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '';
      }).join('');
      html += '<div class="wm2-rev-row"><span class="wm2-rev-num">' + dueSlugs.length + '</span>' +
        '<span class="wm2-rev-thumbs">' + thumbs + '</span></div>' +
        '<a class="wm2-btn wm2-btn-purple wm2-btn-block" href="#/words/review">Start</a>';
    } else {
      html += '<div class="wm2-rev-none">\u2705 All caught up \u2014 no reviews due today.</div>';
    }
    html += '</div>' +
      '<h2 class="wm2-sec-t">Knowledge Map</h2>' +
      '<p class="wm2-sec-sub">Discover what you need to learn next.</p>' +
      '<div class="wm2-map-cards">' +
        '<div class="wm2-side-card"><div class="wm2-collage">' +
          frWords.map(function (w) {
            return w.photo ? '<img src="' + esc(wmPhotoSrc(w)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '<span></span>';
          }).join('') +
          '</div><a class="wm2-btn wm2-btn-soft wm2-btn-block" href="#/words/discover">\uD83D\uDD0D Discover</a>' +
          '<div class="wm2-side-cap">Range ' + frEnd.toLocaleString() + '</div></div>' +
        '<div class="wm2-side-card">' +
          (nextLearn && nextLearn.photo
            ? '<img class="wm2-next-img" src="' + esc(wmPhotoSrc(nextLearn)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>'
            : '<div class="wm2-next-img wm2-next-empty">\uD83D\uDCDA</div>') +
          (nextLearn
            ? '<a class="wm2-btn wm2-btn-teal wm2-btn-block" href="#/words/learn">\uD83D\uDCD6 Learn</a><div class="wm2-side-cap">Next: ' + esc(nextLearn.word) + '</div>'
            : '<a class="wm2-btn wm2-btn-teal wm2-btn-block" href="#/words/discover">\uD83D\uDCD6 Learn</a><div class="wm2-side-cap">Discover words first</div>') +
        '</div>' +
      '</div>' +
      '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words/map">Open the Knowledge Map \u2192</a>' +
      '<a class="wm-link" href="#/vocab">Browse the word library \u2192</a>' +
      '</div>';
    v.innerHTML = html;
    window.scrollTo(0, 0);
  }).catch(function () { wmLoadFail(v); });
}

/* ---------------- shared word card ---------------- */

function wmCardHTML(w, opts) {
  opts = opts || {};
  var rank = state.wmRankOf[wmSlug(w)] || 0;
  var html = '<div class="wm2-card">' +
    (w.photo ? '<div class="wm2-photo"><img src="' + esc(wmPhotoSrc(w)) + '" alt="" onerror="this.parentNode.style.display=\'none\'"/></div>' : '') +
    '<div class="wm2-card-body">' +
    '<div class="wm2-word-row"><span class="wm2-word">' + esc(w.word) + '</span>' +
    '<span class="wm2-row-btns">' +
    '<button class="save-word-btn wm2-save' + (isWordSaved(w.word, '') ? ' saved' : '') + '" data-action="vc-toggle-save" data-word="' + esc(w.word) + '" aria-label="Bookmark this word" title="Save for later practice"><img src="/icons/bookmark.png" alt=""></button>' +
    (w.audio ? '<button class="wm2-audio" data-wm2-audio aria-label="Play pronunciation">\uD83D\uDD0A</button>' : '') + '</span></div>' +
    '<div class="wm2-phon">' + (w.phonetic ? '/' + esc(w.phonetic) + '/' : '') +
    (rank ? ' <span class="wm2-rank">#' + rank.toLocaleString() + '</span>' : '') +
    (w.pos ? ' <span class="wm2-pos">' + esc(w.pos) + '</span>' : '') + '</div>' +
    '<p class="wm2-mean">' + esc(w.meaning_en || '') + '</p>';
  if (opts.more) {
    html += '<div class="wm2-more-body">' +
      (w.meaning_fa ? '<div class="wm2-mean-fa">' + esc(w.meaning_fa) + '</div>' : '') +
      (w.example_en ? '<div class="wm-ex">\u201C' + esc(w.example_en) + '\u201D</div>' : '') +
      ((w.examples_extra || []).map(function (x) { return '<div class="wm-ex">\u201C' + esc(x) + '\u201D</div>'; }).join('')) +
      ((w.synonyms || []).length ? '<div class="wm-syn"><b>Synonyms:</b> ' + w.synonyms.map(esc).join(', ') + '</div>' : '') +
      ((w.antonyms || []).length ? '<div class="wm-syn"><b>Opposites:</b> ' + w.antonyms.map(esc).join(', ') + '</div>' : '') +
      (w.note_fa ? '<div class="wm-note">\uD83D\uDCA1 ' + esc(w.note_fa) + '</div>' : '') +
      '</div>';
  } else {
    html += '<button class="wm2-more-link" data-wm2-more>Learn more\u2026</button>';
  }
  html += '</div></div>';
  return html;
}
function wmWireCard(v, w, onMore) {
  try { refreshVocabSaveButtons(v); } catch (e) {}
  var a = v.querySelector('[data-wm2-audio]');
  if (a) a.addEventListener('click', function () { playVocabAudio(w.audio); });
  var m = v.querySelector('[data-wm2-more]');
  if (m) m.addEventListener('click', function () { if (onMore) onMore(); });
}
function wmStripHTML(ranked, map, range, selRank) {
  var start = range * WM_RANGE_SIZE;
  var cells = '';
  for (var i = 0; i < WM_RANGE_SIZE; i++) {
    var rank = start + i + 1;
    if (rank > ranked.length) { cells += '<i class="wm2-cell cX"></i>'; continue; }
    var r = map.words[wmSlug(ranked[start + i])];
    var cls = !r ? 'c0' : (r.s === 'learn' ? 'cL' : 'cK');
    cells += '<i class="wm2-cell ' + cls + (rank === selRank ? ' sel' : '') + '" data-wm2-cell="' + rank + '"></i>';
  }
  var end = Math.min(start + WM_RANGE_SIZE, ranked.length);
  return '<div class="wm2-strip-box"><div class="wm2-range-label">Range ' + (start + 1).toLocaleString() + ' \u2013 ' + end.toLocaleString() + '</div>' +
    '<div class="wm2-strip-row"><button class="wm2-arrow" data-wm2-rprev aria-label="Previous range">\u2039</button>' +
    '<div class="wm2-strip">' + cells + '</div>' +
    '<button class="wm2-arrow" data-wm2-rnext aria-label="Next range">\u203A</button></div></div>';
}
function wmMarkButtonsHTML(rec) {
  var note = '';
  if (rec && rec.s === 'started') {
    note = '<div class="wm2-status-note">\uD83D\uDD01 In your reviews' + (rec.due ? ' \u00B7 next ' + esc(rec.due) : '') + '</div>';
  } else if (rec && rec.s === 'knew') {
    note = '<div class="wm2-status-note">\u2705 You marked this as known</div>';
  } else if (rec && rec.s === 'learn') {
    note = '<div class="wm2-status-note">\uD83D\uDCD6 In your learn queue</div>';
  }
  return note + '<div class="wm2-2btn">' +
    '<button class="wm2-btn wm2-btn-purple" data-wm2-mark="learn">Should Learn</button>' +
    '<button class="wm2-btn wm2-btn-teal" data-wm2-mark="knew">Already Knew</button></div>';
}

/* ---------------- knowledge map page ---------------- */

function renderWmMapPage(v) {
  wmLoading(v);
  loadAllWords().then(function (words) {
    var ranked = wmRankedList(words);
    var map = wordMapGet();
    if (!state.wm2) {
      var fr = wmFrontierRange(ranked, map);
      state.wm2 = { range: fr, mode: 'card', sel: fr * WM_RANGE_SIZE + 1 };
    }
    if (state.wm2.range >= wmRangeCount(ranked.length)) state.wm2.range = wmRangeCount(ranked.length) - 1;
    paintWmMap();
    window.scrollTo(0, 0);
  }).catch(function () { wmLoadFail(v); });
}

function paintWmMap() {
  var v = document.getElementById('view');
  var ranked = state.wmRanked;
  var map = wordMapGet();
  var s2 = state.wm2;
  var start = s2.range * WM_RANGE_SIZE;
  var slice = ranked.slice(start, start + WM_RANGE_SIZE);
  var html = '<div class="wm2-wrap">' +
    '<div class="wm2-topbar"><a class="wm2-back" href="#/words">\u2039</a>' +
    '<span class="wm2-top-title">Knowledge Map</span>' +
    '<span class="wm2-view-toggles">' +
    '<button data-wm2-mode="card" aria-label="Card view">\uD83C\uDCCF</button>' +
    '<button data-wm2-mode="grid" aria-label="Grid view">\u25A6</button>' +
    '<button data-wm2-mode="list" aria-label="List view">\u2630</button>' +
    '</span></div>';
  if (s2.mode === 'card') {
    var w = ranked[s2.sel - 1] || slice[0];
    if (w) {
      if (s2.sel < start + 1 || s2.sel > start + slice.length) s2.sel = start + 1;
      w = ranked[s2.sel - 1];
      var rec = map.words[wmSlug(w)];
      html += wmCardHTML(w, { more: !!s2.more }) + wmMarkButtonsHTML(rec);
    }
  } else if (s2.mode === 'grid') {
    html += '<div class="wm2-chips">' + slice.map(function (w) {
      var r = map.words[wmSlug(w)];
      var cls = !r ? 'c0' : (r.s === 'learn' ? 'cL' : 'cK');
      return '<button class="wm2-chip ' + cls + '" data-wm2-chip="' + (state.wmRankOf[wmSlug(w)] || 0) + '">' + esc(w.word) + '</button>';
    }).join('') + '</div>';
  } else {
    html += '<div class="wm2-list">' + slice.map(function (w) {
      var slug = wmSlug(w);
      var r = map.words[slug];
      var st = r ? r.s : '';
      var opts = '<option value=""' + (st === '' ? ' selected' : '') + '>Not seen</option>' +
        '<option value="learn"' + (st === 'learn' ? ' selected' : '') + '>Should Learn</option>' +
        '<option value="knew"' + (st === 'knew' ? ' selected' : '') + '>Already Knew</option>' +
        (st === 'started' ? '<option value="started" selected>In reviews</option>' : '');
      return '<div class="wm2-row">' +
        (w.photo ? '<img src="' + esc(wmPhotoSrc(w)) + '" alt="" loading="lazy" data-wm2-row="' + (state.wmRankOf[slug] || 0) + '" onerror="this.style.display=\'none\'"/>' : '') +
        '<div class="wm2-row-main" data-wm2-row="' + (state.wmRankOf[slug] || 0) + '"><div class="wm2-row-word">' + esc(w.word) + '</div>' +
        '<div class="wm2-row-mean">' + esc(w.meaning_en || '') + '</div></div>' +
        '<select class="wm2-row-sel ' + st + '" data-wm2-sel="' + esc(slug) + '">' + opts + '</select></div>';
    }).join('') + '</div>';
  }
  html += wmStripHTML(ranked, map, s2.range, s2.sel) + '</div>';
  v.innerHTML = html;
  // wire top toggles (mark active)
  Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-mode]'), function (b) {
    if (b.getAttribute('data-wm2-mode') === s2.mode) b.classList.add('on');
    b.addEventListener('click', function () { s2.mode = b.getAttribute('data-wm2-mode'); paintWmMap(); });
  });
  var rp = v.querySelector('[data-wm2-rprev]');
  var rn = v.querySelector('[data-wm2-rnext]');
  if (rp) rp.addEventListener('click', function () { if (s2.range > 0) { s2.range--; s2.sel = s2.range * WM_RANGE_SIZE + 1; s2.more = false; paintWmMap(); } });
  if (rn) rn.addEventListener('click', function () { if (s2.range < wmRangeCount(ranked.length) - 1) { s2.range++; s2.sel = s2.range * WM_RANGE_SIZE + 1; s2.more = false; paintWmMap(); } });
  Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-cell]'), function (c) {
    c.addEventListener('click', function () {
      s2.sel = parseInt(c.getAttribute('data-wm2-cell'), 10);
      s2.mode = 'card'; s2.more = false;
      paintWmMap();
    });
  });
  Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-chip]'), function (c) {
    c.addEventListener('click', function () {
      s2.sel = parseInt(c.getAttribute('data-wm2-chip'), 10);
      s2.mode = 'card'; s2.more = false;
      paintWmMap();
    });
  });
  Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-row]'), function (r) {
    r.addEventListener('click', function () {
      s2.sel = parseInt(r.getAttribute('data-wm2-row'), 10);
      s2.mode = 'card'; s2.more = false;
      paintWmMap();
      window.scrollTo(0, 0);
    });
  });
  Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-sel]'), function (sel) {
    sel.addEventListener('change', function () {
      var m2 = wordMapGet();
      var slug = sel.getAttribute('data-wm2-sel');
      var val = sel.value;
      if (!val) { delete m2.words[slug]; }
      else if (val === 'started') { /* keep as-is */ }
      else { wmSetStatus(m2, slug, val); }
      wordMapSet(m2);
      paintWmMap();
    });
  });
  if (s2.mode === 'card') {
    var w2 = ranked[s2.sel - 1];
    if (w2) {
      wmWireCard(v, w2, function () { s2.more = true; paintWmMap(); });
      Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-mark]'), function (b) {
        b.addEventListener('click', function () {
          var m3 = wordMapGet();
          wmSetStatus(m3, wmSlug(w2), b.getAttribute('data-wm2-mark'));
          wordMapSet(m3);
          // advance to next unseen cell in this range, else next cell
          var nx = s2.sel + 1;
          while (nx <= start + slice.length && m3.words[wmSlug(ranked[nx - 1])]) nx++;
          if (nx > start + slice.length) nx = Math.min(s2.sel + 1, start + slice.length);
          s2.sel = nx; s2.more = false;
          paintWmMap();
        });
      });
    }
  }
}

/* ---------------- discover ---------------- */

function renderDiscover(v) {
  wmLoading(v);
  loadAllWords().then(function (words) {
    var ranked = wmRankedList(words);
    var map = wordMapGet();
    var range = wmFrontierRange(ranked, map);
    var slice = ranked.slice(range * WM_RANGE_SIZE, (range + 1) * WM_RANGE_SIZE);
    var queue = slice.filter(function (w) { return !map.words[wmSlug(w)]; });
    if (!queue.length) {
      v.innerHTML = '<div class="wm2-wrap wm-done"><div class="wm-done-ico">\uD83C\uDF89</div>' +
        '<h2>Everything is mapped!</h2><p class="wm-done-sub">You have seen every word in the bank.</p>' +
        '<a class="wm2-btn wm2-btn-purple wm2-btn-block" href="#/words/map">Open the Knowledge Map</a>' +
        '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words">Back to Word Map</a></div>';
      return;
    }
    state.wdis = { queue: queue, idx: 0, range: range, more: false };
    paintDiscover2();
    window.scrollTo(0, 0);
  }).catch(function () { wmLoadFail(v); });
}

function paintDiscover2() {
  var d = state.wdis; if (!d) return;
  var v = document.getElementById('view');
  var ranked = state.wmRanked;
  var map = wordMapGet();
  if (d.idx >= d.queue.length) {
    v.innerHTML = '<div class="wm2-wrap wm-done"><div class="wm-done-ico">\uD83C\uDF89</div>' +
      '<h2>Range complete!</h2><p class="wm-done-sub">You mapped this whole range of 100 words.</p>' +
      '<a class="wm2-btn wm2-btn-purple wm2-btn-block" href="#/words/discover">Discover the next range \u2192</a>' +
      '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words">Back to Word Map</a></div>';
    window.scrollTo(0, 0);
    return;
  }
  var w = d.queue[d.idx];
  var rank = state.wmRankOf[wmSlug(w)] || 0;
  var html = '<div class="wm2-wrap">' +
    '<div class="wm2-topbar"><a class="wm2-back" href="#/words">\u2715</a>' +
    '<span class="wm2-top-title">Discover</span><span class="wm2-top-count">' + (d.idx + 1) + ' / ' + d.queue.length + '</span></div>' +
    '<div class="wm-test-bar wm2-prog"><i style="width:' + Math.round(d.idx / d.queue.length * 100) + '%"></i></div>' +
    wmCardHTML(w, { more: d.more }) + wmMarkButtonsHTML(null) +
    wmStripHTML(ranked, map, d.range, rank) + '</div>';
  v.innerHTML = html;
  wmWireCard(v, w, function () { d.more = true; paintDiscover2(); });
  Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-mark]'), function (b) {
    b.addEventListener('click', function () {
      var m2 = wordMapGet();
      wmSetStatus(m2, wmSlug(w), b.getAttribute('data-wm2-mark'));
      wordMapSet(m2);
      d.idx++; d.more = false;
      paintDiscover2();
    });
  });
  var rp = v.querySelector('[data-wm2-rprev]');
  var rn = v.querySelector('[data-wm2-rnext]');
  if (rp) rp.style.visibility = 'hidden';
  if (rn) rn.style.visibility = 'hidden';
}

/* ---------------- learn ---------------- */

function wmOptionsFor(w) {
  var lang = (WM_LV_RANK[wmPrimaryLevel(w)] || 9) <= 2 ? 'fa' : 'en';
  var getM = function (x) { return lang === 'fa' ? x.meaning_fa : x.meaning_en; };
  var pool = state.wmRanked.filter(function (x) { return x !== w && getM(x); });
  var distract = shuffleArr(pool.slice()).slice(0, 3);
  var correct = getM(w);
  var options = shuffleArr([correct].concat(distract.map(getM)));
  return { options: options, answer: options.indexOf(correct), lang: lang };
}

function renderWmLearn(v) {
  wmLoading(v);
  loadAllWords().then(function (words) {
    var ranked = wmRankedList(words);
    var map = wordMapGet();
    var queue = [];
    ranked.forEach(function (w) {
      var r = map.words[wmSlug(w)];
      if (r && r.s === 'learn') queue.push(wmSlug(w));
    });
    if (!queue.length) {
      v.innerHTML = '<div class="wm2-wrap wm-done"><div class="wm-done-ico">\uD83D\uDCDA</div>' +
        '<h2>Nothing to learn yet</h2><p class="wm-done-sub">Mark words as \u201CShould Learn\u201D while discovering, then come back here.</p>' +
        '<a class="wm2-btn wm2-btn-purple wm2-btn-block" href="#/words/discover">Discover words \u2192</a>' +
        '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words">Back to Word Map</a></div>';
      return;
    }
    state.wlearn = { queue: queue, idx: 0, phase: 'card', quiz: null, done: 0 };
    paintWmLearn();
    window.scrollTo(0, 0);
  }).catch(function () { wmLoadFail(v); });
}

function paintWmLearn() {
  var L = state.wlearn; if (!L) return;
  var v = document.getElementById('view');
  if (L.idx >= L.queue.length) {
    v.innerHTML = '<div class="wm2-wrap wm-done"><div class="wm-done-ico">\uD83C\uDF89</div>' +
      '<h2>Session complete!</h2><p class="wm-done-sub">' + L.done + ' word' + (L.done === 1 ? '' : 's') + ' started \u2014 first review is tomorrow.</p>' +
      '<a class="wm2-btn wm2-btn-purple wm2-btn-block" href="#/words/learn">Learn more \u2192</a>' +
      '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words">Back to Word Map</a></div>';
    window.scrollTo(0, 0);
    return;
  }
  var slug = L.queue[L.idx];
  var w = state.wmBySlug[slug];
  if (!w) { L.idx++; paintWmLearn(); return; }
  var html = '<div class="wm2-wrap">' +
    '<div class="wm2-topbar"><a class="wm2-back" href="#/words">\u2715</a>' +
    '<span class="wm2-top-title">Learn</span><span class="wm2-top-count">' + (L.idx + 1) + ' / ' + L.queue.length + '</span></div>' +
    '<div class="wm-test-bar wm2-prog"><i style="width:' + Math.round(L.idx / L.queue.length * 100) + '%"></i></div>' +
    wmCardHTML(w, { more: true });
  if (L.phase === 'card') {
    html += '<button class="wm2-btn wm2-btn-purple wm2-btn-block" id="wm2-learn-quiz">Quiz me \u2192</button>';
  } else {
    var q = L.quiz;
    html += '<p class="wm-q">What does it mean?</p><div class="wm-opts">' +
      q.options.map(function (o, i) {
        var cls = 'wm-opt';
        if (q.picked >= 0) {
          if (i === q.answer) cls += ' ok';
          else if (i === q.picked) cls += ' bad';
        }
        return '<button class="' + cls + '" data-wm2-lopt="' + i + '"' + (q.picked >= 0 ? ' disabled' : '') + '>' + esc(o) + '</button>';
      }).join('') + '</div>';
    if (q.picked >= 0) {
      html += '<button class="wm2-btn wm2-btn-purple wm2-btn-block" id="wm2-learn-next">' +
        (q.picked === q.answer ? 'Start this word \u2192' : 'Got it \u2014 start this word \u2192') + '</button>';
    }
  }
  html += '</div>';
  v.innerHTML = html;
  wmWireCard(v, w, null);
  if (L.phase === 'card') {
    document.getElementById('wm2-learn-quiz').addEventListener('click', function () {
      L.quiz = wmOptionsFor(w); L.quiz.picked = -1; L.phase = 'quiz';
      paintWmLearn();
    });
  } else {
    Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-lopt]'), function (b) {
      b.addEventListener('click', function () {
        if (L.quiz.picked >= 0) return;
        L.quiz.picked = parseInt(b.getAttribute('data-wm2-lopt'), 10);
        paintWmLearn();
      });
    });
    var nb = document.getElementById('wm2-learn-next');
    if (nb) nb.addEventListener('click', function () { wmLearnStartWord(); });
  }
}

function wmLearnStartWord() {
  var L = state.wlearn; if (!L) return;
  var slug = L.queue[L.idx];
  var map = wordMapGet();
  var r = map.words[slug] || { d: Date.now() };
  r.s = 'started';
  if (!r.fl) r.fl = Date.now();
  if (typeof r.rem !== 'number') r.rem = 0;
  r.iv = 1;
  r.due = wmAddDays(wmTodayStr(), 1);
  map.words[slug] = r;
  wordMapSet(map);
  L.done++;
  L.idx++;
  L.phase = 'card';
  L.quiz = null;
  paintWmLearn();
}

/* ---------------- review ---------------- */

function renderWmReview(v) {
  wmLoading(v);
  loadAllWords().then(function (words) {
    var ranked = wmRankedList(words);
    var map = wordMapGet();
    var queue = wmDueSlugs(map, ranked);
    if (!queue.length) {
      v.innerHTML = '<div class="wm2-wrap wm-done"><div class="wm-done-ico">\u2705</div>' +
        '<h2>No reviews due</h2><p class="wm-done-sub">You are all caught up for today.</p>' +
        '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words">Back to Word Map</a></div>';
      return;
    }
    state.wrev = { queue: queue, idx: 0, hearts: 5, cur: null, phase: 'q', done: 0, remembered: 0 };
    wmReviewNext();
    window.scrollTo(0, 0);
  }).catch(function () { wmLoadFail(v); });
}

function wmReviewBuildQ(slug) {
  var w = state.wmBySlug[slug];
  var lang = (WM_LV_RANK[wmPrimaryLevel(w)] || 9) <= 2 ? 'fa' : 'en';
  var getM = function (x) { return lang === 'fa' ? x.meaning_fa : x.meaning_en; };
  var map = wordMapGet();
  var startedPool = state.wmRanked.filter(function (x) {
    var r = map.words[wmSlug(x)];
    return x !== w && r && r.s === 'started' && getM(x);
  });
  var distract = shuffleArr(startedPool.slice()).slice(0, 3);
  if (distract.length < 3) {
    var extra = shuffleArr(state.wmRanked.filter(function (x) { return x !== w && getM(x); }).slice()).slice(0, 3 - distract.length);
    distract = distract.concat(extra);
  }
  var correctW = w;
  var cards = shuffleArr([correctW].concat(distract));
  return { w: w, cards: cards, answer: cards.indexOf(correctW), picked: -1, result: null, lang: lang };
}

function wmReviewNext() {
  var R = state.wrev; if (!R) return;
  var v = document.getElementById('view');
  if (R.idx >= R.queue.length || R.hearts <= 0) {
    var out = R.hearts <= 0 && R.idx < R.queue.length;
    v.innerHTML = '<div class="wm2-wrap wm-done"><div class="wm-done-ico">' + (out ? '\uD83D\uDC94' : '\uD83C\uDF89') + '</div>' +
      '<h2>' + (out ? 'Out of hearts!' : 'Reviews done!') + '</h2>' +
      '<p class="wm-done-sub">You reviewed ' + R.done + ' word' + (R.done === 1 ? '' : 's') + ' \u00B7 remembered ' + R.remembered + '.</p>' +
      (out ? '<p class="wm-done-sub">The rest stay due \u2014 come back any time.</p>' : '') +
      '<a class="wm2-btn wm2-btn-purple wm2-btn-block" href="#/words/review">Review again \u21BB</a>' +
      '<a class="wm2-btn wm2-btn-ghost wm2-btn-block" href="#/words">Back to Word Map</a></div>';
    window.scrollTo(0, 0);
    return;
  }
  R.cur = wmReviewBuildQ(R.queue[R.idx]);
  R.phase = 'q';
  paintWmReview();
}

function wmReviewRecommended(R) {
  var cur = R.cur;
  if (!cur || cur.result !== 'good') return 1;
  var map = wordMapGet();
  var rec = map.words[wmSlug(cur.w)] || {};
  var rem = rec.rem || 0;
  var table = [2, 7, 14, 30];
  return table[Math.min(rem, 3)];
}

function paintWmReview() {
  var R = state.wrev; if (!R || !R.cur) return;
  var v = document.getElementById('view');
  var cur = R.cur;
  var w = cur.w;
  var hearts = '';
  for (var i = 0; i < R.hearts; i++) hearts += '\u2764\uFE0F';
  var html = '<div class="wm2-wrap">' +
    '<div class="wm2-topbar"><a class="wm2-back" href="#/words">\u2715</a>' +
    '<span class="wm2-hearts">' + (hearts || '\uD83D\uDC94') + ' ' + R.hearts + '</span>' +
    '<span class="wm2-top-count">' + (R.idx + 1) + ' / ' + R.queue.length + '</span></div>' +
    '<div class="wm2-qword">' + esc(w.word) + '</div>' +
    (w.phonetic ? '<div class="wm2-qphon">/' + esc(w.phonetic) + '/</div>' : '') +
    '<div class="wm2-opts">' +
    cur.cards.map(function (cw, i) {
      var letter = 'ABCD'.charAt(i);
      var cls = 'wm2-opt';
      if (cur.picked >= 0 || cur.result === 'unsure') {
        if (i === cur.answer) cls += ' ok';
        else if (i === cur.picked) cls += ' bad';
        else cls += ' dim';
      }
      var mean = cur.lang === 'fa' ? cw.meaning_fa : cw.meaning_en;
      return '<button class="' + cls + '" data-wm2-ropt="' + i + '"' + (cur.result ? ' disabled' : '') + '>' +
        '<span class="wm2-opt-letter">' + letter + '</span>' +
        (cw.photo ? '<img src="' + esc(wmPhotoSrc(cw)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '') +
        '<span class="wm2-opt-mean">' + esc(mean || '') + '</span></button>';
    }).join('') + '</div>' +
    (cur.result ? '' : '<button class="wm2-notsure" id="wm2-notsure">Not Sure?</button>');
  if (R.phase === 'sched') html += wmReviewSchedHTML(R);
  html += '</div>';
  v.innerHTML = html;
  if (!cur.result) {
    Array.prototype.forEach.call(v.querySelectorAll('[data-wm2-ropt]'), function (b) {
      b.addEventListener('click', function () { wmReviewAnswer(parseInt(b.getAttribute('data-wm2-ropt'), 10)); });
    });
    var ns = document.getElementById('wm2-notsure');
    if (ns) ns.addEventListener('click', function () { wmReviewAnswer(-1); });
  }
  if (R.phase === 'sched') {
    var cont = document.getElementById('wm2-sched-cont');
    if (cont) cont.addEventListener('click', function () { wmReviewSchedule(); });
  }
  window.scrollTo(0, 0);
}

function wmReviewAnswer(i) {
  var R = state.wrev; if (!R || !R.cur || R.cur.result) return;
  var cur = R.cur;
  cur.picked = i;
  if (i === cur.answer) { cur.result = 'good'; }
  else {
    cur.result = i < 0 ? 'unsure' : 'bad';
    R.hearts = Math.max(0, R.hearts - 1);
  }
  R.phase = 'sched';
  paintWmReview();
}

function wmReviewSchedHTML(R) {
  var cur = R.cur;
  var map = wordMapGet();
  var rec = map.words[wmSlug(cur.w)] || {};
  var remAfter = (rec.rem || 0) + (cur.result === 'good' ? 1 : 0);
  var reco = wmReviewRecommended(R);
  var radios = WM_REVIEW_OPTS.map(function (o) {
    var isR = o.d === reco;
    return '<label class="wm2-radio"><input type="radio" name="wm2-iv" value="' + o.d + '"' + (isR ? ' checked' : '') + '/>' +
      '<span class="wm2-radio-dot"></span><span>' + o.label + (isR ? ' (recommended)' : '') + '</span></label>';
  }).join('');
  var segs = '';
  for (var i = 0; i < 10; i++) segs += '<i class="' + (i < remAfter ? 'on' : '') + '"></i>';
  return '<div class="wm2-overlay"><div class="wm2-modal">' +
    '<div class="wm2-modal-word">' + esc(cur.w.word) + '</div>' +
    '<div class="wm2-modal-meta">First learnt: ' + wmRelTime(rec.fl || rec.d) + '</div>' +
    '<div class="wm2-modal-meta">Total remembered: ' + wmTimesWord(remAfter) + '</div>' +
    '<div class="wm2-modal-next">Next review:</div>' + radios +
    '<div class="wm2-segs">' + segs + '</div>' +
    '<div class="wm2-segs-cap">' + (remAfter ? wmTimesWord(remAfter) + ' so far' : 'First review') + '</div>' +
    '<button class="wm2-btn wm2-btn-purple wm2-btn-block" id="wm2-sched-cont">Continue</button>' +
    '</div></div>';
}

function wmReviewSchedule() {
  var R = state.wrev; if (!R || !R.cur) return;
  var cur = R.cur;
  var sel = document.querySelector('input[name="wm2-iv"]:checked');
  var days = sel ? parseInt(sel.value, 10) : wmReviewRecommended(R);
  var map = wordMapGet();
  var slug = wmSlug(cur.w);
  var rec = map.words[slug] || { d: Date.now(), s: 'started' };
  if (cur.result === 'good') { rec.rem = (rec.rem || 0) + 1; R.remembered++; }
  rec.iv = days;
  rec.due = days === 0 ? null : wmAddDays(wmTodayStr(), days);
  rec.last = Date.now();
  map.words[slug] = rec;
  wordMapSet(map);
  R.done++;
  R.idx++;
  R.phase = 'q';
  wmReviewNext();
}

/* ---------------- placement test (kept from v1) ---------------- */

function renderWordTest(v) {
  v.innerHTML = '<div class="wm-wrap"><div class="empty">Loading\u2026</div></div>';
  loadAllWords().then(function (words) {
    wmRankedList(words);
    var items = [];
    WM_LEVELS.forEach(function (lv) {
      var pool = words.filter(function (w) { return wmPrimaryLevel(w) === lv && w.word; });
      shuffleArr(pool).slice(0, 5).forEach(function (w) { items.push({ w: w, lv: lv }); });
    });
    state.wtest = { items: shuffleArr(items), idx: 0, known: {} };
    WM_LEVELS.forEach(function (lv) { state.wtest.known[lv] = 0; });
    paintWordTest();
    window.scrollTo(0, 0);
  });
}

function paintWordTest() {
  var t = state.wtest; if (!t) return;
  var v = document.getElementById('view');
  if (t.idx >= t.items.length) { finishWordTest(); return; }
  var w = t.items[t.idx].w;
  var photo = w.photo ? '<span class="wm-spark" aria-hidden="true"><i></i><i></i><i></i></span><img class="wm-card-img" src="' + esc(wmPhotoSrc(w)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"/>' : '';
  v.innerHTML = '<div class="wm-wrap">' +
    '<div class="wm-test-top"><span>' + (t.idx + 1) + ' / ' + t.items.length + '</span>' +
    '<div class="wm-test-bar"><i style="width:' + Math.round(t.idx / t.items.length * 100) + '%"></i></div></div>' +
    '<div class="wm-card">' + (w.photo ? '<div class="wm-photo-wrap">' + photo + '</div>' : '') +
    '<button class="wm-audio" id="wm-test-audio" aria-label="Play pronunciation">\uD83D\uDD0A</button>' +
    '<div class="wm-word">' + esc(w.word) + '</div>' +
    (w.phonetic ? '<div class="wm-phon">' + esc(w.phonetic) + '</div>' : '') +
    '</div>' +
    '<p class="wm-q">Do you know this word?</p>' +
    '<div class="wm-2btn">' +
    '<button class="wm-btn wm-btn-yes" id="wm-yes">\u2705 I know it</button>' +
    '<button class="wm-btn wm-btn-no" id="wm-no">\u274C I don\u2019t know</button>' +
    '</div></div>';
  document.getElementById('wm-test-audio').addEventListener('click', function () { playVocabAudio(w.audio); });
  document.getElementById('wm-yes').addEventListener('click', function () { wmTestAnswer(true); });
  document.getElementById('wm-no').addEventListener('click', function () { wmTestAnswer(false); });
}

function wmTestAnswer(knows) {
  var t = state.wtest; if (!t) return;
  var it = t.items[t.idx];
  if (knows) t.known[it.lv]++;
  var map = wordMapGet();
  var slug = wmSlug(it.w);
  if (!map.words[slug]) map.words[slug] = { s: knows ? 'knew' : 'learn', d: Date.now() };
  wordMapSet(map);
  t.idx++;
  paintWordTest();
}

function finishWordTest() {
  var t = state.wtest; if (!t) return;
  var est = 'a1';
  WM_LEVELS.forEach(function (lv) { if (t.known[lv] >= 3) est = lv; });
  var map = wordMapGet();
  map.tested = true;
  map.level = est;
  wordMapSet(map);
  state.wtest = null;
  var v = document.getElementById('view');
  var rows = WM_LEVELS.map(function (lv) {
    return '<div class="wm-res-row"><span class="wm-lv" style="background:' + WM_LV_COLORS[lv] + '">' + lv.toUpperCase() + '</span>' +
      '<span>' + t.known[lv] + ' / 5</span></div>';
  }).join('');
  v.innerHTML = '<div class="wm-wrap wm-done">' +
    '<div class="wm-done-ico">\uD83D\uDDFA\uFE0F</div>' +
    '<h2>Your map is started!</h2>' +
    '<p class="wm-done-sub">Estimated level: <b>' + est.toUpperCase() + '</b></p>' +
    '<div class="wm-res">' + rows + '</div>' +
    '<a class="wm-btn wm-btn-primary wm-btn-block" href="#/words/discover">Discover new words \u2192</a>' +
    '<a class="wm-btn wm-btn-ghost wm-btn-block" href="#/words">Back to Word Map</a></div>';
  window.scrollTo(0, 0);
}

/* ---------------- vocabulary home banner ---------------- */

function paintVocabBanner() {
  var wrap = document.getElementById('home-vocab-wrap');
  if (!wrap) return;
  var prog = vocabProgress();
  var doneCount = 0;
  Object.keys(prog).forEach(function (k) { if (prog[k] && prog[k].done) doneCount++; });
  var sub = '9,136 words \u00B7 69 topics \u00B7 A1\u2013C2' + (doneCount ? ' \u00B7 ' + doneCount + ' practised' : '');
  /* Mobile: 2026-10-20 mockup card. Desktop keeps g-banner. */
  if (!isDesktop()) {
    wrap.innerHTML = '<a class="hm-card" href="#/vocab">' +
      '<span class="hm-icon">🗂️</span><span class="hm-main"><span class="hm-kicker">Vocabulary</span>' +
      '<span class="hm-title">Vocabulary Builder</span>' +
      '<span class="hm-subtxt">' + sub + '</span></span>' +
      '<span class="hm-btn hm-btn-soft">Explore →</span></a>';
    return;
  }
  var inner = '<span class="g-b-icon">\uD83D\uDCDA</span><span class="g-b-main"><b>Vocabulary Builder</b>' +
    '<span>' + sub + '</span></span><span class="g-b-cta">Explore \u2192</span>';
  wrap.innerHTML = '<a class="g-banner" href="#/vocab">' + inner + '</a>';
}

function paintWordsBanner() {
  var wrap = document.getElementById('home-words-wrap');
  if (!wrap) return;
  var map = wordMapGet();
  /* Mobile: 2026-10-20 mockup card. Desktop keeps g-banner. */
  if (!isDesktop()) {
    if (map.tested) {
      var n2 = Object.keys(map.words || {}).length;
      wrap.innerHTML = '<a class="hm-card" href="#/words">' +
        '<span class="hm-icon">🗺️</span><span class="hm-main"><span class="hm-kicker">Practice</span>' +
        '<span class="hm-title">Word Map</span>' +
        '<span class="hm-subtxt">' + n2.toLocaleString() + ' words mapped \u00B7 level ' + (map.level || '?').toUpperCase() + '</span></span>' +
        '<span class="hm-btn hm-btn-soft">Continue →</span></a>';
    } else {
      wrap.innerHTML = '<a class="hm-card" href="#/words">' +
        '<span class="hm-icon">🗺️</span><span class="hm-main"><span class="hm-kicker">Practice</span>' +
        '<span class="hm-title">Word Map</span>' +
        '<span class="hm-subtxt">Map your vocabulary \u00B7 9,136 words \u00B7 A1\u2013C2</span></span>' +
        '<span class="hm-btn hm-btn-soft">Start →</span></a>';
    }
    return;
  }
  var inner;
  if (map.tested) {
    var n = Object.keys(map.words || {}).length;
    inner = '<span class="g-b-icon">\uD83D\uDDFA\uFE0F</span><span class="g-b-main"><b>Word Map</b>' +
      '<span>' + n.toLocaleString() + ' words mapped \u00B7 level ' + (map.level || '?').toUpperCase() + '</span></span><span class="g-b-cta">Continue \u2192</span>';
  } else {
    inner = '<span class="g-b-icon">\uD83D\uDDFA\uFE0F</span><span class="g-b-main"><b>Word Map</b>' +
      '<span>Map your vocabulary \u00B7 9,136 words \u00B7 A1\u2013C2</span></span><span class="g-b-cta">Start \u2192</span>';
  }
  wrap.innerHTML = '<a class="g-banner" href="#/words">' + inner + '</a>';
}

function paintSentenceBanner() {
  var wrap = document.getElementById('home-sentence-wrap');
  if (!wrap) return;
  var sub = '9,136 words · tap the words in order · A1–C2';
  /* Mobile: hm-card (2026-10-20 mockup family). Desktop keeps g-banner. */
  if (!isDesktop()) {
    wrap.innerHTML = '<a class="hm-card" href="#/sentences">' +
      '<span class="hm-icon">🧩</span><span class="hm-main"><span class="hm-kicker">Play</span>' +
      '<span class="hm-title">Sentence Builder</span>' +
      '<span class="hm-subtxt">' + sub + '</span></span>' +
      '<span class="hm-btn hm-btn-soft">Play →</span></a>';
    return;
  }
  var inner = '<span class="g-b-icon">🧩</span><span class="g-b-main"><b>Sentence Builder</b>' +
    '<span>' + sub + '</span></span><span class="g-b-cta">Play →</span>';
  wrap.innerHTML = '<a class="g-banner" href="#/sentences">' + inner + '</a>';
}

})();
