/* Smoke test for the app (Claude, 2026-11-12). Run by .github/workflows/app-check.yml.
   Starts no server itself: expects the repo served at BASE (default http://localhost:8765).
   Demo mode: js/config.js is replaced with placeholder keys so the demo buttons appear.
   Fails (exit 1) on any page error or when a key screen does not render. */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const DEMO_CONFIG = 'const APP_CONFIG={SUPABASE_URL:"https://YOUR-PROJECT.supabase.co",SUPABASE_ANON_KEY:"x",ADMIN_EMAILS:[]};';

const fails = [];
function check(ok, msg) { if (!ok) fails.push(msg); console.log((ok ? 'ok   ' : 'FAIL ') + msg); }

async function run(browser, lang) {
  const tag = lang ? '[ui=' + lang + '] ' : '[default] ';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: DEMO_CONFIG }));
  await ctx.route(/jsdelivr|onesignal|hotjar|googletagmanager|google-analytics|clarity|doubleclick/i, r => r.abort());
  if (lang) await ctx.addInitScript(l => { try { localStorage.setItem('muse_ui_lang', l); } catch (e) {} }, lang);
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  const go = async (hash, wait) => { await pg.evaluate(h => { location.hash = h; }, hash); await pg.waitForTimeout(wait || 1800); };
  const has = sel => pg.$(sel).then(Boolean);

  await pg.goto(BASE + '/#/preview', { waitUntil: 'load' });
  await pg.waitForTimeout(3000);
  check(await has('.pv-hero') && await has('.pv-word'), tag + 'sample lesson page (#/preview) renders (signed out)');
  await go('#/signin', 1500);
  check(await has('[data-action="demo-learner"]'), tag + 'sign-in screen renders');
  await pg.click('[data-action="demo-learner"]');
  await pg.waitForTimeout(2500);
  check(await has('#tabbar .tab-label'), tag + 'home renders with tab bar');
  if (lang === 'fa') check((await pg.textContent('#tabbar .tab-label')).trim() === 'خانه', tag + 'tab bar is Persian');
  if (lang === 'en') check((await pg.textContent('#tabbar .tab-label')).trim() === 'Home', tag + 'tab bar is English');

  await go('#/lesson', 2200);
  check(await has('.lesson-tab'), tag + 'lesson view renders');
  const quizTab = await pg.$('.lesson-tab[data-tab="quiz"]');
  if (quizTab) {
    await quizTab.click(); await pg.waitForTimeout(700);
    const start = await pg.$('[data-action="quiz-start"]');
    if (start) { await start.click(); await pg.waitForTimeout(1500); }
    check(await has('[data-action="duo-opt"], [data-action="duo-pick"], [data-action="duo-check"], .duo-q'), tag + 'word quiz starts');
  }
  await go('#/grammar/past-simple', 2200);
  check(await has('.gt3-topic, .g-topic'), tag + 'grammar guide renders');
  await go('#/profile');
  check(await has('.ui-lang-card'), tag + 'profile renders with App language switch');
  await go('#/review');
  check((await pg.textContent('#view')).trim().length > 50, tag + 'review renders');

  check(errors.length === 0, tag + 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await run(browser, null);
    await run(browser, 'fa');
    await run(browser, 'en');
  } catch (e) {
    fails.push('smoke test crashed: ' + e.message.split('\n')[0]);
    console.log('FAIL ' + e.message);
  }
  await browser.close();
  if (fails.length) { console.log('\nsmoke test: ' + fails.length + ' failure(s)'); process.exit(1); }
  console.log('\nsmoke test: all passed');
})();
