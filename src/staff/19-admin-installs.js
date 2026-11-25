/* ---------------- admin panel: installed app vs browser (/manage/installs). Claude, 2026-11-25 ----------------
   Data: app_events rows written by src/app/04-lesson-data-audio-pwa.js:
   app_open {standalone, os, browser} (once a day per user per mode), pwa_installed, install_prompt, install_guide.
   Tracking started 2026-11-25: people who installed earlier are counted the next time they open the app.
   Staff accounts (admin emails, teachers) are left out. */
async function apInstallsFetch(events, sinceISO) {
  var rows = [], page = 1000;
  for (var from = 0; from < 50000; from += page) {
    var r = await sb.from('app_events').select('user_id,event,meta,created_at')
      .in('event', events).gte('created_at', sinceISO).order('created_at', { ascending: true }).range(from, from + page - 1);
    if (r.error) throw r.error;
    rows = rows.concat(r.data || []);
    if (!r.data || r.data.length < page) break;
  }
  return rows;
}
async function apRenderInstalls(v) {
  v.innerHTML = apShell('installs',
    '<div class="ap-head"><h1>📲 App installs</h1><p class="muted">Who opens Muse from the installed app (home-screen icon) and who uses it in the browser. ' +
    'Tracking started on 25 Nov 2026; people who installed before that are counted the next time they open the app. Staff accounts are left out.</p></div>' +
    '<div id="ap-inst-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  var host = v.querySelector('#ap-inst-host');
  var since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  var since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  var rows, staff = {};
  try {
    var res = await Promise.all([
      apInstallsFetch(['app_open', 'pwa_installed', 'install_prompt', 'install_guide'], since30),
      sb.from('teachers').select('user_id'),
      sb.from('profiles').select('id').in('email', (APP_CONFIG.ADMIN_EMAILS || []))
    ]);
    rows = res[0];
    ((res[1] && res[1].data) || []).forEach(function (t) { if (t.user_id) staff[t.user_id] = 1; });
    ((res[2] && res[2].data) || []).forEach(function (p) { staff[p.id] = 1; });
  } catch (e) { rows = null; }
  if (!rows) { host.innerHTML = '<div class="empty">Could not load install data.</div>'; return; }
  rows = rows.filter(function (r) { return !staff[r.user_id]; });

  var summarize = function (sinceISO) {
    var opens = {}, inst = {}, os = {}, n = { installed: 0, prompt: {}, guide: 0, guideShortcut: 0, guideInapp: 0, copy: 0 };
    rows.forEach(function (r) {
      if (r.created_at < sinceISO) return;
      var m = r.meta || {};
      if (r.event === 'app_open') {
        opens[r.user_id] = 1;
        if (Number(m.standalone) === 1) inst[r.user_id] = 1;
        var o = os[m.os || 'other'] || (os[m.os || 'other'] = { users: {}, inst: {} });
        o.users[r.user_id] = 1; if (Number(m.standalone) === 1) o.inst[r.user_id] = 1;
      } else if (r.event === 'pwa_installed') n.installed++;
      else if (r.event === 'install_prompt') { var k = m.outcome || 'unknown'; n.prompt[k] = (n.prompt[k] || 0) + 1; }
      else if (r.event === 'install_guide') {
        if (m.action === 'open') { n.guide++; if (Number(m.can_prompt) === 1) n.guideShortcut++; if (String(m.browser || '').indexOf('inapp') === 0) n.guideInapp++; }
        else if (m.action === 'copy_link') n.copy++;
      }
    });
    var cnt = function (o) { return Object.keys(o).length; };
    return { opens: cnt(opens), inst: cnt(inst), os: os, n: n, cnt: cnt };
  };
  var w = summarize(since7), m = summarize(since30);
  var pct = function (a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; };
  var osRows = function (s) {
    var keys = Object.keys(s.os).sort(function (a, b) { return s.cnt(s.os[b].users) - s.cnt(s.os[a].users); });
    if (!keys.length) return '<div class="empty">No app opens recorded yet.</div>';
    return '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Device</th><th>Learners who opened the app</th><th>From the installed app</th><th>Share</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var u = s.cnt(s.os[k].users), i = s.cnt(s.os[k].inst);
        return '<tr><td>' + esc(k) + '</td><td>' + u + '</td><td>' + i + '</td><td>' + pct(i, u) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  };
  host.innerHTML =
    '<div class="ap-kpis">' +
      apKpi('Used the installed app, last 7 days', String(w.inst), pct(w.inst, w.opens) + ' of ' + w.opens + ' learners who opened Muse') +
      apKpi('Used the installed app, last 30 days', String(m.inst), pct(m.inst, m.opens) + ' of ' + m.opens + ' learners') +
      apKpi('Installs confirmed, last 30 days', String(m.n.installed), 'Android and computers only; iPhone never reports') +
      apKpi('Install window, last 30 days', (m.n.prompt.accepted || 0) + ' yes · ' + (m.n.prompt.dismissed || 0) + ' no', 'answers to the browser’s one-tap install window') +
    '</div>' +
    '<div class="card"><h3>By device, last 7 days</h3>' + osRows(w) + '</div>' +
    '<div class="card"><h3>By device, last 30 days</h3>' + osRows(m) + '</div>' +
    '<div class="card"><h3>Install guide, last 30 days</h3>' +
      '<p>Opened <b>' + m.n.guide + '</b> times. The one-tap shortcut was available in <b>' + m.n.guideShortcut + '</b> of them; ' +
      '<b>' + m.n.guideInapp + '</b> were inside another app’s browser (Instagram, Telegram…), where installing is impossible. ' +
      'Site link copied <b>' + m.n.copy + '</b> times.</p></div>';
}
