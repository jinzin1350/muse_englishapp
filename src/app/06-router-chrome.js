/* ---------------- router (hash routes — safe on static hosting) ---------------- */
/* Phase 2.8 (item 1): the app-mode rule, shared by renderLanding's safety
   net. Must match the head script in index.html — keep them in sync.
   App-mode is ON if ANY is true: a session, an app hash route (#/...),
   standalone (installed PWA), an app query param (?lesson=latest,
   ?ref=), or the muse_app_used flag. */
function shouldEnterAppMode() {
  try {
    if (state.user) return true;
    var hash = window.location.hash || '';
    var standalone = false;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) standalone = true;
      if (window.navigator && window.navigator.standalone) standalone = true;
    } catch (e) {}
    var appQuery = false;
    try {
      var q = new URLSearchParams(window.location.search);
      appQuery = q.get('lesson') === 'latest' || !!q.get('ref');
    } catch (e) {}
    /* 2026-10-14: an exact '#/' is the anonymous visitor's "home" — the
       marketing landing, NOT the app. Without this, the preview/auth
       "back" links (href="#/") loop back into #/preview forever and the
       visitor can never return to the landing. Signed-in visitors never
       reach here with '#/' (onRoute moves them to #/home); push/referral
       visits still enter the app.
       2026-10-14 fix-2: this holds EVEN in the installed PWA. Its cold
       start has no hash (manifest start_url "/"), so an exact '#/' in
       standalone can only come from the in-app "back to website" links —
       keeping the !standalone carve-out trapped PWA users in a
       preview → '#/' → '/' → preview loop with no way back. */
    if (hash === '#/' && !appQuery) return false;
    if (hash.indexOf('#/') === 0) return true;
    if (standalone) return true;
    if (appQuery) return true;
    try {
      if (localStorage.getItem('muse_app_used') === '1') return true;
    } catch (e) {}
  } catch (e) {}
  return false;
}

const PUBLIC_VIEWS = ['landing', 'signin', 'signup', 'preview', 'ptest', 'certificate'];
const LEARNER_VIEWS = ['home', 'lesson', 'lessons', 'scores', 'review', 'profile', 'admin', 'admin-teacher', 'waiting', 'challenge', 'teacher', 'become-teacher', 'inbox', 'homework', 'planner', 'choose-teacher', 'progress', 'grammar', 'grammar-test', 'ielts', 'vocab', 'sentences', 'words', 'tricky', 'support', 'ptest', 'certificate'];
const INPAGE_ANCHORS = ['how-it-works', 'levels'];
/* Return-after-signup (Claude for Alireza, 2026-11-10): a signed-out visitor
   who opens one of these routes (e.g. the /fa/ielts/ CTA -> #/ielts) sees the
   signup page, and after sign-up/sign-in + onboarding lands back on the route.
   localStorage (not sessionStorage) so it survives an email-confirm tab; 24h TTL. */
const RETURN_VIEWS = ['ielts', 'grammar-test'];
const RETURN_KEY = 'muse_return_v1';
function saveReturnRoute(view) {
  try { localStorage.setItem(RETURN_KEY, JSON.stringify({ h: '#/' + view, t: Date.now() })); } catch (e) {}
}
/* Teacher portal login (Claude for Alireza, 2026-11-10): /teachers has no
   login form of its own any more. Its "Log in" / "Create account" buttons
   send teachers to the main sign-in/sign-up page (Google + email), with this
   one-shot flag; enterApp() sends them back to /teachers right after auth,
   before any learner onboarding. Only whitelisted paths; 30-minute TTL. */
const AUTH_RETURN_KEY = 'muse_auth_return_v1';
const AUTH_RETURN_PATHS = ['/teachers'];
function setAuthReturnPath(path) {
  try { localStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ p: path, t: Date.now() })); } catch (e) {}
}
function peekAuthReturnPath() {
  try {
    const o = JSON.parse(localStorage.getItem(AUTH_RETURN_KEY) || 'null');
    if (!o || AUTH_RETURN_PATHS.indexOf(o.p) === -1 || Date.now() - (o.t || 0) > 30 * 60000) return null;
    return o.p;
  } catch (e) { return null; }
}
function takeAuthReturnPath() {
  const p = peekAuthReturnPath();
  try { localStorage.removeItem(AUTH_RETURN_KEY); } catch (e) {}
  return p;
}
function takeReturnRoute() {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    if (!raw) return null;
    localStorage.removeItem(RETURN_KEY);
    const o = JSON.parse(raw);
    if (!o || typeof o.h !== 'string' || Date.now() - (o.t || 0) > 86400000) return null;
    const m = o.h.match(/^#\/([a-z-]+)$/);
    return (m && RETURN_VIEWS.indexOf(m[1]) !== -1) ? o.h : null;
  } catch (e) { return null; }
}

