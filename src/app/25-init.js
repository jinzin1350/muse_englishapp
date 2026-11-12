/* ---------------- init ---------------- */
/* Auto-refresh on new deploy (2026-10-09): APP_VERSION is baked into this bundle
   at push time. If the server's version.json is newer, reload once so the user
   never keeps running a stale cached bundle. Skipped mid-quiz. */
var APP_VERSION = '202611122259';
function checkAppVersion() {
  try {
    if (!APP_VERSION || APP_VERSION === '__APP_VERSION__') return;
    if (state.quiz) return;
    fetch('/version.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.v && j.v !== APP_VERSION) {
        let seen = null;
        try { seen = sessionStorage.getItem('appv_seen'); } catch (e) {}
        if (seen !== j.v) {
          try { sessionStorage.setItem('appv_seen', j.v); } catch (e) {}
          window.location.reload();
        }
      }
    }).catch(function () {});
  } catch (e) {}
}

async function init() {
  initAudio();
  bindEvents();
  checkAppVersion();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkAppVersion();
  });
  initPwaPrompt();
  initHeartbeat();
  initSupabase();
  initOneSignal();
  syncPushState();
  playerUI();
  /* The splash stays until the first content is on screen (min ~900ms so it
     still reads as a splash); the 6s inline fallback remains as a backstop. */
  window._splashAt = Date.now();
  window._appReady = false;

  /* Teacher portal: own path, own gate, own chrome — never the learner boot. */
  if (isTeachersPath()) { renderTeachers(); hideSplashSoon(); return; }

  if (sb) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session && data.session.user) {
        /* Panel path skips the heavy learner boot — it has its own gate. */
        if (isPanelPath()) { renderAdminPanel(); hideSplashSoon(); return; }
        await enterApp(); return;
      }
    } catch (e) {}
  }
  /* Panel path without a session: the panel renders its own login screen. */
  if (isPanelPath()) { renderAdminPanel(); hideSplashSoon(); return; }
  // Logged out: respect the hash (deep links to #/signin etc.), default landing.
  onRoute();
  hideSplashSoon();
}

/* Hide the splash once the first paint happened. */
function hideSplashSoon() {
  window._appReady = true;
  const elapsed = Date.now() - (window._splashAt || Date.now());
  setTimeout(hideSplash, Math.max(0, 900 - elapsed));
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s || s.classList.contains('hide')) return;
  s.classList.add('hide');
  setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 600);
}

/* ==================== Teacher portal (/teachers) — v2 redesign ====================
   Warm editorial design per supplied mockups (2026-10-17): cream background,
   Lora serif display headings, orange primary buttons, pill statuses.
   Same Supabase session as the learner app: teachers log in with their
   normal account; an approved `teachers` row unlocks the workspace.
   Learner chrome is hidden via body.tw-mode. */
function isTeachersPath() { return /^\/teachers(\/|$)/.test(window.location.pathname); }

var TW_SECTIONS = [
  ['overview', '📊', 'Overview'],
  ['students', '👥', 'Students'],
  ['daily', '📅', 'Daily study'],
  ['assignments', '✈️', 'Assignments'],
  ['placement', '📝', 'Placement tests'],
  ['ielts', '🎓', 'IELTS Speaking'],
  ['links', '🔗', 'Invite & links']
];

