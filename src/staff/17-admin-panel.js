/* ---------------- admin panel: support ---------------- */
async function apRenderSupport(v) {
  v.innerHTML = apShell('support',
    '<div class="ap-head"><h1>💬 Support</h1><p class="muted">Questions from learners, newest first. Open a thread to reply — the reply appears on the learner\u2019s Support page.</p></div>' +
    '<div id="ap-sup-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  var host = v.querySelector('#ap-sup-host');
  var rows = null;
  try { var r = await sb.rpc('admin_support_threads'); if (r.error) throw r.error; rows = r.data || []; } catch (e) { rows = null; }
  if (!rows) { host.innerHTML = '<div class="empty">Could not load support threads — is the support migration installed?</div>'; return; }
  if (!rows.length) { host.innerHTML = '<div class="empty">No support messages yet.</div>'; return; }
  host.innerHTML = rows.map(function (t) {
    return '<a class="ap-sup-row" href="/manage/support/' + esc(t.user_id) + '">' +
      '<span class="ap-sup-main"><b>' + esc(t.display_name || t.email || t.user_id) + '</b> ' +
      '<span class="muted">' + esc(t.email || '') + (t.level ? ' · ' + esc(t.level) : '') + '</span>' +
      '<span class="ap-sup-last" dir="auto">' + (t.last_from_admin ? 'You: ' : '') + esc(t.last_body || '') + '</span></span>' +
      (t.unread ? '<span class="sup-badge">' + t.unread + '</span>' : '') + '</a>';
  }).join('');
}

async function apRenderSupportThread(v, userId) {
  v.innerHTML = apShell('support',
    '<div class="ap-head"><h1>💬 Support thread</h1><p class="muted"><a href="/manage/support">← All threads</a></p></div>' +
    '<div id="ap-sup-thread" class="sup-thread"><div class="empty">Loading…</div></div>' +
    '<div class="sup-composer"><textarea id="ap-sup-input" rows="3" maxlength="2000" placeholder="Write your reply…"></textarea>' +
    '<div class="form-error" id="ap-sup-error" role="alert"></div>' +
    '<button class="btn btn-orange btn-block" id="ap-sup-send">Send reply</button></div>');
  apWireChrome(v);
  var host = v.querySelector('#ap-sup-thread');
  async function load() {
    var rows = null;
    try { var r = await sb.rpc('admin_support_thread', { p_user: userId }); if (r.error) throw r.error; rows = r.data || []; } catch (e) { rows = null; }
    if (!rows) { host.innerHTML = '<div class="empty">Could not load this thread.</div>'; return; }
    host.innerHTML = rows.length ? rows.map(function (m) { return supportMsgHTML(m, false, true); }).join('') : '<div class="empty">No messages.</div>';
  }
  await load();
  var btn = v.querySelector('#ap-sup-send');
  if (btn) btn.addEventListener('click', async function () {
    var inp = v.querySelector('#ap-sup-input');
    var err = v.querySelector('#ap-sup-error');
    var body = ((inp && inp.value) || '').trim();
    if (!body) { if (err) err.textContent = 'Write a reply first.'; return; }
    btn.disabled = true;
    var ok = false;
    try { var rr = await sb.rpc('admin_send_support', { p_user: userId, p_body: body }); ok = !rr.error && rr.data === true; } catch (e) { ok = false; }
    if (ok) { inp.value = ''; if (err) err.textContent = ''; await load(); window.scrollTo(0, document.body.scrollHeight); }
    else if (err) err.textContent = 'Could not send — try again.';
    btn.disabled = false;
  });
}