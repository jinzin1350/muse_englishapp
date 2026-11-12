/* ---------------- soft push prompt (Alireza, 2026-11-12) ----------------
   A friendly in-app ask BEFORE the browser permission dialog: shown once,
   right after the learner saves their very first word — the moment review
   reminders become relevant. The browser prompt only appears if they tap
   "Yes" here, which keeps acceptance high and never burns the browser
   prompt on a cold ask. The manual Enable buttons (Home card, Profile)
   still go straight to promptPush. */
function maybeSoftPushPrompt(kind) {
  try {
    if (!state.user || state.user.demo || state.user.isAdmin) return;
    if (!oneSignalReady() || pushSubscribed()) return;
    if (!('Notification' in window) || Notification.permission === 'denied') return;
    if (localStorage.getItem('el_push_soft_asked') === '1') return;
    if (kind === 'quiz') { scheduleQuizSoftPrompt(0); return; }
    if (((state.savedWords || []).length) !== 1) return;
    localStorage.setItem('el_push_soft_asked', '1');
    setTimeout(function () { showSoftPushPrompt('save'); }, 400);
  } catch (e) {}
}
/* The quiz prompt waits until no other modal is up (results/celebration
   first), retrying a few times; the asked-flag is set only when it shows. */
function scheduleQuizSoftPrompt(tries) {
  setTimeout(function () {
    try {
      if (localStorage.getItem('el_push_soft_asked') === '1') return;
      if (document.getElementById('app-modal')) { if (tries < 3) scheduleQuizSoftPrompt(tries + 1); return; }
      localStorage.setItem('el_push_soft_asked', '1');
      showSoftPushPrompt('quiz');
    } catch (e) {}
  }, 1500);
}
function showSoftPushPrompt(kind) {
  const fa = uiLang() === 'fa';  /* same rule as the Persian app UI (A1–B1, Profile › App language) */
  if (kind === 'quiz') {
    const T = function (en) { if (fa) { var r = faLookup(en); if (r != null) return r; } return en; };
    const qhtml = (fa ? '<div dir="rtl" style="text-align:right">' : '<div>') +
      '<div class="modal-ico">\uD83D\uDD14</div>' +
      '<h2>' + esc(T('Daily lesson reminder')) + '</h2>' +
      '<p class="muted">' + esc(T('A new lesson is ready for you every day at 8 AM. Want a short notification when it’s ready?')) + '</p>' +
      '<button class="btn btn-orange btn-block" id="soft-push-yes" style="padding:0.95rem 1rem;font-size:1.05rem;border-radius:14px;margin-top:0.8rem">' + esc(T('Yes, notify me')) + '</button>' +
      '<button class="btn btn-block" id="soft-push-no" style="background:#FFF8EE;border:1.5px solid #EBD5B8;color:#8C5A28;font-weight:700;padding:0.9rem 1rem;font-size:1rem;border-radius:14px;margin-top:0.6rem;box-shadow:0 2px 8px rgba(160,110,40,.10);cursor:pointer">' + esc(T('Not now')) + '</button></div>';
    const qov = showModal(qhtml);
    qov.querySelector('#soft-push-yes').addEventListener('click', function () { closeModal(); promptPush(null); });
    qov.querySelector('#soft-push-no').addEventListener('click', function () { closeModal(); });
    return;
  }
  const html = fa
    ? '<div dir="rtl" style="text-align:right"><div class="modal-ico">\uD83D\uDD14</div>' +
      '<h2>یادآوری مرور لغت‌ها</h2>' +
      '<p class="muted">لغت‌هایی که ذخیره می‌کنی سر وقت برای مرور برمی‌گردن \uD83D\uDD01 دوست داری اون موقع یادت بندازیم؟</p>' +
      '<button class="btn btn-orange btn-block" id="soft-push-yes" style="padding:0.95rem 1rem;font-size:1.05rem;border-radius:14px;margin-top:0.8rem">آره، یادم بنداز</button>' +
      '<button class="btn btn-block" id="soft-push-no" style="background:#FFF8EE;border:1.5px solid #EBD5B8;color:#8C5A28;font-weight:700;padding:0.9rem 1rem;font-size:1rem;border-radius:14px;margin-top:0.6rem;box-shadow:0 2px 8px rgba(160,110,40,.10);cursor:pointer">فعلاً نه</button></div>'
    : '<div class="modal-ico">\uD83D\uDD14</div>' +
      '<h2>Word review reminders</h2>' +
      '<p class="muted">The words you save come back for review right on time \uD83D\uDD01 Want a reminder when they do?</p>' +
      '<button class="btn btn-orange btn-block" id="soft-push-yes" style="padding:0.95rem 1rem;font-size:1.05rem;border-radius:14px;margin-top:0.8rem">Yes, remind me</button>' +
      '<button class="btn btn-block" id="soft-push-no" style="background:#FFF8EE;border:1.5px solid #EBD5B8;color:#8C5A28;font-weight:700;padding:0.9rem 1rem;font-size:1rem;border-radius:14px;margin-top:0.6rem;box-shadow:0 2px 8px rgba(160,110,40,.10);cursor:pointer">Not now</button>';
  const ov = showModal(html);
  ov.querySelector('#soft-push-yes').addEventListener('click', function () { closeModal(); promptPush(null); });
  ov.querySelector('#soft-push-no').addEventListener('click', function () { closeModal(); });
}

