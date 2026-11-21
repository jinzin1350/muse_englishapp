/* =====================================================================
   VIP chat — «پارتنر زبان» (src/app/27b-vip-chat.js)
   VIP members find an opted-in language partner, send a chat request
   (max 3/day, enforced server-side), and chat 1:1 once accepted.
   All data flows through the chat_* RPCs (migration:
   your_files/vip-chat-migration.sql). Until that migration runs, the
   page degrades to a friendly "launching soon" state.
   Transport is polling only — the /sb Iran proxy has no realtime.
   ===================================================================== */

let chtTimer = null;
let chtPartnerId = null;
let chtLastSig = '';

function chtFa() { return uiLang() === 'fa'; }

function chtStopPoll() {
  if (chtTimer) { clearInterval(chtTimer); chtTimer = null; }
  chtPartnerId = null;
  chtLastSig = '';
}

async function chtRpc(name, args) {
  try {
    const r = await sb.rpc(name, args || {});
    if (r && r.error) return { ok: false, error: r.error };
    return { ok: true, data: r ? r.data : null };
  } catch (e) { return { ok: false, error: e }; }
}

function chtAvatar(name) {
  const ch = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
  return '<div class="cht-av">' + esc(ch) + '</div>';
}

function chtLvl(level) {
  return level ? ' <span class="cht-lvl">' + esc(String(level).toUpperCase()) + '</span>' : '';
}

function chtSoonHTML(fa) {
  return '<div class="vip-hero"><div class="vip-crown">💬</div>' +
    '<h1>' + esc(fa ? 'چت VIP' : 'VIP Chat') + '</h1>' +
    '<p class="vip-sub">' + esc(fa ? 'پارتنر زبان به‌زودی فعال می‌شه — داریم آماده‌ش می‌کنیم!' : 'Language-partner chat is launching very soon — we are setting it up!') + '</p></div>';
}

function renderChatRoute(v, arg) {
  document.body.classList.add('cht-open');
  if (arg) renderChatThread(v, arg);
  else renderChat(v);
}

/* ---------------- partner list / requests ---------------- */

async function renderChat(v) {
  chtStopPoll();
  const fa = chtFa();
  v.innerHTML = '<p class="muted" style="text-align:center;margin-top:2rem">' + esc(fa ? 'در حال بارگذاری…' : 'Loading…') + '</p>';
  const st = await chtRpc('chat_my_state');
  if (!st.ok || !st.data || st.data.error) { v.innerHTML = chtSoonHTML(fa); return; }
  const me = st.data;
  const reqs = await chtRpc('chat_list_requests');
  const convs = await chtRpc('chat_list_conversations');
  const blocked = await chtRpc('chat_list_blocked');
  const dir = me.is_vip ? await chtRpc('chat_directory') : { ok: true, data: [] };
  paintChat(v, me, reqs.data || [], convs.data || [], dir.data || [], blocked.data || []);
}

