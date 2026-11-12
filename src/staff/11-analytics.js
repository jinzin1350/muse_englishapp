function quizKindLabel(k) {
  return k === 'word' ? 'Word quiz' : k === 'grammar' ? 'Grammar quiz'
    : k === 'mistakes' ? 'Mistake review' : k === 'assignment' ? 'Homework' : (k || 'Quiz');
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