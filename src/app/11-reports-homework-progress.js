/* ---------------- learning analytics ----------------
   One data pack per student, built only from tables the caller can already
   read (RLS). It feeds BOTH the in-app charts and the /api/report LLM.
   - student: assignments+results, quiz_attempts, mistakes, streak
   - teacher viewing a student: the teacher's own assignments+results for
     that student (quiz_attempts/mistakes are user-private by RLS) */
async function buildStudentPack(studentId, forTeacher, name) {
  const pack = { name: name || '', periodDays: 30, assignments: [], topicAccuracy: [] };
  try {
    let aq = sb.from('assignments')
      .select('id,title,topic_label,level,created_at,questions')
      .contains('student_ids', [studentId])
      .order('created_at', { ascending: false }).limit(40);
    if (forTeacher && state.user) aq = aq.eq('teacher_id', tchViewId());
    const a = await aq;
    if (a.error) throw a.error;
    const assigns = (a.data || []).filter(function (x) { return x.status !== 'scheduled'; });
    const byId = {};
    assigns.forEach(function (x) { byId[x.id] = x; });
    const ids = assigns.map(function (x) { return x.id; });
    let results = [];
    if (ids.length) {
      let rq = sb.from('assignment_results')
        .select('assignment_id,score,total,answers,completed_at')
        .in('assignment_id', ids).order('completed_at', { ascending: false });
      rq = rq.eq('student_id', studentId);
      const r = await rq;
      if (!r.error) results = r.data || [];
    }
    const tacc = {};
    pack.assignments = results.slice(0, 20).map(function (r) {
      const asg = byId[r.assignment_id] || {};
      const qs = asg.questions || [];
      const topic = asg.topic_label || asg.level || '';
      (r.answers || []).forEach(function (an) {
        const t = tacc[topic] || (tacc[topic] = { topic: topic, correct: 0, total: 0 });
        t.total++;
        if (an && an.picked === an.correct) t.correct++;
      });
      const wrong = [];
      (r.answers || []).forEach(function (an, i) {
        if (wrong.length >= 5 || !an || an.picked === an.correct || !qs[i]) return;
        wrong.push({
          q: String(qs[i].q || '').slice(0, 140),
          picked: String((qs[i].options || [])[an.picked] || '').slice(0, 60),
          correct: String((qs[i].options || [])[an.correct] || '').slice(0, 60)
        });
      });
      return {
        topic: topic, level: asg.level || '',
        date: String(r.completed_at || '').slice(0, 10),
        score: r.score, total: r.total, wrong: wrong
      };
    });
    pack.topicAccuracy = Object.keys(tacc).map(function (k) { return tacc[k]; })
      .sort(function (x, y) { return (x.correct / x.total) - (y.correct / y.total); })
      .slice(0, 12);
    /* quiz attempts + open mistakes: the student's own pack always has them;
       a teacher's pack has them once supabase-teacher-read-migration.sql is run
       (RLS denies quietly before that — the catches keep the pack working). */
    try {
      const q = await sb.from('quiz_attempts').select('date,kind,score,total')
        .eq('user_id', studentId).order('created_at', { ascending: false }).limit(40);
      pack.quizTrend = (q.data || []).map(function (x) {
        return { date: String(x.date || '').slice(0, 10), kind: x.kind || '', score: x.score, total: x.total };
      });
    } catch (e) {}
    try {
      const m = await sb.from('mistakes').select('question,kind')
        .eq('user_id', studentId).order('created_at', { ascending: false }).limit(12);
      pack.openMistakes = (m.data || []).map(function (x) {
        return { q: String(x.question || '').slice(0, 120), kind: x.kind || '' };
      });
    } catch (e) {}
  } catch (e) { pack.error = String((e && e.message) || e).slice(0, 120); }
  return pack;
}
/* Simple SVG trend chart: points = [{label, pct}] oldest -> newest */
function trendChartHTML(points) {
  if (!points || points.length < 2) return '';
  const W = 320, H = 90, P = 8;
  const n = points.length;
  const xs = function (i) { return P + (i * (W - 2 * P)) / Math.max(1, n - 1); };
  const ys = function (p) { return H - P - (Math.max(0, Math.min(100, p)) / 100) * (H - 2 * P); };
  const line = points.map(function (pt, i) { return xs(i).toFixed(1) + ',' + ys(pt.pct).toFixed(1); }).join(' ');
  const dots = points.map(function (pt, i) {
    return '<circle cx="' + xs(i).toFixed(1) + '" cy="' + ys(pt.pct).toFixed(1) + '" r="3.2" fill="#f59e0b"/>';
  }).join('');
  return '<svg class="an-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score trend">' +
    '<polyline points="' + line + '" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round"/>' + dots +
    '<text x="' + P + '" y="' + (H - 1) + '" class="an-cl">' + esc(points[0].label) + '</text>' +
    '<text x="' + (W - P) + '" y="' + (H - 1) + '" class="an-cl an-cr">' + esc(points[n - 1].label) + '</text></svg>';
}
function topicBarsHTML(tacc) {
  if (!tacc || !tacc.length) return '';
  return '<div class="an-bars">' + tacc.map(function (t) {
    const pct = t.total ? Math.round((t.correct / t.total) * 100) : 0;
    const cls = pct >= 80 ? 'g' : pct >= 55 ? 'y' : 'r';
    return '<div class="an-barrow"><span class="an-btopic">' + esc(t.topic) + '</span>' +
      '<span class="an-bartrack"><span class="an-barfill ' + cls + '" style="width:' + pct + '%"></span></span>' +
      '<span class="an-bpct">' + pct + '%</span></div>';
  }).join('') + '</div>';
}
function reportTextHTML(text) {  return esc(text).split(/\n{2,}/).map(function (para) {
    return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
  }).join('');
}
async function requestAIReport(kind, pack, btn) {
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ در حال تهیه‌ی گزارش…'; }
  try {
    const r = await fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kind, pack: pack })
    });
    const d = await r.json().catch(function () { return null; });
    if (!r.ok || !d || !d.report) throw new Error((d && d.error) || 'failed');
    showModal('<div class="rpt"><div class="rpt-head">🤖 گزارش پیشرفت</div>' +
      '<div class="rpt-body">' + reportTextHTML(d.report) + '</div>' +
      '<button class="btn btn-ghost btn-block" data-action="modal-close">بستن</button></div>');
  } catch (e) {
    showModal('<div class="rpt"><div class="rpt-head">🤖 گزارش پیشرفت</div>' +
      '<div class="empty">نتونستم گزارش رو بسازم — ' + esc(e.message || 'دوباره تلاش کن.') + '</div>' +
      '<button class="btn btn-ghost btn-block" data-action="modal-close">بستن</button></div>');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

/* ---- student: homework card, list, player ---- */
async function refreshHomeworkCard() {
  const host = document.getElementById('home-hw-wrap');
  if (!host || !cloudReady() || !state.user || state.user.demo) return;
  try {
    let ids;
    try {
      const a = await sb.from('assignments').select('id,status')
        .contains('student_ids', [state.user.id]).limit(50);
      if (a.error) throw a.error;
      ids = (a.data || []).filter(function (x) { return x.status !== 'scheduled'; }).map(function (x) { return x.id; });
    } catch (e2) {
      /* pre-scheduling-migration fallback */
      const a = await sb.from('assignments').select('id')
        .contains('student_ids', [state.user.id]).limit(50);
      ids = (a.data || []).map(function (x) { return x.id; });
    }
    if (!ids.length) { host.innerHTML = ''; return; }
    const r = await sb.from('assignment_results').select('assignment_id')
      .eq('student_id', state.user.id).in('assignment_id', ids);
    const done = {};
    (r.data || []).forEach(function (x) { done[x.assignment_id] = true; });
    const pending = ids.filter(function (id) { return !done[id]; }).length;
    host.innerHTML = pending
      ? '<a class="hw-banner" href="#/homework" aria-label="Open homework">📝 <b>' + pending + '</b> assignment' +
        (pending > 1 ? 's' : '') + ' from your teacher <span>→</span></a>'
      : '';
  } catch (e) { /* leave empty on failure */ }
}
async function renderHomework(v) {
  v.innerHTML = '<div class="hw2-wrap"><h1 class="hw2-title"><span aria-hidden="true">📝</span> Homework</h1>' +
    '<div id="hw-list"><div class="empty">Loading…</div></div></div>';
  window.scrollTo(0, 0);
  if (!cloudReady()) {
    document.getElementById('hw-list').innerHTML = '<div class="empty">Sign in to see your assignments.</div>';
    return;
  }
  try {
    const a = await sb.from('assignments').select('*')
      .contains('student_ids', [state.user.id]).order('created_at', { ascending: false }).limit(30);
    let rows = a.data || [];
    /* scheduled (not yet sent) assignments stay invisible until send time.
       JS-side filter: safe before the scheduling migration is run. */
    rows = rows.filter(function (x) { return x.status !== 'scheduled'; });
    const r = await sb.from('assignment_results')
      .select('assignment_id,score,total,completed_at').eq('student_id', state.user.id);
    const done = {};
    (r.data || []).forEach(function (x) { done[x.assignment_id] = x; });
    state.homeworkList = rows;
    const host = document.getElementById('hw-list');
    if (!host) return;
    host.innerHTML = rows.length ? rows.map(function (x, i) {
      const res = done[x.id];
      const lvl = (x.level || '').toUpperCase();
      const isExam = x.kind === 'exam';
      const kindIco = isExam ? '📋' : '📝';
      const name = x.topic_label || x.title;
      return '<div class="hw2-card">' +
        '<div class="hw2-deco" aria-hidden="true">' +
        '<svg viewBox="0 0 220 150"><g fill="none" stroke="#d97b2b" stroke-width="5" stroke-linecap="round" opacity="0.10">' +
        '<path d="M110 45 C 90 32, 60 32, 40 40 L40 115 C 60 107, 90 107, 110 120 C 130 107, 160 107, 180 115 L180 40 C 160 32, 130 32, 110 45 Z"/>' +
        '<path d="M110 45 L110 120"/></g>' +
        '<g stroke="#d97b2b" stroke-width="4" stroke-linecap="round" opacity="0.14">' +
        '<path d="M170 22 l0 14 M163 29 l14 0"/><path d="M196 62 l0 10 M191 67 l10 0"/></g></svg></div>' +
        '<div class="hw2-top"><span class="hw2-ico">' + kindIco + '</span>' +
        '<div class="hw2-head"><div class="hw2-name">' + esc(name) + '</div>' +
        (lvl ? '<span class="hw2-lvl">' + esc(lvl) + '</span>' : '') +
        (isExam ? '<span class="hw2-lvl">EXAM</span>' : '') + '</div></div>' +
        '<div class="hw2-meta">From ' + esc(x.teacher_name || 'your teacher') +
        (x.deadline ? ' · due ' + esc(x.deadline) : '') +
        (x.note ? '<br>💬 ' + esc(x.note) : '') + '</div>' +
        (res ? '<div class="hw2-done">✓ Done · <b>' + res.score + '/' + res.total + '</b></div>'
             : '<button class="hw2-cta" data-action="assignment-start" data-i="' + i + '">Start · ' +
               x.question_count + ' questions<span class="hw2-go">›</span></button>') +
      '</div>';
    }).join('') : '<div class="empty">No assignments yet — enjoy the calm. 🌱</div>';
  } catch (e) {
    const host = document.getElementById('hw-list');
    if (host) host.innerHTML = '<div class="empty">Could not load assignments.</div>';
  }
}
/* ---- Assignment progress persistence ----
   A student who runs out of hearts, goes to review, and comes back must
   resume the exam where they left off — never from question 1. */
function assignProgKey(aid) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_assign_prog_' + email + '_' + aid;
}
function saveAssignProgress() {
  const q = state.quiz;
  if (!q || q.kind !== 'assignment' || !q.assignmentId) return;
  try {
    localStorage.setItem(assignProgKey(q.assignmentId), JSON.stringify({
      idx: q.idx, correct: q.correct, log: q.log || [], savedAt: Date.now()
    }));
  } catch (e) {}
}
function loadAssignProgress(aid) {
  try {
    const v = JSON.parse(localStorage.getItem(assignProgKey(aid)) || 'null');
    return (v && typeof v.idx === 'number' && v.idx > 0) ? v : null;
  } catch (e) { return null; }
}
function clearAssignProgress(aid) {
  try { localStorage.removeItem(assignProgKey(aid)); } catch (e) {}
}
/* ---- Word/grammar quiz progress persistence (Fix 2) ----
   Same idea as assignments: a student who runs out of hearts, exits to earn
   more in review, and comes back must resume where they left off — never from
   question 1. The full question set is saved because buildDuoDeck() shuffles,
   so a rebuilt deck would not match. Saved on every question transition and
   on exit/pause; cleared only on completion or explicit "start over". */
