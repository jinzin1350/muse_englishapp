/* ---------------- Daily study report (admin + teacher) ----------------
   Per-day, per-user: minutes in app, lessons opened, quizzes, XP, podcast
   minutes, shadowing speaking tries and shadowing sentence listens.
   `day` is the viewer's LOCAL calendar date. daily_stats rows are keyed by
   DB (UTC) date, so the stats columns match exactly except 20:00-24:00 local
   (that slice lands in the next UTC row); the shadowing tries/listens
   columns use exact local-day boundaries. */
function utcTodayStr() { return new Date().toISOString().slice(0, 10); }
function dayAfterStr(day) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function localDayRangeUTC(day) {
  const start = new Date(day + 'T00:00:00');
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
function addDaysStr(day, delta) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const p = function (x) { return String(x).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function rangeLabel(range) {
  return range === '7' ? 'last 7 days' : range === '30' ? 'last 30 days' : range === 'all' ? 'all time' : 'this day';
}
/* Range-aware study fetch. range: 'day' | '7' | '30' | 'all'.
   'day' keeps the exact single-day behavior (local-day shadowing window,
   UTC-keyed daily_stats row). '7'/'30' aggregate from (n-1) days ago through
   today; 'all' has no lower bound (rows only exist since registration). */
async function fetchStudyRange(range, day, userIds) {
  const scoped = function (q) { return (userIds && userIds.length) ? q.in('user_id', userIds) : q; };
  const statsById = {}, triesById = {}, listensById = {};
  let statsQ = scoped(sb.from('daily_stats').select('user_id,seconds_in_app,lessons_opened,quizzes_completed,xp_earned,podcast_seconds'));
  let triesQ = scoped(sb.from('shadowing_attempts').select('user_id'));
  let listensQ = scoped(sb.from('app_events').select('user_id').eq('event', 'shadowing_listen'));
  if (range === 'day') {
    const rg = localDayRangeUTC(day);
    statsQ = statsQ.eq('day', day).limit(2000);
    triesQ = triesQ.gte('created_at', rg.start).lt('created_at', rg.end).limit(5000);
    listensQ = listensQ.gte('created_at', rg.start).lt('created_at', rg.end).limit(5000);
  } else {
    if (range === '7' || range === '30') {
      const startDay = addDaysStr(day, -(parseInt(range, 10) - 1));
      statsQ = statsQ.gte('day', startDay);
      const startISO = localDayRangeUTC(startDay).start;
      triesQ = triesQ.gte('created_at', startISO);
      listensQ = listensQ.gte('created_at', startISO);
    }
    statsQ = statsQ.limit(10000);
    triesQ = triesQ.limit(10000);
    listensQ = listensQ.limit(10000);
  }
  const res = await Promise.all([statsQ, triesQ, listensQ]);
  (res[0].data || []).forEach(function (r) {
    const o = statsById[r.user_id] || (statsById[r.user_id] = { seconds_in_app: 0, lessons_opened: 0, quizzes_completed: 0, xp_earned: 0, podcast_seconds: 0 });
    o.seconds_in_app += Number(r.seconds_in_app) || 0;
    o.lessons_opened += Number(r.lessons_opened) || 0;
    o.quizzes_completed += Number(r.quizzes_completed) || 0;
    o.xp_earned += Number(r.xp_earned) || 0;
    o.podcast_seconds += Number(r.podcast_seconds) || 0;
  });
  (res[1].data || []).forEach(function (r) { triesById[r.user_id] = (triesById[r.user_id] || 0) + 1; });
  (res[2].data || []).forEach(function (r) { listensById[r.user_id] = (listensById[r.user_id] || 0) + 1; });
  return { statsById: statsById, triesById: triesById, listensById: listensById };
}
function dailyStudyShell(prefix, day, range, title) {
  const opts = [['day', 'Day'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']]
    .map(function (o) { return '<option value="' + o[0] + '"' + (range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('');
  return '<div class="card"><div class="tch-weekly-title">' + title + '</div>' +
    '<div class="adm-filters" style="margin:0.6rem 0 0.2rem;align-items:center">' +
    '<label class="muted" style="font-size:0.85rem">Range <select id="' + prefix + '-daily-range">' + opts + '</select></label>' +
    '<label class="muted" id="' + prefix + '-daily-daywrap" style="font-size:0.85rem' + (range !== 'day' ? ';display:none' : '') + '">Day <input type="date" id="' + prefix + '-daily-day" value="' + esc(day) + '" max="' + todayStr() + '"></label>' +
    '<span class="muted" id="' + prefix + '-daily-sum" style="font-size:0.85rem"></span></div>' +
    '<div id="' + prefix + '-daily-body"><div class="empty">Loading…</div></div></div>';
}
function dailyStudyTableHTML(rows, emptyText) {
  if (!rows.length) return '<div class="empty">' + esc(emptyText || 'No study activity.') + '</div>';
  return '<div class="card tch-table-card" style="margin-top:0.5rem"><div class="tch-table daily-table">' +
    '<div class="tch-tr tch-th"><span>#</span><span>Student</span><span>⏱ min</span><span>📖</span>' +
    '<span>❓</span><span>⚡ XP</span><span>🎧 min</span><span>🎤</span><span>👂</span></div>' +
    rows.map(function (r, i) {
      return '<div class="tch-tr"><span class="muted">' + (i + 1) + '</span>' +
        '<span class="tch-name">' + esc(r.name) + (r.level ? '<small>' + esc(String(r.level).toUpperCase()) + '</small>' : '') + '</span>' +
        '<span><b>' + r.min + '</b></span><span>' + r.lessons + '</span><span>' + r.quizzes + '</span>' +
        '<span>' + r.xp + '</span><span>' + r.podMin + '</span><span>' + r.tries + '</span><span>' + r.listens + '</span></div>';
    }).join('') + '</div></div>';
}
function dailyStudyRow(id, f, name, level) {
  const s = f.statsById[id] || {};
  return {
    name: name, level: level,
    min: Math.round((Number(s.seconds_in_app) || 0) / 60),
    lessons: Number(s.lessons_opened) || 0,
    quizzes: Number(s.quizzes_completed) || 0,
    xp: Number(s.xp_earned) || 0,
    podMin: Math.round((Number(s.podcast_seconds) || 0) / 60),
    tries: f.triesById[id] || 0,
    listens: f.listensById[id] || 0
  };
}
function dailyStudyActive(r) { return r.min > 0 || r.lessons > 0 || r.tries > 0 || r.listens > 0; }
async function loadAdminDaily() {
  const host = document.getElementById('admin-daily');
  if (!host) return;
  const day = state.adminDailyDay || todayStr();
  const range = state.adminDailyRange || 'day';
  state.adminDailyDay = day;
  state.adminDailyRange = range;
  host.innerHTML = dailyStudyShell('adm', day, range, '📊 Daily study — who studied how much');
  const rangeSel = document.getElementById('adm-daily-range');
  if (rangeSel) rangeSel.addEventListener('change', function () {
    state.adminDailyRange = rangeSel.value; loadAdminDaily();
  });
  const dayInput = document.getElementById('adm-daily-day');
  if (dayInput) dayInput.addEventListener('change', function () {
    if (dayInput.value) { state.adminDailyDay = dayInput.value; loadAdminDaily(); }
  });
  const body = document.getElementById('adm-daily-body');
  const sum = document.getElementById('adm-daily-sum');
  try {
    const f = await fetchStudyRange(range, day, null);
    const nameOf = {};
    ((state.adminStats || {}).users || []).forEach(function (u) {
      nameOf[u.user_id] = { name: u.display_name || (u.email || '?').split('@')[0], level: u.level };
    });
    const idSet = {};
    [f.statsById, f.triesById, f.listensById].forEach(function (m) {
      Object.keys(m).forEach(function (id) { idSet[id] = 1; });
    });
    const ids = Object.keys(idSet);
    const missing = ids.filter(function (id) { return !nameOf[id]; }).slice(0, 500);
    if (missing.length) {
      const pr = await sb.from('profiles').select('id,display_name,level').in('id', missing);
      (pr.data || []).forEach(function (p) { nameOf[p.id] = { name: p.display_name || '?', level: p.level }; });
    }
    const rows = ids.map(function (id) {
      const nm = nameOf[id] || { name: 'User ' + String(id).slice(0, 6), level: '' };
      return dailyStudyRow(id, f, nm.name, nm.level);
    }).filter(dailyStudyActive);
    rows.sort(function (a, b) { return b.min - a.min; });
    const totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
    if (sum) sum.textContent = rows.length + ' active · ' + totalMin + ' total min · ' + rangeLabel(range);
    if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(range) + '.');
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
  }
}
async function loadTeacherDaily() {
  const host = document.getElementById('tch-daily');
  if (!host) return;
  const roster = state.teacherStudents || [];
  const day = state.teacherDailyDay || todayStr();
  const range = state.teacherDailyRange || 'day';
  state.teacherDailyDay = day;
  state.teacherDailyRange = range;
  host.innerHTML = dailyStudyShell('tch', day, range, '📅 Daily study — your students');
  const rangeSel = document.getElementById('tch-daily-range');
  if (rangeSel) rangeSel.addEventListener('change', function () {
    state.teacherDailyRange = rangeSel.value; loadTeacherDaily();
  });
  const dayInput = document.getElementById('tch-daily-day');
  if (dayInput) dayInput.addEventListener('change', function () {
    if (dayInput.value) { state.teacherDailyDay = dayInput.value; loadTeacherDaily(); }
  });
  const body = document.getElementById('tch-daily-body');
  const sum = document.getElementById('tch-daily-sum');
  if (!roster.length) { if (body) body.innerHTML = '<div class="empty">No students yet.</div>'; return; }
  try {
    const f = await fetchStudyRange(range, day, roster.map(function (s) { return s.user_id; }));
    const rows = roster.map(function (s) {
      return dailyStudyRow(s.user_id, f, s.display_name || '?', s.level);
    });
    rows.sort(function (a, b) { return b.min - a.min; });
    const active = rows.filter(dailyStudyActive).length;
    const totalMin = rows.reduce(function (a, r) { return a + r.min; }, 0);
    if (sum) sum.textContent = active + ' / ' + rows.length + ' studied · ' + totalMin + ' total min · ' + rangeLabel(range);
    if (body) body.innerHTML = dailyStudyTableHTML(rows, 'No study activity in ' + rangeLabel(range) + '.');
  } catch (e) {
    if (body) body.innerHTML = '<div class="empty">Could not load daily study: ' + esc((e && e.message) || e) + '</div>';
  }
}

function renderAdmin(v) {
  v.innerHTML = '<h1>Admin</h1>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>📊 Analytics</b> — everyone, everything.</p>' +
    '<div id="admin-analytics"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>📊 Daily study</b> — who studied how much, per day or range.</p>' +
    '<div id="admin-daily"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>🍎 Teachers</b> — requests, invite codes and manual add.</p>' +
    '<div id="admin-teachers"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0 0 0.6rem"><b>🤖 Telegram Bot</b> — @muse_eng_bot schedule & content.</p>' +
    '<div id="admin-bot"><div class="empty">Loading…</div></div></div>' +
    '<div class="card plain"><p class="muted" style="margin:0">Set each user\'s level. New users appear as <b>pending</b> first.</p></div>' +
    '<div id="admin-list"><div class="empty">Loading…</div></div>';
  loadAdminAnalytics().then(function () { loadAdminDaily(); });
  loadAdminUsers().then(function () { loadAdminTeachers(); loadAdminBot(); });
}

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'teacher';
}

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

async function saveAdminBotChat(btn) {
  const cid = btn.getAttribute('data-chat');
  const row = btn.closest('.bot-chat-row');
  const status = row ? row.querySelector('.bot-chat-status') : null;
  const say = function (t, ok) { if (status) { status.textContent = t; status.style.color = ok ? '#2e7d32' : '#c62828'; } };
  const modeEl = document.getElementById('botmode-' + cid);
  const ta = document.getElementById('botft-' + cid);
  const pa = document.getElementById('botpaused-' + cid);
  const mode = modeEl ? modeEl.value : 'global';
  const paused = !!(pa && pa.checked);
  let footer_text = null; // global default
  if (mode === 'custom') {
    footer_text = ta ? ta.value.trim() : '';
    if (!footer_text) { say('Custom footer is empty — pick Global default or No footer instead.', false); return; }
  } else if (mode === 'none') {
    footer_text = ''; // explicit: no footer on this chat's posts
  }
  say('Saving…', true);
  try {
    const r = await sb.from('bot_chat_config').upsert(
      { chat_id: cid, footer_text: footer_text, paused: paused, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' });
    if (r.error) throw r.error;
    say('Saved ✓ — takes effect on the next hourly run.', true);
    loadAdminBotChats();
  } catch (e) {
    say('Save failed: ' + (e.message || e), false);
  }
}

async function loadAdminTeachers() {
  const host = document.getElementById('admin-teachers');
  if (!host) return;
  try {
    const t = await sb.from('teachers').select('id,user_id,ref_code,display_name,status,requested_at').order('requested_at', { ascending: true });
    if (t.error) throw t.error;
    const teachers = t.data || [];
    const ids = teachers.map(function (x) { return x.user_id; });
    let emailById = {};
    if (ids.length) {
      const p = await sb.from('profiles').select('id,email').in('id', ids);
      (p.data || []).forEach(function (x) { emailById[x.id] = x.email; });
    }
    // student counts from the already-loaded admin users
    const counts = {};
    (state.adminUsers || []).forEach(function (u) {
      if (u.referred_by) counts[u.referred_by] = (counts[u.referred_by] || 0) + 1;
    });
    const pending = teachers.filter(function (x) { return x.status === 'pending'; });
    const active = teachers.filter(function (x) { return x.status === 'approved'; });
    const rejected = teachers.filter(function (x) { return x.status === 'rejected'; });
    host.innerHTML =
      (pending.length ? '<p class="muted" style="margin:0 0 0.5rem"><b>⏳ Pending requests (' + pending.length + ')</b></p>' +
        pending.map(function (x) {
          const sug = slugify(x.display_name);
          return '<div class="tch-admin-row"><div><b>' + esc(x.display_name) + '</b><br>' +
            '<span class="muted" style="font-size:0.8rem">' + esc(emailById[x.user_id] || '') + ' · ' + esc(String(x.requested_at || '').slice(0, 10)) + '</span></div>' +
            '<div class="tch-admin-actions"><input class="tch-code-input" id="tcode-' + x.id + '" value="' + esc(sug) + '" maxlength="32" aria-label="Invite code">' +
            '<button class="btn btn-sm" data-action="approve-teacher" data-id="' + x.id + '">Approve</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="reject-teacher" data-id="' + x.id + '">Reject</button></div></div>';
        }).join('') : '<p class="muted">No pending requests.</p>') +
      (active.length ? '<p class="muted" style="margin:1rem 0 0.5rem"><b>✓ Active teachers (' + active.length + ')</b></p>' +
        active.map(function (x) {
          return '<div class="tch-admin-row"><div><b>' + esc(x.display_name) + '</b><br>' +
            '<span class="muted" style="font-size:0.8rem"><code>' + esc(x.ref_code) + '</code> · ' + (counts[x.ref_code] || 0) + ' students</span></div>' +
            '<div class="tch-admin-actions"><button class="btn btn-ghost btn-sm" data-action="reject-teacher" data-id="' + x.id + '">Remove</button></div></div>';
        }).join('') : '') +
      (rejected.length ? '<p class="muted" style="margin:1rem 0 0.5rem">Rejected (' + rejected.length + ')</p>' : '') +
      '<p class="muted" style="margin:1.2rem 0 0.5rem"><b>Add teacher manually</b> (they must already have an account)</p>' +
      '<form id="form-teacher-add" class="tch-add-form">' +
        '<input id="ta-email" type="email" placeholder="teacher@email.com" required aria-label="Email">' +
        '<input id="ta-name" type="text" placeholder="Display name" maxlength="40" required aria-label="Display name">' +
        '<input id="ta-code" type="text" placeholder="invite-code" maxlength="32" required aria-label="Invite code">' +
        '<button class="btn btn-sm" type="submit">Add</button></form>' +
      '<div class="form-error" id="ta-error" role="alert"></div>';
  } catch (e) {
    host.innerHTML = '<div class="empty">Could not load teachers: ' + esc(e.message || e) + '</div>';
  }
}

async function adminApproveTeacher(id) {
  const input = document.getElementById('tcode-' + id);
  const code = slugify(input ? input.value : '');
  try {
    const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'approved', p_ref_code: code });
    if (r.error) throw r.error;
    loadAdminTeachers();
  } catch (e) {
    alert('Approve failed: ' + (e.message || e));
  }
}
async function adminRejectTeacher(id) {
  if (!window.confirm('Remove / reject this teacher? Their students keep their accounts.')) return;
  try {
    const r = await sb.rpc('admin_set_teacher_status', { p_teacher_id: id, p_status: 'rejected', p_ref_code: '' });
    if (r.error) throw r.error;
    loadAdminTeachers();
  } catch (e) {
    alert('Failed: ' + (e.message || e));
  }
}
async function adminAddTeacher() {
  const errEl = document.getElementById('ta-error');
  const email = (document.getElementById('ta-email').value || '').trim();
  const name = (document.getElementById('ta-name').value || '').trim();
  const code = slugify((document.getElementById('ta-code').value || '').trim());
  if (errEl) errEl.textContent = '';
  if (!email || name.length < 2 || !code) { if (errEl) errEl.textContent = 'Fill all three fields.'; return; }
  try {
    const r = await sb.rpc('admin_create_teacher', { p_email: email, p_display_name: name, p_ref_code: code });
    if (r.error) throw r.error;
    document.getElementById('form-teacher-add').reset();
    loadAdminTeachers();
  } catch (e) {
    if (errEl) errEl.textContent = 'Failed: ' + (e.message || e);
  }
}

async function loadAdminUsers() {
  const list = $('#admin-list');
  try {
    if (state.user.demo) {
      state.adminUsers = state.adminUsers.length ? state.adminUsers : DEMO_USERS.map(function (u) { return Object.assign({}, u); });
    } else if (sb) {
      let res = await sb.from('profiles').select('id,email,level,created_at,referred_by,is_vip').order('created_at', { ascending: true });
      if (res.error) res = await sb.from('profiles').select('id,email,level,created_at,referred_by').order('created_at', { ascending: true });
      if (res.error) throw res.error;
      state.adminUsers = res.data || [];
    }
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty">Could not load users: ' + esc(e.message || e) + '</div>';
    return;
  }
  if (!list) return;
  const users = state.adminUsers.slice().sort(function (a, b) {
    const ap = a.level ? 1 : 0, bp = b.level ? 1 : 0;
    return ap - bp;
  });
  const refCounts = {};
  users.forEach(function (u) { if (u.referred_by) refCounts[u.referred_by] = (refCounts[u.referred_by] || 0) + 1; });
  const refKeys = Object.keys(refCounts);
  const refSummary = refKeys.length
    ? '<div class="card plain"><p class="muted" style="margin:0">📣 Referrals: ' +
      refKeys.map(function (k) { return '📣 ' + esc(k) + ': <b>' + refCounts[k] + '</b>'; }).join(' &nbsp;·&nbsp; ') + '</p></div>'
    : '';
  list.innerHTML = refSummary + '<div class="card">' + (users.length ? users.map(function (u) {
    const pending = !u.level;
    return '<div class="user-row">' +
      '<div class="user-info">' +
        '<div class="user-email">' + esc(u.email) + (pending ? '<span class="pending-tag">PENDING</span>' : '') + (u.is_vip ? '<span class="vip-tag">⭐ VIP</span>' : '') + (u.referred_by ? '<span class="ref-tag">📣 ' + esc(u.referred_by) + '</span>' : '') + '</div>' +
        '<div class="user-date">joined ' + esc(String(u.created_at || '').slice(0, 10)) + '</div>' +
      '</div>' +
      '<select class="level-select" data-user-id="' + esc(u.id) + '" aria-label="Set level for ' + esc(u.email) + '">' +
        '<option value="">— set level —</option>' +
        LEVELS.map(function (lv) {
          return '<option value="' + lv + '"' + (normalizeLevel(u.level) === lv ? ' selected' : '') + '>' + levelLabel(lv) + '</option>';
        }).join('') +
      '</select>' +
      '<button type="button" class="vip-toggle' + (u.is_vip ? ' on' : '') + '" data-vip-id="' + esc(u.id) + '" title="Toggle VIP for ' + esc(u.email) + '">' + (u.is_vip ? '⭐ VIP' : '☆ Make VIP') + '</button>' +
    '</div>';
  }).join('') : '<div class="empty">No users yet.</div>') + '</div>';
  list.querySelectorAll('.vip-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () { setUserVip(btn.getAttribute('data-vip-id'), !btn.classList.contains('on')); });
  });
}

async function setUserLevel(id, level) {
  if (!level) return;
  try {
    if (state.user.demo) {
      const u = state.adminUsers.find(function (x) { return String(x.id) === String(id); });
      if (u) u.level = level;
    } else if (sb) {
      const { error } = await sb.from('profiles').update({ level: level }).eq('id', id);
      if (error) throw error;
    }
    await loadAdminUsers();
  } catch (e) {
    alert('Could not update level: ' + (e.message || e));
    await loadAdminUsers();
  }
}

async function setUserVip(id, vip) {
  try {
    if (state.user.demo) {
      const u = state.adminUsers.find(function (x) { return String(x.id) === String(id); });
      if (u) u.is_vip = vip;
    } else if (sb) {
      const { error } = await sb.from('profiles').update({ is_vip: vip }).eq('id', id);
      if (error) throw error;
    }
    await loadAdminUsers();
  } catch (e) {
    alert('Could not update VIP — the is_vip column may be missing (run the VIP SQL migration first): ' + (e.message || e));
    await loadAdminUsers();
  }
}

