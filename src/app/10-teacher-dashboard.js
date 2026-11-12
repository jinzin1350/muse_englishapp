/* ---------------- Become a teacher ---------------- */
function renderBecomeTeacher(v) {
  const t = state.teacher, req = state.teacherRequest;
  let body;
  if (t) {
    body = '<div class="tch-status ok">✓ You are an approved teacher.</div>' +
      '<a class="btn btn-block" href="#/teacher">Open teacher dashboard</a>';
  } else if (req && req.status === 'pending') {
    body = '<div class="tch-status pending">⏳ Your request is under review. We’ll let you know once it’s approved.</div>' +
      '<p class="muted">Requested as <b>' + esc(req.display_name) + '</b> · ' + esc(String(req.requested_at || '').slice(0, 10)) + '</p>';
  } else {
    body = (req && req.status === 'rejected')
      ? '<div class="tch-status no">This request was not approved. You can try again below.</div>' : '';
    body += '<form id="form-teacher-req">' +
      '<div class="field"><label for="tq-name">Display name</label>' +
      '<input id="tq-name" type="text" maxlength="40" placeholder="e.g. Sara Ahmadi" required>' +
      '<p class="muted" style="font-size:0.8rem">Shown to the students you invite. Your personal invite link is created after approval.</p></div>' +
      '<div class="form-error" id="tq-error" role="alert"></div>' +
      '<button class="btn btn-block" type="submit">Request teacher access</button></form>';
  }
  v.innerHTML = '<div class="tch-wrap"><p><a class="link" href="#/profile">← Back to profile</a></p>' +
    '<h1>🍎 Become a teacher</h1>' +
    '<p class="muted">Invite your students with a personal link and follow their progress — daily activity, streaks, XP, lessons and podcast time.</p>' +
    '<div class="card">' + body + '</div></div>';
  const form = document.getElementById('form-teacher-req');
  if (form) form.addEventListener('submit', submitTeacherRequest);
}

async function submitTeacherRequest(e) {
  e.preventDefault();
  const name = ((document.getElementById('tq-name') || {}).value || '').trim();
  const errEl = document.getElementById('tq-error');
  if (name.length < 2) { if (errEl) errEl.textContent = 'Please enter your name.'; return; }
  if (errEl) errEl.textContent = '';
  // Temporary code until the admin approves and sets the real one.
  const tmpCode = 'pending-' + state.user.id.slice(0, 8);
  try {
    const r = await sb.from('teachers').upsert({
      user_id: state.user.id, ref_code: tmpCode, display_name: name, status: 'pending'
    }, { onConflict: 'user_id' });
    if (r.error) throw r.error;
    await loadTeacherStatus();
    trackEvent('teacher_requested', {});
    if (isTeachersPath()) { renderTeachers(); return; }
    renderBecomeTeacher(document.getElementById('view'));
  } catch (err) {
    if (errEl) errEl.textContent = 'Could not send the request. ' + (err.message || '');
  }
}

/* ---------------- Teacher dashboard ---------------- */
function fmtLastActive(d) {
  if (!d) return 'never';
  if (d === todayStr()) return 'today';
  const dt = new Date(d + 'T12:00:00').getTime(), now = Date.now();
  if (now - dt < 2 * 86400000) return 'yesterday';
  return d;
}
function copyTeacherLink() {
  const link = teacherInviteLink(state.teacher.ref_code);
  function done(btn) { if (btn) { const o = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(function () { btn.textContent = o; }, 1500); } }
  const btn = document.querySelector('[data-action="copy-teacher-link"]');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(function () { done(btn); }, function () { fallback(); });
  } else fallback();
  function fallback() {
    try {
      const ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done(btn);
    } catch (e) {}
  }
}
function renderTeacher(v) {
  state.viewTeacher = null; /* leaving any admin view-as-teacher mode */
  if (!state.teacher) { go('become-teacher'); return; }
  v.innerHTML = '<div class="tch-wrap">' +
    '<h1>🍎 Teacher dashboard</h1>' +
    '<div class="card tch-invite">' +
      '<div class="muted" style="margin:0 0 0.4rem">Your personal invite link</div>' +
      '<div class="tch-linkrow"><code>' + esc(teacherInviteLink(state.teacher.ref_code)) + '</code>' +
      '<button class="btn btn-sm" data-action="copy-teacher-link">Copy</button></div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.6rem 0 0">Share it with your students — everyone who signs up through it shows up below.</p>' +
    '</div>' +
    '<div class="card tch-invite">' +
      '<div class="muted" style="margin:0 0 0.4rem">📝 Placement test link for new students</div>' +
      '<div class="tch-linkrow"><code>' + esc(teacherPlacementLink(state.teacher.ref_code)) + '</code>' +
      '<button class="btn btn-sm" data-action="copy-ptest-link">Copy</button></div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.6rem 0 0">Send it to a new student — they take a 5-part test (vocabulary, listening, grammar, writing, speaking) and the results land in your dashboard below.</p>' +
    '</div>' +
    '<div class="card"><h3 style="margin-top:0">🌟 My public profile</h3>' +
    '<p class="muted" style="font-size:0.85rem;margin-top:-0.3rem">Students see this when choosing a teacher. Add your photo, experience and a short bio.</p>' +
    '<div id="tch-profile-body"><div class="empty">Loading…</div></div></div>' +
    '<div class="section-title"><h2>My students <span id="tch-count" class="muted"></span></h2>' +
    '<span class="tch-actions"><a class="btn btn-sm" href="#/planner">📅 Weekly planner</a>' +
    '<button class="btn btn-sm" data-action="assignment-compose">＋ New assignment</button></span></div>' +
    '<div id="tch-weekly"></div>' +
    '<div id="tch-daily"></div>' +
    '<div id="tch-coach"></div>' +
    '<div id="tch-assign"></div>' +
    '<div id="tch-roster"><div class="empty">Loading…</div></div>' +
    '<div id="tch-detail"></div>' +
    '<div class="section-title"><h2>Placement test results</h2></div>' +
    '<div id="tch-ptest"><div class="empty">Loading…</div></div>' +
  '</div>';
  loadTeacherRoster();
  loadPlacementResults();
  loadTeacherCoach();
  loadTeacherAssignments();
  loadTeacherProfile();
}
/* Teacher public profile (photo / experience / bio) — shown to students on
   the choose-teacher page. Needs supabase-teacher-choose-migration.sql. */
async function loadTeacherProfile() {
  const host = document.getElementById('tch-profile-body');
  if (!host || !state.teacher || !state.user) return;
  let p = null;
  try {
    const r = await sb.from('teachers')
      .select('display_name,photo_url,experience_years,bio')
      .eq('user_id', state.user.id).maybeSingle();
    if (r.error) throw r.error;
    p = r.data || {};
  } catch (e) {
    host.innerHTML = '<p class="muted">Profile editing needs the latest database update.</p>';
    return;
  }
  let previewURL = null, pendingFile = null;
  const photoHTML = function (url, name) {
    return url
      ? '<img id="tch-photo-prev" class="tch-prof-photo" src="' + esc(url) + '" alt="">'
      : '<div id="tch-photo-prev" class="tch-prof-photo tch-offer-initial">' + esc((name || '?').charAt(0)) + '</div>';
  };
  host.innerHTML =
    '<div class="tch-prof-grid">' +
    '<div class="tch-prof-photowrap">' + photoHTML(p.photo_url, p.display_name) +
    '<label class="btn btn-sm" style="cursor:pointer;margin-top:.5rem">Upload photo<input type="file" id="tch-photo-file" accept="image/*" hidden></label></div>' +
    '<div class="tch-prof-fields">' +
    '<label>Display name<input id="tch-f-name" maxlength="40" value="' + esc(p.display_name || '') + '"></label>' +
    '<label>Years of teaching experience<input id="tch-f-exp" type="number" min="0" max="60" placeholder="e.g. 5" value="' + (p.experience_years !== null && p.experience_years !== undefined ? p.experience_years : '') + '"></label>' +
    '<label>Short bio (one line, max 200)<textarea id="tch-f-bio" rows="2" maxlength="200" placeholder="e.g. IELTS coach — I help adults speak with confidence">' + esc(p.bio || '') + '</textarea></label>' +
    '<div><button class="btn btn-sm" id="tch-prof-save">Save profile</button> <span class="muted" id="tch-prof-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
    '</div></div>' +
    '<div style="margin-top:.8rem"><div class="muted" style="font-size:0.82rem;margin-bottom:.4rem">Preview — what students see:</div>' +
    '<div dir="rtl" lang="fa"><div class="tch-offer-grid" id="tch-prof-preview"></div></div></div>';
  const paintPreview = function () {
    host.querySelector('#tch-prof-preview').innerHTML = tchOfferCardHTML({
      display_name: host.querySelector('#tch-f-name').value.trim() || 'Your name',
      photo_url: previewURL || p.photo_url,
      experience_years: host.querySelector('#tch-f-exp').value.trim(),
      bio: host.querySelector('#tch-f-bio').value.trim(),
      student_count: null, ref_code: ''
    });
  };
  host.querySelector('#tch-photo-file').addEventListener('change', function (ev) {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    pendingFile = f;
    if (previewURL) { try { URL.revokeObjectURL(previewURL); } catch (e2) {} }
    previewURL = URL.createObjectURL(f);
    const prev = host.querySelector('#tch-photo-prev');
    const img = document.createElement('img');
    img.id = 'tch-photo-prev'; img.className = 'tch-prof-photo'; img.src = previewURL; img.alt = '';
    prev.replaceWith(img);
    paintPreview();
  });
  ['tch-f-name', 'tch-f-exp', 'tch-f-bio'].forEach(function (id) {
    host.querySelector('#' + id).addEventListener('input', paintPreview);
  });
  host.querySelector('#tch-prof-save').addEventListener('click', async function () {
    const status = host.querySelector('#tch-prof-status');
    const say = function (t, ok) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; };
    const name = host.querySelector('#tch-f-name').value.trim();
    const expRaw = host.querySelector('#tch-f-exp').value.trim();
    const bio = host.querySelector('#tch-f-bio').value.trim();
    if (name.length < 2) { say('Display name is too short.', false); return; }
    const exp = expRaw === '' ? null : parseInt(expRaw, 10);
    if (expRaw !== '' && !(exp >= 0 && exp <= 60)) { say('Experience must be 0–60 years.', false); return; }
    if (bio.length > 200) { say('Bio is too long (max 200).', false); return; }
    say('Saving…', true);
    try {
      let photoURL = p.photo_url || null;
      if (pendingFile) {
        const ext = ((pendingFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
        const path = state.user.id + '/photo.' + ext;
        const up = await sb.storage.from('teacher-photos')
          .upload(path, pendingFile, { upsert: true, contentType: pendingFile.type || 'image/jpeg' });
        if (up.error) throw up.error;
        photoURL = sb.storage.from('teacher-photos').getPublicUrl(path).data.publicUrl;
      }
      const r = await sb.rpc('update_teacher_profile', {
        p_display_name: name, p_experience_years: exp, p_bio: bio, p_photo_url: photoURL || ''
      });
      if (r.error || r.data !== true) throw new Error('save failed');
      p = { display_name: name, photo_url: photoURL, experience_years: exp, bio: bio };
      pendingFile = null;
      say('Saved ✓', true);
      paintPreview();
    } catch (e) { say('Save failed: ' + (e.message || e), false); }
  });
  paintPreview();
}
/* Weekly report card (phase 3): 7-day aggregates across the teacher's students. */
function renderTeacherWeekly() {
  const host = document.getElementById('tch-weekly');
  if (!host) return;
  const list = state.teacherStudents || [];
  if (!list.length) { host.innerHTML = ''; return; }
  const sum = function (k) { return list.reduce(function (a, s) { return a + (Number(s[k]) || 0); }, 0); };
  const active = list.filter(function (s) { return s.last_active && s.last_active >= daysAgoStr(6); }).length;
  host.innerHTML = '<div class="card"><div class="tch-weekly-title">📊 This week with your students</div>' +
    '<div class="tch-totals">' +
    '<div><b>' + list.length + '</b><span>students</span></div>' +
    '<div><b>' + active + '</b><span>active</span></div>' +
    '<div><b>' + sum('lessons_7d') + '</b><span>lessons</span></div>' +
    '<div><b>' + sum('xp_7d') + '</b><span>XP earned</span></div>' +
    '</div></div>';
}
/* Coach XP (phase 3): the teacher's own total + the coach leaderboard. */
async function loadTeacherCoach() {
  const host = document.getElementById('tch-coach');
  if (!host) return;
  try {
    const xpR = await sb.rpc('my_coach_xp');
    if (xpR.error) throw xpR.error;
    const boardR = await sb.rpc('coach_board');
    const board = boardR.error ? [] : (boardR.data || []).slice(0, 5);
    const me = state.teacher ? state.teacher.display_name : '';
    host.innerHTML = '<div class="card"><div class="tch-weekly-title">⭐ Your coach XP: <b>' + (xpR.data || 0) + '</b></div>' +
      '<p class="muted" style="font-size:0.82rem;margin:0.25rem 0 0.6rem">+10 every time one of your students finishes a lesson.</p>' +
      (board.length ? '<div class="tch-board">' + board.map(function (t, i) {
        const isMe = t.display_name === me;
        return '<div class="tch-board-row' + (isMe ? ' me' : '') + '"><span>#' + (i + 1) + ' ' +
          esc(t.display_name) + (isMe ? ' (you)' : '') + '</span><b>' + t.coach_xp + ' XP</b></div>';
      }).join('') + '</div>' : '') + '</div>';
  } catch (e) { host.innerHTML = ''; /* migration 3 not run yet: stay hidden */ }
}
/* Nudge (phase 3): queue a push notification to the student, max 1 per 24h. */
async function teacherNudge(i, btn) {
  const s = (state.teacherStudents || [])[i];
  if (!s || !btn) return;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  try {
    const r = await sb.rpc('send_nudge', { p_student: s.user_id });
    if (r.error) throw r.error;
    btn.textContent = (r.data === true) ? 'Sent ✓' : 'Already sent today';
  } catch (e) {
    btn.textContent = orig;
    btn.disabled = false;
  }
}
async function teacherSetLevel(i, btn) {
  const s = (state.teacherStudents || state.twStudents || [])[i];
  if (!s || !btn) return;
  const sel = document.getElementById('tch-level-' + i);
  const msg = document.getElementById('tch-level-msg-' + i);
  if (!sel) return;
  const newLevel = sel.value;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Saving…';
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
  try {
    const r = await sb.rpc('set_student_level', { p_student: s.user_id, p_level: newLevel });
    if (r.error) throw r.error;
    if (r.data !== true) throw new Error('Not authorized');
    // Update local state so the UI reflects the change immediately
    s.level = newLevel;
    if (msg) { msg.textContent = '✓ Saved'; msg.style.color = '#4C9A2A'; }
    btn.textContent = 'Saved ✓';
    setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2000);
  } catch (e) {
    if (msg) { msg.textContent = 'Could not save — try again.'; msg.style.color = '#D34F4F'; }
    btn.textContent = orig;
    btn.disabled = false;
  }
}
/* ---------------- Certificates (teacher-issued, 2026-10-20) ----------------
   Teachers decide when a student earns one (his order — no auto-issue).
   Data lives in Supabase `certificates`, accessed only via RPCs:
   issue_certificate / get_student_certificates / get_my_certificates /
   revoke_certificate / verify_certificate (public). */
