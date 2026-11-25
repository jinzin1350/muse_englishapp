/* ---------------- podcast & shadowing library (#/podcasts, #/shadowings) ----------------
   Claude, 2026-11-25, Alireza's order: every podcast and every shadowing story,
   by level, in two separate sections. Two home banners lead in (no tabs: tabs
   may confuse learners), plus a link at the end of a lesson's Podcast and
   Shadowing tabs. The list comes from data/library/<level>.json, which
   tools/build_app.py builds from lessons/<level>/*.json on every deploy.
   Tapping an item opens that lesson on its Podcast / Shadowing tab, so the
   normal player, points and progress apply.
   Events: library_open {kind, level, own}, library_play {kind, level, date, own}. */

var LIB_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
var LIB_FA_LEVEL = { a1: 'مبتدی', a2: 'مقدماتی', b1: 'متوسط', b2: 'بالاتر از متوسط', c1: 'پیشرفته', c2: 'تسلط کامل' };
var _libCache = {};

function libFa() { try { return uiLang() === 'fa'; } catch (e) { return false; } }
function libUserLevel() {
  var l = normalizeLevel((state.user && state.user.level) || '');
  return LIB_LEVELS.indexOf(l) >= 0 ? l : 'b1';
}
function libView(kind) { return kind === 'podcast' ? 'podcasts' : 'shadowings'; }

/* Two home banners (mobile .hm-card / desktop .g-banner, like the other home banners). */
function libraryBannersHTML() {
  var fa = libFa();
  var card = function (href, ico, kicker, title, sub, btn) {
    var dir = ' data-fa-skip' + (fa ? ' dir="rtl" lang="fa"' : '');
    if (!isDesktop()) {
      return '<a class="hm-card lib-banner" href="' + href + '"' + dir + '><span class="hm-icon">' + ico + '</span>' +
        '<span class="hm-main"><span class="hm-kicker">' + kicker + '</span><span class="hm-title">' + title + '</span>' +
        '<span class="hm-subtxt">' + sub + '</span></span><span class="hm-btn hm-btn-soft">' + btn + '</span></a>';
    }
    return '<a class="g-banner lib-banner" href="' + href + '"' + dir + '><span class="g-b-icon">' + ico + '</span>' +
      '<span class="g-b-main"><b>' + title + '</b><span>' + sub + '</span></span><span class="g-b-cta">' + btn + '</span></a>';
  };
  return fa
    ? card('#/podcasts', '🎧', 'گوش دادن', 'همهٔ پادکست‌ها', 'مکالمه‌های کوتاه، به تفکیک سطح', 'گوش بده ←') +
      card('#/shadowings', '🎤', 'صحبت کردن', 'همهٔ شدوئینگ‌ها', 'تکرار جمله‌ها و تمرین تلفظ، به تفکیک سطح', 'تمرین ←')
    : card('#/podcasts', '🎧', 'Listen', 'All podcasts', 'Short conversations, by level', 'Listen →') +
      card('#/shadowings', '🎤', 'Speak', 'All shadowing', 'Repeat sentences, practise pronunciation, by level', 'Practise →');
}

/* Link at the end of a lesson's Podcast / Shadowing tab. */
function libraryTabLinkHTML(kind) {
  var fa = libFa(), pod = kind === 'podcast';
  return '<a class="lib-more" href="#/' + libView(kind) + '" data-fa-skip' + (fa ? ' dir="rtl" lang="fa"' : '') + '>' +
    '<span class="lib-more-ico">' + (pod ? '🎧' : '🎤') + '</span><span class="lib-more-txt"><b>' +
    (pod ? (fa ? 'همهٔ پادکست‌ها' : 'All podcasts') : (fa ? 'همهٔ شدوئینگ‌ها' : 'All shadowing')) + '</b><small>' +
    (fa ? 'همهٔ قسمت‌های قبلی، جدا شده بر اساس سطح' : 'Every earlier one, sorted by level') + '</small></span>' +
    '<span class="lib-go" aria-hidden="true">›</span></a>';
}

function libLoad(lv) {
  if (_libCache[lv]) return Promise.resolve(_libCache[lv]);
  return fetch('data/library/' + lv + '.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('library ' + r.status);
    return r.json();
  }).then(function (list) { _libCache[lv] = list; return list; });
}
function libDate(d, fa) {
  if (d === todayStr()) return fa ? 'امروز' : 'Today';
  try {
    var dt = new Date(d + 'T12:00:00');
    return fa ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long' }).format(dt)
              : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return d; }
}

