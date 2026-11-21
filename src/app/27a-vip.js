/* Muse VIP landing page (#/vip) — premium dark/gold hero + feature grid.
   Copy is bilingual inline (FA for fa UI, EN otherwise), same pattern as
   the Grammar Path / install guide. New labels reported to Alireza for
   Claude's fa-ui.js dictionary. Styles: .vip-* in css/main.css. */
function vipFa() { try { return uiLang() === 'fa'; } catch (e) { return false; } }

function vipFeatureHTML(icon, tint, title, desc, badge, badgeKind) {
  return '<div class="vip-card">' +
    '<div class="vip-ico vip-t-' + tint + '" aria-hidden="true">' + icon + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<h3>' + esc(title) +
      (badge ? '<span class="vip-badge ' + badgeKind + '">' + esc(badge) + '</span>' : '') +
      '</h3>' +
      '<p>' + esc(desc) + '</p>' +
    '</div></div>';
}

/* Pricing region comes ONLY from the profile phone (never IP — VPNs make
   IP useless for this). Iran: +98 / 0098 / 989… / 09xxxxxxxxx numbers.
   Anything else (or no phone yet) gets the international price. */
function vipIsIranPhone(phone) {
  if (!phone) return false;
  var p = String(phone)
    .replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); })
    .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
    .replace(/[\s\-()]/g, '');
  if (p.indexOf('+98') === 0 || p.indexOf('0098') === 0) return true;
  if (/^09\d{9}$/.test(p)) return true;
  if (/^989\d{9}$/.test(p)) return true;
  return false;
}

function vipAmount(fa, iran) {
  return iran ? (fa ? '۱۹۹٬۰۰۰ تومان' : '199,000 Toman') : '$6.99';
}

function renderVip(v) {
  paintVip(v);
  const u = state.user || {};
  if (u.isVip === undefined && sb && u.id) {
    try {
      sb.from('profiles').select('is_vip').eq('id', u.id).single().then(function (r) {
        if (r && r.data) {
          state.user.isVip = !!r.data.is_vip;
          if (state.view === 'vip') paintVip(document.getElementById('view'));
        }
      }).catch(function () {});
    } catch (e) {}
  }
}

