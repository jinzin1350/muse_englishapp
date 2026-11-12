/* ---------------- My Rewards (Progress tab) ---------------- */
function rewardsPlaceholderHTML() {
  return '<div class="card rewards-card"><div class="section-title" style="margin:0 0 0.4rem"><h2>🏆 My Rewards</h2></div>' +
    '<div id="rewards-body"><p class="muted">Loading…</p></div></div>';
}
function badgeHTML(icon, name, earned) {
  return '<div class="badge' + (earned ? ' earned' : ' locked') + '">' +
    '<span class="badge-icon">' + icon + '</span>' +
    '<span class="badge-name">' + name + '</span>' +
    '<span class="badge-tick">' + (earned ? '✓' : '🔒') + '</span></div>';
}
function shortDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch (e) { return ''; }
}
async function refreshRewardsSection() {
  const body = document.getElementById('rewards-body');
  if (!body || state.view !== 'scores') return;
  try {
    const res = await Promise.all([getMyPoints(), getStreakState(), getMyPrizes()]);
    if (!document.getElementById('rewards-body') || state.view !== 'scores') return;
    const pts = res[0], st = res[1], prizes = res[2];
    const longest = st.longest_streak || 0;
    const hasStar = prizes.some(function (p) { return p.points === 30; });
    const hasFreeze = prizes.some(function (p) { return p.points === 0; });
    let html = '<div class="rewards-top">' +
      '<div class="rewards-stat"><span class="rp-num">' + pts + '</span><span class="rp-label">total points</span></div>' +
      '<div class="rewards-stat"><span class="rp-num">🔥 ' + (st.current_streak || 0) + '</span><span class="rp-label">day streak</span></div>' +
      '<div class="rewards-stat"><span class="rp-num">🎁 ' + prizes.length + '</span><span class="rp-label">prizes won</span></div></div>';
    html += '<div class="badge-row">' +
      badgeHTML('🔥', '7-day streak', longest >= 7) +
      badgeHTML('🔥', '30-day streak', longest >= 30) +
      badgeHTML('🔥', '100-day streak', longest >= 100) +
      badgeHTML('⭐', 'Weekly Star', hasStar) +
      badgeHTML('🧊', 'Freeze Keeper', hasFreeze) + '</div>';
    if (prizes.length) {
      html += '<div class="prize-title">Mystery box prizes</div><div class="prize-list">' +
        prizes.map(function (p) {
          return '<div class="prize-row"><span class="prize-ico">🎁</span>' +
            '<span class="prize-name">' + esc(prizeLabel(p.points)) + '</span>' +
            '<span class="prize-date">' + esc(shortDate(p.created_at)) + '</span></div>';
        }).join('') + '</div>';
    } else {
      html += '<p class="muted" style="margin:0.6rem 0 0">No mystery prizes yet — finish today\'s quiz to earn a Mystery Box! 🎁</p>';
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<p class="muted">Could not load rewards.</p>';
  }
}

/* ---------------- scores view (Progress) ---------------- */
function avgOfAttempts(arr) {
  let c = 0, t = 0;
  arr.forEach(function (a) { c += a.score; t += a.total; });
  return t ? Math.round((c / t) * 100) : null;
}

function renderScores(v) {
  paintScores(v, lsGet('scores'), null);
  if (cloudReady()) {
    const progP = sb.rpc('my_progress').then(function (r) {
      return (r.error || !r.data) ? null : r.data;
    }, function () { return null; });
    const frP = sb.from('profiles').select('streak_freezes').eq('id', state.user.id).maybeSingle().then(function (fr) {
      return (!fr.error && fr.data && fr.data.streak_freezes != null) ? fr.data.streak_freezes : null;
    }, function () { return null; });
    Promise.all([getAttempts(), progP, frP]).then(function (res) {
      if ((state.view !== 'scores' && state.view !== 'progress') || state.quiz) return;
      const prog = res[1];
      if (prog && res[2] != null) prog.streak_freezes = res[2];
      paintScores(v, res[0], prog);
    }).catch(function () { /* keep the local paint */ });
  }
}

function paintScores(v, arr, prog) {
  const avg = avgOfAttempts(arr);
  let html = '<h1 class="tut-anchor">Progress</h1>';
  html += progStatsHTML(prog);
  html += '<div class="section-title"><h2>🏅 My certificates</h2></div>' +
    '<div id="my-certs"><div class="empty">Loading certificates…</div></div>';
  html += '<div class="section-title"><h2>🎯 Grammar check-up</h2></div>' +
    '<div id="gt-progress-card">' + gtestProgressCardHTML(gtestEntries(null)) + '</div>';
  html += rewardsPlaceholderHTML();
  html += '<div class="section-title"><h2>🎙️ Podcast summaries</h2></div>' +
    '<div id="sum-history"><div class="empty">Loading summaries…</div></div>';
  html += '<div class="section-title"><h2>🎤 Shadowing</h2></div>' +
    '<div id="sp-history"><div class="empty">Loading shadowing…</div></div>';
  if (avg !== null) {
    html += '<div class="section-title"><h2>📊 Analytics</h2>' +
      '<button class="btn btn-sm" data-action="ai-report-student">🤖 AI report</button></div>' +
      '<div id="score-analytics"><div class="empty">Loading analytics…</div></div>';
  }
  /* The attempt-history list itself moved to Review → Quiz history
     (Alireza 2026-11-02: "jash onjast"). */
  v.innerHTML = html;
  refreshRewardsSection();
  loadMyCerts();
  loadGTestProgress();
  loadScoreAnalytics();
  loadSummaryHistory();
  loadShadowingStats();
}

/* ---------------- Progress stats (merged 2026-10-09): the old #/progress
   dashboard's stat cards + 7-day XP chart, now in English on the Scores page. - */
var PG_WDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function pgWeekdayLabel(dayStr) {
  try {
    const d = new Date(dayStr + 'T12:00:00');
    return PG_WDAYS_EN[d.getDay()] || '';
  } catch (e) { return ''; }
}
function pgStatCard(ico, num, label) {
  return '<div class="pg-stat"><span class="pg-ico" aria-hidden="true">' + ico + '</span>' +
    '<b class="pg-num">' + num + '</b><span class="pg-lbl">' + label + '</span></div>';
}
function progStatsHTML(d) {
  if (!d || !d.ok) return '';
  const totalXP = Number(d.total_xp) || 0;
  let html = '<div class="pg-grid">' +
    pgStatCard('⚡', totalXP, 'Total XP') +
    pgStatCard('🔥', Number(d.current_streak) || 0, 'Current streak') +
    pgStatCard('🏆', Number(d.longest_streak) || 0, 'Best streak') +
    pgStatCard('📅', Number(d.active_days) || 0, 'Active days') +
    pgStatCard('⏱️', Number(d.total_minutes) || 0, 'Training minutes') +
    pgStatCard('📚', Number(d.saved_words) || 0, 'Saved words') +
    (d.streak_freezes != null ? pgStatCard('🧊', Number(d.streak_freezes) || 0, 'Streak freezes') : '') +
    '</div>';
  const week = Array.isArray(d.week) ? d.week : [];
  const maxXP = Math.max.apply(null, week.map(function (w) { return Number(w.xp) || 0; }).concat([1]));
  html += '<div class="section-title"><h2>📊 Last 7 days</h2></div>';
  if (!week.length || maxXP <= 1) {
    html += '<div class="card plain"><p class="muted" style="margin:0">No activity this week yet — start today! 💪</p></div>';
  } else {
    html += '<div class="card plain"><div class="pg-chart">' + week.map(function (w) {
      const xp = Number(w.xp) || 0;
      const h = Math.max(4, Math.round((xp / maxXP) * 90));
      return '<div class="pg-bar" title="' + esc(String(w.day)) + ': ' + xp + ' XP">' +
        '<div class="pg-fill" style="height:' + h + 'px"></div>' +
        '<div class="pg-xp">' + (xp > 0 ? xp : '') + '</div>' +
        '<div class="pg-d">' + pgWeekdayLabel(String(w.day)) + '</div></div>';
    }).join('') + '</div></div>';
  }
  if (totalXP > 0 && Number(d.active_days) > 0) {
    html += '<div class="card plain pg-note">Average <b>' + Math.round(totalXP / Number(d.active_days)) + ' XP</b> per active day — keep it up! 🔥</div>';
  }
  return html;
}
async function loadScoreAnalytics() {
  const host = document.getElementById('score-analytics');
  if (!host || !cloudReady() || !state.user) return;
  try {
    const pack = await buildStudentPack(state.user.id, false, '');
    if (!document.getElementById('score-analytics')) return;
    state._myPack = pack;
    let html = '';
    const pts = (pack.quizTrend || []).slice().reverse().map(function (x) {
      return { label: String(x.date || '').slice(5), pct: x.total ? Math.round((x.score / x.total) * 100) : 0 };
    });
    if (pts.length >= 2) {
      html += '<div class="card"><div class="an-title">📈 Score trend</div>' + trendChartHTML(pts.slice(-20)) + '</div>';
    }
    if ((pack.topicAccuracy || []).length) {
      html += '<div class="card"><div class="an-title">🎯 Accuracy by topic</div>' + topicBarsHTML(pack.topicAccuracy) + '</div>';
    }
    host.innerHTML = html || '<div class="empty">Do a few quizzes and homework — your analytics will appear here.</div>';
  } catch (e) { host.innerHTML = ''; }
}
/* Podcast summary history (Alireza, 2026-10-15): stat cards (count, spoken
   time, avg + best score) plus an expandable per-attempt mistake review,
   all from the summary_attempts ledger. */
async function loadSummaryHistory() {
  const host = document.getElementById('sum-history');
  if (!host) return;
  if (!cloudReady() || !state.user || !state.user.id || !sb) { host.innerHTML = ''; return; }
  let rows = [];
  try {
    const r = await sb.from('summary_attempts')
      .select('lesson_date,score,duration_sec,transcript,summary,corrections,pronunciation,strengths,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(50);
    if (!r.error) rows = r.data || [];
  } catch (e) { rows = []; }
  if (!document.getElementById('sum-history')) return;
  if (!rows.length) {
    host.innerHTML = '<div class="card plain"><p class="muted" style="margin:0">No summaries yet — record one from the podcast tab! 🎙️</p></div>';
    return;
  }
  const scores = rows.map(function (x) { return Number(x.score) || 0; });
  const totalSec = rows.reduce(function (s, x) { return s + (Number(x.duration_sec) || 0); }, 0);
  const avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
  const best = Math.max.apply(null, scores);
  const mmss = Math.floor(totalSec / 60) + ':' + String(totalSec % 60).padStart(2, '0');
  let html = '<div class="pg-grid">' +
    pgStatCard('🎙️', rows.length, 'Summaries') +
    pgStatCard('⏱️', mmss, 'Spoken') +
    pgStatCard('📊', avg, 'Avg score') +
    pgStatCard('🏆', best, 'Best score') +
    '</div>';
  html += '<div class="sum-hist">' + rows.slice(0, 20).map(function (x) {
    const d = String(x.lesson_date || String(x.created_at || '').slice(0, 10) || '');
    const cor = Array.isArray(x.corrections) ? x.corrections : [];
    const pro = Array.isArray(x.pronunciation) ? x.pronunciation : [];
    let det = '';
    if (x.transcript) det += '<p class="muted" style="font-size:.85rem"><i dir="auto">“' + esc(String(x.transcript).slice(0, 300)) + '”</i></p>';
    if (cor.length) det += '<h4 class="sum-h">🔧 Grammar (' + cor.length + ')</h4>' + cor.slice(0, 5).map(function (c) {
      return '<div class="sum-corr"><div class="sum-wrong">❌ ' + esc(c.wrong || '') + '</div>' +
        '<div class="sum-right">✅ ' + esc(c.right || '') + '</div></div>';
    }).join('');
    if (pro.length) det += '<h4 class="sum-h">🗣️ Pronunciation (' + pro.length + ')</h4>' + pro.slice(0, 5).map(function (p) {
      return '<div class="sum-corr"><div class="sum-wrong">🗣️ “' + esc(p.heard || '') + '” → <b>' + esc(p.likely || '') + '</b></div></div>';
    }).join('');
    if (!det) det = '<p class="muted" style="font-size:.85rem">No mistakes recorded — nice! ✨</p>';
    return '<details class="card sum-hist-item"><summary class="sum-hist-sum"><b>' + (Number(x.score) || 0) + '</b>' +
      '<span class="muted"> · ' + esc(d) + ' · ' + (Number(x.duration_sec) || 0) + 's' +
      (cor.length || pro.length ? ' · ' + (cor.length + pro.length) + ' mistakes' : ' · clean ✨') +
      '</span></summary><div class="sum-hist-det">' + det + '</div></details>';
  }).join('') + '</div>';
  host.innerHTML = html;
}
/* Shadowing stats (Alireza, 2026-10-15): attempts, distinct lessons, distinct
   sentences practiced and average score, from the shadowing_attempts ledger. */
async function loadShadowingStats() {
  const host = document.getElementById('sp-history');
  if (!host) return;
  if (!cloudReady() || !state.user || !state.user.id || !sb) { host.innerHTML = ''; return; }
  let rows = [];
  try {
    const r = await sb.from('shadowing_attempts')
      .select('lesson_date,transcript,score,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(500);
    if (!r.error) rows = r.data || [];
  } catch (e) { rows = []; }
  if (!document.getElementById('sp-history')) return;
  if (!rows.length) {
    host.innerHTML = '<div class="card plain"><p class="muted" style="margin:0">No shadowing yet — practice from the shadowing tab! 🎤</p></div>';
    return;
  }
  const lessons = {}, sents = {};
  let sum = 0;
  rows.forEach(function (x) {
    if (x.lesson_date) lessons[x.lesson_date] = 1;
    const mm = String(x.transcript || '').match(/^\[s(\d+)\]/);
    if (mm) sents[String(x.lesson_date || '') + '#s' + mm[1]] = 1;
    sum += Number(x.score) || 0;
  });
  const avg = Math.round(sum / rows.length);
  host.innerHTML = '<div class="pg-grid">' +
    pgStatCard('🎤', rows.length, 'Attempts') +
    pgStatCard('📚', Object.keys(lessons).length, 'Lessons') +
    pgStatCard('🔤', Object.keys(sents).length, 'Sentences') +
    pgStatCard('📊', avg + '%', 'Avg score') +
    '</div>';
}
async function aiReportStudent(btn) {
  try {
    const pack = state._myPack || await buildStudentPack(state.user.id, false, '');
    state._myPack = pack;
    requestAIReport('student', pack, btn);
  } catch (e) {
    requestAIReport('student', { note: 'no data' }, btn);
  }
}

/* ---------------- review view (mistakes) ---------------- */
function renderMistakes(v, arg) {
  state.reviewArg = (arg === 'words' || arg === 'shadowing' || arg === 'mistakes' || arg === 'history') ? arg : '';
  paintMistakes(v, lsGet('mistakes'), state.reviewArg);
  if (cloudReady()) {
    getMistakes().then(function (arr) {
      if (state.view === 'review' && !state.quiz) paintMistakes(v, arr, state.reviewArg);
    }).catch(function () { /* keep the local paint */ });
  }
}

/* Review is a hub now (Alireza 2026-11-02: the page was too crowded):
   three section cards, each opening its own page — #/review/words,
   #/review/shadowing, #/review/mistakes. */
var REV_ICONS = {
  history: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="2.5" fill="none" stroke="#2E9E5B" stroke-width="1.9"/><path d="M8.2 8.4h7.6M8.2 12h7.6M8.2 15.6h4.8" stroke="#2E9E5B" stroke-width="1.9" stroke-linecap="round"/></svg>',
  words: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M7 2.8h10a1.2 1.2 0 0 1 1.2 1.2v17.2L12 16.9l-6.2 4.3V4A1.2 1.2 0 0 1 7 2.8z" fill="#F0443E"/><path d="M12 5.6l1.25 2.53 2.79.4-2.02 1.97.48 2.78L12 11.97l-2.5 1.31.48-2.78-2.02-1.97 2.79-.4z" fill="#fff"/></svg>',
  shadowing: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><rect x="9" y="2" width="6" height="11.5" rx="3" fill="#2B3350"/><path d="M6 11.2a6 6 0 0 0 12 0" fill="none" stroke="#2B3350" stroke-width="1.9" stroke-linecap="round"/><path d="M12 17.4V21M8.6 21h6.8" stroke="#2B3350" stroke-width="1.9" stroke-linecap="round"/></svg>',
  mistakes: '<svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><rect x="1.6" y="1.6" width="20.8" height="20.8" rx="6" fill="#2F7DE1"/><path d="M7.6 12a4.4 4.4 0 0 1 7.5-3.1M16.4 12a4.4 4.4 0 0 1-7.5 3.1" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><path d="M15.5 5.7v3.4h-3.4M8.5 18.3v-3.4h3.4" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tricky: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#7C3AED"/><path d="M13 4.5 6.8 13h4L9.8 19.5 16.5 10.6h-4.2z" fill="#fff"/></svg>'
};
function reviewActionCard(action, mod, ico, title, desc, count) {
  return '<div class="rev-cat rev-cat-' + mod + '" data-action="' + action + '" role="button" style="cursor:pointer">' +
    '<span class="rev-cat-ico">' + ico + '</span>' +
    '<span class="rev-cat-main"><b>' + title + '</b><span class="rev-cat-desc">' + desc + '</span></span>' +
    '<span class="rev-cat-count">' + count + '</span>' +
    '<span class="rev-cat-arrow">\u203A</span></div>';
}
function reviewCatCard(href, mod, ico, title, desc, count, countId) {
  return '<a class="rev-cat rev-cat-' + mod + '" href="' + href + '">' +
    '<span class="rev-cat-ico">' + ico + '</span>' +
    '<span class="rev-cat-main"><b>' + title + '</b><span class="rev-cat-desc">' + desc + '</span></span>' +
    '<span class="rev-cat-count"' + (countId ? ' id="' + countId + '"' : '') + '>' + count + '</span>' +
    '<span class="rev-cat-arrow">›</span></a>';
}
function paintMistakes(v, arr, arg) {
  if (arg === 'words') {
    v.innerHTML = '<a class="rev-back" href="#/review">‹ Review</a><h1>Saved words</h1>' +
      '<div id="saved-words-sec"><div class="empty">Loading saved words…</div></div>';
    loadSavedWordsSection(true);
    return;
  }
  if (arg === 'shadowing') {
    v.innerHTML = '<a class="rev-back" href="#/review">‹ Review</a><h1>Saved shadowing sentences</h1>' +
      '<div id="saved-sp-sec"></div>';
    loadSavedSpSection(true);
    return;
  }
  if (arg === 'mistakes') {
    let mhtml = '<a class="rev-back" href="#/review">‹ Review</a><h1>Mistakes to review</h1>' +
      '<p class="muted">Words you missed, ready to practice again. Answer each one right 3 times, on different days, and it leaves the list.</p>';
    if (!arr.length) {
      mhtml += '<div class="empty">Nothing to review — nice work! 🎉</div>';
    } else {
      const dueN = arr.filter(function (m) { return mistakeDue(m.id); }).length;
      if (dueN) {
        mhtml += '<button class="review-banner" data-action="practice-again" aria-label="Practice your mistakes">' +
          '<span class="review-banner-count">' + dueN + ' to review</span>' +
        '</button>';
      }
      if (arr.length - dueN > 0) {
        mhtml += '<p class="muted">' + (arr.length - dueN) + ' resting \u2014 they come back after a break, so the fix sticks.</p>';
      }
      mhtml += arr.map(function (m) {
        return '<div class="card plain">' +
          '<div class="mistake-q">' + esc(m.question) + '</div>' +
          '<div class="mistake-a">✅ ' + esc(m.options[m.answer]) + '</div>' +
          (typeof m.picked === 'number' && m.picked !== m.answer
            ? '<div class="mistake-was">You chose: ' + esc(m.options[m.picked]) + '</div>' : '') +
          '<div class="muted" style="margin-top:0.4rem;font-size:0.78rem">' + esc(m.date || '') + ' \u00B7 ' + esc(m.kind || 'word') + ' quiz</div>' +
          '<div class="mistake-srs">' + mistakeDots(m.id) + '</div>' +
        '</div>';
      }).join('');
    }
    v.innerHTML = mhtml;
    return;
  }
  if (arg === 'history') {
    v.innerHTML = '<a class="rev-back" href="#/review">‹ Review</a><h1>Quiz history</h1>' +
      '<div id="att-history"><div class="empty">Loading history…</div></div>';
    loadAttemptHistory();
    return;
  }
  /* Hub: hero + one card per section, nothing else (his design 2026-11-02). */
  const spCount = getSavedSpSentences().length;
  v.innerHTML = '<h1 class="rev-title">Review</h1>' +
    '<div class="rev-hero"><div class="rev-hero-text"><h2>Keep Your English Fresh</h2>' +
    '<p>Practice saved words, shadowing and mistakes.</p></div>' +
    '<img class="rev-hero-img" src="/media/home/mascot-read-book.png" alt=""></div>' +
    reviewCatCard('#/review/words', 'words', REV_ICONS.words, 'Saved words', 'Hard words you bookmarked — practice quiz & sentence game', '…', 'rev-words-count') +
    reviewCatCard('#/tricky', 'tricky', REV_ICONS.tricky, 'Tricky Bits', 'The easy-to-forget bits — phrasal verbs, articles, prepositions & pairs', '…', 'rev-tricky-count') +
    reviewCatCard('#/review/shadowing', 'shadowing', REV_ICONS.shadowing, 'Saved shadowing', 'Sentences you saved to practice aloud', spCount, '') +
    reviewCatCard('#/review/mistakes', 'mistakes', REV_ICONS.mistakes, 'Mistakes to review', mistakesCardDesc(arr), mistakesDueCount(arr), '') +
    reviewCatCard('#/review/history', 'history', REV_ICONS.history, 'Quiz history', 'Every quiz you have taken — tap one for details', '…', 'rev-att-count');
  loadReviewHubCounts();
}
async function loadReviewHubCounts() {
  const el = document.getElementById('rev-words-count');
  if (!el) return;
  const arr = await getSavedWords();
  const cur = document.getElementById('rev-words-count');
  if (cur) {
    const dueN = srsDueCount(arr);
    cur.innerHTML = arr.length + (dueN ? ' <span class="rev-due-pill">' + dueN + ' due</span>' : '');
  }
  loadTrickyIndex().then(function (items) {
    const tc = document.getElementById('rev-tricky-count');
    if (tc) {
      const dN = trickyDueList(items, 'all').length;
      tc.innerHTML = items.length + (dN ? ' <span class="rev-due-pill">' + dN + ' due</span>' : '');
    }
  }).catch(function () {});
  const atts = await getAttempts();
  const ac = document.getElementById('rev-att-count');
  if (ac) ac.textContent = atts.length;
}
/* Quiz history page (moved here from Progress, Alireza 2026-11-02):
   overall average + every attempt card (tap to expand, see
   toggleAttemptDetail). Local paint first, cloud refresh after. */
function paintAttemptHistory(arr) {
  const host = document.getElementById('att-history');
  if (!host) return;
  state._progAttempts = arr;
  const avg = avgOfAttempts(arr);
  if (avg === null) {
    host.innerHTML = '<div class="empty">No quiz attempts yet.<br>Finish a quiz and your history will appear here.</div>';
    return;
  }
  host.innerHTML = '<div class="card avg-card"><div class="avg-num">' + avg + '%</div>' +
    '<div class="muted">overall average · ' + arr.length + ' attempts</div></div>' +
    arr.map(function (a, i) { return attemptCardHTML(a, i); }).join('');
}
async function loadAttemptHistory() {
  paintAttemptHistory(lsGet('scores'));
  if (cloudReady()) {
    try {
      const arr = await getAttempts();
      if (document.getElementById('att-history')) paintAttemptHistory(arr);
    } catch (e) { /* keep the local paint */ }
  }
}

/* Bookmarked words block at the top of Review: list + practice quiz. */
async function loadSavedWordsSection() {
  const host = document.getElementById('saved-words-sec');
  if (!host) return;
  const arr = await getSavedWords();
  host.innerHTML = savedWordsHTML(arr) ||
    '<div class="empty">No saved words yet.<br>Tap the bookmark on a hard word in any lesson and it will wait for you here.</div>';
}
function savedWordsHTML(arr) {
  if (!arr.length) return '';
  const dueRows = srsDueRows(arr);
  const dueKeys = {};
  dueRows.forEach(function (x) { dueKeys[String(x.word || '').toLowerCase()] = 1; });
  const ordered = dueRows.concat(arr.filter(function (x) {
    return !dueKeys[String((x && x.word) || '').toLowerCase()];
  }));
  const practicable = arr.length >= 2;
  const playable = arr.filter(function (x) {
    if (!x || !x.example) return false;
    const n = sentenceTokens(x.example).length;
    return n >= 4 && n <= 12;
  }).length;
  return '<div class="card"><div class="tch-weekly-title"><img src="/icons/bookmark.png" alt="" class="bm-ico"> Saved words <span class="muted">(' + arr.length + ')</span></div>' +
    '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0.6rem">Hard words you bookmarked — review them here, or run a practice quiz.</p>' +
    (dueRows.length
      ? '<div class="srs-due-banner"><span>🔁 <b>' + dueRows.length + ' word' + (dueRows.length > 1 ? 's' : '') + ' due for review</b> — spaced repetition brings them back so they stick.</span>' +
        (practicable ? '<button class="btn btn-sm" data-action="review-due-start">▶ Start review</button>' : '') + '</div>'
      : '') +
    (practicable || playable
      ? '<div style="margin:0 0 0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap">' +
        (practicable ? '<button class="btn btn-sm" data-action="practice-saved">▶ Practice ' + arr.length + ' words</button>' : '') +
        (playable ? '<button class="btn btn-sm" data-action="sentence-game">🧩 Sentence game</button>' : '') +
        (playable && ptsGet('done')['sentence_done|saved'] ? '<span style="font-size:0.78rem;color:#4C9A2A;align-self:center">✓ Completed once — replays are practice</span>' : '') +
        '</div>'
      : '<p class="muted" style="font-size:0.8rem">Bookmark at least 2 words to unlock the practice quiz.</p>') +
    ordered.map(function (x) {
      return '<div class="saved-row">' +
        '<div class="saved-word"><b>' + esc(x.word) + '</b>' +
        (x.pronunciation ? '<span class="muted"> /' + esc(x.pronunciation) + '/</span>' : '') +
        (x.persian ? '<div dir="auto" style="font-size:0.85rem">' + esc(x.persian) + '</div>' : '') +
        (x.meaning ? '<div class="muted" style="font-size:0.82rem">' + esc(x.meaning) + '</div>' : '') +
        (x.example ? '<div style="font-size:0.85rem;font-style:italic;margin-top:0.15rem">“' + esc(x.example) + '”</div>' : '') +
        '<div class="muted" style="font-size:0.75rem">' + esc(x.lesson_date || '') + (x.level ? ' · ' + esc(String(x.level).toUpperCase()) : '') +
        (dueKeys[String((x && x.word) || '').toLowerCase()]
          ? '<span class="srs-chip srs-due">🔁 Due today</span>'
          : '<span class="srs-chip">Next review · ' + esc(srsLabelFor(x)) + '</span>') + '</div></div>' +
        '<div class="saved-actions">' +
        (x.word_audio ? '<button class="speaker-btn" data-action="play-track" data-src="' + esc(x.word_audio) + '" data-title="' + esc(x.word) + '" aria-label="Hear ' + esc(x.word) + '">🔊</button>' : '') +
        '<button class="save-word-btn saved" data-action="unsave-word" data-id="' + esc(x.id || '') + '" data-word="' + esc(x.word) + '" data-date="' + esc(x.lesson_date || '') + '" aria-label="Remove bookmark" title="Remove bookmark"><img src="/icons/bookmark.png" alt=""></button>' +
        '</div></div>';
    }).join('') + '</div>';
}
/* Bookmarked shadowing sentences (Alireza, 2026-10-15): sentences he wants
   to practice more, saved from the shadowing tab via the bookmark button.
   localStorage-only, mirrored on the word-bookmark pattern. Entry:
   { d: lesson date, i: sentence index, t: text, a: audio url }. */
var SP_SAVED_KEY = 'muse_sp_saved_v1';
function getSavedSpSentences() {
  try {
    const arr = JSON.parse(localStorage.getItem(SP_SAVED_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function setSavedSpSentences(arr) {
  try { localStorage.setItem(SP_SAVED_KEY, JSON.stringify(arr || [])); } catch (e) {}
}
function toggleSaveSpSentence(m, sentences, i) {
  const d = (m && m.date) || '';
  const arr = getSavedSpSentences();
  const k = arr.findIndex(function (x) { return x.d === d && x.i === i; });
  if (k !== -1) { arr.splice(k, 1); }
  else {
    const audio = (m.shadowing && m.shadowing.sentence_audio && m.shadowing.sentence_audio[i]) || '';
    arr.unshift({ d: d, i: i, t: (sentences && sentences[i]) || '', a: audio });
  }
  setSavedSpSentences(arr);
  refreshSpSaveButtons(d);
}
function removeSavedSp(date, i) {
  setSavedSpSentences(getSavedSpSentences().filter(function (x) {
    return !(x.d === date && String(x.i) === String(i));
  }));
}
/* Paint the saved state on the shadowing sentence cards (called after the
   list renders; mirrors refreshSavedWordButtons). */
function refreshSpSaveButtons(date) {
  try {
    const list = document.getElementById('sp-sentences');
    if (!list) return;
    const d = date || (state.lesson && state.lesson.date) || '';
    const saved = getSavedSpSentences();
    list.querySelectorAll('.sp-save').forEach(function (b) {
      const i = +b.getAttribute('data-i');
      b.classList.toggle('saved', saved.some(function (x) { return x.d === d && x.i === i; }));
    });
  } catch (e) {}
}
/* Saved-sentences block in Review: list with listen + remove. */
function loadSavedSpSection() {
  const host = document.getElementById('saved-sp-sec');
  if (!host) return;
  host.innerHTML = savedSpHTML(getSavedSpSentences()) ||
    '<div class="empty">No saved sentences yet.<br>Bookmark a sentence in the Shadowing tab and it will wait for you here.</div>';
}
function savedSpHTML(arr) {
  if (!arr.length) return '';
  return '<div class="card"><div class="tch-weekly-title"><img src="/icons/bookmark.png" alt="" class="bm-ico"> Saved shadowing sentences <span class="muted">(' + arr.length + ')</span></div>' +
    '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0.6rem">Sentences you saved for extra practice — tap 🔊 to hear, then say it aloud.</p>' +
    arr.map(function (x) {
      return '<div class="saved-sp-item"><div class="saved-sp-row">' +
        '<div class="saved-word"><div dir="auto">' + esc(x.t) + '</div>' +
        '<div class="muted" style="font-size:0.75rem">' + esc(x.d || '') + ' · sentence ' + (Number(x.i) + 1) + '</div></div>' +
        '<div class="saved-actions">' +
        (x.a
          ? '<button class="speaker-btn" data-action="play-track" data-src="' + esc(x.a) + '" data-title="Saved sentence" aria-label="Hear sentence">🔊</button>'
          : '<button class="speaker-btn" data-action="sp-say-saved" data-text="' + esc(x.t) + '" aria-label="Hear sentence">🔊</button>') +
        '<button class="sp-rec-btn" data-action="sp-practice-saved" data-d="' + esc(x.d || '') + '" data-i="' + x.i + '" data-t="' + esc(x.t) + '" aria-label="Record and practice this sentence" title="Practice aloud"><img src="/icons/sp-rec.png" alt=""></button>' +
        '<button class="save-word-btn saved" data-action="unsave-sp" data-date="' + esc(x.d || '') + '" data-i="' + x.i + '" aria-label="Remove bookmark" title="Remove bookmark"><img src="/icons/bookmark.png" alt=""></button>' +
        '</div></div><div class="sp-saved-result"></div></div>';
    }).join('') + '</div>';
}
/* Inline recording practice for a saved shadowing sentence (Review tab,
   Alireza 2026-10-15): record right here, get the score and word-level
   feedback. Mirrors the shadowing tab's flow — live speech recognition on
   Android/desktop, MediaRecorder -> Whisper on iOS; same scoring bands and
   the same first-attempt-only points rule (shared sp_p_<date> key). */
let savedSpActive = null;
function practiceSavedSentence(btn) {
  if (savedSpActive) {
    const wasBtn = savedSpActive.btn;
    stopSavedSpRec();
    if (wasBtn === btn) return;
  }
  const item = btn.closest('.saved-sp-item');
  if (!item) return;
  const target = btn.getAttribute('data-t') || '';
  const date = btn.getAttribute('data-d') || '';
  const i = parseInt(btn.getAttribute('data-i'), 10) || 0;
  if (!target) return;
  const resBox = item.querySelector('.sp-saved-result');
  if (!resBox) return;
  resBox.innerHTML = '';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const useServerSTT = isIOS && typeof window.MediaRecorder !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!SR && !useServerSTT) {
    resBox.innerHTML = '<div class="empty">🎤 Voice practice needs Chrome or Edge (Android or desktop).</div>';
    return;
  }
  const a = { btn: btn, resBox: resBox, target: target, date: date, i: i,
    saidFinal: '', lastInterim: '', timerId: null, recog: null, rec: null,
    stream: null, chunks: [], uploaded: false, done: false, left: 15 };
  savedSpActive = a;
  btn.classList.add('recording');
  resBox.innerHTML = '<div class="sp-sent-live"><span class="sp-pulse"></span>' +
    '<span class="sp-sent-live-text">🎤 Recording… speak now! (tap 🎤 to stop)</span></div>';
  if (useServerSTT) startSavedSpServer(a); else startSavedSpLive(a);
}
function stopSavedSpRec() {
  const a = savedSpActive;
  if (!a) return;
  savedSpActive = null;
  if (a.timerId) clearInterval(a.timerId);
  a.btn.classList.remove('recording');
  if (a.rec) {
    /* Server path: stopping the recorder fires onstop -> savedSpUpload. */
    try {
      if (a.rec.state !== 'inactive') a.rec.stop();
      else savedSpUpload(a);
    } catch (e) { savedSpUpload(a); }
    try { if (a.stream) a.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    return;
  }
  try { if (a.recog) a.recog.stop(); } catch (e) {}
  finishSavedSp(a, spCollapseRepeats(((a.saidFinal || '') + ' ' + (a.lastInterim || '')).trim()));
}
function startSavedSpLive(a) {
  const r = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  a.recog = r;
  r.lang = 'en-US';
  r.interimResults = true;
  r.continuous = true;
  const liveText = a.resBox.querySelector('.sp-sent-live-text');
  r.onresult = function (ev) {
    if (savedSpActive !== a) return;
    let interim = '';
    for (let k = ev.resultIndex; k < ev.results.length; k++) {
      const tr = ev.results[k][0].transcript;
      if (ev.results[k].isFinal) a.saidFinal = spAppendFinal(a.saidFinal, tr);
      else interim += tr;
    }
    a.lastInterim = interim;
    const t = (a.saidFinal + ' ' + interim).trim();
    if (liveText) liveText.textContent = '🎤 ' + (t || 'Listening…');
  };
  r.onerror = function (ev) {
    if (savedSpActive !== a) return;
    const err = (ev && ev.error) || 'unknown';
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      savedSpActive = null;
      a.btn.classList.remove('recording');
      a.resBox.innerHTML = '<div class="empty">🎤 Microphone blocked — allow microphone access and try again.</div>';
    }
  };
  r.onend = function () { if (savedSpActive === a) stopSavedSpRec(); };
  try { r.start(); }
  catch (e) {
    savedSpActive = null;
    a.btn.classList.remove('recording');
    a.resBox.innerHTML = '<div class="empty">🎤 Could not start recording. Try again.</div>';
    return;
  }
  a.timerId = setInterval(function () {
    if (savedSpActive !== a) return;
    a.left--;
    if (a.left <= 0) stopSavedSpRec();
  }, 1000);
}
function startSavedSpServer(a) {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    if (savedSpActive !== a) {
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      return;
    }
    a.stream = stream;
    let rec;
    try { rec = new MediaRecorder(stream); }
    catch (e) {
      savedSpActive = null;
      a.btn.classList.remove('recording');
      a.resBox.innerHTML = '<div class="empty">🎤 Could not start recording. Try again.</div>';
      return;
    }
    a.rec = rec;
    rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) a.chunks.push(ev.data); };
    rec.onstop = function () { savedSpUpload(a); };
    try { rec.start(250); } catch (e) {}
    a.timerId = setInterval(function () {
      if (savedSpActive !== a) return;
      a.left--;
      if (a.left <= 0) stopSavedSpRec();
    }, 1000);
  }).catch(function () {
    if (savedSpActive === a) {
      savedSpActive = null;
      a.btn.classList.remove('recording');
      a.resBox.innerHTML = '<div class="empty">🎤 Microphone blocked — allow microphone access and try again.</div>';
    }
  });
}
async function savedSpUpload(a) {
  if (a.uploaded) return;
  a.uploaded = true;
  if (a.timerId) clearInterval(a.timerId);
  try { if (a.stream) a.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
  savedSpActive = null;
  a.btn.classList.remove('recording');
  const blob = new Blob(a.chunks, { type: (a.rec && a.rec.mimeType) || 'audio/mp4' });
  a.resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Transcribing…</div>';
  let text = '';
  try {
    const fd = new FormData();
    fd.append('audio', blob, 'speech.mp4');
    const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (r.ok && j && j.text) text = String(j.text);
  } catch (e) {}
  if (!text.trim()) {
    a.resBox.innerHTML = '<div class="empty">🎤 We didn\'t catch any words. Try again.</div>';
    return;
  }
  finishSavedSp(a, spCollapseRepeats(text.trim()));
}
/* Score a saved-sentence attempt: same bands/points/ledger as the lesson tab. */
async function finishSavedSp(a, said) {
  if (a.done) return;
  a.done = true;
  const resBox = a.resBox;
  try {
    said = String(said || '').trim();
    if (!said) {
      resBox.innerHTML = '<div class="empty">🎤 We didn\'t catch any words. Try again.</div>';
      return;
    }
    resBox.innerHTML = '<div class="sp-analyzing"><span class="sp-pulse"></span> 🔍 Analyzing…</div>';
    const pKey = 'sp_p_' + (a.date || 'lesson');
    let scored = [];
    try { scored = JSON.parse(localStorage.getItem(pKey) || '[]'); } catch (e) { scored = []; }
    const wasScored = scored.indexOf(a.i) !== -1;
    /* Real attempt count for the grading tier (the XP ledger above only
       knows scored/not — attempts on saved sentences live in sp_att_). */
    const attKey = 'sp_att_' + (a.date || 'lesson');
    let counts = {};
    try { counts = JSON.parse(localStorage.getItem(attKey) || '{}'); } catch (e) { counts = {}; }
    const prior = counts[a.i] || 0;
    counts[a.i] = prior + 1;
    try { localStorage.setItem(attKey, JSON.stringify(counts)); } catch (e) {}
    const scoring = spScoringFor(prior);
    const an = analyzeSpeech(a.target, said, scoring);
    try { trackEvent('shadowing_attempt', { sentence: a.i + 1, score: an.accuracy, date: a.date || null, attempt: prior + 1, from: 'review' }); } catch (e) {}
    let pts = 0, awarded = false;
    if (an.accuracy >= scoring.greatAt) pts = 5;
    else if (an.accuracy >= scoring.okAt) pts = 3;
    else if (an.accuracy > 0) pts = 1;
    if (state.user && state.user.id && pts > 0 && !wasScored) {
      scored.push(a.i);
      try { localStorage.setItem(pKey, JSON.stringify(scored)); } catch (e) {}
      awardPoints('shadowing_speaking', pts, (a.date || 'lesson') + '#s' + a.i);
      awarded = true;
    }
    resBox.innerHTML = spSentResultHTML(an, said, awarded ? pts : 0);
    resBox.querySelectorAll('.sp-hear').forEach(function (b) {
      b.addEventListener('click', function () {
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(b.getAttribute('data-w'));
          u.lang = 'en-US'; u.rate = 0.85;
          speechSynthesis.speak(u);
        } catch (e) {}
      });
    });
    if (state.user && state.user.id && sb) {
      try {
        await sb.from('shadowing_attempts').insert({
          user_id: state.user.id,
          lesson_date: a.date || null,
          audio_path: '',
          transcript: ('[s' + (a.i + 1) + '] ' + said).slice(0, 2000),
          score: an.accuracy
        });
      } catch (e) { /* table optional */ }
    }
  } catch (e) {
    resBox.innerHTML = '<div class="empty">⚠️ Something went wrong. Try again.</div>';
  }
}
/* Practice quiz built from bookmarked words: Persian->English + listening,
   distractors drawn from the user's own saved pool. */
function buildSavedDeck(arr, pool) {
  const deck = [];
  const words = arr.filter(function (x) { return x && x.word; });
  const poolWords = (pool || arr).filter(function (x) { return x && x.word; });
  const distractors = function (word, n) {
    return shuffleArr(poolWords.filter(function (x) { return x.word !== word; }))
      .slice(0, n).map(function (x) { return x.word; });
  };
  shuffleArr(words.slice()).forEach(function (x) {
    if (!x.persian) return;
    const opts = shuffleArr([x.word].concat(distractors(x.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'reverse', question: '«' + x.persian + '» به انگلیسی چی میشه؟', rtl: true,
      options: opts, answer: opts.indexOf(x.word), kind: 'saved', word: x.word
    });
  });
  shuffleArr(words.filter(function (x) { return x.word_audio; })).slice(0, 3).forEach(function (x) {
    const opts = shuffleArr([x.word].concat(distractors(x.word, 3)));
    if (opts.length < 2) return;
    deck.push({
      qtype: 'listen', question: 'Which word did you hear?', audio: x.word_audio,
      persian: x.persian, options: opts, answer: opts.indexOf(x.word), kind: 'saved', word: x.word
    });
  });
  return shuffleArr(deck).slice(0, 14);
}

/* Sentence game (Alireza, 2026-10-25): every saved word's example sentence
   becomes a "Tap the words in order" puzzle on the duo engine — same assist
   question shape as the teacher-assignment generator. All playable sentences
   (4-12 words) are in the deck, shuffled; no slice, he asked for all of them. */
function sentenceTokens(example) {
  return String(example || '').replace(/["“”']/g, '').trim().split(/\s+/).filter(Boolean);
}
function buildSentenceDeck(arr) {
  const deck = [];
  shuffleArr((arr || []).filter(function (x) { return x && x.word && x.example; }).slice()).forEach(function (x) {
    const tokens = sentenceTokens(x.example);
    if (tokens.length < 4 || tokens.length > 12) return;
    deck.push({
      qtype: 'assist', question: 'Tap the words in order', hint: x.persian,
      tokens: tokens,
      bank: shuffleArr(tokens.map(function (t, i) { return { t: t, k: i }; })),
      placed: [], kind: 'sentence', word: x.word
    });
  });
  return deck;
}