function renderLibrary(v, kind, arg) {
  var fa = libFa(), pod = kind === 'podcast';
  var own = libUserLevel();
  var lv = (arg && LIB_LEVELS.indexOf(String(arg).toLowerCase()) >= 0) ? String(arg).toLowerCase() : (state.libLevel || own);
  state.libLevel = lv;
  var T = function (f, e) { return fa ? f : e; };
  var chips = LIB_LEVELS.map(function (l) {
    return '<button class="lib-chip' + (l === lv ? ' on' : '') + '" data-lib-level="' + l + '" aria-pressed="' + (l === lv) + '">' +
      '<b dir="ltr">' + l.toUpperCase() + '</b>' + (fa ? '<span>' + LIB_FA_LEVEL[l] + '</span>' : '') +
      (l === own ? '<i>' + T('سطح تو', 'your level') + '</i>' : '') + '</button>';
  }).join('');
  v.innerHTML = '<div class="lib" data-fa-skip' + (fa ? ' dir="rtl" lang="fa"' : '') + '>' +
    '<a class="lib-back" href="#/home">' + T('→ خانه', '← Home') + '</a>' +
    '<h1 class="lib-title">' + (pod ? '🎧 ' + T('همهٔ پادکست‌ها', 'All podcasts') : '🎤 ' + T('همهٔ شدوئینگ‌ها', 'All shadowing')) + '</h1>' +
    '<p class="lib-sub">' + (pod
      ? T('مکالمه‌های کوتاه انگلیسی. سطحت رو انتخاب کن و هر کدوم رو خواستی گوش بده.', 'Short English conversations. Pick a level and listen to any of them.')
      : T('داستان‌های کوتاه که جمله‌به‌جمله تکرارشون می‌کنی و تلفظت رو تمرین می‌کنی. سطحت رو انتخاب کن و شروع کن.', 'Short stories you repeat sentence by sentence to practise your pronunciation. Pick a level and start.')) + '</p>' +
    '<div class="lib-chips" role="group" aria-label="' + T('سطح', 'Level') + '">' + chips + '</div>' +
    '<div class="lib-list" id="lib-list"><div class="empty">' + T('در حال بارگذاری…', 'Loading…') + '</div></div></div>';
  window.scrollTo(0, 0);
  try { trackEvent('library_open', { kind: kind, level: lv, own: lv === own ? 1 : 0 }); } catch (e) {}

  v.querySelector('.lib-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-lib-level]');
    if (b) go(libView(kind), b.getAttribute('data-lib-level'));
  });
  var listEl = v.querySelector('#lib-list');
  var paint = function (list) {
    if (state.view !== libView(kind) || state.libLevel !== lv) return;
    var items = list.filter(function (x) { return pod ? x.p : x.s; });
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">' + (pod ? T('برای این سطح هنوز پادکستی نداریم.', 'No podcasts for this level yet.')
        : T('برای این سطح هنوز شدوئینگی نداریم.', 'No shadowing for this level yet.')) + '</div>';
      return;
    }
    listEl.innerHTML = '<p class="lib-count">' + (fa ? faNum(items.length) + (pod ? ' پادکست' : ' شدوئینگ') : items.length + (pod ? ' podcasts' : ' stories')) + '</p>' +
      items.map(function (x) {
        var done = false;
        if (lv === own) { try { done = !!(getDayProgress(x.d) || {})[pod ? 'podcast' : 'shadowing']; } catch (e) {} }
        var title = (pod ? x.p : x.s).replace(/^Muse English:\s*/i, '');
        var theme = fa ? (x.tf || x.t) : x.t;
        return '<button class="lib-row' + (done ? ' is-done' : '') + '" data-lib-open="' + esc(x.d) + '">' +
          '<span class="lib-ico" aria-hidden="true">' + (done ? '✓' : (pod ? '🎧' : '🎤')) + '</span>' +
          '<span class="lib-main"><span class="lib-name" dir="ltr" lang="en">' + esc(title) + '</span>' +
          '<span class="lib-meta">' + esc(theme) + ' · ' + esc(libDate(x.d, fa)) +
          (done ? ' · ' + (pod ? T('گوش دادی', 'listened') : T('تمرین کردی', 'practised')) : '') + '</span></span>' +
          '<span class="lib-go" aria-hidden="true">›</span></button>';
      }).join('');
  };
  var fail = function () {
    if (state.view !== libView(kind)) return;
    listEl.innerHTML = '<div class="empty">' + T('فهرست باز نشد. اینترنتت رو چک کن و دوباره امتحان کن.', 'The list didn’t load. Check your connection and try again.') +
      '<br><button class="btn btn-ghost" data-lib-retry style="margin-top:10px">' + T('دوباره امتحان کن', 'Try again') + '</button></div>';
  };
  listEl.addEventListener('click', function (e) {
    if (e.target.closest('[data-lib-retry]')) { delete _libCache[lv]; listEl.innerHTML = '<div class="empty">…</div>'; libLoad(lv).then(paint, fail); return; }
    var b = e.target.closest('[data-lib-open]');
    if (b) libOpen(kind, lv, b.getAttribute('data-lib-open'), b);
  });
  libLoad(lv).then(paint, fail);
}

/* Leaving the lesson view after playing another level's episode: put the learner's
   own lesson back, so Learn / today's buttons don't land on the other level. */
function libLeaveLesson() {
  if (!state._libForeign) return;
  state._libForeign = false;
  if (state.lessons && state.lessons.length) { state.lesson = state.lessons[0]; state.lessonTab = 'words'; }
}

async function libOpen(kind, lv, date, btn) {
  var own = libUserLevel();
  var m = null;
  if (lv === own) m = (state.lessons || []).find(function (x) { return x.date === date; }) || null;
  if (!m) {
    if (btn) btn.classList.add('is-loading');
    try { m = await fetchLesson(lv, date); } catch (e) { m = null; }
    if (btn) btn.classList.remove('is-loading');
  }
  if (!m) {
    if (btn) { var meta = btn.querySelector('.lib-meta'); if (meta) meta.textContent = libFa() ? 'باز نشد. دوباره امتحان کن.' : 'Couldn’t open it. Try again.'; }
    return;
  }
  try { trackEvent('library_play', { kind: kind, level: lv, date: date, own: lv === own ? 1 : 0 }); } catch (e) {}
  state.lesson = m;
  state._libForeign = lv !== own;
  state.lessonTab = kind === 'podcast' ? 'podcast' : 'shadowing';
  /* Own level: the dated route (state.lessons has it). Another level: plain #/lesson,
     because a dated route would swap in the learner's own-level lesson of that day. */
  if (lv === own && (state.lessons || []).some(function (x) { return x.date === date; })) go('lesson', date);
  else go('lesson');
}
