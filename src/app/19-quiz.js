/* ---------------- quiz engine ---------------- */
async function startQuiz(kind, dateStr) {
  let m = state.lesson;
  if (dateStr) {
    const found = state.lessons.find(function (x) { return x.date === dateStr; });
    if (found) { m = found; state.lesson = found; }
  }
  let questions = [];
  if (kind === 'word') {
    questions = buildDuoDeck(m);
  } else if (kind === 'grammar') {
    questions = ((m.grammar && m.grammar.quiz) || []).map(function (q) {
      return { question: q.question, options: q.options, answer: q.answer, kind: 'grammar' };
    });
  } else if (kind === 'mistakes') {
    let arr = await getMistakes();
    if (dateStr) arr = arr.filter(function (x) { return x.date === dateStr; });
    /* Never replay a mistake with no options (legacy error/gap saves stored
       options: [] — the question renders with zero choices and the session
       soft-locks on a blank screen, 2026-11-01). */
    arr = arr.filter(function (x) { return Array.isArray(x.options) && x.options.length; });
    /* Spaced graduation: mistakes still resting after a correct answer sit
       out today's session and come back on their due date. */
    arr = arr.filter(function (x) { return mistakeDue(x.id); });
    /* Tricky mistakes keep only their text in storage, so the footer had no
       lesson to link to (his report 2026-11-08). Recover it by matching the
       prompt + option set against the tricky index. */
    let trickyByKey = null;
    if (arr.some(function (x) { return x.kind === 'tricky'; })) {
      try {
        const tItems = await loadTrickyIndex();
        trickyByKey = {};
        tItems.forEach(function (it) {
          if (it.prompt && Array.isArray(it.options)) trickyByKey[it.prompt + '|' + it.options.slice().sort().join('|')] = it;
        });
      } catch (e) {}
    }
    questions = arr.map(function (mk) {
      const q = { question: mk.question, options: mk.options, answer: mk.answer, kind: mk.kind || 'word', mistakeId: mk.id };
      if (trickyByKey && mk.kind === 'tricky' && Array.isArray(mk.options)) {
        const it = trickyByKey[mk.question + '|' + mk.options.slice().sort().join('|')];
        if (it) q.lesson = it.slug ? '#/grammar/' + it.slug : (it.cat === 'phrasal' ? '#/vocab/phrasal-verbs' : null);
      }
      return q;
    });
  } else if (kind === 'saved') {
    if (!m) m = { date: todayStr(), level: (state.user && state.user.level) || '', theme: '' };
    questions = buildSavedDeck(await getSavedWords());
  } else if (kind === 'sentence') {
    if (!m) m = { date: todayStr(), level: (state.user && state.user.level) || '', theme: '' };
    state._sbKey = 'saved';
    questions = buildSentenceDeck(await getSavedWords());
  } else if (kind === 'srs') {
    if (!m) m = { date: todayStr(), level: (state.user && state.user.level) || '', theme: '' };
    const allSaved = await getSavedWords();
    questions = buildSavedDeck(srsDueRows(allSaved), allSaved);
  } else if (kind === 'tricky') {
    m = { date: todayStr(), level: (state.user && state.user.level) || (m && m.level) || '', theme: 'Tricky Bits' };
    questions = await buildTrickyDeck(state._trickyScope || 'all');
    state._trickyScope = null;
  }
  if (!questions.length) return;
  /* Fix 2: resume an in-progress word/grammar quiz instead of restarting it. */
  if (kind === 'word' || kind === 'grammar') {
    const prog = loadQuizProgress(kind, m.date);
    if (prog) { showQuizResumePrompt(kind, m, questions, prog); return; }
  }
  beginQuizSession(kind, m, questions, null);
}

/* Start (or resume) a quiz session. prog = saved progress to resume, or null
   for a brand-new session. Fix 3: new sessions grant hearts by account age
   (30 for <=30 days, 10 after); resumed sessions keep the better of the saved
   hearts and the current daily hearts, so hearts earned in review apply. */
function beginQuizSession(kind, m, questions, prog) {
  let qHearts;
  if (prog) {
    qHearts = Math.max(prog.hearts || 0, getHearts());
  } else if (kind === 'word' || kind === 'grammar' || kind === 'saved' || kind === 'sentence' || kind === 'srs' || kind === 'tricky') {
    qHearts = sessionHeartGrant();
    setHearts(qHearts);
  } else {
    qHearts = 0;
  }
  state.quiz = {
    kind: kind, questions: prog ? prog.questions : questions,
    idx: prog ? prog.idx : 0, correct: prog ? prog.correct : 0,
    log: (prog && prog.log) || [],
    answered: false, picked: -1, wasCorrect: false,
    hearts: qHearts,
    sbKey: kind === 'sentence' ? (state._sbKey || 'saved') : null,
    sbXp: 0,
    date: m.date, level: m.level, theme: m.theme
  };
  state._sbKey = null;
  saveQuizProgress();
  renderQuizView();
}