var TW_LEVEL_LABEL = { a1: 'Beginner', a2: 'Elementary', b1: 'Intermediate', b2: 'Upper-Intermediate', c1: 'Advanced', c2: 'Proficient' };
function twLevelLabel(l) {
  l = String(l || '').toLowerCase();
  return (l ? l.toUpperCase() : '—') + (TW_LEVEL_LABEL[l] ? ' · ' + TW_LEVEL_LABEL[l] : '');
}
/* Deterministic pastel avatar palette (bg, fg). */
var TW_AV = [
  ['#FDE3E3', '#D34F4F'], ['#E7E4FB', '#6C5CE7'], ['#DDF0FB', '#1D7FBF'],
  ['#E4F5DB', '#4C9A2A'], ['#FFF0D6', '#C77F0A'], ['#E6F4F0', '#1F9D74']
];
function twAvatar(name, cls) {
  var n = String(name || '?');
  var h = 0, i;
  for (i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
  var c = TW_AV[h % TW_AV.length];
  return '<span class="tw-av ' + (cls || '') + '" style="background:' + c[0] + ';color:' + c[1] + '">' +
    esc(n.trim().charAt(0).toUpperCase() || '?') + '</span>';
}
function twDaysSince(d) {
  if (!d) return null;
  var t = new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}
function twAgo(d) {
  var n = twDaysSince(d);
  if (n === null) return 'never';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return n + ' days ago';
}
function twDate(d) { return String(d || '').slice(0, 10) || '—'; }
function twRing(pct, sz) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  sz = sz || 64;
  var r = (sz - 8) / 2, circ = 2 * Math.PI * r;
  var col = pct >= 80 ? '#4C9A2A' : (pct >= 50 ? '#58B368' : '#F0A030');
  return '<span class="tw-ring" style="width:' + sz + 'px;height:' + sz + 'px">' +
    '<svg viewBox="0 0 ' + sz + ' ' + sz + '">' +
    '<circle cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" fill="none" stroke="#EDE7DB" stroke-width="7"/>' +
    '<circle cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="7" ' +
    'stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + (circ * (1 - pct / 100)).toFixed(1) + '" ' +
    'transform="rotate(-90 ' + sz / 2 + ' ' + sz / 2 + ')"/></svg>' +
    '<b>' + pct + '%</b></span>';
}
function twCopy(text, btn) {
  var done = function () {
    if (!btn) return;
    var o = btn.innerHTML;
    btn.innerHTML = '✓ Copied';
    setTimeout(function () { btn.innerHTML = o; }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallback(); });
  } else fallback();
  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    } catch (e) {}
    done();
  }
}
/* Warm decorative header illustration (books + mug + plant), abstract SVG. */
function twDeco() {
  return '<div class="tw-deco" aria-hidden="true">' +
    '<svg viewBox="0 0 320 150">' +
    '<ellipse cx="200" cy="70" rx="120" ry="62" fill="#FBEEDF"/>' +
    '<ellipse cx="235" cy="45" rx="46" ry="30" fill="#FDF6EC"/>' +
    '<circle cx="120" cy="40" r="7" fill="#F6DFC2"/><circle cx="140" cy="24" r="5" fill="#F9E8D2"/>' +
    '<g><rect x="150" y="92" width="110" height="16" rx="3" fill="#5E8F5A"/>' +
    '<rect x="150" y="92" width="110" height="5" rx="2" fill="#6FA06B"/>' +
    '<rect x="158" y="76" width="96" height="16" rx="3" fill="#E8935A"/>' +
    '<rect x="158" y="76" width="96" height="5" rx="2" fill="#F0A468"/></g>' +
    '<g><rect x="196" y="44" width="34" height="32" rx="5" fill="#FFFFFF" stroke="#EAD9C2"/>' +
    '<path d="M230 50 h10 a4 4 0 0 1 0 16 h-10" fill="none" stroke="#EAD9C2" stroke-width="4"/>' +
    '<circle cx="213" cy="60" r="7" fill="#E2574C"/></g>' +
    '<g stroke="#5E8F5A" stroke-width="5" stroke-linecap="round" fill="none">' +
    '<path d="M282 96 C 282 70, 280 50, 272 30"/><path d="M282 96 C 284 72, 290 54, 300 40"/>' +
    '<path d="M282 96 C 280 78, 274 66, 264 58"/></g>' +
    '<g fill="#6FA06B"><ellipse cx="268" cy="28" rx="13" ry="7" transform="rotate(-35 268 28)"/>' +
    '<ellipse cx="302" cy="38" rx="13" ry="7" transform="rotate(30 302 38)"/>' +
    '<ellipse cx="261" cy="56" rx="11" ry="6" transform="rotate(-25 261 56)"/></g>' +
    '<path d="M268 96 h28 l-5 22 h-18 z" fill="#F3E4CE"/>' +
    '</svg></div>';
}
/* Dotted paper-plane flourish for bottom banners. */
function twPlane() {
  return '<svg class="tw-plane" viewBox="0 0 220 60" aria-hidden="true">' +
    '<path d="M8 44 C 60 44, 90 40, 120 26 S 170 10, 196 12" fill="none" stroke="#E8B96A" ' +
    'stroke-width="2.5" stroke-dasharray="1 9" stroke-linecap="round"/>' +
    '<circle cx="8" cy="44" r="4.5" fill="#E8B96A"/>' +
    '<g transform="translate(186,2) rotate(18)"><path d="M0 0 L34 10 L0 22 L7 11 Z" fill="#F0854C"/></g>' +
    '</svg>';
}
function twPageHead(eyebrow, title, sub) {
  return '<div class="tw-phead"><div><div class="tw-eyebrow">' + eyebrow + '</div>' +
    '<h1 class="tw-title">' + title + '</h1>' +
    (sub ? '<p class="tw-sub">' + sub + '</p>' : '') + '</div>' + twDeco() + '</div>';
}