/* ---------------- scores & mistakes: per-user on Supabase, localStorage fallback ---------------- */
function cloudReady() {
  return !!(typeof sb !== 'undefined' && sb && state.user && !state.user.demo && state.user.id);
}
function lsKey(kind) {
  const email = state.user ? state.user.email : 'anon';
  return 'ela_' + kind + '_' + email;
}
function lsGet(kind) {
  try { return JSON.parse(localStorage.getItem(lsKey(kind)) || '[]'); }
  catch (e) { return []; }
}
function lsSet(kind, val) {
  try { localStorage.setItem(lsKey(kind), JSON.stringify(val)); } catch (e) {}
}
function rowToMistake(r) {
  return { id: r.id, date: r.date, level: r.level, kind: r.kind,
           question: r.question, options: r.options || [], answer: r.answer, picked: r.picked };
}
function rowToAttempt(r) {
  return { id: r.id, ts: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
           date: r.date, level: r.level, theme: r.theme, kind: r.kind, score: r.score, total: r.total,
           missed: r.missed || null };
}
async function getMistakes() {
  if (cloudReady()) {
    try {
      const res = await sb.from('mistakes').select('*')
        .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(500);
      if (!res.error && res.data) return res.data.map(rowToMistake);
    } catch (e) {}
  }
  return lsGet('mistakes');
}
async function getAttempts() {
  if (cloudReady()) {
    try {
      const res = await sb.from('quiz_attempts').select('*')
        .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(200);
      if (!res.error && res.data) return res.data.map(rowToAttempt);
    } catch (e) {}
  }
  return lsGet('scores');
}
async function saveAttempt(a) {
  const rec = Object.assign({ ts: Date.now() }, a);
  /* Missed-question snapshot (2026-11-02): mirrored into a per-device
     archive immediately, and into the cloud row's `missed` jsonb column
     once the migration has run — the insert retries without the column
     until then, so nothing breaks before it. */
  if (a.missed && a.missed.length) saveAttemptMissedLocal(rec);
  if (cloudReady()) {
    try {
      const payload = {
        user_id: state.user.id, date: a.date || null, level: a.level || null,
        theme: a.theme || null, kind: a.kind || null, score: a.score, total: a.total
      };
      if (a.missed) payload.missed = a.missed;
      let res = await sb.from('quiz_attempts').insert(payload);
      if (res.error && a.missed) { delete payload.missed; res = await sb.from('quiz_attempts').insert(payload); }
      if (!res.error) return;
    } catch (e) {}
  }
  const arr = lsGet('scores');
  arr.unshift(rec);
  lsSet('scores', arr.slice(0, 200));
}
function attSnapKey(x) {
  return (x.date || '') + '|' + (x.kind || '') + '|' + (x.theme || '') + '|' + x.score + '/' + x.total;
}
function saveAttemptMissedLocal(rec) {
  const arch = lsGet('attemptMissed');
  arch.unshift({ key: attSnapKey(rec), ts: rec.ts, missed: rec.missed });
  lsSet('attemptMissed', arch.slice(0, 100));
}
function getAttemptMissedLocal(a) {
  const arch = lsGet('attemptMissed');
  if (!arch.length) return null;
  const k = attSnapKey(a);
  const hit = arch.find(function (e) { return e.key === k; });
  if (hit) return hit.missed;
  const head = k.split('|').slice(0, 3).join('|');
  const cand = arch.filter(function (e) { return e.key.split('|').slice(0, 3).join('|') === head; });
  return cand.length ? cand[0].missed : null;
}
async function saveMistake(m) {
  if (cloudReady()) {
    try {
      const dup = await sb.from('mistakes').select('id')
        .eq('user_id', state.user.id).eq('question', m.question).limit(1);
      if (!dup.error && dup.data && dup.data.length) return;
      const res = await sb.from('mistakes').insert({
        user_id: state.user.id, date: m.date || null, level: m.level || null, kind: m.kind || null,
        question: m.question, options: m.options || [], answer: m.answer,
        picked: (typeof m.picked === 'number' ? m.picked : null)
      });
      if (!res.error) return;
    } catch (e) {}
  }
  const arr = lsGet('mistakes');
  if (!arr.some(function (x) { return x.question === m.question && x.date === m.date; })) {
    arr.unshift(Object.assign({ id: uid() }, m));
    lsSet('mistakes', arr.slice(0, 500));
  }
}
/* Mistake graduation (his design 2026-11-08): a mistake leaves the list
   only after 3 correct answers in separate sittings, spaced along the
   forgetting curve — correct #1 -> due tomorrow, #2 -> due in 3 days,
   #3 -> graduated (removed). A wrong answer resets the streak to 0 and
   re-dues it tomorrow. Schedule: localStorage muse_mistakes_srs_v1 keyed
   by mistake id, synced across devices through user_kv. */