function paintVip(v) {
  const fa = vipFa();
  const u = state.user || {};
  const isVip = u.isVip === true;
  const iran = vipIsIranPhone(u.phone);
  const soon = fa ? 'به‌زودی' : 'Coming soon';
  v.innerHTML =
  '<div class="vip-hero">' +
    '<div class="vip-crown" aria-hidden="true">👑</div>' +
    '<h1>Muse <span class="vip-gold">VIP</span></h1>' +
    '<p class="vip-herotag">' + esc(fa ? 'تجربهٔ کامل Muse English — همهٔ امکانات، بدون محدودیت' : 'The full Muse English experience — every feature, no limits') + '</p>' +
    '<div class="vip-chips">' +
      '<span class="vip-chip">' + esc(fa ? '🤖 روزی ۳۰ سؤال از Muse' : '🤖 30 Ask Muse questions a day') + '</span>' +
      '<span class="vip-chip">' + esc(fa ? '💬 چت با زبان‌آموزها' : '💬 Learner chat') + '</span>' +
      '<span class="vip-chip">' + esc(fa ? '❤️ قلب نامحدود' : '❤️ Unlimited hearts') + '</span>' +
    '</div>' +
    (isVip ? '<div><span class="vip-active-pill">' + esc(fa ? '⭐ اشتراک VIP شما فعاله' : '⭐ Your VIP is active') + '</span></div>' : '') +
  '</div>' +

  '<div class="vip-sec-title"><h2>' + esc(fa ? 'امکانات VIP' : 'VIP features') + '</h2></div>' +
  '<div class="vip-grid">' +

  vipFeatureHTML('🤖', 'violet',
    fa ? 'از Muse بپرس — سؤال بیشتر' : 'Ask Muse — more questions',
    fa ? 'هر سؤالی دربارهٔ انگلیسی داری از Muse بپرس. با VIP روزی ۳۰ سؤال می‌تونی بپرسی؛ توی حالت عادی فقط ۱۰ سؤال در روز.'
       : 'Ask Muse anything about English. VIPs get 30 questions a day; the free limit is 10 a day.',
    fa ? 'فعال' : 'Live', 'live') +

  vipFeatureHTML('💬', 'sky',
    fa ? 'چت با VIPها — پارتنر زبان' : 'VIP chat — language partners',
    fa ? 'از بین زبان‌آموزهای برتر چلنج یه پارتنر تمرین پیدا کن و باهاش چت کن. فقط VIPها می‌تونن به بقیه پیام بدن و جواب پیام‌ها رو بدن.'
       : 'Find a practice partner among the top learners in the Challenge and chat with them. Only VIPs can message other learners and reply.',
    soon, 'soon') +

  vipFeatureHTML('❤️', 'rose',
    fa ? 'قلب نامحدود' : 'Unlimited hearts',
    fa ? 'با VIP قلب‌هات تموم نمی‌شن؛ هر چقدر اشتباه کنی، درس و تمرین همیشه برات بازه.'
       : 'With VIP your hearts never run out — make as many mistakes as you like, lessons and practice always stay open.',
    soon, 'soon') +

  vipFeatureHTML('📥', 'teal',
    fa ? 'دانلود آفلاین درس‌ها' : 'Offline lesson downloads',
    fa ? 'پادکست و شدویینگ هر درس رو دانلود کن و بدون اینترنت گوش بده — توی راه، توی مترو، هر جا.'
       : 'Download each lesson’s podcast and shadowing audio and listen offline — on the road, on the subway, anywhere.',
    soon, 'soon') +

  vipFeatureHTML('🧊', 'ice',
    fa ? 'محافظ استریک' : 'Streak protection',
    fa ? 'یه روز درس جا بیفته، استریکت نمی‌سوزه؛ VIP محافظ‌های بیشتری برای نگه داشتن زنجیره‌ت داره.'
       : 'Miss a day and your streak survives — VIPs get extra freezes to protect their chain.',
    soon, 'soon') +

  vipFeatureHTML('✍️', 'gold',
    fa ? 'بازخورد رایتینگ آیلتس' : 'IELTS writing feedback',
    fa ? 'رایتینگ‌های تمرین آیلتس‌ت رو بفرست و بازخورد و نمرهٔ تقریبی بگیر تا بدونی کجای کاری.'
       : 'Submit your IELTS practice writing and get feedback with an estimated band, so you know where you stand.',
    soon, 'soon') +

  vipFeatureHTML('📊', 'green',
    fa ? 'گزارش پیشرفت پیشرفته' : 'Advanced progress report',
    fa ? 'نمودار کامل پیشرفت، تحلیل نقاط قوت و ضعف و اینکه دقیقاً روی چی باید تمرکز کنی.'
       : 'Full progress charts, a breakdown of your strengths and weak spots, and exactly what to focus on next.',
    soon, 'soon') +

  vipFeatureHTML('🚀', 'orange',
    fa ? 'پشتیبانی اولویت‌دار' : 'Priority support',
    fa ? 'سؤال یا مشکلی داشتی، پیام VIPها اول صف جواب می‌گیرن.'
       : 'Questions or problems? VIP messages jump to the front of the support queue.',
    soon, 'soon') +

  '</div>' +

  (isVip
    ? '<div class="vip-member"><h2>' + esc(fa ? '⭐ ممنون که VIP هستی!' : '⭐ Thanks for being VIP!') + '</h2>' +
      '<p>' + esc(fa ? 'همهٔ امکانات فعال و در حال اضافه شدن، اول برای تو باز می‌شن.' : 'Every feature — live and upcoming — unlocks for you first.') + '</p>' +
      '<p style="margin:.4rem 0 0;font-weight:800">' + esc((fa ? 'پلن شما: ماهانه ' : 'Your plan: ') + vipAmount(fa, iran) + (fa ? '' : ' / month')) + '</p></div>'
    : '') +
    '<h2 class="vip-sec-title">' + esc(fa ? 'تعرفه‌ها' : 'Pricing') + '</h2>' +
    '<div class="prc-single">' + prcCardHTML(fa, iran, isVip) + '</div>' +
    '<p class="muted" style="text-align:center;margin-top:.9rem;font-size:.88rem">' + esc(fa ? 'قیمت بر اساس شماره تلفنت مشخص می‌شه؛ پرداخت آنلاین به‌زودی وصل می‌شه و فعلاً فعال‌سازی از پشتیبانیه.' : 'Your price follows your phone number. Online payment is coming soon; activation is via Support for now.') + '</p>' +
    vipCompareHTML(fa);
}

