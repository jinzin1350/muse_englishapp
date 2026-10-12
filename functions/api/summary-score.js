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

CRITICAL TWO-STAGE PROCESS — follow exactly:

STAGE 1 — INTENT RECONSTRUCTION (do this FIRST, silently):
The transcript comes from Whisper hearing a non-native speaker. Many "wrong words" are NOT grammar mistakes — they are PRONUNCIATION mistakes that made Whisper hear the wrong word. Before any grammar analysis, reconstruct what the student most likely INTENDED to say:
- If a transcribed word is semantically odd in context BUT phonetically similar to a word that fits perfectly, the student almost certainly said the fitting word with bad pronunciation. Example: "Welcome to music village" in a Muse English podcast → they said "Muse English". Example: "every adult sings about" → they said "thinks about" (th→s mispronunciation). Example: "real large stories" → "real-life stories".
- Build the INTENDED version of the whole summary in your head.

STAGE 2 — ANALYZE THE *INTENDED* SPEECH (not the raw transcript):
- FIRST write the full pronunciation list. THEN, before writing any grammar correction, check every candidate against that list: if the words overlap AT ALL (same phrase, same region of the sentence), it goes in pronunciation ONLY and is FORBIDDEN in corrections. Example of FORBIDDEN duplication: pronunciation has "sings about → thinks about" and corrections also has "sings about → thinks about" — this must never happen.
- GRAMMAR CORRECTIONS: list up to 5 REAL grammar/vocabulary mistakes from the INTENDED speech — mistakes the student actually made in their head, not Whisper's mishearings. If after reconstruction there are fewer than 5 real mistakes, list fewer — do not pad, do not invent.
- PRONUNCIATION SUSPECTS: list up to 5 entries as {"heard": "<what Whisper wrote>", "likely": "<what they meant>", "why": "<one-line explanation>"}. Only when (a) heard word is semantically odd AND (b) a similar-sounding alternative fits clearly better.

Score 0-100 based on the INTENDED speech:
- GRAMMAR (35 pts): verb tenses, articles, prepositions, word order, subject-verb agreement — of what they MEANT to say
- PRONUNCIATION (20 pts): deducted per pronunciation suspect (fewer = better)
- VOCABULARY (20 pts): range, appropriateness, podcast words reused well
- RELEVANCE (15 pts): does the summary reflect the podcast's content?
- FLUENCY (10 pts): sentence completeness, coherence, substance

RULES:
- The same issue must NEVER appear in both "corrections" and "pronunciation".
- If the summary is off-topic or too short (<20 words), say so and score low.
- Feedback encouraging but honest, in clear simple English.
- Respond ONLY with valid JSON: {"score": <0-100>, "summary": "<2-3 sentence assessment>", "corrections": [{"wrong": "...", "right": "...", "why": "..."}], "pronunciation": [{"heard": "...", "likely": "...", "why": "..."}], "strengths": ["..."]}
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
    let rawResp = out && out.response ? out.response : '';
    /* model sometimes returns an object instead of a string */
    const text = (typeof rawResp === 'string' ? rawResp : JSON.stringify(rawResp)).trim();
    if (!text || text === '[object Object]' || text === '{}')
      return json({ error: 'AI_ANALYSIS_FAILED', debug: 'empty_response' }, 502);
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
      pronunciation: Array.isArray(parsed.pronunciation) ? parsed.pronunciation.slice(0, 5) : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
    });
  } catch (e) {
    return json({ error: 'AI_ANALYSIS_FAILED' }, 502);
  }
}
