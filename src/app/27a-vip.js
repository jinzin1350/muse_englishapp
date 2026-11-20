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

function vipPriceHTML(fa, iran) {
  const amount = iran ? (fa ? '۱۹۹٬۰۰۰ تومان' : '199,000 Toman') : '$6.99';
  const perks = fa
    ? ['روزی ۳۰ سؤال از Muse', 'چت VIP و همهٔ امکانات ویژه', 'امکاناتی که بعداً اضافه بشن هم شامل می‌شن']
    : ['30 Ask Muse questions a day', 'VIP chat and every VIP feature', 'Future VIP features included'];
  return '<div class="vip-price">' +
    '<div class="vip-plan">' + esc(fa ? 'اشتراک ماهانهٔ VIP' : 'VIP monthly plan') + '</div>' +
    '<div class="vip-amount">' + esc(amount) + '</div>' +
    '<p class="vip-per">' + esc(fa ? 'در ماه' : 'per month') + '</p>' +
    '<ul class="vip-perks">' + perks.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
    '<a class="btn btn-orange btn-block" href="#/support" style="padding:0.9rem 1.1rem;font-size:1.05rem;margin-top:0.9rem">' + esc(fa ? 'فعال‌سازی VIP' : 'Activate VIP') + '</a>' +
    '<p class="muted" style="margin:0.6rem 0 0;font-size:0.85rem">' + esc(fa ? 'برای فعال‌سازی به پشتیبانی پیام بده.' : 'Message Support to activate.') + '</p>' +
  '</div>';
}

function paintVip(v) {
  const fa = vipFa();
  const u = state.user || {};
  const isVip = u.isVip === true;
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
      '<p>' + esc(fa ? 'همهٔ امکانات فعال و در حال اضافه شدن، اول برای تو باز می‌شن.' : 'Every feature — live and upcoming — unlocks for you first.') + '</p></div>'
    : vipPriceHTML(fa, vipIsIranPhone(u.phone)));
}

function renderVip(v) {
  paintVip(v);
  const u = state.user;
  if (u && u.isVip === undefined && u.id && !u.demo) {
    try {
      sb.from('profiles').select('is_vip').eq('id', u.id).single().then(function (pr) {
        if (pr && pr.data) {
          state.user.isVip = !!pr.data.is_vip;
          if (state.view === 'vip') paintVip(v);
        }
      }).catch(function () {});
    } catch (e) {}
  }
}
