/* ---------------- admin panel: Ask Muse usage and cost (/manage/ask-muse). Claude, 2026-11-14 ----------------
   Data: ai_chat_admin() in supabase/ask-muse.sql (admins only). Cost is computed by
   functions/api/assistant.js from DeepSeek's token counts (cache hits, misses, output) and prices. */
async function apRenderAskMuse(v) {
  v.innerHTML = apShell('ask-muse',
    '<div class="ap-head"><h1>🔥 Ask Muse</h1><p class="muted">The AI tutor chat in the app (DeepSeek, deepseek-flash, thinking off). ' +
    'Learners get 10 questions a day, VIP 50, teachers and admins 100.</p></div>' +
    '<div id="ap-askm-host"><div class="empty">Loading…</div></div>');
  apWireChrome(v);
  var host = v.querySelector('#ap-askm-host');
  var d = null;
  try { var r = await sb.rpc('ai_chat_admin', { p_days: 14 }); if (r.error) throw r.error; d = r.data; } catch (e) { d = null; }
  if (!d) { host.innerHTML = '<div class="empty">Could not load Ask Muse data.</div>'; return; }
  var days = d.days || [], recent = d.recent || [], l30 = d.last30 || {};
  var sum = function (k) { return days.reduce(function (a, x) { return a + Number(x[k] || 0); }, 0); };
  var hit = sum('hit'), miss = sum('miss'), out = sum('out'), reasoning = sum('reasoning');
  var hitPct = hit + miss ? Math.round(100 * hit / (hit + miss)) : 0;
  var usd = function (n) { n = Number(n || 0); return '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2)); };
  var q30 = Number(l30.questions || 0), c30 = Number(l30.cost_usd || 0);
  host.innerHTML =
    '<div class="ap-kpis">' +
      apKpi('Questions, last 30 days', String(q30), (l30.learners || 0) + ' learners') +
      apKpi('Cost, last 30 days', usd(c30), q30 ? usd(c30 / q30) + ' per question' : '') +
      apKpi('Input from cache (14 days)', hitPct + '%', 'billed 50× cheaper') +
      apKpi('Thinking tokens (14 days)', String(reasoning), reasoning ? 'should be 0: check the model settings' : 'off, as intended') +
    '</div>' +
    '<div class="card"><h3>Per day (Tehran time)</h3>' +
    (days.length ? '<div class="ap-tablewrap"><table class="ap-table"><thead><tr><th>Day</th><th>Questions</th><th>Learners</th>' +
      '<th>Cached input</th><th>New input</th><th>Output</th><th>Cost</th></tr></thead><tbody>' +
      days.map(function (x) {
        return '<tr><td>' + esc(x.day) + '</td><td>' + x.questions + '</td><td>' + x.learners + '</td><td>' + x.hit +
          '</td><td>' + x.miss + '</td><td>' + x.out + '</td><td>' + usd(x.cost_usd) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="empty">No questions yet.</div>') +
    '</div>' +
    '<div class="card"><h3>Latest questions</h3>' +
    (recent.length ? recent.map(function (m) {
      return '<div class="ap-askm-q"><div class="muted">' + esc((m.name || m.email || '').toString()) +
        (m.level ? ' · ' + esc(String(m.level).toUpperCase()) : '') + (m.view ? ' · ' + esc(m.view) : '') + ' · ' +
        esc(new Date(m.at).toLocaleString()) + '</div>' +
        '<div class="ap-askm-text" dir="auto"><b>Q:</b> ' + esc(m.question || '') + '</div>' +
        (m.answer ? '<div class="ap-askm-text muted" dir="auto"><b>A:</b> ' + esc(m.answer) + '</div>' : '<div class="muted">(no answer)</div>') +
        '</div>';
    }).join('') : '<div class="empty">No questions yet.</div>') +
    '</div>';
}
