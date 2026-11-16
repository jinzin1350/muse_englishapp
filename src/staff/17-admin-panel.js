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
  var mode = 'needs';
  function rowHTML(t) {
    var lp = (typeof supSplitBody === 'function') ? supSplitBody(t.last_body || '') : { text: t.last_body || '', img: '' };
    var preview = (lp.img ? '📷 Photo' + (lp.text ? ' — ' : '') : '') + lp.text;
    return '<a class="ap-sup-row" href="/manage/support/' + esc(t.user_id) + '">' +
      '<span class="ap-sup-main"><b>' + esc(t.display_name || t.email || t.user_id) + '</b> ' +
      '<span class="muted">' + esc(t.email || '') + (t.level ? ' · ' + esc(t.level) : '') + '</span>' +
      '<span class="ap-sup-last" dir="auto">' + (t.last_from_admin ? 'You: ' : '') + esc(preview) + '</span></span>' +
      (t.unread ? '<span class="sup-badge">' + t.unread + '</span>' : '') + '</a>';
  }
  function renderList() {
    var needs = rows.filter(function (t) { return !t.last_from_admin; });
    var shown = mode === 'needs' ? needs : rows;
    host.innerHTML =
      '<div style="display:flex;gap:.5rem;margin-bottom:.8rem">' +
      '<button type="button" id="ap-sup-needs" class="btn ' + (mode === 'needs' ? 'btn-orange' : 'btn-ghost') + ' btn-sm">Needs reply (' + needs.length + ')</button>' +
      '<button type="button" id="ap-sup-all" class="btn ' + (mode === 'all' ? 'btn-orange' : 'btn-ghost') + ' btn-sm">All (' + rows.length + ')</button>' +
      '</div>' +
      (shown.length ? shown.map(rowHTML).join('') : '<div class="empty">' + (mode === 'needs' ? 'No threads waiting for a reply. 🎉' : 'No support messages yet.') + '</div>');
    host.querySelector('#ap-sup-needs').addEventListener('click', function () { mode = 'needs'; renderList(); });
    host.querySelector('#ap-sup-all').addEventListener('click', function () { mode = 'all'; renderList(); });
  }
  renderList();
}

async function apRenderSupportThread(v, userId) {
  v.innerHTML = apShell('support',
    '<div class="ap-head"><h1>💬 Support thread</h1><p class="muted"><a href="/manage/support">← All threads</a></p></div>' +
    '<div id="ap-sup-thread" class="sup-thread"><div class="empty">Loading…</div></div>' +
    '<div class="sup-composer"><textarea id="ap-sup-input" dir="auto" rows="3" maxlength="2000" placeholder="Write your reply…"></textarea>' +
    '<div class="sup-attach-row"><label class="btn btn-ghost btn-sm sup-attach-btn">📷 Add a photo<input type="file" id="ap-sup-file" accept="image/*" hidden></label>' +
    '<span class="sup-preview hidden" id="ap-sup-preview"><img id="ap-sup-preview-img" alt=""><button type="button" class="sup-preview-x" id="ap-sup-preview-x" aria-label="×">×</button></span></div>' +
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
  var apFile = null;
  var apFileInp = v.querySelector('#ap-sup-file');
  var apPrevBox = v.querySelector('#ap-sup-preview');
  var apPrevImg = v.querySelector('#ap-sup-preview-img');
  function apClearFile() {
    apFile = null;
    if (apFileInp) apFileInp.value = '';
    if (apPrevBox) apPrevBox.classList.add('hidden');
    if (apPrevImg) apPrevImg.removeAttribute('src');
  }
  if (apFileInp) apFileInp.addEventListener('change', function () {
    var f = apFileInp.files && apFileInp.files[0];
    var err = v.querySelector('#ap-sup-error');
    if (!f) { apClearFile(); return; }
    if (!/^image\//.test(f.type || '')) { apClearFile(); if (err) err.textContent = 'You can only send a photo.'; return; }
    if (f.size > 10 * 1024 * 1024) { apClearFile(); if (err) err.textContent = 'That photo is too big — pick a smaller one.'; return; }
    apFile = f;
    if (err) err.textContent = '';
    if (apPrevImg && apPrevBox) { apPrevImg.src = URL.createObjectURL(f); apPrevBox.classList.remove('hidden'); }
  });
  var apPrevX = v.querySelector('#ap-sup-preview-x');
  if (apPrevX) apPrevX.addEventListener('click', apClearFile);
  var btn = v.querySelector('#ap-sup-send');
  if (btn) btn.addEventListener('click', async function () {
    var inp = v.querySelector('#ap-sup-input');
    var err = v.querySelector('#ap-sup-error');
    var body = ((inp && inp.value) || '').trim();
    if (!body && !apFile) { if (err) err.textContent = 'Write a reply first, or add a photo.'; return; }
    btn.disabled = true;
    if (apFile) {
      var imgUrl = (typeof supUploadImage === 'function') ? await supUploadImage(apFile) : '';
      if (!imgUrl) { if (err) err.textContent = 'The photo could not be uploaded — try again.'; btn.disabled = false; return; }
      body = (body ? body.slice(0, 1800) + '\n' : '') + imgUrl;
    }
    var ok = false;
    try { var rr = await sb.rpc('admin_send_support', { p_user: userId, p_body: body }); ok = !rr.error && rr.data === true; } catch (e) { ok = false; }
    if (ok) { inp.value = ''; if (err) err.textContent = ''; apClearFile(); await load(); window.scrollTo(0, document.body.scrollHeight); }
    else if (err) err.textContent = 'Could not send — try again.';
    btn.disabled = false;
  });
}