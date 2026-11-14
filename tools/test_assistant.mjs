/* Tests for functions/api/assistant.js (Ask Muse) with Supabase and DeepSeek mocked. Claude, 2026-11-14.
   node tools/test_assistant.mjs   (run by .github/workflows/app-check.yml)  */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Load functions/api/assistant.js as an ES module on any Node version (copy it to a .mjs file).
const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(mkdtempSync(join(tmpdir(), 'askm-')), 'assistant.mjs');
writeFileSync(tmp, readFileSync(join(here, '..', 'functions', 'api', 'assistant.js'), 'utf8'));
const { onRequestGet, onRequestPost, _test } = await import(pathToFileURL(tmp).href);

const fails = [];
function check(ok, msg) { if (!ok) fails.push(msg); console.log((ok ? 'ok   ' : 'FAIL ') + msg); }

const calls = [];
let mode = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), headers: init && init.headers, body });
  if (String(url).includes('/rest/v1/rpc/ai_chat_begin')) {
    if (mode.limit) return new Response(JSON.stringify({ ok: false, reason: 'limit', used: 10, limit: 10, vip: false }), { status: 200 });
    return new Response(JSON.stringify({
      ok: true, message_id: 7, nonce: 'n-123', used: 3, limit: 10, remaining: 7, vip: false,
      profile: 'LEARNER PROFILE\nLevel: A1 | Reply language: Persian',
      history: [{ role: 'user', content: '[Screen]\nScreen: home.\n[Learner]\nhi' }, { role: 'assistant', content: 'سلام!' }],
    }), { status: 200 });
  }
  if (String(url).includes('/rest/v1/rpc/ai_chat_finish')) return new Response('true', { status: 200 });
  if (String(url).includes('/rest/v1/rpc/ai_chat_fail')) return new Response('true', { status: 200 });
  if (String(url).includes('api.deepseek.com')) {
    if (mode.dsError) return new Response('{"error":"boom"}', { status: 500 });
    const chunks = [
      { choices: [{ delta: { role: 'assistant', content: '' } }] },
      { choices: [{ delta: { content: 'گذشته‌ی **go** میشه ' } }] },
      { choices: [{ delta: { content: '**went**.\n[[grammar:past-simple]]' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 4000, prompt_cache_hit_tokens: 3600, prompt_cache_miss_tokens: 400, completion_tokens: 60 } },
    ];
    const sse = chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
    // deliver in awkward pieces to test line buffering
    const enc = new TextEncoder().encode(sse);
    const stream = new ReadableStream({ start(ctl) { for (let i = 0; i < enc.length; i += 37) ctl.enqueue(enc.slice(i, i + 37)); ctl.close(); } });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return realFetch(url, init);
};

function req(body, token) {
  return new Request('https://museenglishapp.com/api/assistant', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.' + Math.floor(Math.random() * 250) },
      token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body),
  });
}
async function post(body, token, env) {
  const waits = [];
  const res = await onRequestPost({ request: req(body, token), env: env || { DEEPSEEK_API_KEY: 'k' }, waitUntil: p => waits.push(p) });
  const text = await res.text();
  await Promise.all(waits);
  return { res, text };
}