function quizProgKey(kind, date) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_quizprog_' + email + '_' + kind + '_' + (date || todayStr());
}
function saveQuizProgress() {
  const q = state.quiz;
  if (!q || (q.kind !== 'word' && q.kind !== 'grammar')) return;
  try {
    localStorage.setItem(quizProgKey(q.kind, q.date), JSON.stringify({
      questions: q.questions, idx: q.idx, correct: q.correct,
      hearts: q.hearts, log: q.log || [], kind: q.kind, date: q.date,
      level: q.level, theme: q.theme, savedAt: Date.now()
    }));
  } catch (e) {}
}
function loadQuizProgress(kind, date) {
  try {
    const v = JSON.parse(localStorage.getItem(quizProgKey(kind, date || todayStr())) || 'null');
    /* Only resume if the student actually progressed (idx > 0); a fresh
       session saved at question 1 must not trigger the resume prompt. */
    if (v && v.questions && v.questions.length &&
        typeof v.idx === 'number' && v.idx > 0 && v.idx < v.questions.length) return v;
    return null;
  } catch (e) { return null; }
}
function clearQuizProgress(kind, date) {
  try { localStorage.removeItem(quizProgKey(kind, date || todayStr())); } catch (e) {}
}
/* Save whichever quiz progress applies (assignment and/or word/grammar). */
function saveProgressAny() {
  saveAssignProgress();
  saveQuizProgress();
}
/* ---- Hearts policy by account age (Fix 3) ----
   Every NEW quiz session grants hearts based on account age: 30 hearts for
   accounts <= 30 days old, 10 hearts after that. Per-session grant, not daily.
   Resumed sessions keep their progress (see beginQuizSession). */
