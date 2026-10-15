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

THINKING PROCESS (internal only — NEVER write this out):
The transcript comes from Whisper hearing a non-native speaker. Many "wrong words" are NOT grammar mistakes — they are PRONUNCIATION mistakes that made Whisper hear the wrong word. In your head, first reconstruct what the student most likely INTENDED to say: if a transcribed word is semantically odd in context BUT phonetically similar to a word that fits perfectly, the student almost certainly said the fitting word with bad pronunciation. Example: "Welcome to music village" in a Muse English podcast → they said "Muse English". Then analyze the INTENDED speech for real grammar mistakes.

OUTPUT RULES (critical):
- Output ONLY the JSON object. No introductions, no explanations, no markdown headers, no "Step 1/Step 2" labels, no reasoning text anywhere in the output.
- The "summary" field must be 2-3 sentences of plain assessment text — NEVER your internal reasoning.
- Build the pronunciation list first in your head; any phrase in it is FORBIDDEN from appearing in corrections. The same issue must never be in both lists.

GRAMMAR CHECK — read each sentence of the INTENDED speech word by word. For EVERY mistake you find, add one corrections entry. Check:
1. Is every verb in the right tense and form?
2. Does every subject agree with its verb? Is every countable noun correctly singular/plural?
3. Are articles (a/an/the) correct or missing?
4. Are prepositions correct?
Example: intended speech "Its related about job and careers. Two interviewer wanted to speak." →
corrections: [
 {"wrong":"Its related about job","right":"It's related to the job","why":"'Its' should be 'It's' (= it is); 'related about' should be 'related to'; 'job' needs 'the'"},
 {"wrong":"Two interviewer wanted","right":"Two interviewers wanted","why":"'two' needs plural: interviewers"}
]
Be this thorough. List up to 6. Never pad with fake mistakes.

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
      max_tokens: 2500,
      temperature: 0.3,
    });
    let rawResp = out && out.response ? out.response : '';
    /* model sometimes returns an object instead of a string */
    const text = (typeof rawResp === 'string' ? rawResp : JSON.stringify(rawResp)).trim();
    if (!text || text === '[object Object]' || text === '{}')
      return json({ error: 'AI_ANALYSIS_FAILED', debug: 'empty_response' }, 502);
    /* strip ```json fences the model sometimes adds despite the prompt */
    let clean = text;
    const fence = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence) clean = fence[1];
    let parsed = null;
    /* try: full JSON object */
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e) {} }
    /* fallback: score regex + friendly message (never raw model text to the user) */
    if (!parsed || typeof parsed.score === 'undefined') {
      const sm = clean.match(/["']?score["']?\s*[:=]\s*(\d{1,3})/i);
      if (sm) {
        parsed = {
          score: parseInt(sm[1], 10),
          summary: 'Your summary was scored ' + sm[1] + ' out of 100. The detailed AI feedback got cut off this time — record again for full grammar and pronunciation notes.',
          corrections: [],
          pronunciation: [],
          strengths: [],
        };
      }
    }
    if (!parsed) return json({ error: 'AI_ANALYSIS_FAILED' }, 502);
    const score = Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0));
    const pron = Array.isArray(parsed.pronunciation) ? parsed.pronunciation.slice(0, 5) : [];
    let corr = Array.isArray(parsed.corrections) ? parsed.corrections.slice(0, 6) : [];
    /* Hard dedup: drop any correction that overlaps a pronunciation suspect
       (the model keeps duplicating despite prompt rules). */
    const normW = function (s) {
      return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 2; });
    };
    corr = corr.filter(function (c) {
      const cw = normW((c.wrong || '') + ' ' + (c.right || ''));
      const cs = ((c.wrong || '') + ' ' + (c.right || '')).toLowerCase();
      for (const q of pron) {
        const qw = normW((q.heard || '') + ' ' + (q.likely || ''));
        const qs = ((q.heard || '') + ' ' + (q.likely || '')).toLowerCase();
        const shared = cw.filter(function (w) { return qw.indexOf(w) !== -1; });
        if (shared.length >= 2) return false;
        if (cs.indexOf(qs) !== -1 || qs.indexOf(cs) !== -1) return false;
      }
      return true;
    });
    let summaryTxt = String(parsed.summary || '');
    /* Safety net: if the model leaked chain-of-thought into summary, strip it */
    if (/step\s*1|intent\s*reconstruction|##\s*step/i.test(summaryTxt)) {
      const jm = summaryTxt.match(/\{[\s\S]*\}/);
      summaryTxt = jm ? summaryTxt : 'Summary analyzed. See corrections and pronunciation notes below.';
      /* try to salvage: take text after the last ## header */
      const parts = String(parsed.summary || '').split(/##+\s*/);
      const last = parts[parts.length - 1] || '';
      if (last.length > 20 && last.length < 500 && !/step\s*1/i.test(last)) summaryTxt = last.trim();
      else summaryTxt = 'Your summary was analyzed. Check the pronunciation and grammar sections below.';
    }
    return json({
      score: score,
      summary: summaryTxt,
      corrections: corr,
      pronunciation: pron,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
    });
  } catch (e) {
    return json({ error: 'AI_ANALYSIS_FAILED' }, 502);
  }
}