function mistakeSrsGet() { try { return JSON.parse(localStorage.getItem('muse_mistakes_srs_v1') || '{}'); } catch (e) { return {}; } }
function mistakeSrsSet(map) { try { localStorage.setItem('muse_mistakes_srs_v1', JSON.stringify(map)); } catch (e) {} try { kvSchedulePush('muse_mistakes_srs_v1'); } catch (e) {} }
function mistakeEntry(id) { return mistakeSrsGet()[id] || { s: 0, due: null }; }
function mistakeDue(id) { const e = mistakeEntry(id); return !e.due || e.due <= todayStr(); }
function mistakeGrade(id, correct) {
  if (!id) return;
  const map = mistakeSrsGet();
  const e = map[id] || { s: 0, due: null };
  if (correct) {
    e.s = (e.s || 0) + 1;
    if (e.s >= 3) { delete map[id]; mistakeSrsSet(map); removeMistake(id); return; }
    e.due = srsAddDays(todayStr(), e.s === 1 ? 1 : 3);
  } else {
    e.s = 0;
    e.due = srsAddDays(todayStr(), 1);
  }
  map[id] = e;
  mistakeSrsSet(map);
}
/* The card number counts what can be answered TODAY (due), not every open
   mistake — resting ones would promise a session that is not there. */
function mistakesDueCount(arr) { return arr.filter(function (m) { return mistakeDue(m.id); }).length; }
/* Home mistakes tap with nothing due: say so on the spot instead of
   opening an empty page (his order 2026-11-08). */
