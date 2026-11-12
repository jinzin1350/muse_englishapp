/* ---------------- Tricky Bits: easy-to-forget drills + SRS ----------------
   Retention layer for the areas learners keep forgetting (no-rule
   memorisation + L1-interference): phrasal-verb meanings, dependent
   prepositions, articles, -ing/to, fine differences, collocations & pairs.
   Items come from data/tricky/index.json (grammar-bank exercises + the
   phrasal-verbs vocab category + a hand-authored pairs set). Sessions run
   on the duo engine as kind 'tricky'; schedules live in localStorage
   (muse_tricky_v1) with the same interval math as saved-word SRS. */
var TRICKY_CATS = [
  { id: 'phrasal',   ico: '🔗', name: 'Phrasal verbs', desc: 'Meanings you cannot guess from the verb' },
  { id: 'verb-prep', ico: '🧲', name: 'Verb + preposition', desc: 'depend on, listen to, wait for…' },
  { id: 'adj-prep',  ico: '🎯', name: 'Adjective + preposition', desc: 'good at, afraid of, interested in…' },
  { id: 'articles',  ico: '📰', name: 'Articles: a / an / the', desc: 'And when English uses no article at all' },
  { id: 'ing-or-to', ico: '🔀', name: '-ing or to-infinitive', desc: 'enjoy -ing, want to… and meaning changes' },
  { id: 'fine-diff', ico: '⚖️', name: 'Fine differences', desc: 'few / a few, so / such, another / other…' },
  { id: 'quantity',  ico: '🔢', name: 'Quantity', desc: 'much / many, some / any, countable or not' },
  { id: 'ed-ing',    ico: '😴', name: '-ed / -ing adjectives', desc: 'bored or boring? tired or tiring?' },
  { id: 'used-to',   ico: '🕰', name: 'Used to family', desc: 'used to, be used to, get used to' },
  { id: 'in-on-at',  ico: '📍', name: 'in / on / at', desc: 'Prepositions of time and place' },
  { id: 'pairs',     ico: '👯', name: 'Collocations & confusing pairs', desc: 'make or do? say or tell? borrow or lend?' }
];
function trickyCatMeta(id) {
  for (let i = 0; i < TRICKY_CATS.length; i++) if (TRICKY_CATS[i].id === id) return TRICKY_CATS[i];
  return { id: id, ico: '🧠', name: id, desc: '' };
}
var _trickyIndexP = null;
function loadTrickyIndex() {
  if (!_trickyIndexP) {
    _trickyIndexP = fetch('data/tricky/index.json').then(function (r) {
      if (!r.ok) throw new Error('tricky index ' + r.status);
      return r.json();
    }).then(function (j) { return (j && j.items) || []; });
  }
  return _trickyIndexP;
}
function trickyGet() {
  try { return JSON.parse(localStorage.getItem('muse_tricky_v1') || '{}') || {}; }
  catch (e) { return {}; }
}
function trickySet(map) {
  try { localStorage.setItem('muse_tricky_v1', JSON.stringify(map)); } catch (e) {}
  kvSchedulePush('muse_tricky_v1');
}
/* Same grading math as saved-word SRS: correct doubles the interval
   (cap 60 days), wrong restarts at 1 day; due = today + interval. */
