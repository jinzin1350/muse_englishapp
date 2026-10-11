/* Cloudflare Pages Function: podcast summary scoring for the Muse English app.
 *
 * POST /api/summary-score   { transcript, podcastTitle, podcastTranscript, level }
 * -> { score, summary, corrections, feedback } | { error }
 *
 * The client records the user summarizing the podcast (up to 2 min),
 * transcribes via /api/transcribe, then posts the text here. Workers AI
 * (Llama) analyzes grammar, vocabulary and relevance to the podcast,
 * and returns a 0-100 score with corrections.
 *
 * Requires the same Workers AI binding named "AI" as /api/transcribe.
 * No API keys needed. Free tier: 10,000 neurons/day.
 */

const RATE_MAX = 20;
const RATE_WIN = 10 * 60 * 1000;
const rateMap = new Map();

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SYSTEM = `You are an expert English teacher scoring a student's spoken summary of a podcast episode in the "Muse English" app.

You receive:
1. The student's transcribed summary (spoken English, may contain transcription quirks — be generous with obvious ASR errors, strict with real grammar mistakes)
2. The podcast episode title and its transcript

Score 0-100 based on:
- GRAMMAR (40 pts): verb tenses, articles, prepositions, word order, subject-verb agreement
- VOCABULARY (25 pts): range, appropriateness, any words from the podcast reused well
- RELEVANCE (20 pts): does the summary actually reflect the podcast's content?
- FLUENCY signals (15 pts): sentence completeness, coherence, length (a 2-minute summary should have substance)

RULES:
- List up to 5 concrete grammar/vocabulary mistakes with corrections. Format each as: "❌ <their words>" then "✅ <corrected>". Skip trivial ASR artifacts.
- If the summary is off-topic or too short (<20 words), say so and score accordingly low.
- Feedback must be encouraging but honest. Write feedback in clear, simple English (the student is learning English).
- Respond ONLY with valid JSON: {"score": <0-100>, "summary": "<2-3 sentence assessment>", "corrections": [{"wrong": "...", "right": "...", "why": "..."}], "strengths": ["..."]}
- No markdown, no extra text outside the JSON.`;

export async function onRequestPost(context) {
  const { request, env } = context;

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  let rec = rateMap.get(ip);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + RATE_WIN };
  rec.count += 1;
  rateMap.set(ip, rec);
  if (rec.count > RATE_MAX) {
    return json({ error: 'Too many requests - please wait a few minutes and try again.' }, 429);
  }

  if (!env.AI) return json({ error: 'AI_NOT_CONFIGURED' }, 503);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: 'Invalid JSON body.' }, 400); }

  const transcript = String(body.transcript || '').trim();
  const podcastTitle = String(body.podcastTitle || '').trim();
  const podcastTranscript = String(body.podcastTranscript || '').trim().slice(0, 4000);
  const level = String(body.level || '').trim();

  if (transcript.length < 10) return json({ error: 'Transcript too short.' }, 400);
  if (transcript.length > 6000) return json({ error: 'Transcript too long.' }, 400);

  const userMsg = `Podcast title: ${podcastTitle}\nStudent level: ${level || 'unknown'}\n\nPodcast transcript (reference):\n${podcastTranscript}\n\nStudent's spoken summary (transcribed):\n${transcript}`;

  try {
    const out = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg },
      ],
      max_tokens: 1200,
      temperature: 0.3,
    });
    const text = (out && out.response ? String(out.response) : '').trim();
    if (!text) return json({ error: 'AI_ANALYSIS_FAILED' }, 502);
    let parsed = null;
    /* try: full JSON object */
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e) {} }
    /* fallback: score regex + raw text */
    if (!parsed || typeof parsed.score === 'undefined') {
      const sm = text.match(/["']?score["']?\s*[:=]\s*(\d{1,3})/i);
      if (sm) {
        parsed = {
          score: parseInt(sm[1], 10),
          summary: text.slice(0, 500),
          corrections: [],
          strengths: [],
        };
      }
    }
    if (!parsed) return json({ error: 'AI_ANALYSIS_FAILED' }, 502);
    const score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
    return json({
      score: score,
      summary: String(parsed.summary || ''),
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections.slice(0, 5) : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
    });
  } catch (e) {
    return json({ error: 'AI_ANALYSIS_FAILED' }, 502);
  }
}
