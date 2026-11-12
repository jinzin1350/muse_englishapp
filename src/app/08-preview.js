/* Public sample lesson (#/preview), Persian, in the look of the /fa/ pages
   (redesign 2026-11-12, Claude for Alireza). Reached from "یک درس نمونه ببینید"
   on /fa/ and by anonymous app users. Shows a real recent lesson (review days
   skipped) for the level the visitor picks. Persian theme and level labels come
   from /data/fa/themes.json (written by seo/fa-pages/blog_fa.py). */
var PV_LV = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
var PV_NAV = [['/fa/', 'خانه'], ['/blog/', 'درس‌ها'], ['/blog/vocabulary/', 'لغت‌ها'], ['/blog/grammar/', 'گرامر'],
  ['/fa/ielts/', 'آیلتس'], ['/fa/mohajerat/', 'مهاجرت به کانادا'], ['/fa/az-sefr/', 'شروع از صفر']];
var PV_LVNAME = { a1: 'مبتدی', a2: 'مقدماتی', b1: 'متوسط', b2: 'بالاتر از متوسط', c1: 'پیشرفته', c2: 'تسلط کامل' };
var _pvLessons = {}, _pvFa = null;
function pvNum(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
function pvMedia(p) { p = String(p || ''); return (!p || /^(https?:)?\//.test(p)) ? p : '/' + p; }
function pvFaData() {
  if (_pvFa) return Promise.resolve(_pvFa);
  return fetch('/data/fa/themes.json').then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (d) { _pvFa = d || { themes: {}, levels: {} }; return _pvFa; });
}
function pvIsReview(m) { return m && (m.review === true || String(m.review).toLowerCase() === 'true'); }
async function pvLesson(lv) {
  if (_pvLessons[lv] !== undefined) return _pvLessons[lv];
  var d = new Date(), fallback = null;
  for (var i = 0; i < 10; i++) {
    try {
      var m = await fetchLesson(lv, fmtDate(d));
      if (!pvIsReview(m)) { _pvLessons[lv] = m; return m; }
      if (!fallback) fallback = m;
    } catch (e) { /* no lesson that day */ }
    d.setDate(d.getDate() - 1);
  }
  _pvLessons[lv] = fallback;
  return fallback;
}
function pvDate(s) {
  try {
    return new Intl.DateTimeFormat('fa-IR-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(s + 'T12:00:00'));
  } catch (e) { return pvNum(s || ''); }
}
function pvSlug(t) { return String(t || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

function pvHeaderHTML() {
  return '<header class="pv-nav"><div class="pv-wrap pv-nav-in">' +
    '<a class="pv-brand" href="/fa/"><img src="/icons/icon-192.png" alt="" width="34" height="34"><bdi>Muse English</bdi></a>' +
    '<nav class="pv-links" aria-label="منوی اصلی">' + PV_NAV.map(function (n) {
      return '<a href="' + n[0] + '">' + n[1] + '</a>';
    }).join('') + '</nav>' +
    '<div class="pv-acts"><a class="pv-alink" href="#/signin">ورود</a><a class="pv-btn pv-btn-sm" href="#/signup">شروع رایگان</a></div>' +
  '</div></header>';
}
function pvFooterHTML() {
  var lv = [['a1', 'مبتدی'], ['a2', 'مقدماتی'], ['b1', 'متوسط'], ['b2', 'بالاتر از متوسط'], ['c1', 'پیشرفته'], ['c2', 'تسلط کامل']];
  return '<footer class="pv-foot"><div class="pv-wrap pv-foot-grid">' +
    '<div class="pv-foot-col"><div class="pv-foot-brand"><img src="/icons/icon-192.png" alt=""><bdi>Muse English</bdi></div>' +
    '<p><a href="mailto:info@museenglishapp.com"><bdi>info@museenglishapp.com</bdi></a></p></div>' +
    '<div class="pv-foot-col"><h4>یادگیری</h4><ul><li><a href="/blog/">درس‌های روزانه</a></li><li><a href="/blog/vocabulary/">لغت‌ها بر اساس موضوع</a></li><li><a href="/blog/grammar/">راهنماهای گرامر</a></li></ul></div>' +
    '<div class="pv-foot-col"><h4>سطح‌ها</h4><ul>' + lv.map(function (l) {
      return '<li><a href="/blog/' + l[0] + '/"><bdi>' + l[0].toUpperCase() + '</bdi>، ' + l[1] + '</a></li>';
    }).join('') + '</ul></div>' +
    '<div class="pv-foot-col"><h4>صفحه‌های فارسی</h4><ul><li><a href="/fa/">صفحهٔ اصلی</a></li><li><a href="/fa/ielts/">آزمون آزمایشی آیلتس</a></li><li><a href="/fa/mohajerat/">مهاجرت به کانادا</a></li><li><a href="/fa/az-sefr/">شروع از صفر</a></li></ul></div>' +
    '<div class="pv-foot-col"><h4><bdi>Muse English</bdi></h4><ul><li><a href="/about/">دربارهٔ ما</a></li><li><a href="#/signin">ورود</a></li><li><a href="#/signup">ثبت‌نام رایگان</a></li></ul></div>' +
  '</div><div class="pv-wrap pv-foot-base">© ۲۰۲۶ <bdi>Muse English</bdi></div></footer>';
}
function pvStepHead(n, title, sub) {
  return '<div class="pv-head"><span class="pv-step" aria-hidden="true">' + pvNum(n) + '</span>' +
    '<div><h2>' + title + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div></div>';
}
function pvCoverHTML(m, fa) {
  var ph = (m.words || []).filter(function (w) { return w.photo; }).slice(0, 3);
  var th = (fa.themes || {})[String(m.theme || '').toLowerCase()] || '';
  var lv = normalizeLevel(m.level);
  return '<div class="pv-collage pv-n' + ph.length + '">' + ph.map(function (w, i) {
      return '<figure class="pv-tile pv-tile-' + i + '"><img src="' + esc(pvMedia(w.photo)) + '" alt="" loading="' + (i ? 'lazy' : 'eager') + '" onerror="this.parentNode.style.visibility=\'hidden\'">' +
        '<figcaption dir="ltr">' + esc(w.word) + '</figcaption></figure>';
    }).join('') + '</div>' +
    '<div class="pv-ticket">' +
      '<span class="pv-ticket-lv"><bdi>' + lv.toUpperCase() + '</bdi> ' + esc(PV_LVNAME[lv] || '') + '</span>' +
      '<b>' + (th ? esc(th) : '<span dir="ltr">' + esc(m.theme || '') + '</span>') + '</b>' +
      '<span class="pv-ticket-date">درس ' + esc(pvDate(m.date)) + '</span>' +
    '</div>';
}
function pvExampleHTML(e) {
  var t = String(e || ''), note = '';
  var mm = t.match(/\(([^()]*)\)\s*$/);
  if (mm) { note = mm[1]; t = t.slice(0, mm.index).trim(); }
  return '<li>' + esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*/g, '') +
    (note ? ' <span class="pv-gnote">' + esc(note) + '</span>' : '') + '</li>';
}
function pvBodyHTML(m) {
  var words = m.words || [], quiz = (m.quiz || []).slice(0, 3), g = m.grammar || null;
  var parts = [['pv-words', 'لغت‌ها']];
  if (m.podcast && m.podcast.audio) parts.push(['pv-podcast', 'پادکست']);
  if (m.shadowing && m.shadowing.audio) parts.push(['pv-shadow', 'تمرین تلفظ']);
  if (g && g.title) parts.push(['pv-grammar', 'گرامر']);
  if (quiz.length) parts.push(['pv-quiz', 'آزمون']);
  var step = {}; parts.forEach(function (p, i) { step[p[0]] = i + 1; });
  var h = '<nav class="pv-map" aria-label="بخش‌های این درس"><div class="pv-wrap"><span class="pv-map-t">این درس ' + pvNum(parts.length) + ' بخش دارد:</span><ol>' +
    parts.map(function (p, i) {
      return '<li><button type="button" data-pv-go="' + p[0] + '"><b>' + pvNum(i + 1) + '</b>' + p[1] + '</button></li>';
    }).join('') + '</ol></div></nav>';

  h += '<section class="pv-sec" id="pv-words"><div class="pv-wrap">' +
    pvStepHead(step['pv-words'], 'لغت‌های این درس', pvNum(words.length) + ' لغت با عکس، معنی فارسی و جملهٔ نمونه. روی بلندگو بزنید تا تلفظ را بشنوید.') +
    '<div class="pv-words" style="--pv-cols:' + Math.min(5, words.length <= 5 ? Math.max(words.length, 1) : Math.ceil(words.length / 2)) + '">' + words.map(function (w) {
      var say = w.word_audio
        ? '<button type="button" class="pv-say" data-action="play-track" data-src="' + esc(pvMedia(w.word_audio)) + '" data-title="' + esc(w.word) + '" aria-label="تلفظ ' + esc(w.word) + '">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg></button>'
        : '';
      return '<article class="pv-word">' +
        (w.photo ? '<div class="pv-ph"><img src="' + esc(pvMedia(w.photo)) + '" alt="' + esc(w.word) + '" loading="lazy" onerror="this.parentNode.remove()"></div>' : '') +
        '<div class="pv-wb"><div class="pv-wtop" dir="ltr"><span><b>' + esc(w.word) + '</b>' + (w.pos ? '<span class="pv-pos">' + esc(w.pos) + '</span>' : '') + '</span>' + say + '</div>' +
        (w.persian ? '<p class="pv-fa">' + esc(w.persian) + '</p>' : '<p class="pv-def" dir="ltr">' + esc(w.meaning || '') + '</p>') +
        (w.example ? '<p class="pv-ex" dir="ltr">' + esc(w.example) + '</p>' : '') +
        '</div></article>';
    }).join('') + '</div></div></section>';

  if (step['pv-podcast'] || step['pv-shadow']) {
    h += '<section class="pv-sec pv-sec-tint"><div class="pv-wrap pv-listen">';
    if (step['pv-podcast']) {
      h += '<div id="pv-podcast" class="pv-col">' + pvStepHead(step['pv-podcast'], 'پادکست', 'یک گفت‌وگوی کوتاه انگلیسی دربارهٔ موضوع درس، با همین لغت‌ها. متن کامل را هم می‌توانید بخوانید.') +
        '<div dir="ltr">' + audioCardHTML({ id: 'pv-podcast-card', src: pvMedia(m.podcast.audio), title: m.podcast.title || 'Podcast',
          speeds: false, download: false, transcript: m.podcast.transcript ? pvMedia(m.podcast.transcript) : null, fa: true }) + '</div></div>';
    }
    if (step['pv-shadow']) {
      h += '<div id="pv-shadow" class="pv-col">' + pvStepHead(step['pv-shadow'], 'تمرین تلفظ', 'هر جمله دو بار خوانده می‌شود. بعد از گوینده بلند تکرار کنید؛ سرعت را هم می‌توانید کم کنید.') +
        '<div dir="ltr">' + audioCardHTML({ id: 'pv-shadow-card', src: pvMedia(m.shadowing.audio), title: m.shadowing.title || 'Shadowing',
          speeds: true, download: false, transcript: m.shadowing.transcript ? pvMedia(m.shadowing.transcript) : null, fa: true }) + '</div></div>';
    }
    h += '</div></section>';
  }

  if (step['pv-grammar']) {
    var slug = pvSlug(g.title), faT = gFaTitle(slug);
    var guide = faT
      ? '<a class="pv-glink" href="/blog/grammar/' + esc(slug) + '/">راهنمای کامل این مبحث به فارسی: ' + esc(faT) + '</a>'
      : '<a class="pv-glink" href="/blog/grammar/">همهٔ راهنماهای گرامر به فارسی</a>';
    h += '<section class="pv-sec" id="pv-grammar"><div class="pv-wrap">' +
      pvStepHead(step['pv-grammar'], 'گرامر این درس', 'هر درس یک نکتهٔ گرامری دارد که در پادکست و جمله‌ها هم تکرار می‌شود.') +
      '<div class="pv-gram"><h3 dir="ltr">' + esc(g.title) + '</h3>' +
      ((g.examples || []).length ? '<ul class="pv-gex" dir="ltr">' + g.examples.slice(0, 4).map(pvExampleHTML).join('') + '</ul>' : '') +
      guide + '</div></div></section>';
  }

  if (quiz.length) {
    var rest = (m.quiz || []).length - quiz.length;
    h += '<section class="pv-sec pv-sec-tint" id="pv-quiz"><div class="pv-wrap">' +
      pvStepHead(step['pv-quiz'], 'آزمون کوتاه', 'سؤال‌های اول آزمون همین درس. جواب را انتخاب کنید تا درست یا غلط بودنش را ببینید.') +
      '<div class="pv-quiz">' + quiz.map(function (q, i) {
        return '<div class="pv-q" data-pv-q="' + i + '" data-answer="' + esc(q.answer) + '">' +
          '<p class="pv-qt" dir="ltr"><span class="pv-qn">' + (i + 1) + '</span>' + esc(q.question) + '</p>' +
          '<div class="pv-opts" dir="ltr">' + (q.options || []).map(function (o, j) {
            return '<button type="button" class="pv-opt" data-pv-opt="' + j + '">' + esc(o) + '</button>';
          }).join('') + '</div>' +
          '<p class="pv-qfb" role="status" aria-live="polite"></p></div>';
      }).join('') + '</div>' +
      (rest > 0 ? '<p class="pv-qmore">آزمون کامل این درس ' + pvNum((m.quiz || []).length) + ' سؤال دارد. با ثبت‌نام، امتیازتان ذخیره می‌شود و سؤال‌هایی که غلط جواب داده‌اید برای مرور برمی‌گردند.</p>' : '') +
      '</div></section>';
  }
  return h;
}
function pvPaint(lv) {
  var body = document.getElementById('pv-body'), cover = document.getElementById('pv-cover');
  if (!body) return;
  body.setAttribute('aria-busy', 'true');
  Promise.all([pvLesson(lv), pvFaData(), gFaIndex()]).then(function (r) {
    var m = r[0], fa = r[1];
    if (state.view !== 'preview' || !document.getElementById('pv-body')) return;
    var desc = document.getElementById('pv-lvdesc');
    if (desc) desc.textContent = ((fa.levels || {})[lv] || {}).desc || '';
    if (!m) {
      cover.innerHTML = '';
      body.innerHTML = '<div class="pv-wrap"><p class="pv-empty">درس این سطح الان در دسترس نیست. سطح دیگری را انتخاب کنید یا صفحه را دوباره باز کنید.</p></div>';
      body.removeAttribute('aria-busy');
      return;
    }
    cover.innerHTML = pvCoverHTML(m, fa);
    body.innerHTML = pvBodyHTML(m);
    body.removeAttribute('aria-busy');
    wireAudioCards(body);
    refreshTrackCards();
  });
}

/* Public read-only lesson preview (no login required). */
function renderPreview(v) {
  try { document.title = 'درس نمونهٔ رایگان انگلیسی | Muse English'; } catch (e) {}
  var lv = 'a2';
  try { var s = localStorage.getItem('muse_pv_lv'); if (PV_LV.indexOf(s) !== -1) lv = s; } catch (e) {}
  v.innerHTML = '<div class="pv" dir="rtl" lang="fa">' + pvHeaderHTML() +
    '<section class="pv-hero"><div class="pv-wrap pv-hero-grid">' +
      '<div class="pv-hero-text">' +
        '<span class="pv-badge">درس نمونه، بدون ثبت‌نام</span>' +
        '<h1>یک درس کامل را همین‌جا امتحان کنید</h1>' +
        '<p class="pv-lead">برای هر سطح هر روز یک درس تازه منتشر می‌شود. این یکی از درس‌های همین هفته است: لغت با عکس و معنی فارسی، پادکست، تمرین تلفظ، گرامر و آزمون.</p>' +
        '<div class="pv-pick"><span class="pv-pick-t" id="pv-pick-t">سطح خودتان را انتخاب کنید</span>' +
          '<div class="pv-chips" role="group" aria-labelledby="pv-pick-t">' + PV_LV.map(function (l) {
            return '<button type="button" class="pv-chip" data-pv-lv="' + l + '" aria-pressed="' + (l === lv) + '"><b dir="ltr">' + l.toUpperCase() + '</b><span>' + PV_LVNAME[l] + '</span></button>';
          }).join('') + '</div>' +
          '<p class="pv-lvdesc" id="pv-lvdesc"></p></div>' +
      '</div>' +
      '<div class="pv-cover" id="pv-cover"></div>' +
    '</div></section>' +
    '<div id="pv-body"><div class="pv-wrap"><p class="pv-empty">در حال آماده کردن درس…</p></div></div>' +
    '<section class="pv-cta"><div class="pv-wrap pv-cta-in"><div><h2>هر روز یک درس مثل این، در سطح خودتان</h2>' +
      '<p>کاملاً رایگان: اشتراک ماهانه ندارد و کارت بانکی هم لازم نیست.</p></div>' +
      '<div class="pv-cta-btns"><a class="pv-btn" href="#/signup">شروع رایگان</a><a class="pv-btn-ghost" href="#/signin">قبلاً ثبت‌نام کرده‌ام، ورود</a></div></div></section>' +
    pvFooterHTML() + '</div>';
  var root = v.querySelector('.pv');
  root.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    var chip = t.closest('[data-pv-lv]');
    if (chip) {
      var nl = chip.getAttribute('data-pv-lv');
      $$('[data-pv-lv]', root).forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
      try { localStorage.setItem('muse_pv_lv', nl); } catch (err) {}
      pvPaint(nl);
      return;
    }
    var go = t.closest('[data-pv-go]');
    if (go) {
      var el = document.getElementById(go.getAttribute('data-pv-go'));
      if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    var opt = t.closest('[data-pv-opt]');
    if (opt) {
      var q = opt.closest('[data-pv-q]');
      if (!q || q.classList.contains('pv-done')) return;
      var ans = +q.getAttribute('data-answer'), pick = +opt.getAttribute('data-pv-opt');
      q.classList.add('pv-done');
      $$('[data-pv-opt]', q).forEach(function (b) {
        var j = +b.getAttribute('data-pv-opt');
        b.disabled = true;
        if (j === ans) b.classList.add('pv-right');
        else if (j === pick) b.classList.add('pv-wrong');
      });
      var fb = q.querySelector('.pv-qfb'), right = q.querySelector('.pv-right');
      fb.innerHTML = pick === ans ? 'درست است!' : 'جواب درست: <b dir="ltr">' + esc(right ? right.textContent : '') + '</b>';
      fb.className = 'pv-qfb ' + (pick === ans ? 'pv-fb-ok' : 'pv-fb-no');
    }
  });
  pvPaint(lv);
}