function paintChat(v, me, reqs, convs, dir, blocked) {
  const fa = chtFa();
  const inReqs = reqs.filter(function (r) { return r.direction === 'in'; });
  const outReqs = reqs.filter(function (r) { return r.direction === 'out'; });

  let h = '<div class="vip-hero"><div class="vip-crown">💬</div>' +
    '<h1>' + esc(fa ? 'چت VIP' : 'VIP Chat') + '</h1>' +
    '<p class="vip-sub">' + esc(fa ? 'یه پارتنر زبان پیدا کن و هر روز با هم انگلیسی تمرین کنین.' : 'Find a language partner and practise English together every day.') + '</p></div>';

  h += '<div id="cht-note" class="muted" style="text-align:center;margin-top:.7rem"></div>';

  /* non-VIP upsell */
  if (!me.is_vip) {
    h += '<div class="vip-price" style="margin-top:1rem"><div style="font-size:2rem">👑</div>' +
      '<p style="font-weight:800;margin:.4rem 0">' + esc(fa ? 'چت پارتنر زبان مخصوص اعضای VIP ـه' : 'Partner chat is for VIP members') + '</p>' +
      '<p class="muted" style="margin:0 0 .8rem">' + esc(fa ? 'با VIP می‌تونی درخواست چت بفرستی، درخواست‌ها رو قبول کنی و پیام بدی.' : 'With VIP you can send requests, accept them and exchange messages.') + '</p>' +
      '<a class="btn btn-orange btn-block" href="#/vip">' + esc(fa ? 'دیدن VIP' : 'See VIP') + '</a></div>';
  }

  /* incoming requests */
  if (inReqs.length) {
    h += '<h2 class="vip-sec-title">' + esc(fa ? 'درخواست‌های جدید' : 'New requests') + '</h2>';
    h += inReqs.map(function (r) {
      return '<div class="cht-row">' + chtAvatar(r.other_name) +
        '<div style="flex:1;min-width:0"><span class="cht-name">' + esc(r.other_name || '') + '</span>' + chtLvl(r.other_level) +
        '<div class="cht-meta">' + esc(fa ? 'می‌خواد باهات چت کنه' : 'Wants to chat with you') + '</div></div>' +
        (me.is_vip
          ? '<button class="btn btn-orange btn-sm" data-resp="' + r.request_id + '" data-acc="1">' + esc(fa ? 'قبول' : 'Accept') + '</button>' +
            '<button class="btn btn-ghost btn-sm" data-resp="' + r.request_id + '" data-acc="0">' + esc(fa ? 'رد' : 'Decline') + '</button>'
          : '<a class="btn btn-orange btn-sm" href="#/vip">' + esc(fa ? 'قبول با VIP' : 'Accept with VIP') + '</a>') +
      '</div>';
    }).join('');
  }

  /* outgoing pending */
  if (outReqs.length) {
    h += '<h2 class="vip-sec-title">' + esc(fa ? 'درخواست‌های فرستاده‌شده' : 'Sent requests') + '</h2>';
    h += outReqs.map(function (r) {
      return '<div class="cht-row">' + chtAvatar(r.other_name) +
        '<div style="flex:1;min-width:0"><span class="cht-name">' + esc(r.other_name || '') + '</span>' + chtLvl(r.other_level) +
        '<div class="cht-meta">' + esc(fa ? 'در انتظار جواب…' : 'Waiting for a reply…') + '</div></div>' +
        '<span class="cht-chip">' + esc(fa ? 'ارسال شد' : 'Sent') + '</span></div>';
    }).join('');
  }

  /* conversations */
  h += '<h2 class="vip-sec-title">' + esc(fa ? 'گفتگوها' : 'Chats') + '</h2>';
  if (convs.length) {
    h += convs.map(function (c) {
      return '<a class="cht-row" href="#/chat/' + c.partner_id + '" style="text-decoration:none;color:inherit">' + chtAvatar(c.partner_name) +
        '<div style="flex:1;min-width:0"><span class="cht-name">' + esc(c.partner_name || '') + '</span>' + chtLvl(c.partner_level) +
        '<div class="cht-meta cht-snippet">' + esc(c.last_body || (fa ? 'هنوز پیامی نیست — سلام کن!' : 'No messages yet — say hi!')) + '</div></div>' +
        (c.unread > 0 ? '<span class="cht-badge">' + c.unread + '</span>' : '') +
      '</a>';
    }).join('');
  } else {
    h += '<p class="muted" style="text-align:center">' + esc(fa ? 'هنوز گفتگویی نداری. از لیست پایین یه پارتنر پیدا کن.' : 'No chats yet. Find a partner in the list below.') + '</p>';
  }

  /* directory (VIP only) */
  if (me.is_vip) {
    h += '<h2 class="vip-sec-title">' + esc(fa ? 'پیدا کردن پارتنر' : 'Find a partner') + '</h2>';
    if (dir.length) {
      h += dir.map(function (d) {
        let action;
        if (d.req_state === 'pending_out') action = '<span class="cht-chip">' + esc(fa ? 'درخواست فرستاده شد' : 'Request sent') + '</span>';
        else if (d.req_state === 'pending_in') action = '<span class="cht-chip">' + esc(fa ? 'بهت درخواست داده' : 'Requested you') + '</span>';
        else action = '<button class="btn btn-orange btn-sm" data-reqto="' + d.user_id + '">' + esc(fa ? 'درخواست چت' : 'Request chat') + '</button>';
        return '<div class="cht-row">' + chtAvatar(d.display_name) +
          '<div style="flex:1;min-width:0"><span class="cht-name">' + esc(d.display_name || '') + '</span>' + chtLvl(d.level) +
          (d.is_vip ? ' <span class="cht-lvl" style="background:#fdf0d5;color:#a86e00">VIP 👑</span>' : '') +
          (typeof d.points === 'number' ? '<div class="cht-meta">💎 ' + esc(Number(d.points).toLocaleString('en-US')) + '</div>' : '') +
          '</div>' + action + '</div>';
      }).join('');
    } else {
      h += '<p class="muted" style="text-align:center">' + esc(fa ? 'فعلاً زبان‌آموز دیگه‌ای توی لیست نیست. بعداً دوباره سر بزن.' : 'No other learners are in the list yet. Check back soon.') + '</p>';
    }
  }

  /* blocked */
  if (blocked.length) {
    h += '<h2 class="vip-sec-title">' + esc(fa ? 'بلاک‌شده‌ها' : 'Blocked') + '</h2>';
    h += blocked.map(function (b) {
      return '<div class="cht-row">' + chtAvatar(b.display_name) +
        '<div style="flex:1;min-width:0"><span class="cht-name">' + esc(b.display_name || '') + '</span>' + chtLvl(b.level) + '</div>' +
        '<button class="btn btn-ghost btn-sm" data-unblock="' + b.user_id + '">' + esc(fa ? 'آنبلاک' : 'Unblock') + '</button></div>';
    }).join('');
  }

  v.innerHTML = h;

  const note = function (msg) { const n = document.getElementById('cht-note'); if (n) n.textContent = msg; };
  const repaint = function () { renderChat(v); };

  v.querySelectorAll('[data-reqto]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      const r = await chtRpc('chat_send_request', { p_to: btn.getAttribute('data-reqto') });
      const code = r.ok ? String(r.data) : 'error';
      if (code === 'ok') { note(fa ? 'درخواست فرستاده شد ✓' : 'Request sent ✓'); repaint(); }
      else if (code === 'limit') { note(fa ? 'امروز ۵ تا درخواست فرستادی؛ فردا دوباره تلاش کن.' : 'You sent 5 requests today; try again tomorrow.'); btn.disabled = false; }
      else if (code === 'exists') { note(fa ? 'از قبل با این کاربر درخواست داری.' : 'You already have a request with this learner.'); repaint(); }
      else if (code === 'not_vip') { note(fa ? 'فقط اعضای VIP می‌تونن درخواست بدن.' : 'Only VIP members can send requests.'); btn.disabled = false; }
      else { note(fa ? 'خطا پیش اومد، دوباره تلاش کن.' : 'Something went wrong, try again.'); btn.disabled = false; }
    });
  });

  v.querySelectorAll('[data-resp]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const r = await chtRpc('chat_respond', { p_request: btn.getAttribute('data-resp'), p_accept: btn.getAttribute('data-acc') === '1' });
      if (r.ok && String(r.data) === 'ok') repaint();
      else note(fa ? 'خطا پیش اومد، دوباره تلاش کن.' : 'Something went wrong, try again.');
    });
  });

  v.querySelectorAll('[data-unblock]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const r = await chtRpc('chat_unblock', { p_user: btn.getAttribute('data-unblock') });
      if (r.ok) repaint();
    });
  });
}