var CERT_LV_GRAD = { a1: ['#F0CE63', '#D9A21B'], a2: ['#F6AC68', '#E8833A'], b1: ['#6CC48C', '#3FA46A'], b2: ['#FF8145', '#F26522'], c1: ['#7DB4EC', '#4A90D9'], c2: ['#B39DE4', '#8E6FC8'] };
function certDateLong(iso) {
  if (!iso) return '';
  var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
function certCardHTML(c) {
  var lv = String(c.level || 'a1').toLowerCase();
  var grad = CERT_LV_GRAD[lv] || CERT_LV_GRAD.a1;
  var lvName = (TW_LEVEL_LABEL[lv] || lv.toUpperCase());
  var bodyTxt = c.title
    ? 'has successfully completed the <b>' + esc(c.title) + '</b> course at Muse English.'
    : 'has successfully completed the <b>CEFR Level ' + lv.toUpperCase() + ' · ' + esc(lvName) + '</b> English course at Muse English.';
  return '<div class="cert-card">' +
    '<div class="cert-blob cert-b1"></div><div class="cert-blob cert-b2"></div>' +
    '<div class="cert-brand"><span class="cert-book">📖</span><span class="cert-brandname">Muse English</span></div>' +
    '<div class="cert-rule"></div>' +
    '<div class="cert-title">CERTIFICATE</div>' +
    '<div class="cert-subtitle">of Completion</div>' +
    '<div class="cert-presented">This certificate is proudly presented to</div>' +
    '<div class="cert-student">' + esc(c.student_name || '') + '</div>' +
    '<div class="cert-body">' + bodyTxt + '</div>' +
    '<div class="cert-lvrow"><span class="cert-lvcircle" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' + lv.toUpperCase() + '</span>' +
    '<span class="cert-lvtext"><b>CEFR Level ' + lv.toUpperCase() + ' · ' + esc(lvName) + '</b>' +
    '<small>Common European Framework of Reference for Languages</small></span></div>' +
    '<div class="cert-bottom">' +
    '<span class="cert-cell"><b>' + esc(certDateLong(c.issued_on || c.created_at)) + '</b><small>Date of Issue</small></span>' +
    '<span class="cert-seal"><span class="cert-seal-disc">★</span><span class="cert-rib cert-r1"></span><span class="cert-rib cert-r2"></span></span>' +
    '<span class="cert-cell"><b class="cert-issuer">' + esc(c.issuer_name || 'Muse English') + '</b><small>Teacher · Muse English</small></span>' +
    '</div>' +
    '<div class="cert-verify">Verify this certificate at <b>museenglishapp.com/#/certificate/' + esc(c.code || '') + '</b> · Certificate ID: <b>' + esc(c.code || '') + '</b></div>' +
    '</div>';
}
/* Public verification page (#/certificate/<code>) — works logged out. */
async function renderCertificate(v, code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) { v.innerHTML = '<div class="cert-page"><div class="empty">No certificate code given.</div></div>'; return; }
  v.innerHTML = '<div class="cert-page"><div class="empty">Verifying certificate…</div></div>';
  try {
    var r = await sb.rpc('verify_certificate', { p_code: code });
    if (r.error) throw r.error;
    var d = r.data || {};
    if (!d.valid) {
      v.innerHTML = '<div class="cert-page"><div class="cert-invalid"><div class="cert-invalid-ico">⚠️</div>' +
        '<h2>Certificate not found</h2><p>This code is not valid — it may have been revoked or mistyped.</p>' +
        '<a class="btn" href="#/home">Go to Muse English</a></div></div>';
      return;
    }
    v.innerHTML = '<div class="cert-page">' +
      '<div class="cert-verified">✓ Verified — this certificate was issued by Muse English</div>' +
      certCardHTML(d) +
      '<div class="cert-actions cert-noprint"><button class="btn btn-primary" data-action="cert-print">⬇ Download / Print PDF</button> ' +
      '<button class="btn" data-action="cert-share" data-code="' + esc(d.code) + '">🔗 Share / Copy link</button></div>' +
      '</div>';
  } catch (e) {
    v.innerHTML = '<div class="cert-page"><div class="empty">Could not verify right now — please try again.</div></div>';
  }
}
async function shareCertificate(code, btn) {
  var url = window.location.origin + '/#/certificate/' + code;
  if (navigator.share) {
    try { await navigator.share({ title: 'Muse English Certificate', text: 'My Muse English certificate — verify it here:', url: url }); return; } catch (e) { /* cancelled: fall through to copy */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (btn) { var orig = btn.textContent; btn.textContent = '✓ Link copied'; setTimeout(function () { btn.textContent = orig; }, 2200); }
  } catch (e) {
    window.prompt('Copy your certificate link:', url);
  }
}
function printCertificate() {
  document.body.classList.add('cert-printing');
  var done = function () { document.body.classList.remove('cert-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(done, 4000);
  window.print();
}
/* Student: my certificates (Progress page section) */
async function loadMyCerts() {
  var host = document.getElementById('my-certs');
  if (!host) return;
  if (!cloudReady()) { host.innerHTML = ''; return; }
  try {
    var r = await sb.rpc('get_my_certificates');
    if (r.error) throw r.error;
    var list = r.data || [];
    if (!list.length) {
      host.innerHTML = '<div class="empty">No certificates yet — your teacher issues them here when you complete a course. 🏅</div>';
      return;
    }
    host.innerHTML = list.map(function (c) {
      var lv = String(c.level || '').toUpperCase();
      var grad = CERT_LV_GRAD[String(c.level || 'a1').toLowerCase()] || CERT_LV_GRAD.a1;
      return '<a class="cert-row" href="#/certificate/' + esc(c.code) + '">' +
        '<span class="cert-row-badge" style="background:linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')">' + lv + '</span>' +
        '<span class="cert-row-main"><b>' + esc(c.title || ('CEFR Level ' + lv + ' · ' + (TW_LEVEL_LABEL[String(c.level || '').toLowerCase()] || ''))) + '</b>' +
        '<small>' + esc(certDateLong(c.created_at)) + ' · ' + esc(c.code) + '</small></span>' +
        '<span class="cert-row-go">View ›</span></a>';
    }).join('');
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load certificates.</div>';
  }
}
/* Teacher: certificates block inside the student detail card */
async function loadTeacherStudentCerts(i, s) {
  var host = document.getElementById('tch-cert-' + i);
  if (!host) return;
  var lvOpts = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (lv) {
    return '<option value="' + lv + '"' + (String(s.level || '').toLowerCase() === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>';
  }).join('');
  var form = '<div class="an-title" style="margin-top:.8rem">🏅 Certificates</div>' +
    '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;margin-bottom:0.5rem">' +
    '<select id="tch-cert-lv-' + i + '" style="padding:0.35rem 0.6rem;border:1px solid #E5DCCB;border-radius:8px;background:#FFFDF9;font-size:0.9rem">' + lvOpts + '</select>' +
    '<input id="tch-cert-title-' + i + '" type="text" placeholder="Course title (optional)" style="flex:1;min-width:150px;padding:0.4rem 0.6rem;border:1px solid #E5DCCB;border-radius:8px;background:#FFFDF9;font-size:0.9rem"/>' +
    '<button class="btn btn-sm" data-action="teacher-cert-issue" data-i="' + i + '">Issue certificate</button>' +
    '<span id="tch-cert-msg-' + i + '" style="font-size:0.8rem"></span></div>' +
    '<div id="tch-cert-list-' + i + '"><div class="empty">Loading…</div></div>';
  host.innerHTML = form;
  var listHost = document.getElementById('tch-cert-list-' + i);
  try {
    var r = await sb.rpc('get_student_certificates', { p_student: s.user_id });
    if (r.error) throw r.error;
    var list = r.data || [];
    if (!list.length) { listHost.innerHTML = '<div class="empty">No certificates issued yet.</div>'; return; }
    listHost.innerHTML = list.map(function (c) {
      var lv = String(c.level || '').toUpperCase();
      return '<div class="an-arow"><span>🏅 <b>' + lv + '</b> ' + esc(c.title || '') +
        ' <span class="muted">· ' + esc(c.code) + ' · ' + esc(certDateLong(c.created_at)) + (c.revoked ? ' · <b style="color:#D34F4F">revoked</b>' : '') + '</span></span>' +
        '<span style="display:flex;gap:0.4rem"><a class="btn btn-sm btn-ghost" href="' + window.location.origin + '/#/certificate/' + esc(c.code) + '" target="_blank" rel="noopener">View</a>' +
        (c.revoked ? '' : '<button class="btn btn-sm btn-ghost" data-action="teacher-cert-revoke" data-code="' + esc(c.code) + '" data-i="' + i + '">Revoke</button>') +
        '</span></div>';
    }).join('');
  } catch (e) {
    listHost.innerHTML = '<div class="empty">Certificates need the database migration first (ask Alireza if this persists).</div>';
  }
}
async function teacherIssueCert(i, btn) {
  var s = (state.teacherStudents || [])[i];
  if (!s || !btn) return;
  var lvSel = document.getElementById('tch-cert-lv-' + i);
  var titleIn = document.getElementById('tch-cert-title-' + i);
  var msg = document.getElementById('tch-cert-msg-' + i);
  if (!lvSel) return;
  btn.disabled = true;
  var orig = btn.textContent;
  btn.textContent = 'Issuing…';
  if (msg) { msg.textContent = ''; msg.style.color = ''; }
  try {
    var params = { p_student: s.user_id, p_level: lvSel.value, p_title: titleIn ? titleIn.value : null };
    if (state.viewTeacher && state.viewTeacher.user_id) params.p_as_teacher = state.viewTeacher.user_id;
    var r = await sb.rpc('issue_certificate', params);
    if (r.error) throw r.error;
    if (!r.data) throw new Error('Not authorized');
    if (msg) { msg.textContent = '✓ Issued: ' + r.data; msg.style.color = '#4C9A2A'; }
    btn.textContent = 'Issued ✓';
    loadTeacherStudentCerts(i, s);
  } catch (e) {
    if (msg) { msg.textContent = 'Could not issue — try again.'; msg.style.color = '#D34F4F'; }
    btn.textContent = orig;
    btn.disabled = false;
  }
}
/* Teacher: remove a student from my class (unlink only — the student's
   account and progress stay intact). RPC enforces ownership. */
async function teacherRemoveStudent(i, btn) {
  var s = (state.teacherStudents || [])[i];
  if (!s || !btn) return;
  var name = s.display_name || (s.email || '?').split('@')[0];
  if (!confirm('Remove ' + name + ' from your class?\n\nTheir account and progress stay intact — they just won\'t be your student anymore, and you won\'t be able to send them assignments.')) return;
  var msg = document.getElementById('tch-remove-msg-' + i);
  btn.disabled = true;
  try {
    var params = { p_student: s.user_id };
    if (state.viewTeacher && state.viewTeacher.user_id) params.p_as_teacher = state.viewTeacher.user_id;
    var r = await sb.rpc('remove_student_from_class', params);
    if (r.error) throw r.error;
    if (r.data !== true) throw new Error('Not allowed — this student is not in your class.');
    state.twStudents = null;
    if (document.getElementById('tw-content')) {
      twShowSection('students');
    } else {
      loadTeacherRoster();
      var host = document.getElementById('tch-detail');
      if (host) host.innerHTML = '<div class="empty">✅ ' + esc(name) + ' was removed from your class.</div>';
    }
  } catch (e) {
    btn.disabled = false;
    if (msg) msg.textContent = (e && e.message && /remove_student_from_class/.test(e.message))
      ? 'Needs the database migration first (ask Alireza).'
      : 'Could not remove: ' + ((e && e.message) || e);
  }
}

async function teacherRevokeCert(code, i) {
  if (!window.confirm('Revoke certificate ' + code + '? Its verification page will stop working.')) return;
  try {
    var r = await sb.rpc('revoke_certificate', { p_code: code });
    if (r.error) throw r.error;
    var s = (state.teacherStudents || [])[i];
    if (s) loadTeacherStudentCerts(i, s);
  } catch (e) { /* list refresh shows current state */ }
}

async function loadTeacherRoster() {
  const host = document.getElementById('tch-roster');
  if (!host) return;
  try {
    const r = await sb.rpc('get_my_students');
    if (r.error) throw r.error;
    state.teacherStudents = r.data || [];
    renderTeacherRoster();
    renderTeacherWeekly();
    loadTeacherDaily();
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load students: ' + esc(e.message || e) + '</div>';
  }
}
function renderTeacherRoster() {
  const host = document.getElementById('tch-roster');
  if (!host) return;
  const list = state.teacherStudents || [];
  const cc = document.getElementById('tch-count');
  if (cc) cc.textContent = '(' + list.length + ')';
  if (!list.length) {
    host.innerHTML = '<div class="empty">No students yet — share your invite link above to get started. 🌱</div>';
    return;
  }
  host.innerHTML = '<div class="card tch-table-card"><div class="tch-table">' +
    '<div class="tch-tr tch-th"><span>Student</span><span>🔥</span><span>XP 7d</span><span>Lessons</span><span>🎧m</span><span>🎤</span><span>Active</span></div>' +
    list.map(function (s, i) {
      const name = s.display_name || (s.email || '?').split('@')[0];
      return '<div class="tch-tr" data-action="teacher-student" data-i="' + i + '" role="button" tabindex="0">' +
        '<span class="tch-name">' + esc(name) + '<small>' + esc(s.level ? levelLabel(normalizeLevel(s.level)) : '—') + '</small></span>' +
        '<span>' + (s.current_streak || 0) + '</span>' +
        '<span>' + (s.xp_7d || 0) + '</span>' +
        '<span>' + (s.lessons_7d || 0) + '</span>' +
        '<span>' + (s.podcast_min_7d || 0) + '</span>' +
        '<span title="Shadowing speaking tries (7d)">' + (s.shadowing_7d || 0) + '</span>' +
        '<span class="muted">' + esc(fmtLastActive(s.last_active)) + '</span></div>';
    }).join('') + '</div></div>' +
    '<p class="muted" style="font-size:0.82rem">Tap a student to see their 14-day activity.</p>';
}
/* Teacher id for dashboard queries: the viewed teacher in admin view-as mode,
   otherwise the logged-in user. */
function tchViewId() {
  return (state.viewTeacher && state.viewTeacher.user_id) || (state.user && state.user.id);
}
async function openTeacherStudent(i) {
  const s = (state.teacherStudents || [])[i];
  const host = document.getElementById('tch-detail');
  if (!s || !host) return;
  host.innerHTML = '<div class="empty">Loading…</div>';
  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const r = await sb.rpc('get_student_daily', { p_student: s.user_id });
    if (r.error) throw r.error;
    const rows = r.data || [];
    const name = s.display_name || (s.email || '?').split('@')[0];
    const maxSec = Math.max.apply(null, [1].concat(rows.map(function (x) { return x.seconds_in_app || 0; })));
    const sum = function (k) { return rows.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
    const streakTxt = (s.current_streak || 0) > 0 ? ' · 🔥 ' + s.current_streak + '-day streak' : '';
    const curLevel = String(s.level || '').toLowerCase();
    const levelOpts = ['a1','a2','b1','b2','c1','c2'].map(function(lv) {
      return '<option value="' + lv + '"' + (curLevel === lv ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>';
    }).join('');
    host.innerHTML = '<div class="card"><h3 style="margin-top:0">' + esc(name) +
      ' <span class="muted" style="font-weight:400">· last 14 days' + streakTxt + '</span></h3>' +
      '<div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.8rem;flex-wrap:wrap">' +
        '<label style="font-size:0.85rem;color:#5B6478">📊 Level:</label>' +
        '<select id="tch-level-' + i + '" data-student="' + esc(s.user_id) + '" style="padding:0.35rem 0.6rem;border:1px solid #E5DCCB;border-radius:8px;background:#FFFDF9;font-size:0.9rem">' +
          levelOpts +
        '</select>' +
        '<button class="btn btn-sm" data-action="teacher-set-level" data-i="' + i + '">Save</button>' +
        '<span id="tch-level-msg-' + i + '" style="font-size:0.8rem"></span>' +
      '</div>' +
      (rows.length ? '<div class="tch-bars">' + rows.map(function (x) {
        const h = Math.max(4, Math.round((x.seconds_in_app || 0) / maxSec * 90));
        const mins = Math.round((x.seconds_in_app || 0) / 60);
        return '<div class="tch-bar" title="' + esc(x.day) + ': ' + mins + ' min">' +
          '<div class="tch-bar-fill" style="height:' + h + 'px"></div>' +
          '<div class="tch-bar-d">' + esc(String(x.day).slice(5)) + '</div></div>';
      }).join('') + '</div>' : '<div class="empty">No activity in the last 14 days.</div>') +
      '<div class="tch-totals">' +
        '<div><b>' + sum('xp_earned') + '</b><span>XP</span></div>' +
        '<div><b>' + sum('lessons_opened') + '</b><span>lessons</span></div>' +
        '<div><b>' + sum('quizzes_completed') + '</b><span>quizzes</span></div>' +
        '<div><b>' + Math.round(sum('podcast_seconds') / 60) + '</b><span>podcast min</span></div>' +
      '</div>' +
      '<div id="tch-an-' + i + '"><div class="empty">Loading analytics…</div></div>' +
      '<div id="tch-cert-' + i + '"><div class="empty">Loading certificates…</div></div>' +
      '<div id="tch-sh-' + i + '"><div class="empty">Loading shadowing…</div></div>' +
      '<div class="an-title" style="margin-top:.8rem">📤 Sent to this student</div>' +
      '<div id="tch-sent-' + i + '"><button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '">Show sent items</button></div>' +
      '<div style="margin-top:1rem;border-top:1px solid #F0E4DC;padding-top:0.8rem">' +
      '<div class="an-title" style="color:#B3382E">🚪 Class membership</div>' +
      '<p class="muted" style="font-size:0.85rem;margin:0.3rem 0 0.6rem">Removing a student only unlinks them from your class — their account and progress stay intact. They will no longer be your student and you won\'t be able to send them assignments.</p>' +
      '<button class="btn btn-sm" style="background:#FDECEA;color:#B3382E;border:1px solid #F3C6C0" data-action="teacher-remove-student" data-i="' + i + '">Remove from my class</button>' +
      '<span id="tch-remove-msg-' + i + '" style="font-size:0.8rem;margin-left:0.5rem"></span></div>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.9rem;flex-wrap:wrap">' +
      (state.viewTeacher ? '' :
      '<button class="btn btn-sm" data-action="teacher-nudge" data-i="' + i + '">🔔 Nudge</button>' +
      '<button class="btn btn-sm" data-action="teacher-message" data-i="' + i + '">💬 Message</button>' +
      '<button class="btn btn-sm" data-action="ai-report-tstudent" data-i="' + i + '">🤖 Report</button>') +
      '<button class="btn btn-ghost btn-sm" data-action="teacher-student-close">Close</button></div></div>';
    loadTeacherStudentAnalytics(i, s);
    loadTeacherStudentShadowing(i, s);
    loadTeacherStudentCerts(i, s);
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load activity.</div>';
  }
}
/* ---- teacher: per-student shadowing practice (attempts + listens, 30d) ---- */
async function loadTeacherStudentShadowing(i, s) {
  const host = document.getElementById('tch-sh-' + i);
  if (!host) return;
  try {
    const since30 = new Date(Date.now() - 29 * 864e5).toISOString();
    const attP = sb.from('shadowing_attempts')
      .select('lesson_date,transcript,score,created_at').eq('user_id', s.user_id)
      .gte('created_at', since30).order('created_at', { ascending: false }).limit(30)
      .then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; });
    const evP = sb.from('app_events').select('created_at').eq('user_id', s.user_id)
      .eq('event', 'shadowing_listen').gte('created_at', since30).limit(2000)
      .then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; });
    const att = await attP, evs = await evP;
    const n = att.length;
    const avg = n ? Math.round(att.reduce(function (a, x) { return a + (Number(x.score) || 0); }, 0) / n) : 0;
    let html = '<div class="an-title" style="margin-top:.8rem">🎤 Shadowing practice <span class="muted" style="font-weight:400">· last 30 days</span></div>' +
      '<div class="tch-totals">' +
      '<div><b>' + n + '</b><span>speaking tries</span></div>' +
      '<div><b>' + avg + '%</b><span>avg score</span></div>' +
      '<div><b>' + evs.length + '</b><span>sentences listened</span></div></div>';
    if (n) {
      html += '<div class="an-assign">' + att.slice(0, 8).map(function (x) {
        const mm = String(x.transcript || '').match(/^\[s(\d+)\]/);
        const said = String(x.transcript || '').replace(/^\[s\d+\]\s*/, '').slice(0, 60);
        const sc = Number(x.score) || 0;
        return '<div class="an-arow"><span>🔤 sentence ' + esc(mm ? mm[1] : '?') +
          ' <span class="muted">· ' + esc(said) + (said.length >= 60 ? '…' : '') + '</span></span>' +
          '<span class="muted">' + esc(String(x.lesson_date || '').slice(5)) + '</span>' +
          '<b class="' + (sc >= 70 ? 'ok' : 'bad') + '">' + sc + '%</b></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="empty">No shadowing practice yet.</div>';
    }
    host.innerHTML = html;
  } catch (e) { host.innerHTML = ''; }
}
/* ---- teacher: per-student sent history (assignments + this student's status) ---- */
async function toggleTeacherSent(i, btn) {
  const s = (state.teacherStudents || [])[i];
  const host = document.getElementById('tch-sent-' + i);
  if (!s || !host) return;
  const cache = (state._tSent = state._tSent || {})[i] || (state._tSent[i] = {});
  if (cache.html) {
    cache.open = !cache.open;
    host.innerHTML = cache.open ? cache.html
      : '<button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '">Show sent items</button>';
    return;
  }
  host.innerHTML = '<div class="empty">Loading…</div>';
  try {
    let a;
    try {
      a = await sb.from('assignments')
        .select('id,kind,title,topic_label,level,question_count,created_at,deadline,note,status')
        .eq('teacher_id', tchViewId()).contains('student_ids', [s.user_id])
        .order('created_at', { ascending: false }).limit(20);
      if (a.error) throw a.error;
    } catch (e2) {
      /* pre-scheduling-migration fallback (no status column) */
      a = await sb.from('assignments')
        .select('id,kind,title,topic_label,level,question_count,created_at,deadline,note')
        .eq('teacher_id', tchViewId()).contains('student_ids', [s.user_id])
        .order('created_at', { ascending: false }).limit(20);
      if (a.error) throw a.error;
    }
    const rows = (a.data || []).filter(function (x) { return x.status !== 'scheduled'; });
    const ids = rows.map(function (x) { return x.id; });
    const resMap = {};
    if (ids.length) {
      const r = await sb.from('assignment_results')
        .select('assignment_id,score,total').eq('student_id', s.user_id).in('assignment_id', ids);
      (r.data || []).forEach(function (x) { resMap[x.assignment_id] = x; });
    }
    cache.html = rows.length
      ? '<div class="an-assign">' + rows.map(function (x) {
          const res = resMap[x.id];
          const ico = x.kind === 'exam' ? '📋' : '📝';
          const sub = esc(x.topic_label || '') +
            ' · ' + x.question_count + ' Q · sent ' + esc(fmtDate(new Date(x.created_at))) +
            (x.deadline ? ' · due ' + esc(x.deadline) : '') +
            (x.note ? '<br>💬 ' + esc(x.note) : '');
          return '<div class="an-arow"><span>' + ico + ' <b>' + esc(x.title) + '</b><br>' +
            '<small class="muted">' + sub + '</small></span>' +
            '<span>' + (res ? '<b class="ok">✓ ' + res.score + '/' + res.total + '</b>'
                            : '<span class="muted">⏳ pending</span>') + '</span></div>';
        }).join('') + '</div>' +
        '<button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '" style="margin-top:.4rem">Hide</button>'
      : '<div class="empty">Nothing sent to this student yet.</div>';
    cache.open = true;
    host.innerHTML = cache.html;
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load sent items.</div>' +
      '<button class="btn btn-sm btn-ghost" data-action="teacher-sent" data-i="' + i + '">Retry</button>';
  }
}
async function loadTeacherStudentAnalytics(i, s) {
  const host = document.getElementById('tch-an-' + i);
  if (!host) return;
  try {
    const name = s.display_name || (s.email || '?').split('@')[0];
    const pack = await buildStudentPack(s.user_id, true, name);
    const h = document.getElementById('tch-an-' + i);
    if (!h) return;
    (state._tPacks = state._tPacks || {})[i] = pack;
    let html = '';
    if ((pack.assignments || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">📝 Homework scores</div><div class="an-assign">' +
        pack.assignments.slice(0, 6).map(function (x, k) {
          const pct = x.total ? Math.round((x.score / x.total) * 100) : 0;
          const nw = (x.wrong || []).length;
          return '<div class="an-arow' + (nw ? ' an-click' : '') + '"' +
            (nw ? ' data-action="an-wrong" data-i="' + i + '" data-k="' + k + '" role="button" tabindex="0"' : '') + '>' +
            '<span>' + esc(x.topic) + (nw ? ' <span class="an-warn">· ' + nw + ' wrong ▸</span>' : '') + '</span>' +
            '<span class="muted">' + esc(x.date) + '</span>' +
            '<b class="' + (pct >= 70 ? 'ok' : 'bad') + '">' + x.score + '/' + x.total + '</b></div>' +
            (nw ? '<div class="an-wrong hidden" id="an-w-' + i + '-' + k + '">' +
              x.wrong.map(function (w) {
                return '<div class="an-wq"><div class="an-wqq">❓ ' + esc(w.q) + '</div>' +
                  '<div class="an-wa"><span class="bad">✕ picked: ' + esc(w.picked || '—') + '</span>' +
                  '<span class="ok">✓ correct: ' + esc(w.correct || '—') + '</span></div></div>';
              }).join('') + '</div>' : '');
        }).join('') + '</div>';
    }
    if ((pack.topicAccuracy || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">🎯 Accuracy by topic</div>' + topicBarsHTML(pack.topicAccuracy);
    }
    if ((pack.quizTrend || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">📝 Quiz history</div><div class="an-assign">' +
        pack.quizTrend.slice(0, 8).map(function (x) {
          const pct = x.total ? Math.round((x.score / x.total) * 100) : 0;
          return '<div class="an-arow"><span>' + esc(quizKindLabel(x.kind)) + '</span>' +
            '<span class="muted">' + esc(x.date) + '</span>' +
            '<b class="' + (pct >= 70 ? 'ok' : 'bad') + '">' + x.score + '/' + x.total + '</b></div>';
        }).join('') + '</div>';
    }
    if ((pack.openMistakes || []).length) {
      html += '<div class="an-title" style="margin-top:.8rem">⚠️ Still struggling with</div>' +
        pack.openMistakes.slice(0, 6).map(function (m) {
          return '<div class="an-wq"><div class="an-wqq">❓ ' + esc(m.q) + '</div></div>';
        }).join('');
    }
    h.innerHTML = html || '<div class="empty">No homework data yet.</div>';
  } catch (e) { /* keep the activity view */ }
}
async function aiReportTeacherStudent(i, btn) {
  const s = (state.teacherStudents || [])[i];
  if (!s) return;
  const name = s.display_name || (s.email || '?').split('@')[0];
  try {
    const pack = await buildStudentPack(s.user_id, true, name);
    requestAIReport('teacher-student', pack, btn);
  } catch (e) {
    requestAIReport('teacher-student', { name: name, note: 'no data' }, btn);
  }
}
async function buildClassPack() {
  const students = (state.teacherStudents || []).slice(0, 15);
  const rows = [];
  for (const s of students) {
    const name = s.display_name || (s.email || '?').split('@')[0];
    try {
      const pack = await buildStudentPack(s.user_id, true, name);
      const sc = pack.assignments.map(function (x) { return x.total ? x.score / x.total : 0; });
      rows.push({
        name: name,
        assignments: pack.assignments.length,
        avgPct: sc.length ? Math.round(sc.reduce(function (a, b) { return a + b; }, 0) / sc.length * 100) : null,
        weak: pack.topicAccuracy.slice(0, 3).map(function (t) {
          return { topic: t.topic, pct: Math.round((t.correct / t.total) * 100) };
        })
      });
    } catch (e) { rows.push({ name: name, assignments: 0, avgPct: null, weak: [] }); }
  }
  return { classSize: (state.teacherStudents || []).length, students: rows };
}
async function aiReportClass(btn) {
  try {
    const pack = await buildClassPack();
    requestAIReport('teacher-class', pack, btn);
  } catch (e) {
    requestAIReport('teacher-class', { note: 'no data' }, btn);
  }
}

/* ---------------- Teacher inbox (phase 4): one-way teacher -> student messages ---------------- */
async function refreshInboxBadge() {
  const btn = document.getElementById('btn-inbox');
  const badge = document.getElementById('inbox-badge');
  if (!btn) return;
  if (!cloudReady()) { btn.classList.add('hidden'); return; }
  try {
    const r = await sb.rpc('my_messages');
    if (r.error) throw r.error;
    const msgs = r.data || [];
    const unread = msgs.filter(function (m) { return !m.read_at; }).length;
    state.inboxMessages = msgs;
    state.unreadMessages = unread;
    btn.classList.toggle('hidden', !msgs.length);
    badge.classList.toggle('hidden', !unread);
    if (unread) badge.textContent = unread > 9 ? '9+' : String(unread);
  } catch (e) { btn.classList.add('hidden'); }
}
function maybeShowInboxPrompt() {
  if (state._inboxPrompted || document.getElementById('app-modal')) return;
  const n = state.unreadMessages || 0;
  if (!n || state.view !== 'home') return;
  state._inboxPrompted = true;
  showModal(
    '<div class="inbox-prompt">' +
    '<div class="ip-deco" aria-hidden="true"></div>' +
    '<div class="ip-bubble" aria-hidden="true"><span></span><span></span><span></span>' +
    '<i class="ip-spark s1">✦</i><i class="ip-spark s2">✦</i><i class="ip-spark s3">✦</i><i class="ip-spark s4">✦</i></div>' +
    '<h2>You have ' + n + ' new message' + (n > 1 ? 's' : '') + '</h2>' +
    '<p class="ip-sub">From your teacher — tap below to read.</p>' +
    '<div class="ip-cta"><div class="ip-btns">' +
    '<button class="ip-primary" data-action="inbox-open">Read messages</button>' +
    '<button class="ip-secondary" data-action="modal-close">Later</button>' +
    '</div>' +
    '<img class="ip-mascot" src="/media/inbox-mascot.webp" alt="" aria-hidden="true">' +
    '</div>' +
    '</div>'
  );
  const ov = document.getElementById('app-modal');
  if (ov && ov.firstChild) ov.firstChild.classList.add('modal-card-inbox');
}
function fmtMsgTime(ts) {
  try {
    const d = new Date(ts);
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return d.toDateString() === new Date().toDateString() ? 'today ' + hm : fmtDate(d) + ' ' + hm;
  } catch (e) { return ''; }
}
function inboxListHTML(msgs) {
  if (!msgs.length) return '<div class="empty">No messages yet. When your teacher writes to you, it shows up here. 💌</div>';
  return msgs.map(function (m) {
    /* Assignment notifications (sent by the teacher composer) get a direct
       link — otherwise the student reads the message but can't find the quiz. */
    const isAssignment = (m.body || '').indexOf('📝 Your teacher sent you ') === 0 ||
      (m.body || '').indexOf('📚 Your teacher sent you vocabulary ') === 0;
    let bodyHTML;
    if (isAssignment) {
      const mm = /^📝 Your teacher sent you (homework|an exam): (📝|📚) (.*) — open Muse English to start\.$/.exec(m.body || '');
      const mv = /^📚 Your teacher sent you vocabulary (homework|exam): (.*) — open Muse English to start\.$/.exec(m.body || '');
      bodyHTML = mm
        ? '<span class="msg2-line">📝 Your teacher sent you ' + esc(mm[1]) + ':</span>' +
          '<span class="msg2-line">' + esc(mm[2]) + ' ' + esc(mm[3]) + '</span>' +
          '<span class="msg2-line msg2-dim">Open Muse English to start.</span>'
        : (mv
          ? '<span class="msg2-line">📚 Your teacher sent you vocabulary ' + esc(mv[1]) + ':</span>' +
            '<span class="msg2-line">' + esc(mv[2]) + '</span>' +
            '<span class="msg2-line msg2-dim">Open Muse English to start.</span>'
          : esc(m.body));
    } else {
      /* Plain messages: keep the sender's line breaks, one block per line,
         each with its own bidi base direction so mixed Persian/English
         (e.g. the weekly recap) renders in the right order. */
      bodyHTML = esc(m.body).split('\n').map(function (ln) {
        return ln.trim()
          ? '<span class="msg2-line" dir="auto">' + ln + '</span>'
          : '<span class="msg2-gap"></span>';
      }).join('');
    }
    return '<div class="msg2-card' + (m.read_at ? '' : ' unread') + '">' +
      '<div class="msg-head"><b>' + esc(m.teacher_name) + '</b><span class="muted">' + esc(fmtMsgTime(m.created_at)) + '</span></div>' +
      '<p>' + bodyHTML + '</p>' +
      (isAssignment ? '<a class="msg2-cta" href="#/homework"><span class="msg2-cta-ico">📝</span><span>Open homework →</span><span class="msg2-cta-go">›</span></a>' : '') + '</div>';
  }).join('');
}
async function renderInbox(v) {
  var cached = state.inboxMessages;
  v.innerHTML = '<div class="tch-wrap msg2-wrap">' +
    '<h1 class="msg2-title"><span class="msg2-bubble">💬</span> Messages<i class="msg2-spark s1"></i><i class="msg2-spark s2"></i></h1>' +
    '<div id="inbox-list">' +
    ((cached && cached.length) ? inboxListHTML(cached) : '<div class="empty">Loading…</div>') + '</div>' +
    '<div class="msg2-bg" aria-hidden="true"><span class="msg2-blob"></span><img src="/media/inbox-mascot.webp" alt=""></div></div>';
  var host = document.getElementById('inbox-list');
  if (!sb) {
    if (host && !(cached && cached.length)) host.innerHTML = '<div class="empty">You appear to be offline. Connect to the internet to load messages.</div>';
    return;
  }
  var msgs = null, loadErr = null;
  try {
    const r = await sb.rpc('my_messages');
    if (r.error) throw r.error;
    msgs = r.data || [];
    state.inboxMessages = msgs;
  } catch (e) {
    loadErr = e;
    if (cached && cached.length) msgs = cached;
  }
  if (!msgs) {
    if (host) host.innerHTML = '<div class="empty">Could not load messages.' +
      '<div class="muted" style="font-size:0.8rem;margin-top:0.4rem">' + esc((loadErr && loadErr.message) || String(loadErr)) + '</div>' +
      '<button class="btn btn-block" data-action="inbox-retry" style="max-width:220px;margin:1rem auto 0">Try again</button></div>';
    return;
  }
  if (host) host.innerHTML = inboxListHTML(msgs);
  // Mark as read no matter where the messages came from (fresh fetch or cache),
  // otherwise the unread badge and the login prompt keep coming back.
  try { await sb.rpc('mark_messages_read'); }
  catch (e1) {
    try { await new Promise(function (res) { setTimeout(res, 1200); }); await sb.rpc('mark_messages_read'); }
    catch (e2) {}
  }
  // Optimistic clear: the server was asked to mark everything read, so drop the
  // badge now instead of depending on the recount fetch below.
  state.unreadMessages = 0;
  var _badge = document.getElementById('inbox-badge');
  if (_badge) _badge.classList.add('hidden');
  refreshInboxBadge();
}
/* Teacher -> student composer (from the student detail card). */
function teacherMessageComposer(i) {
  const s = (state.teacherStudents || [])[i];
  if (!s) return;
  const name = s.display_name || (s.email || '?').split('@')[0];
  showModal(
    '<div class="modal-ico">💬</div>' +
    '<h2>Message to ' + esc(name) + '</h2>' +
    '<div class="field" style="text-align:left"><label for="msg-body">Message</label>' +
    '<textarea id="msg-body" rows="4" maxlength="500" placeholder="Write something encouraging…"></textarea></div>' +
    '<div class="form-error" id="msg-error" role="alert"></div>' +
    '<button class="btn btn-block" data-action="teacher-message-send" data-i="' + i + '">Send</button>' +
    '<button class="btn btn-ghost btn-block" data-action="modal-close">Cancel</button>'
  );
  setTimeout(function () { const t = document.getElementById('msg-body'); if (t) t.focus(); }, 120);
}
async function teacherMessageSend(i, btn) {
  const s = (state.teacherStudents || [])[i];
  const ta = document.getElementById('msg-body');
  const err = document.getElementById('msg-error');
  const body = ta ? ta.value.trim() : '';
  if (!s) return;
  if (!body) { if (err) err.textContent = 'Write something first.'; return; }
  if (err) err.textContent = '';
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body });
    if (r.error) throw r.error;
    if (r.data === true) closeModal();
    else { if (err) err.textContent = 'Could not send.'; btn.disabled = false; btn.textContent = 'Send'; }
  } catch (e) {
    if (err) err.textContent = 'Could not send — check your connection.';
    btn.disabled = false; btn.textContent = 'Send';
  }
}

/* ---------------- Teacher assignments: homework & exams (phase 5) ----------------
   Teacher picks v2 topic/points + level + count -> questions sampled from the
   grammar_bank table -> snapshot stored in public.assignments -> student plays
   it -> result lands in public.assignment_results. */
const ASSIGN_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];