function showMistakesNotice(total) {
  if (document.getElementById('mistakes-notice')) return;
  const d = document.createElement('div');
  d.className = 'duo-modal-wrap';
  d.id = 'mistakes-notice';
  d.innerHTML = '<div class="duo-modal"><h3>No mistake review for now \u2713</h3>' +
    '<p>' + (total ? 'Your ' + total + ' mistake' + (total === 1 ? ' is' : 's are') + ' resting \u2014 they come back tomorrow, so the fix sticks.' : 'Nothing to review \u2014 nice work! \uD83C\uDF89') + '</p>' +
    '<button class="duo-continue btn-block" id="mistakes-notice-ok">Got it</button></div>';
  $('#view').appendChild(d);
  document.getElementById('mistakes-notice-ok').onclick = function () { d.remove(); };
  d.addEventListener('click', function (e) { if (e.target === d) d.remove(); });
}
function mistakesCardDesc(arr) {
  if (mistakesDueCount(arr)) return '3 spaced correct answers clear it';
  if (arr.length) return arr.length + ' resting \u2014 back tomorrow';
  return 'Nothing to review \u2014 nice work! \uD83C\uDF89';
}
function mistakeDots(id) {
  const e = mistakeEntry(id);
  const s = e.s || 0;
  const dots = [0, 1, 2].map(function (i) { return i < s ? '\u25CF' : '\u25CB'; }).join(' ');
  const dueTxt = (e.due && e.due > todayStr()) ? ' \u00B7 next review ' + e.due : '';
  return dots + '  ' + s + ' of 3 correct' + dueTxt;
}
async function removeMistake(id) {
  if (cloudReady()) {
    try {
      const res = await sb.from('mistakes').delete().eq('id', id).eq('user_id', state.user.id);
      if (!res.error) return;
    } catch (e) {}
  }
  lsSet('mistakes', lsGet('mistakes').filter(function (x) { return x.id !== id; }));
}
/* ---------------- saved / bookmarked words ----------------
   Hard words the user bookmarks from lesson word cards, to review and
   practice later in the Review tab. Cloud table `saved_words` when signed
   in (falls back to localStorage, same pattern as mistakes). */
function savedWordKey(word, date) { return String(word || '').toLowerCase() + '|' + (date || ''); }
async function getSavedWords() {
  if (cloudReady()) {
    try {
      const res = await sb.from('saved_words').select('*')
        .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(500);
      if (!res.error && res.data) { state.savedWords = res.data; return res.data; }
    } catch (e) {}
  }
  const arr = lsGet('savedWords');
  state.savedWords = arr;
  return arr;
}
function isWordSaved(word, date) {
  const k = savedWordKey(word, date);
  return (state.savedWords || lsGet('savedWords')).some(function (x) {
    return savedWordKey(x.word, x.lesson_date) === k;
  });
}
/* `data` (optional): pre-mapped fields in lesson-word shape, used by callers
   outside a lesson (vocabulary pages) so the saved row still carries the
   meaning / example / Persian / audio / photo. */