function trickyGrade(tid, correct) {
  if (!tid) return;
  const map = trickyGet();
  const e = map[tid] || { i: 1, due: todayStr(), asked: 0, correct: 0 };
  e.asked = (e.asked || 0) + 1;
  if (correct) {
    e.correct = (e.correct || 0) + 1;
    e.i = Math.min((e.i || 1) * 2, 60);
  } else {
    e.i = 1;
  }
  e.due = srsAddDays(todayStr(), e.i);
  map[tid] = e;
  trickySet(map);
}
function trickyPool(items, scope) {
  if (!scope || scope === 'all') return items.slice();
  return items.filter(function (it) { return it.cat === scope; });
}
function trickyDueList(items, scope) {
  const map = trickyGet();
  const t = todayStr();
  return trickyPool(items, scope).filter(function (it) {
    const e = map[it.id];
    return e && e.due <= t;
  }).sort(function (a, b) {
    return (map[a.id].due < map[b.id].due ? -1 : 1);
  });
}
function trickyQuestionFor(it, phrasalPool, gapPools) {
  if (it.type === 'mcq') {
    const pairs = (it.options || []).map(function (op, i) { return { op: op, ok: i === it.answer }; });
    const sh = shuffleArr(pairs);
    return { qtype: 'select', question: it.prompt,
      options: sh.map(function (x) { return x.op; }),
      answer: sh.findIndex(function (x) { return x.ok; }),
      kind: 'tricky', tid: it.id, lesson: it.slug ? '#/grammar/' + it.slug : null };
  }
  if (it.type === 'gap') {
    const correct = (it.accept || [])[0];
    if (!correct) return null;
    const seen = {}; seen[String(correct).toLowerCase()] = 1;
    const ds = [];
    shuffleArr(((gapPools && gapPools[it.cat]) || []).slice()).forEach(function (a) {
      const k = String(a).toLowerCase();
      if (!seen[k] && ds.length < 3) { seen[k] = 1; ds.push(a); }
    });
    if (ds.length < 3) return null;
    const gopts = shuffleArr([{ t: correct, ok: true }].concat(ds.map(function (t) { return { t: t, ok: false }; })));
    return { qtype: 'select', question: it.prompt,
      options: gopts.map(function (x) { return x.t; }),
      answer: gopts.findIndex(function (x) { return x.ok; }),
      kind: 'tricky', tid: it.id, lesson: it.slug ? '#/grammar/' + it.slug : null };
  }
  /* phrasal verb: meaning choice or word choice, language by level */
  const useFa = (it.lv === 'a1' || it.lv === 'a2');
  const getM = function (x) { return useFa ? x.fa : x.en; };
  const others = shuffleArr((phrasalPool || []).filter(function (x) {
    return x.id !== it.id && getM(x);
  })).slice(0, 3);
  if (!others.length) return null;
  if (Math.random() < 0.5) {
    const opts = shuffleArr([{ t: getM(it), ok: true }].concat(others.map(function (x) { return { t: getM(x), ok: false }; })));
    return { qtype: 'select',
      question: 'What does “' + it.word + '” mean?' + (it.ex ? ' — “' + it.ex + '”' : ''),
      options: opts.map(function (x) { return x.t; }),
      answer: opts.findIndex(function (x) { return x.ok; }),
      kind: 'tricky', tid: it.id, lesson: '#/vocab/phrasal-verbs' };
  }
  const opts2 = shuffleArr([{ t: it.word, ok: true }].concat(others.map(function (x) { return { t: x.word, ok: false }; })));
  return { qtype: 'select',
    question: 'Which phrasal verb means: ' + getM(it),
    options: opts2.map(function (x) { return x.t; }),
    answer: opts2.findIndex(function (x) { return x.ok; }),
    kind: 'tricky', tid: it.id, lesson: '#/vocab/phrasal-verbs' };
}
async function buildTrickyDeck(scope) {
  const items = await loadTrickyIndex();
  const pool = trickyPool(items, scope);
  if (!pool.length) return [];
  const map = trickyGet();
  const due = trickyDueList(items, scope);
  let fresh = shuffleArr(pool.filter(function (it) { return !map[it.id]; }));
  let picked = due.slice(0, 12);
  const room = 15 - picked.length;
  if (room > 0) picked = picked.concat(fresh.slice(0, Math.min(5, room)));
  if (!picked.length) {
    /* nothing due and nothing new: pull the soonest reviews forward so a
       session can always start from a non-empty category */
    picked = pool.filter(function (it) { return map[it.id]; })
      .sort(function (a, b) { return (map[a.id].due < map[b.id].due ? -1 : 1); })
      .slice(0, 5);
  }
  const phrasalPool = items.filter(function (x) { return x.type === 'phrasal'; });
  const gapPools = {};
  items.forEach(function (x) {
    if (x.type === 'gap' && x.accept && x.accept[0]) {
      (gapPools[x.cat] = gapPools[x.cat] || []);
      if (gapPools[x.cat].indexOf(x.accept[0]) === -1) gapPools[x.cat].push(x.accept[0]);
    }
  });
  const qs = [];
  shuffleArr(picked).forEach(function (it) {
    const q = trickyQuestionFor(it, phrasalPool, gapPools);
    if (q) qs.push(q);
  });
  return qs;
}
function renderTricky(v, arg) {
  v.innerHTML = '<h1 class="tk-title">🧠 Tricky Bits</h1>' +
    '<p class="tk-sub">Easy to forget — quick daily drills with spaced repetition.</p>' +
    '<div class="empty">Loading drills…</div>';
  loadTrickyIndex().then(function (items) {
    if (!document.querySelector('.tk-title')) return;
    const map = trickyGet();
    const t = todayStr();
    const dueAll = trickyDueList(items, 'all').length;
    let masteredAll = 0, startedAll = 0;
    items.forEach(function (it) { const e = map[it.id]; if (e) { startedAll++; if ((e.i || 0) >= 30) masteredAll++; } });
    let html = '<h1 class="tk-title">🧠 Tricky Bits</h1>' +
      '<p class="tk-sub">Easy to forget — quick daily drills with spaced repetition.</p>' +
      '<div class="tk-hero">' +
      '<div class="tk-hero-main"><span class="tk-due-big">' + dueAll + '</span>' +
      '<span class="tk-due-label">due for review<br><span class="tk-hero-sub">' + startedAll + ' of ' + items.length + ' started · ' + masteredAll + ' mastered</span></span></div>' +
      '<button class="btn tk-go" data-action="tricky-all"' + (dueAll ? '' : ' disabled') + '>▶ Review all due</button></div>';
    TRICKY_CATS.forEach(function (c) {
      const pool = trickyPool(items, c.id);
      if (!pool.length) return;
      let due = 0, fresh = 0, mastered = 0;
      pool.forEach(function (it) {
        const e = map[it.id];
        if (!e) fresh++;
        else {
          if (e.due <= t) due++;
          if ((e.i || 0) >= 30) mastered++;
        }
      });
      const seen = pool.length - fresh;
      const pctSeen = pool.length ? Math.round(seen / pool.length * 100) : 0;
      const pct = pool.length ? Math.round(mastered / pool.length * 100) : 0;
      html += '<div class="tk-row">' +
        '<span class="tk-ico">' + c.ico + '</span>' +
        '<span class="tk-main"><b>' + esc(c.name) + '</b>' +
        '<span class="tk-desc">' + esc(c.desc) + '</span>' +
        '<span class="tk-counts">' + due + ' due · ' + (seen - mastered) + ' learning · ' + fresh + ' new · ' + pool.length + ' total' + (mastered ? ' · ' + mastered + ' mastered' : '') + '</span>' +
        '<span class="tk-bar"><span class="tk-bar-seen" style="width:' + pctSeen + '%"></span><span class="tk-bar-fill" style="width:' + pct + '%"></span></span></span>' +
        '<button class="btn tk-practice" data-action="tricky-cat" data-cat="' + c.id + '">Practice</button></div>';
    });
    v.innerHTML = html;
    window.scrollTo(0, 0);
  }).catch(function () {
    if (!document.querySelector('.tk-title')) return;
    v.innerHTML = '<h1 class="tk-title">🧠 Tricky Bits</h1>' +
      '<div class="empty">Could not load the drills — check your connection and try again.</div>';
  });
}
/* Home daily card (mirrors paintReviewDue): only when drills are due. */
async function paintTrickyDue() {
  const wrap = document.getElementById('home-tricky-wrap');
  if (!wrap) return;
  let items = [];
  try { items = await loadTrickyIndex(); } catch (e) { return; }
  if (!document.getElementById('home-tricky-wrap')) return;
  const due = trickyDueList(items, 'all').length;
  if (!due) { wrap.innerHTML = ''; return; }
  const label = due + ' tricky bit' + (due > 1 ? 's' : '') + ' due for review';
  if (!isDesktop()) {
    wrap.innerHTML = '<div class="hm-card">' +
      '<span class="hm-icon">🧠</span><span class="hm-main"><span class="hm-kicker">TRICKY BITS</span>' +
      '<span class="hm-title">' + label + '</span>' +
      '<span class="hm-subtxt">The easy-to-forget bits — a quick drill keeps them sharp</span></span>' +
      '<button class="hm-btn" data-action="tricky-all">Review →</button></div>';
    return;
  }
  wrap.innerHTML = '<div class="g-banner">' +
    '<span class="g-b-icon">🧠</span><span class="g-b-main"><b>Tricky Bits</b>' +
    '<span>' + label + ' — a quick drill keeps them sharp</span></span>' +
    '<button class="g-b-cta" data-action="tricky-all">Review →</button></div>';
}