function parseHash() {
  const h = window.location.hash || '#/';
  const raw = h.replace(/^#/, '');
  const parts = raw.replace(/^\//, '').split('/');
  return { name: parts[0] || '', arg: decodeURIComponent(parts[1] || ''), arg2: decodeURIComponent(parts[2] || ''), raw: raw };
}

/* Guard: never discard an in-progress quiz silently. */
function quizGuardOk() {
  if (state.quiz || state.gquiz || state.gtest) {
    return window.confirm('You have a quiz in progress. Leave now and lose your quiz progress?');
  }
  return true;
}

function go(view, arg) {
  if (!quizGuardOk()) return;
  /* Onboarding gate: no nickname or no level -> the only allowed destination
     is the onboarding flow (nickname modal, then the waiting/level view). */
  if (onboardingNeeded() && view !== 'waiting') view = 'waiting';
  const h = '#/' + view + (arg ? '/' + encodeURIComponent(arg) : '');
  if (window.location.hash === h) { onRoute(); }
  else { window.location.hash = h; }
}

/* ---- First-login onboarding gate (Fix 1) ----
   A first-time user must not reach any app view without BOTH a nickname and
   a level. enterApp() runs the nickname modal then the waiting view, but the
   tab bar / hash navigation could bypass them. These guards close every path:
   init() -> enterApp(), Google SSO return, page reload / PWA resume, deep
   links, and manual hash edits all funnel through onRoute()/go(). */
function onboardingNeeded() {
  const u = state.user;
  return !!(u && !u.demo && !u.isAdmin && (!u.displayName || !u.level));
}
function enforceOnboardingGate() {
  if (!onboardingNeeded()) return false;
  const u = state.user;
  /* Nickname comes first: make sure the blocking modal is up. It has no
     dismiss path (locked overlay, no close button), so the user can only
     continue by saving a valid nickname. */
  if (!u.displayName && !document.getElementById('app-modal')) {
    ensureNickname('').then(function () { onRoute(); }, function () { onRoute(); });
  }
  /* Park on the waiting (level picker) view; setChrome() hides the tab bar
     and header while the gate is active, so there is no other navigation. */
  if (state.view !== 'waiting') show('waiting');
  else setChrome();
  return true;
}

function onRoute() {
  /* Teacher portal: own path, own auth gate, own chrome. */
  if (isTeachersPath()) { renderTeachers(); return; }
  /* Dedicated admin panel: own path, own auth gate, own chrome. */
  if (isPanelPath()) { renderAdminPanel(); return; }
  document.body.classList.remove('ap-mode');
  document.body.classList.remove('tw-mode');
  const r = parseHash();
  /* Self-heal: the game player hides the tabbar; if the quiz state is gone
     (e.g. browser back), the tabbar must come back. */
  if (!state.quiz) document.body.classList.remove('duo-playing');
  // In-page landing anchors (e.g. #how-it-works) scroll, they are not routes.
  if (INPAGE_ANCHORS.indexOf(r.name) !== -1 && !state.user) {
    const el = document.getElementById(r.name);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  let view = r.name || 'landing';
  if (!state.user) {
    if (RETURN_VIEWS.indexOf(view) !== -1 && !r.arg) { saveReturnRoute(view); view = 'signup'; }
    else if (PUBLIC_VIEWS.indexOf(view) === -1) view = 'landing';
  } else {
    // Logged-in: onboarding gate first — no nickname/level means no app views.
    if (enforceOnboardingGate()) return;
    // Logged-in: learner views win.
    if (LEARNER_VIEWS.indexOf(view) === -1) {
      view = 'home';
      if (window.location.hash !== '#/home') { window.location.hash = '#/home'; return; }
    }
    if ((view === 'admin' || view === 'admin-teacher') && !state.user.isAdmin) view = 'home';
    /* Offer already resolved (e.g. browser Back after choosing) -> don't trap them here. */
    if (view === 'choose-teacher' && !state.user.isAdmin) {
      teacherOfferNeeded().then(function (needed) {
        if (!needed && parseHash().name === 'choose-teacher') go('home');
      }, function () {});
    }
    /* Deep link into a lesson tab, e.g. #/lesson/2026-10-09/quiz (quest links). */
    if (view === 'lesson' && r.arg2 && ['words', 'quiz', 'podcast', 'shadowing', 'grammar'].indexOf(r.arg2) !== -1) {
      state.lessonTab = r.arg2;
    }
  }
  /* Phase 2.8 (item 1): remember that this browser has entered an app
     route, so a later plain '/' visit opens the app instead of the
     landing. Cleared by doLogout() — after logout the landing returns. */
  if (view !== 'landing') {
    try { localStorage.setItem('muse_app_used', '1'); } catch (e) {}
  }
  show(view, r.arg);
}

function show(view, arg) {
  state.view = view;
  faSync();
  if (view !== 'admin-teacher') state.viewTeacher = null; /* leaving view-as-teacher mode */
  if (view !== 'lesson') { state.quiz = null; }
  if (view !== 'grammar') { state.gquiz = null; document.body.classList.remove('duo-playing'); }
  if (view !== 'grammar-test') { gtestStopTimer(); state.gtest = null; document.body.classList.remove('duo-playing'); }
  if (view !== 'ielts') { ieltsStopMedia(); }
  if (view !== 'vocab') { state.vquiz = null; document.body.classList.remove('duo-playing'); }
  if (view !== 'ptest') { if (state.ptest) { document.body.classList.remove('duo-playing'); } state.ptest = null; }
  /* Desktop home uses the mockup v6 dashboard layout. */
  document.body.classList.toggle('view-home', view === 'home');
  document.body.classList.toggle('view-grammar', view === 'grammar');
  document.body.classList.toggle('view-vocab', view === 'vocab');
  document.body.classList.toggle('view-words', view === 'words');
  document.body.classList.toggle('view-preview', view === 'preview');
  setChrome();
  paintWelcomeHeader();
  _wasDesktop = isDesktop();
  /* Stop any desktop-home podcast preview when leaving the view. */
  try { document.querySelectorAll('.dh-pl-audio').forEach(function (a) { a.pause(); }); } catch (e) {}
  const v = $('#view');
  window.scrollTo(0, 0);
  if (view === 'landing') renderLanding(v);
  else if (view === 'signin') renderSignin(v);
  else if (view === 'signup') renderSignup(v);
  else if (view === 'preview') renderPreview(v);
  else if (view === 'waiting') renderWaiting(v);
  else if (view === 'home') renderHome(v);
  else if (view === 'lesson') renderLesson(v, arg);
  else if (view === 'lessons') renderLessons(v);
  else if (view === 'scores') renderScores(v);
  else if (view === 'progress') renderScores(v); /* merged into Scores 2026-10-09 */
  else if (view === 'review') renderMistakes(v, arg);
  else if (view === 'profile') renderProfile(v);
  else if (view === 'challenge') renderChallenge(v);
  else if (view === 'inbox') renderInbox(v);
  else if (view === 'support') renderSupport(v);
  else if (view === 'homework') renderHomework(v);
  else if (view === 'admin') renderAdmin(v);
  else if (view === 'admin-teacher') renderAdminTeacherView(v, arg);
  else if (view === 'teacher') renderTeacher(v);
  else if (view === 'planner') renderPlanner(v);
  else if (view === 'become-teacher') renderBecomeTeacher(v);
  else if (view === 'choose-teacher') renderChooseTeacher(v);
  else if (view === 'grammar') renderGrammar(v, arg);
  else if (view === 'certificate') renderCertificate(v, arg);
  else if (view === 'grammar-test') renderGrammarTest(v, arg);
  else if (view === 'ielts') renderIelts(v, arg);
  else if (view === 'vocab') renderVocab(v, arg);
  else if (view === 'sentences') renderSentences(v, arg);
  else if (view === 'words') renderWords(v, arg);
  else if (view === 'tricky') renderTricky(v, arg);
  else if (view === 'ptest') renderPTest(v, arg);
}

/* ---------------- chrome (headers / profile menu / nav) ---------------- */
function setChrome() {
  const logged = !!state.user;
  /* While the onboarding gate is active the user must see ONLY the onboarding
     screens: hide the app header and tab bar so there is no way to navigate
     into the app without a nickname and a level. */
  const gating = onboardingNeeded() || state.view === 'choose-teacher';
  /* Phase 2.8: the static landing in index.html replaces #landing-header.
     The landing is shown/hidden by the app-mode class on <html>. */
  var lh = $('#landing-header');
  if (lh) lh.classList.toggle('hidden', logged || state.view === 'landing' || state.view === 'signin' || state.view === 'signup');
  $('#app-header').classList.toggle('hidden', !logged || gating);
  $('#tabbar').classList.toggle('hidden', !logged || gating);
  if (logged) {
    const initial = (state.user.email || '?').trim().charAt(0).toUpperCase();
    $('#profile-initial').textContent = initial;
    $$('#tabbar .tab').forEach(function (t) {
      const tv = t.getAttribute('data-view');
      // The lessons archive is a sub-page of Home: keep Home highlighted there.
      // Same for the grammar section and the grammar placement test (entered from the home banner).
      const active = tv === state.view || ((state.view === 'lessons' || state.view === 'grammar' || state.view === 'grammar-test' || state.view === 'ielts' || state.view === 'vocab' || state.view === 'sentences') && tv === 'home');
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.body.classList.add('logged-in');
  } else {
    document.body.classList.remove('logged-in');
    player.src = null;
    try { player.el.pause(); } catch (e) {}
    playerUI();
  }
}