/* "Continue where you left off?" — shown when re-entering a word/grammar quiz
   with saved in-progress state. Never silently restarts. */
function showQuizResumePrompt(kind, m, freshQuestions, prog) {
  if (document.getElementById('quiz-resume-modal')) return;
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'quiz-resume-modal';
  d.innerHTML = '<div class="duo-modal"><h3>Continue where you left off?</h3>' +
    '<p>You reached question ' + (prog.idx + 1) + ' of ' + prog.questions.length + '.</p>' +
    '<button class="duo-continue btn-block" id="quiz-resume-yes">▶ Continue</button>' +
    '<button class="btn btn-ghost btn-block" id="quiz-resume-no">↺ Start over</button></div>';
  $('#view').appendChild(d);
  document.getElementById('quiz-resume-yes').onclick = function () {
    d.remove();
    beginQuizSession(kind, m, null, prog);
  };
  document.getElementById('quiz-resume-no').onclick = function () {
    d.remove();
    clearQuizProgress(kind, m.date);
    beginQuizSession(kind, m, freshQuestions, null);
  };
}

function renderQuizView() {
  const q = state.quiz;
  /* Fix 4: the mistakes review uses the same full-screen Duolingo-style player
     as the word/grammar quizzes (one question at a time, instant feedback,
     hearts, progress bar, XP/result screen). */
  if (q.kind === 'word' || q.kind === 'assignment' || q.kind === 'grammar' || q.kind === 'mistakes' || q.kind === 'saved' || q.kind === 'sentence' || q.kind === 'srs' || q.kind === 'tricky') { renderDuoQuizView(); return; }
  const v = $('#view');
  const cur = q.questions[q.idx];
  const total = q.questions.length;
  const letters = ['A', 'B', 'C', 'D'];
  let dots = '';
  for (let i = 0; i < total; i++) {
    dots += '<i class="' + (i < q.idx ? 'done' : (i === q.idx ? 'cur' : '')) + '"></i>';
  }
  let html = '<div class="quiz-progress2"><div class="qp-dots">' + dots + '</div>' +
    '<span class="qp-count">' + (q.idx + 1) + ' / ' + total + '</span></div>' +
    '<div class="card quiz-qcard"><div class="quiz-q">' + esc(cur.question) + '</div><div class="quiz-opts">' +
    cur.options.map(function (opt, i) {
      let cls = 'opt2';
      let tick = '';
      if (q.answered) {
        if (i === cur.answer) { cls += ' correct'; tick = '<span class="opt-tick">✓</span>'; }
        else if (i === q.picked) { cls += ' wrong'; tick = '<span class="opt-tick">✗</span>'; }
        else cls += ' dim';
      }
      return '<button class="' + cls + '" data-action="quiz-opt" data-idx="' + i + '"' +
        (q.answered ? ' disabled' : '') + '><span class="opt-key">' + letters[i] + '</span>' +
        '<span class="opt-text">' + esc(opt) + '</span>' + tick + '</button>';
    }).join('') + '</div></div>';

  if (q.answered && cur.explanation) {
    html += '<div class="quiz-explain">💡 ' + esc(cur.explanation) + '</div>';
  }
  if (q.answered) {
    html += '<button class="btn btn-orange btn-block quiz-next" data-action="quiz-next">' +
      (q.idx + 1 < total ? 'Next question <span>→</span>' : 'See my score <span>→</span>') + '</button>';
  }
  v.innerHTML = html;
  window.scrollTo(0, 0);
}

function answerQuiz(idx) {
  const q = state.quiz;
  if (!q || q.answered) return;
  q.answered = true;
  q.picked = idx;
  const cur = q.questions[q.idx];
  if (idx === cur.answer) {
    q.correct++;
    if (q.kind === 'mistakes' && cur.mistakeId) mistakeGrade(cur.mistakeId, true);
  } else if (q.kind === 'mistakes') {
    if (cur.mistakeId) mistakeGrade(cur.mistakeId, false);
  } else if (q.kind !== 'mistakes') {
    saveMistake({
      date: q.date, level: q.level, kind: cur.kind,
      question: cur.question, options: cur.options,
      answer: cur.answer, picked: idx
    });
  }
  if (q.log) q.log.push({ picked: idx, correct: cur.answer });
  renderQuizView();
}