/* Home cards for Mistakes + Tricky Bits (his order 2026-11-07: the two
   Review-hub cards also live on the home page, same look, live counts). */
async function paintHomeCards() {
  const wrap = document.getElementById('home-cards-wrap');
  if (!wrap) return;
  let mArr = [];
  try { mArr = await getMistakes(); } catch (e) { mArr = []; }
  if (!document.getElementById('home-cards-wrap')) return;
  wrap.innerHTML =
    reviewActionCard('home-mistakes', 'mistakes', REV_ICONS.mistakes, 'Mistakes to review', mistakesCardDesc(mArr), mistakesDueCount(mArr)) +
    reviewCatCard('#/tricky', 'tricky', REV_ICONS.tricky, 'Tricky Bits', 'The easy-to-forget bits — phrasal verbs, articles, prepositions & pairs', '…', 'home-tricky-count');
  loadTrickyIndex().then(function (items) {
    const tc = document.getElementById('home-tricky-count');
    if (tc) {
      const dN = trickyDueList(items, 'all').length;
      tc.innerHTML = items.length + (dN ? ' <span class="rev-due-pill">' + dN + ' due</span>' : '');
    }
  }).catch(function () {});
}

/* ---------------- vocabulary-page bookmarks ----------------
   Same saved_words store as lesson bookmarks, with lesson_date '' (null in
   the cloud) so vocab saves coexist with per-lesson saves of the same word. */