async function toggleSaveWord(word, date, data) {
  const m = state.lesson;
  const w = data || ((m && m.words) || []).find(function (x) { return x.word === word; }) || { word: word };
  const lvl = (data && data.level) || (m && m.level) || '';
  const k = savedWordKey(word, date);
  const wasSaved = isWordSaved(word, date);
  if (cloudReady()) {
    try {
      if (wasSaved) {
        /* Delete by row id when known: an eq() on a NULL lesson_date
           (vocabulary saves) never matches in Postgres. */
        const row = (state.savedWords || []).find(function (x) { return savedWordKey(x.word, x.lesson_date) === k; });
        if (row && row.id) {
          await sb.from('saved_words').delete().eq('id', row.id).eq('user_id', state.user.id);
        } else {
          await sb.from('saved_words').delete().eq('user_id', state.user.id)
            .eq('word', word).eq('lesson_date', date || null);
        }
      } else {
        await sb.from('saved_words').insert({
          user_id: state.user.id, word: word, level: lvl || null, lesson_date: date || null,
          meaning: w.meaning || '', pronunciation: w.pronunciation || '', example: w.example || '',
          persian: w.persian || '', pos: w.pos || '', word_audio: w.word_audio || '', photo: w.photo || ''
        });
      }
      await getSavedWords();
      return !wasSaved;
    } catch (e) {}
  }
  const arr = lsGet('savedWords');
  if (wasSaved) lsSet('savedWords', arr.filter(function (x) { return savedWordKey(x.word, x.lesson_date) !== k; }));
  else {
    arr.unshift({ id: uid(), word: word, level: lvl, lesson_date: date || '',
      meaning: w.meaning || '', pronunciation: w.pronunciation || '', example: w.example || '',
      persian: w.persian || '', pos: w.pos || '', word_audio: w.word_audio || '', photo: w.photo || '' });
    lsSet('savedWords', arr.slice(0, 500));
  }
  state.savedWords = lsGet('savedWords');
  return !wasSaved;
}
async function removeSavedWord(id, word, date) {
  if (cloudReady() && id) {
    try {
      const res = await sb.from('saved_words').delete().eq('id', id).eq('user_id', state.user.id);
      if (!res.error) { await getSavedWords(); return; }
    } catch (e) {}
  }
  const k = savedWordKey(word, date);
  lsSet('savedWords', lsGet('savedWords').filter(function (x) {
    return String(x.id) !== String(id) && savedWordKey(x.word, x.lesson_date) !== k;
  }));
  state.savedWords = lsGet('savedWords');
}
/* Paint the saved state onto already-rendered word-card bookmark buttons
   (no full tab re-render, so nothing flickers). */
async function refreshSavedWordButtons(body) {
  const arr = await getSavedWords();
  const set = {};
  arr.forEach(function (x) { set[savedWordKey(x.word, x.lesson_date)] = 1; });
  body.querySelectorAll('.save-word-btn[data-action="toggle-save-word"]').forEach(function (b) {
    b.classList.toggle('saved', !!set[savedWordKey(b.getAttribute('data-word'), b.getAttribute('data-date'))]);
  });
}
async function toggleSaveWordBtn(btn) {
  btn.disabled = true;
  let nowSaved = false;
  try {
    nowSaved = await toggleSaveWord(btn.getAttribute('data-word'), btn.getAttribute('data-date'));
    btn.classList.toggle('saved', nowSaved);
  } finally { btn.disabled = false; }
  if (nowSaved) maybeSoftPushPrompt();
}
/* ---------------- saved-word spaced repetition (Alireza, 2026-11-06) ----
   Bookmarked words join a spaced-repetition cycle so the app brings them
   back on later days: first review the day after saving, then doubling
   intervals (1, 2, 4, 8, 16, 32, 60 days). A correct answer doubles the
   interval; a wrong answer restarts at 1 day — the same rules as the word
   deck. v1 kept the schedule in localStorage keyed by lowercase word.
   v2 (2026-11-06, his call for the server version + push): the schedule
   lives on the saved_words rows themselves (srs_interval / srs_due /
   srs_asked / srs_correct) whenever the row carries one, so it follows
   the user across devices and the nightly job can push a reminder when
   words come due. localStorage remains the offline/demo fallback. */