function accountAgeDays() {
  try {
    const u = state.user;
    if (u && u.createdAt) {
      const ms = Date.now() - new Date(u.createdAt).getTime();
      if (!isNaN(ms) && ms >= 0) return ms / 86400000;
    }
    // Fallback: first-seen marker (generous default -> 30 hearts).
    const k = 'el_first_seen_' + (u && u.id ? u.id : 'anon');
    let fs = null;
    try { fs = localStorage.getItem(k); } catch (e) {}
    if (!fs) {
      fs = new Date().toISOString();
      try { localStorage.setItem(k, fs); } catch (e) {}
      return 0;
    }
    const ms2 = Date.now() - new Date(fs).getTime();
    return (isNaN(ms2) || ms2 < 0) ? 0 : ms2 / 86400000;
  } catch (e) { return 0; }
}
function sessionHeartGrant() {
  return accountAgeDays() <= 30 ? 30 : 10;
}
function startAssignment(i) {
  const a = (state.homeworkList || [])[i];
  if (!a || !a.questions || !a.questions.length) return;
  state.pausedQuiz = null;
  const prog = loadAssignProgress(a.id);
  if (prog && prog.idx < a.questions.length) { assignmentResumePrompt(a, prog); return; }
  if (prog) clearAssignProgress(a.id);
  beginAssignment(a, null);
}
function beginAssignment(a, prog) {
  /* Duolingo-style player: assignment questions map onto 'select'/'typein'
     challenges (same shape the word quiz uses). Shared daily hearts. */
  state.quiz = {
    kind: 'assignment', assignmentId: a.id, log: (prog && prog.log) || [],
    questions: a.questions.map(function (q) {
      const qtype = q.type || 'mcq';
      if (qtype === 'gap') {
        return {
          qtype: 'typein', question: q.prompt || q.q, accept: q.accept || [],
          kind: 'assignment', explanation: q.explanation || '',
          v2: { qid: q.id, points: q.points || [], type: 'gap' }
        };
      }
      if (qtype === 'error') {
        /* error: segments become selectable options */
        const segs = q.segments || [];
        return {
          qtype: 'select', question: (q.prompt || q.q || 'Find the mistake — tap the wrong part.'),
          options: segs.slice(), answer: q.answer,
          kind: 'assignment', explanation: (q.correction ? 'Correct: ' + q.correction + '. ' : '') + (q.explanation || ''),
          v2: { qid: q.id, points: q.points || [], type: 'error' }
        };
      }
      if (qtype === 'listen') {
        /* vocabulary listening: the duo player already supports 'listen'
           (auto-play + replay button) — map audio/word through. */
        return {
          qtype: 'listen', question: q.q || q.prompt || 'Listen — which word do you hear?',
          audio: q.audio || '', word: q.word || '',
          options: (q.options || []).slice(), answer: q.answer,
          kind: 'assignment', explanation: q.explanation || '',
          v2: q.id ? { qid: q.id, points: [], type: 'listen' } : undefined
        };
      }
      /* mcq (default) */
      return {
        qtype: 'select', question: q.q, options: (q.options || []).slice(), answer: q.answer,
        kind: 'assignment', explanation: q.explanation || '',
        v2: q.id ? { qid: q.id, points: q.points || [], type: 'mcq' } : undefined
      };
    }),
    idx: (prog && prog.idx) || 0, correct: (prog && prog.correct) || 0,
    answered: false, picked: -1, wasCorrect: false,
    hearts: getHearts(),
    date: todayStr(), level: a.level, theme: a.title
  };
  saveAssignProgress();
  renderQuizView();
}
function assignmentResumePrompt(a, prog) {
  if (document.getElementById('assign-resume-modal')) return;
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'assign-resume-modal';
  d.innerHTML = '<div class="duo-modal"><h3>Continue where you left off?</h3>' +
    '<p>You reached question ' + (prog.idx + 1) + ' of ' + a.questions.length + '.</p>' +
    '<button class="duo-continue btn-block" id="assign-resume-yes">▶ Continue</button>' +
    '<button class="btn btn-ghost btn-block" id="assign-resume-no">↺ Start over</button></div>';
  $('#view').appendChild(d);
  document.getElementById('assign-resume-yes').onclick = function () {
    d.remove(); beginAssignment(a, prog);
  };
  document.getElementById('assign-resume-no').onclick = function () {
    d.remove(); clearAssignProgress(a.id); beginAssignment(a, null);
  };
}
async function saveAssignmentResult() {
  const q = state.quiz;
  if (!q || q.kind !== 'assignment' || !q.assignmentId || !cloudReady()) return;
  clearAssignProgress(q.assignmentId);
  try {
    await sb.from('assignment_results').upsert({
      assignment_id: q.assignmentId, student_id: state.user.id,
      score: q.correct, total: q.questions.length,
      answers: (q.log || []).map(function (l) {
        /* v2: include qid/points/type/response/isCorrect alongside legacy picked/correct */
        const a = { picked: l.picked, correct: l.correct };
        if (l.qid) a.qid = l.qid;
        if (l.points) a.points = l.points;
        if (l.type) a.type = l.type;
        if (l.response !== undefined) a.response = l.response;
        if (l.isCorrect !== undefined) a.isCorrect = l.isCorrect;
        return a;
      })
    }, { onConflict: 'assignment_id,student_id' });
  } catch (e) {}
}