/* ---------- Pricing section on the VIP page: both tariffs, the user's
   own plan (by profile phone, never IP) highlighted, Free vs VIP table. ---------- */
/* ONE price card: the visitor sees ONLY their own region's price —
   Iran phone → Toman, any other phone → USD. Never both. */
function prcCardHTML(fa, iranCard, isVip) {
  const note = iranCard
    ? (fa ? 'برای شماره تلفن ایران (‎+98)' : 'For Iran phone numbers (+98)')
    : (fa ? 'برای شماره تلفن خارج از ایران' : 'For phone numbers outside Iran');
  return '<div class="prc-card mine">' +
    '<div class="prc-region">' + esc(fa ? 'اشتراک ماهانهٔ VIP' : 'VIP monthly plan') + '</div>' +
    '<div class="prc-amount">' + esc(vipAmount(fa, iranCard)) + '</div>' +
    '<p class="prc-per">' + esc(fa ? 'در ماه' : 'per month') + '</p>' +
    (!isVip
      ? '<a class="btn btn-orange btn-block" href="#/support" style="padding:0.9rem 1.1rem;font-size:1.05rem;margin-top:1rem">' + esc(fa ? 'فعال‌سازی VIP' : 'Activate VIP') + '</a>'
      : '') +
    '<p class="prc-note">' + esc(note) + '</p>' +
  '</div>';
}

function vipCompareHTML(fa) {
  const yes = '<span class="prc-yes">✓</span>';
  const no = '<span class="prc-no">—</span>';
  const rows = fa ? [
    ['سؤال از Muse', '۱۰ در روز', '۳۰ در روز'],
    ['چت VIP (پارتنر زبان)', null, 'yes'],
    ['قلب', 'محدود', 'نامحدود'],
    ['دانلود آفلاین درس‌ها', null, 'yes'],
    ['محافظ استریک', null, 'yes'],
    ['بازخورد رایتینگ آیلتس', null, 'yes'],
    ['گزارش پیشرفت پیشرفته', null, 'yes'],
    ['پشتیبانی اولویت‌دار', null, 'yes']
  ] : [
    ['Ask Muse questions', '10 / day', '30 / day'],
    ['VIP chat (language partner)', null, 'yes'],
    ['Hearts', 'Limited', 'Unlimited'],
    ['Offline lesson downloads', null, 'yes'],
    ['Streak protection', null, 'yes'],
    ['IELTS writing feedback', null, 'yes'],
    ['Advanced progress report', null, 'yes'],
    ['Priority support', null, 'yes']
  ];
  return '<h2 class="vip-sec-title">' + esc(fa ? 'مقایسهٔ پلن‌ها' : 'Compare plans') + '</h2>' +
    '<div class="prc-cmp">' +
    '<div class="prc-row"><div class="prc-f"></div><div class="prc-v">' + esc(fa ? 'رایگان' : 'Free') + '</div><div class="prc-v">VIP 👑</div></div>' +
    rows.map(function (r) {
      return '<div class="prc-row"><div class="prc-f">' + esc(r[0]) + '</div>' +
        '<div class="prc-v">' + (r[1] ? esc(r[1]) : no) + '</div>' +
        '<div class="prc-v">' + (r[2] === 'yes' ? yes : esc(r[2])) + '</div></div>';
    }).join('') + '</div>';
}
