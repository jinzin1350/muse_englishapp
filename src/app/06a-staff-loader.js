
/* ---------------- staff code loader (2026-11-12, Claude) ----------------
   The teacher dashboard, the teacher portal (/teachers), the admin views and the
   admin panel (/manage) live in js/staff.js (built from src/staff/*.js by
   tools/build_app.py), so learners never download them. The first time one of
   those screens or actions is used, loadStaff() fetches js/staff.js and runs it
   here, inside the app's own scope, so it sees every helper exactly as before.
   tools/build_app.py adds a small stand-in for each staff entry point (see
   STAFF_ENTRIES there) that loads the file and then calls the real function. */
var __staffApi = null, __staffP = null;
var STAFF_JS_URL = '/js/staff.js?v=__STAFF_JS_V__';
function __evalStaff(__staffSrc) { eval(__staffSrc); }
function loadStaff() {
  if (__staffApi) return Promise.resolve(__staffApi);
  if (!__staffP) {
    __staffP = fetch(STAFF_JS_URL).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (code) {
      __evalStaff(code);
      if (!__staffApi) throw new Error('js/staff.js did not register');
      return __staffApi;
    }).catch(function (e) { __staffP = null; throw e; });
  }
  return __staffP;
}
function staffLoadFailed(err) {
  try { console.error('Could not load js/staff.js', err); } catch (e) {}
  var v = document.getElementById('view');
  if (!v) return;
  v.innerHTML = '<div class="card plain" style="margin:2rem auto;max-width:520px;text-align:center">' +
    '<p>Couldn’t load this page. Check your connection and try again.</p>' +
    '<button class="btn" type="button" data-staff-retry>Try again</button></div>';
  var b = v.querySelector('[data-staff-retry]');
  if (b) b.addEventListener('click', function () { window.location.reload(); });
}
/* Called by the generated stand-ins: run the real staff function, loading js/staff.js first if needed.
   If the learner moved to another screen while it loaded, a screen render is skipped. */
function callStaff(name, self, args) {
  if (__staffApi) return __staffApi[name].apply(self, args);
  var view0 = state.view;
  return loadStaff().then(function (api) {
    if (state.view !== view0) return;
    return api[name].apply(self, args);
  }, staffLoadFailed);
}
