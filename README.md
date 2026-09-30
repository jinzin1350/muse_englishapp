# English Learning App — Static Frontend

Multi-user English learning web app. Pure static site (HTML/CSS/JS, no build step) —
deploy as-is on Cloudflare Pages or GitHub Pages.

## Quick preview (local)

```bash
cd ~/workspace/english-app-static
python3 -m http.server 8080
# open http://localhost:8080
```

Supabase is not configured by default, so the login screen offers
**demo mode**: "Continue in demo mode (learner)" loads the sample lesson
(`lessons/intermediate/2026-09-30.json`); "Continue in demo mode (admin)"
additionally opens the Admin panel with sample users.

## Deploy checklist

1. **Config** — edit `js/config.js`:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Supabase project settings)
   - `ONESIGNAL_APP_ID` (OneSignal web-push app)
   - `ADMIN_EMAIL` (your email — only this user sees the Admin panel)
2. **Database** — run the SQL from the architecture doc
   (`your_files/english-app-product-architecture.md`, section 6) once in the
   Supabase SQL editor. It creates the `profiles` table, RLS policies, and the
   auto-profile trigger.
3. **Content** — the daily pipeline uploads to:
   - `lessons/{beginner,intermediate,advanced}/YYYY-MM-DD.json`
   - `media/{beginner,intermediate,advanced}/YYYY-MM-DD/` (`.mp3`, `.jpg`)
4. **Hosting** — connect the repo to Cloudflare Pages (or GitHub Pages);
   every push auto-deploys. Audio/images are served as static files.

## How it works

- On login, the app fetches the user's `level` from Supabase `profiles`.
- `level = null` → waiting screen ("your teacher is assigning your level").
- Lessons load from `lessons/{level}/{today}.json`, falling back to the
  latest available date (walks back up to 45 days).
- Quiz scores and mistakes live in `localStorage`, keyed per user email
  (`ela_scores_<email>`, `ela_mistakes_<email>`).
- Missing audio/photo files degrade gracefully ("coming soon" state) —
  the app never crashes on unpublished media.
- Push: OneSignal web-push SDK initializes only when a real App ID is set;
  the daily "lesson ready" push is sent by the content pipeline's cron.
