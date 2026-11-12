

/* ---------------- admin: telegram bot control (@muse_eng_bot) ---------------- */
async function loadAdminBot() {
  const host = document.getElementById('admin-bot');
  if (!host) return;
  let cfg = null;
  try {
    const r = await sb.from('bot_config').select('*').eq('id', 1).maybeSingle();
    if (r.error) throw r.error;
    cfg = r.data;
  } catch (e) { cfg = null; }
  if (!cfg) {
    host.innerHTML = '<p class="muted">Bot config table not found. Run <code>supabase-bot-config-migration.sql</code> in the Supabase SQL Editor first.</p>';
    return;
  }
  const lv = cfg.levels || [];
  const cb = function (id, label, isOn) {
    return '<label class="bot-check"><input type="checkbox" id="' + id + '"' + (isOn ? ' checked' : '') + '> ' + label + '</label>';
  };
  host.innerHTML =
    '<div class="bot-grid">' +
    '<label class="bot-row"><span>Bot enabled</span><input type="checkbox" id="bot-enabled" class="bot-switch"' + (cfg.enabled ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Posting hours (Tehran)</span><span class="bot-hours"><input type="number" id="bot-start" min="0" max="23" value="' + cfg.start_hour + '"> – <input type="number" id="bot-end" min="1" max="24" value="' + cfg.end_hour + '"></span></label>' +
    '<label class="bot-row"><span>Post every N hours</span><input type="number" id="bot-interval" min="1" max="12" value="' + cfg.interval_hours + '"></label>' +
    '<div class="bot-row"><span>Content</span><span class="bot-checks">' + cb('bot-words', '📇 Word cards', cfg.send_words) + cb('bot-quiz', '❓ Quizzes', cfg.send_quiz) + cb('bot-podcast', '🎧 Podcast', cfg.send_podcast) + cb('bot-shadowing', '🗣️ Shadowing', cfg.send_shadowing) + '</span></div>' +
    '<label class="bot-row"><span>Podcast every N posts</span><input type="number" id="bot-podevery" min="1" max="24" value="' + cfg.podcast_every + '"></label>' +
    '<label class="bot-row"><span>Shadowing every N posts</span><input type="number" id="bot-shevery" min="1" max="24" value="' + cfg.shadowing_every + '"></label>' +
    '<label class="bot-row"><span>📢 Promo banners</span><input type="checkbox" id="bot-promo" class="bot-switch"' + (cfg.send_promo ? ' checked' : '') + '></label>' +
    '<label class="bot-row"><span>Promo every N hours</span><input type="number" id="bot-promoevery" min="1" max="12" value="' + cfg.promo_every_hours + '"></label>' +
    '<label class="bot-row"><span>Quiz every N posts</span><input type="number" id="bot-quizevery" min="2" max="12" value="' + cfg.quiz_every + '"></label>' +
    '<div class="bot-row"><span>Word levels</span><span class="bot-checks">' +
      ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(function (l) { return cb('bot-lv-' + l, l.toUpperCase(), lv.indexOf(l) !== -1); }).join('') +
    '</span></div>' +
    '</div>' +
    '<div style="margin-top:0.7rem"><button class="btn btn-sm" data-action="bot-save">Save bot settings</button> ' +
    '<span class="muted" id="bot-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
    '<p class="muted" style="font-size:0.8rem;margin:0.6rem 0 0">Settings take effect on the next hourly bot run. Hours are Asia/Tehran. Promo banners (jpg/png/webp) go in <code>media/promo/</code> — a promo replaces the regular post in its slot.</p>' +
    '<div class="bot-chat-sec"><p style="margin:0.9rem 0 0.4rem"><b>💬 Per-chat settings</b> <span class="muted" style="font-size:0.85rem">— custom footer & pause per group/channel. Chats you never configure keep the global default footer.</span></p>' +
    '<div id="bot-chat-list"><div class="empty">Loading…</div></div></div>';
  loadAdminBotChats();
}

async function saveAdminBot(btn) {
  const status = document.getElementById('bot-status');
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const val = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
  const isOn = function (id) { const el = document.getElementById(id); return !!(el && el.checked); };
  const start = parseInt(val('bot-start'), 10), end = parseInt(val('bot-end'), 10);
  const interval = parseInt(val('bot-interval'), 10), qe = parseInt(val('bot-quizevery'), 10);
  const pe = parseInt(val('bot-promoevery'), 10);
  const pode = parseInt(val('bot-podevery'), 10), she = parseInt(val('bot-shevery'), 10);
  const levels = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].filter(function (l) { return isOn('bot-lv-' + l); });
  if (!(start >= 0 && start < 24 && end > 0 && end <= 24 && start < end)) { say('Start hour must be before end hour.', false); return; }
  if (!(interval >= 1 && interval <= 12)) { say('Interval must be 1–12.', false); return; }
  if (!(qe >= 2 && qe <= 12)) { say('Quiz-every must be 2–12.', false); return; }
  if (!(pe >= 1 && pe <= 12)) { say('Promo-every must be 1–12.', false); return; }
  if (!(pode >= 1 && pode <= 24) || !(she >= 1 && she <= 24)) { say('Podcast/Shadowing-every must be 1–24.', false); return; }
  if (!isOn('bot-words') && !isOn('bot-quiz') && !isOn('bot-podcast') && !isOn('bot-shadowing')) { say('Enable at least one content type.', false); return; }
  if (!levels.length) { say('Pick at least one level.', false); return; }
  if (btn) btn.disabled = true;
  say('Saving…', true);
  try {
    const r = await sb.from('bot_config').upsert({
      id: 1, enabled: isOn('bot-enabled'), start_hour: start, end_hour: end,
      interval_hours: interval, send_words: isOn('bot-words'), send_quiz: isOn('bot-quiz'),
      send_podcast: isOn('bot-podcast'), send_shadowing: isOn('bot-shadowing'),
      podcast_every: pode, shadowing_every: she,
      send_promo: isOn('bot-promo'), promo_every_hours: pe,
      quiz_every: qe, levels: levels, updated_at: new Date().toISOString()
    });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
  if (btn) btn.disabled = false;
}

/* ---------------- admin: telegram bot per-chat config ----------------
   Footer semantics (mirrors post.py):
   - no row / footer NULL  -> global default footer (legacy behavior)
   - footer '' (empty)     -> NO footer on that chat's posts
   - footer text set       -> custom footer for that chat            */
async function loadAdminBotChats() {
  const host = document.getElementById('bot-chat-list');
  if (!host) return;
  let rows;
  try {
    const r = await sb.from('bot_chat_config').select('chat_id,title,footer_text,paused').order('title');
    if (r.error) throw r.error;
    rows = r.data || [];
  } catch (e) {
    host.innerHTML = '<p class="muted">Per-chat table not found. Run <code>supabase-bot-chat-config-migration.sql</code> in the Supabase SQL Editor first.</p>';
    return;
  }
  if (!rows.length) {
    host.innerHTML = '<p class="muted">No chats tracked yet — they appear here automatically after the next bot run.</p>';
    return;
  }
  host.innerHTML = rows.map(function (r) {
    const cid = String(r.chat_id);
    const ft = r.footer_text;
    const mode = (ft === null || ft === undefined) ? 'global' : (ft === '' ? 'none' : 'custom');
    return '<div class="bot-chat-row" data-chat="' + esc(cid) + '">' +
      '<div class="bot-chat-head"><b>' + esc(r.title || '(untitled)') + '</b> <code>' + esc(cid) + '</code>' +
      (r.paused ? ' <span style="background:#7C6AF0;color:#fff;border-radius:99px;padding:0.1rem 0.55rem;font-size:0.72rem">paused</span>' : '') + '</div>' +
      '<label class="bot-row"><span>Footer</span><select id="botmode-' + esc(cid) + '" data-chat="' + esc(cid) + '">' +
        '<option value="global"' + (mode === 'global' ? ' selected' : '') + '>Global default footer</option>' +
        '<option value="custom"' + (mode === 'custom' ? ' selected' : '') + '>Custom footer</option>' +
        '<option value="none"' + (mode === 'none' ? ' selected' : '') + '>No footer</option>' +
      '</select></label>' +
      '<textarea id="botft-' + esc(cid) + '" rows="2" style="' + (mode === 'custom' ? '' : 'display:none') + '" placeholder="Custom footer text for this chat…">' + esc(mode === 'custom' ? ft : '') + '</textarea>' +
      '<div class="bot-chat-actions"><label class="bot-check"><input type="checkbox" id="botpaused-' + esc(cid) + '"' + (r.paused ? ' checked' : '') + '> Pause this chat</label> ' +
      '<button class="btn btn-sm" data-action="bot-chat-save" data-chat="' + esc(cid) + '">Save this chat</button> ' +
      '<span class="muted bot-chat-status" style="font-size:0.85rem;margin-left:0.5rem"></span></div>' +
      '</div>';
  }).join('');
  host.querySelectorAll('select[id^="botmode-"]').forEach(function (sel) {
    sel.addEventListener('change', function () {
      const ta = document.getElementById('botft-' + sel.getAttribute('data-chat'));
      if (ta) ta.style.display = sel.value === 'custom' ? '' : 'none';
    });
  });
}

