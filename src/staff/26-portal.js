/* ---------------- portal gate ---------------- */

async function renderTeachers() {
  document.body.classList.add('tw-mode');
  document.body.classList.remove('ap-mode');
  /* Hide the static marketing landing in index.html (same mechanism the app uses). */
  document.documentElement.classList.add('app-mode');
  var v = document.getElementById('view');
  v.innerHTML = '<div class="tw-loading"><div class="tw-spin"></div><p class="muted">Loading…</p></div>';
  var user = null;
  try {
    if (sb) { var r = await sb.auth.getUser(); user = (r.data && r.data.user) || null; }
  } catch (e) {}
  if (!user) { v.innerHTML = twLandingHTML(false); twWireLanding(); return; }
  var adminEmails = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.ADMIN_EMAILS) || [];
  state.user = { id: user.id, email: user.email, demo: false, displayName: null,
    isAdmin: adminEmails.indexOf((user.email || '').toLowerCase()) !== -1 };
  try {
    var p = await sb.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
    if (p.data && p.data.display_name) state.user.displayName = p.data.display_name;
  } catch (e) {}
  await loadTeacherStatus();
  if (state.teacher || state.user.isAdmin) { twRenderWorkspace(v); return; }
  if (state.teacherRequest) {
    v.innerHTML = '<div class="tw-narrow">' +
      '<div class="tw-brandrow">🍎 <b>Muse English</b><span>for Teachers</span></div>' +
      '<div class="card tw-card"><h2 class="tw-title-sm">⏳ Request under review</h2>' +
      '<p class="muted">Thanks for applying! We approve teachers manually — usually within a day. We will email you at <b>' + esc(user.email || '') + '</b> once you are in.</p>' +
      '<button class="btn btn-ghost" data-action="tw-logout">Log out</button></div></div>';
    return;
  }
  v.innerHTML = twLandingHTML(true);
  twWireLanding();
  var host = document.getElementById('tw-apply');
  if (host) {
    renderBecomeTeacher(host);
    var back = host.querySelector('a[href="#/profile"]');
    if (back) { back.setAttribute('href', '#tw-apply'); back.textContent = '← Back'; }
  }
}

function twLandingHTML(loggedIn) {
  var feats = [
    ['📝', 'Placement test link', 'Send new students a 5-part test — vocabulary, listening, grammar, writing, speaking. Results land in your dashboard with a suggested level.'],
    ['📊', 'Student activity', 'Streaks, XP, lessons completed and 14-day history for every student — updated automatically, no spreadsheets.'],
    ['✈️', 'Assignments', 'Build quizzes from any topic and schedule them across the week. They come back graded, per student and per question.'],
    ['🔗', 'Invite links', 'One link connects students to you. Everyone who signs up through it shows up on your roster.']
  ];
  var steps = [
    ['1', 'Request access', 'Log in with your Muse English account and apply in one click. We approve teachers manually.'],
    ['2', 'Share your link', 'Send your invite link — or the placement-test link — to your students.'],
    ['3', 'Track & teach', 'Watch progress, nudge quiet students, and assign work from your dashboard.']
  ];
  return '<div class="tw-land">' +
    '<header class="tw-top"><div class="tw-top-in">' +
      '<div class="tw-brandrow">🍎 <b>Muse English</b><span>for Teachers</span></div>' +
      '<nav class="tw-toplinks"><a href="#tw-features">Features</a><a href="#tw-how">How it works</a>' +
      (loggedIn ? '<a class="tw-btn tw-btn-sm" href="#tw-apply">Request access</a>' : '<a class="tw-btn tw-btn-sm" href="/#/signin" data-tw-auth>Log in</a>') +
      '</nav></div></header>' +
    '<section class="tw-hero"><div class="tw-hero-in">' +
      '<div class="tw-eyebrow">FOR ENGLISH TEACHERS</div>' +
      '<h1 class="tw-title">Your students, their progress,<br>one dashboard.</h1>' +
      '<p class="tw-sub">Give every new student a placement test, watch their activity day by day, and send assignments — Muse English handles the busywork while you teach.</p>' +
      '<div class="tw-cta">' +
        (loggedIn ? '<a class="tw-btn" href="#tw-apply">Request teacher access →</a>'
                  : '<a class="tw-btn" href="/#/signin" data-tw-auth>Log in →</a>') +
        '<a class="tw-btn tw-btn-ghost" href="#tw-how">How it works</a></div>' +
      '<p class="tw-note">Already teaching with Muse English? Your login is the same account you use in the app.</p>' +
    '</div></section>' +
    '<section class="tw-sec" id="tw-features"><div class="tw-sec-in">' +
      '<h2 class="tw-title-sm">Everything a teacher needs</h2>' +
      '<div class="tw-feats">' + feats.map(function (f) {
        return '<div class="tw-feat"><div class="tw-feat-ico">' + f[0] + '</div><h3>' + f[1] + '</h3><p>' + f[2] + '</p></div>';
      }).join('') + '</div></div></section>' +
    '<section class="tw-sec tw-sec-alt" id="tw-how"><div class="tw-sec-in">' +
      '<h2 class="tw-title-sm">Get started in minutes</h2>' +
      '<div class="tw-steps">' + steps.map(function (s) {
        return '<div class="tw-step"><div class="tw-step-n">' + s[0] + '</div><h3>' + s[1] + '</h3><p>' + s[2] + '</p></div>';
      }).join('') + '</div></div></section>' +
    (loggedIn
      ? '<section class="tw-sec" id="tw-apply"><div class="tw-narrow"><div class="tw-applybox" id="tw-apply"></div></div></section>'
      : '<section class="tw-sec" id="tw-login"><div class="tw-narrow"><div class="tw-logincard">' +
        '<h2 class="tw-title-sm">Teacher login</h2>' +
        '<p class="muted">Log in with your Muse English account, with Google or with email and password. You come straight back to this portal.</p>' +
        '<a class="tw-btn tw-btn-block" href="/#/signin" data-tw-auth>Log in →</a>' +
        '<p class="muted" style="margin:14px 0 0">New to Muse English? <a class="link" href="/#/signup" data-tw-auth>Create a free account</a>. You come back here afterwards to request teacher access.</p>' +
        '</div></div></section>') +
    '<footer class="tw-foot"><div class="tw-sec-in"><span>© 2026 Muse English · Built for teachers</span></div></footer>' +
  '</div>';
}

