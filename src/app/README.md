# src/app and src/staff: the app's source

`js/main.js` used to be one 20,000-line file. On 2026-11-12 Claude cut it into these files at its
own section headers, in the same order. `tools/build_app.py` glues them back together:

- `src/app/*.js` → `js/main.js`: everything learners use. Every visitor downloads this.
- `src/staff/*.js` → `js/staff.js`: teacher dashboard, teacher portal (`/teachers`), admin views and the
  admin panel (`/manage`). Learners never download it (about 70 KB gzip saved on every learner's first
  visit). `js/main.js` fetches it the first time a teacher or admin opens one of those pages
  (`06a-staff-loader.js`) and runs it inside the same scope, so staff code can still call any app helper.

How to change the app:
1. `git fetch origin && git reset --hard origin/main` (start from the current code, never from an old copy)
2. edit the right file here (search by function name: `grep -n "function renderProfile" src/app/*.js`)
3. `python3 tools/build_app.py`  (writes js/main.js, js/staff.js and the ?v= hashes in index.html)
4. `python3 tools/check_app.py`  (must say "all checks passed")
5. `git diff --stat origin/main` must show only your change, then commit `src/…`, `js/main.js`,
   `js/staff.js`, `index.html`

Never edit `js/main.js` or `js/staff.js` directly: the check fails and Cloudflare will not publish it.
APP_VERSION comes from `version.json` (bump it, then build).

The files are pieces of one script, not modules. They share one `(function () { … })();`, which opens
in `00-core.js` and closes at the end of `28-wordmap.js`. Keep new code inside the right piece. The
order matters only for top-level statements; functions can be called from any file.

## Learner code vs staff code (the one rule to know)

- Code that learners can reach goes in `src/app/`. Code only teachers or admins reach goes in `src/staff/`.
- Staff code may call anything in `src/app/`.
- Learner-side code (router, click handler, init) may call a function in `src/staff/` only if its name is in
  `STAFF_ENTRIES` in `tools/build_app.py`. The build then adds a stand-in to `js/main.js` that loads
  `js/staff.js` first and returns a Promise. So: add the name to `STAFF_ENTRIES` when you add a new staff
  page or a new teacher/admin button, and don't use the return value synchronously.
- If you call a `src/staff/` function from learner code without adding it to `STAFF_ENTRIES`, the page
  throws "X is not defined". The smoke test on GitHub opens the admin page and the learner screens and
  checks that learners never download `js/staff.js`.
- Top-level `let`/`const` in `src/staff/` are local to `js/staff.js`. Shared state belongs in `src/app/`.

Owned by Claude (don't edit): `05-fa-ui-engine.js` (Persian app UI), `08-preview.js` (Persian sample
lesson page), and the Persian parts of `14-grammar.js` (`gFa*`, `grammarBlocksHTMLFa`, `FA` branches).

| File | What is in it |
|---|---|
| 00-core | header comment, helpers, state, teacher referral + analytics events, config / integrations |
| 01-scores-saved-sync | soft push prompt, scores & mistakes, saved words, saved-word SRS, cross-device sync |
| 02-tricky-vocab-bookmarks | Tricky Bits, vocabulary-page bookmarks |
| 03-challenge | points ledger, points popup, leaderboard view |
| 04-lesson-data-audio-pwa | lesson progress, audio engine, PWA install prompt, lesson loading |
| 05-fa-ui-engine | Persian app UI engine (Claude) |
| 06-router-chrome | router, headers / nav |
| 06a-staff-loader | loads js/staff.js on first use (`loadStaff`, `callStaff`) |
| 07-landing | public landing |
| 08-preview | Persian sample lesson page #/preview (Claude) |
| 09-auth | sign-in / create-account |
| 10-teacher-links-certs-inbox | teacher links, become a teacher, certificates, inbox |
| 11-reports-homework-progress | student report pack, trend charts, homework, quiz / assignment progress |
| 12-onboarding | Google SSO, modal, region, first-run tutorial, waiting view, choose your teacher |
| 13-home-archive | home dashboards (older), lessons archive |
| 14-grammar | grammar hub, topic, quiz, banner, placement test, check-up |
| 15-ielts | IELTS full mock |
| 16-home-profile-support | mobile home v2, desktop home, profile, support |
| 18-lesson-view | lesson view |
| 19-quiz | quiz engine, Duolingo-style player |
| 20-streak-celebrations | streak engine, streak card, celebrations, rank climb, podcast milestones |
| 21-progress-review | rewards, scores (Progress), review (mistakes) |
| 22-sentences | Sentence Builder |
| 23-admin-bot | admin bot settings and chats (learner side) |
| 24-events | global click / event delegation |
| 25-init | init / boot |
| 26-boot | `/teachers` and `/manage` detection, start-up, `window.MuseApp` |
| 27-vocab | vocabulary hub, category, quiz |
| 28-wordmap | word map, vocabulary banner (closes the IIFE) |

| src/staff/ | What is in it |
|---|---|
| 10-teacher-dashboard | teacher dashboard, students, messages, assignments, planner, AI reports |
| 11-analytics | learning analytics, admin analytics, funnel + cohorts |
| 17-admin-panel | admin panel support threads |
| 23-admin-reports | daily study report, admin tools (users, levels, teachers) |
| 26-portal | teacher portal (`/teachers`) and admin panel (`/manage`) |
