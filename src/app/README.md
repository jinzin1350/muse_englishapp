# src/app: the app's source (js/main.js is built from these files)

`js/main.js` used to be one 20,000-line file. On 2026-11-12 Claude cut it into these files at its
own section headers, in the same order, without changing a single character of code. The browser
still loads one `js/main.js`; `tools/build_app.py` glues these files back together.

How to change the app:
1. `git fetch origin && git reset --hard origin/main` (start from the current code, never from an old copy)
2. edit the right file here (search by function name: `grep -n "function renderProfile" src/app/*.js`)
3. `python3 tools/build_app.py`  (writes js/main.js + the ?v= hashes in index.html)
4. `python3 tools/check_app.py`  (must say "all checks passed")
5. `git diff --stat origin/main` must show only your change, then commit `src/app/…`, `js/main.js`, `index.html`

Never edit `js/main.js` directly: the check fails and Cloudflare will not publish it.
APP_VERSION comes from `version.json` (bump it, then build).

The files are pieces of one script, not modules. They share one `(function () { … })();`, which opens
in `00-core.js` and closes at the end of `28-wordmap.js`. Keep new code inside the right piece. The
order matters only for top-level statements; functions can be called from any file.

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
| 07-landing | public landing |
| 08-preview | Persian sample lesson page #/preview (Claude) |
| 09-auth | sign-in / create-account |
| 10-teacher-dashboard | become a teacher, teacher dashboard, certificates, teacher inbox, assignments |
| 11-analytics | learning analytics, admin analytics, funnel + cohorts |
| 12-onboarding | Google SSO, modal, region, first-run tutorial, waiting view, choose your teacher |
| 13-home-archive | home dashboards (older), lessons archive |
| 14-grammar | grammar hub, topic, quiz, banner, placement test, check-up |
| 15-ielts | IELTS full mock |
| 16-home-profile-support | mobile home v2, desktop home, profile, support |
| 17-admin-panel | admin panel (in-app part) |
| 18-lesson-view | lesson view |
| 19-quiz | quiz engine, Duolingo-style player |
| 20-streak-celebrations | streak engine, streak card, celebrations, rank climb, podcast milestones |
| 21-progress-review | rewards, scores (Progress), review (mistakes) |
| 22-sentences | Sentence Builder |
| 23-admin-reports | daily study report, admin tools |
| 24-events | global click / event delegation |
| 25-init | init / boot |
| 26-portal | teacher portal (/teachers) and admin panel (/manage) |
| 27-vocab | vocabulary hub, category, quiz |
| 28-wordmap | word map, vocabulary banner (closes the IIFE) |