function twWireLanding() {
  var f = document.getElementById('tw-login-form');
  if (f) f.addEventListener('submit', twDoLogin);
  /* Log in / sign up happen on the main auth page; remember to come back here. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-tw-auth]'), function (a) {
    a.addEventListener('click', function () { setAuthReturnPath('/teachers'); });
  });
}

async function twDoLogin(e) {
  e.preventDefault();
  var em = document.getElementById('tw-email'), pw = document.getElementById('tw-pass');
  var err = document.getElementById('tw-error'), btn = document.getElementById('tw-submit');
  err.textContent = '';
  var email = em.value.trim(), pass = pw.value;
  if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
  if (!sb) { err.textContent = 'Login service could not load. Check your connection and try again.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    var r = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (r.error) throw r.error;
    trackEvent('teacher_portal_login', {});
    await renderTeachers();
  } catch (ex) {
    err.textContent = (ex && ex.message) || 'Sign in failed.';
    btn.disabled = false; btn.textContent = 'Log in';
  }
}

async function twLogout() {
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  state.user = null; state.teacher = null; state.teacherRequest = null;
  state.twSection = null; state.twStudents = null; state.twPtest = null; state.twAssignments = null;
  state.twViewTeacher = null; state.viewTeacher = null; state.twTeacherList = null;
  window.location.href = '/teachers';
}

/* ---------------- workspace shell ---------------- */

function twRenderWorkspace(v) {
  if (!state.twSection) state.twSection = 'overview';
  var t = state.teacher || {};
  var em = (state.user && state.user.email) || '';
  var isAdmin = !!(state.user && state.user.isAdmin);
  v.innerHTML =
    '<div class="tw-work">' +
    '<aside class="tw-side">' +
      '<div class="tw-brandrow tw-brandrow-side"><span class="tw-apple">🍎</span><span><b>Muse English</b><small>for Teachers</small></span></div>' +
      (isAdmin ? '<div class="tw-switchwrap"><label for="tw-teacher-switch">👁 Viewing</label>' +
        '<select id="tw-teacher-switch" class="tw-select"><option value="">Loading teachers…</option></select></div>' : '') +
      '<nav class="tw-nav">' + TW_SECTIONS.map(function (s) {
        return '<button class="tw-navbtn' + (state.twSection === s[0] ? ' on' : '') + '" data-twsec="' + s[0] + '">' +
          '<span class="tw-navico">' + s[1] + '</span>' + s[2] + '</button>';
      }).join('') + '</nav>' +
      '<div class="tw-side-foot">' +
        '<div class="tw-me">' + twAvatar(t.display_name || em, 'tw-av-lg') +
          '<span class="tw-me-txt"><b>' + esc(t.display_name || (isAdmin ? 'Admin' : 'Teacher')) + '</b><small>' + esc(em) + '</small></span></div>' +
        '<button class="tw-footlink" data-twsec="settings"><span>⚙️</span> Settings</button>' +
        '<a class="tw-footlink" href="/"><span>⬈</span> Learner app</a>' +
        '<button class="tw-footlink" data-action="tw-logout"><span>⎋</span> Log out</button>' +
      '</div>' +
    '</aside>' +
    '<main class="tw-main"><div id="tw-viewbanner"></div><div class="tw-main-in" id="tw-content"></div></main>' +
    '</div>';
  Array.prototype.forEach.call(v.querySelectorAll('[data-twsec]'), function (b) {
    b.addEventListener('click', function () { twShowSection(b.getAttribute('data-twsec')); });
  });
  if (isAdmin) twInitTeacherSwitch();
  twShowSection(state.twSection);
}

/* ---------------- admin: view-as-teacher ----------------
   Admin-only teacher switcher inside the /teachers portal.
   Viewing another teacher is strictly read-only. */
async function twGetTeacherList() {
  if (state.twTeacherList) return state.twTeacherList;
  var list = [];
  try {
    var r = await sb.from('teachers').select('user_id,ref_code,display_name,status')
      .eq('status', 'approved').order('display_name', { ascending: true });
    if (!r.error) list = r.data || [];
  } catch (e) {}
  state.twTeacherList = list;
  return list;
}
/* Effective teacher context: the viewed teacher, or the logged-in teacher. */
function twEffTeacher() { return state.twViewTeacher || state.teacher; }
/* True when the admin is looking at someone else's dashboard. */
function twReadOnly() {
  /* Admins get full write access when viewing as a teacher. */
  if (state.user && state.user.isAdmin) return false;
  var v = state.twViewTeacher;
  var me = state.teacher;
  return !!(v && (!me || v.user_id !== me.user_id));
}
async function twInitTeacherSwitch() {
  var sel = document.getElementById('tw-teacher-switch');
  if (!sel) return;
  var list = await twGetTeacherList();
  var meId = state.teacher && state.teacher.user_id;
  var others = list.filter(function (x) { return x.user_id !== meId; });
  if (!state.teacher && others.length && !state.twViewTeacher) {
    /* Admin without a teacher row: default to the first teacher. */
    twSetViewTeacher(others[0]);
    return;
  }
  sel.innerHTML = (state.teacher ? '<option value="">My dashboard</option>' : '') +
    others.map(function (x) {
      return '<option value="' + x.user_id + '"' +
        (state.twViewTeacher && state.twViewTeacher.user_id === x.user_id ? ' selected' : '') + '>' +
        esc(x.display_name) + '</option>';
    }).join('') || '<option value="">No teachers yet</option>';
  sel.addEventListener('change', function () {
    var picked = others.filter(function (x) { return x.user_id === sel.value; })[0] || null;
    twSetViewTeacher(picked);
  });
}
function twSetViewTeacher(t) {
  state.twViewTeacher = t;
  /* Reuse the legacy view-as-teacher plumbing: tchViewId() then resolves to
     the viewed teacher, and action buttons hide in the student detail. */
  state.viewTeacher = t ? { user_id: t.user_id, display_name: t.display_name, ref_code: t.ref_code } : null;
  state.twStudents = null; state.twPtest = null; state.twAssignments = null;
  state.twSection = 'overview';
  twRenderWorkspace(document.getElementById('view'));
}
function twPaintViewBanner() {
  var host = document.getElementById('tw-viewbanner');
  if (!host) return;
  if (twReadOnly()) {
    var t = state.twViewTeacher;
    host.innerHTML = '<div class="tw-viewbanner">👁 You’re viewing <b>' + esc(t.display_name) +
      '’s dashboard</b> — read-only. <button class="tw-btn tw-btn-sm tw-btn-white" id="tw-backmine">Back to my dashboard</button></div>';
    document.getElementById('tw-backmine').addEventListener('click', function () { twSetViewTeacher(null); });
  } else if (state.twViewTeacher && state.user && state.user.isAdmin) {
    var t2 = state.twViewTeacher;
    host.innerHTML = '<div class="tw-viewbanner" style="background:#E8F5E9">✏️ You’re acting as <b>' + esc(t2.display_name) +
      '</b> (admin). <button class="tw-btn tw-btn-sm tw-btn-white" id="tw-backmine2">Back to my dashboard</button></div>';
    document.getElementById('tw-backmine2').addEventListener('click', function () { twSetViewTeacher(null); });
  } else host.innerHTML = '';
}

function twShowSection(name) {
  state.twSection = name;
  /* Detail pages keep the parent nav highlighted. */
  var navName = (name === 'assignment-detail' || name === 'class-report') ? 'assignments'
    : (name === 'student-report') ? 'students' : name;
  Array.prototype.forEach.call(document.querySelectorAll('[data-twsec]'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-twsec') === navName);
  });
  var c = document.getElementById('tw-content');
  if (!c) return;
  window.scrollTo(0, 0);
  twPaintViewBanner();
  if (name === 'overview') twPageOverview(c);
  else if (name === 'students') twPageStudents(c);
  else if (name === 'daily') twPageDaily(c);
  else if (name === 'assignments') twPageAssignments(c);
  else if (name === 'assignment-detail') twPageAssignmentDetail(c);
  else if (name === 'class-report') twPageClassReport(c);
  else if (name === 'student-report') twPageStudentReport(c);
  else if (name === 'compose') twPageCompose(c);
  else if (name === 'placement') twPagePlacement(c);
  else if (name === 'ielts') twPageIelts(c);
  else if (name === 'links') twPageLinks(c);
  else if (name === 'settings') twPageSettings(c);
}

/* ---------------- data ---------------- */

async function twGetStudents() {
  if (state.twStudents) return state.twStudents;
  var list = [];
  try {
    var params = state.twViewTeacher ? { p_teacher: state.twViewTeacher.user_id } : {};
    var r = await sb.rpc('get_my_students', params);
    if (r.error) throw r.error;
    list = r.data || [];
    state.twStudentsError = null;
  } catch (e) {
    state.twStudentsError = (e && e.message) || String(e);
  }
  state.twStudents = list;
  state.teacherStudents = list; /* keep legacy detail renderer in sync */
  return list;
}
async function twGetPtest() {
  if (state.twPtest) return state.twPtest;
  var rows = [];
  var t = twEffTeacher();
  try {
    var r = await sb.from('placement_results')
      .select('id,student_id,student_name,student_mobile,status,scores,suggested_level,sections,started_at,completed_at,updated_at')
      .eq('teacher_ref', t ? t.ref_code : '')
      .order('updated_at', { ascending: false }).limit(100);
    if (!r.error) rows = r.data || [];
  } catch (e) {}
  state.twPtest = rows;
  state.ptestRows = rows; /* keep legacy detail renderer in sync */
  return rows;
}
async function twGetAssignments() {
  if (state.twAssignments) return state.twAssignments;
  var assigns = [], doneMap = {};
  var t = twEffTeacher();
  try {
    var a = await sb.from('assignments')
      .select('id,kind,title,created_at,deadline,student_ids,question_count,status,send_at,send_tz')
      .eq('teacher_id', t ? t.user_id : state.user.id).order('created_at', { ascending: false }).limit(40);
    if (a.error) throw a.error;
    assigns = a.data || [];
    var ids = assigns.map(function (x) { return x.id; });
    if (ids.length) {
      var rr = await sb.from('assignment_results').select('assignment_id,student_id').in('assignment_id', ids);
      if (!rr.error) (rr.data || []).forEach(function (x) {
        (doneMap[x.assignment_id] = doneMap[x.assignment_id] || {})[x.student_id] = 1;
      });
    }
  } catch (e) {}
  state.twAssignments = assigns;
  state.teacherAssignments = assigns;
  state.twDoneMap = doneMap;
  return assigns;
}
function twAsgStatus(a) {
  var doneMap = state.twDoneMap || {};
  if (a.status === 'scheduled') return ['Scheduled', 'sched'];
  var targets = (a.student_ids || []).length;
  var done = Object.keys(doneMap[a.id] || {}).length;
  if (done === 0) return ['Pending', 'pending'];
  if (targets && done >= targets) return ['Completed', 'done'];
  return ['In review', 'review'];
}
function twPill(text, kind) {
  return '<span class="tw-pill tw-pill-' + kind + '">' + text + '</span>';
}

/* ---------------- page: overview ---------------- */

async function twPageOverview(c) {
  var t = state.teacher;
  var first = esc((t.display_name || 'Teacher').split(' ')[0]);
  c.innerHTML = twPageHead('OVERVIEW', 'Welcome back, ' + first + ' 👋',
      'Here is what is happening with your students.') +
    '<div class="tw-stats" id="tw-stats">' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#FFE8D6">👥</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-students">…</span><span class="tw-stat-l">Students</span></div>' +
        '<div class="tw-stat-s">Total students in your class</div></div>' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#E3F5D8">📊</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-active">…</span><span class="tw-stat-l">Active this week</span></div>' +
        '<div class="tw-stat-s">Students with recent activity</div></div>' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#FFEFD2">📝</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-pending">…</span><span class="tw-stat-l">Tests to review</span></div>' +
        '<div class="tw-stat-s">Placement tests waiting</div></div>' +
      '<div class="tw-stat"><span class="tw-stat-ico" style="background:#EDE7FB">🕐</span>' +
        '<div class="tw-stat-top"><span class="tw-stat-n" id="tw-s-quiet">…</span><span class="tw-stat-l">Quiet 7+ days</span></div>' +
        '<div class="tw-stat-s">Students with no activity</div></div>' +
    '</div>' +
    '<div class="tw-grid2">' +
      '<div class="tw-panel"><div class="tw-cardhead"><div><h3>📄 Latest placement tests</h3>' +
      '<p class="muted">Recent placement test results from your students.</p></div>' +
      '<button class="tw-btn tw-btn-sm tw-btn-ghost" data-twsec="placement">View all →</button></div>' +
      '<div id="tw-recent-ptest"><div class="empty">Loading…</div></div></div>' +
      '<div class="tw-panel"><div class="tw-cardhead"><div><h3>⚠️ Needs attention</h3>' +
      '<p class="muted">Students who have not been active recently.</p></div>' +
      '<button class="tw-btn tw-btn-sm tw-btn-ghost" data-twsec="students">View all →</button></div>' +
      '<div id="tw-attn"><div class="empty">Loading…</div></div></div>' +
    '</div>' +
    '<div class="tw-banner"><div class="tw-banner-txt"><span class="tw-banner-ico">💡</span>' +
      '<div><b>Get your students started</b><p>Share your class link so students can join and take a placement test.</p></div></div>' +
      twPlane() +
      '<button class="tw-btn tw-btn-orange" id="tw-copy-ptest">🔗 Copy placement link</button></div>';
  Array.prototype.forEach.call(c.querySelectorAll('[data-twsec]'), function (b) {
    b.addEventListener('click', function () { twShowSection(b.getAttribute('data-twsec')); });
  });
  c.querySelector('#tw-copy-ptest').addEventListener('click', function () {
    twCopy(teacherPlacementLink((twEffTeacher() || {}).ref_code), this);
  });
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  var students = await twGetStudents();
  var quiet = students.filter(function (s) { var n = twDaysSince(s.last_active); return n === null || n >= 7; });
  var active = students.filter(function (s) { var n = twDaysSince(s.last_active); return n !== null && n < 7; });
  set('tw-s-students', students.length);
  set('tw-s-active', active.length);
  set('tw-s-quiet', quiet.length);
  var attn = document.getElementById('tw-attn');
  if (attn) {
    attn.innerHTML = quiet.length ? quiet.slice(0, 4).map(function (s) {
      var nm = s.display_name || (s.email || '?').split('@')[0];
      return '<div class="tw-attnrow">' + twAvatar(nm) +
        '<span class="tw-attn-name"><b>' + esc(nm) + '</b><small>' + esc(twLevelLabel(s.level)) + '</small></span>' +
        '<span class="tw-attn-when"><small class="muted">Last active</small><b>' + esc(twDate(s.last_active)) + '</b></span>' +
        twPill(esc(twAgo(s.last_active)), 'red') + '</div>';
    }).join('') : '<div class="empty">Everyone is active. 🎉</div>';
  }
  var rp = document.getElementById('tw-recent-ptest');
  var rows = await twGetPtest();
  var pending = rows.filter(function (x) { return x.status !== 'completed'; }).length;
  set('tw-s-pending', pending);
  if (rp) {
    if (!rows.length) {
      rp.innerHTML = '<div class="tw-empty-ill">📝</div><b>No tests yet</b>' +
        '<p class="muted">When your students take a placement test,<br>their results will appear here.</p>' +
        '<button class="tw-btn tw-btn-sm tw-btn-ghost" id="tw-share-ptest">🔗 Share your placement link</button>';
      var sh = document.getElementById('tw-share-ptest');
      if (sh) sh.addEventListener('click', function () { twCopy(teacherPlacementLink((twEffTeacher() || {}).ref_code), this); });
    } else {
      rp.innerHTML = rows.slice(0, 4).map(function (x) {
        var sc = x.scores || {};
        return '<div class="tw-attnrow">' + twAvatar(x.student_name) +
          '<span class="tw-attn-name"><b>' + esc(x.student_name || 'Student') + '</b>' +
          '<small>' + (x.status === 'completed' ? 'Score ' + (sc.total || 0) + '/55' : 'In progress') + '</small></span>' +
          (x.suggested_level ? twPill(esc(x.suggested_level), 'green') : twPill('In progress', 'gray')) + '</div>';
      }).join('');
    }
  }
}

/* ---------------- page: students ---------------- */

function twStudentRow(s, oi, ptestByStudent) {
  var nm = s.display_name || (s.email || '?').split('@')[0];
  var n = twDaysSince(s.last_active);
  var st = s.last_active;
  var statusPill, statusSub;
  if (n !== null && n <= 0) { statusPill = twPill('● Active today', 'green'); statusSub = ''; }
  else if (n !== null && n < 7) { statusPill = twPill('Active ' + twAgo(st), 'gray'); statusSub = ''; }
  else { statusPill = twPill('● Needs attention', 'red'); statusSub = '<small class="muted">' + esc(twAgo(st)) + '</small>'; }
  var pt = ptestByStudent[s.user_id];
  var ptPill = pt ? twPill('✓ Completed', 'green') : twPill('🕐 Not started', 'gray');
  var mins = s.podcast_min_7d || 0;
  return '<div class="tw-trow" data-i="' + oi + '" role="button" tabindex="0">' +
    '<div class="tw-tcell tw-tstudent">' + twAvatar(nm) +
      '<span><b>' + esc(nm) + '</b><small>' + esc(twLevelLabel(s.level)) + '</small>' +
      '<small class="muted">Last active ' + esc(twDate(st)) + '</small></span></div>' +
    '<div class="tw-tcell tw-tnum">' + (s.current_streak > 0 ? '🔥' : '<span class="tw-dim">💧</span>') + ' ' + (s.current_streak || 0) + '</div>' +
    '<div class="tw-tcell tw-tnum">' + (s.xp_7d || 0) + '</div>' +
    '<div class="tw-tcell tw-tnum">' + (s.lessons_7d || 0) + '</div>' +
    '<div class="tw-tcell tw-tnum">' + mins + 'm</div>' +
    '<div class="tw-tcell">' + ptPill + '</div>' +
    '<div class="tw-tcell"><span class="tw-statuswrap">' + statusPill + statusSub + '</span></div>' +
    '<div class="tw-tcell tw-tmenu"><button class="tw-dots" data-twmenu="' + oi + '" aria-label="More">⋯</button></div>' +
  '</div>';
}

async function twPageStudents(c) {
  var students = await twGetStudents();
  var ptest = await twGetPtest();
  var ptestByStudent = {};
  ptest.forEach(function (x) { if (x.student_id && x.status === 'completed') ptestByStudent[x.student_id] = x; });
  var ro = twReadOnly();
  c.innerHTML = twPageHead('STUDENTS', 'My students <span class="tw-count">(' + students.length + ')</span>',
      'View and manage your students’ progress, activity and placement test results.') +
    (state.twStudentsError ? '<div class="tw-errbox">⚠️ Could not load students: ' + esc(state.twStudentsError) +
      '<br><span class="muted">If you are viewing another teacher, run the admin migration in Supabase first.</span></div>' : '') +
    '<div class="tw-toolbar">' +
      '<div class="tw-search"><span>🔍</span><input id="tw-q" type="search" placeholder="Search students by name…"></div>' +
      '<select id="tw-flevel" class="tw-select"><option value="">All levels</option>' +
        ['a1', 'a2', 'b1', 'b2', 'c1'].map(function (l) {
          return '<option value="' + l + '">' + l.toUpperCase() + ' · ' + TW_LEVEL_LABEL[l] + '</option>';
        }).join('') + '</select>' +
      '<select id="tw-sort" class="tw-select"><option value="active">Last active</option>' +
        '<option value="name">Name A–Z</option><option value="xp">XP (7d)</option><option value="streak">Streak</option></select>' +
      (ro ? '' : '<button class="tw-btn tw-btn-orange" id="tw-invite">＋ Invite student</button>') +
    '</div>' +
    '<div class="tw-tablecard"><div class="tw-table-scroll"><div class="tw-table">' +
      '<div class="tw-thead"><span>STUDENT</span><span>🔥 STREAK</span><span>📊 XP 7D</span><span>📖 LESSONS</span>' +
      '<span>🎧 LISTENING</span><span>📝 PLACEMENT TEST</span><span>STATUS</span><span></span></div>' +
      '<div id="tw-tbody"></div>' +
    '</div></div></div>' +
    '<div id="tch-detail"></div>' +
    '<div class="tw-banner"><div class="tw-banner-txt"><span class="tw-banner-ico">💡</span>' +
      '<div><b>Tap a student to see their 14-day activity.</b>' +
      '<p>View detailed progress, lessons, and placement test results for each student.</p></div></div>' +
      twPlane() + '</div>' +
    '<div class="tw-menu" id="tw-menu" hidden></div>';
  var render = function () {
    var q = (document.getElementById('tw-q').value || '').toLowerCase();
    var lv = document.getElementById('tw-flevel').value;
    var sort = document.getElementById('tw-sort').value;
    var idx = students.map(function (s, i) { return i; }).filter(function (i) {
      var s = students[i];
      var nm = (s.display_name || s.email || '').toLowerCase();
      if (q && nm.indexOf(q) < 0) return false;
      if (lv && String(s.level || '').toLowerCase() !== lv) return false;
      return true;
    });
    idx.sort(function (a, b) {
      var sa = students[a], sb2 = students[b];
      if (sort === 'name') return String(sa.display_name || sa.email || '').localeCompare(String(sb2.display_name || sb2.email || ''));
      if (sort === 'xp') return (sb2.xp_7d || 0) - (sa.xp_7d || 0);
      if (sort === 'streak') return (sb2.current_streak || 0) - (sa.current_streak || 0);
      return String(sb2.last_active || '').localeCompare(String(sa.last_active || ''));
    });
    document.getElementById('tw-tbody').innerHTML = idx.length
      ? idx.map(function (i) { return twStudentRow(students[i], i, ptestByStudent); }).join('')
      : '<div class="empty">No students match.</div>';
  };
  ['tw-q', 'tw-flevel', 'tw-sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });
  var invBtn = document.getElementById('tw-invite');
  if (invBtn) invBtn.addEventListener('click', function () {
    var t = twEffTeacher();
    if (t) twCopy(teacherInviteLink(t.ref_code), this);
  });
  document.getElementById('tw-tbody').addEventListener('click', function (e) {
    var mb = e.target.closest('[data-twmenu]');
    if (mb) { twStudentMenu(mb, students); e.stopPropagation(); return; }
    var row = e.target.closest('.tw-trow');
    if (row) openTeacherStudent(parseInt(row.getAttribute('data-i'), 10));
  });
  document.addEventListener('click', function h(e) {
    var m = document.getElementById('tw-menu');
    if (m && !m.hidden && !e.target.closest('#tw-menu') && !e.target.closest('[data-twmenu]')) m.hidden = true;
  });
  render();
}

function twStudentMenu(btn, students) {
  var m = document.getElementById('tw-menu');
  var i = btn.getAttribute('data-twmenu');
  var s = students[parseInt(i, 10)];
  var nm = s.display_name || (s.email || '?').split('@')[0];
  m.innerHTML = '<b>' + esc(nm) + '</b>' +
    '<button data-m="view">📊 View 14-day activity</button>' +
    '<button data-m="report">📋 Assignment report</button>' +
    (twReadOnly() ? '' : '<button data-m="nudge">🔔 Send nudge</button>');
  var r = btn.getBoundingClientRect();
  m.style.top = (r.bottom + window.scrollY + 6) + 'px';
  m.style.left = Math.max(8, r.right + window.scrollX - 220) + 'px';
  m.hidden = false;
  Array.prototype.forEach.call(m.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      m.hidden = true;
      if (b.getAttribute('data-m') === 'nudge') twSendNudge(i);
      else if (b.getAttribute('data-m') === 'report') {
        state.twReportUid = s.user_id;
        twShowSection('student-report');
      }
      else openTeacherStudent(parseInt(i, 10));
    });
  });
}

async function twSendNudge(i) {
  var s = (state.teacherStudents || [])[parseInt(i, 10)];
  if (!s) return;
  try {
    var r = await sb.rpc('send_nudge', { p_student: s.user_id });
    showModal('<div class="modal-ico">🔔</div><h2>' +
      (r.data === true ? 'Nudge sent!' : 'Already sent today') + '</h2>' +
      '<p class="muted">' + esc(s.display_name || 'Your student') + ' will see your nudge in the app.</p>' +
      '<button class="tw-btn tw-btn-block" data-action="modal-close">OK</button>');
  } catch (e) {
    showModal('<div class="modal-ico">⚠️</div><h2>Could not send</h2>' +
      '<p class="muted">' + esc((e && e.message) || 'Try again later.') + '</p>' +
      '<button class="tw-btn tw-btn-block" data-action="modal-close">OK</button>');
  }
}

/* ---------------- page: assignments ---------------- */

/* Daily study — the admin panel's table, scoped to this teacher's students.
   Same shared renderer/fetch as the admin + in-app teacher versions. */