var SRS_KEY = 'muse_saved_srs_v1';
function srsGet() {
  try {
    const o = JSON.parse(localStorage.getItem(SRS_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) { return {}; }
}
function srsSet(map) {
  try { localStorage.setItem(SRS_KEY, JSON.stringify(map || {})); } catch (e) {}
}
function srsAddDays(ds, n) {
  const d = new Date(ds + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
/* Ensure a schedule entry exists for a saved row. First review: the day
   after the save date when known (cloud rows carry created_at), otherwise
   today — so older bookmarks are due immediately (catch-up). */
function srsEntryFor(map, row) {
  const k = String((row && row.word) || '').toLowerCase();
  if (!k) return null;
  if (row.srs_due) {
    return { i: row.srs_interval || 1, due: String(row.srs_due).slice(0, 10),
             asked: row.srs_asked || 0, correct: row.srs_correct || 0, cloud: true };
  }
  if (!map[k]) {
    const first = row.created_at ? srsAddDays(String(row.created_at).slice(0, 10), 1) : todayStr();
    map[k] = { i: 1, due: first, asked: 0, correct: 0 };
  }
  return map[k];
}
/* Saved rows whose review is due today or overdue (one per unique word). */
function srsDueRows(arr) {
  const map = srsGet();
  const t = todayStr();
  const out = [];
  const seen = {};
  let dirty = false;
  (arr || []).forEach(function (row) {
    if (!row || !row.word) return;
    const k = String(row.word).toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    const had = !!map[k] || !!row.srs_due;
    const e = srsEntryFor(map, row);
    if (!had) dirty = true;
    if (e && e.due <= t) out.push(row);
  });
  if (dirty) srsSet(map);
  return out;
}
function srsDueCount(arr) { return srsDueRows(arr).length; }
/* Short label for a saved row's next review: 'Due today' / 'Tomorrow' /
   'in N days'. Enrolls the word on the fly, like srsDueRows. */
function srsLabelFor(row) {
  const map = srsGet();
  const had = !!map[String((row && row.word) || '').toLowerCase()] || !!(row && row.srs_due);
  const e = srsEntryFor(map, row);
  if (!had) srsSet(map);
  if (!e) return '';
  const days = Math.round((new Date(e.due + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 86400000);
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Tomorrow';
  return 'in ' + days + ' days';
}
/* Grade one answered bookmark question: correct doubles the interval
   (cap 60), wrong restarts at 1 day; next due = today + interval. */
function srsGrade(word, correct) {
  const k = String(word || '').toLowerCase();
  if (!k) return;
  const map = srsGet();
  /* Base the grade on the server entry when the word has one — a fresh
     device's empty local map must never reset a long interval to 1. */
  let base = null;
  (state.savedWords || []).forEach(function (r) {
    if (!base && r && r.srs_due && String(r.word || '').toLowerCase() === k) {
      base = { i: r.srs_interval || 1, due: String(r.srs_due).slice(0, 10),
               asked: r.srs_asked || 0, correct: r.srs_correct || 0 };
    }
  });
  const e = map[k] || base || { i: 1, due: todayStr(), asked: 0, correct: 0 };
  e.asked = (e.asked || 0) + 1;
  if (correct) {
    e.correct = (e.correct || 0) + 1;
    e.i = Math.min((e.i || 1) * 2, 60);
  } else {
    e.i = 1;
  }
  e.due = srsAddDays(todayStr(), e.i);
  map[k] = e;
  srsSet(map);
  srsGradeCloud(k, e);
}
/* Write a graded schedule back to the word's saved_words rows
   (fire-and-forget: the local map above is the offline record, and a
   pre-migration database simply answers with an error we ignore). The
   in-memory rows are updated too, so due badges refresh without a refetch. */
function srsGradeCloud(k, e) {
  if (!cloudReady()) return;
  (state.savedWords || []).forEach(function (r) {
    if (!r || !r.id || String(r.word || '').toLowerCase() !== k) return;
    r.srs_interval = e.i; r.srs_due = e.due; r.srs_asked = e.asked; r.srs_correct = e.correct;
    try {
      sb.from('saved_words').update({
        srs_interval: e.i, srs_due: e.due, srs_asked: e.asked, srs_correct: e.correct
      }).eq('id', r.id).eq('user_id', state.user.id).then(function () {}, function () {});
    } catch (err) {}
  });
}



/* ---------------- cross-device sync for local progress blobs ----------------
   Word Map state (muse_wordmap_v1) and the Tricky Bits schedule
   (muse_tricky_v1) are single JSON blobs per user. They sync through the
   user_kv table: pull once per session (cloud wins when newer and there
   are no unpushed local writes), push debounced on every write; last
   write wins by updated_at. All fire-and-forget — before the user_kv
   migration runs, the calls fail silently and local remains the working
   record, the same pattern as saved-word SRS cloud writes. */
var KV_SYNC_KEYS = ['muse_wordmap_v1', 'muse_tricky_v1', 'muse_mistakes_srs_v1'];
function kvMetaAll() {
  try { return JSON.parse(localStorage.getItem('muse_kv_meta') || '{}') || {}; }
  catch (e) { return {}; }
}
function kvMetaSet(m) {
  try { localStorage.setItem('muse_kv_meta', JSON.stringify(m)); } catch (e) {}
}
function kvLocalEmpty(lsKey) {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey) || 'null');
    if (!v) return true;
    if (lsKey === 'muse_wordmap_v1') return !(v.words && Object.keys(v.words).length);
    return !Object.keys(v).length;
  } catch (e) { return true; }
}
async function kvPush(lsKey) {
  if (!cloudReady() || !state.user) return;
  let val = null;
  try { val = JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch (e) {}
  if (val === null) return;
  const meta = kvMetaAll();
  const m = meta[lsKey] || { u: 0, dirty: false };
  const stamp = new Date(Math.max(Date.now(), (m.u || 0) + 1)).toISOString();
  try {
    const res = await sb.from('user_kv').upsert(
      { user_id: state.user.id, key: lsKey, value: val, updated_at: stamp },
      { onConflict: 'user_id,key' });
    if (res && res.error) return;
    m.u = Date.parse(stamp); m.dirty = false; meta[lsKey] = m; kvMetaSet(meta);
  } catch (e) {}
}
var _kvTimers = {};
function kvSchedulePush(lsKey) {
  const meta = kvMetaAll();
  const m = meta[lsKey] || { u: 0, dirty: false };
  m.u = Date.now(); m.dirty = true; meta[lsKey] = m; kvMetaSet(meta);
  if (!cloudReady()) return;
  if (_kvTimers[lsKey]) clearTimeout(_kvTimers[lsKey]);
  _kvTimers[lsKey] = setTimeout(function () { kvPush(lsKey); }, 1200);
}
async function kvPullAll() {
  if (state._kvPulled || !cloudReady() || !state.user) return;
  state._kvPulled = true;
  let rows = [];
  try {
    const res = await sb.from('user_kv').select('key,value,updated_at').eq('user_id', state.user.id);
    if (res && !res.error && Array.isArray(res.data)) rows = res.data;
    else return;
  } catch (e) { return; }
  const byKey = {};
  rows.forEach(function (r) { byKey[r.key] = r; });
  const meta = kvMetaAll();
  let changed = false;
  for (let ki = 0; ki < KV_SYNC_KEYS.length; ki++) {
    const lsKey = KV_SYNC_KEYS[ki];
    const m = meta[lsKey] || { u: 0, dirty: false };
    const row = byKey[lsKey];
    if (row) {
      const cloudU = Date.parse(row.updated_at) || 0;
      if (m.dirty && (m.u || 0) >= cloudU) {
        kvPush(lsKey);
      } else if (cloudU > (m.u || 0)) {
        try { localStorage.setItem(lsKey, JSON.stringify(row.value)); } catch (e) {}
        m.u = cloudU; m.dirty = false; meta[lsKey] = m; changed = true;
      }
    } else if (!kvLocalEmpty(lsKey)) {
      kvPush(lsKey);
    }
  }
  kvMetaSet(meta);
  if (changed) { try { onRoute(); } catch (e) {} }
}