(async () => {
  // GET
  check((await (await onRequestGet({ env: {} })).json()).enabled === false, 'GET: disabled without DEEPSEEK_API_KEY');
  check((await (await onRequestGet({ env: { DEEPSEEK_API_KEY: 'k' } })).json()).enabled === true, 'GET: enabled with key');

  // no key / no token / bad body
  check((await post({ message: 'hi' }, 'tok', {})).res.status === 503, 'POST without key -> 503');
  check((await post({ message: 'hi' }, '')).res.status === 401, 'POST without login token -> 401');
  check((await post({ message: '' }, 'tok')).res.status === 400, 'POST with empty message -> 400');
  check((await post({ message: 'x'.repeat(801) }, 'tok')).res.status === 400, 'POST with 801-char message -> 400');

  // limit
  mode = { limit: true };
  const lim = await post({ message: 'hi' }, 'tok');
  check(lim.res.status === 429 && JSON.parse(lim.text).error === 'limit', 'daily limit -> 429 {error:"limit"}');
  check(!calls.some(c => c.url.includes('deepseek')), 'no DeepSeek call when the limit is reached');

  // normal answer
  mode = {}; calls.length = 0;
  const ctx = { view: 'quiz', level: 'a1', q: { kind: 'word', question: 'Past of go?', options: ['goed', 'went'], picked: 'goed', correct: 'went' } };
  const ok = await post({ message: 'چرا غلط بود؟', context: ctx, lang: 'fa' }, 'tok-1');
  check(ok.res.status === 200 && ok.res.headers.get('Content-Type').startsWith('text/event-stream'), 'answer streams as text/event-stream');
  const events = ok.text.split('\n\n').filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, '')));
  check(events[0].type === 'start' && events[0].remaining === 7, 'stream starts with remaining questions');
  const answer = events.filter(e => e.type === 'delta').map(e => e.t).join('');
  check(answer === 'گذشته‌ی **go** میشه **went**.\n[[grammar:past-simple]]', 'deltas join to the full answer');
  check(events[events.length - 1].type === 'done', 'stream ends with done');

  const begin = calls.find(c => c.url.includes('ai_chat_begin'));
  check(begin.headers.Authorization === 'Bearer tok-1', 'Supabase is called with the learner\'s own token');
  check(begin.body.p_prompt.startsWith('[Screen]\n') && begin.body.p_prompt.endsWith('[Learner]\nچرا غلط بود؟'), 'stored prompt = screen + learner text');
  check(begin.body.p_lang === 'fa' && begin.body.p_context.wrong === true, 'language and small context sent to the database');

  const ds = calls.find(c => c.url.includes('deepseek'));
  check(ds.body.model === 'deepseek-flash', 'model is deepseek-flash');
  check(ds.body.thinking && ds.body.thinking.type === 'disabled', 'thinking is disabled');
  check(ds.body.stream === true && ds.body.max_tokens <= 800, 'streaming on, answer length capped');
  const m = ds.body.messages;
  check(m[0].role === 'system' && m[0].content === _test.SYSTEM, 'message 1 = the shared system prompt');
  check(m[1].role === 'system' && m[1].content.startsWith('LEARNER PROFILE'), 'message 2 = the frozen learner profile');
  check(m[2].content === '[Screen]\nScreen: home.\n[Learner]\nhi' && m[3].role === 'assistant', 'earlier turns passed through exactly');
  check(m[m.length - 1].content === begin.body.p_prompt, 'last message = the new question');
  check(!/20\d\d-\d\d-\d\d|\d{1,2}:\d\d|\$\{/.test(_test.SYSTEM), 'system prompt has no date, time or template leftovers');
  check(_test.SYSTEM.includes('[[grammar:SLUG]]') && /past-simple: /.test(_test.SYSTEM), 'system prompt carries the link catalog');
  check(_test.SYSTEM.includes('ONLY ENGLISH-LEARNING QUESTIONS') && _test.SYSTEM.includes('من فقط به سؤال‌های زبان انگلیسی جواب میدم'),
    'system prompt refuses questions that are not about English');

  const fin = calls.find(c => c.url.includes('ai_chat_finish'));
  check(fin && fin.body.p_nonce === 'n-123' && fin.body.p_message_id === 7, 'answer saved with the nonce');
  check(fin && fin.body.p_body === answer, 'saved answer = streamed answer');
  const u = fin.body.p_usage;
  check(u.hit === 3600 && u.miss === 400 && u.out === 60 && u.reasoning === 0, 'usage recorded (cache hits, misses, output, no thinking)');
  const peakCost = (3600 * 0.006 + 400 * 0.30 + 60 * 1.20) / 1e6;
  check(Math.abs(u.cost_usd - (u.peak ? peakCost : peakCost / 2)) < 1e-9, 'cost computed from DeepSeek prices (' + u.cost_usd + ' USD)');

  // same screen -> same text (cache-stable)
  check(_test.userTurn('a', ctx) === _test.userTurn('a', JSON.parse(JSON.stringify(ctx))), 'same screen gives byte-identical prompt');

  // DeepSeek failure -> question marked failed (not counted)
  mode = { dsError: true }; calls.length = 0;
  const bad = await post({ message: 'hi' }, 'tok');
  check(bad.res.status === 502, 'DeepSeek error -> 502');
  const f = calls.find(c => c.url.includes('ai_chat_fail'));
  check(f && f.body.p_nonce === 'n-123', 'failed question marked with ai_chat_fail (quota given back)');

  // peak hours
  check(_test.isPeak(new Date('2026-11-16T02:00:00Z')) && !_test.isPeak(new Date('2026-11-16T05:00:00Z')) &&
        !_test.isPeak(new Date('2026-11-15T02:00:00Z')), 'peak hours: Mon-Fri 01-04 and 06-10 UTC');

  if (fails.length) { console.log('\ntest_assistant: ' + fails.length + ' failure(s)'); process.exit(1); }
  console.log('\ntest_assistant: all passed');
})().catch(e => { console.log('FAIL crashed: ' + e.stack); process.exit(1); });