async function twPageDaily(c) {
  c.innerHTML = twPageHead('DAILY STUDY', 'Daily study',
      'Who studied how much, per day or range — your students only.') +
    '<div id="twd-daily"><div class="tw-empty">Loading…</div></div>';
  twLoadDaily();
}
async function twLoadDaily() {
  var host = document.getElementById('twd-daily');
  if (!host) return;
  var roster = await twGetStudents();
  var day = state.twDailyDay || todayStr();
  var range = state.twDailyRange || 'day';
  state.twDailyDay = day;
  state.twDailyRange = range;
  host.innerHTML = dailyStudyShell('twd', day, range, '📊 Daily study — who studied how much');
  var rangeSel = document.getElementById('twd-daily-range');
  if (rangeSel) rangeSel.addEventListener('change', function () {
    state.twDailyRange = rangeSel.value; twLoadDaily();
  });
  var dayInput = document.getElementById('twd-daily-day');
  if (dayInput) dayInput.addEventListener('change', function () {
    if (dayInput.value) { state.twDailyDay = dayInput.value; twLoadDaily(); }
  });
  var body = document.getElementById('twd-daily-body');
  var sum = document.getElementById('twd-daily-sum');
  if (!roster.length) {
    if (body) body.innerHTML = '<div class="empty">No students yet — share your invite link to get your first student.</div>';
    return;
  }
  try {
    var f = await fetchStudyRange(range, day, roster.map(function (s) { return s.user_id; }));
    var rows = roster.map(function (s) {
      return dailyStudyRow(s.user_id, f, s.display_name || '?', s.level);
    });
    rows.sort(function (a, b) { return b.min - a.min; });
    var active = rows.filter(dailyStudyActive).length;
    var totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
    if (sum) sum.textContent = active + ' / ' + rows.length + ' studied · ' + totalMin + ' total min · ' + rangeLabel(range);
    if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(range) + '.');
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
  }
}

async function twPageAssignments(c) {
  var assigns = await twGetAssignments();
  var students = await twGetStudents();
  var ro = twReadOnly();
  c.innerHTML = twPageHead('ASSIGNMENTS', 'Assignments',
      'Create, send and track assignments for your students.') +
    '<div class="tw-asg-top"><div class="tw-tabs">' +
      '<button class="tw-tab on" data-twtab="list">Sent</button>' +
      (ro ? '' : '<button class="tw-tab" data-twtab="planner">📅 Weekly planner</button>') + '</div>' +
      '<div class="tw-asg-actions"><button class="tw-btn tw-btn-white" id="tw-classreport">📊 Class report</button>' +
      (ro ? '' : '<button class="tw-btn tw-btn-orange" id="tw-new-assignment">＋ New assignment</button>') + '</div></div>' +
    '<div id="tw-assign-list"></div>' +
    '<div id="tw-assign-planner" hidden></div>';
  var paint = function () {
    var host = document.getElementById('tw-assign-list');
    if (!assigns.length) {
      host.innerHTML = '<div class="tw-emptybox"><div class="tw-empty-ill">✈️</div><b>No assignments yet</b>' +
        '<p class="muted">Create your first assignment and send it to your students.</p></div>';
      return;
    }
    host.innerHTML = assigns.map(function (a, i) {
      var st = twAsgStatus(a);
      var targets = (a.student_ids || []).length;
      var done = Object.keys((state.twDoneMap || {})[a.id] || {}).length;
      var pct = targets ? Math.round(done / targets * 100) : 0;
      var due = a.deadline || a.send_at;
      var kindIcon = a.kind === 'exam' ? '📋' : '📝';
      var tint = a.status === 'scheduled' ? '#EDE7FB' : (st[1] === 'pending' ? '#FFF0D6' : '#E4F5DB');
      var who = targets >= students.length && students.length ? 'All students' : targets + ' student' + (targets === 1 ? '' : 's');
      return '<div class="tw-asg" data-i="' + i + '" role="button" tabindex="0">' +
        '<span class="tw-asg-ico" style="background:' + tint + '">' + kindIcon + '</span>' +
        '<span class="tw-asg-main"><b>' + esc(a.title || 'Assignment') + '</b>' +
        '<small>📅 ' + (due ? 'Due ' + esc(twDueLabel(due)) : 'No due date') +
        ' <i>·</i> 👥 ' + esc(who) + '</small></span>' +
        '<span class="tw-asg-prog">' + twRing(pct) +
        '<span class="tw-asg-frac"><b>' + done + ' / ' + targets + '</b><small>completed</small></span></span>' +
        twPill(st[0], st[1]) + '<span class="tw-asg-arrow">→</span></div>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.tw-asg'), function (el) {
      el.addEventListener('click', function () {
        state.twAssignmentIdx = parseInt(el.getAttribute('data-i'), 10);
        twShowSection('assignment-detail');
      });
    });
  };
  paint();
  Array.prototype.forEach.call(c.querySelectorAll('[data-twtab]'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(c.querySelectorAll('[data-twtab]'), function (x) {
        x.classList.toggle('on', x === b);
      });
      var which = b.getAttribute('data-twtab');
      document.getElementById('tw-assign-list').hidden = which !== 'list';
      var ph = document.getElementById('tw-assign-planner');
      ph.hidden = which !== 'planner';
      if (which === 'planner' && !ph.getAttribute('data-loaded')) {
        ph.setAttribute('data-loaded', '1');
        renderPlanner(ph);
      }
    });
  });
  document.getElementById('tw-classreport').addEventListener('click', function () {
    twShowSection('class-report');
  });
  var newBtn = document.getElementById('tw-new-assignment');
  if (newBtn) newBtn.addEventListener('click', function () { twShowSection('compose'); });
}
/* ---------------- page: assignment detail (full-page, replaces the modal) ---------------- */
async function twPageAssignmentDetail(c) {
  var idx = state.twAssignmentIdx;
  var assigns = await twGetAssignments();
  var r = assigns[idx];
  if (r == null) { twShowSection('assignments'); return; }
  var roster = state.twStudents || state.teacherStudents || [];
  var nameOf = {};
  roster.forEach(function (s) {
    nameOf[s.user_id] = s.display_name || (s.email || '?').split('@')[0];
  });
  var results = [];
  try {
    var q = await sb.from('assignment_results')
      .select('student_id,score,total,completed_at,answers').eq('assignment_id', r.id);
    results = q.data || [];
  } catch (e) {}
  var byId = {};
  results.forEach(function (x) { byId[x.student_id] = x; });
  var targets = (r.student_ids || []).length;
  var done = results.length;
  var kindIcon = r.kind === 'exam' ? '📋' : '📝';
  var sub = r.status === 'scheduled' && r.send_at
    ? esc(schedLabel(r.send_at, r.send_tz)).replace(/^⏰ /, '') + ' — not sent yet.'
    : targets + ' student' + (targets === 1 ? '' : 's') + ' · ' + done + ' completed';
  var statusBox;
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
      var res = byId[uid];
      var nm = nameOf[uid] || '—';
      return '<div class="tw-m-row">' + twAvatar(nm) + '<b>' + esc(nm) + '</b>' +
        (res ? '<span class="tw-pill tw-pill-green">✓ ' + res.score + '/' + res.total + '</span>'
             : '<span class="tw-pill tw-pill-gray">⏳ pending</span>') + '</div>';
    }).join('') + '</div>';
  }
  var actionBtn = '';
  if (twReadOnly()) {
    actionBtn = '<p class="muted" style="font-size:0.85rem">👁 Read-only admin view.</p>';
  } else if (r.status === 'scheduled') {
    actionBtn = '<button class="tw-m-del" id="tw-ad-cancel">✕ Cancel scheduled send</button>';
  } else {
    actionBtn = '<button class="tw-m-del" id="tw-ad-delete">🗑 Delete assignment</button>';
  }
  c.innerHTML = twPageHead('ASSIGNMENTS', kindIcon + ' ' + esc(r.title || 'Assignment'), sub) +
    '<div class="tw-backrow"><button class="tw-btn tw-btn-white" id="tw-back-assign">← Back to assignments</button></div>' +
    '<div class="tw-card tw-adetail">' + statusBox + '<div id="tw-ad-hardest"></div><div id="tw-ad-missed"></div>' + actionBtn + '</div>';
  twFillHardest(r, results);
  twFillMissedWords(r, results, nameOf);
  document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
  var del = document.getElementById('tw-ad-delete');
  if (del) del.addEventListener('click', function () { deleteTeacherAssignment(idx, del); });
  var can = document.getElementById('tw-ad-cancel');
  if (can) can.addEventListener('click', function () { cancelScheduledAssignment(idx, can); });
  window.scrollTo(0, 0);
}
/* Vocabulary assignments: per-student missed words on the detail page.
   Answers carry qid ('vocab:<slug>:<type>:<n>'); questions carry word +
   explanation (word — meaning_en · meaning_fa · example). */
async function twFillMissedWords(r, results, nameOf) {
  var host = document.getElementById('tw-ad-missed');
  if (!host || !results.length) return;
  try {
    var aq = await sb.from('assignments').select('topic,questions').eq('id', r.id).single();
    if (aq.error || !aq.data || aq.data.topic !== 'vocab') return;
    var byQid = {};
    (aq.data.questions || []).forEach(function (q) { if (q.id) byQid[q.id] = q; });
    var blocks = results.map(function (res) {
      var missed = [];
      var seenW = {};
      (res.answers || []).forEach(function (a) {
        var wrong = (a.isCorrect !== undefined) ? !a.isCorrect : (typeof a.correct === 'boolean' ? !a.correct : false);
        if (!wrong || !a.qid) return;
        var q = byQid[a.qid];
        if (!q || !q.word || seenW[q.word]) return;
        seenW[q.word] = true;
        missed.push(q);
      });
      var nm = nameOf[res.student_id] || 'Student';
      if (!missed.length) {
        return '<div class="tw-missed"><b>' + esc(nm) + '</b> <span class="tw-pill tw-pill-green">✓ All words correct</span></div>';
      }
      return '<div class="tw-missed"><b>' + esc(nm) + '</b> <span class="muted">missed ' + missed.length + ' word' + (missed.length === 1 ? '' : 's') + ':</span>' +
        '<div class="tw-missed-chips">' + missed.map(function (q) {
          var m = String(q.explanation || '').split(' Example:')[0];
          return '<span class="tw-missed-chip"><b>' + esc(q.word) + '</b>' + (m ? ' · ' + esc(m.replace(q.word + ' — ', '')) : '') + '</span>';
        }).join('') + '</div></div>';
    }).join('');
    if (blocks) host.innerHTML = '<div class="an-title" style="margin-top:1rem">📚 Words to review</div>' + blocks;
  } catch (e) {}
}

/* ---------------- page: new assignment (full-page composer) ---------------- */
/* Full-page version of the assignment composer for the /teachers portal.
   Reuses assignmentComposerBodyHTML() + assignmentComposerWire() (shared with the modal). */

/* ---------------- IELTS speaking scoring (teacher portal) ----------------
   Students record IELTS Speaking in the app; recordings land in
   ielts_submissions. The teacher listens here and awards the band —
   speaking is never AI-scored (Alireza's order 2026-11-04). */

async function twPageIelts(c) {
  var ixT = twEffTeacher();
  var ieltsLinkCard = ixT ? '<div class="tw-ix-card"><b>🔗 Your IELTS Mock link</b>' +
    '<p class="tw-sub" style="margin:4px 0 8px">Send this link to your students — the full mock is ' + (IELTS_MOCK_FREE ? 'free for every learner' : '⭐ VIP-only') + ', and their Speaking recordings come back to this page for your score.</p>' +
    '<div class="tw-linkrow"><code>' + esc(teacherIeltsLink(ixT.ref_code)) + '</code>' +
    '<button class="tw-btn tw-btn-orange tw-btn-sm" id="tw-copy-ielts2">⧉ Copy</button></div></div>' : '';
  c.innerHTML = '<div class="tw-page"><h2 class="tw-h">🎓 IELTS Speaking</h2>' +
    '<p class="tw-sub">Your students record the IELTS Speaking parts in the app. Listen to each part, then award the band (0–9, half bands) with optional feedback. The student sees your score in their mock results.</p>' +
    ieltsLinkCard + '<div id="tw-ix-list"><div class="empty">Loading…</div></div></div>';
  var ixCopyBtn = document.getElementById('tw-copy-ielts2');
  if (ixCopyBtn && ixT) ixCopyBtn.addEventListener('click', function () { twCopy(teacherIeltsLink(ixT.ref_code), this); });
  var listEl = document.getElementById('tw-ix-list');
  var rows = [];
  try {
    var r = await sb.from('ielts_submissions').select('*').order('created_at', { ascending: false }).limit(60);
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    listEl.innerHTML = '<div class="empty">IELTS submissions are not available yet — they will appear here once the database table is set up.</div>';
    return;
  }
  var students = await twGetStudents();
  var nameOf = {};
  (students || []).forEach(function (s) {
    var nm = s.display_name || s.name || s.email || '';
    if (s.user_id) nameOf[s.user_id] = nm;
    if (s.id) nameOf[s.id] = nm;
  });
  if (!rows.length) {
    listEl.innerHTML = '<div class="empty">No IELTS speaking submissions yet. When a student finishes a mock test, their recordings appear here.</div>';
    return;
  }
  rows.sort(function (a, b2) {
    var pa = a.status === 'pending' ? 0 : 1, pb = b2.status === 'pending' ? 0 : 1;
    return pa - pb;
  });
  var bandOpts = function (sel) {
    var out = '<option value="">— choose band —</option>';
    for (var b = 9; b >= 1; b -= 0.5) {
      var v = (b % 1 === 0) ? b.toFixed(1) : '' + b;
      out += '<option value="' + v + '"' + (sel !== null && sel !== undefined && Number(sel) === b ? ' selected' : '') + '>Band ' + v + '</option>';
    }
    return out;
  };
  listEl.innerHTML = rows.map(function (row) {
    var name = nameOf[row.user_id] || 'Student';
    var when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
    var aud = ['p1', 'p2', 'p3'].map(function (k, i) {
      var url = (row.audio || {})[k];
      if (!url) return '';
      return '<div class="tw-ix-audio"><b>Part ' + (i + 1) + '</b><audio controls preload="none" src="' + esc(url) + '"></audio></div>';
    }).join('');
    var trs = ['p1', 'p2', 'p3'].map(function (k, i) {
      var t = (row.transcripts || {})[k];
      if (!t) return '';
      return '<details class="ix-det"><summary>Part ' + (i + 1) + ' transcript</summary><div class="ix-wtext">' + esc(t) + '</div></details>';
    }).join('');
    var scored = row.status === 'scored';
    return '<div class="tw-ix-card">' +
      '<div class="tw-ix-head"><b>' + esc(name) + '</b><span class="tw-ix-when">' + esc(when) + '</span>' +
      '<span class="tw-ix-badge' + (scored ? ' done' : '') + '">' + (scored ? '✅ Band ' + ieltsBandTxt(Number(row.band)) : '⏳ Waiting for your score') + '</span></div>' +
      (aud || '<p class="tw-sub">No audio files (transcript only).</p>') + trs +
      '<div class="tw-ix-score"><label>Band <select id="tw-ix-band-' + row.id + '">' + bandOpts(row.band) + '</select></label>' +
      '<input type="text" id="tw-ix-fb-' + row.id + '" placeholder="Feedback for the student (optional)" value="' + esc(row.feedback || '') + '">' +
      '<button class="tw-btn tw-btn-sm" data-twix="' + row.id + '">' + (scored ? 'Update score' : 'Save score') + '</button></div></div>';
  }).join('');
  Array.prototype.forEach.call(listEl.querySelectorAll('[data-twix]'), function (btn) {
    btn.addEventListener('click', async function () {
      var id = btn.getAttribute('data-twix');
      var band = document.getElementById('tw-ix-band-' + id).value;
      var fb = document.getElementById('tw-ix-fb-' + id).value;
      if (!band) { btn.textContent = 'Pick a band first'; setTimeout(function () { btn.textContent = 'Save score'; }, 1600); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var up = await sb.from('ielts_submissions').update({
          band: Number(band), feedback: fb || null, status: 'scored',
          scored_at: new Date().toISOString(), scored_by: (state.user && state.user.id) || null
        }).eq('id', id);
        if (up.error) throw up.error;
        twPageIelts(c);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Save failed — retry';
      }
    });
  });
}