/* ---------------- 1:1 thread ---------------- */

async function renderChatThread(v, partnerId) {
  chtStopPoll();
  const fa = chtFa();
  v.innerHTML = '<p class="muted" style="text-align:center;margin-top:2rem">' + esc(fa ? 'در حال بارگذاری…' : 'Loading…') + '</p>';
  const convs = await chtRpc('chat_list_conversations');
  if (!convs.ok) { v.innerHTML = chtSoonHTML(fa); return; }
  const conv = (convs.data || []).find(function (c) { return c.partner_id === partnerId; });
  if (!conv) {
    v.innerHTML = '<p class="muted" style="text-align:center;margin-top:2rem">' + esc(fa ? 'این گفتگو فعال نیست.' : 'This chat is not active.') + '</p>' +
      '<p style="text-align:center"><a href="#/chat" style="font-weight:800;color:#c47b12">' + esc(fa ? 'برگشت به چت‌ها' : 'Back to chats') + '</a></p>';
    return;
  }
  chtPartnerId = partnerId;
  const name = conv.partner_name || '';

  v.innerHTML =
    '<div class="cht-head"><a href="#/chat" class="cht-back">' + esc(fa ? '‹ برگشت' : '‹ Back') + '</a>' +
      chtAvatar(name) +
      '<div style="flex:1;min-width:0"><span class="cht-name">' + esc(name) + '</span>' + chtLvl(conv.partner_level) + '</div>' +
      '<button class="btn btn-ghost btn-sm" id="cht-report">' + esc(fa ? 'گزارش' : 'Report') + '</button>' +
      '<button class="btn btn-ghost btn-sm" id="cht-block">' + esc(fa ? 'بلاک' : 'Block') + '</button></div>' +
    '<div id="cht-note" class="muted" style="text-align:center"></div>' +
    '<div class="cht-msgs" id="cht-msgs"></div>' +
    '<div class="cht-inputbar"><input class="cht-input" id="cht-input" type="text" maxlength="1000" placeholder="' + esc(fa ? 'پیام بنویس…' : 'Write a message…') + '">' +
    '<button class="btn btn-orange" id="cht-send">' + esc(fa ? 'ارسال' : 'Send') + '</button></div>';

  const note = function (msg) { const n = document.getElementById('cht-note'); if (n) n.textContent = msg; };

  await chtLoadMsgs(partnerId, true);
  chtRpc('chat_mark_read', { p_partner: partnerId });

  chtTimer = setInterval(async function () {
    if (chtPartnerId !== partnerId) { chtStopPoll(); return; }
    const changed = await chtLoadMsgs(partnerId, false);
    if (changed) chtRpc('chat_mark_read', { p_partner: partnerId });
  }, 7000);

  const input = document.getElementById('cht-input');
  const send = async function () {
    const body = (input.value || '').trim();
    if (!body) return;
    const btn = document.getElementById('cht-send');
    if (btn) btn.disabled = true;
    const r = await chtRpc('chat_send_message', { p_to: partnerId, p_body: body });
    if (btn) btn.disabled = false;
    const code = r.ok ? String(r.data) : 'error';
    if (code === 'ok') { input.value = ''; await chtLoadMsgs(partnerId, true); }
    else if (code === 'not_vip') note(fa ? 'برای فرستادن پیام باید VIP باشی.' : 'You need VIP to send messages.');
    else if (code === 'blocked') note(fa ? 'این گفتگو بسته شده.' : 'This chat is closed.');
    else note(fa ? 'پیام فرستاده نشد، دوباره تلاش کن.' : 'Message not sent, try again.');
  };
  const sendBtn = document.getElementById('cht-send');
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

  const blockBtn = document.getElementById('cht-block');
  if (blockBtn) blockBtn.addEventListener('click', async function () {
    if (!window.confirm(fa ? 'این کاربر بلاک بشه؟ گفتگو بسته می‌شه.' : 'Block this learner? The chat will close.')) return;
    const r = await chtRpc('chat_block', { p_user: partnerId });
    if (r.ok) { chtStopPoll(); location.hash = '#/chat'; }
  });

  const reportBtn = document.getElementById('cht-report');
  if (reportBtn) reportBtn.addEventListener('click', async function () {
    if (!window.confirm(fa ? 'این گفتگو به پشتیبانی گزارش بشه؟' : 'Report this chat to Support?')) return;
    try {
      const rr = await sb.rpc('send_support_message', { p_body: '🚩 VIP chat report — partner: ' + name + ' (' + partnerId + ')' });
      note(!rr.error ? (fa ? 'گزارش برای پشتیبانی فرستاده شد ✓' : 'Reported to Support ✓') : (fa ? 'خطا پیش اومد.' : 'Something went wrong.'));
    } catch (e) { note(fa ? 'خطا پیش اومد.' : 'Something went wrong.'); }
  });
}

async function chtLoadMsgs(partnerId, forceScroll) {
  const box = document.getElementById('cht-msgs');
  if (!box) return false;
  const r = await chtRpc('chat_get_messages', { p_partner: partnerId, p_limit: 100 });
  if (!r.ok || !Array.isArray(r.data)) return false;
  const me = state.user && state.user.id;
  const sig = r.data.map(function (m) { return m.id; }).join(',');
  if (!forceScroll && sig === chtLastSig) return false;
  chtLastSig = sig;
  box.innerHTML = r.data.length ? r.data.map(function (m) {
    const mine = m.sender_id === me;
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return '<div class="cht-b' + (mine ? ' me' : '') + '"><span dir="auto">' + esc(m.body) + '</span><span class="cht-time">' + esc(time) + '</span></div>';
  }).join('') : '<p class="muted" style="text-align:center">' + esc(chtFa() ? 'هنوز پیامی نیست — اولین پیام رو تو بفرست!' : 'No messages yet — send the first one!') + '</p>';
  box.scrollTop = box.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
  return true;
}