function nextQuiz() {
  const q = state.quiz;
  if (q.idx + 1 < q.questions.length) {
    q.idx++; q.answered = false; q.picked = -1;
    renderQuizView();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  const q = state.quiz;
  document.body.classList.remove('duo-playing');
  /* Fix 2: completion clears the saved in-progress state. */
  if (q && (q.kind === 'word' || q.kind === 'grammar')) clearQuizProgress(q.kind, q.date);
  if (q && q.kind === 'assignment' && q.assignmentId) clearAssignProgress(q.assignmentId);
  const total = q.questions.length;
  const pct = Math.round((q.correct / total) * 100);
  let heartEarned = false;
  const missedSnap = [];
  q.questions.forEach(function (cur, i) {
    const lg = (q.log || [])[i];
    if (lg && lg.picked !== lg.correct && cur.question && Array.isArray(cur.options)) {
      missedSnap.push({ q: cur.question, o: cur.options, a: cur.answer, p: lg.picked });
    }
  });
  saveAttempt({
    date: q.date, level: q.level, theme: q.theme,
    kind: q.kind, score: q.correct, total: total,
    missed: missedSnap.length ? missedSnap.slice(0, 30) : undefined
  });
  bumpStat('quizzes_completed', 1);
  trackEvent('quiz_completed', { kind: q.kind, score: q.correct, total: total, date: q.date, level: q.level, theme: q.theme || '' });
  if (q.kind === 'word') {
    try {
      var wqN = parseInt(localStorage.getItem('el_word_quiz_done') || '0', 10) + 1;
      localStorage.setItem('el_word_quiz_done', String(wqN));
      if (wqN === 1) maybeSoftPushPrompt('quiz');
    } catch (e) {}
  }
  if (q.kind === 'word' && q.date) {
    const firstTime = !((getDayProgress(q.date) || {}).quiz);
    markStep(q.date, 'quiz', { score: q.correct, total: total });
    if (firstTime) {
      /* Rank-climb celebration: snapshot rank before the XP lands, award it,
         then animate the climb. Falls back to the classic celebration when
         the board is unreachable. The classic celebration runs after. */
      state.quiz = null;
      launchRankClimb({ correct: q.correct, total: total, date: q.date, xp: 10 + q.correct, action: 'word_quiz' });
      return;
    }
    awardPoints('word_quiz', 10 + q.correct, q.date);
  } else if (q.kind === 'grammar' && q.date) {
    /* Grammar step = the grammar quiz is finished (2026-10-14 rule). */
    markStep(q.date, 'grammar');
    if (!rkcDone('grammar', q.date)) {
      state.quiz = null;
      launchRankClimb({ correct: q.correct, total: total, date: q.date, xp: 10, action: 'grammar_quiz' });
      return;
    }
    awardPoints('grammar_quiz', 10, q.date);
  } else if (q.kind === 'mistakes') {
    awardPoints('deck_review', 10, q.date || todayStr());
    /* Duolingo loop: reviewing mistakes earns a heart back (max 5/day). */
    heartEarned = getHearts() < 5;
    if (heartEarned) setHearts(getHearts() + 1);
  } else if (q.kind === 'assignment') {
    const aId = q.assignmentId || ('noid-' + (q.date || todayStr()));
    if (!rkcDone('assign', aId)) {
      /* saveAssignmentResult reads state.quiz, so save before nulling it */
      saveAssignmentResult();
      state.quiz = null;
      launchRankClimb({ correct: q.correct, total: total, date: q.date || todayStr(), xp: 10, action: 'assignment_quiz' });
      return;
    }
    awardPoints('assignment_quiz', 10, q.date || todayStr());
    saveAssignmentResult();
  } else if (q.kind === 'tricky') {
    /* XP is per answered question (5 XP each, awarded in duoAnswer). */
  }
  /* Sentence game completion bonus (Alireza, 2026-10-25): +20 once per
     lesson — 'saved' for the Review game, 'cat:<slug>' per bank topic. */
  if (q.kind === 'sentence') {
    const bk = 'sentence_done|' + (q.sbKey || 'saved');
    if (!ptsGet('done')[bk]) q.sbXp = (q.sbXp || 0) + 20;
    awardPoints('sentence_done', 20, q.sbKey || 'saved', true);
  }
  state.quiz = null;
  const praise = pct >= 85 ? 'Excellent work! ✨' : pct >= 60 ? 'Good — keep practicing! 💪' : 'Keep going — you\'ve got this! 📚';
  const xpGain = q.kind === 'word' ? 10 + q.correct : (q.kind === 'sentence' ? (q.sbXp || 0) : (q.kind === 'tricky' ? 5 * (q.trickyAnswered || 0) : 10));
  /* resuming a quiz paused for a hearts review (Fix 2: word/grammar too) */
  const resumeA = (q.kind === 'mistakes' && state.pausedQuiz && state.pausedQuiz.kind !== 'mistakes') ? state.pausedQuiz : null;
  const resumeLabel = resumeA
    ? (resumeA.kind === 'assignment' ? '📝 Continue homework · Q' : '▶ Continue quiz · Q') +
      (resumeA.idx + 1) + '/' + resumeA.questions.length
    : '';
  $('#view').innerHTML =
  '<div class="duo-results"><div class="duo-rcard">' +
    '<div class="duo-hero"><img src="/media/quiz/trophy.png" alt="" loading="lazy"></div>' +
    '<div class="duo-score-big">' + q.correct + '/' + total + '</div>' +
    '<div class="duo-score-sub">' + pct + '% · ' + praise +
    (heartEarned ? '<br>❤️ +1 heart earned!' : '') +
    (q.kind === 'sentence' && !(q.sbXp > 0) ? '<br>⭐ Points already earned — this round was practice' : '') + '</div>' +
    '<div class="duo-pills">' +
      '<div class="duo-pill green"><span class="pi">✓</span><span class="pn">' + q.correct + '</span><span class="pl">correct</span></div>' +
      '<div class="duo-pill red"><span class="pi">✕</span><span class="pn">' + (total - q.correct) + '</span><span class="pl">to review</span></div>' +
      '<div class="duo-pill gold"><span class="pi">★</span><span class="pn">+' + xpGain + '</span><span class="pl">XP</span></div>' +
    '</div>' +
    '<div class="duo-rbtns">' +
      (resumeA ? '<button class="btn duo-btn-review" data-action="resume-paused">' + resumeLabel + '</button>' : '') +
      '<a class="btn duo-btn-home" href="#/home">🏠 Home</a>' +
      '<button class="btn duo-btn-review" data-action="practice-again">🔁 Review →</button>' +
    '</div></div></div>';
  window.scrollTo(0, 0);
}

/* ---------------- Duolingo-style game player (word quiz) ----------------
   Hearts + progress bar + instant feedback + mixed challenge types
   (select / reverse / listen / assist). Grammar & mistakes quizzes keep
   the classic renderer below. */
function shuffleArr(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function heartsKey() {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_hearts_' + email + '_' + todayStr();
}
function getHearts() {
  try {
    const v = parseInt(localStorage.getItem(heartsKey()), 10);
    return isNaN(v) ? 5 : Math.max(0, Math.min(99, v));
  } catch (e) { return 5; }
}
function setHearts(n) {
  try { localStorage.setItem(heartsKey(), String(Math.max(0, Math.min(99, n)))); } catch (e) {}
}

function buildDuoDeck(m) {
  const deck = [];
  (m.quiz || []).forEach(function (q) {
    deck.push({ qtype: 'select', question: q.question, options: q.options.slice(), answer: q.answer, kind: 'word' });
  });
  const words = (m.words || []).filter(function (w) { return w && w.word; });
  function distractors(word, n) {
    return shuffleArr(words.filter(function (x) { return x.word !== word; }))
      .slice(0, n).map(function (x) { return x.word; });
  }
  /* REVERSE: Persian meaning -> English word */
  shuffleArr(words).slice(0, 3).forEach(function (w) {
    if (!w.persian) return;
    const opts = shuffleArr([w.word].concat(distractors(w.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'reverse', question: '\u00AB' + w.persian + '\u00BB به انگلیسی چی میشه؟', rtl: true,
      options: opts, answer: opts.indexOf(w.word), kind: 'word', word: w.word
    });
  });
  /* LISTEN: hear the pronunciation -> pick the word */
  shuffleArr(words.filter(function (w) { return w.word_audio; })).slice(0, 2).forEach(function (w) {
    const opts = shuffleArr([w.word].concat(distractors(w.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'listen', question: 'Which word did you hear?', audio: w.word_audio,
      persian: w.persian,
      options: opts, answer: opts.indexOf(w.word), kind: 'word', word: w.word
    });
  });
  /* ASSIST: tap the words in order to build the example sentence */
  shuffleArr(words.filter(function (w) {
    if (!w.example) return false;
    const n = w.example.replace(/["\u201C\u201D']/g, '').trim().split(/\s+/).length;
    return n >= 4 && n <= 12;
  })).slice(0, 2).forEach(function (w) {
    const tokens = w.example.replace(/["\u201C\u201D']/g, '').trim().split(/\s+/);
    deck.push({
      qtype: 'assist', question: 'Tap the words in order', hint: w.persian,
      tokens: tokens,
      bank: shuffleArr(tokens.map(function (t, i) { return { t: t, k: i }; })),
      placed: [], kind: 'word', word: w.word
    });
  });
  return shuffleArr(deck).slice(0, 14);
}

function duoTopbar(q) {
  const pct = Math.round((q.idx / q.questions.length) * 100);
  /* Mistakes review never costs hearts (it earns them) — hide the counter. */
  const heartsHtml = (q.kind === 'mistakes') ? '' : '<span class="duo-hearts">❤️ ' + q.hearts + '</span>';
  return '<div class="duo-top">' +
    '<button class="duo-x" data-action="duo-exit" aria-label="Quit quiz">✕</button>' +
    '<div class="duo-pbar"><div class="duo-pfill" style="width:' + pct + '%"></div></div>' +
    heartsHtml + '</div>';
}

function duoAssistHTML(q, cur) {
  let html = '<div class="duo-q">' + esc(cur.question) + '</div>';
  if (cur.hint) html += '<div class="duo-hint-wrap"><span class="duo-hint">💡 ' + esc(cur.hint) + '</span></div>';
  html += '<div class="duo-slots">' + (cur.placed.length
    ? cur.placed.map(function (bi) {
      return '<button class="duo-tok' + (cur.hinted && cur.hinted[bi] ? ' hinted' : '') + '" data-action="duo-unpick" data-bi="' + bi + '"' +
        (q.answered ? ' disabled' : '') + '>' + esc(cur.bank[bi].t) + '</button>';
    }).join('')
    : '<span class="duo-slots-empty">Tap the words below…</span>') + '</div>';
  const used = {};
  cur.placed.forEach(function (bi) { used[bi] = true; });
  html += '<div class="duo-bank">' + cur.bank.map(function (b, bi) {
    return '<button class="duo-tok' + (used[bi] ? ' used' : '') + '" data-action="duo-pick" data-bi="' + bi + '"' +
      (used[bi] || q.answered ? ' disabled' : '') + '>' + esc(b.t) + '</button>';
  }).join('') + '</div>';
  if (!q.answered) {
    const ready = cur.placed.length === cur.tokens.length;
    if (q.kind !== 'mistakes' && q.kind !== 'assignment') {
      const canHint = q.hearts > 0 && cur.placed.length < cur.tokens.length;
      html += '<button class="duo-hint-btn" data-action="duo-hint"' + (canHint ? '' : ' disabled') + '>' +
        (q.hearts > 0 ? '\uD83D\uDCA1 Hint <span class="duo-hint-cost">\u22121 \u2764\uFE0F</span>' : '\uD83D\uDCA1 Hint \u2014 no \u2764\uFE0F left') + '</button>';
    }
    html += '<button class="btn btn-block duo-check" data-action="duo-check"' +
      (ready ? '' : ' disabled') + '>CHECK</button>';
  }
  return html;
}

function duoTrayText(q, cur) {
  /* short explanation line shown under the tray title */
  if (q.wasCorrect) {
    if (cur.qtype === 'select') return 'Nice! "' + cur.options[cur.answer] + '" is right.';
    if (cur.qtype === 'reverse' || cur.qtype === 'listen') return 'Well done! 🎉';
    if (cur.qtype === 'typein') return 'Perfect! 🎉';
    return 'Perfect sentence! 🎉';
  }
  if (cur.qtype === 'assist') return cur.tokens.join(' ');
  if (cur.qtype === 'typein') return (cur.accept || []).join(' / ');
  return cur.options[cur.answer];
}

function duoFooter(q, cur) {
  const ok = q.wasCorrect;
  const title = ok ? 'Correct answer!' : (cur.qtype === 'assist' ? 'Not quite!' : 'Correct answer:');
  const ico = ok ? '✓' : '✕';
  const last = q.idx + 1 >= q.questions.length;
  return '<div class="duo-tray-wrap"><div class="duo-tray-inner">' +
    '<div class="duo-tray ' + (ok ? 'ok' : 'bad') + '">' +
    '<span class="duo-tray-ico">' + ico + '</span>' +
    '<div><div class="duo-tray-title">' + title + '</div>' +
    '<div class="duo-tray-text">' + esc(duoTrayText(q, cur)) + '</div></div></div>' +
    ((!ok && cur.explanation) ? '<div class="duo-explain">💡 ' + esc(cur.explanation) + '</div>' : '') +
    ((!ok && cur.kind === 'tricky' && cur.lesson) ? '<a class="duo-lesson-link" href="' + cur.lesson + '">📖 Review the lesson</a>' : '') +
    '<button class="duo-continue ' + (ok ? 'ok' : 'bad') + '" data-action="duo-next">' +
    (last ? 'See my score' : 'Continue') + ' <span>→</span></button>' +
    '</div></div>';
}

/* typein: typed-answer question (v2 gap) */
function duoTypeinHTML(q, cur) {
  const val = cur.typed || '';
  let html = '<div class="duo-q">' + esc(cur.question).replace(/___/g, '…') + '</div>';
  html += '<div class="duo-typein-wrap"><input type="text" id="duo-typein-input" class="duo-typein-input" ' +
    'placeholder="Type your answer…" value="' + esc(val) + '"' + (q.answered ? ' disabled' : '') + ' autocomplete="off"></div>';
  if (!q.answered) {
    html += '<button class="btn btn-block duo-check" data-action="duo-typein-check">CHECK</button>';
  }
  return html;
}
function duoNormalize(s) {
  return String(s || '').trim().toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/\.$/, '');
}
function renderDuoQuizView() {
  const q = state.quiz;
  const v = $('#view');
  document.body.classList.add('duo-playing');
  const cur = q.questions[q.idx];
  const letters = ['A', 'B', 'C', 'D'];
  let html = duoTopbar(q) + '<div class="duo-body">';
  if (cur.qtype === 'assist') {
    html += duoAssistHTML(q, cur);
  } else if (cur.qtype === 'typein') {
    html += duoTypeinHTML(q, cur);
  } else {
    if (cur.qtype === 'listen') {
      html += '<div class="duo-listen"><div class="duo-q">' + esc(cur.question) + '</div>';
      if (!q.answered) {
        html += '<button class="duo-replay" data-action="play-track" data-src="' + esc(cur.audio) +
          '" data-title="' + esc(cur.word) + '">↻ Listen again</button>';
      }
      html += '</div>';
    } else {
      html += '<div class="duo-q"' + (cur.rtl ? ' dir="rtl"' : '') + '>' + esc(cur.question) + '</div>';
    }
    html += '<div class="duo-opts">' + cur.options.map(function (opt, i) {
      let cls = 'duo-opt', badge = '';
      if (q.answered) {
        if (i === cur.answer) { cls += ' ok'; badge = '<span class="opt-badge">✓</span>'; }
        else if (i === q.picked) { cls += ' bad'; badge = '<span class="opt-badge">✕</span>'; }
        else cls += ' dim';
      }
      return '<button class="' + cls + '" data-action="duo-opt" data-idx="' + i + '"' +
        (q.answered ? ' disabled' : '') + '><span class="opt-key">' + letters[i] + '</span>' +
        '<span class="opt-text">' + esc(opt) + '</span>' + badge + '</button>';
    }).join('') + '</div>';
  }
  html += '</div>';
  if (q.answered) html += duoFooter(q, cur);
  v.innerHTML = html;
  window.scrollTo(0, 0);
  if (cur.qtype === 'listen' && !q.answered) playTrack(cur.audio, cur.word);
}

function duoLoseHeart(q) {
  q.hearts = Math.max(0, q.hearts - 1);
  setHearts(q.hearts);
  return q.hearts;
}

/* Chain of pending mistake-saves: the hearts-out "review" button waits for it,
   so a just-lost heart's mistake is always reviewable (no race). */
var duoSavePending = Promise.resolve();

function duoTypeinCheck() {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  if (cur.qtype !== 'typein') return;
  const input = document.getElementById('duo-typein-input');
  const val = input ? input.value : '';
  cur.typed = val;
  q.answered = true;
  const norm = duoNormalize(val);
  const correct = (cur.accept || []).some(function (a) { return duoNormalize(a) === norm; });
  q.wasCorrect = correct;
  q.picked = val; /* store typed text */
  if (cur.kind === 'tricky' && cur.tid) { try { trickyGrade(cur.tid, q.wasCorrect); } catch (e) {} } q.trickyAnswered = (q.trickyAnswered || 0) + 1; try { awardPoints('tricky_q', 5, 'tq-' + cur.tid + '-' + Date.now()); } catch (e) {}
  if (q.log) {
    const entry = { picked: val, correct: correct };
    if (cur.v2) {
      entry.qid = cur.v2.qid;
      entry.points = cur.v2.points;
      entry.type = cur.v2.type;
      entry.response = val;
      entry.isCorrect = correct;
    }
    q.log.push(entry);
  }
  if (correct) {
    q.correct++;
  } else {
    duoSavePending = duoSavePending.catch(function () {}).then(function () {
      return saveDuoMistake(q, cur, val);
    });
    if (duoLoseHeart(q) <= 0) { saveProgressAny(); renderHeartsOut(); return; }
  }
  saveProgressAny();
  renderDuoQuizView();
}
async function duoAnswer(idx) {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  q.answered = true;
  q.picked = idx;
  q.wasCorrect = (idx === cur.answer);
  if (q.log) {
    const entry = { picked: idx, correct: cur.answer };
    if (cur.v2) {
      entry.qid = cur.v2.qid;
      entry.points = cur.v2.points;
      entry.type = cur.v2.type;
      entry.response = idx;
      entry.isCorrect = q.wasCorrect;
    }
    q.log.push(entry);
  }
  /* Saved-word SRS: every bookmark-quiz answer moves the word's schedule. */
  if (cur.kind === 'saved' && cur.word) { try { srsGrade(cur.word, q.wasCorrect); } catch (e) {} }
  if (cur.kind === 'tricky' && cur.tid) { try { trickyGrade(cur.tid, q.wasCorrect); } catch (e) {} } q.trickyAnswered = (q.trickyAnswered || 0) + 1; try { awardPoints('tricky_q', 5, 'tq-' + cur.tid + '-' + Date.now()); } catch (e) {}
  /* listening: answering dismisses the mini-player bar */
  if (cur.qtype === 'listen') closePlayer();
  if (q.wasCorrect) {
    q.correct++;
    /* Spaced graduation: 3 spaced correct answers clear a mistake. */
    if (q.kind === 'mistakes' && cur.mistakeId) mistakeGrade(cur.mistakeId, true);
  } else if (q.kind === 'mistakes') {
    if (cur.mistakeId) mistakeGrade(cur.mistakeId, false);
  } else {
    /* every wrong answer becomes reviewable; chained so the review button never races it.
       (A mistakes-review question is already a mistake: never re-save it, and a
       wrong review answer never costs a heart — Fix 4.) */
    duoSavePending = duoSavePending.catch(function () {}).then(function () {
      return saveDuoMistake(q, cur, idx);
    });
    if (duoLoseHeart(q) <= 0) { saveProgressAny(); renderHeartsOut(); return; }
  }
  saveProgressAny();
  renderDuoQuizView();
}

async function saveDuoMistake(q, cur, picked) {
  const base = { date: q.date, level: q.level, kind: cur.kind || 'word', picked: picked };
  if (cur.qtype === 'select' || cur.qtype === 'reverse') {
    await saveMistake(Object.assign({}, base, {
      question: cur.question, options: cur.options, answer: cur.answer
    }));
  } else if (cur.qtype === 'listen' && cur.persian) {
    await saveMistake(Object.assign({}, base, {
      question: '\u00AB' + cur.persian + '\u00BB به انگلیسی چی میشه؟',
      options: cur.options, answer: cur.answer
    }));
  } else if (cur.qtype === 'typein') {
    await saveMistake(Object.assign({}, base, {
      question: cur.question, options: [], answer: 0,
      typed: picked, accept: cur.accept || []
    }));
  } else if (cur.qtype === 'assist') {
    const correct = cur.tokens.join(' ');
    const seen = {}, distract = [];
    seen[correct] = true;
    let guard = 0;
    while (distract.length < 3 && guard++ < 25) {
      const s = shuffleArr(cur.tokens).join(' ');
      if (!seen[s]) { seen[s] = true; distract.push(s); }
    }
    if (!distract.length) return;
    const opts = shuffleArr([correct].concat(distract));
    await saveMistake(Object.assign({}, base, {
      question: 'Put the words in order:',
      options: opts, answer: opts.indexOf(correct)
    }));
  } else {
    /* plain multiple-choice (e.g. grammar quiz) */
    await saveMistake(Object.assign({}, base, {
      question: cur.question, options: cur.options, answer: cur.answer
    }));
  }
}

function duoPick(bi) {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  if (cur.placed.indexOf(bi) === -1 && cur.placed.length < cur.tokens.length) {
    cur.placed.push(bi);
    renderDuoQuizView();
  }
}

function duoUnpick(bi) {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  cur.placed = cur.placed.filter(function (x) { return x !== bi; });
  if (cur.hinted) delete cur.hinted[bi];
  renderDuoQuizView();
}

/* Sentence Builder hint (Alireza, 2026-11-07): each tap spends 1 heart
   and places the next correct word for the player. The free Persian
   meaning line stays as-is (his call). Sentence games only. */
function duoHint() {
  const q = state.quiz;
  if (!q || q.answered || q.kind === 'mistakes' || q.kind === 'assignment') return;
  const cur = q.questions[q.idx];
  if (!cur || cur.qtype !== 'assist') return;
  if (q.hearts <= 0 || cur.placed.length >= cur.tokens.length) return;
  const need = cur.placed.length;
  let bi = -1;
  for (let i = 0; i < cur.bank.length; i++) {
    if (cur.bank[i].k === need && cur.placed.indexOf(i) === -1) { bi = i; break; }
  }
  if (bi === -1) return;
  duoLoseHeart(q);
  cur.placed.push(bi);
  if (!cur.hinted) cur.hinted = {};
  cur.hinted[bi] = true;
  renderDuoQuizView();
}

function duoCheck() {
  const q = state.quiz;
  if (!q || q.answered) return;
  const cur = q.questions[q.idx];
  if (cur.placed.length !== cur.tokens.length) return;
  const built = cur.placed.map(function (bi) { return cur.bank[bi].t; }).join(' ');
  q.answered = true;
  q.wasCorrect = (built === cur.tokens.join(' '));
  if (q.wasCorrect) q.correct++;
  /* Sentence game XP (Alireza, 2026-10-25): +5 per correct sentence, paid
     ONCE per word ever — awardPoints is idempotent on (action, ref), and the
     local done-mirror drives the results-screen total + already-done notes. */
  if (q.wasCorrect && q.kind === 'sentence' && cur.word) {
    const dk = 'sentence_word|' + cur.word.toLowerCase();
    if (!ptsGet('done')[dk]) q.sbXp = (q.sbXp || 0) + 5;
    awardPoints('sentence_word', 5, cur.word.toLowerCase(), true);
  }
  else if (q.kind !== 'mistakes' && duoLoseHeart(q) <= 0) { saveProgressAny(); renderHeartsOut(); return; }
  saveProgressAny();
  renderDuoQuizView();
}

function duoNext() {
  const q = state.quiz;
  if (!q) return;
  if (q.idx + 1 < q.questions.length) {
    q.idx++; q.answered = false; q.picked = -1; q.wasCorrect = false;
    saveProgressAny();
    renderDuoQuizView();
  } else {
    finishQuiz();
  }
}

function renderHeartsOut() {
  const q = state.quiz;
  document.body.classList.add('duo-playing');
  const done = q.idx + 1;
  $('#view').innerHTML =
    '<div class="duo-out"><div class="duo-out-card"><div class="duo-out-emoji">💔</div>' +
    '<h2>Out of hearts!</h2>' +
    '<p>You got <strong>' + q.correct + ' / ' + done + '</strong> right.</p>' +
    '<div class="duo-out-btns">' +
    '<button class="btn duo-btn-buy" data-action="duo-buy-hearts">⚡ Refill hearts · ' + HEART_REFILL_COST + ' XP</button>' +
    '<div id="duo-buy-note" class="duo-earn-note" style="display:none"></div>' +
    '<button class="btn duo-btn-review" data-action="duo-earn-heart">🔁 Review · earn ❤️</button>' +
    '<div id="duo-earn-note" class="duo-earn-note" style="display:none"></div>' +
    '<button class="btn duo-btn-home" data-action="duo-quit">🏠 Lesson</button>' +
    '</div></div></div>';
  window.scrollTo(0, 0);
}

function duoExit() {
  if (document.getElementById('duo-exit-modal')) return;
  const k = state.quiz && state.quiz.kind;
  const saved = (k === 'assignment' || k === 'word' || k === 'grammar');
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'duo-exit-modal';
  d.innerHTML = '<div class="duo-modal"><h3>Quit this quiz?</h3>' +
    '<p>' + (saved ? 'Your progress is saved — you can continue later.' : 'Your progress will be lost.') + '</p>' +
    '<button class="duo-continue bad btn-block" data-action="duo-quit">Quit</button>' +
    '<button class="btn btn-ghost btn-block" data-action="duo-keep">Keep playing</button></div>';
  $('#view').appendChild(d);
}

function duoQuit() {
  const q = state.quiz;
  const date = q && q.date;
  /* Fix 2: quitting saves progress (resume on re-entry); only completion or
     an explicit "start over" clears it. */
  saveProgressAny();
  state.quiz = null;
  document.body.classList.remove('duo-playing');
  const m = document.getElementById('duo-exit-modal');
  if (m) m.remove();
  try { if (player.el && !player.el.paused) player.el.pause(); } catch (e) {}
  go('lesson', date);
}

function duoKeep() {
  const m = document.getElementById('duo-exit-modal');
  if (m) m.remove();
}

/* Buy a full hearts refill with XP (30 XP). */
var HEART_REFILL_COST = 30;
async function buyHearts(btn) {
  const note = document.getElementById('duo-buy-note');
  const say = function (msg) {
    if (note) { note.textContent = msg; note.style.display = 'block'; }
  };
  const resumeKind = state.quiz && (state.quiz.kind === 'assignment' || state.quiz.kind === 'sentence' || state.quiz.kind === 'tricky') ? state.quiz.kind : null;
  if (btn) btn.disabled = true;
  try {
    await refreshMyPoints();
    const bal = state.myPoints;
    if (typeof bal !== 'number') {
      say('Couldn\'t check your XP — check your connection and try again.');
      if (btn) btn.disabled = false;
      return;
    }
    if (bal < HEART_REFILL_COST) {
      say('Not enough XP — you have ' + bal + ', need ' + HEART_REFILL_COST + '. 💪');
      if (btn) btn.disabled = false;
      return;
    }
    await awardPoints('hearts_refill', -HEART_REFILL_COST, 'hr-' + Date.now(), true);
    await refreshMyPoints();
    /* Refill to the session grant (30 for new accounts, 10 after 30 days). */
    setHearts(sessionHeartGrant());
    say('❤️ Hearts refilled! Starting a new run…');
    setTimeout(function () {
      if (resumeKind && state.quiz && state.quiz.kind === resumeKind) {
        /* resume where it stopped, retrying the heart-killing question */
        const pq = state.quiz;
        if (pq.log && pq.log.length > pq.idx) pq.log.pop();
        pq.answered = false; pq.picked = -1; pq.wasCorrect = false;
        pq.hearts = getHearts();
        document.body.classList.add('duo-playing');
        if (resumeKind === 'assignment') saveAssignProgress(); else saveProgressAny();
        renderDuoQuizView();
      } else {
        startQuiz('word');
      }
    }, 900);
  } catch (e) {
    say('Something went wrong — please try again.');
    if (btn) btn.disabled = false;
  }
}