async function twPageCompose(c) {
  if (twReadOnly()) { twShowSection('assignments'); return; }
  await loadV2Index();
  var list = await twGetStudents();
  var head = twPageHead('ASSIGNMENTS', 'New assignment',
      'Pick a topic, choose teaching points and send it to your students.') +
    '<div class="tw-backrow"><button class="tw-btn tw-btn-white" id="tw-back-assign">← Back to assignments</button></div>';
  if (!list.length) {
    c.innerHTML = head +
      '<div class="tw-emptybox"><div class="tw-empty-ill">🌱</div><b>No students yet</b>' +
      '<p class="muted">Share your invite link first, then create assignments.</p></div>';
    document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
    return;
  }
  c.innerHTML = head +
    '<div class="tw-compose as2">' + assignmentComposerBodyHTML(list) + '</div>';
  document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
  assignmentComposerWire();
  window.scrollTo(0, 0);
}

function twDueLabel(d) {
  var dt = new Date(d.length <= 10 ? d + 'T12:00:00' : d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
/* ---------------- page: class report (full page, no popup) ---------------- */

async function twPageClassReport(c) {
  var assigns = await twGetAssignments();
  var students = await twGetStudents();
  var doneMap = state.twDoneMap || {};
  var sent = assigns.filter(function (a) { return a.status !== 'scheduled'; }).slice(0, 8);
  var body;
  if (!sent.length || !students.length) {
    body = '<div class="tw-emptybox"><div class="tw-empty-ill">📊</div><b>Nothing to report yet</b>' +
      '<p class="muted">Once assignments are sent and students start completing them,<br>the report will appear here.</p></div>';
  } else {
    body = '<div class="tw-tablecard"><table class="tw-matrix"><tr><th>Student</th>' +
      sent.map(function (a) {
        return '<th title="' + esc(a.title || '') + '">' + esc(a.title || '') + '</th>';
      }).join('') + '</tr>' +
      students.map(function (s) {
        var nm = s.display_name || (s.email || '?').split('@')[0];
        return '<tr><td><b>' + esc(nm) + '</b></td>' + sent.map(function (a) {
          var dm = doneMap[a.id] || {};
          if ((a.student_ids || []).indexOf(s.user_id) < 0) return '<td class="muted">–</td>';
          return '<td>' + (dm[s.user_id] ? '<span class="tw-ok">✓</span>' : '<span class="tw-pend">○</span>') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table></div>' +
      '<p class="muted" style="font-size:0.85rem"><span class="tw-ok">✓</span> completed &nbsp;·&nbsp; <span class="tw-pend">○</span> pending &nbsp;·&nbsp; – not assigned</p>';
  }
  c.innerHTML = twPageHead('ASSIGNMENTS', '📊 Class report',
      'Completion per student across recent assignments.') +
    '<div class="tw-backrow"><button class="tw-btn tw-btn-white" id="tw-back-assign">← Back to assignments</button></div>' +
    body;
  document.getElementById('tw-back-assign').addEventListener('click', function () { twShowSection('assignments'); });
  window.scrollTo(0, 0);
}

/* ---------------- assignment answer helpers ---------------- */

function twAnsIsCorrect(a) {
  if (!a) return false;
  if (a.isCorrect !== undefined) return !!a.isCorrect;
  if (typeof a.correct === 'boolean') return a.correct;
  return a.picked === a.correct;
}
function twAnsText(q, v) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') {
    if (q && q.type === 'error') {
      var sg = (q.segments || [])[v];
      return sg !== undefined ? sg : ('Part ' + (v + 1));
    }
    if (q && (q.options || []).length) {
      return q.options[v] !== undefined ? q.options[v] : ('Option ' + (v + 1));
    }
    return String(v);
  }
  return String(v);
}
function twCorrectText(q, a) {
  if (!q) return '—';
  if (q.type === 'gap') return (q.accept && q.accept[0]) || twAnsText(q, q.answer);
  var v = (a && typeof a.correct !== 'boolean' && a.correct !== undefined) ? a.correct : q.answer;
  return twAnsText(q, v);
}
function twQPrompt(q) {
  if (!q) return '';
  if (q.type === 'error') return 'Which part is wrong? ' + (q.segments || []).join(' · ');
  return q.prompt || q.q || '';
}
function twCleanExpl(x) { return String(x || '').replace(/\*/g, ''); }

/* ---------------- page: student assignment report ---------------- */

async function twPageStudentReport(c) {
  var students = await twGetStudents();
  var s = null;
  students.forEach(function (x) { if (x.user_id === state.twReportUid) s = x; });
  if (!s) { twShowSection('students'); return; }
  var nm = s.display_name || (s.email || '?').split('@')[0];
  var head = twPageHead('STUDENTS', '📊 ' + esc(nm),
      esc(s.email || '') + (s.level ? ' · Level ' + esc(String(s.level).toUpperCase()) : '') +
      ((s.current_streak || 0) > 0 ? ' · 🔥 ' + s.current_streak + '-day streak' : '')) +
    '<div class="tw-backrow"><button class="tw-btn tw-btn-white" id="tw-back-students">← Back to students</button></div>';
  c.innerHTML = head + '<div class="empty">Loading report…</div>';
  document.getElementById('tw-back-students').addEventListener('click', function () { twShowSection('students'); });

  var assigns = await twGetAssignments();
  var mine = assigns.filter(function (a) { return (a.student_ids || []).indexOf(s.user_id) >= 0; });
  var myIds = {};
  mine.forEach(function (a) { myIds[a.id] = 1; });
  var results = [];
  try {
    var rq = await sb.from('assignment_results')
      .select('assignment_id,score,total,completed_at,answers').eq('student_id', s.user_id);
    if (!rq.error) results = (rq.data || []).filter(function (r) { return myIds[r.assignment_id]; });
  } catch (e) {}
  var resBy = {};
  results.forEach(function (r) { resBy[r.assignment_id] = r; });

  /* ---- summary ---- */
  var sent = mine.filter(function (a) { return a.status !== 'scheduled'; });
  var doneList = sent.filter(function (a) { return resBy[a.id]; });
  var avg = doneList.length
    ? Math.round(doneList.reduce(function (acc, a) {
        var r = resBy[a.id];
        return acc + (r.total ? (r.score / r.total) * 100 : 0);
      }, 0) / doneList.length)
    : null;
  var lastDone = null;
  results.forEach(function (r) { if (!lastDone || r.completed_at > lastDone) lastDone = r.completed_at; });

  /* ---- weak points + missed words ---- */
  var ptAtt = {}, ptWrong = {}, wordWrong = {};
  results.forEach(function (r) {
    (r.answers || []).forEach(function (a) {
      var ok = twAnsIsCorrect(a);
      (a.points || []).forEach(function (pid) {
        ptAtt[pid] = (ptAtt[pid] || 0) + 1;
        if (!ok) ptWrong[pid] = (ptWrong[pid] || 0) + 1;
      });
      if (!ok && a.qid && a.qid.indexOf('vocab:') === 0) {
        var slug = a.qid.split(':')[1] || '';
        if (slug) wordWrong[slug] = (wordWrong[slug] || 0) + 1;
      }
    });
  });
  var ptTitles = {};
  try {
    var all = await loadAllGrammar();
    (all || []).forEach(function (t) {
      (t.points || []).forEach(function (p) { if (p.id) ptTitles[p.id] = p.title || p.id; });
    });
  } catch (e) {}
  var weakPts = Object.keys(ptWrong).map(function (pid) {
    return { label: ptTitles[pid] || pid, wrong: ptWrong[pid], att: ptAtt[pid] || 0 };
  }).sort(function (a, b) { return b.wrong - a.wrong; }).slice(0, 8);
  var missedWords = Object.keys(wordWrong).map(function (slug) {
    return { word: slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim(), n: wordWrong[slug] };
  }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);

  /* ---- render ---- */
  var statCard = function (ico, bg, n, l, sub) {
    return '<div class="tw-stat"><span class="tw-stat-ico" style="background:' + bg + '">' + ico + '</span>' +
      '<div class="tw-stat-top"><span class="tw-stat-n">' + n + '</span><span class="tw-stat-l">' + l + '</span></div>' +
      '<div class="tw-stat-s">' + sub + '</div></div>';
  };
  var html = head +
    '<div class="tw-stats">' +
      statCard('📨', '#EDE7FB', sent.length, 'Assignments sent', 'Assignments this student received') +
      statCard('✅', '#E3F5D8', doneList.length, 'Completed', sent.length ? Math.round(doneList.length / sent.length * 100) + '% completion rate' : 'Nothing sent yet') +
      statCard('🎯', '#FFE8D6', avg === null ? '–' : avg + '%', 'Average score', 'Across completed assignments') +
      statCard('🕐', '#DFF3E6', lastDone ? twDate(lastDone) : '–', 'Last completed', lastDone ? 'Most recent submission' : 'No submissions yet') +
    '</div>';

  if (weakPts.length || missedWords.length) {
    html += '<div class="tw-card" style="padding:1.1rem 1.25rem;margin-bottom:1.2rem"><div class="an-title">🎯 Weak points</div>';
    if (weakPts.length) {
      html += '<p class="muted" style="margin:0.4rem 0 0">Grammar points with the most mistakes:</p><div class="tw-missed-chips">' +
        weakPts.map(function (p) {
          return '<span class="tw-missed-chip"><b>' + esc(p.label) + '</b> · ✗ ' + p.wrong + ' of ' + p.att + '</span>';
        }).join('') + '</div>';
    }
    if (missedWords.length) {
      html += '<p class="muted" style="margin:0.7rem 0 0">Words most often missed:</p><div class="tw-missed-chips">' +
        missedWords.map(function (w) {
          return '<span class="tw-missed-chip"><b>' + esc(w.word) + '</b>' + (w.n > 1 ? ' · ✗ ' + w.n : '') + '</span>';
        }).join('') + '</div>';
    }
    html += '</div>';
  }

  var sorted = mine.slice().sort(function (a, b) {
    return String(b.send_at || b.created_at || '').localeCompare(String(a.send_at || a.created_at || ''));
  });
  html += '<div class="an-title" style="margin-bottom:0.6rem">🗂 Assignment history (' + sorted.length + ')</div>';
  if (!sorted.length) {
    html += '<div class="tw-emptybox"><div class="tw-empty-ill">📭</div><b>No assignments yet</b>' +
      '<p class="muted">This student has not received any assignments.</p></div>';
  } else {
    html += sorted.map(function (a) {
      var r = resBy[a.id];
      var when = a.send_at || a.created_at;
      var meta = '📅 ' + (a.status === 'scheduled' ? 'Sends ' : 'Sent ') + twDate(when) +
        (a.level ? ' · ' + esc(String(a.level).toUpperCase()) : '') +
        ' · ' + (a.question_count || ((a.questions || []).length) || '?') + ' questions' +
        (a.deadline ? ' · Due ' + twDate(a.deadline) : '');
      var pill, btn = '';
      if (a.status === 'scheduled') pill = twPill('Scheduled', 'sched');
      else if (r) {
        var pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
        pill = twPill('✓ ' + r.score + '/' + r.total + ' · ' + pct + '%', pct >= 60 ? 'green' : 'gray');
        btn = '<button class="tw-btn tw-btn-white tw-btn-sm" data-rep-toggle="' + a.id + '">Answers ▾</button>';
      } else if (a.deadline && new Date(a.deadline) < new Date()) pill = twPill('Overdue', 'gray');
      else pill = twPill('Pending', 'pending');
      return '<div class="tw-card tw-rep-asg"><div class="tw-rep-head"><div class="tw-rep-main">' +
        '<b>' + esc(a.title || 'Assignment') + '</b><small>' + meta +
        (r ? ' · Submitted ' + twDate(r.completed_at) : '') + '</small></div>' +
        pill + btn + '</div>' +
        '<div class="tw-rep-body" id="tw-rep-body-' + a.id + '" hidden></div></div>';
    }).join('');
  }
  c.innerHTML = html;
  document.getElementById('tw-back-students').addEventListener('click', function () { twShowSection('students'); });
  Array.prototype.forEach.call(c.querySelectorAll('[data-rep-toggle]'), function (b) {
    b.addEventListener('click', function () { twToggleRepAnswers(b, resBy[b.getAttribute('data-rep-toggle')]); });
  });
  window.scrollTo(0, 0);
}

async function twToggleRepAnswers(btn, res) {
  var aid = btn.getAttribute('data-rep-toggle');
  var body = document.getElementById('tw-rep-body-' + aid);
  if (!body) return;
  if (!body.hidden) { body.hidden = true; btn.textContent = 'Answers ▾'; return; }
  body.hidden = false;
  btn.textContent = 'Answers ▴';
  if (body.getAttribute('data-loaded') || !res) return;
  body.setAttribute('data-loaded', '1');
  body.innerHTML = '<div class="empty">Loading answers…</div>';
  var questions = [];
  try {
    var aq = await sb.from('assignments').select('questions').eq('id', aid).single();
    if (!aq.error && aq.data) questions = aq.data.questions || [];
  } catch (e) {}
  var byQid = {};
  questions.forEach(function (q) { if (q.id) byQid[q.id] = q; });
  var rows = (res.answers || []).map(function (a, i) {
    var q = (a.qid && byQid[a.qid]) || questions[i];
    var ok = twAnsIsCorrect(a);
    var line = '<div class="tw-rep-q"><div class="tw-rep-qhead"><span class="tw-rep-qn">Q' + (i + 1) + '</span>' +
      '<span class="tw-rep-qp">' + esc(twQPrompt(q)) + '</span>' +
      (ok ? '<span class="tw-ok">✓</span>' : '<span class="tw-ans-bad">✗</span>') + '</div>';
    if (!ok && q) {
      line += '<div class="tw-rep-detail">Their answer: <span class="tw-ans-bad">' + esc(twAnsText(q, a.picked)) + '</span>' +
        ' &nbsp;·&nbsp; Correct: <span class="tw-ans-good">' + esc(twCorrectText(q, a)) + '</span>' +
        (q.type === 'error' && q.correction ? '<br>Correction: ' + esc(q.correction) : '') +
        (q.explanation ? '<br><span class="muted">' + esc(twCleanExpl(q.explanation)) + '</span>' : '') +
        '</div>';
    }
    return line + '</div>';
  }).join('');
  body.innerHTML = rows || '<div class="empty">No answer detail stored for this assignment.</div>';
}

/* ---------------- assignment detail: hardest questions ---------------- */

async function twFillHardest(r, results) {
  var host = document.getElementById('tw-ad-hardest');
  if (!host || !results.length) return;
  try {
    var aq = await sb.from('assignments').select('questions').eq('id', r.id).single();
    if (aq.error || !aq.data) return;
    var questions = aq.data.questions || [];
    var byQid = {};
    questions.forEach(function (q) { if (q.id) byQid[q.id] = q; });
    var stat = {};
    results.forEach(function (res) {
      (res.answers || []).forEach(function (a, i) {
        var q = (a.qid && byQid[a.qid]) || questions[i];
        if (!q) return;
        var key = a.qid || ('i' + i);
        var st = stat[key] || (stat[key] = { q: q, att: 0, wrong: 0, picks: {} });
        st.att++;
        if (!twAnsIsCorrect(a)) {
          st.wrong++;
          var t = twAnsText(q, a.picked);
          st.picks[t] = (st.picks[t] || 0) + 1;
        }
      });
    });
    var list = Object.keys(stat).map(function (k) { return stat[k]; })
      .filter(function (x) { return x.wrong > 0; });
    list.sort(function (x, y) { return (y.wrong / y.att) - (x.wrong / x.att) || y.wrong - x.wrong; });
    list = list.slice(0, 5);
    if (!list.length) {
      host.innerHTML = '<div class="an-title" style="margin-top:1rem">🎯 Hardest questions</div>' +
        '<p class="muted">No mistakes yet — everyone answered everything correctly.</p>';
      return;
    }
    host.innerHTML = '<div class="an-title" style="margin-top:1rem">🎯 Hardest questions</div>' +
      list.map(function (x) {
        var pct = Math.round((x.wrong / x.att) * 100);
        var topPick = Object.keys(x.picks).sort(function (p1, p2) { return x.picks[p2] - x.picks[p1]; })[0];
        return '<div class="tw-rep-q"><b>' + esc(twQPrompt(x.q)) + '</b>' +
          '<div class="muted" style="font-size:0.86rem">✗ ' + x.wrong + ' of ' + x.att + ' missed (' + pct + '%)' +
          (topPick ? ' · most common wrong answer: <span class="tw-ans-bad">' + esc(topPick) + '</span>' : '') +
          '<br>Correct answer: <span class="tw-ans-good">' + esc(twCorrectText(x.q, null)) + '</span></div></div>';
      }).join('');
  } catch (e) {}
}

/* ---------------- page: placement tests ---------------- */

async function twPagePlacement(c) {
  var rows = await twGetPtest();
  c.innerHTML = twPageHead('PLACEMENT TESTS', 'Placement tests',
      'Review your students’ 5-part placement tests — vocabulary, listening, grammar, writing, speaking.') +
    '<div class="tw-banner"><div class="tw-banner-txt"><span class="tw-banner-ico">📝</span>' +
      '<div><b>New student? Send them your placement link.</b>' +
      '<p>Their results will appear here with a suggested level.</p></div></div>' +
      twPlane() +
      '<button class="tw-btn tw-btn-orange" id="tw-copy-ptest2">🔗 Copy placement link</button></div>' +
    '<div id="tw-ptest-list"></div><div id="tch-ptest-detail"></div>';
  document.getElementById('tw-copy-ptest2').addEventListener('click', function () {
    twCopy(teacherPlacementLink((twEffTeacher() || {}).ref_code), this);
  });
  var host = document.getElementById('tw-ptest-list');
  if (!rows.length) {
    host.innerHTML = '<div class="tw-emptybox"><div class="tw-empty-ill">📝</div><b>No tests yet</b>' +
      '<p class="muted">When your students take a placement test,<br>their results will appear here.</p></div>';
    return;
  }
  host.innerHTML = '<div class="tw-ptests">' + rows.map(function (x, i) {
    var sc = x.scores || {};
    var done = x.status === 'completed';
    return '<div class="tw-ptest" data-i="' + i + '" role="button" tabindex="0">' +
      twAvatar(x.student_name) +
      '<span class="tw-ptest-main"><b>' + esc(x.student_name || 'Student') + '</b>' +
      '<small>' + esc(twDate(x.completed_at || x.updated_at)) +
      (x.student_mobile ? ' · ' + esc(x.student_mobile) : '') + '</small></span>' +
      (done ? '<span class="tw-ptest-score"><b>' + (sc.total || 0) + '/55</b><small>total</small></span>' +
        (x.suggested_level ? twPill(esc(x.suggested_level), 'green') : '') : twPill('In progress', 'gray')) +
      '<span class="tw-asg-arrow">→</span></div>';
  }).join('') + '</div>';
  Array.prototype.forEach.call(host.querySelectorAll('.tw-ptest'), function (el) {
    el.addEventListener('click', function () {
      openPlacementDetail(parseInt(el.getAttribute('data-i'), 10));
      setTimeout(function () {
        var d = document.getElementById('tch-ptest-detail');
        if (d) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    });
  });
}

/* ---------------- page: invite & links + settings ---------------- */

function twProfileEditor(host) {
  host.innerHTML = '<div class="empty">Loading…</div>';
  (async function () {
    var p = {};
    try {
      var r = await sb.from('teachers')
        .select('display_name,photo_url,experience_years,bio')
        .eq('user_id', state.user.id).maybeSingle();
      if (!r.error) p = r.data || {};
    } catch (e) {}
    var previewURL = null, pendingFile = null;
    var photoHTML = function (url, name) {
      return url
        ? '<img id="tw-photo-prev" class="tw-prof-photo" src="' + esc(url) + '" alt="">'
        : '<div id="tw-photo-prev" class="tw-prof-photo">' + esc((name || '?').charAt(0).toUpperCase()) + '</div>';
    };
    host.innerHTML =
      '<div class="tw-prof-grid"><div>' +
        '<div class="tw-prof-photowrap">' + photoHTML(p.photo_url, p.display_name) +
        '<label class="tw-btn tw-btn-sm tw-btn-white" style="cursor:pointer">⬆ Upload photo<input type="file" id="tw-photo-file" accept="image/*" hidden></label>' +
        '<small class="muted">JPG, PNG up to 2MB</small></div></div>' +
      '<div class="tw-prof-fields">' +
        '<div class="field"><label>Display name</label><input id="tw-f-name" maxlength="40" value="' + esc(p.display_name || '') + '"></div>' +
        '<div class="field"><label>Years of teaching experience</label><input id="tw-f-exp" inputmode="numeric" placeholder="e.g. 5" value="' + esc(p.experience_years == null ? '' : p.experience_years) + '"></div>' +
        '<div class="field"><label>Short bio (one line, max 200)</label>' +
        '<textarea id="tw-f-bio" rows="2" maxlength="200" placeholder="e.g. IELTS coach — I help adults speak with confidence">' + esc(p.bio || '') + '</textarea>' +
        '<small class="muted" id="tw-bio-count">' + (p.bio || '').length + '/200</small></div>' +
        '<div><button class="tw-btn tw-btn-orange" id="tw-prof-save">Save profile</button> ' +
        '<span class="muted" id="tw-prof-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
      '</div>' +
      '<div class="tw-prof-preview"><div class="tw-cardhead"><h3 style="margin:0">👁 Profile preview</h3>' +
      '<a class="tw-btn tw-btn-sm tw-btn-white" href="/#/choose-teacher" target="_blank" rel="noopener">View public profile ⬈</a></div>' +
      '<div class="tw-pvcard" id="tw-pv"></div>' +
      '<p class="muted" style="font-size:0.82rem">Here’s how students will see you.</p></div>' +
      '</div>';
    var paintPreview = function () {
      var nm = host.querySelector('#tw-f-name').value.trim() || '?';
      var bio = host.querySelector('#tw-f-bio').value.trim();
      var url = previewURL || p.photo_url;
      document.getElementById('tw-pv').innerHTML =
        '<div class="tw-pv-top">' + (url
          ? '<img class="tw-pv-photo" src="' + esc(url) + '" alt="">'
          : '<div class="tw-pv-photo tw-pv-initial">' + esc(nm.charAt(0).toUpperCase()) + '</div>') +
        '<div><b>' + esc(nm) + '</b><small>Teacher</small>' +
        '<div>' + twPill('● New on Muse English', 'green') + '</div></div></div>' +
        '<div class="tw-pv-meta"><span>📖 <b>' + (state.twStudents || []).length + '+ students</b></span>' +
        '<span>⭐ <b>0.0</b> (0 reviews)</span></div>' +
        '<p class="tw-pv-bio">' + esc(bio || 'No bio yet.') + '</p>';
    };
    host.querySelector('#tw-f-bio').addEventListener('input', function () {
      host.querySelector('#tw-bio-count').textContent = this.value.length + '/200';
      paintPreview();
    });
    host.querySelector('#tw-f-name').addEventListener('input', paintPreview);
    host.querySelector('#tw-photo-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      pendingFile = f;
      var rd = new FileReader();
      rd.onload = function () { previewURL = rd.result; paintPreview(); };
      rd.readAsDataURL(f);
    });
    host.querySelector('#tw-prof-save').addEventListener('click', async function () {
      var status = host.querySelector('#tw-prof-status');
      var say = function (t, ok) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; };
      var name = host.querySelector('#tw-f-name').value.trim();
      var expRaw = host.querySelector('#tw-f-exp').value.trim();
      var bio = host.querySelector('#tw-f-bio').value.trim();
      if (name.length < 2) { say('Display name is too short.', false); return; }
      var exp = expRaw === '' ? null : parseInt(expRaw, 10);
      if (expRaw !== '' && !(exp >= 0 && exp <= 60)) { say('Experience must be 0–60 years.', false); return; }
      if (bio.length > 200) { say('Bio is too long (max 200).', false); return; }
      say('Saving…', true);
      try {
        var photoURL = p.photo_url || null;
        if (pendingFile) {
          var ext = ((pendingFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
          var path = state.user.id + '/photo.' + ext;
          var up = await sb.storage.from('teacher-photos').upload(path, pendingFile, { upsert: true, contentType: pendingFile.type || 'image/jpeg' });
          if (up.error) throw up.error;
          photoURL = sb.storage.from('teacher-photos').getPublicUrl(path).data.publicUrl;
        }
        var rr = await sb.rpc('update_teacher_profile', {
          p_display_name: name, p_experience_years: exp, p_bio: bio, p_photo_url: photoURL || ''
        });
        if (rr.error || rr.data !== true) throw new Error('save failed');
        p = { display_name: name, photo_url: photoURL, experience_years: exp, bio: bio };
        if (state.teacher) state.teacher.display_name = name;
        pendingFile = null; previewURL = photoURL;
        say('Saved ✓', true);
        paintPreview();
        twRenderWorkspace(document.getElementById('view'));
      } catch (e) { say('Save failed: ' + (e.message || e), false); }
    });
    paintPreview();
  })();
}

async function twPageLinks(c) {
  var t = twEffTeacher();
  if (!t) {
    c.innerHTML = twPageHead('INVITE & LINKS', 'Invite & links',
      'Share your links, bring in new students and build your profile.') +
      '<div class="tw-emptybox"><div class="tw-empty-ill">🔗</div><b>No teacher selected</b>' +
      '<p class="muted">Pick a teacher from the switcher above.</p></div>';
    return;
  }
  var ro = twReadOnly();
  await twGetStudents();
  c.innerHTML = twPageHead('INVITE & LINKS', 'Invite & links',
      'Share your links, bring in new students and build your profile.') +
    '<div class="tw-linkcard"><span class="tw-link-ico" style="background:#FFE8D6">🔗</span>' +
      '<div class="tw-link-main"><b>Your personal invite link</b>' +
      '<p class="muted">Share it with your students — everyone who signs up through it shows up on your roster.</p>' +
      '<div class="tw-linkrow"><code>' + esc(teacherInviteLink(t.ref_code)) + '</code>' +
      '<button class="tw-btn tw-btn-orange tw-btn-sm" id="tw-copy-invite">⧉ Copy</button></div></div>' +
      '<div class="tw-link-side"><div class="tw-link-note">New students who sign up with this link will be added to your class roster.</div></div></div>' +
    '<div class="tw-linkcard"><span class="tw-link-ico" style="background:#E4F5DB">📝</span>' +
      '<div class="tw-link-main"><b>Placement test link for new students</b>' +
      '<p class="muted">Send it to a new student — they take a 5-part test and the results land in your dashboard.</p>' +
      '<div class="tw-linkrow"><code>' + esc(teacherPlacementLink(t.ref_code)) + '</code>' +
      '<button class="tw-btn tw-btn-orange tw-btn-sm" id="tw-copy-ptest3">⧉ Copy</button></div></div>' +
      '<div class="tw-link-side"><div class="tw-link-note tw-link-note-p">Students take a 5-part placement test and their results will appear in your dashboard.</div></div></div>' +
    '<div class="tw-linkcard"><span class="tw-link-ico" style="background:#FFF1D6">🎓</span>' +
      '<div class="tw-link-main"><b>IELTS Mock Test link</b>' +
      '<p class="muted">Send your students the full IELTS Academic mock — Listening, Reading, Writing, and a recorded Speaking test that lands in your IELTS Speaking page for you to score.</p>' +
      '<div class="tw-linkrow"><code>' + esc(teacherIeltsLink(t.ref_code)) + '</code>' +
      '<button class="tw-btn tw-btn-orange tw-btn-sm" id="tw-copy-ielts">⧉ Copy</button></div></div>' +
      '<div class="tw-link-side"><div class="tw-link-note">' + (IELTS_MOCK_FREE ? 'The mock is free for every learner right now — no VIP needed.' : '⭐ The mock is a VIP feature — a student needs VIP active on their account to open it.') + '</div></div></div>' +
    (ro ? '<div class="tw-profcard"><p class="muted" style="margin:0">👁 Read-only — you’re viewing ' + esc(t.display_name) + '’s links.</p></div>'
      : '<div class="tw-profcard"><div class="tw-cardhead"><div><h3 style="margin:0">👤 My public profile</h3>' +
      '<p class="muted">Students see this when choosing a teacher.</p></div></div>' +
      '<div id="tw-prof-edit"></div></div>');
  document.getElementById('tw-copy-invite').addEventListener('click', function () {
    twCopy(teacherInviteLink(t.ref_code), this);
  });
  document.getElementById('tw-copy-ptest3').addEventListener('click', function () {
    twCopy(teacherPlacementLink(t.ref_code), this);
  });
  document.getElementById('tw-copy-ielts').addEventListener('click', function () {
    twCopy(teacherIeltsLink(t.ref_code), this);
  });
  if (!ro) twProfileEditor(document.getElementById('tw-prof-edit'));
}

function twPageSettings(c) {
  c.innerHTML = twPageHead('SETTINGS', 'Settings', 'Your public teacher profile.') +
    '<div class="tw-profcard"><div class="tw-cardhead"><div><h3 style="margin:0">👤 My public profile</h3>' +
    '<p class="muted">Students see this when choosing a teacher.</p></div></div>' +
    '<div id="tw-prof-edit"></div></div>';
  twProfileEditor(document.getElementById('tw-prof-edit'));
}

/* ==================== Admin panel (/manage) — Phase 1 ====================
   Dedicated admin surface at the /manage path (served via _redirects).
   SECURITY MODEL (defense in depth):
   1. Nothing renders until /api/admin/verify confirms is_admin() server-side
      using the visitor's own Supabase JWT (the client-side email list is UI
      sugar only and is never trusted here).
   2. Every data call goes through SECURITY DEFINER admin_* RPCs that re-check
      is_admin() inside the database — copied HTML/JS alone yields zero data.
   3. Successful verifications are written to admin_audit_log (who / when / IP).
   4. Idle 30 minutes -> forced sign-out. */

let apVerified = null;   /* { email } once /api/admin/verify passes this load */
let apPopBound = false;
let apIdleArmed = false;
let apIdleTimer = null;
function apSubpath() {
  const parts = window.location.pathname.replace(/^\/manage\/?/, '').split('/').filter(Boolean);
  return { section: parts[0] || 'dashboard', arg: parts[1] ? decodeURIComponent(parts[1]) : '' };
}
function apGo(section, arg) {
  let url = '/manage';
  if (section && section !== 'dashboard') url += '/' + section;
  if (arg) url += '/' + encodeURIComponent(arg);
  if (window.location.pathname !== url) window.history.pushState({}, '', url);
  renderAdminPanel();
}
/* Lightweight boot: session -> server verify. Never trusts client state. */
async function apBoot() {
  if (!sb) return { ok: false, reason: 'nodb' };
  let sess = null;
  try { const r = await sb.auth.getSession(); sess = r.data.session; } catch (e) {}
  if (!sess || !sess.access_token) return { ok: false, reason: 'login' };
  try {
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + sess.access_token },
    });
    if (res.ok) {
      const j = await res.json();
      if (j && j.ok) return { ok: true, email: j.email || '' };
    }
  } catch (e) {}
  return { ok: false, reason: 'denied' };
}
function apArmIdle() {
  if (apIdleArmed) return;
  apIdleArmed = true;
  const reset = function () {
    if (apIdleTimer) clearTimeout(apIdleTimer);
    apIdleTimer = setTimeout(function () {
      try { sb.auth.signOut(); } catch (e) {}
      window.location.href = '/manage';
    }, 30 * 60 * 1000);
  };
  ['click', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, reset, { passive: true });
  });
  reset();
}
function apShell(active, bodyHTML) {
  const items = [['dashboard', '📊 Dashboard'], ['users', '👥 Users'], ['daily', '📊 Daily study'], ['teachers', '🍎 Teachers'], ['telegram', '🤖 Telegram'], ['support', '💬 Support']];
  const nav = items.map(function (it) {
    const href = '/manage' + (it[0] === 'dashboard' ? '' : '/' + it[0]);
    return '<a href="' + href + '" data-apnav="' + it[0] + '"' +
      (active === it[0] ? ' class="on"' : '') + '>' + it[1] + '</a>';
  }).join('');
  return '<div class="ap-wrap"><aside class="ap-side">' +
    '<div class="ap-brand">🛠 Admin panel</div>' +
    (apVerified ? '<div class="ap-who">' + esc(apVerified.email) + '</div>' : '') +
    '<nav class="ap-nav">' + nav + '</nav>' +
    '<div class="ap-foot"><button class="ap-logout" id="ap-logout" type="button">Sign out</button>' +
    '<div class="ap-note">audited access</div></div>' +
    '</aside><main class="ap-main">' + bodyHTML + '</main></div>';
}
function apWireChrome(v) {
  v.querySelectorAll('[data-apnav]').forEach(function (a) {
    a.addEventListener('click', function (ev) { ev.preventDefault(); apGo(a.getAttribute('data-apnav')); });
  });
  const out = v.querySelector('#ap-logout');
  if (out) out.addEventListener('click', function () {
    try { sb.auth.signOut(); } catch (e) {}
    apVerified = null;
    window.location.href = '/manage';
  });
}
function apLoginHTML() {
  return '<div class="ap-center"><div class="ap-login card">' +
    '<h1>🛠 Admin panel</h1><p class="muted">Restricted area. Sign in with an administrator account.</p>' +
    '<label>Email<input type="email" id="ap-email" autocomplete="username"></label>' +
    '<label>Password<input type="password" id="ap-pass" autocomplete="current-password"></label>' +
    '<div class="ap-err" id="ap-err"></div>' +
    '<button class="btn-primary" id="ap-login-btn" type="button">Sign in</button>' +
    '</div></div>';
}
function apDeniedHTML() {
  return '<div class="ap-center"><div class="ap-login card">' +
    '<h1>⛔ Access denied</h1>' +
    '<p class="muted">This area is restricted to administrators. If you believe this is a mistake, sign in with a different account.</p>' +
    '<button class="btn-primary" id="ap-denied-out" type="button">Sign out &amp; switch account</button>' +
    '</div></div>';
}
function apWireLogin(v) {
  const btn = v.querySelector('#ap-login-btn');
  const denied = v.querySelector('#ap-denied-out');
  if (denied) denied.addEventListener('click', function () {
    try { sb.auth.signOut(); } catch (e) {}
    apVerified = null;
    window.location.href = '/manage';
  });
  if (!btn || !sb) return;
  const go = async function () {
    const err = v.querySelector('#ap-err');
    const email = (v.querySelector('#ap-email').value || '').trim();
    const pass = v.querySelector('#ap-pass').value || '';
    if (err) err.textContent = '';
    btn.disabled = true;
    try {
      const r = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r.error) throw r.error;
      apVerified = null;
      renderAdminPanel();
    } catch (e) {
      if (err) err.textContent = 'Sign-in failed: ' + ((e && e.message) || e);
      btn.disabled = false;
    }
  };
  btn.addEventListener('click', go);
  v.querySelector('#ap-pass').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
}
function apDaysBetween(a, b) {
  return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);
}
function apBarsSVG(rows, getVal, color, label) {
  const W = 620, H = 150, padL = 8, padB = 20, padT = 18;
  const vals = rows.map(getVal);
  const max = Math.max.apply(null, vals.concat([1]));
  const bw = (W - padL * 2) / Math.max(1, rows.length);
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ap-chart" role="img" aria-label="' + esc(label) + '">';
  rows.forEach(function (r, i) {
    const h = Math.max(1, (H - padB - padT) * (vals[i] / max));
    const x = padL + i * bw + 1;
    const y = H - padB - h;
    s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) +
      '" height="' + h.toFixed(1) + '" rx="2" fill="' + color + '"><title>' + esc(String(r.day)) + ': ' + vals[i] + '</title></rect>';
  });
  s += '<text x="' + padL + '" y="13" class="ap-chart-cap">' + esc(label) + ' · max ' + max + '</text></svg>';
  return s;
}
function apKpi(label, value, sub) {
  return '<div class="ap-kpi"><div class="ap-kpi-v">' + value + '</div>' +
    '<div class="ap-kpi-l">' + label + '</div>' +
    (sub ? '<div class="ap-kpi-s">' + sub + '</div>' : '') + '</div>';
}
/* ---------------- admin panel: dashboard ---------------- */
let apMetric = 'dau';
const AP_METRIC_COLORS = { dau: '#4f8ef7', new_users: '#22b07d', xp: '#7c5cd6', podcast_min: '#e09112', lessons: '#c84b31' };
function apChartHTML(series) {
  const m = ADM_METRICS.find(function (x) { return x.id === apMetric; });
  const label = m ? m.label : apMetric;
  const color = AP_METRIC_COLORS[apMetric] || '#4f8ef7';
  const tabs = ADM_METRICS.map(function (x) {
    return '<button type="button" class="adm-tab' + (x.id === apMetric ? ' on' : '') + '" data-apmetric="' + x.id + '">' + x.label + '</button>';
  }).join('');
  return '<div class="adm-tabs" style="margin-bottom:.6rem">' + tabs + '</div>' +
    apBarsSVG(series, function (r) { return Number(r[apMetric]) || 0; }, color, label);
}
function apWireMetricTabs(v, series) {
  v.querySelectorAll('[data-apmetric]').forEach(function (b) {
    b.addEventListener('click', function () {
      apMetric = b.getAttribute('data-apmetric');
      const host = v.querySelector('#ap-chart');
      if (host) { host.innerHTML = apChartHTML(series); apWireMetricTabs(v, series); }
    });
  });
}
function apBoardHTML(board) {
  if (!board.length) return '<div class="empty">No approved teachers yet.</div>';
  return '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Teacher</th><th>Students</th><th>Active 7d</th><th>XP 7d</th><th>Code</th></tr></thead><tbody>' +
    board.map(function (t) {
      return '<tr><td><b>' + esc(t.display_name || '?') + '</b></td><td>' + (t.students || 0) + '</td><td>' +
        (t.active_7d || 0) + '</td><td>' + (t.xp_7d || 0) + '</td><td><code>' + esc(t.ref_code || '') + '</code></td></tr>';
    }).join('') + '</tbody></table></div>';
}
function apFunnelHTML(steps, cohorts) {
  let html = '';
  if (steps.length) {
    const base = Number((steps[0] || {}).users) || 1;
    html += '<div class="card"><h3>📉 Signup funnel <span class="muted" style="font-weight:400;font-size:0.8rem">(last 30 days)</span></h3>' +
      '<div class="adm-funnel">' + steps.map(function (s) {
        const n = Number(s.users) || 0;
        const pct = Math.round(n / base * 100);
        return '<div class="adm-funnel-row"><span>' + esc(s.step) + '</span>' +
          '<div class="adm-funnel-bar"><div style="width:' + pct + '%"></div></div>' +
          '<b>' + n + '</b><span class="muted">' + pct + '%</span></div>';
      }).join('') + '</div></div>';
  }
  if (cohorts.length) {
    html += '<div class="card"><h3>🔁 Cohort retention <span class="muted" style="font-weight:400;font-size:0.8rem">(% active in weeks 1–4 after signup)</span></h3>' +
      '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Cohort</th><th>Users</th><th>W1</th><th>W2</th><th>W3</th><th>W4</th></tr></thead><tbody>' +
      cohorts.map(function (c) {
        const cell = function (val) {
          val = Number(val) || 0;
          const cls = val >= 40 ? 'hot' : (val >= 20 ? 'warm' : 'cold');
          return '<td><span class="adm-coh ' + cls + '">' + val + '%</span></td>';
        };
        return '<tr><td class="muted">' + esc(c.cohort) + '</td><td>' + c.users + '</td>' +
          cell(c.w1) + cell(c.w2) + cell(c.w3) + cell(c.w4) + '</tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  return html;
}
async function apRenderDashboard(v) {
  v.innerHTML = apShell('dashboard',
    '<div class="ap-head"><h1>Dashboard</h1><p class="muted">Whole-product overview.</p></div>' +
    '<div class="empty">Loading…</div>');
  apWireChrome(v);
  try {
    const rs = await Promise.all([
      sb.rpc('admin_overview'),
      sb.rpc('admin_daily_series', { p_days: 30 }),
      sb.rpc('admin_user_stats'),
      sb.rpc('admin_teacher_board'),
      sb.rpc('admin_funnel').then(function (r) { return r.data || []; }, function () { return []; }),
      sb.rpc('admin_cohorts').then(function (r) { return r.data || []; }, function () { return []; }),
    ]);
    if (rs[0].error) throw rs[0].error;
    if (rs[1].error) throw rs[1].error;
    if (rs[2].error) throw rs[2].error;
    if (rs[3].error) throw rs[3].error;
    const ov = (rs[0].data && rs[0].data[0]) || {};
    const series = rs[1].data || [];
    const users = rs[2].data || [];
    const board = rs[3].data || [];
    const today = todayStr();
    const atRisk = users
      .filter(function (u) { return u.last_active && apDaysBetween(today, String(u.last_active).slice(0, 10)) >= 7; })
      .sort(function (a, b) { return String(a.last_active).localeCompare(String(b.last_active)); })
      .slice(0, 12);
    v.innerHTML = apShell('dashboard',
      '<div class="ap-head"><h1>Dashboard</h1><p class="muted">Whole-product overview.</p></div>' +
      '<div class="ap-kpis">' +
      apKpi('Total users', ov.total_users || 0, (ov.new_7d || 0) + ' new in 7d') +
      apKpi('Active today', ov.dau || 0, (ov.wau || 0) + ' in 7d') +
      apKpi('XP · 30d', ov.xp_30d || 0, '') +
      apKpi('Lessons · 30d', ov.lessons_30d || 0, '') +
      apKpi('Podcast hrs · 30d', ov.podcast_hours_30d || 0, '') +
      apKpi('Teachers', (ov.total_teachers || 0) + ' approved', (ov.pending_teachers || 0) + ' pending') +
      '</div>' +
      '<div class="card"><h3>Product activity · 30 days</h3><div id="ap-chart">' + apChartHTML(series) + '</div></div>' +
      '<div class="card"><h3>👩‍🏫 Teacher leaderboard</h3>' + apBoardHTML(board) + '</div>' +
      apFunnelHTML(rs[4], rs[5]) +
      '<div class="card"><h3>⚠️ At risk — inactive 7+ days (' + atRisk.length + ')</h3>' +
      (atRisk.length ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>User</th><th>Level</th><th>Last active</th><th>Days idle</th><th>XP total</th></tr></thead><tbody>' +
      atRisk.map(function (u) {
        const idle = apDaysBetween(today, String(u.last_active).slice(0, 10));
        return '<tr data-apuser="' + esc(u.user_id) + '"><td><b>' + esc(u.display_name || (u.email || '?').split('@')[0]) +
          '</b><br><small class="muted">' + esc(u.email || '') + '</small></td>' +
          '<td>' + esc(String(u.level || '—').toUpperCase()) + '</td>' +
          '<td>' + esc(String(u.last_active).slice(0, 10)) + '</td>' +
          '<td><b>' + idle + '</b></td><td>' + (u.xp_total || 0) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">Nobody idle. 🎉</div>') +
      '</div>');
    apWireChrome(v);
    apWireMetricTabs(v, series);
    apWireUserRows(v);
  } catch (e) {
    v.innerHTML = apShell('dashboard',
      '<div class="ap-head"><h1>Dashboard</h1></div>' +
      '<div class="empty">Could not load dashboard: ' + esc((e && e.message) || e) + '</div>');
    apWireChrome(v);
  }
}
function apWireUserRows(v) {
  v.querySelectorAll('[data-apuser]').forEach(function (tr) {
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function () { apGo('users', tr.getAttribute('data-apuser')); });
  });
}
/* ---------------- admin panel: users ---------------- */
let apUserFilter = { q: '', level: '', teacher: '', activity: 'all', sort: 'recent' };
function apFilteredUsers(users) {
  const f = apUserFilter;
  let list = users.slice();
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
function apUsersTableHTML(users) {
  const refCounts = {};
  users.forEach(function (u) { if (u.referred_by) refCounts[u.referred_by] = (refCounts[u.referred_by] || 0) + 1; });
  const refKeys = Object.keys(refCounts);
  const refSummary = refKeys.length
    ? '<p class="muted" style="margin:.2rem 0 .6rem">📣 Referrals: ' +
      refKeys.map(function (k) { return '📣 ' + esc(k) + ': <b>' + refCounts[k] + '</b>'; }).join(' &nbsp;·&nbsp; ') + '</p>' : '';
  const rows = apFilteredUsers(users).slice(0, 300);
  if (!rows.length) return refSummary + '<div class="empty">No users match.</div>';
  return refSummary +
    '<div class="muted" style="margin:.4rem 0">' + rows.length + ' users · tap a row for full detail</div>' +
    '<div class="ap-tablewrap"><table class="ap-table"><thead><tr>' +
    '<th>User</th><th>Phone</th><th>Level</th><th>🔥</th><th>XP</th><th>XP 7d</th><th>Min 30d</th><th>Last active</th><th>Joined</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (u) {
      return '<tr data-apuser="' + esc(u.user_id) + '"><td><b>' + esc(u.display_name || (u.email || '?').split('@')[0]) +
        '</b><br><small class="muted">' + esc(u.email || '') + (u.referred_by ? ' · 📣' + esc(u.referred_by) : '') + '</small></td>' +
        '<td>' + (u.phone ? esc(u.phone) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + esc(String(u.level || '—').toUpperCase()) + '</td>' +
        '<td>' + (u.current_streak || 0) + '</td>' +
        '<td><b>' + (u.xp_total || 0) + '</b></td><td>' + (u.xp_7d || 0) + '</td>' +
        '<td>' + Math.round((Number(u.seconds_30d) || 0) / 60) + '</td>' +
        '<td>' + esc(u.last_active ? String(u.last_active).slice(0, 10) : '—') + '</td>' +
        '<td>' + esc(String(u.created_at || '').slice(0, 10)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
async function apRenderUsers(v) {
  v.innerHTML = apShell('users',
    '<div class="ap-head"><h1>Users</h1><p class="muted">Everyone on the product. Click a row for the full profile.</p></div>' +
    '<div class="adm-filters">' +
    '<input type="search" id="ap-q" placeholder="Search name, email or phone…" value="' + esc(apUserFilter.q) + '" aria-label="Search users">' +
    '<select id="ap-f-level" aria-label="Filter by level"><option value="">All levels</option>' +
    LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (apUserFilter.level === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') + '</select>' +
    '<select id="ap-f-teacher" aria-label="Filter by teacher"><option value="">All teachers</option></select>' +
    '<select id="ap-f-activity" aria-label="Filter by activity">' +
    [['all', 'All activity'], ['active7', 'Active (7d)'], ['inactive30', 'Inactive (30d)'], ['never', 'Never active']].map(function (x) {
      return '<option value="' + x[0] + '"' + (apUserFilter.activity === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select>' +
    '<select id="ap-f-sort" aria-label="Sort users">' +
    [['recent', 'Newest'], ['xp_total', 'Total XP'], ['xp_7d', 'XP (7d)'], ['streak', 'Streak'], ['active', 'Last active']].map(function (x) {
      return '<option value="' + x[0] + '"' + (apUserFilter.sort === x[0] ? ' selected' : '') + '>' + x[1] + '</option>';
    }).join('') + '</select>' +
    '</div>' +
    '<div id="ap-users-body"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const body = v.querySelector('#ap-users-body');
  let users = [];
  try {
    const r = await sb.rpc('admin_user_stats');
    if (r.error) throw r.error;
    users = r.data || [];
  } catch (e) {
    body.innerHTML = '<div class="empty">Could not load users: ' + esc((e && e.message) || e) + '</div>';
    return;
  }
  /* Phone numbers live on profiles (admin_user_stats predates the phone
     column) — fetch them directly and merge by user id. Best-effort: if
     the query fails, the Phone column simply shows —. */
  try {
    const phoneById = {};
    const ids = users.map(function (u) { return u.user_id; }).filter(Boolean);
    for (let i = 0; i < ids.length; i += 200) {
      const pr = await sb.from('profiles').select('id,phone').in('id', ids.slice(i, i + 200));
      if (pr.error) throw pr.error;
      (pr.data || []).forEach(function (p) { if (p.phone) phoneById[p.id] = p.phone; });
    }
    users.forEach(function (u) { if (!u.phone && phoneById[u.user_id]) u.phone = phoneById[u.user_id]; });
  } catch (e) {}
  const tsel = v.querySelector('#ap-f-teacher');
  const codes = {};
  users.forEach(function (u) { if (u.referred_by) codes[u.referred_by] = 1; });
  Object.keys(codes).sort().forEach(function (c) {
    const o = document.createElement('option');
    o.value = c; o.textContent = '📣 ' + c;
    if (apUserFilter.teacher === c) o.selected = true;
    tsel.appendChild(o);
  });
  const paint = function () { body.innerHTML = apUsersTableHTML(users); apWireUserRows(v); };
  v.querySelector('#ap-q').addEventListener('input', function (ev) { apUserFilter.q = ev.target.value; paint(); });
  [['#ap-f-level', 'level'], ['#ap-f-teacher', 'teacher'], ['#ap-f-activity', 'activity'], ['#ap-f-sort', 'sort']].forEach(function (pair) {
    const el = v.querySelector(pair[0]);
    if (el) el.addEventListener('change', function () { apUserFilter[pair[1]] = el.value; paint(); });
  });
  paint();
}
async function apRenderUserDetail(v, id) {
  v.innerHTML = apShell('users',
    '<div class="ap-head"><a href="/manage/users" data-apnav="users" class="ap-back">← All users</a><h1>User</h1></div>' +
    '<div class="empty">Loading…</div>');
  apWireChrome(v);
  try {
    const r = await sb.rpc('admin_panel_user_detail', { p_user_id: id });
    if (r.error) throw r.error;
    const d = r.data;
    if (!d || !d.profile) throw new Error('No access or user not found.');
    const p = d.profile, t = d.totals || {}, sh = d.shadowing || {}, w = d.words || {};
    const recent = (sh.recent || []).map(function (a) {
      return '<tr><td>' + esc(String(a.lesson_date || '').slice(0, 10)) + '</td><td>' + (a.score || 0) + '%</td>' +
        '<td class="muted">' + esc(String(a.created_at || '').slice(0, 16).replace('T', ' ')) + '</td></tr>';
    }).join('');
    /* Podcast summaries (Alireza, 2026-10-15): direct query — the RPC predates the table. */
    let sumRows = [];
    try {
      const sr = await sb.from('summary_attempts').select('lesson_date,score,duration_sec,created_at')
        .eq('user_id', id).order('created_at', { ascending: false }).limit(20);
      if (!sr.error) sumRows = sr.data || [];
    } catch (e) {}
    const sumRecent = sumRows.map(function (a) {
      return '<tr><td>' + esc(String(a.lesson_date || '').slice(0, 10)) + '</td><td>' + (a.score || 0) + '</td>' +
        '<td>' + (a.duration_sec || 0) + 's</td>' +
        '<td class="muted">' + esc(String(a.created_at || '').slice(0, 16).replace('T', ' ')) + '</td></tr>';
    }).join('');
    v.innerHTML = apShell('users',
      '<div class="ap-head"><a href="/manage/users" data-apnav="users" class="ap-back">← All users</a>' +
      '<h1>' + esc(p.display_name || (p.email || '?').split('@')[0]) + '</h1>' +
      '<p class="muted">' + esc(p.email || '') + ' · joined ' + esc(String(p.created_at || '').slice(0, 10)) +
      (p.referred_by ? ' · 📣 ' + esc(p.referred_by) : '') + '</p></div>' +
      '<div class="ap-cards">' +
      '<div class="card"><h3>Profile</h3>' +
      '<div class="ap-kv"><span>Level</span><b>' + esc(String(p.level || '—').toUpperCase()) + '</b></div>' +
      '<div class="ap-kv"><span>Phone</span><b>' + (p.phone ? esc(p.phone) : '—') + '</b></div>' +
      '<div class="ap-kv"><span>Streak</span><b>🔥 ' + (p.current_streak || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Active days</span><b>' + (t.active_days || 0) + '</b></div>' +
      '<div class="ap-kv"><span>First / last active</span><b>' + esc(String(t.first_active || '—').slice(0, 10)) + ' → ' + esc(String(t.last_active || '—').slice(0, 10)) + '</b></div>' +
      '<label class="ap-levelset">Set level <select id="ap-setlevel">' +
      '<option value="">—</option>' + LEVELS.map(function (lv) {
        return '<option value="' + lv + '"' + (String(p.level) === lv ? ' selected' : '') + '>' + levelLabel(lv) + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="card"><h3>Totals</h3>' +
      '<div class="ap-kv"><span>XP total</span><b>' + (t.xp_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Minutes in app</span><b>' + (t.minutes_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Lessons opened</span><b>' + (t.lessons_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Quizzes completed</span><b>' + (t.quizzes_total || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Podcast minutes</span><b>' + (t.podcast_min_total || 0) + '</b></div></div>' +
      '<div class="card"><h3>🎤 Shadowing</h3>' +
      '<div class="ap-kv"><span>Attempts</span><b>' + (sh.attempts || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Avg score</span><b>' + (sh.avg_score || 0) + '%</b></div>' +
      '<div class="ap-kv"><span>Listens</span><b>' + (sh.listens || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Saved words</span><b>' + (w.saved || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Mistakes</span><b>' + (w.mistakes || 0) + '</b></div>' +
      '<div class="ap-kv"><span>Quiz attempts</span><b>' + (w.quiz_attempts || 0) + '</b></div></div>' +
      '</div>' +
      '<div class="card"><h3>Recent shadowing attempts</h3>' +
      (recent ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Lesson</th><th>Score</th><th>When</th></tr></thead><tbody>' + recent + '</tbody></table></div>'
        : '<div class="empty">No attempts yet.</div>') + '</div>' +
      '<div class="card"><h3>🎙️ Recent summary attempts</h3>' +
      (sumRecent ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Lesson</th><th>Score</th><th>Duration</th><th>When</th></tr></thead><tbody>' + sumRecent + '</tbody></table></div>'
        : '<div class="empty">No summaries yet.</div>') + '</div>' +
      '<div class="card" style="border-color:#F3C6C0"><h3 style="color:#B3382E">🗑 Danger zone</h3>' +
      '<p class="muted" style="margin:.2rem 0 .6rem">Permanently delete this user and <b>all</b> their data (profile, progress, XP, results, certificates and login) from the database. This cannot be undone.</p>' +
      ((state.user && id === state.user.id)
        ? '<div class="empty">You can\'t delete your own account.</div>'
        : '<button class="btn btn-sm" id="ap-delete-user" style="background:#FDECEA;color:#B3382E;border:1px solid #F3C6C0">Delete this user permanently</button>') +
      '</div>');
    apWireChrome(v);
    const sel = v.querySelector('#ap-setlevel');
    if (sel) sel.addEventListener('change', async function () {
      if (!sel.value) return;
      sel.disabled = true;
      try {
        const rr = await sb.rpc('admin_set_user_level', { p_user_id: id, p_level: sel.value });
        if (rr.error) throw rr.error;
        apRenderUserDetail(v, id);
      } catch (e) {
        alert('Could not set level: ' + ((e && e.message) || e));
        sel.disabled = false;
      }
    });
    const delBtn = v.querySelector('#ap-delete-user');
    if (delBtn) delBtn.addEventListener('click', function () { apDeleteUser(id, p); });
  } catch (e) {
    v.innerHTML = apShell('users',
      '<div class="ap-head"><a href="/manage/users" data-apnav="users" class="ap-back">← All users</a><h1>User</h1></div>' +
      '<div class="empty">Could not load user: ' + esc((e && e.message) || e) + '</div>');
    apWireChrome(v);
  }
}
/* Admin: permanently delete a user + all their data (admin_delete_user RPC).
   Double-guarded: confirm dialog + must type DELETE. */
async function apDeleteUser(id, p) {
  var name = (p && (p.display_name || (p.email || '?').split('@')[0])) || 'this user';
  if (!confirm('Permanently delete ' + name + ' (' + ((p && p.email) || '') + ')?\n\nALL their data will be removed from the database — profile, progress, XP, results, certificates and their login. This cannot be undone.')) return;
  var typed = prompt('Type DELETE to confirm permanent deletion of ' + name + ':');
  if (typed !== 'DELETE') { alert('Deletion cancelled — you must type DELETE exactly.'); return; }
  try {
    var r = await sb.rpc('admin_delete_user', { p_user: id });
    if (r.error) throw r.error;
    if (r.data !== true) throw new Error('Not allowed.');
    alert('✅ ' + name + ' has been permanently deleted.');
    window.location.assign('/manage/users');
  } catch (e) {
    var m = (e && e.message) || String(e);
    alert(/admin_delete_user/.test(m)
      ? 'Needs the database migration first (delete-user-migration.sql).'
      : 'Could not delete: ' + m);
  }
}
/* ---------------- admin panel: daily study ---------------- */
let apDaily = { day: todayStr(), range: 'day' };
async function apRenderDaily(v) {
  v.innerHTML = apShell('daily',
    '<div class="ap-head"><h1>📊 Daily study</h1><p class="muted">Who studied how much, per day or range.</p></div>' +
    '<div id="ap-daily-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const host = v.querySelector('#ap-daily-host');
  const nameOf = {};
  try {
    const u = await sb.rpc('admin_user_stats');
    (u.data || []).forEach(function (x) {
      nameOf[x.user_id] = { name: x.display_name || (x.email || '?').split('@')[0], level: x.level };
    });
  } catch (e) {}
  const paint = async function () {
    host.innerHTML = dailyStudyShell('apd', apDaily.day, apDaily.range, '📊 Daily study — who studied how much');
    const rangeSel = host.querySelector('#apd-daily-range');
    if (rangeSel) rangeSel.addEventListener('change', function () { apDaily.range = rangeSel.value; paint(); });
    const dayInput = host.querySelector('#apd-daily-day');
    if (dayInput) dayInput.addEventListener('change', function () { if (dayInput.value) { apDaily.day = dayInput.value; paint(); } });
    const body = host.querySelector('#apd-daily-body');
    const sum = host.querySelector('#apd-daily-sum');
    try {
      const f = await fetchStudyRange(apDaily.range, apDaily.day, null);
      const idSet = {};
      [f.statsById, f.triesById, f.listensById].forEach(function (m) {
        Object.keys(m).forEach(function (id) { idSet[id] = 1; });
      });
      const ids = Object.keys(idSet);
      const missing = ids.filter(function (id) { return !nameOf[id]; }).slice(0, 500);
      if (missing.length) {
        const pr = await sb.from('profiles').select('id,display_name,level').in('id', missing);
        (pr.data || []).forEach(function (p) { nameOf[p.id] = { name: p.display_name || '?', level: p.level }; });
      }
      const rows = ids.map(function (id) {
        const nm = nameOf[id] || { name: 'User ' + String(id).slice(0, 6), level: '' };
        return dailyStudyRow(id, f, nm.name, nm.level);
      }).filter(dailyStudyActive);
      rows.sort(function (a, b) { return b.min - a.min; });
      const totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
      if (sum) sum.textContent = rows.length + ' active · ' + totalMin + ' total min · ' + rangeLabel(apDaily.range);
      if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(apDaily.range) + '.');
    } catch (e) {
      if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
    }
  };
  await paint();
}
/* ---------------- admin panel: teachers ---------------- */
async function apRenderTeachers(v) {
  v.innerHTML = apShell('teachers',
    '<div class="ap-head"><h1>🍎 Teachers</h1><p class="muted">Requests, invite codes and manual add.</p></div>' +
    '<div id="ap-teachers-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const host = v.querySelector('#ap-teachers-host');
  try {
    const t = await sb.from('teachers').select('id,user_id,ref_code,display_name,status,requested_at,photo_url,experience_years,bio').order('requested_at', { ascending: true });
    if (t.error) throw t.error;
    const teachers = t.data || [];
    const ids = teachers.map(function (x) { return x.user_id; });
    const emailById = {};
    if (ids.length) {
      const p = await sb.from('profiles').select('id,email').in('id', ids);
      (p.data || []).forEach(function (x) { emailById[x.id] = x.email; });
    }
    const ur = await sb.rpc('admin_user_stats');
    const counts = {};
    (ur.data || []).forEach(function (u) { if (u.referred_by) counts[u.referred_by] = (counts[u.referred_by] || 0) + 1; });
    const pending = teachers.filter(function (x) { return x.status === 'pending'; });
    const active = teachers.filter(function (x) { return x.status === 'approved'; });
    const rejected = teachers.filter(function (x) { return x.status === 'rejected'; });
    host.innerHTML =
      '<div class="card"><h3>⏳ Pending requests (' + pending.length + ')</h3>' +
      (pending.length ? pending.map(function (x) {
        const sug = slugify(x.display_name);
        return '<div class="tch-admin-row"><div><b>' + esc(x.display_name) + '</b><br>' +
          '<span class="muted" style="font-size:0.8rem">' + esc(emailById[x.user_id] || '') + ' · ' + esc(String(x.requested_at || '').slice(0, 10)) + '</span></div>' +
          '<div class="tch-admin-actions"><input class="tch-code-input" id="aptcode-' + x.id + '" value="' + esc(sug) + '" maxlength="32" aria-label="Invite code">' +
          '<button class="btn btn-sm" data-apt-approve="' + x.id + '">Approve</button> ' +
          '<button class="btn btn-ghost btn-sm" data-apt-reject="' + x.id + '">Reject</button></div></div>';
      }).join('') : '<p class="muted">No pending requests.</p>') + '</div>' +
      (active.length ? '<div class="card"><h3>✓ Active teachers (' + active.length + ')</h3>' +
        active.map(function (x) {
          var hasProf = x.photo_url || x.experience_years || x.bio;
          var profHtml = hasProf
            ? '<div class="apt-prof">' +
              (x.photo_url ? '<img class="apt-prof-photo" src="' + esc(x.photo_url) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
              '<div class="apt-prof-txt">' +
              (x.experience_years ? '<div>🎓 <b>' + esc(String(x.experience_years)) + '</b> years teaching experience</div>' : '<div class="muted">Experience not set</div>') +
              (x.bio ? '<div class="muted">' + esc(x.bio) + '</div>' : '<div class="muted">No bio yet</div>') +
              '</div></div>'
            : '<div class="muted" style="font-size:0.8rem">⚠️ No public profile yet — students see a default card.</div>';
          return '<div class="tch-admin-row"><div style="flex:1;min-width:0"><b>' + esc(x.display_name) + '</b><br>' +
            '<span class="muted" style="font-size:0.8rem"><code>' + esc(x.ref_code) + '</code> · ' + (counts[x.ref_code] || 0) + ' students</span>' +
            '<div style="margin-top:0.45rem">' + profHtml + '</div></div>' +
            '<div class="tch-admin-actions"><button class="btn btn-ghost btn-sm" data-apt-reject="' + x.id + '">Remove</button></div></div>';
        }).join('') + '</div>' : '') +
      (rejected.length ? '<p class="muted">Rejected (' + rejected.length + ')</p>' : '') +
      '<div class="card"><h3>Add teacher manually</h3><p class="muted" style="font-size:0.85rem">They must already have an account.</p>' +
      '<form id="apt-add-form" class="tch-add-form">' +
      '<input id="apt-email" type="email" placeholder="teacher@email.com" required aria-label="Email">' +
      '<input id="apt-name" type="text" placeholder="Display name" maxlength="40" required aria-label="Display name">' +
      '<input id="apt-code" type="text" placeholder="invite-code" maxlength="32" required aria-label="Invite code">' +
      '<button class="btn btn-sm" type="submit">Add</button></form>' +
      '<div class="form-error" id="apt-error" role="alert"></div></div>';
    host.querySelectorAll('[data-apt-approve]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const id = b.getAttribute('data-apt-approve');
        const input = host.querySelector('#aptcode-' + CSS.escape(id));
        const code = slugify(input ? input.value : '');
        b.disabled = true;
        try {
          const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'approved', p_ref_code: code });
          if (r.error) throw r.error;
          apRenderTeachers(v);
        } catch (e) { alert('Approve failed: ' + (e.message || e)); b.disabled = false; }
      });
    });
    host.querySelectorAll('[data-apt-reject]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!window.confirm('Remove / reject this teacher? Their students keep their accounts.')) return;
        const id = b.getAttribute('data-apt-reject');
        try {
          const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'rejected', p_ref_code: '' });
          if (r.error) throw r.error;
          apRenderTeachers(v);
        } catch (e) { alert('Failed: ' + (e.message || e)); }
      });
    });
    const form = host.querySelector('#apt-add-form');
    if (form) form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const errEl = host.querySelector('#apt-error');
      const email = (host.querySelector('#apt-email').value || '').trim();
      const name = (host.querySelector('#apt-name').value || '').trim();
      const code = slugify((host.querySelector('#apt-code').value || '').trim());
      if (errEl) errEl.textContent = '';
      if (!email || name.length < 2 || !code) { if (errEl) errEl.textContent = 'Fill all three fields.'; return; }
      try {
        const r = await sb.rpc('admin_create_teacher', { p_email: email, p_display_name: name, p_ref_code: code });
        if (r.error) throw r.error;
        apRenderTeachers(v);
      } catch (e) { if (errEl) errEl.textContent = 'Failed: ' + (e.message || e); }
    });
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load teachers: ' + esc((e && e.message) || e) + '</div>';
  }
}
/* ---------------- admin panel: telegram bot ---------------- */
async function apRenderTelegram(v) {
  v.innerHTML = apShell('telegram',
    '<div class="ap-head"><h1>🤖 Telegram Bot</h1><p class="muted">@muse_eng_bot schedule &amp; content.</p></div>' +
    '<div id="ap-bot-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  const host = v.querySelector('#ap-bot-host');
  let cfg = null;
  try {
    const r = await sb.from('bot_config').select('*').eq('id', 1).maybeSingle();
    if (r.error) throw r.error;
    cfg = r.data;
  } catch (e) { cfg = null; }
  if (!cfg) {
    host.innerHTML = '<div class="empty">Bot config table not found. Run <code>supabase-bot-config-migration.sql</code> in the Supabase SQL Editor first.</div>';
    return;
  }
  const lv = cfg.levels || [];
  const cb = function (id, label, isOn) {
    return '<label class="bot-check"><input type="checkbox" id="' + id + '"' + (isOn ? ' checked' : '') + '> ' + label + '</label>';
  };
  host.innerHTML =
    '<div class="card"><h3>Schedule &amp; content</h3><div class="bot-grid">' +
    '<label class="bot-row"><span>Bot enabled</span><input type="checkbox" id="apb-enabled" class="bot-switch"' + (cfg.enabled ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Posting hours (Tehran)</span><span class="bot-hours"><input type="number" id="apb-start" min="0" max="23" value="' + cfg.start_hour + '"> – <input type="number" id="apb-end" min="1" max="24" value="' + cfg.end_hour + '"></span></label>' +
    '<label class="bot-row"><span>Post every N hours</span><input type="number" id="apb-interval" min="1" max="12" value="' + cfg.interval_hours + '"></label>' +
    '<div class="bot-row"><span>Content</span><span class="bot-checks">' + cb('apb-words', '📇 Word cards', cfg.send_words) + cb('apb-quiz', '❓ Quizzes', cfg.send_quiz) + cb('apb-podcast', '🎧 Podcast', cfg.send_podcast) + cb('apb-shadowing', '🗣️ Shadowing', cfg.send_shadowing) + '</span></div>' +
    '<label class="bot-row"><span>Podcast every N posts</span><input type="number" id="apb-podevery" min="1" max="24" value="' + cfg.podcast_every + '"></label>' +
    '<label class="bot-row"><span>Shadowing every N posts</span><input type="number" id="apb-shevery" min="1" max="24" value="' + cfg.shadowing_every + '"></label>' +
    '<label class="bot-row"><span>📢 Promo banners</span><input type="checkbox" id="apb-promo" class="bot-switch"' + (cfg.send_promo ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Promo every N hours</span><input type="number" id="apb-promoevery" min="1" max="12" value="' + cfg.promo_every_hours + '"></label>' +
    '<label class="bot-row"><span>Quiz every N posts</span><input type="number" id="apb-quizevery" min="2" max="12" value="' + cfg.quiz_every + '"></label>' +
    '<div class="bot-row"><span>Word levels</span><span class="bot-checks">' +
    ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (l) { return cb('apb-lv-' + l, l.toUpperCase(), lv.indexOf(l) !== -1); }).join('') +
    '</span></div>' +
    '</div>' +
    '<div style="margin-top:0.7rem"><button class="btn btn-sm" id="apb-save">Save bot settings</button> ' +
    '<span class="muted" id="apb-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
    '<p class="muted" style="font-size:0.8rem;margin:0.6rem 0 0">Settings take effect on the next hourly bot run. Hours are Asia/Tehran. Promo banners (jpg/png/webp) go in <code>media/promo/</code> — a promo replaces the regular post in its slot.</p></div>' +
    '<div class="card"><h3>💬 Per-chat settings</h3><p class="muted" style="font-size:0.85rem">Custom footer &amp; pause per group/channel. Chats you never configure keep the global default footer.</p>' +
    '<div id="apb-chat-list"><div class="empty">Loading…</div></div></div>';
  const saveBtn = host.querySelector('#apb-save');
  if (saveBtn) saveBtn.addEventListener('click', function () { apSaveBot(host, saveBtn); });
  apLoadBotChats(host);
}
async function apSaveBot(host, btn) {
  const status = host.querySelector('#apb-status');
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const val = function (id) { const el = host.querySelector('#' + id); return el ? el.value : ''; };
  const isOn = function (id) { const el = host.querySelector('#' + id); return !!(el && el.checked); };
  const start = parseInt(val('apb-start'), 10), end = parseInt(val('apb-end'), 10);
  const interval = parseInt(val('apb-interval'), 10), qe = parseInt(val('apb-quizevery'), 10);
  const pe = parseInt(val('apb-promoevery'), 10);
  const pode = parseInt(val('apb-podevery'), 10), she = parseInt(val('apb-shevery'), 10);
  const levels = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].filter(function (l) { return isOn('apb-lv-' + l); });
  if (!(start >= 0 && start < 24 && end > 0 && end <= 24 && start < end)) { say('Start hour must be before end hour.', false); return; }
  if (!(interval >= 1 && interval <= 12)) { say('Interval must be 1–12.', false); return; }
  if (!(qe >= 2 && qe <= 12)) { say('Quiz-every must be 2–12.', false); return; }
  if (!(pe >= 1 && pe <= 12)) { say('Promo-every must be 1–12.', false); return; }
  if (!(pode >= 1 && pode <= 24) || !(she >= 1 && she <= 24)) { say('Podcast/Shadowing-every must be 1–24.', false); return; }
  if (!isOn('apb-words') && !isOn('apb-quiz') && !isOn('apb-podcast') && !isOn('apb-shadowing')) { say('Enable at least one content type.', false); return; }
  if (!levels.length) { say('Pick at least one level.', false); return; }
  if (btn) btn.disabled = true;
  say('Saving…', true);
  try {
    const r = await sb.from('bot_config').upsert({
      id: 1, enabled: isOn('apb-enabled'), start_hour: start, end_hour: end,
      interval_hours: interval, send_words: isOn('apb-words'), send_quiz: isOn('apb-quiz'),
      send_podcast: isOn('apb-podcast'), send_shadowing: isOn('apb-shadowing'),
      podcast_every: pode, shadowing_every: she,
      send_promo: isOn('apb-promo'), promo_every_hours: pe,
      quiz_every: qe, levels: levels, updated_at: new Date().toISOString()
    });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
  if (btn) btn.disabled = false;
}
async function apLoadBotChats(host) {
  const list = host.querySelector('#apb-chat-list');
  if (!list) return;
  let rows;
  try {
    const r = await sb.from('bot_chat_config').select('chat_id,title,footer_text,paused').order('title');
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    list.innerHTML = '<p class="muted">Per-chat table not found. Run <code>supabase-bot-chat-config-migration.sql</code> in the Supabase SQL Editor first.</p>';
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<p class="muted">No chats tracked yet — they appear here automatically after the next bot run.</p>';
    return;
  }
  list.innerHTML = rows.map(function (r) {
    const cid = String(r.chat_id);
    const ft = r.footer_text;
    const mode = (ft === null || ft === undefined) ? 'global' : (ft === '' ? 'none' : 'custom');
    return '<div class="bot-chat-row" data-chat="' + esc(cid) + '">' +
      '<div class="bot-chat-head"><b>' + esc(r.title || '(untitled)') + '</b> <code>' + esc(cid) + '</code>' +
      (r.paused ? ' <span style="background:#7C6AF0;color:#fff;border-radius:99px;padding:0.1rem 0.55rem;font-size:0.72rem">paused</span>' : '') + '</div>' +
      '<label class="bot-row"><span>Footer</span><select data-apbmode="' + esc(cid) + '">' +
      '<option value="global"' + (mode === 'global' ? ' selected' : '') + '>Global default footer</option>' +
      '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom footer</option>' +
      '<option value="none"' + (mode === 'none' ? ' selected' : '') + '>No footer</option>' +
      '</select></label>' +
      '<textarea data-apbft="' + esc(cid) + '" rows="2" style="' + (mode === 'custom' ? '' : 'display:none') + '" placeholder="Custom footer text for this chat…">' + esc(mode === 'custom' ? ft : '') + '</textarea>' +
      '<div class="bot-chat-actions"><label class="bot-check"><input type="checkbox" data-apbpaused="' + esc(cid) + '"' + (r.paused ? ' checked' : '') + '> Pause this chat</label> ' +
      '<button class="btn btn-sm" data-apbchatsave="' + esc(cid) + '">Save this chat</button> ' +
      '<span class="muted bot-chat-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
      '</div>';
  }).join('');
  list.querySelectorAll('[data-apbmode]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      const ta = list.querySelector('[data-apbft="' + sel.getAttribute('data-apbmode') + '"]');
      if (ta) ta.style.display = sel.value === 'custom' ? '' : 'none';
    });
  });
  list.querySelectorAll('[data-apbchatsave]').forEach(function (btn) {
    btn.addEventListener('click', function () { apSaveBotChat(host, btn); });
  });
}
async function apSaveBotChat(host, btn) {
  const cid = btn.getAttribute('data-apbchatsave');
  const row = btn.closest('.bot-chat-row');
  const status = row ? row.querySelector('.bot-chat-status') : null;
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const q = function (attr) { return host.querySelector('[' + attr + '="' + cid + '"]'); };
  const modeEl = q('data-apbmode');
  const ta = q('data-apbft');
  const pa = q('data-apbpaused');
  const mode = modeEl ? modeEl.value : 'global';
  const paused = !!(pa && pa.checked);
  let footer_text = null;
  if (mode === 'custom') {
    footer_text = ta ? ta.value.trim() : '';
    if (!footer_text) { say('Custom footer is empty — pick Global default or No footer instead.', false); return; }
  } else if (mode === 'none') {
    footer_text = '';
  }
  say('Saving…', true);
  try {
    const r = await sb.from('bot_chat_config').upsert(
      { chat_id: cid, footer_text: footer_text, paused: paused, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
    apLoadBotChats(host);
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
}
async function renderAdminPanel() {
  document.body.classList.add('ap-mode');
  if (!apPopBound) {
    apPopBound = true;
    window.addEventListener('popstate', function () { if (isPanelPath()) renderAdminPanel(); if (isTeachersPath()) renderTeachers(); });
  }
  apArmIdle();
  const v = document.getElementById('view');
  window.scrollTo(0, 0);
  if (!apVerified) {
    v.innerHTML = apShell('dashboard', '<div class="empty" style="margin-top:3rem">🔐 Verifying admin access…</div>');
    apWireChrome(v);
    const chk = await apBoot();
    if (!chk.ok) {
      v.innerHTML = apShell('dashboard', chk.reason === 'login' ? apLoginHTML() : apDeniedHTML());
      apWireChrome(v);
      apWireLogin(v);
      hideSplashSoon();
      return;
    }
    apVerified = { email: chk.email };
  }
  const sp = apSubpath();
  if (sp.section === 'users' && sp.arg) apRenderUserDetail(v, sp.arg);
  else if (sp.section === 'users') apRenderUsers(v);
  else if (sp.section === 'daily') apRenderDaily(v);
  else if (sp.section === 'teachers') apRenderTeachers(v);
  else if (sp.section === 'telegram') apRenderTelegram(v);
  else if (sp.section === 'support' && sp.arg) apRenderSupportThread(v, sp.arg);
  else if (sp.section === 'support') apRenderSupport(v);
  else apRenderDashboard(v);
  hideSplashSoon();
}