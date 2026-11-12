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
function quizKindLabel(k) {
  return k === 'word' ? 'Word quiz' : k === 'grammar' ? 'Grammar quiz'
    : k === 'mistakes' ? 'Mistake review' : k === 'assignment' ? 'Homework' : (k || 'Quiz');
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

/* ---- teacher: assignment list + results ---- */
async function loadTeacherAssignments() {
  const host = document.getElementById('tch-assign');
  if (!host || !(state.teacher || state.viewTeacher)) return;
  /* roster may not have loaded yet (parallel init) — fetch for name mapping */
  if (!state.teacherStudents && state.teacher && !state.viewTeacher) {
    try {
      const rr = await sb.rpc('get_my_students');
      if (!rr.error) state.teacherStudents = rr.data || [];
    } catch (e) {}
  }
  try {
    let a;
    try {
      a = await sb.from('assignments')
        .select('id,kind,title,created_at,deadline,student_ids,question_count,status,send_at,send_tz')
        .eq('teacher_id', tchViewId()).order('created_at', { ascending: false }).limit(30);
      if (a.error) throw a.error;
    } catch (e2) {
      /* pre-scheduling-migration fallback */
      a = await sb.from('assignments')
        .select('id,kind,title,created_at,deadline,student_ids,question_count')
        .eq('teacher_id', tchViewId()).order('created_at', { ascending: false }).limit(30);
    }
    if (a.error) throw a.error;
    const rows = a.data || [];
    state.teacherAssignments = rows;
    if (!rows.length) { host.innerHTML = ''; return; }
    let doneMap = {};
    try {
      const r = await sb.from('assignment_results').select('assignment_id,student_id')
        .in('assignment_id', rows.map(function (x) { return x.id; }));
      (r.data || []).forEach(function (x) {
        (doneMap[x.assignment_id] = doneMap[x.assignment_id] || []).push(x.student_id);
      });
    } catch (e) {}
    /* ---- grouped by student (2026-10-11) ---- */
    const roster = state.teacherStudents || [];
    const nameOf = {};
    roster.forEach(function (s) { nameOf[s.user_id] = s.display_name || (s.email || '?').split('@')[0]; });
    const now = Date.now();
    const groups = {}; /* uid -> {name, items:[{i,x,overdue,doneFor}]} */
    rows.forEach(function (x, i) {
      const doneIds = doneMap[x.id] || [];
      (x.student_ids || []).forEach(function (uid) {
        const g = groups[uid] || (groups[uid] = { name: nameOf[uid] || '—', items: [] });
        const doneFor = doneIds.indexOf(uid) !== -1;
        const overdue = !doneFor && x.status !== 'scheduled' && x.deadline && new Date(x.deadline).getTime() < now;
        g.items.push({ i: i, x: x, overdue: !!overdue, doneFor: doneFor });
      });
    });
    const gids = Object.keys(groups);
    /* sort: overdue first, then most pending, then name */
    gids.sort(function (a, b) {
      const ga = groups[a], gb = groups[b];
      const oa = ga.items.filter(function (t) { return t.overdue; }).length;
      const ob = gb.items.filter(function (t) { return t.overdue; }).length;
      if (ob !== oa) return ob - oa;
      const pa = ga.items.filter(function (t) { return !t.doneFor; }).length;
      const pb = gb.items.filter(function (t) { return !t.doneFor; }).length;
      if (pb !== pa) return pb - pa;
      return String(ga.name).localeCompare(String(gb.name));
    });
    const collapsed = state._asCollapsed || (state._asCollapsed = {});
    host.innerHTML = '<div class="section-title"><h2>📝 Assignments</h2>' +
      '<button class="btn btn-sm" data-action="ai-report-class">🤖 Class report</button></div>' +
      gids.map(function (uid) {
        const g = groups[uid];
        const pend = g.items.filter(function (t) { return !t.doneFor && t.x.status !== 'scheduled'; }).length;
        const over = g.items.filter(function (t) { return t.overdue; }).length;
        const schedN = g.items.filter(function (t) { return t.x.status === 'scheduled'; }).length;
        const isCol = !!collapsed[uid];
        const initial = (g.name || '?').charAt(0).toUpperCase();
        const badges = (over ? '<span class="as-badge as-bad-over">' + over + ' overdue</span>' : '') +
          (pend ? '<span class="as-badge">' + pend + ' pending</span>' : '') +
          (schedN ? '<span class="as-badge as-bad-sched">' + schedN + ' scheduled</span>' : '') +
          (!pend && !over && !schedN ? '<span class="as-badge as-bad-done">all done ✓</span>' : '');
        const bodyRows = g.items.map(function (t) {
          const x = t.x, sched = x.status === 'scheduled';
          const meta = sched && x.send_at
            ? schedLabel(x.send_at, x.send_tz)
            : esc(fmtDate(new Date(x.created_at))) +
              (t.doneFor ? ' · <b class="ok">done ✓</b>' : (t.overdue ? ' · <b class="as-over-txt">overdue ⏰</b>' : ''));
          return '<button class="as-row' + (sched ? ' as-sched' : '') + (t.overdue ? ' as-overdue' : '') +
            '" data-action="assignment-open" data-i="' + t.i + '">' +
            '<span class="as-ico">' + (sched ? '⏰' : (x.kind === 'exam' ? '📋' : '📝')) + '</span>' +
            '<span class="as-main"><span class="as-title">' + esc(x.title) + '</span>' +
            '<span class="as-meta">' + meta + '</span></span>' +
            '<span class="as-go">→</span></button>';
        }).join('');
        return '<div class="as-student' + (isCol ? ' as-collapsed' : '') + '">' +
          '<button class="as-student-head" data-action="as-toggle" data-uid="' + esc(uid) + '">' +
          '<span class="as-avatar">' + esc(initial) + '</span>' +
          '<span class="as-sname">' + esc(g.name) + '</span>' +
          '<span class="as-badges">' + badges + '</span>' +
          '<span class="as-caret">' + (isCol ? '▸' : '▾') + '</span></button>' +
          '<div class="as-student-body">' + bodyRows + '</div></div>';
      }).join('');
  } catch (e) { host.innerHTML = ''; }
}

/* ---- admin: view any teacher's panel (read-only) ---- */
function renderAdminTeacherView(v, teacherId) {
  state.viewTeacher = null;
  state.teacherStudents = null;
  state._tSent = {};
  v.innerHTML = '<div class="tch-wrap">' +
    '<a class="pl-back" href="#/admin">← Admin</a>' +
    '<div id="vat-head"><div class="empty">Loading teacher…</div></div>' +
    '<div id="tch-weekly"></div>' +
    '<div id="tch-daily"></div>' +
    '<div id="tch-assign"></div>' +
    '<div class="section-title"><h2>Students <span id="tch-count" class="muted"></span></h2></div>' +
    '<div id="tch-roster"><div class="empty">Loading…</div></div>' +
    '<div id="tch-detail"></div>' +
  '</div>';
  loadAdminTeacherView(teacherId);
}
async function loadAdminTeacherView(teacherId) {
  const head = document.getElementById('vat-head');
  const rosterHost = document.getElementById('tch-roster');
  try {
    if (!teacherId) throw new Error('no teacher selected');
    const t = await sb.from('teachers').select('user_id,ref_code,display_name,status')
      .eq('user_id', teacherId).maybeSingle();
    if (t.error) throw t.error;
    if (!t.data) throw new Error('teacher not found');
    const teacher = t.data;
    state.viewTeacher = { user_id: teacher.user_id, display_name: teacher.display_name, ref_code: teacher.ref_code };
    head.innerHTML = '<div class="card"><div class="tch-weekly-title">👁 ' + esc(teacher.display_name) + '’s panel</div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0">Read-only admin view — actions are disabled.</p></div>';
    /* roster: students linked via the teacher's invite code.
       last_active is NOT a profiles column — derive it from daily_stats. */
    const p = await sb.from('profiles')
      .select('id,display_name,email,level,current_streak')
      .eq('referred_by', teacher.ref_code)
      .order('display_name', { ascending: true });
    if (p.error) throw p.error;
    const students = (p.data || []).map(function (u) {
      return {
        user_id: u.id, display_name: u.display_name, email: u.email, level: u.level,
        current_streak: u.current_streak || 0, last_active: null,
        xp_7d: 0, lessons_7d: 0, podcast_min_7d: 0, shadowing_7d: 0
      };
    });
    /* 7-day stats + last active day from daily_stats (one query) */
    if (students.length) {
      const ids = students.map(function (s) { return s.user_id; });
      const since = daysAgoStr(6);
      const d = await sb.from('daily_stats')
        .select('user_id,day,xp_earned,lessons_opened,podcast_seconds')
        .in('user_id', ids).order('day', { ascending: false }).limit(2000);
      if (d.error) throw d.error;
      const byId = {};
      students.forEach(function (s) { byId[s.user_id] = s; s._podSec = 0; });
      ((d && d.data) || []).forEach(function (r) {
        const s = byId[r.user_id];
        if (!s) return;
        if (!s.last_active) s.last_active = r.day; /* rows are day-desc */
        if (r.day >= since) {
          s.xp_7d += Number(r.xp_earned) || 0;
          s.lessons_7d += Number(r.lessons_opened) || 0;
          s._podSec += Number(r.podcast_seconds) || 0;
        }
      });
      students.forEach(function (s) { s.podcast_min_7d = Math.round(s._podSec / 60); delete s._podSec; });
      /* shadowing speaking attempts in the last 7 days (needs the teacher-read
         SQL migration; silently stays 0 until it is run) */
      try {
        const sinceTs = new Date(Date.now() - 6 * 864e5).toISOString();
        const att = await sb.from('shadowing_attempts').select('user_id').in('user_id', ids)
          .gte('created_at', sinceTs).limit(3000);
        if (!att.error) {
          const cnt = {};
          (att.data || []).forEach(function (r) { cnt[r.user_id] = (cnt[r.user_id] || 0) + 1; });
          students.forEach(function (s) { s.shadowing_7d = cnt[s.user_id] || 0; });
        }
      } catch (e) {}
      students.sort(function (a, b) {
        return String(b.last_active || '').localeCompare(String(a.last_active || ''));
      });
    }
    state.teacherStudents = students;
    renderTeacherRoster();
    renderTeacherWeekly();
    loadTeacherDaily();
    loadTeacherAssignments();
  } catch (e) {
    if (head) head.innerHTML = '<div class="empty">Could not load teacher panel: ' + esc((e && e.message) || e) + '</div>';
    if (rosterHost) rosterHost.innerHTML = '';
  }
}
async function openTeacherAssignment(i) {
  const r = (state.teacherAssignments || [])[i];
  if (!r) return;
  const roster = state.teacherStudents || state.twStudents || [];
  const nameOf = {};
  roster.forEach(function (s) {
    nameOf[s.user_id] = s.display_name || (s.email || '?').split('@')[0];
  });
  let results = [];
  try {
    const q = await sb.from('assignment_results')
      .select('student_id,score,total,completed_at').eq('assignment_id', r.id);
    results = q.data || [];
  } catch (e) {}
  const byId = {};
  results.forEach(function (x) { byId[x.student_id] = x; });
  const targets = (r.student_ids || []).length;
  const done = results.length;
  const sub = r.status === 'scheduled' && r.send_at
    ? esc(schedLabel(r.send_at, r.send_tz)).replace(/^⏰ /, '') + ' — not sent yet.'
    : targets + ' student' + (targets === 1 ? '' : 's') + ' · ' + done + ' completed';
  let statusBox;
  if (r.status === 'scheduled') {
    statusBox = '<div class="tw-m-status"><span class="tw-m-status-ico">⏰</span>' +
      '<div><b class="tw-m-status-t">Scheduled</b>' +
      '<p>Sends automatically at the planned time.<br>You can cancel it below.</p></div></div>';
  } else if (!done) {
    statusBox = '<div class="tw-m-status"><span class="tw-m-status-ico">⏳</span>' +
      '<div><b class="tw-m-status-t">Pending</b>' +
      '<p>No student activity yet.<br>Once students start, their progress will appear here.</p></div></div>';
  } else {
    statusBox = '<div class="tw-m-rows">' + (r.student_ids || []).map(function (uid) {
      const res = byId[uid];
      const nm = nameOf[uid] || '—';
      return '<div class="tw-m-row">' + twAvatar(nm) + '<b>' + esc(nm) + '</b>' +
        (res ? '<span class="tw-pill tw-pill-green">✓ ' + res.score + '/' + res.total + '</span>'
             : '<span class="tw-pill tw-pill-gray">⏳ pending</span>') + '</div>';
    }).join('') + '</div>';
  }
  showModal(
    '<div class="tw-modal">' +
    '<button class="tw-m-x" data-action="modal-close" aria-label="Close">✕</button>' +
    '<div class="tw-m-ill"><span class="tw-m-clip">📋</span><span class="tw-m-sp1">✨</span><span class="tw-m-sp2">✨</span></div>' +
    '<h2 class="tw-m-title">' + esc(r.title) + '</h2>' +
    '<p class="tw-m-sub">' + sub + '</p>' +
    statusBox +
    (twReadOnly() ? '<p class="muted" style="font-size:0.85rem">👁 Read-only admin view.</p>'
      : (r.status === 'scheduled'
        ? '<button class="tw-m-del" data-action="assignment-cancel" data-i="' + i + '">✕ Cancel scheduled send</button>'
        : '<button class="tw-m-del" data-action="assignment-delete" data-i="' + i + '">🗑 Delete assignment</button>')) +
    '<button class="tw-m-closebtn" data-action="modal-close">Close</button>' +
    '</div>'
  );
}

function twReadOnlyNotice() {
  showModal('<div class="tw-modal"><div class="tw-m-ill"><span class="tw-m-clip">👁</span></div>' +
    '<h2 class="tw-m-title">Read-only</h2>' +
    '<p class="tw-m-sub">You’re viewing another teacher’s dashboard.<br>Switch back to your own to make changes.</p>' +
    '<button class="tw-m-closebtn" data-action="modal-close">OK</button></div>');
}
async function deleteTeacherAssignment(i, btn) {
  if (twReadOnly()) { twReadOnlyNotice(); return; }
  const r = (state.teacherAssignments || [])[i];
  if (!r || r.status === 'scheduled') return;
  const n = (r.student_ids || []).length;
  if (!confirm('Delete "' + r.title + '"? It will be removed for all ' + n + ' students, including their inbox messages. This cannot be undone.')) return;
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    /* Results first (exact link via assignment_id). */
    try { await sb.from('assignment_results').delete().eq('assignment_id', r.id); } catch (e) {}
    /* Inbox messages: body embeds the assignment title
       ('📝 Your teacher sent you homework: <title> — …'). */
    try {
      const like = '%' + String(r.title).replace(/[%_\\]/g, '\\$&') + '%';
      await sb.from('messages').delete()
        .eq('teacher_id', tchViewId())
        .in('student_id', (r.student_ids || []).length ? r.student_ids : ['00000000-0000-0000-0000-000000000000'])
        .like('body', like);
    } catch (e) {}
    /* The assignment itself (RLS: own assignments — same as cancelScheduledAssignment). */
    const d = await sb.from('assignments').delete().eq('id', r.id).eq('teacher_id', tchViewId());
    if (d.error) throw d.error;
    asComposeDone();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🗑 Delete assignment';
    alert('Could not delete: ' + (e.message || e));
  }
}

