/* Cloudflare Pages Function: speech-to-text for the Shadowing speaking practice.
 *
 * POST /api/transcribe   multipart form-data, field "audio" (short clip, <= 2 MB)
 * -> { text } | { error }
 *
 * Used on iOS, where the Web Speech API exists but never returns results.
 * The client records with MediaRecorder, uploads the clip here, and Whisper
 * (Workers AI) returns the transcript — which then flows through the same
 * scoring code as the Android/desktop live-recognition path.
 *
 * Requires the same Workers AI binding named "AI" as /api/report (dashboard:
 * Pages project -> Settings -> Functions -> Add binding -> Workers AI).
 * No API keys needed. Free tier: 10,000 neurons/day shared with /api/report
 * (~15 neurons per 15-second clip).
 */

const RATE_MAX = 30;                   // transcriptions per window per IP
const RATE_WIN = 10 * 60 * 1000;
const rateMap = new Map();             // ip -> { count, reset } (per-isolate, best-effort)
const MAX_AUDIO = 2 * 1024 * 1024;     // 2 MB — a 15s phone clip is a few hundred KB

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  let rec = rateMap.get(ip);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + RATE_WIN };
  rec.count += 1;
  rateMap.set(ip, rec);
  if (rec.count > RATE_MAX) {
    return json({ error: 'Too many transcriptions - please wait a few minutes and try again.' }, 429);
  }

  if (!env.AI) {
    return json({ error: 'AI_NOT_CONFIGURED' }, 503);
  }

  let audioFile;
  try {
    const form = await request.formData();
    audioFile = form.get('audio');
  } catch (e) {
    return json({ error: 'Bad request.' }, 400);
  }
  if (!audioFile || typeof audioFile.arrayBuffer !== 'function' || audioFile.size > MAX_AUDIO || audioFile.size < 1000) {
    return json({ error: 'No usable audio received.' }, 400);
  }

  try {
    const bytes = new Uint8Array(await audioFile.arrayBuffer());
    const out = await env.AI.run('@cf/openai/whisper', { audio: Array.from(bytes) });
    const text = out && out.text ? String(out.text).trim() : '';
    if (!text) return json({ error: 'No speech detected.' }, 422);
    return json({ text: text.slice(0, 2000) });
  } catch (e) {
    return json({ error: 'Transcription failed right now. Please try again in a bit.' }, 502);
  }
}
