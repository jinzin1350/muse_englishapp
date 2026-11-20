/* Muse VIP page (#/vip) — what VIP members get.
   Copy is bilingual inline (FA for fa UI, EN otherwise), same pattern as
   the Grammar Path / install guide. New labels reported to Alireza for
   Claude's fa-ui.js dictionary. */
function vipFa() { try { return uiLang() === 'fa'; } catch (e) { return false; } }

function vipFeatureHTML(icon, title, desc, badge) {
  return '<div class="card plain" style="display:flex;gap:0.85rem;align-items:flex-start">' +
    '<div style="font-size:1.7rem;line-height:1.2" aria-hidden="true">' + icon + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:800;font-size:1.05rem">' + esc(title) +
      (badge ? ' <span style="display:inline-block;background:#fff1e6;color:#e2630a;border:1px solid #f5c79b;border-radius:999px;padding:0.05rem 0.55rem;font-size:0.72rem;font-weight:700;vertical-align:middle">' + esc(badge) + '</span>' : '') +
      '</div>' +
      '<p class="muted" style="margin:0.3rem 0 0">' + esc(desc) + '</p>' +
    '</div></div>';
}

function paintVip(v) {
  const fa = vipFa();
  const u = state.user || {};
  const isVip = u.isVip === true;
  v.innerHTML =
  '<div style="background:linear-gradient(135deg,#f59e0b,#e2630a);border-radius:20px;padding:1.4rem 1.2rem;color:#fff;text-align:center;margin-bottom:1rem">' +
    '<div style="font-size:2.6rem;line-height:1" aria-hidden="true">👑</div>' +
    '<h1 style="margin:0.4rem 0 0.2rem;color:#fff">Muse VIP</h1>' +
    '<p style="margin:0;opacity:0.95">' + esc(fa ? 'تجربهٔ کامل Muse English' : 'The full Muse English experience') + '</p>' +
    (isVip
      ? '<p style="margin:0.7rem 0 0;font-weight:800">' + esc(fa ? '⭐ اشتراک VIP شما فعاله' : '⭐ Your VIP is active') + '</p>'
      : '') +
  '</div>' +

  '<div class="section-title"><h2>' + esc(fa ? 'امکانات VIP' : 'VIP features') + '</h2></div>' +

  vipFeatureHTML('🤖',
    fa ? 'از Muse بپرس — سؤال بیشتر' : 'Ask Muse — more questions',
    fa ? 'هر سؤالی دربارهٔ انگلیسی داری از Muse بپرس. با VIP روزی ۳۰ سؤال می‌تونی بپرسی؛ توی حالت عادی فقط ۱۰ سؤال در روز.'
       : 'Ask Muse anything about English. VIPs get 30 questions a day; the free limit is 10 a day.',
    '') +

  vipFeatureHTML('💬',
    fa ? 'چت با VIPها — پارتنر زبان' : 'VIP chat — language partners',
    fa ? 'از بین زبان‌آموزهای برتر چلنج یه پارتنر تمرین پیدا کن و باهاش چت کن. فقط VIPها می‌تونن به بقیه پیام بدن و جواب پیام‌ها رو بدن.'
       : 'Find a practice partner among the top learners in the Challenge and chat with them. Only VIPs can message other learners and reply.',
    fa ? 'به‌زودی' : 'Coming soon') +

  '<p class="muted" style="text-align:center;margin:1rem 0">' + esc(fa ? 'امکانات بیشتری برای VIP در راهه…' : 'More VIP features are on the way…') + '</p>' +

  (isVip
    ? '<div class="card plain" style="text-align:center"><p style="margin:0;font-weight:700">' + esc(fa ? '⭐ ممنون که VIP هستی!' : '⭐ Thanks for being VIP!') + '</p></div>'
    : '<a class="btn btn-orange btn-block" href="#/support" style="padding:0.9rem 1.1rem;font-size:1.02rem">' + esc(fa ? 'فعال‌سازی VIP' : 'Activate VIP') + '</a>' +
      '<p class="muted" style="text-align:center;margin-top:0.5rem">' + esc(fa ? 'برای فعال‌سازی VIP به پشتیبانی پیام بده.' : 'Message Support to activate VIP.') + '</p>');
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