async function cancelScheduledAssignment(i, btn) {
  if (twReadOnly()) { twReadOnlyNotice(); return; }
  const r = (state.teacherAssignments || [])[i];
  if (!r || r.status !== 'scheduled') return;
  if (!confirm('Cancel this scheduled assignment? It will not be sent.')) return;
  btn.disabled = true;
  try {
    const d = await sb.from('assignments').delete().eq('id', r.id);
    if (d.error) throw d.error;
    asComposeDone();
  } catch (e) {
    btn.disabled = false;
    alert('Could not cancel: ' + (e.message || e));
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

/* ---------------- Admin analytics (phase 2) ---------------- */
const ADM_METRICS = [
  { id: 'dau', label: 'Daily active' },
  { id: 'new_users', label: 'New users' },
  { id: 'xp', label: 'XP earned' },
  { id: 'podcast_min', label: 'Podcast min' },
  { id: 'lessons', label: 'Lessons' },
];
const ADM_EV_LABELS = {
  lesson_open: 'Opened a lesson',
  quiz_completed: 'Finished a quiz',
  podcast_milestone: 'Podcast milestone',
  teacher_requested: 'Requested teacher access',
  shadowing_listen: 'Listened to a shadowing sentence',
  shadowing_attempt: 'Shadowing speaking attempt'
};
function admEvLabel(e) {
  const base = ADM_EV_LABELS[e.event] || e.event;
  const m = e.meta || {};
  const theme = String(m.theme || '').replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\uFE0F)+\s*/u, '');
  const tSuffix = theme ? ' · ' + theme : '';
  if (e.event === 'quiz_completed' && m.score != null) return base + ' — ' + m.score + '/' + (m.total || '?') + ' (' + (m.kind || '') + ')' + tSuffix;
  if (e.event === 'podcast_milestone' && m.minutes != null) return base + ' — ' + m.minutes + ' min listened';
  if (e.event === 'lesson_open' && m.date) return base + ' — ' + m.date + tSuffix;
  if (e.event === 'shadowing_listen' && m.sentence) return base + ' — sentence ' + m.sentence;
  if (e.event === 'shadowing_attempt' && m.score != null) return base + ' — ' + m.score + '% (sentence ' + (m.sentence || '?') + ')';
  return base;
}
async function loadAdminAnalytics() {
  const host = document.getElementById('admin-analytics');
  if (!host) return;
  try {
    const res = await Promise.all([
      sb.rpc('admin_overview'),
      sb.rpc('admin_daily_series', { p_days: 30 }),
      sb.rpc('admin_user_stats'),
      sb.rpc('admin_teacher_board')
    ]);
    const bad = res.find(function (r) { return r.error; });
    if (bad) throw bad.error;
    if (!state.adminFilter) state.adminFilter = { q: '', level: '', teacher: '', activity: 'all', sort: 'recent' };
    if (!state.adminMetric) state.adminMetric = 'dau';
    state.adminStats = {
      overview: (res[0].data || [])[0] || {},
      series: res[1].data || [],
      users: res[2].data || [],
      board: res[3].data || []
    };
    renderAdminAnalytics();
    loadAdminFunnel();
  } catch (e) {
    host.innerHTML = '<div class="empty">Analytics unavailable: ' + esc(e.message || e) + '</div>';
  }
}
function admNum(n) {
  n = Number(n || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function renderAdminAnalytics() {
  const host = document.getElementById('admin-analytics');
  const st = state.adminStats;
  if (!host || !st) return;
  const o = st.overview;
  const cards = [
    ['Users', admNum(o.total_users)],
    ['New (7d)', admNum(o.new_7d)],
    ['DAU', admNum(o.dau)],
    ['WAU', admNum(o.wau)],
    ['Teachers', admNum(o.total_teachers)],
    ['XP (30d)', admNum(o.xp_30d)]
  ];
  host.innerHTML =
    '<div class="adm-cards">' + cards.map(function (c) {
      return '<div class="adm-card"><b>' + c[1] + '</b><span>' + c[0] + '</span></div>';
    }).join('') + '</div>' +
    '<div class="adm-chart-wrap"><div class="adm-tabs">' + ADM_METRICS.map(function (m) {
      return '<button class="adm-tab' + (state.adminMetric === m.id ? ' on' : '') + '" data-action="adm-metric" data-m="' + m.id + '">' + m.label + '</button>';
    }).join('') + '</div><div class="tch-bars" id="adm-chart">' + admChartBars() + '</div></div>' +
    '<div class="section-title" style="margin-top:1.2rem"><h2>👩‍🏫 Teacher leaderboard</h2></div>' +
    '<div id="adm-board">' + admBoardHTML() + '</div>' +
    '<div class="section-title" style="margin-top:1.2rem"><h2>👥 Users</h2></div>' +
    '<div class="adm-filters">' +
      '<input id="adm-q" type="search" placeholder="Search name or email…" value="' + esc(state.adminFilter.q) + '" aria-label="Search users">' +
      '<select id="adm-f-level" aria-label="Filter by level"><option value="">All levels</option>' +
        LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (state.adminFilter.level === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') + '</select>' +
      '<select id="adm-f-teacher" aria-label="Filter by teacher"><option value="">All teachers</option>' +
        st.board.map(function (t) { return '<option value="' + esc(t.ref_code) + '"' + (state.adminFilter.teacher === t.ref_code ? ' selected' : '') + '>' + esc(t.display_name) + '</option>'; }).join('') + '</select>' +
      '<select id="adm-f-activity" aria-label="Filter by activity">' +
        [['all', 'All activity'], ['active7', 'Active (7d)'], ['inactive30', 'Inactive (30d)'], ['never', 'Never active']].map(function (x) {
          return '<option value="' + x[0] + '"' + (state.adminFilter.activity === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select>' +
      '<select id="adm-f-sort" aria-label="Sort users">' +
        [['recent', 'Newest'], ['xp_total', 'Total XP'], ['xp_7d', 'XP (7d)'], ['streak', 'Streak'], ['active', 'Last active']].map(function (x) {
          return '<option value="' + x[0] + '"' + (state.adminFilter.sort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
        }).join('') + '</select>' +
    '</div>' +
    '<div id="adm-users">' + admUsersHTML() + '</div>' +
    '<div id="adm-funnel"></div>' +
    '<div id="adm-detail"></div>';
  // wire filter inputs (input/change events, not data-action)
  const q = document.getElementById('adm-q');
  if (q) q.addEventListener('input', function () { state.adminFilter.q = q.value; renderAdmUsers(); });
  ['adm-f-level', 'adm-f-teacher', 'adm-f-activity', 'adm-f-sort'].forEach(function (id, i) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', function () {
      const keys = ['level', 'teacher', 'activity', 'sort'];
      state.adminFilter[keys[i]] = el.value;
      renderAdmUsers();
    });
  });
}
function admChartBars() {
  const st = state.adminStats, m = state.adminMetric;
  const rows = st.series || [];
  const maxV = Math.max.apply(null, [1].concat(rows.map(function (r) { return Number(r[m]) || 0; })));
  const ml = ADM_METRICS.find(function (x) { return x.id === m; });
  return rows.map(function (r) {
    const v = Number(r[m]) || 0;
    const h = Math.max(3, Math.round(v / maxV * 90));
    return '<div class="tch-bar" title="' + esc(r.day) + ': ' + v + ' ' + (ml ? ml.label : '') + '">' +
      '<div class="tch-bar-fill" style="height:' + h + 'px"></div>' +
      '<div class="tch-bar-d">' + esc(String(r.day).slice(5)) + '</div></div>';
  }).join('');
}
function admBoardHTML() {
  const board = (state.adminStats || {}).board || [];
  if (!board.length) return '<div class="empty">No approved teachers yet.</div>';
  return '<div class="card tch-table-card"><div class="tch-table"><div class="tch-tr tch-th">' +
    '<span>Teacher</span><span>Students</span><span>Active 7d</span><span>XP 7d</span><span>Code</span><span></span></div>' +
    board.map(function (t) {
      return '<div class="tch-tr" data-action="adm-teacher-view" data-ref="' + esc(t.ref_code || '') + '" role="button" tabindex="0" title="View teacher panel">' +
        '<span class="tch-name">' + esc(t.display_name) + '</span>' +
        '<span>' + (t.students || 0) + '</span><span>' + (t.active_7d || 0) + '</span>' +
        '<span>' + (t.xp_7d || 0) + '</span><span><code>' + esc(t.ref_code) + '</code></span>' +
        '<span class="muted">👁</span></div>';
    }).join('') + '</div></div>';
}
function admFilteredUsers() {
  const st = state.adminStats, f = state.adminFilter;
  let list = (st.users || []).slice();
  const q = (f.q || '').toLowerCase().trim();
  if (q) list = list.filter(function (u) {
    return ((u.display_name || '') + ' ' + (u.email || '') + ' ' + (u.phone || '')).toLowerCase().indexOf(q) !== -1;
  });
  if (f.level) list = list.filter(function (u) { return normalizeLevel(u.level) === f.level; });
  if (f.teacher) list = list.filter(function (u) { return u.referred_by === f.teacher; });
  if (f.activity === 'active7') list = list.filter(function (u) { return u.last_active && u.last_active >= daysAgoStr(6); });
  if (f.activity === 'inactive30') list = list.filter(function (u) { return !u.last_active || u.last_active < daysAgoStr(29); });
  if (f.activity === 'never') list = list.filter(function (u) { return !u.last_active; });
  const sorts = {
    recent: function (a, b) { return new Date(b.created_at) - new Date(a.created_at); },
    xp_total: function (a, b) { return (b.xp_total || 0) - (a.xp_total || 0); },
    xp_7d: function (a, b) { return (b.xp_7d || 0) - (a.xp_7d || 0); },
    streak: function (a, b) { return (b.current_streak || 0) - (a.current_streak || 0); },
    active: function (a, b) { return String(b.last_active || '') > String(a.last_active || '') ? 1 : -1; }
  };
  list.sort(sorts[f.sort] || sorts.recent);
  return list;
}
function admUsersHTML() {
  const list = admFilteredUsers().slice(0, 200);
  if (!list.length) return '<div class="empty">No users match.</div>';
  return '<div class="card tch-table-card"><div class="tch-table adm-utable">' +
    '<div class="tch-tr tch-th"><span>User</span><span>🔥</span><span>XP</span><span>XP 7d</span><span>🎧m 30d</span><span>Active</span></div>' +
    list.map(function (u) {
      const name = u.display_name || (u.email || '?').split('@')[0];
      return '<div class="tch-tr" data-action="adm-user" data-id="' + esc(u.user_id) + '" role="button" tabindex="0">' +
        '<span class="tch-name">' + esc(name) + '<small>' + esc(u.email || '') +
        (u.referred_by ? ' · 📣' + esc(u.referred_by) : '') + '</small></span>' +
        '<span>' + (u.current_streak || 0) + '</span>' +
        '<span>' + admNum(u.xp_total) + '</span>' +
        '<span>' + admNum(u.xp_7d) + '</span>' +
        '<span>' + (u.podcast_min_30d || 0) + '</span>' +
        '<span class="muted">' + esc(fmtLastActive(u.last_active)) + '</span></div>';
    }).join('') + '</div></div>' +
    '<p class="muted" style="font-size:0.8rem">Showing ' + list.length + ' · tap a user for full detail.</p>';
}
function renderAdmUsers() {
  const host = document.getElementById('adm-users');
  if (host) host.innerHTML = admUsersHTML();
}
/* ---------------- Funnel + cohort retention (phase 4, admin) ---------------- */
async function loadAdminFunnel() {
  const host = document.getElementById('adm-funnel');
  if (!host) return;
  try {
    const res = await Promise.all([
      sb.rpc('admin_funnel').then(function (r) { return r.data || []; }, function () { return []; }),
      sb.rpc('admin_cohorts').then(function (r) { return r.data || []; }, function () { return []; })
    ]);
    const steps = res[0], cohorts = res[1];
    if (!steps.length && !cohorts.length) { host.innerHTML = ''; return; }
    const base = Number((steps[0] || {}).users) || 1;
    let html = '';
    if (steps.length) {
      html += '<div class="section-title" style="margin-top:1.2rem"><h2>📉 Signup funnel <span class="muted" style="font-weight:400;font-size:0.8rem">(last 30 days)</span></h2></div>' +
        '<div class="card"><div class="adm-funnel">' + steps.map(function (s) {
          const n = Number(s.users) || 0;
          const pct = Math.round(n / base * 100);
          return '<div class="adm-funnel-row"><span>' + esc(s.step) + '</span>' +
            '<div class="adm-funnel-bar"><div style="width:' + pct + '%"></div></div>' +
            '<b>' + n + '</b><span class="muted">' + pct + '%</span></div>';
        }).join('') + '</div></div>';
    }
    if (cohorts.length) {
      html += '<div class="section-title" style="margin-top:1.2rem"><h2>🔁 Cohort retention <span class="muted" style="font-weight:400;font-size:0.8rem">(% active in weeks 1–4 after signup)</span></h2></div>' +
        '<div class="card tch-table-card"><div class="tch-table adm-cohort">' +
        '<div class="tch-tr tch-th"><span>Cohort</span><span>Users</span><span>W1</span><span>W2</span><span>W3</span><span>W4</span></div>' +
        cohorts.map(function (c) {
          const cell = function (v) {
            v = Number(v) || 0;
            const cls = v >= 40 ? 'hot' : (v >= 20 ? 'warm' : 'cold');
            return '<span class="adm-coh ' + cls + '">' + v + '%</span>';
          };
          return '<div class="tch-tr"><span class="muted">' + esc(c.cohort) + '</span><span>' + c.users + '</span>' +
            cell(c.w1) + cell(c.w2) + cell(c.w3) + cell(c.w4) + '</div>';
        }).join('') + '</div></div>';
    }
    host.innerHTML = html;
  } catch (e) { host.innerHTML = ''; }
}
async function openAdminUser(id) {
  const host = document.getElementById('adm-detail');
  if (!host) return;
  const u = ((state.adminStats || {}).users || []).find(function (x) { return x.user_id === id; });
  if (!u) return;
  host.innerHTML = '<div class="empty">Loading…</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const res = await Promise.all([
      sb.rpc('get_student_daily', { p_student: id }).then(function (r) { return { rows30: r.data || [] }; }, function () { return { rows30: [] }; }),
      sb.from('daily_stats').select('*').eq('user_id', id).order('day', { ascending: false }).limit(30)
        .then(function (r) { return { rows: r.data || [] }; }, function () { return { rows: [] }; }),
      sb.from('app_events').select('event,meta,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(40)
        .then(function (r) { return { evs: r.data || [] }; }, function () { return { evs: [] }; }),
      sb.from('shadowing_attempts').select('lesson_date,transcript,score,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20)
        .then(function (r) { return { att: r.error ? [] : (r.data || [] ) }; }, function () { return { att: [] }; }),
      sb.from('summary_attempts').select('lesson_date,score,duration_sec,created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20)
        .then(function (r) { return { sums: r.error ? [] : (r.data || [] ) }; }, function () { return { sums: [] }; })
    ]);
    const rows = res[1].rows.length ? res[1].rows : res[0].rows30;
    const evs = res[2].evs;
    const att = res[3].att;
    const sums = res[4].sums;
    const listens = evs.filter(function (e) { return e.event === 'shadowing_listen'; }).length;
    const shAvg = att.length ? Math.round(att.reduce(function (a, x) { return a + (Number(x.score) || 0); }, 0) / att.length) : 0;
    const name = u.display_name || (u.email || '?').split('@')[0];
    const sum = function (k) { return rows.reduce(function (a, x) { return a + (Number(x[k]) || 0); }, 0); };
    const maxSec = Math.max.apply(null, [1].concat(rows.map(function (x) { return x.seconds_in_app || 0; })));
    const ordered = rows.slice().sort(function (a, b) { return String(a.day) > String(b.day) ? 1 : -1; }).slice(-30);
    host.innerHTML = '<div class="card"><h3 style="margin-top:0">' + esc(name) +
      ' <span class="muted" style="font-weight:400">· ' + esc(u.email || '') + '</span></h3>' +
      '<p class="muted" style="font-size:0.85rem;margin-top:-0.4rem">' +
        esc(u.level ? levelLabel(normalizeLevel(u.level)) : 'level pending') +
        (u.referred_by ? ' · 📣 <code>' + esc(u.referred_by) + '</code>' : '') +
        ' · joined ' + esc(String(u.created_at || '').slice(0, 10)) + '</p>' +
      '<div class="tch-totals">' +
        '<div><b>' + admNum(u.xp_total) + '</b><span>total XP</span></div>' +
        '<div><b>' + (u.current_streak || 0) + '</b><span>day streak</span></div>' +
        '<div><b>' + Math.round(sum('seconds_in_app') / 60) + '</b><span>min (30d)</span></div>' +
        '<div><b>' + Math.round(sum('podcast_seconds') / 60) + '</b><span>podcast min</span></div>' +
        '<div><b>' + sum('lessons_opened') + '</b><span>lessons</span></div>' +
        '<div><b>' + sum('quizzes_completed') + '</b><span>quizzes</span></div>' +
        '<div><b>' + att.length + '</b><span>shadowing tries</span></div>' +
        '<div><b>' + shAvg + '%</b><span>shadowing avg</span></div>' +
        '<div><b>' + listens + '</b><span>shadowing listens</span></div>' +
      '</div>' +
      (ordered.length ? '<p class="muted" style="font-size:0.85rem;margin-bottom:0.3rem"><b>Daily time in app</b> (last 30 days)</p><div class="tch-bars">' +
        ordered.map(function (x) {
          const h = Math.max(4, Math.round((x.seconds_in_app || 0) / maxSec * 90));
          return '<div class="tch-bar" title="' + esc(x.day) + ': ' + Math.round((x.seconds_in_app || 0) / 60) + ' min">' +
            '<div class="tch-bar-fill" style="height:' + h + 'px"></div>' +
            '<div class="tch-bar-d">' + esc(String(x.day).slice(5)) + '</div></div>';
        }).join('') + '</div>' : '<div class="empty">No activity in the last 30 days.</div>') +
      (evs.length ? '<p class="muted" style="font-size:0.85rem;margin:1rem 0 0.3rem"><b>Recent activity</b></p><div class="adm-events">' +
        evs.map(function (e) {
          return '<div class="adm-ev"><span>' + esc(admEvLabel(e)) + '</span><span class="muted">' +
            esc(String(e.created_at || '').slice(0, 16).replace('T', ' ')) + '</span></div>';
        }).join('') + '</div>' : '') +
      (att.length ? '<p class="muted" style="font-size:0.85rem;margin:1rem 0 0.3rem"><b>🎤 Recent shadowing tries</b></p><div class="an-assign">' +
        att.slice(0, 8).map(function (x) {
          const mm = String(x.transcript || '').match(/^\[s(\d+)\]/);
          const said = String(x.transcript || '').replace(/^\[s\d+\]\s*/, '').slice(0, 60);
          const sc = Number(x.score) || 0;
          return '<div class="an-arow"><span>🔤 sentence ' + esc(mm ? mm[1] : '?') +
            ' <span class="muted">· ' + esc(said) + (said.length >= 60 ? '…' : '') + '</span></span>' +
            '<span class="muted">' + esc(String(x.created_at || '').slice(0, 16).replace('T', ' ')) + '</span>' +
            '<b class="' + (sc >= 70 ? 'ok' : 'bad') + '">' + sc + '%</b></div>';
        }).join('') + '</div>' : '') +
      (sums.length ? '<p class="muted" style="font-size:0.85rem;margin:1rem 0 0.3rem"><b>🎙️ Recent podcast summaries</b></p><div class="an-assign">' +
        sums.slice(0, 8).map(function (x) {
          const sc = Number(x.score) || 0;
          return '<div class="an-arow"><span>🎙️ <span class="muted">' + esc(String(x.lesson_date || '').slice(0, 10)) +
            ' · ' + (Number(x.duration_sec) || 0) + 's</span></span>' +
            '<span class="muted">' + esc(String(x.created_at || '').slice(0, 16).replace('T', ' ')) + '</span>' +
            '<b class="' + (sc >= 70 ? 'ok' : 'bad') + '">' + sc + '</b></div>';
        }).join('') + '</div>' : '') +
      '<button class="btn btn-ghost btn-sm" data-action="adm-user-close" style="margin-top:0.8rem">Close</button></div>';
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load user detail.</div>';
  }
}

