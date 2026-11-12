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
/* Teacher id for dashboard queries: the viewed teacher in admin view-as mode,
   otherwise the logged-in user. */
function tchViewId() {
  return (state.viewTeacher && state.viewTeacher.user_id) || (state.user && state.user.id);
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