function findVocabWord(word) {
  const wl = String(word || '').toLowerCase();
  const pools = [];
  if (state.allWords) pools.push(state.allWords);
  if (state.vocabWords) Object.keys(state.vocabWords).forEach(function (k) { pools.push(state.vocabWords[k]); });
  for (let i = 0; i < pools.length; i++) {
    const arr = pools[i] || [];
    for (let j = 0; j < arr.length; j++) {
      if (String(arr[j].word || '').toLowerCase() === wl) return arr[j];
    }
  }
  return null;
}
async function toggleVocabSaveBtn(btn) {
  const word = btn.getAttribute('data-word');
  const w = findVocabWord(word);
  btn.disabled = true;
  let nowSaved = false;
  try {
    nowSaved = await toggleSaveWord(word, '', w ? {
      meaning: w.meaning_en || '', pronunciation: w.phonetic || '', example: w.example_en || '',
      persian: w.meaning_fa || '', pos: w.pos || '', word_audio: w.audio || '', photo: w.photo || '',
      level: (w.levels && w.levels[0]) || ''
    } : null);
    document.querySelectorAll('.save-word-btn[data-action="vc-toggle-save"]').forEach(function (b) {
      if (String(b.getAttribute('data-word') || '').toLowerCase() === String(word || '').toLowerCase()) {
        b.classList.toggle('saved', nowSaved);
      }
    });
  } finally { btn.disabled = false; }
  if (nowSaved) maybeSoftPushPrompt();
}
/* Paint saved state onto vocab word-row bookmark buttons from the store. */
async function refreshVocabSaveButtons(root) {
  const arr = await getSavedWords();
  const set = {};
  arr.forEach(function (x) { if (!x.lesson_date) set[String(x.word || '').toLowerCase()] = 1; });
  (root || document).querySelectorAll('.save-word-btn[data-action="vc-toggle-save"]').forEach(function (b) {
    b.classList.toggle('saved', !!set[String(b.getAttribute('data-word') || '').toLowerCase()]);
  });
}
async function getOverallAverage() {
  return avgOfAttempts(await getAttempts());
}
/* one-time: push this device's local scores/mistakes to the user's cloud rows after login */
async function migrateLocalToCloud() {
  if (!cloudReady()) return;
  try {
    const lm = lsGet('mistakes'), la = lsGet('scores');
    for (const m of lm) { await saveMistake(m); }
    for (const a of la) {
      await sb.from('quiz_attempts').insert({
        user_id: state.user.id, date: a.date || null, level: a.level || null,
        theme: a.theme || null, kind: a.kind || null, score: a.score, total: a.total
      });
    }
    if (lm.length || la.length) { lsSet('mistakes', []); lsSet('scores', []); }
  } catch (e) {}
}