/* ---- Grammar v2 pilot metadata (family -> topics, linked points) ---- */
var V2_FAMILIES = {};
var V2_TOPICS = {};
var V2_INDEX_LOADED = false;
/* Load the generated v2 topic index (21 families, 107 topics) once */
async function loadV2Index() {
  if (V2_INDEX_LOADED) return;
  try {
    const r = await fetch('data/grammar/v2-index.json');
    if (!r.ok) return;
    const idx = await r.json();
    V2_FAMILIES = idx.families || {};
    V2_TOPICS = idx.topics || {};
    V2_INDEX_LOADED = true;
  } catch (e) {}
}

/* Legacy topics hidden when v2 covers them (spec mapping table) */


/* ---- teacher composer ---- */
/* Shared assignment-composer form (used by the modal and by the /teachers full-page composer). */
function assignmentComposerBodyHTML(list) {
  return (
    '<div class="as2-modes" role="tablist">' +
    '<button type="button" class="as2-mode on" data-amode="homework"><span class="as2-mode-ico">📝</span><span class="as2-mode-txt"><b>Homework</b><small>Practice and reinforce learning</small></span></button>' +
    '<button type="button" class="as2-mode" data-amode="exam"><span class="as2-mode-ico">📋</span><span class="as2-mode-txt"><b>Exam</b><small>Assess student knowledge</small></span></button></div>' +
    '<div class="field" id="as-level-field"><label for="as-level">Level</label>' +
    '<select id="as-level" class="input">' +
    ASSIGN_LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (lv === 'a2' ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') +
    '</select></div>' +
    '<div class="field"><label>Content</label><div id="as-source">' +
    '<label class="chk as2-type-card"><input type="radio" name="as-source" value="grammar" checked> <span class="as2-type-ico">📖</span> Grammar</label>' +
    '<label class="chk as2-type-card"><input type="radio" name="as-source" value="vocab"> <span class="as2-type-ico">📚</span> Vocabulary</label>' +
    '</div></div>' +
    '<div id="as-vocab-panel" class="hidden">' +
    '<div class="field"><label for="as-vocab-cat">Word category</label>' +
    '<select id="as-vocab-cat" class="input"><option value="">Loading categories…</option></select></div>' +
    '<div class="field"><label>Word levels</label><div id="as-vocab-levels">' +
    ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (lv) {
      return '<label class="chk"><input type="checkbox" class="as-vocab-lv" value="' + lv + '"' + (lv === 'a2' ? ' checked' : '') + '> ' + lv.toUpperCase() + '</label>';
    }).join('') +
    '</div></div>' +
    '<div class="muted" id="as-vocab-poolinfo" style="font-size:.85rem"></div>' +
    '<div class="field"><label>Words <span class="as2-opt">— uncheck any you don\'t want</span></label>' +
    '<div id="as-vocab-words" class="as-vocab-words"><div class="empty">Pick a category to see its words.</div></div></div>' +
    '<div class="field"><label>Question types</label><div id="as-vocab-types">' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="meaning" checked> <span class="as2-type-ico">🔤</span> Word → meaning</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="reverse" checked> <span class="as2-type-ico">🔁</span> Meaning → word</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="gap"> <span class="as2-type-ico">⌨️</span> Fill the gap</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-vocab-type" value="listen"> <span class="as2-type-ico">🎧</span> Listen &amp; choose</label>' +
    '</div></div>' +
    '<div class="field"><label>Wrong options come from</label><div id="as-vocab-dist">' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-vocab-dist" value="same" checked> <span class="as2-diff-txt"><b>Same category</b><small>Harder — similar words</small></span></label>' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-vocab-dist" value="any"> <span class="as2-diff-txt"><b>Any words</b><small>Easier — mixed words</small></span></label>' +
    '</div></div>' +
    '<div class="field"><label for="as-vocab-count">Questions</label>' +
    '<select id="as-vocab-count" class="input">' +
    [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (n === 10 ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
    '</select></div>' +
    '</div>' +
    '<div id="as-hw-fields">' +
    '<div class="field"><label for="as-topic">Topic</label>' +
    '<select id="as-topic" class="input"></select></div>' +
    '<div id="as-v2-panel" class="hidden">' +
    '<div class="field"><label>Points <span class="as2-opt">— select teaching points</span></label>' +
    '<div id="as-v2-points"></div></div>' +
    '<div class="field"><label>Levels</label><div id="as-v2-levels"></div></div>' +
    '<div class="field"><label>Question types</label><div id="as-v2-types">' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-v2-type" value="mcq" checked> <span class="as2-type-ico">👥</span> Multiple choice</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-v2-type" value="gap" checked> <span class="as2-type-ico">⌨️</span> Typing</label>' +
    '<label class="chk as2-type-card"><input type="checkbox" class="as-v2-type" value="error" checked> <span class="as2-type-ico">🔍</span> Find the mistake</label>' +
    '</div></div>' +
    '<div class="field"><label>Difficulty</label><div id="as-v2-diff">' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-v2-diff" value="easy"> <span class="as2-diff-txt"><b>Easy</b><small>Simpler questions</small></span></label>' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-v2-diff" value="mixed" checked> <span class="as2-diff-txt"><b>Mixed</b><small>A mix of easy and challenging questions</small></span></label>' +
    '<label class="chk as2-diff-card"><input type="radio" name="as-v2-diff" value="hard"> <span class="as2-diff-txt"><b>Hard</b><small>More challenging questions</small></span></label>' +
    '</div></div>' +
    '<div class="muted" id="as-v2-pool" style="font-size:.85rem"></div>' +
    '</div>' +
    '<div class="field"><label for="as-count">Questions</label>' +
    '<select id="as-count" class="input">' +
    [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (n === 10 ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
    '</select></div></div>' +
    '<div id="as-exam-fields" class="hidden">' +
    '<div class="field"><label>Topics mix <span class="as2-opt">— e.g. 5 from X, 5 from Y</span></label>' +
    '<div id="as-mixrows"></div>' +
    '<button type="button" class="btn btn-sm" id="as-addrow">＋ Add topic</button>' +
    '<div class="muted" id="as-mixtotal" style="margin-top:.45rem;font-size:.85rem">Total: 0 questions</div>' +
    '</div></div>' +
    '<div class="field"><label>Students</label><div class="as2-students">' +
    '<label class="chk as2-student-all"><input type="checkbox" id="as-all" checked> <span class="as2-type-ico">👥</span> <span class="as2-student-txt"><b>All students (' + list.length + ')</b><small>Send to your entire class</small></span></label>' +
    '<div id="as-students" class="as-pick hidden">' +
    list.map(function (s) {
      const nm = s.display_name || (s.email || '?').split('@')[0];
      return '<label class="chk"><input type="checkbox" class="as-st" value="' + esc(s.user_id) + '" checked> ' + esc(nm) + '</label>';
    }).join('') + '</div></div></div>' +
    '<div class="as2-row2">' +
    '<div class="field"><label for="as-note">Note for students <span class="as2-opt">(optional)</span></label>' +
    '<input id="as-note" class="input" maxlength="200" placeholder="e.g. Focus on the verb forms!"></div>' +
    '<div class="field"><label for="as-deadline">Deadline <span class="as2-opt">(optional)</span></label>' +
    '<input id="as-deadline" class="input" type="date" placeholder="yyyy-mm-dd"></div>' +
    '</div>' +
    '<div class="form-error" id="as-error" role="alert"></div>' +
    '<button class="as2-send" data-action="assignment-create">✈ Send to students</button>'
  );
}

/* Wire composer events. Works in the modal and in the /teachers full-page composer. */
function assignmentComposerWire() {
  assignMode = 'homework';
  Array.prototype.forEach.call(document.querySelectorAll('.as2-mode'), function (b) {
    b.addEventListener('click', function () { setAssignMode(b.getAttribute('data-amode')); });
  });
  document.getElementById('as-addrow').addEventListener('click', function () { examAddRow(); });
  document.getElementById('as-mixrows').addEventListener('change', examUpdateTotal);
  document.getElementById('as-mixrows').addEventListener('click', function (e) {
    const del = e.target.closest('.as-mix-del');
    if (del && del.closest('.as2-mixrow')) { del.closest('.as2-mixrow').remove(); examUpdateTotal(); }
  });
  examAddRow();
  assignmentFillTopics();
  document.getElementById('as-level').addEventListener('change', assignmentFillTopics);
  document.getElementById('as-topic').addEventListener('change', asV2PanelUpdate);
  document.getElementById('as-count').addEventListener('change', asV2PoolUpdate);
  document.getElementById('as-all').addEventListener('change', function () {
    document.getElementById('as-students').classList.toggle('hidden', this.checked);
  });
  /* vocabulary content source */
  Array.prototype.forEach.call(document.querySelectorAll('input[name="as-source"]'), function (r) {
    r.addEventListener('change', asSourceUpdate);
  });
  var vcat = document.getElementById('as-vocab-cat');
  if (vcat) vcat.addEventListener('change', asVocabPoolLoad);
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-lv'), function (cb) {
    cb.addEventListener('change', asVocabPoolLoad);
  });
  var vwords = document.getElementById('as-vocab-words');
  if (vwords) vwords.addEventListener('change', asVocabSelCount);
  asVocabInit();
  asSourceUpdate();
}

async function teacherAssignmentComposer() {
  if (twReadOnly()) { twReadOnlyNotice(); return; }
  await loadV2Index();
  const list = state.teacherStudents || [];
  if (!state.teacher) return;
  if (!list.length) {    showModal('<div class="modal-ico">📝</div><h2>New assignment</h2>' +
      '<p class="muted">You have no students yet — share your invite link first. 🌱</p>' +
      '<button class="btn btn-ghost btn-block" data-action="modal-close">Close</button>');
    return;
  }
  showModal(
    '<div class="as2">' +
    '<div class="as2-head"><div class="as2-ico"><span>📝</span></div>' +
    '<i class="as2-spark s1"></i><i class="as2-spark s2"></i>' +
    '<button class="as2-close" data-action="modal-close" aria-label="Close">✕</button></div>' +
    '<h2>New assignment</h2>' +
    assignmentComposerBodyHTML(list) +
    '<button class="as2-cancel" data-action="modal-close">Cancel</button>' +
    '</div>'
  );
  const as2card = document.querySelector('#app-modal .modal-card');
  if (as2card) as2card.classList.add('as2-card');
  assignmentComposerWire();
}
/* ---- assignment composer: homework | exam mode + mixed-topic rows ---- */
var assignMode = 'homework';
function setAssignMode(m) {
  assignMode = (m === 'exam') ? 'exam' : 'homework';
  /* container-agnostic: works in the modal and in the /teachers full-page composer */
  Array.prototype.forEach.call(document.querySelectorAll('.as2-mode'), function (b) {
    b.classList.toggle('on', b.getAttribute('data-amode') === assignMode);
  });
  const hw = document.getElementById('as-hw-fields'), ex = document.getElementById('as-exam-fields');
  if (hw) hw.classList.toggle('hidden', assignMode !== 'homework');
  if (ex) ex.classList.toggle('hidden', assignMode !== 'exam');
  const ico = document.querySelector('.as2-ico span');
  if (ico) ico.textContent = assignMode === 'exam' ? '📋' : '📝';
  if (typeof asV2PanelUpdate === 'function') asV2PanelUpdate();
  if (typeof asSourceUpdate === 'function') asSourceUpdate();
}
/* After a successful send: close the modal (legacy) or return to the
   assignments list (the /teachers full-page composer). */
function asComposeDone() {
  closeModal();
  var twc = document.getElementById('tw-content');
  if (twc && (state.twSection === 'compose' || state.twSection === 'assignments' || state.twSection === 'assignment-detail')) {
    state.twAssignments = null; /* invalidate portal cache */
    twShowSection('assignments');
  } else {
    loadTeacherAssignments();
  }
}
function examTopicOptions(selected) {
  let html = '';
  Object.keys(V2_FAMILIES).forEach(function (famSlug) {
    const fam = V2_FAMILIES[famSlug];
    html += '<optgroup label="' + esc(fam.title) + ' (v2)">';
    fam.topics.forEach(function (tslug) {
      const t = V2_TOPICS[tslug];
      const val = 'v2:' + tslug;
      if (t) html += '<option value="' + esc(val) + '"' + (val === selected ? ' selected' : '') + '>' + esc(t.h1) + '</option>';
    });
    html += '</optgroup>';
  });
  return html;
}
function examAddRow(topic, count) {
  const host = document.getElementById('as-mixrows');
  if (!host) return;
  const d = document.createElement('div');
  d.className = 'as2-mixrow';
  d.innerHTML = '<select class="input as-mix-topic">' + examTopicOptions(topic) + '</select>' +
    '<input type="number" class="input as-mix-count" min="1" max="30" value="' + (count || 5) + '" aria-label="Questions">' +
    '<button type="button" class="btn btn-sm as-mix-del" aria-label="Remove topic">✕</button>';
  host.appendChild(d);
  examUpdateTotal();
}
function examUpdateTotal() {
  const host = document.getElementById('as-mixtotal');
  if (!host) return;
  let total = 0, rows = 0;
  Array.prototype.forEach.call(document.querySelectorAll('#as-mixrows .as2-mixrow'), function (r) {
    const c = parseInt(r.querySelector('.as-mix-count').value, 10);
    if (c > 0) { total += c; rows++; }
  });
  host.textContent = 'Total: ' + total + ' questions' + (rows ? ' across ' + rows + ' topic' + (rows > 1 ? 's' : '') : '');
}
function assignmentFillTopics() {
  const sel = document.getElementById('as-topic');
  let html = '';
  /* v2 topics grouped by family */
  Object.keys(V2_FAMILIES).forEach(function (famSlug) {
    const fam = V2_FAMILIES[famSlug];
    html += '<optgroup label="' + esc(fam.title) + ' (v2)">';
    html += '<option value="v2family:' + esc(famSlug) + '">Whole family: ' + esc(fam.title) + '</option>';
    fam.topics.forEach(function (tslug) {
      const t = V2_TOPICS[tslug];
      if (t) html += '<option value="v2:' + esc(tslug) + '">' + esc(t.h1) + '</option>';
    });
    html += '</optgroup>';
  });
  sel.innerHTML = html;
  /* show/hide v2 panel */
  asV2PanelUpdate();
  /* keep exam mix rows in sync with the level */
  Array.prototype.forEach.call(document.querySelectorAll('#as-mixrows .as-mix-topic'), function (s) {
    const cur = s.value;
    s.innerHTML = examTopicOptions(cur);
  });
}
/* v2 topic value helpers */
function asTopicVal() {
  const sel = document.getElementById('as-topic');
  return sel ? sel.value : '';
}
function asIsV2() {
  const v = asTopicVal();
  return v.indexOf('v2:') === 0 || v.indexOf('v2family:') === 0;
}
function asV2Slugs() {
  const v = asTopicVal();
  if (v.indexOf('v2family:') === 0) {
    const fam = V2_FAMILIES[v.slice(9)];
    return fam ? fam.topics.slice() : [];
  }
  if (v.indexOf('v2:') === 0) return [v.slice(3)];
  return [];
}
/* v2 panel: points checkboxes, level chips, pool count */
function asV2PanelUpdate() {
  const panel = document.getElementById('as-v2-panel');
  const isV2 = asIsV2();
  const mode = (typeof assignMode !== 'undefined' && assignMode === 'exam') ? 'exam' : 'homework';
  /* v2 panel only in homework mode; level dropdown hidden for v2 homework */
  if (panel) panel.classList.toggle('hidden', !isV2 || mode !== 'homework');
  const lvField = document.getElementById('as-level');
  if (lvField) {
    const lvWrap = lvField.closest('.field');
    if (lvWrap) lvWrap.style.display = (isV2 && mode === 'homework') ? 'none' : '';
  }
  if (!isV2 || mode !== 'homework') return;
  const slugs = asV2Slugs();
  /* collect points */
  const pointsHost = document.getElementById('as-v2-points');
  const levelsHost = document.getElementById('as-v2-levels');
  if (!pointsHost || !levelsHost) return;
  let ptsHtml = '';
  const allLevels = {};
  const secColors = ['peach', 'green', 'blue'];
  slugs.forEach(function (slug, sidx) {
    const t = V2_TOPICS[slug];
    if (!t) return;
    const color = secColors[sidx % 3];
    ptsHtml += '<div class="as2-sec as2-sec-' + color + '">';
    ptsHtml += '<div class="as-v2-topic-head">' + esc(t.h1) + '</div>';
    ptsHtml += '<div class="as2-pt-grid">';
    (t.points || []).forEach(function (p) {
      allLevels[p.level] = true;
      ptsHtml += '<label class="as2-pt-card"><input type="checkbox" class="as-v2-pt" value="' + esc(p.id) +
        '" data-level="' + esc(p.level) + '" checked> ' +
        '<span class="gh-lv">' + esc(p.level.toUpperCase()) + '</span> ' +
        '<span class="as2-pt-body"><b>' + esc(p.title) + '</b>' +
        '<span class="muted">' + esc(p.summary) + '</span></span></label>';
    });
    /* linked points as optional extras */
    (t.linked_points || []).forEach(function (pid) {
      /* find the point in any v2 topic */
      let found = null;
      Object.keys(V2_TOPICS).forEach(function (s2) {
        (V2_TOPICS[s2].points || []).forEach(function (p2) {
          if (p2.id === pid) found = { p: p2, topic: V2_TOPICS[s2].h1 };
        });
      });
      if (found) {
        allLevels[found.p.level] = true;
        ptsHtml += '<label class="as2-pt-card as-v2-linked"><input type="checkbox" class="as-v2-pt" value="' + esc(found.p.id) +
          '" data-level="' + esc(found.p.level) + '"> ' +
          '<span class="gh-lv">' + esc(found.p.level.toUpperCase()) + '</span> ' +
          '<span class="as2-pt-body"><b>' + esc(found.p.title) + '</b> <span class="as2-opt">(from ' + esc(found.topic) + ')</span>' +
          '<span class="muted">' + esc(found.p.summary) + '</span></span></label>';
      }
    });
    ptsHtml += '</div></div>';
  });
  pointsHost.innerHTML = ptsHtml;
  /* level chips */
  const lvls = Object.keys(allLevels).sort();
  levelsHost.innerHTML = lvls.map(function (lv) {
    return '<label class="chk as-v2-lvchip as2-lv-card"><input type="checkbox" class="as-v2-lv" value="' + esc(lv) + '" checked> ' +
      lv.toUpperCase() + '</label>';
  }).join('');
  /* wire up changes */
  Array.prototype.forEach.call(pointsHost.querySelectorAll('.as-v2-pt'), function (cb) {
    cb.addEventListener('change', asV2PoolUpdate);
  });
  Array.prototype.forEach.call(levelsHost.querySelectorAll('.as-v2-lv'), function (cb) {
    cb.addEventListener('change', asV2PoolUpdate);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-type'), function (cb) {
    cb.addEventListener('change', asV2PoolUpdate);
  });
  asV2PoolUpdate();
}
/* update pool count display */
function asV2PoolUpdate() {
  const poolEl = document.getElementById('as-v2-pool');
  if (!poolEl) return;
  const pool = asV2GetPool();
  const count = parseInt((document.getElementById('as-count') || {}).value, 10) || 10;
  if (pool.length < count) {
    poolEl.innerHTML = '<span style="color:#c62828">Only ' + pool.length + ' questions available for this selection.</span>';
  } else {
    poolEl.textContent = pool.length + ' questions available.';
  }
}
/* get filtered exercise pool for v2 selection */
function asV2GetPool() {
  const slugs = asV2Slugs();
  const selPts = {};
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-pt:checked'), function (cb) {
    selPts[cb.value] = true;
  });
  const selLvls = {};
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-lv:checked'), function (cb) {
    selLvls[cb.value] = true;
  });
  const selTypes = {};
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-type:checked'), function (cb) {
    selTypes[cb.value] = true;
  });
  const diffEl = document.querySelector('input[name="as-v2-diff"]:checked');
  const diff = diffEl ? diffEl.value : 'mixed';
  /* collect site exercises from app data (state.grammarCache) */
  const pool = [];
  slugs.forEach(function (slug) {
    /* find in grammar cache */
    let topic = null;
    if (typeof findGrammarTopic === 'function') topic = findGrammarTopic(slug);
    if (!topic || !topic.v2) return;
    const items = (typeof grammarAllItems === 'function') ? grammarAllItems(topic)
      : ((topic.exercises && topic.exercises.items) || []);
    items.forEach(function (ex) {
      /* bank items live in the app data since 2026-11-01, but for teacher
         assignments the bank is fetched from Supabase — skip them here so
         this pool stays site-only (the caller dedupes by id anyway). */
      if (ex.use === 'bank') return;
      const exLv = (ex.level || '').toLowerCase();
      const exType = ex.type || 'mcq';
      if (!selLvls[exLv]) return;
      if (!selTypes[exType]) return;
      /* point filter */
      const exPts = ex.points || [];
      const matchPt = exPts.some(function (pid) { return selPts[pid]; });
      if (!matchPt) return;
      /* difficulty filter */
      if (diff === 'easy' && ex.difficulty !== 1) return;
      if (diff === 'hard' && ex.difficulty !== 3) return;
      pool.push(ex);
    });
  });
  return pool;
}
/* fetch bank exercises from Supabase: server-side points overlap + pagination */
async function asV2FetchBank(pointIds) {
  try {
    if (typeof sb === 'undefined' || !pointIds || !pointIds.length) return [];
    var all = [];
    var from = 0;
    var PAGE = 1000;
    for (;;) {
      var res = await sb.from('grammar_bank').select('data')
        .eq('status', 'active')
        .overlaps('points', pointIds)
        .range(from, from + PAGE - 1);
      if (res.error) break;
      var rows = res.data || [];
      all = all.concat(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return all.map(function (row) { return row.data; });
  } catch (e) {
    return [];
  }
}
async function createAssignment(btn) {
  const errBox = document.getElementById('as-error');
  const err = function (m) { if (errBox) errBox.textContent = m; };
  err('');
  const level = document.getElementById('as-level').value;
  const roster = state.teacherStudents || [];
  const useAll = document.getElementById('as-all').checked;
  const targets = useAll ? roster.slice() : roster.filter(function (s) {
    const cb = document.querySelector('.as-st[value="' + s.user_id + '"]');
    return cb && cb.checked;
  });
  if (!targets.length) { err('Pick at least one student.'); return; }
  const mode = (typeof assignMode !== 'undefined' && assignMode === 'exam') ? 'exam' : 'homework';
  const srcEl = document.querySelector('input[name="as-source"]:checked');
  if (srcEl && srcEl.value === 'vocab') { await createVocabAssignment(btn, { err: err, targets: targets, orig: btn.textContent, mode: mode }); return; }
  if (mode === 'exam') { await createExamAssignment(btn, { err: err, level: level, targets: targets, orig: btn.textContent }); return; }
  /* all topics are v2 now: homework always uses the v2 bank flow */
  await createV2Assignment(btn, { err: err, targets: targets, orig: btn.textContent });
}


/* ---- v2 assignment creation ---- */
function asV2SnapshotQ(ex, topicSlug) {
  /* Build v2 snapshot question with full fields + legacy q alias */
  const t = V2_TOPICS[topicSlug];
  const label = t ? t.h1 : topicSlug;
  const snap = {
    id: ex.id,
    points: ex.points || [],
    level: (ex.level || '').toLowerCase(),
    type: ex.type || 'mcq',
    difficulty: ex.difficulty || 1,
    prompt: ex.prompt || ex.q || '',
    explanation: ex.explanation || '',
    topic_label: label,
    /* legacy aliases for old player compatibility */
    q: ex.prompt || ex.q || '',
    options: ex.options || [],
    answer: ex.answer
  };
  if (ex.type === 'gap') snap.accept = ex.accept || [];
  if (ex.type === 'error') {
    snap.segments = ex.segments || [];
    snap.correction = ex.correction || '';
  }
  return snap;
}
async function createV2Assignment(btn, ctx) {
  const err = ctx.err, targets = ctx.targets, orig = ctx.orig;
  const slugs = asV2Slugs();
  if (!slugs.length) { err('Select a topic.'); return; }
  const count = parseInt(document.getElementById('as-count').value, 10) || 10;
  /* bank-first pool (site exercises only top up when the bank is short) */
  const selPts = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-pt:checked'), function (cb) {
    selPts.push(cb.value);
  });
  let pool = [];
  try {
    const bankQs = await asV2FetchBank(selPts);
    /* filter bank by selected levels/types/difficulty */
    const selLvls = {};
    Array.prototype.forEach.call(document.querySelectorAll('.as-v2-lv:checked'), function (cb) { selLvls[cb.value] = true; });
    const selTypes = {};
    Array.prototype.forEach.call(document.querySelectorAll('.as-v2-type:checked'), function (cb) { selTypes[cb.value] = true; });
    const diffEl = document.querySelector('input[name="as-v2-diff"]:checked');
    const diff = diffEl ? diffEl.value : 'mixed';
    bankQs.forEach(function (ex) {
      const exLv = String(ex.level || '').toLowerCase();
      if (!selLvls[exLv]) return;
      if (!selTypes[ex.type || 'mcq']) return;
      if (diff === 'easy' && ex.difficulty !== 1) return;
      if (diff === 'hard' && ex.difficulty !== 3) return;
      pool.push(ex);
    });
  } catch (e) {}
  if (pool.length < count) {
    /* top up with site exercises only */
    const seen = {};
    pool.forEach(function (ex) { seen[ex.id] = true; });
    asV2GetPool().forEach(function (ex) {
      if (!seen[ex.id]) { pool.push(ex); seen[ex.id] = true; }
    });
  }
  if (!pool.length) { err('No questions available for this selection.'); return; }
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  /* spread evenly across points */
  const byPoint = {};
  pool.forEach(function (ex) {
    (ex.points || ['_none']).forEach(function (pid) {
      (byPoint[pid] = byPoint[pid] || []).push(ex);
    });
  });
  const ptIds = Object.keys(byPoint);
  const picked = [];
  const seen = {};
  let round = 0;
  while (picked.length < count && round < 10) {
    let added = false;
    /* shuffle point order each round */
    shuffleArr(ptIds.slice()).forEach(function (pid) {
      if (picked.length >= count) return;
      const avail = shuffleArr(byPoint[pid].filter(function (ex) { return !seen[ex.id]; }));
      if (avail.length) {
        seen[avail[0].id] = true;
        picked.push(avail[0]);
        added = true;
      }
    });
    if (!added) break;
    round++;
  }
  if (picked.length < count) {
    /* pool too small - warn but continue */
    err('Only ' + picked.length + ' questions available for this selection.');
  }
  /* build snapshots */
  const isFamily = asTopicVal().indexOf('v2family:') === 0;
  const topicSlug = isFamily ? 'mixed' : slugs[0];
  const t = V2_TOPICS[slugs[0]];
  const topicLabel = isFamily ? 'Mixed (' + slugs.length + ' topics)' : (t ? t.h1 : slugs[0]);
  /* levels from selection */
  const lvls = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-v2-lv:checked'), function (cb) {
    lvls.push(cb.value);
  });
  const questions = shuffleArr(picked).map(function (ex) {
    return asV2SnapshotQ(ex, slugs[0]);
  });
  const title = '📝 ' + topicLabel + ' (' + lvls.map(function (l) { return l.toUpperCase(); }).join(',') + ')';
  const noteEl = document.getElementById('as-note');
  const dlEl = document.getElementById('as-deadline');
  const note = noteEl ? noteEl.value.trim() : '';
  const deadline = dlEl && dlEl.value ? dlEl.value : null;
  btn.textContent = 'Sending…';
  try {
    const ins = await sb.from('assignments').insert({
      teacher_id: tchViewId(),
      teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
      kind: 'homework', title: title,
      level: lvls.join(','),
      topic: topicSlug, topic_label: topicLabel,
      question_count: questions.length, questions: questions,
      student_ids: targets.map(function (s) { return s.user_id; }),
      note: note || null, deadline: deadline
    }).select('id').single();
    if (ins.error) throw ins.error;
    const body = '📝 Your teacher sent you homework: ' + title + ' — open Muse English to start.';
    await Promise.all(targets.map(function (s) {
      return Promise.allSettled([
        sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body }),
        sb.rpc('send_nudge', { p_student: s.user_id })
      ]);
    }));
    asComposeDone();
  } catch (e) {
    err('Could not send: ' + (e && e.message ? e.message : 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---- vocabulary assignments (2026-10-21, his order) ----
   Teacher picks a word category + levels from the 9,140-word bank; questions
   are generated from word data at send time and stored in the same
   `assignments` row shape as grammar homework/exams (topic='vocab'). */
function asSource() {
  var el = document.querySelector('input[name="as-source"]:checked');
  return el ? el.value : 'grammar';
}
function asSourceUpdate() {
  var panel = document.getElementById('as-vocab-panel');
  if (!panel) return;
  var vocab = asSource() === 'vocab';
  panel.classList.toggle('hidden', !vocab);
  var hw = document.getElementById('as-hw-fields'), ex = document.getElementById('as-exam-fields');
  var lf = document.getElementById('as-level-field');
  if (vocab) {
    if (hw) hw.classList.add('hidden');
    if (ex) ex.classList.add('hidden');
    if (lf) lf.classList.add('hidden');
  } else {
    if (lf) lf.classList.remove('hidden');
    var m = (typeof assignMode !== 'undefined') ? assignMode : 'homework';
    if (hw) hw.classList.toggle('hidden', m !== 'homework');
    if (ex) ex.classList.toggle('hidden', m !== 'exam');
  }
}
async function asVocabInit() {
  var sel = document.getElementById('as-vocab-cat');
  if (!sel) return;
  try {
    if (!state.asVocabCats) {
      var res = await fetch('/data/vocab/categories.json');
      state.asVocabCats = await res.json();
    }
    sel.innerHTML = state.asVocabCats.map(function (ct) {
      return '<option value="' + esc(ct.slug) + '">' + esc(ct.icon || '📚') + ' ' + esc(ct.title) + ' (' + ct.word_count + ' words)</option>';
    }).join('');
    asVocabPoolLoad();
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load categories</option>';
  }
}
function asVocabLevels() {
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-lv:checked'), function (cb) { out.push(cb.value); });
  return out;
}
async function asVocabPoolLoad() {
  var sel = document.getElementById('as-vocab-cat');
  var host = document.getElementById('as-vocab-words');
  var info = document.getElementById('as-vocab-poolinfo');
  if (!sel || !host) return;
  var slug = sel.value;
  var lvls = asVocabLevels();
  if (!slug) { host.innerHTML = '<div class="empty">Pick a category to see its words.</div>'; state.asVocabPool = []; return; }
  if (!lvls.length) { host.innerHTML = '<div class="empty">Pick at least one level.</div>'; if (info) info.textContent = ''; state.asVocabPool = []; return; }
  host.innerHTML = '<div class="empty">Loading words…</div>';
  try {
    var res = await fetch('/data/vocab/by-category/' + slug + '.json');
    var words = await res.json();
    var pool = words.filter(function (w) {
      return (w.levels || []).some(function (l) { return lvls.indexOf(String(l).toLowerCase()) !== -1; });
    });
    state.asVocabPool = pool;
    state.asVocabCatWords = words;
    if (!pool.length) {
      if (info) info.textContent = '';
      host.innerHTML = '<div class="empty">No words at these levels in this category.</div>';
      return;
    }
    host.innerHTML = pool.map(function (w, i) {
      return '<label class="as-vw"><input type="checkbox" class="as-vocab-word" value="' + i + '" checked> ' +
        '<b>' + esc(w.word) + '</b> <span class="muted">' + esc((w.levels || []).join('/').toUpperCase()) + ' · ' + esc(w.meaning_fa || w.meaning_en || '') + '</span></label>';
    }).join('');
    asVocabSelCount();
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load words for this category.</div>';
  }
}
function asVocabSelCount() {
  var info = document.getElementById('as-vocab-poolinfo');
  var pool = state.asVocabPool || [];
  if (!info || !pool.length) return;
  var n = document.querySelectorAll('.as-vocab-word:checked').length;
  info.textContent = n + ' of ' + pool.length + ' words selected.';
}
function asVocabSelectedWords() {
  var pool = state.asVocabPool || [];
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-word:checked'), function (cb) {
    var w = pool[parseInt(cb.value, 10)];
    if (w) out.push(w);
  });
  return out;
}
var VOCAB_LV_RANK = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6 };
function vocabMaxLevel(w) {
  var best = 'a1', br = 0;
  (w.levels || []).forEach(function (l) {
    var r = VOCAB_LV_RANK[String(l).toLowerCase()] || 0;
    if (r > br) { br = r; best = String(l).toLowerCase(); }
  });
  return best;
}
function vocabMeaning(w) {
  /* fa for A1/A2 words, en for B1+ — same rule as the vocab practice quiz */
  var lv = vocabMaxLevel(w);
  return (lv === 'a1' || lv === 'a2') ? (w.meaning_fa || w.meaning_en || '') : (w.meaning_en || w.meaning_fa || '');
}
function vocabSlugOf(w) { return String(w.word || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function vocabDistractors(target, samePool, anyPool, mode, field) {
  var seen = {};
  seen[field(target)] = true;
  var picks = [];
  var take = function (src) {
    shuffleArr((src || []).slice()).forEach(function (w) {
      if (picks.length >= 3) return;
      if (!w || w.word === target.word) return;
      var v = field(w);
      if (!v || seen[v]) return;
      seen[v] = true;
      picks.push(v);
    });
  };
  if (mode === 'any') { take(anyPool); take(samePool); } else { take(samePool); take(anyPool); }
  return picks;
}
function vocabGapSentence(w) {
  var sents = [w.example_en].concat(w.examples_extra || []);
  var word = String(w.word || '');
  if (!word) return null;
  for (var i = 0; i < sents.length; i++) {
    var s = sents[i];
    if (!s) continue;
    var idx = s.toLowerCase().indexOf(word.toLowerCase());
    if (idx !== -1) return s.slice(0, idx) + '___' + s.slice(idx + word.length);
  }
  return null;
}
function genVocabQuestions(selected, opts) {
  var types = opts.types.length ? opts.types : ['meaning'];
  var samePool = state.asVocabCatWords || selected;
  var anyPool = opts.anyPool || [];
  var words = shuffleArr(selected.slice());
  var qs = [];
  var ti = 0, wi = 0;
  while (qs.length < opts.count && wi < words.length * 2) {
    var w = words[wi % words.length];
    wi++;
    var type = types[ti % types.length];
    ti++;
    var q = null;
    if (type === 'meaning') {
      var m = vocabMeaning(w);
      var ds = vocabDistractors(w, samePool, anyPool, opts.dist, vocabMeaning);
      if (m && ds.length === 3) {
        var o1 = shuffleArr([m].concat(ds));
        q = { type: 'mcq', q: 'What does "' + w.word + '" mean?', options: o1, answer: o1.indexOf(m) };
      }
    } else if (type === 'reverse') {
      var m2 = vocabMeaning(w);
      var ds2 = vocabDistractors(w, samePool, anyPool, opts.dist, function (x) { return x.word; });
      if (m2 && ds2.length === 3) {
        var o2 = shuffleArr([w.word].concat(ds2));
        q = { type: 'mcq', q: 'Which word means "' + m2 + '"?', options: o2, answer: o2.indexOf(w.word) };
      }
    } else if (type === 'gap') {
      var sent = vocabGapSentence(w);
      var ds3 = vocabDistractors(w, samePool, anyPool, opts.dist, function (x) { return x.word; });
      if (sent && ds3.length === 3) {
        var o3 = shuffleArr([w.word].concat(ds3));
        q = { type: 'mcq', q: 'Choose the missing word: ' + sent, options: o3, answer: o3.indexOf(w.word) };
      }
    } else if (type === 'listen') {
      var ds4 = vocabDistractors(w, samePool, anyPool, opts.dist, function (x) { return x.word; });
      if (w.audio && ds4.length === 3) {
        var o4 = shuffleArr([w.word].concat(ds4));
        q = { type: 'listen', q: '🎧 Listen — which word do you hear?', audio: w.audio, options: o4, answer: o4.indexOf(w.word) };
      }
    }
    if (q) {
      q.id = 'vocab:' + vocabSlugOf(w) + ':' + type + ':' + qs.length;
      q.prompt = q.q;
      q.word = w.word;
      q.level = vocabMaxLevel(w);
      q.topic_label = opts.catTitle;
      q.explanation = w.word + ' — ' + (w.meaning_en || '') + (w.meaning_fa ? ' · ' + w.meaning_fa : '') +
        (w.example_en ? ' Example: ' + w.example_en : '');
      qs.push(q);
    }
  }
  return qs;
}
async function createVocabAssignment(btn, ctx) {
  var err = ctx.err, targets = ctx.targets, orig = ctx.orig;
  var catSel = document.getElementById('as-vocab-cat');
  var cat = null;
  (state.asVocabCats || []).forEach(function (x) { if (x.slug === (catSel ? catSel.value : '')) cat = x; });
  if (!cat) { err('Pick a word category.'); return; }
  var lvls = asVocabLevels();
  if (!lvls.length) { err('Pick at least one word level.'); return; }
  var selected = asVocabSelectedWords();
  if (!selected.length) { err('Select at least one word.'); return; }
  var types = [];
  Array.prototype.forEach.call(document.querySelectorAll('.as-vocab-type:checked'), function (cb) { types.push(cb.value); });
  if (!types.length) { err('Pick at least one question type.'); return; }
  var countEl = document.getElementById('as-vocab-count');
  var count = parseInt(countEl ? countEl.value : '10', 10) || 10;
  var distEl = document.querySelector('input[name="as-vocab-dist"]:checked');
  var dist = distEl ? distEl.value : 'same';
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  var anyPool = [];
  if (dist === 'any') {
    try {
      var others = (state.asVocabCats || []).filter(function (x) { return x.slug !== cat.slug; })
        .sort(function (a, b) { return (b.word_count || 0) - (a.word_count || 0); });
      if (others.length) {
        var res = await fetch('/data/vocab/by-category/' + others[0].slug + '.json');
        anyPool = await res.json();
      }
    } catch (e) {}
  }
  var questions = genVocabQuestions(selected, { count: count, types: types, dist: dist, anyPool: anyPool, catTitle: cat.title });
  if (!questions.length) {
    err('Could not build questions from this selection — try more words or question types.');
    btn.disabled = false; btn.textContent = orig;
    return;
  }
  if (questions.length < count) err('Only ' + questions.length + ' questions could be built for this selection.');
  var title = '📚 ' + cat.title + ' vocabulary (' + lvls.map(function (l) { return l.toUpperCase(); }).join(',') + ')';
  var noteEl = document.getElementById('as-note');
  var dlEl = document.getElementById('as-deadline');
  var note = noteEl ? noteEl.value.trim() : '';
  var deadline = dlEl && dlEl.value ? dlEl.value : null;
  btn.textContent = 'Sending…';
  try {
    var ins = await sb.from('assignments').insert({
      teacher_id: tchViewId(),
      teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
      kind: ctx.mode, title: title,
      level: lvls.join(','),
      topic: 'vocab', topic_label: cat.title + ' vocabulary',
      question_count: questions.length, questions: questions,
      student_ids: targets.map(function (s) { return s.user_id; }),
      note: note || null, deadline: deadline
    }).select('id').single();
    if (ins.error) throw ins.error;
    var body = '📝 Your teacher sent you ' + (ctx.mode === 'exam' ? 'an exam' : 'homework') + ': ' + title + ' — open Muse English to start.';
    await Promise.all(targets.map(function (s) {
      return Promise.allSettled([
        sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body }),
        sb.rpc('send_nudge', { p_student: s.user_id })
      ]);
    }));
    asComposeDone();
  } catch (e) {
    err('Could not send: ' + (e && e.message ? e.message : 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---- teacher: mixed-topic exam ----
   Rows of [topic × count] -> one bank fetch per topic (fail-soft: a 404 bank
   is skipped and reported) -> N sampled per topic, each tagged with its
   topic_label -> shuffled into a single exam snapshot stored in
   public.assignments with kind='exam', topic='mixed'. No new columns. */
async function createExamAssignment(btn, ctx) {
  const err = ctx.err, level = ctx.level, targets = ctx.targets, orig = ctx.orig;
  const rows = Array.prototype.slice.call(document.querySelectorAll('#as-mixrows .as2-mixrow'));
  const mix = [];
  rows.forEach(function (r) {
    let t = r.querySelector('.as-mix-topic').value;
    const c = parseInt(r.querySelector('.as-mix-count').value, 10) || 0;
    if (t && c > 0) {
      /* v2 topic values look like v2:<slug> */
      let slug = t;
      if (t.indexOf('v2:') === 0) { slug = t.slice(3); }
      mix.push({ topic: slug, count: c, raw: t });
    }
  });
  if (!mix.length) { err('Add at least one topic with at least 1 question.'); return; }
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  const settled = await Promise.all(mix.map(async function (m) {
    /* v2: bank questions for this topic's points, filtered by the exam level */
    const t = V2_TOPICS[m.topic];
    const ptIds = ((t && t.points) || []).map(function (p) { return p.id; });
    let bankQs = [];
    try { bankQs = await asV2FetchBank(ptIds); } catch (e) {}
    const lvItems = bankQs.filter(function (ex) {
      return String(ex.level || '').toLowerCase() === level;
    });
    return { m: m, bankQs: lvItems };
  }));
  const skipped = [];
  let questions = [];
  settled.forEach(function (s) {
    const qs = s.bankQs || [];
    if (!qs.length) { skipped.push(s.m.topic); return; }
    shuffleArr(qs.slice()).slice(0, Math.min(s.m.count, qs.length)).forEach(function (q) {
      questions.push(asV2SnapshotQ(q, s.m.topic));
    });
  });
  if (!questions.length) {
    err('None of the selected topics has a question bank yet.');
    btn.disabled = false; btn.textContent = orig; return;
  }
  questions = shuffleArr(questions);
  const perTopic = {};
  questions.forEach(function (q) { perTopic[q.topic_label] = (perTopic[q.topic_label] || 0) + 1; });
  const compLabel = Object.keys(perTopic).map(function (t) { return t + ' ×' + perTopic[t]; }).join(' · ');
  const title = '📋 Mixed exam (' + level.toUpperCase() + ' · ' + Object.keys(perTopic).length +
    ' topic' + (Object.keys(perTopic).length > 1 ? 's' : '') + ' · ' + questions.length + ' Q)';
  const noteEl = document.getElementById('as-note');
  const dlEl = document.getElementById('as-deadline');
  const note = noteEl ? noteEl.value.trim() : '';
  const deadline = dlEl && dlEl.value ? dlEl.value : null;
  btn.textContent = 'Sending…';
  try {
    const ins = await sb.from('assignments').insert({
      teacher_id: tchViewId(),
      teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
      kind: 'exam', title: title, level: level,
      topic: 'mixed', topic_label: compLabel,
      question_count: questions.length, questions: questions,
      student_ids: targets.map(function (s) { return s.user_id; }),
      note: note || null, deadline: deadline
    }).select('id').single();
    if (ins.error) throw ins.error;
    /* inbox regex expects: 📝 Your teacher sent you an exam: 📝 <title> — open Muse English to start. */
    const body = '📝 Your teacher sent you an exam: 📝 ' + title + ' — open Muse English to start.';
    await Promise.all(targets.map(function (s) {
      return Promise.allSettled([
        sb.rpc('send_teacher_message', { p_student: s.user_id, p_body: body }),
        sb.rpc('send_nudge', { p_student: s.user_id })
      ]);
    }));
    asComposeDone();
    if (skipped.length) alert('Exam sent, but these topics were skipped (no question bank yet):\n• ' + skipped.join('\n• '));
  } catch (e) {
    err('Could not send: ' + (e && e.message ? e.message : 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

/* ---- teacher: weekly planner ----
   One screen, seven day-rows. The teacher picks a topic per day (their call —
   topics are never auto-advanced); count/time/students default to the usual.
   Each filled row becomes one assignment with status='scheduled' + send_at.
   The assignment-sender cron delivers them on time. */
/* ---- student-local scheduling ----
   The planner time (e.g. 07:00) means 07:00 in EACH STUDENT's timezone.
   wallTimeToUtc() converts a wall-clock time on a calendar date in a given
   IANA timezone to a UTC Date (iterative offset resolution, DST-safe). */
function wallTimeToUtc(dateStr, timeStr, tz) {
  const dp = String(dateStr || '').split('-'), tp = String(timeStr || '08:00').split(':');
  const Y = +dp[0] || 2000, M = +dp[1] || 1, D = +dp[2] || 1;
  const h = +tp[0] || 0, mi = +tp[1] || 0;
  const target = Date.UTC(Y, M - 1, D, h, mi);
  let guess = target;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    for (let i = 0; i < 4; i++) {
      const parts = {};
      fmt.formatToParts(new Date(guess)).forEach(function (p) { parts[p.type] = p.value; });
      const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
        (+parts.hour) % 24, +parts.minute, +parts.second);
      const diff = target - asUtc;
      if (!diff) break;
      guess += diff;
    }
  } catch (e) { /* unknown tz -> fall back to treating the wall time as UTC */ }
  return new Date(guess);
}
function tzShort(tz) {
  return String(tz || '').split('/').pop().replace(/_/g, ' ') || '';
}
function teacherTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (e) { return 'UTC'; }
}
function dowInTz(iso, tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(iso));
    const m = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    if (s in m) return m[s];
  } catch (e) {}
  return new Date(iso).getDay();
}
function timeInTz(iso, tz) {
  try {
    const p = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.hour + ':' + p.minute;
  } catch (e) { return '08:00'; }
}
/* 'Sends Mon 07:00 · Tehran' — the student-local send moment of a scheduled row. */
function schedLabel(sendAt, sendTz) {
  if (!sendTz) return '⏰ Sends ' + fmtDateTime(sendAt);
  try {
    const d = new Date(sendAt);
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: sendTz, weekday: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    return '⏰ Sends ' + parts.weekday + ' ' + parts.hour + ':' + parts.minute + ' · ' + tzShort(sendTz);
  } catch (e) { return '⏰ Sends ' + fmtDateTime(sendAt); }
}
const PLANNER_DAYS = [
  { dow: 6, label: 'شنبه · Sat' }, { dow: 0, label: 'یکشنبه · Sun' },
  { dow: 1, label: 'دوشنبه · Mon' }, { dow: 2, label: 'سه‌شنبه · Tue' },
  { dow: 3, label: 'چهارشنبه · Wed' }, { dow: 4, label: 'پنجشنبه · Thu' },
  { dow: 5, label: 'جمعه · Fri' }
];
function plannerNextDate(dow, timeStr) {
  const parts = String(timeStr || '08:00').split(':');
  const hh = parseInt(parts[0], 10) || 8, mm = parseInt(parts[1], 10) || 0;
  const now = new Date();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, hh, mm, 0);
    if (d.getDay() === dow && d.getTime() > now.getTime() + 3600000) return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, hh, mm, 0);
}
function plannerDayLabel(dow, timeStr) {
  const d = plannerNextDate(dow, timeStr || '08:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
async function renderPlanner(v) {
  if (!state.teacher) { go('become-teacher'); return; }
  await loadV2Index();
  v.innerHTML = '<div class="tch-wrap"><a class="pl-back" href="#/teacher">← Teacher dashboard</a>' +
    '<h1 class="pl-title">📅 Weekly planner</h1>' +
    '<p class="muted" style="margin-top:-0.4rem">Pick a topic for each day — the rest uses your usual settings. Empty days are skipped.</p>' +
    '<div id="pl-body"><div class="empty">Loading…</div></div></div>';
  window.scrollTo(0, 0);
  try {
    if (!state.teacherStudents) {
      const r = await sb.rpc('get_my_students');
      if (r.error) throw r.error;
      state.teacherStudents = r.data || [];
    }
    const list = state.teacherStudents || [];
    if (!list.length) {
      document.getElementById('pl-body').innerHTML =
        '<div class="empty">You have no students yet — share your invite link first. 🌱</div>';
      return;
    }
    const lastMap = await plannerLastMap();
    const schedMap = await plannerSchedMap();
    /* If every scheduled day shares one level, start the week on that level. */
    const schedLevels = {};
    Object.keys(schedMap).forEach(function (d) { if (schedMap[d].level) schedLevels[schedMap[d].level] = 1; });
    const schedLevelKeys = Object.keys(schedLevels);
    const startLevel = schedLevelKeys.length === 1 ? schedLevelKeys[0] : 'a2';
    const host = document.getElementById('pl-body');
    host.innerHTML = '<div class="as2"><div class="card pl-card">' +
      '<div class="field"><label for="pl-level">Level <span class="as2-opt">(whole week)</span></label>' +
      '<select id="pl-level" class="input">' +
      ASSIGN_LEVELS.map(function (lv) { return '<option value="' + lv + '"' + (lv === startLevel ? ' selected' : '') + '>' + lv.toUpperCase() + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Students <span class="pl-selwrap"><button type="button" class="pl-selbtn" id="pl-select-all">Select all</button> · <button type="button" class="pl-selbtn" id="pl-deselect-all">Deselect all</button></span></label><div class="as2-students">' +
      '<label class="chk"><input type="checkbox" id="pl-all" checked> All students (' + list.length + ')</label>' +
      '<div id="pl-students" class="hidden">' +
      list.map(function (s) {
        const nm = s.display_name || (s.email || '?').split('@')[0];
        return '<label class="chk"><input type="checkbox" class="pl-st" value="' + esc(s.user_id) + '" checked> ' + esc(nm) + '</label>';
      }).join('') + '</div></div></div>' +
      '<div id="pl-days">' + PLANNER_DAYS.map(function (dy) {
        return '<div class="pl-day" data-dow="' + dy.dow + '">' +
          '<div class="pl-dayhead"><b>' + dy.label + '</b>' +
          '<span class="muted pl-date" data-dow="' + dy.dow + '">' + plannerDayLabel(dy.dow, '08:00') + '</span>' +
          (lastMap[dy.dow] ? '<span class="pl-last">Last: ' + esc(lastMap[dy.dow]) + '</span>' : '') + '</div>' +
          '<div class="pl-row">' +
          '<select class="input pl-topic" data-dow="' + dy.dow + '" aria-label="Topic"><option value="">— no homework —</option></select>' +
          '<select class="input pl-count" data-dow="' + dy.dow + '" aria-label="Questions">' +
          [5, 10, 15, 20].map(function (n) { return '<option value="' + n + '"' + (n === 10 ? ' selected' : '') + '>' + n + ' Q</option>'; }).join('') +
          '</select>' +
          '<input type="time" class="input pl-time" data-dow="' + dy.dow + '" value="08:00" aria-label="Send time">' +
          '</div><div class="pl-sched muted" data-dow="' + dy.dow + '"></div></div>';
      }).join('') + '</div>' +
      '<div class="form-error" id="pl-error" role="alert"></div>' +
      '<button class="as2-send" data-action="planner-save">⏰ Schedule week</button>' +
      '</div></div>';
    plannerFillTopics();
    plannerPrefillSched(schedMap);
    document.getElementById('pl-level').addEventListener('change', plannerFillTopics);
    document.getElementById('pl-all').addEventListener('change', function () {
      document.getElementById('pl-students').classList.toggle('hidden', this.checked);
    });
    var plSelAll = document.getElementById('pl-select-all');
    if (plSelAll) plSelAll.addEventListener('click', function () {
      document.getElementById('pl-all').checked = true;
      document.getElementById('pl-students').classList.add('hidden');
      Array.prototype.forEach.call(document.querySelectorAll('.pl-st'), function (cb) { cb.checked = true; });
    });
    var plDeselAll = document.getElementById('pl-deselect-all');
    if (plDeselAll) plDeselAll.addEventListener('click', function () {
      document.getElementById('pl-all').checked = false;
      document.getElementById('pl-students').classList.remove('hidden');
      Array.prototype.forEach.call(document.querySelectorAll('.pl-st'), function (cb) { cb.checked = false; });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.pl-time'), function (t) {
      t.addEventListener('change', function () {
        const dow = parseInt(t.getAttribute('data-dow'), 10);
        const lbl = document.querySelector('.pl-date[data-dow="' + dow + '"]');
        if (lbl) lbl.textContent = plannerDayLabel(dow, t.value);
      });
    });
  } catch (e) {
    document.getElementById('pl-body').innerHTML =
      '<div class="empty">Could not load the planner: ' + esc(e.message || e) + '</div>';
  }
}
/* Pre-fill planner rows from already-scheduled days so leaving and coming
   back never looks like a reset. */
function plannerPrefillSched(schedMap) {
  Object.keys(schedMap).forEach(function (dow) {
    const g = schedMap[dow];
    const dayEl = document.querySelector('.pl-day[data-dow="' + dow + '"]');
    if (!dayEl) return;
    const topicSel = dayEl.querySelector('.pl-topic');
    if (topicSel && (g.slug || g.topic)) {
      /* options are 'v2:<slug>' — match on the stored slug, not the label */
      const want = g.slug ? 'v2:' + g.slug : g.topic;
      const hasOpt = Array.prototype.some.call(topicSel.options, function (o) { return o.value === want; });
      if (hasOpt) topicSel.value = want;
    }
    const countSel = dayEl.querySelector('.pl-count');
    if (countSel && g.count) countSel.value = String(g.count);
    const timeEl = dayEl.querySelector('.pl-time');
    if (timeEl && g.time) {
      timeEl.value = g.time;
      const lbl = document.querySelector('.pl-date[data-dow="' + dow + '"]');
      if (lbl) lbl.textContent = plannerDayLabel(parseInt(dow, 10), g.time);
    }
    const note = dayEl.querySelector('.pl-sched');
    if (note && g.groups.length) {
      note.textContent = '⏰ Scheduled: ' + g.time + ' · ' +
        g.groups.map(function (x) { return tzShort(x.tz) + ' (' + x.n + ')'; }).join(', ');
    }
  });
}
function plannerFillTopics() {
  Array.prototype.forEach.call(document.querySelectorAll('.pl-topic'), function (sel) {
    const cur = sel.value;
    let html = '<option value="">— no homework —</option>';
    Object.keys(V2_FAMILIES).forEach(function (famSlug) {
      const fam = V2_FAMILIES[famSlug];
      html += '<optgroup label="' + esc(fam.title) + '">';
      fam.topics.forEach(function (tslug) {
        const t = V2_TOPICS[tslug];
        if (t) html += '<option value="v2:' + esc(tslug) + '">' + esc(t.h1) + '</option>';
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    sel.value = cur;
  });
}
async function plannerLastMap() {
  const map = {};
  try {
    const r = await sb.from('assignments').select('topic_label,send_at,created_at')
      .eq('teacher_id', state.user.id).order('created_at', { ascending: false }).limit(40);
    if (r.error) throw r.error;
    (r.data || []).forEach(function (x) {
      const dow = new Date(x.send_at || x.created_at).getDay();
      if (!(dow in map) && x.topic_label) map[dow] = x.topic_label;
    });
  } catch (e) {}
  return map;
}
/* Already-scheduled (not yet sent) rows, keyed by weekday in their own
   student-local timezone: { topic, count, level, time, groups: [{tz, n}] }. */
async function plannerSchedMap() {
  const map = {};
  try {
    const r = await sb.from('assignments')
      .select('topic,topic_label,question_count,level,send_at,send_tz,student_ids')
      .eq('teacher_id', state.user.id).eq('status', 'scheduled')
      .gt('send_at', new Date().toISOString())
      .order('send_at', { ascending: true }).limit(60);
    if (r.error) throw r.error;
    (r.data || []).forEach(function (x) {
      const tz = x.send_tz || teacherTz();
      const dow = dowInTz(x.send_at, tz);
      const g = (map[dow] = map[dow] || {
        topic: x.topic_label, slug: x.topic, count: x.question_count || 10, level: x.level,
        time: timeInTz(x.send_at, tz), groups: []
      });
      g.groups.push({ tz: tz, n: (x.student_ids || []).length });
    });
  } catch (e) {}
  return map;
}
async function savePlanner(btn) {
  const errBox = document.getElementById('pl-error');
  const err = function (m) { if (errBox) errBox.textContent = m; };
  err('');
  const level = document.getElementById('pl-level').value;
  const roster = state.teacherStudents || [];
  const useAll = document.getElementById('pl-all').checked;
  const targets = useAll ? roster.slice() : roster.filter(function (s) {
    const cb = document.querySelector('.pl-st[value="' + s.user_id + '"]');
    return cb && cb.checked;
  });
  if (!targets.length) { err('Pick at least one student.'); return; }
  /* Group students by timezone (unknown -> teacher's). The picked time means
     that local time for each student, so each group gets its own send_at. */
  const tTz = teacherTz();
  const groups = {};
  targets.forEach(function (s) {
    const tz = s.timezone || tTz;
    (groups[tz] = groups[tz] || []).push(s);
  });
  const tzList = Object.keys(groups);
  const rows = [];
  Array.prototype.forEach.call(document.querySelectorAll('.pl-day'), function (dayEl) {
    const topic = dayEl.querySelector('.pl-topic').value;
    if (!topic) return;
    const dow = parseInt(dayEl.getAttribute('data-dow'), 10);
    const timeStr = dayEl.querySelector('.pl-time').value || '08:00';
    const d = plannerNextDate(dow, timeStr);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    rows.push({
      dow: dow, topic: topic, dateStr: dateStr, timeStr: timeStr,
      count: parseInt(dayEl.querySelector('.pl-count').value, 10) || 10
    });
  });
  btn.disabled = true;
  const orig = btn.textContent;
  try {
    /* Phase 1 — build every day's questions BEFORE touching the existing
       schedule, so a failure leaves the old plan intact. Bank-first (same as
       the composer); when the bank is short at the picked level, top up from
       the topic's site exercises — 257 of 642 topic×level pairs have no bank
       items at all, and the old code died on those with a bare "empty". */
    const built = [];
    if (rows.length) {
      btn.textContent = 'Preparing questions…';
      let grammarLoaded = false;
      for (const r of rows) {
        /* v2 topic value looks like v2:<slug> */
        const slug = r.topic.indexOf('v2:') === 0 ? r.topic.slice(3) : r.topic;
        const t = V2_TOPICS[slug];
        const ptIds = ((t && t.points) || []).map(function (p) { return p.id; });
        let bankQs = [];
        try { bankQs = await asV2FetchBank(ptIds); } catch (e) {}
        const lvItems = bankQs.filter(function (ex) {
          return String(ex.level || '').toLowerCase() === level;
        });
        if (lvItems.length < r.count) {
          try {
            if (!grammarLoaded) { await loadAllGrammar(); grammarLoaded = true; }
            const gt = findGrammarTopic(slug);
            if (gt) {
              const seen = {};
              lvItems.forEach(function (ex) { if (ex.id) seen[ex.id] = 1; });
              grammarAllItems(gt).forEach(function (ex) {
                if (ex.use === 'bank') return; /* bank comes from the fetch above; app-data copies are for student practice */
                if (String(ex.level || '').toLowerCase() === level && !(ex.id && seen[ex.id])) lvItems.push(ex);
              });
            }
          } catch (e) { /* top-up is best-effort; the empty check below reports */ }
        }
        const picked = shuffleArr(lvItems.slice()).slice(0, Math.min(r.count, lvItems.length));
        const topicLabel = t ? t.h1 : slug;
        if (!picked.length) {
          throw new Error('No questions for "' + topicLabel + '" at ' +
            level.toUpperCase() + ' yet — pick another topic or level for that day.');
        }
        built.push({
          r: r, slug: slug, topicLabel: topicLabel,
          questions: picked.map(function (ex) { return asV2SnapshotQ(ex, slug); })
        });
      }
    }
    /* Replace semantics: cancel this teacher's still-pending scheduled rows
       first, so the planner always reflects the current plan (and re-saving
       never duplicates). Rows already due stay for the sender.
       NOTE: this runs even when every day is "no homework", so clearing the
       whole week actually clears the schedule. */
    btn.textContent = 'Clearing old schedule…';
    try {
      const old = await sb.from('assignments').select('id')
        .eq('teacher_id', state.user.id).eq('status', 'scheduled')
        .gt('send_at', new Date().toISOString()).limit(100);
      const ids = (old.data || []).map(function (x) { return x.id; });
      if (ids.length) {
        const del = await sb.from('assignments').delete().in('id', ids);
        if (del.error) throw del.error;
      }
    } catch (e2) { /* pre-migration or RLS: continue, worst case duplicates */ }
    if (!rows.length) {
      document.getElementById('pl-body').innerHTML =
        '<div class="card pl-done"><div class="pl-done-ico">✅</div><h2>Schedule cleared!</h2>' +
        '<p class="muted">All pending scheduled assignments were removed.</p>' +
        '<a class="btn btn-block" href="#/teacher">← Back to dashboard</a></div>';
      window.scrollTo(0, 0);
      return;
    }
    /* Phase 2 — insert the built plan, one row per day per timezone group. */
    let n = 0;
    const total = built.length * tzList.length;
    for (const b of built) {
      const r = b.r, questions = b.questions, topicLabel = b.topicLabel;
      for (const tz of tzList) {
        btn.textContent = 'Scheduling ' + (++n) + '/' + total + '…';
        const sendAt = wallTimeToUtc(r.dateStr, r.timeStr, tz);
        const ins = await sb.from('assignments').insert({
          teacher_id: tchViewId(),
          teacher_name: ((state.twViewTeacher || state.teacher) && (state.twViewTeacher || state.teacher).display_name) || '',
          kind: 'homework', title: '📝 ' + topicLabel + ' (' + level.toUpperCase() + ')',
          level: level, topic: b.slug, topic_label: topicLabel,
          question_count: questions.length, questions: questions,
          student_ids: groups[tz].map(function (s) { return s.user_id; }),
          note: null, deadline: null,
          status: 'scheduled', send_at: sendAt.toISOString(), send_tz: tz
        });
        if (ins.error) throw ins.error;
      }
    }
    const gNote = tzList.length > 1
      ? ' Each day goes out at ' + esc(rows[0].timeStr) + ' in every student\'s own timezone (' +
        tzList.map(tzShort).map(esc).join(', ') + ').'
      : ' Each day goes out at ' + esc(rows[0].timeStr) + ' ' + esc(tzShort(tzList[0])) + ' time.';
    document.getElementById('pl-body').innerHTML =
      '<div class="card pl-done"><div class="pl-done-ico">✅</div><h2>Week scheduled!</h2>' +
      '<p class="muted">' + rows.length + ' day' + (rows.length > 1 ? 's' : '') +
      ' scheduled (' + total + ' send' + (total > 1 ? 's' : '') + ').' + gNote + '</p>' +
      '<a class="btn btn-block" href="#/teacher">← Back to dashboard</a></div>';
    window.scrollTo(0, 0);
  } catch (e) {
    const msg = (e && e.message) || '';
    err(/column|schema/i.test(msg)
      ? 'The planner migration has not been run yet — run supabase-planner-tz-migration.sql first.'
      : 'Could not schedule: ' + (msg || 'check your connection.'));
    btn.disabled = false; btn.textContent = orig;
  }
}

