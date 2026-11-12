/* ---------------- Google SSO ----------------
   "Continue with Google" on signin/signup. Supabase handles the OAuth dance;
   on return init() -> getSession() picks up the session from the URL and
   enterApp() runs. New Google users get: nickname prompt (ensureNickname),
   level picker (waiting view), and first-touch teacher attribution below. */
function googleButtonHTML(prefix) {
  return '<button class="btn btn-block btn-google" data-action="google-signin" data-prefix="' + prefix + '" type="button">' +
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path fill="#EA4335" d="M12 5.04c1.7 0 3.2.58 4.38 1.73l3.25-3.25C17.7 1.7 15.06.5 12 .5 7.7.5 3.99 3.08 2.18 6.6l3.78 2.93C7.02 6.9 9.28 5.04 12 5.04z"/>' +
    '<path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45c-.28 1.48-1.12 2.73-2.39 3.57v2.97h3.87c2.26-2.09 3.57-5.16 3.57-8.73z"/>' +
    '<path fill="#FBBC05" d="M5.96 14.47c-.22-.66-.35-1.37-.35-2.1s.13-1.44.35-2.1V7.3H2.18C1.43 8.79 1 10.35 1 12s.43 3.21 1.18 4.7l3.78-2.23z"/>' +
    '<path fill="#34A853" d="M12 23.5c3.04 0 5.6-1 7.46-2.72l-3.87-2.97c-1.08.72-2.45 1.15-3.59 1.15-2.72 0-4.98-1.86-6.04-4.49l-3.78 2.93C3.99 21.42 7.7 23.5 12 23.5z"/>' +
    '</svg><span>Continue with Google</span></button>' +
    '<div class="auth-or"><span>or</span></div>';
}
async function signInWithGoogle(prefix, btn) {
  if (!sb) { authError(prefix, 'Sign-in service couldn\u2019t load. Check your connection and try again.'); return; }
  authError(prefix, '');
  if (btn) btn.disabled = true;
  try {
    /* Carry the referral code through the OAuth round-trip. redirectTo used to
       be the bare origin, so ?ref= was lost on return; and localStorage often
       does NOT survive the mobile browser switch (in-app browser -> system
       browser for the Google screen). With ?ref= in redirectTo, getRefCode()
       picks it up from the URL again on return, in any browser. */
    const ref = getRefCode();
    const redirectTo = window.location.origin + '/' + (ref ? '?ref=' + encodeURIComponent(ref) : '');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo }
    });
    if (error) throw error;
    // The browser leaves for Google now; on return init() picks up the session.
  } catch (e) {
    if (btn) btn.disabled = false;
    authError(prefix, (e && e.message) || 'Google sign-in failed. Try again.');
  }
}
/* Suggest a valid nickname from the OAuth profile (Google full name). */
function suggestNickname(u) {
  try {
    const meta = (u && u.user_metadata) || {};
    const raw = String(meta.full_name || meta.name || '').trim();
    let s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    if (s.length < 3) {
      s = String((u && u.email) || 'learner').split('@')[0].toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
    }
    return s.length >= 3 ? s : '';
  } catch (e) { return ''; }
}

function togglePw(btn) {
  const wrap = btn.closest('.pw-wrap');
  const input = wrap ? wrap.querySelector('input') : null;
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁️';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function setAuthBusy(kind, busy, label) {
  const btn = document.getElementById(kind === 'si' ? 'si-submit' : 'su-submit');
  if (btn) { btn.disabled = busy; if (label) btn.textContent = label; }
}
function authError(kind, msg) {
  const el = document.getElementById(kind === 'si' ? 'si-error' : 'su-error');
  if (el) el.textContent = msg || '';
  const note = document.getElementById(kind === 'si' ? 'si-note' : 'su-note');
  if (note) note.textContent = '';
}
function authNote(kind, msg) {
  const note = document.getElementById(kind === 'si' ? 'si-note' : 'su-note');
  if (note) note.textContent = msg || '';
}

/* ---------------- modal (popup) ---------------- */
function showModal(html, lock) {
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.id = 'app-modal';
  ov.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true">' + html + '</div>';
  document.body.appendChild(ov);
  if (!lock) ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
  return ov;
}
function closeModal() {
  const m = document.getElementById('app-modal');
  if (m) m.remove();
}

/* ---------------- user region (timezone-based country detection) ---------------- */
/* VPN-proof: the device timezone reflects where the user actually lives,
   unlike IP geolocation which follows the VPN exit node. */
const TZ_COUNTRY = {
  'Asia/Tehran': ['IR', 'Iran'],
  'Asia/Dubai': ['AE', 'United Arab Emirates'], 'Asia/Muscat': ['OM', 'Oman'],
  'Asia/Qatar': ['QA', 'Qatar'], 'Asia/Bahrain': ['BH', 'Bahrain'],
  'Asia/Kuwait': ['KW', 'Kuwait'], 'Asia/Riyadh': ['SA', 'Saudi Arabia'],
  'Asia/Baghdad': ['IQ', 'Iraq'], 'Asia/Amman': ['JO', 'Jordan'],
  'Asia/Beirut': ['LB', 'Lebanon'], 'Asia/Damascus': ['SY', 'Syria'],
  'Asia/Jerusalem': ['IL', 'Israel'], 'Asia/Gaza': ['PS', 'Palestine'],
  'Asia/Hebron': ['PS', 'Palestine'], 'Asia/Nicosia': ['CY', 'Cyprus'],
  'Asia/Yerevan': ['AM', 'Armenia'], 'Asia/Baku': ['AZ', 'Azerbaijan'],
  'Asia/Tbilisi': ['GE', 'Georgia'], 'Asia/Karachi': ['PK', 'Pakistan'],
  'Asia/Kolkata': ['IN', 'India'], 'Asia/Colombo': ['LK', 'Sri Lanka'],
  'Asia/Dhaka': ['BD', 'Bangladesh'], 'Asia/Kathmandu': ['NP', 'Nepal'],
  'Asia/Yangon': ['MM', 'Myanmar'], 'Asia/Bangkok': ['TH', 'Thailand'],
  'Asia/Jakarta': ['ID', 'Indonesia'], 'Asia/Makassar': ['ID', 'Indonesia'],
  'Asia/Jayapura': ['ID', 'Indonesia'], 'Asia/Kuala_Lumpur': ['MY', 'Malaysia'],
  'Asia/Singapore': ['SG', 'Singapore'], 'Asia/Manila': ['PH', 'Philippines'],
  'Asia/Hong_Kong': ['HK', 'Hong Kong'], 'Asia/Taipei': ['TW', 'Taiwan'],
  'Asia/Shanghai': ['CN', 'China'], 'Asia/Urumqi': ['CN', 'China'],
  'Asia/Seoul': ['KR', 'South Korea'], 'Asia/Tokyo': ['JP', 'Japan'],
  'Asia/Ulaanbaatar': ['MN', 'Mongolia'], 'Asia/Almaty': ['KZ', 'Kazakhstan'],
  'Asia/Aqtau': ['KZ', 'Kazakhstan'], 'Asia/Aqtobe': ['KZ', 'Kazakhstan'],
  'Asia/Oral': ['KZ', 'Kazakhstan'], 'Asia/Qyzylorda': ['KZ', 'Kazakhstan'],
  'Asia/Tashkent': ['UZ', 'Uzbekistan'], 'Asia/Samarkand': ['UZ', 'Uzbekistan'],
  'Asia/Ashgabat': ['TM', 'Turkmenistan'], 'Asia/Dushanbe': ['TJ', 'Tajikistan'],
  'Asia/Bishkek': ['KG', 'Kyrgyzstan'], 'Asia/Kabul': ['AF', 'Afghanistan'],
  'Asia/Yekaterinburg': ['RU', 'Russia'], 'Asia/Omsk': ['RU', 'Russia'],
  'Asia/Krasnoyarsk': ['RU', 'Russia'], 'Asia/Irkutsk': ['RU', 'Russia'],
  'Asia/Yakutsk': ['RU', 'Russia'], 'Asia/Vladivostok': ['RU', 'Russia'],
  'Asia/Magadan': ['RU', 'Russia'], 'Asia/Kamchatka': ['RU', 'Russia'],
  'Asia/Novosibirsk': ['RU', 'Russia'], 'Asia/Chita': ['RU', 'Russia'],
  'Asia/Sakhalin': ['RU', 'Russia'], 'Asia/Anadyr': ['RU', 'Russia'],
  'Europe/London': ['GB', 'United Kingdom'], 'Europe/Dublin': ['IE', 'Ireland'],
  'Europe/Lisbon': ['PT', 'Portugal'], 'Europe/Madrid': ['ES', 'Spain'],
  'Europe/Paris': ['FR', 'France'], 'Europe/Brussels': ['BE', 'Belgium'],
  'Europe/Amsterdam': ['NL', 'Netherlands'], 'Europe/Berlin': ['DE', 'Germany'],
  'Europe/Rome': ['IT', 'Italy'], 'Europe/Vienna': ['AT', 'Austria'],
  'Europe/Zurich': ['CH', 'Switzerland'], 'Europe/Prague': ['CZ', 'Czechia'],
  'Europe/Warsaw': ['PL', 'Poland'], 'Europe/Budapest': ['HU', 'Hungary'],
  'Europe/Bratislava': ['SK', 'Slovakia'], 'Europe/Ljubljana': ['SI', 'Slovenia'],
  'Europe/Zagreb': ['HR', 'Croatia'], 'Europe/Belgrade': ['RS', 'Serbia'],
  'Europe/Sarajevo': ['BA', 'Bosnia and Herzegovina'], 'Europe/Skopje': ['MK', 'North Macedonia'],
  'Europe/Tirane': ['AL', 'Albania'], 'Europe/Athens': ['GR', 'Greece'],
  'Europe/Bucharest': ['RO', 'Romania'], 'Europe/Sofia': ['BG', 'Bulgaria'],
  'Europe/Chisinau': ['MD', 'Moldova'], 'Europe/Kyiv': ['UA', 'Ukraine'],
  'Europe/Minsk': ['BY', 'Belarus'], 'Europe/Riga': ['LV', 'Latvia'],
  'Europe/Tallinn': ['EE', 'Estonia'], 'Europe/Vilnius': ['LT', 'Lithuania'],
  'Europe/Helsinki': ['FI', 'Finland'], 'Europe/Stockholm': ['SE', 'Sweden'],
  'Europe/Oslo': ['NO', 'Norway'], 'Europe/Copenhagen': ['DK', 'Denmark'],
  'Europe/Istanbul': ['TR', 'Turkey'], 'Europe/Moscow': ['RU', 'Russia'],
  'Europe/Kaliningrad': ['RU', 'Russia'], 'Europe/Samara': ['RU', 'Russia'],
  'Europe/Volgograd': ['RU', 'Russia'], 'Europe/Saratov': ['RU', 'Russia'],
  'Europe/Astrakhan': ['RU', 'Russia'],
  'Africa/Cairo': ['EG', 'Egypt'], 'Africa/Lagos': ['NG', 'Nigeria'],
  'Africa/Johannesburg': ['ZA', 'South Africa'], 'Africa/Nairobi': ['KE', 'Kenya'],
  'Africa/Casablanca': ['MA', 'Morocco'], 'Africa/Algiers': ['DZ', 'Algeria'],
  'Africa/Tunis': ['TN', 'Tunisia'], 'Africa/Tripoli': ['LY', 'Libya'],
  'Africa/Khartoum': ['SD', 'Sudan'], 'Africa/Addis_Ababa': ['ET', 'Ethiopia'],
  'Africa/Accra': ['GH', 'Ghana'], 'Africa/Dakar': ['SN', 'Senegal'],
  'Africa/Abidjan': ['CI', 'Ivory Coast'],
  'America/Toronto': ['CA', 'Canada'], 'America/Vancouver': ['CA', 'Canada'],
  'America/Edmonton': ['CA', 'Canada'], 'America/Winnipeg': ['CA', 'Canada'],
  'America/Halifax': ['CA', 'Canada'], 'America/St_Johns': ['CA', 'Canada'],
  'America/Regina': ['CA', 'Canada'], 'America/Blanc-Sablon': ['CA', 'Canada'],
  'America/Atikokan': ['CA', 'Canada'], 'America/Creston': ['CA', 'Canada'],
  'America/Dawson_Creek': ['CA', 'Canada'], 'America/Fort_Nelson': ['CA', 'Canada'],
  'America/Cambridge_Bay': ['CA', 'Canada'], 'America/Yellowknife': ['CA', 'Canada'],
  'America/Inuvik': ['CA', 'Canada'], 'America/Whitehorse': ['CA', 'Canada'],
  'America/Dawson': ['CA', 'Canada'], 'America/Iqaluit': ['CA', 'Canada'],
  'America/Pangnirtung': ['CA', 'Canada'], 'America/Resolute': ['CA', 'Canada'],
  'America/Rankin_Inlet': ['CA', 'Canada'], 'America/Goose_Bay': ['CA', 'Canada'],
  'America/Moncton': ['CA', 'Canada'], 'America/Glace_Bay': ['CA', 'Canada'],
  'America/Nipigon': ['CA', 'Canada'], 'America/Thunder_Bay': ['CA', 'Canada'],
  'America/Swift_Current': ['CA', 'Canada'],
  'America/New_York': ['US', 'United States'], 'America/Chicago': ['US', 'United States'],
  'America/Denver': ['US', 'United States'], 'America/Los_Angeles': ['US', 'United States'],
  'America/Anchorage': ['US', 'United States'], 'America/Phoenix': ['US', 'United States'],
  'America/Detroit': ['US', 'United States'], 'America/Boise': ['US', 'United States'],
  'America/Indiana/Indianapolis': ['US', 'United States'], 'America/Kentucky/Louisville': ['US', 'United States'],
  'America/Juneau': ['US', 'United States'], 'Pacific/Honolulu': ['US', 'United States'],
  'America/Mexico_City': ['MX', 'Mexico'], 'America/Cancun': ['MX', 'Mexico'],
  'America/Tijuana': ['MX', 'Mexico'], 'America/Guatemala': ['GT', 'Guatemala'],
  'America/Costa_Rica': ['CR', 'Costa Rica'], 'America/Panama': ['PA', 'Panama'],
  'America/Havana': ['CU', 'Cuba'], 'America/Santo_Domingo': ['DO', 'Dominican Republic'],
  'America/Bogota': ['CO', 'Colombia'], 'America/Lima': ['PE', 'Peru'],
  'America/Santiago': ['CL', 'Chile'], 'America/Buenos_Aires': ['AR', 'Argentina'],
  'America/Sao_Paulo': ['BR', 'Brazil'], 'America/Caracas': ['VE', 'Venezuela'],
  'America/Montevideo': ['UY', 'Uruguay'],
  'Australia/Sydney': ['AU', 'Australia'], 'Australia/Melbourne': ['AU', 'Australia'],
  'Australia/Brisbane': ['AU', 'Australia'], 'Australia/Perth': ['AU', 'Australia'],
  'Australia/Adelaide': ['AU', 'Australia'], 'Australia/Darwin': ['AU', 'Australia'],
  'Australia/Hobart': ['AU', 'Australia'],
  'Pacific/Auckland': ['NZ', 'New Zealand'], 'Pacific/Fiji': ['FJ', 'Fiji'],
};
function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ_COUNTRY[tz]) return { code: TZ_COUNTRY[tz][0], name: TZ_COUNTRY[tz][1], source: 'timezone' };
  } catch (e) {}
  return null;
}
/* Curated list for the manual country picker in the profile. */
const COUNTRY_OPTIONS = [
  ['IR', 'Iran'], ['CA', 'Canada'], ['US', 'United States'], ['GB', 'United Kingdom'],
  ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['SE', 'Sweden'],
  ['AU', 'Australia'], ['TR', 'Turkey'], ['AE', 'United Arab Emirates'],
  ['SA', 'Saudi Arabia'], ['IQ', 'Iraq'], ['AF', 'Afghanistan'], ['PK', 'Pakistan'],
  ['IN', 'India'], ['IT', 'Italy'], ['ES', 'Spain'], ['CH', 'Switzerland'],
  ['NO', 'Norway'],
];
/* Detects the country (if not stored yet) and saves it on the profile.
   Runs as a separate upsert so a missing DB migration can never break
   the level/profile save — it just retries on the next app open. */
async function ensureCountrySaved() {
  const u = state.user;
  if (!sb || !u || u.demo || u.countryCode) return;
  const c = detectCountry();
  if (!c) return;
  u.countryCode = c.code; u.country = c.name; u.countrySource = c.source;
  try {
    // Server-side write: profiles has no user UPDATE policy, so a direct
    // upsert is denied by RLS. The RPC writes only the caller's own row.
    await sb.rpc('set_country', { code: c.code, name: c.name, source: c.source });
  } catch (e) { /* RPC missing or offline -> retry next open */ }
}

/* Saves the device IANA timezone (e.g. 'Asia/Tehran') on the profile, updating
   it whenever it changes (travel). Used for student-local scheduled delivery.
   Same pattern as ensureCountrySaved: RPC-only write, never breaks the boot. */
async function ensureTimezoneSaved() {
  const u = state.user;
  if (!sb || !u || u.demo) return;
  let tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  if (!tz || u.timezone === tz) return;
  u.timezone = tz;
  try { await sb.rpc('set_timezone', { tz: tz }); }
  catch (e) { /* RPC missing or offline -> retry next open */ }
}

async function doLogin() {
  const emailEl = document.getElementById('si-email');
  const passEl = document.getElementById('si-pass');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  const pass = passEl.value;
  if (!email || !pass) { authError('si', 'Enter your email and password.'); return; }
  authError('si', '');
  if (!sb) { authError('si', 'Login service couldn’t load. Check your connection and try again.'); return; }
  setAuthBusy('si', true, 'Signing in…');
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email, password: pass });
    if (error) throw error;
    authNote('si', '✓ Signed in — loading your lessons…');
    await enterApp();
  } catch (e) {
    authError('si', (e && e.message) || 'Sign in failed.');
    setAuthBusy('si', false, 'Sign in');
  }
}

async function doSignup() {
  const emailEl = document.getElementById('su-email');
  const passEl = document.getElementById('su-pass');
  if (!emailEl) return;
  const email = emailEl.value.trim();
  const pass = passEl.value;
  if (!email || !pass) { authError('su', 'Enter your email and password.'); return; }
  if (pass.length < 6) { authError('su', 'Password must be at least 6 characters.'); return; }
  const lvlEl = document.querySelector('input[name="su-level"]:checked');
  if (!lvlEl) { authError('su', 'Please pick your English level.'); return; }
  const chosenLevel = lvlEl.value;
  const nickEl = document.getElementById('su-nick');
  const nickname = nickEl ? nickEl.value.trim() : '';
  if (!validNickname(nickname)) { authError('su', 'Pick a nickname: 3–20 characters, letters, numbers, _ or -.'); return; }
  const phoneEl = document.getElementById('su-phone');
  const phone = normalizePhone(phoneEl ? phoneEl.value : '');
  if (!validPhone(phone)) { authError('su', 'Enter a valid mobile number (7–15 digits, + is fine).'); return; }
  authError('su', '');
  if (!sb) { authError('su', 'Signup service couldn’t load. Check your connection and try again.'); return; }
  const taken = await nicknameTaken(nickname);
  if (taken) { authError('su', 'This nickname is taken, try another.'); return; }
  setAuthBusy('su', true, 'Creating your account…');
  try {
    // After clicking the email link, Supabase returns the user to the app
    // they signed up from (production -> production, localhost -> localhost).
    const signupOpts = { emailRedirectTo: window.location.origin + '/' };
    // Server-side persistence: the handle_new_user trigger saves level (+ref) on the
    // profile at signup, so email confirmation on another device/browser keeps them.
    const signupMeta = { level: chosenLevel, display_name: nickname, phone: phone };
    const signupRef = getRefCode();
    if (signupRef) signupMeta.referred_by = signupRef;
    signupOpts.data = signupMeta;
    const { data, error } = await sb.auth.signUp({
      email: email,
      password: pass,
      options: signupOpts,
    });
    if (error) throw error;
    setAuthBusy('su', false, 'Create account');
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      // Duplicate signup: Supabase sends NO confirmation email for an already-registered
      // address (returns an obfuscated user with empty identities). Tell the user to sign in.
      authError('su', 'This email is already registered. Please sign in instead.');
      return;
    }
    if (data.session) {
      // Email confirmation disabled -> already signed in: save level now.
      // Server-side writes: profiles has no user UPDATE/INSERT policy.
      try { await sb.rpc('set_level', { p_level: chosenLevel }); } catch (e) {}
      try { const rp = await sb.rpc('set_phone', { p_phone: phone }); if (!rp || rp.error || rp.data !== true) stashPendingPhone(phone); } catch (e) { stashPendingPhone(phone); }
      try { const r = getRefCode(); if (r) await sb.rpc('set_referred_by', { p_code: r }); } catch (e) {}
      state.justSignedUp = true;
      authNote('su', '✓ Account created — loading your lessons…');
      await enterApp();
      return;
    }
    // Confirmation required: stash the level, applied on first sign-in.
    try { localStorage.setItem('el_pending_level', JSON.stringify({ email: email, level: chosenLevel, ref: getRefCode() || null })); } catch (e) {}
    stashPendingPhone(phone);
    state.afterSignup = email;
    state.showConfirmPopup = email;
    go('signin');
  } catch (e) {
    authError('su', (e && e.message) || 'Sign up failed.');
    setAuthBusy('su', false, 'Create account');
  }
}

async function enterApp() {
  const { data } = await sb.auth.getUser();
  const u = data.user;
  if (!u) { window.location.replace('/'); return; }  // session gone -> static landing
  /* Teacher portal login round-trip (see AUTH_RETURN_KEY). */
  const authBack = takeAuthReturnPath();
  if (authBack) { window.location.replace(authBack); return; }
  let level = null;
  let prof = null;
  try {
    const res = await sb.from('profiles').select('level,display_name,referred_by,country_code,country,country_source,welcome_seen_at,phone,created_at').eq('id', u.id).single();
    if (res.error) throw res.error;
    prof = res.data || null;
  } catch (e) {
    // Pre-migration fallback: the new columns may not exist yet.
    try {
      const res2 = await sb.from('profiles').select('level').eq('id', u.id).single();
      prof = (res2 && res2.data) || null;
    } catch (e2) { /* RLS or missing row -> treat as pending */ }
  }
  if (prof) level = prof.level;
  if (!level) {
    // Level chosen at signup (confirmation flow): apply it now.
    try {
      const raw = localStorage.getItem('el_pending_level');
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.email === u.email && p.level) {
          await sb.rpc('set_level', { p_level: p.level });
          try { if (p.ref) await sb.rpc('set_referred_by', { p_code: p.ref }); } catch (e2) {}
          level = p.level;
          localStorage.removeItem('el_pending_level');
        }
      }
    } catch (e) {}
  }
  // First-touch teacher attribution for OAuth sign-ins (the email flow stashes
  // the ref code in el_pending_level instead; this covers Google SSO).
  // Server-side write via RPC: profiles has no user UPDATE policy.
  // Best-effort: runs in the background, never blocks first paint.
  try {
    const rc = getRefCode();
    if (rc && (!prof || !prof.referred_by)) {
      sb.rpc('set_referred_by', { p_code: rc }).then(function () {}, function () {});
    }
  } catch (e) {}
  const adminEmails = APP_CONFIG.ADMIN_EMAILS || [];
  const isAdmin = adminEmails.indexOf((u.email || '').toLowerCase()) !== -1;
  state.user = {
    id: u.id, email: u.email, level: level, isAdmin: isAdmin, demo: false,
    displayName: (prof && prof.display_name) || null,
    referredBy: (prof && prof.referred_by) || null,
    phone: (prof && prof.phone) || null,
    countryCode: (prof && prof.country_code) || null,
    country: (prof && prof.country) || null,
    countrySource: (prof && prof.country_source) || null,
    timezone: (prof && prof.timezone) || null,
    welcomeSeenAt: (prof && prof.welcome_seen_at) || null,
    createdAt: (prof && prof.created_at) || null,
  };
  try { localStorage.setItem('el_last_user', u.email); } catch (e) {}
  /* First paint ASAP: the syncs below don't affect the first screen, so they
     run in the background instead of blocking the boot sequence. */
  try { identifyPushUser(u.id, u.email, normalizeLevel(level)); } catch (e) {}
  ensureCountrySaved().catch(function () {});
  ensureTimezoneSaved().catch(function () {});
  retryPendingPhone(u).catch(function () {});
  migrateLocalToCloud().catch(function () {});
  flushPointsQueue().then(function () { refreshMyPoints().catch(function () {}); },
                          function () { refreshMyPoints().catch(function () {}); });
  loadTeacherStatus().catch(function () {});
  // Existing users without a nickname pick one now (blocking) — the
  // Challenge leaderboard needs a display name. Google users get their
  // Google name suggested.
  if (!state.user.demo && !state.user.displayName) {
    await ensureNickname(suggestNickname(u));
  }
  // Mandatory mobile number (2026-11-11, Alireza's pick: option A): users
  // who predate phone collection -- or never saved a number -- get a
  // blocking phone-only prompt on entry until a valid number is saved.
  // Anyone who just completed the nickname modal already saved one there
  // (savePhone updates state.user.phone), so they are not asked twice.
  if (!state.user.demo && !state.user.phone) {
    await ensurePhone(u);
  }
  await afterLogin();
}

async function afterLogin() {
  if (!state.user.level && !state.user.isAdmin) { go('waiting'); hideSplashSoon(); return; }
  /* Teacher invite auto-link (Alireza 2026-10-10): a visitor arriving with
     ?ref=TEACHER_CODE is linked to that teacher immediately via
     resolve_teacher_offer (sets referred_by + teacher_offer_seen), so the
     choose-teacher page is NEVER shown to them. Non-teacher ref codes
     (e.g. blogger links) raise 'unknown teacher' and are ignored here —
     the normal offer flow below still applies to those users. */
  if (!state.user.isAdmin && !state.user.demo) {
    try {
      const ref = getRefCode();
      if (ref) await sb.rpc('resolve_teacher_offer', { p_ref_code: ref });
    } catch (e) { /* not a teacher code: fall through to the offer check */ }
  }
  /* One-time teacher offer for existing users who never chose/skipped. */
  if (!state.user.isAdmin && state.view !== 'choose-teacher') {
    try { if (await teacherOfferNeeded()) { go('choose-teacher'); hideSplashSoon(); return; } } catch (e) {}
  }
  const level = normalizeLevel(state.user.level) || 'b2';
  state.lessons = await loadLessons(level);
  state.lesson = state.lessons[0] || null;
  if (pendingDeepLink === 'latest') {
    // Push notification deep link -> newest lesson
    pendingDeepLink = null;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('lesson');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
    if (state.lessons.length) go('lesson', state.lessons[0].date);
    else go('home');
  } else {
    // Stay where a reload happened (e.g. pull-to-refresh on mobile);
    // fresh logins land on home.
    const r = parseHash();
    if (r.name && LEARNER_VIEWS.indexOf(r.name) !== -1) onRoute();
    else go('home');
  }
  /* Placement test return: a student who signed up/logged in from a teacher's
     #/ptest/<ref> link lands back on the test after auth (incl. after the
     level picker in the waiting view). */
  try {
    var ptestBack = sessionStorage.getItem('ptest_return');
    if (ptestBack && /^#\/ptest\/[A-Za-z0-9_-]{1,32}$/.test(ptestBack)) {
      sessionStorage.removeItem('ptest_return');
      if (window.location.hash !== ptestBack) { window.location.hash = ptestBack; return; }
    }
  } catch (e) {}
  /* Return-after-signup (see RETURN_VIEWS). */
  const backTo = takeReturnRoute();
  if (backTo && window.location.hash !== backTo) window.location.hash = backTo;
  hideSplashSoon();
  maybeShowWelcome();
  // Teacher inbox: badge in the header + a prompt if unread messages arrived.
  refreshInboxBadge().then(function () { maybeShowInboxPrompt(); }, function () {});
}

/* First-entry welcome popup: Persian for a1/a2 learners, English for b1+.
   Shown once per user (tracked in profiles.welcome_seen_at + a local backup). */
/* Onboarding v2 (2026-10-04, his design): cream card, flame-reading illustration,
   squiggle title, orange gradient CTA. */
function welcomeModalHTML(fa, offerTour) {
  var img = '<img class="onb-img" src="/media/mascot/flame-reading-book.webp" alt="">';
  var x = '<button class="onb-x" data-action="modal-close" aria-label="Close">\u2715</button>';
  if (fa) {
    return '<div class="onb" dir="rtl" lang="fa">' +
      '<div class="onb-top"><span class="onb-brand">\uD83D\uDCD6 Muse English</span>' + x + '</div>' +
      '<div class="onb-body"><div class="onb-text">' +
      '<h1 class="onb-title">خوش اومدی!<span class="onb-squiggle" aria-hidden="true"></span></h1>' +
      '<p>درس جدیدت هر روز ساعت <b class="onb-hl">۸ صبح</b> به وقت خودت آماده‌ست.</p>' +
      '<p>فقط کافیه روزی حدود <b>۱۰ دقیقه</b> وقت بذاری — کلی کلمه، جمله و نکته جدید یاد می‌گیری.</p>' +
      '</div>' + img + '</div>' +
      (offerTour
        ? '<button class="onb-cta" data-action="welcome-tour">بزن بریم، یه دور بزنیم 🌱</button>' +
          '<button class="onb-skip" data-action="modal-close">فعلاً نه</button>'
        : '<button class="onb-cta" data-action="welcome-start">شروع کن</button>') +
      '</div>';
  }
  return '<div class="onb">' +
    '<div class="onb-top"><span class="onb-brand">\uD83D\uDCD6 Muse English</span>' + x + '</div>' +
    '<div class="onb-body"><div class="onb-text">' +
    '<h1 class="onb-title">Welcome!<span class="onb-squiggle" aria-hidden="true"></span></h1>' +
    '<p>Your new lesson is ready every day at <b class="onb-hl">8:00 AM</b>, your time.</p>' +
    '<p>Just spend about <b>10 minutes</b> a day — you\u2019ll pick up loads of new words, sentences and tips.</p>' +
    '</div>' + img + '</div>' +
    (offerTour
      ? '<button class="onb-cta" data-action="welcome-tour">Take the tour <span aria-hidden="true">\u2192</span></button>' +
        '<button class="onb-skip" data-action="modal-close">Not now</button>'
      : '<button class="onb-cta" data-action="welcome-start">Let\u2019s start</button>') +
    '</div>';
}

async function maybeShowWelcome() {
  const u = state.user;
  if (!u || u.demo || u.isAdmin || !u.level) return;
  if (u.welcomeSeenAt) return;
  try { if (localStorage.getItem('el_welcome_seen_' + u.id)) return; } catch (e) {}
  const lvl = normalizeLevel(u.level);
  const fa = (lvl === 'a1' || lvl === 'a2');
  const offerTour = !tutorialSeen();
  showModal(welcomeModalHTML(fa, offerTour), true);
  // Mark as seen (DB first, localStorage as backup so it never double-shows).
  const now = new Date().toISOString();
  u.welcomeSeenAt = now;
  try { localStorage.setItem('el_welcome_seen_' + u.id, '1'); } catch (e) {}
  try { if (sb) await sb.rpc('set_welcome_seen'); } catch (e) {}
  try { if (sb) await sb.rpc('send_welcome_message', { p_body: welcomeBody(fa) }); } catch (e) {}
}

/* ---------------- guided first-run tutorial ----------------
   New users get a hands-on tour instead of a lecture: words -> quiz ->
   podcast -> challenge -> progress -> review. Action steps spotlight the
   real control and advance when the user taps it; info steps are read-and-go.
   Shown once per user (localStorage); replayable from Profile > Help. */
const tutState = { active: false, i: 0 };
function tutorialSeen() {
  try { return !!localStorage.getItem('el_tutorial_seen_' + (state.user && state.user.id)); }
  catch (e) { return false; }
}
function markTutorialSeen() {
  try { localStorage.setItem('el_tutorial_seen_' + (state.user && state.user.id), '1'); } catch (e) {}
}
function tutLang() {
  /* Same rule as the app UI (Persian for A1–B1, Profile > App language overrides). */
  return uiLang();
}
function buildTutorialSteps() {
  const fa = tutLang() === 'fa';
  const T = function (f, e) { return fa ? f : e; };
  /* 4-step core-loop tour: words -> quiz -> streak -> podcast.
     Each step highlights one stable UI target (tab buttons + streak banner),
     one sentence each, skippable, ends at today's lesson. */
  return [
    { id: 'words', view: 'lesson', selector: '.lesson-tab[data-tab="words"]',
      kicker: '📝', title: T('کلمات', 'Words'),
      text: T('کلمات امروز رو اینجا یاد بگیر', 'Learn today\u2019s words here') },
    { id: 'quiz', selector: '.lesson-tab[data-tab="quiz"]',
      kicker: '🎯', title: T('کوییز', 'Quiz'),
      text: T('کوییز بده و XP بگیر', 'Take the quiz and earn XP') },
    { id: 'streak', view: 'home', selector: '.stk-link',
      kicker: '🔥', title: T('استریک', 'Streak'),
      text: T('هر روز بیا تا استریکت نپره', 'Come back every day to keep your streak') },
    { id: 'podcast', view: 'lesson', selector: '.lesson-tab[data-tab="podcast"]',
      kicker: '🎧', title: T('پادکست', 'Podcast'),
      text: T('کلمات امروز رو توی مکالمه بشنو', 'Hear today\u2019s words in conversation') }
  ];
}
/* One persistent overlay for the whole tour: the dim NEVER lifts between
   steps (fixes the unlocked-screen gap). The hole glides to each target,
   text crossfades next to it. Tap anywhere (or Next) advances. */
function startTutorial() {
  if (tutState.active || !state.user || state.user.demo) return;
  tutState.active = true; tutState.i = 0;
  const fa = tutLang() === 'fa';
  const ov = document.createElement('div');
  ov.id = 'tut-ov';
  ov.innerHTML =
    '<div id="tut-catcher"></div><div id="tut-hole"></div><div id="tut-text"></div>';
  document.body.appendChild(ov);
  document.getElementById('tut-catcher').addEventListener('click', function () { tutorialNext(); });
  window.addEventListener('resize', tutReposition);
  tutorialStep();
}
function endTutorial() {
  tutState.active = false;
  window.removeEventListener('resize', tutReposition);
  closeTutorialUI();
  markTutorialSeen();
}
function tutorialNext() {
  if (!tutState.active) return;
  const steps = buildTutorialSteps();
  tutState.i++;
  if (tutState.i >= steps.length) { showTutorialDone(); return; }
  tutorialStep();
}
function tutGo(view) {
  /* Tutorial navigation: intentionally leaves any half-answered demo quiz
     behind (nothing is saved until a quiz finishes), so no confirm dialog. */
  state.quiz = null;
  const h = '#/' + view;
  if (window.location.hash === h) { onRoute(); }
  else { window.location.hash = h; }
}
/* Robust tab switch: wait for the tab strip, click the real tab (so the user
   sees it activate), then verify lessonTab actually changed. */
function tutEnsureTab(tab) {
  return tutWaitForEl('.lesson-tab[data-tab="' + tab + '"]', 4000).then(function (btn) {
    if (!tutState.active) return false;
    if (!btn) return false;
    try { btn.click(); } catch (e) { return false; }
    return new Promise(function (resolve) {
      const t0 = Date.now();
      (function poll() {
        if (!tutState.active) return resolve(false);
        if (state.lessonTab === tab) return resolve(true);
        if (Date.now() - t0 > 3000) return resolve(state.lessonTab === tab);
        setTimeout(poll, 150);
      })();
    });
  });
}
function tutWaitForEl(selector, ms) {
  return new Promise(function (resolve) {
    const t0 = Date.now();
    (function poll() {
      let el = null;
      try { el = document.querySelector(selector); } catch (e) {}
      if (el) return resolve(el);
      if (Date.now() - t0 > (ms || 4000)) return resolve(null);
      setTimeout(poll, 200);
    })();
  });
}
async function tutorialStep() {
  const myStep = tutState.i;
  const steps = buildTutorialSteps();
  const s = steps[myStep];
  if (!s) { showTutorialDone(); return; }
  tutFadeStep(true);
  if (s.view && state.view !== s.view) tutGo(s.view);
  if (s.tab) {
    const tabOk = await tutEnsureTab(s.tab);
    if (!tutState.active || tutState.i !== myStep) return;
    if (!tabOk) { tutorialNext(); return; }
  }
  const el = s.selector ? await tutWaitForEl(s.selector, 4000) : null;
  if (!tutState.active || tutState.i !== myStep) return;
  if (s.selector && !el) { tutorialNext(); return; } // missing target -> skip gracefully
  tutRenderStep(s, el, steps.length);
}
/* Fade the hole+text out while the next target loads — the dim stays up,
   so the screen is never interactive mid-tour. */
function tutFadeStep(out) {
  const hole = document.getElementById('tut-hole');
  const text = document.getElementById('tut-text');
  if (hole) hole.style.opacity = '0';
  if (text) text.style.opacity = '0';
}
function tutRenderStep(s, el, n) {
  const fa = tutLang() === 'fa';
  const hole = document.getElementById('tut-hole');
  const text = document.getElementById('tut-text');
  if (!hole || !text || !el) return;
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  const r = el.getBoundingClientRect();
  const pad = 8;
  hole.style.left = Math.max(6, r.left - pad) + 'px';
  hole.style.top = Math.max(6, r.top - pad) + 'px';
  hole.style.width = (r.width + pad * 2) + 'px';
  hole.style.height = (r.height + pad * 2) + 'px';
  hole.style.opacity = '1';
  /* One block: counter + title + body + Next + Skip, positioned in the
     largest free area (above or below the hole) and clamped to the viewport.
     The button can never cover the text, hide behind it, or fly off-screen. */
  text.innerHTML = '<div class="tut-counter">' + tutCounter(tutState.i, n, fa) + '</div>' +
    '<div class="tut-title">' + esc(s.kicker + ' ' + s.title) + '</div>' +
    '<div class="tut-body">' + esc(s.text) + '</div>' +
    '<button id="tut-next">' + (fa ? 'بعدی' : 'Next') + '</button>' +
    '<button id="tut-skip">' + (fa ? 'رد شو' : 'Skip tour') + '</button>';
  text.setAttribute('dir', fa ? 'rtl' : 'ltr');
  text.setAttribute('lang', fa ? 'fa' : 'en');
  const w = Math.min(340, window.innerWidth - 40);
  text.style.width = w + 'px';
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(20, Math.min(window.innerWidth - w - 20, left));
  text.style.left = left + 'px';
  text.style.visibility = 'hidden';
  text.style.opacity = '0';
  text.style.transform = 'translateY(8px)';
  const vh = window.innerHeight;
  const h = text.offsetHeight || 230;
  const above = r.top, below = vh - r.bottom;
  let top = above >= below ? Math.max(12, above - h - 20) : r.bottom + 20;
  top = Math.max(12, Math.min(vh - h - 12, top));
  text.style.top = top + 'px';
  text.style.bottom = 'auto';
  text.style.visibility = '';
  const nx = document.getElementById('tut-next');
  if (nx) nx.addEventListener('click', function (e) { e.stopPropagation(); tutorialNext(); });
  const sk = document.getElementById('tut-skip');
  if (sk) sk.addEventListener('click', function (e) { e.stopPropagation(); endTutorial(); });
  requestAnimationFrame(function () {
    if (!tutState.active) return;
    text.style.opacity = '1';
    text.style.transform = 'translateY(0)';
  });
}
function tutCounter(i, n, fa) {
  if (fa) {
    const f = function (x) { return String(x).replace(/\d/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[+d]; }); };
    return f(i + 1) + ' از ' + f(n);
  }
  return (i + 1) + ' of ' + n;
}
function tutReposition() {
  if (!tutState.active) return;
  const steps = buildTutorialSteps();
  const s = steps[tutState.i];
  const hole = document.getElementById('tut-hole');
  if (!s || !hole || !s.selector || hole.style.opacity === '0') return;
  let el = null;
  try { el = document.querySelector(s.selector); } catch (e) {}
  if (!el) return;
  tutRenderStep(s, el, steps.length); /* repositions hole + text block together */
}
/* Finale (Peak–End rule): centered message + one clear CTA. */
function showTutorialDone() {
  const hole = document.getElementById('tut-hole');
  const text = document.getElementById('tut-text');
  const fa = tutLang() === 'fa';
  if (hole) hole.style.opacity = '0';
  const catcher = document.getElementById('tut-catcher');
  if (catcher) catcher.style.background = 'rgba(7,10,24,.88)';
  if (!text) return;
  text.innerHTML = '<div class="tut-done-emoji">🎉</div>' +
    '<div class="tut-done-title">' + (fa ? 'تمومه!' : 'That\u2019s it!') + '</div>' +
    '<div class="tut-body">' + esc(fa ? 'بزن بریم سر درس امروز 🌱'
                                      : 'Let\u2019s dive into today\u2019s lesson 🌱') + '</div>' +
    '<button id="tut-cta">' + (fa ? 'شروع 🚀' : 'Let\u2019s go 🚀') + '</button>';
  text.setAttribute('dir', fa ? 'rtl' : 'ltr');
  text.setAttribute('lang', fa ? 'fa' : 'en');
  const w = Math.min(340, window.innerWidth - 40);
  text.style.width = w + 'px';
  text.style.left = ((window.innerWidth - w) / 2) + 'px';
  text.style.top = '36%';
  text.style.bottom = 'auto';
  text.style.transform = 'translateY(0)';
  text.style.opacity = '1';
  const cta = document.getElementById('tut-cta');
  if (cta) cta.addEventListener('click', function (e) { e.stopPropagation(); endTutorial(); state.lessonTab = 'words'; go('lesson'); });
}
function closeTutorialUI() {
  const ov = document.getElementById('tut-ov');
  if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
}

async function doLogout() {
  if (!quizGuardOk()) return;
  try { if (sb) await sb.auth.signOut(); } catch (e) {}
  logoutPushUser();
  state.user = null; state.lessons = []; state.lesson = null;
  state.adminUsers = []; state.quiz = null; state.justSignedUp = false;
  try { localStorage.removeItem('el_last_user'); } catch (e) {}
  /* Logout clears the muse_app_used flag too: after logout the landing
     returns, even for a browser that used the app before. The flag is
     set again the next time the visitor enters any app route. */
  try { localStorage.removeItem('muse_app_used'); } catch (e) {}
  // Logout -> static landing at '/', no hash. The old '#/landing' route is retired;
  // the static landing in index.html IS the homepage.
  window.location.replace('/');
}

/* Demo mode (no Supabase configured) */
const DEMO_USERS = [
  { id: 'demo-u1', email: 'sara@example.com', level: null, created_at: Date.now() - 86400000 },
  { id: 'demo-u2', email: 'reza@example.com', level: 'a1', created_at: Date.now() - 3 * 86400000 },
  { id: 'demo-u3', email: 'mina@example.com', level: 'b2', created_at: Date.now() - 5 * 86400000 }
];

async function demoLogin(asAdmin) {
  state.user = {
    id: 'demo-learner',
    email: asAdmin ? String((APP_CONFIG.ADMIN_EMAILS || [])[0] || 'admin@example.com') : 'demo-learner@example.com',
    level: 'b2',
    displayName: 'Demo',
    isAdmin: !!asAdmin,
    demo: true
  };
  state.adminUsers = DEMO_USERS.map(function (u) { return Object.assign({}, u); });
  state.lessons = await loadLessons('b2');
  state.lesson = state.lessons[0] || null;
  go('home');
}

/* ---------------- waiting view (level pending) ---------------- */
function renderWaiting(v) {
  v.innerHTML =
  '<div class="onb onb-wait">' +
    '<div class="onb-top"><span class="onb-brand">\uD83D\uDCD6 Muse English</span></div>' +
    '<h1 class="onb-title">One last step \uD83C\uDFAF<span class="onb-squiggle" aria-hidden="true"></span></h1>' +
    (state.justSignedUp ? '<p class="form-note">\u2713 Your account is created.</p>' : '') +
    '<p class="onb-sub">What\u2019s your English level? Pick the closest — your lessons start right away.</p>' +
    levelPickerHTML('wait-level') +
    '<div class="form-error" id="wait-error" role="alert"></div>' +
    '<button class="onb-cta" data-action="save-level">Start learning <span aria-hidden="true">\u2192</span></button>' +
    '<p class="onb-signed">Signed in as ' + esc(state.user.email) + '</p>' +
  '</div>';
}

async function saveWaitingLevel() {
  const el = document.querySelector('input[name="wait-level"]:checked');
  const errEl = document.getElementById('wait-error');
  if (!el) { if (errEl) errEl.textContent = 'Please pick your English level.'; return; }
  if (errEl) errEl.textContent = '';
  try {
    const { data: u } = await sb.auth.getUser();
    /* Server-side write via set_level RPC: profiles has no user
       UPDATE/INSERT policy, so a direct upsert is denied by RLS. */
    const r = await sb.rpc('set_level', { p_level: el.value });
    if (r.error || r.data !== true) throw new Error('set_level failed');
    state.user.level = el.value;
    state.justSignedUp = false;
    try { localStorage.removeItem('el_pending_level'); } catch (e) {}
    identifyPushUser(u.user.id, u.user.email, normalizeLevel(el.value));
    await maybeOfferTeacher();
  } catch (e) { if (errEl) errEl.textContent = 'Couldn\'t save — check your connection and try again.'; }
}

/* Profile self level-change (teacher-less learners only; the picker itself
   renders only when profiles.referred_by is empty). Same set_level RPC the
   waiting view uses — profiles has no user UPDATE policy. */
async function saveMyLevel() {
  const sel = document.getElementById('my-level-select');
  if (!sel || !sb) return;
  try {
    const r = await sb.rpc('set_level', { p_level: sel.value });
    if (r.error || r.data !== true) throw new Error('set_level failed');
    state.user.level = sel.value;
    state.lessons = await loadLessons(sel.value);
    state.lesson = state.lessons[0] || null;
    const v = document.querySelector('#view');
    if (v) renderProfile(v);
  } catch (e) { /* keep the old level on screen; the select still shows the unsaved pick */ }
}

/* Teacher offer: after the level is picked (new users) and once for existing
   users without a teacher (checked in afterLogin). One-time: choosing or
   skipping marks profiles.teacher_offer_seen so it never shows again. */
async function teacherOfferNeeded() {
  if (!sb || !state.user || state.user.demo || state.user.isAdmin || state.teacher) return false;
  try {
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return false;
    const { data: prof } = await sb.from('profiles')
      .select('referred_by,teacher_offer_seen').eq('id', u.user.id).maybeSingle();
    if (!prof || prof.referred_by || prof.teacher_offer_seen) return false;
    const t = await sb.rpc('approved_teachers_for_offer');
    return !t.error && (t.data || []).length > 0;
  } catch (e) { return false; }
}
async function maybeOfferTeacher() {
  /* Teacher invite auto-link (Alireza 2026-10-10): same as in afterLogin —
     ?ref=TEACHER_CODE links immediately, choose-teacher never shown. */
  if (!state.user.isAdmin && !state.user.demo) {
    try {
      const ref = getRefCode();
      if (ref) await sb.rpc('resolve_teacher_offer', { p_ref_code: ref });
    } catch (e) { /* not a teacher code: fall through */ }
  }
  try {
    if (await teacherOfferNeeded()) { go('choose-teacher'); hideSplashSoon(); return; }
  } catch (e) {}
  await afterLogin();
}

/* ---------------- choose your teacher (Persian, one-time offer) ---------------- */
function tchOfferCardHTML(t) {
  const photo = t.photo_url
    ? '<img class="tch-offer-photo" src="' + esc(t.photo_url) + '" alt="' + esc(t.display_name || '') + '" onerror="var d=document.createElement(\'div\');d.className=\'tch-offer-photo tch-offer-initial\';d.textContent=\'' + (t.display_name || '?').trim().charAt(0).replace(/['\\]/g, '') + '\';this.replaceWith(d)">'
    : '<div class="tch-offer-photo tch-offer-initial">' + esc((t.display_name || '?').trim().charAt(0)) + '</div>';
  const exp = (t.experience_years !== null && t.experience_years !== undefined && t.experience_years !== '')
    ? '<div class="muted">🎓 ' + t.experience_years + ' سال سابقه تدریس</div>' : '';
  const students = t.student_count
    ? '<div class="muted">👥 ' + t.student_count + ' زبان‌آموز</div>' : '';
  const bio = t.bio ? '<p class="tch-offer-bio">' + esc(t.bio) + '</p>' : '';
  return '<div class="tch-offer-card">' + photo +
    '<b class="tch-offer-name">' + esc(t.display_name || '?') + '</b>' +
    exp + students + bio +
    '<button class="onb-cta tch-offer-pick" data-tch-pick="' + esc(t.ref_code || '') + '">انتخاب</button></div>';
}
/* ---------------- choose your teacher v2 — mobile design (one-time offer) ---------------- */
var ct2Teachers = [];
var ct2Selected = null;
function ct2PhotoHTML(t, cls) {
  var ini = (t.display_name || '?').trim().charAt(0).toUpperCase();
  if (t.photo_url) return '<img class="' + cls + '" src="' + esc(t.photo_url) + '" alt="' + esc(t.display_name || '') + '" loading="lazy" onerror="var d=document.createElement(\'div\');d.className=\'' + cls + ' ct2-initial\';d.textContent=\'' + ini.replace(/['\\]/g, '') + '\';this.replaceWith(d)">';
  return '<div class="' + cls + ' ct2-initial">' + esc(ini) + '</div>';
}
function ct2PeopleSVG() {
  return '<svg class="ct2-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.4" fill="#7C6AF0"/><path d="M2.8 19.2c.7-3.2 3.3-5 6.2-5s5.5 1.8 6.2 5" stroke="#7C6AF0" stroke-width="2.2" stroke-linecap="round"/><circle cx="16.8" cy="9.2" r="2.7" fill="#9A8CF8"/><path d="M15.4 14.4c2.9.3 5 2 5.6 4.8" stroke="#9A8CF8" stroke-width="2.2" stroke-linecap="round"/></svg>';
}
function ct2CardHTML(t) {
  var sub = t.specialty ? esc(t.specialty) : (t.bio ? esc(t.bio) : '');
  var meta = '<span class="ct2-meta-bit">' + ct2PeopleSVG() + '<span>' + esc(String(t.student_count == null ? '' : t.student_count)) + ' \u0632\u0628\u0627\u0646\u200c\u0622\u0645\u0648\u0632</span></span>';
  if (t.experience_years) meta += '<span class="ct2-meta-bit"><span aria-hidden="true">👥</span><span>' + esc(String(t.experience_years)) + ' \u0633\u0627\u0644 \u0633\u0627\u0628\u0642\u0647</span></span>';
  var sel = ct2Selected === t.ref_code ? ' sel' : '';
  return '<button class="ct2-card' + sel + '" data-ct2-open="' + esc(t.ref_code || '') + '">' +
    ct2PhotoHTML(t, 'ct2-ava') +
    '<span class="ct2-info"><b class="ct2-name">' + esc(t.display_name || '?') + '</b>' +
    (sub ? '<span class="ct2-sub">' + sub + '</span>' : '') +
    '<span class="ct2-meta">' + meta + '</span></span>' +
    '<span class="ct2-check' + sel + '" aria-hidden="true">' + (sel ? '\u2713' : '') + '</span></button>';
}
function ct2FeatRows() {
  var feats = [
    { i: '\u2B50', t: '\u06A9\u0627\u0645\u0644\u0627\u064B \u0631\u0627\u06CC\u06AF\u0627\u0646\u0647', s: '\u0647\u06CC\u0686 \u0647\u0632\u06CC\u0646\u0647\u200C\u0627\u06CC \u0646\u062F\u0627\u0631\u0647.' },
    { i: '🎯', t: '\u067E\u06CC\u0634\u0631\u0641\u062A\u062A \u0632\u06CC\u0631 \u0646\u0638\u0631 \u0627\u0633\u062A\u0627\u062F\u0647', s: '\u0627\u0633\u062A\u0627\u062F \u0645\u0633\u06CC\u0631 \u06CC\u0627\u062F\u06AF\u06CC\u0631\u06CC\u062A \u0631\u0648 \u062F\u0646\u0628\u0627\u0644 \u0645\u06CC\u200C\u06A9\u0646\u0647.' },
    { i: '\u26A1', t: '\u0633\u0631\u06CC\u0639\u200C\u062A\u0631 \u0628\u0647\u062A\u0631 \u0634\u0648', s: '\u0628\u0627 \u06A9\u0645\u06A9 \u0627\u0633\u062A\u0627\u062F\u060C \u0632\u0628\u0627\u0646\u062A \u062E\u06CC\u0644\u06CC \u0632\u0648\u062F\u062A\u0631 \u0642\u0648\u06CC \u0645\u06CC\u200C\u0634\u0647.' }
  ];
  return feats.map(function (f) {
    return '<div class="ct2-feat"><span class="ct2-feat-ico">' + f.i + '</span>' +
      '<span class="ct2-feat-txt"><b>' + f.t + '</b><span>' + f.s + '</span></span>' +
      '<span class="ct2-feat-ok">\u2713</span></div>';
  }).join('');
}
function ct2Find(code) {
  for (var i = 0; i < ct2Teachers.length; i++) if (ct2Teachers[i].ref_code === code) return ct2Teachers[i];
  return null;
}
function paintCt2List(v) {
  var list = v.querySelector('#ct2-list');
  if (!list) return;
  list.innerHTML = ct2Teachers.map(ct2CardHTML).join('');
  list.querySelectorAll('[data-ct2-open]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = ct2Find(b.getAttribute('data-ct2-open'));
      if (t) { ct2Selected = t.ref_code; renderCt2Detail(v, t); }
    });
  });
}
async function renderChooseTeacher(v) {
  ct2Selected = null;
  v.innerHTML =
    '<div class="ct2-wrap" dir="rtl" lang="fa">' +
    '<div class="ct2-banner"><div class="ct2-banner-txt"><h1>\u06CC\u06A9 \u0627\u0633\u062A\u0627\u062F \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646</h1>' +
    '<p>\u0627\u0633\u0627\u062A\u06CC\u062F \u0645\u0633\u06CC\u0631 \u06CC\u0627\u062F\u06AF\u06CC\u0631\u06CC\u062A \u0631\u0648 \u062F\u0646\u0628\u0627\u0644 \u0645\u06CC\u200C\u06A9\u0646\u0646\u060C \u062A\u0645\u0631\u06CC\u0646 \u0645\u06CC\u200C\u062F\u0646 \u0648 \u0631\u0627\u0647\u0646\u0645\u0627\u06CC\u06CC\u062A \u0645\u06CC\u200C\u06A9\u0646\u0646.</p></div>' +
    '<img class="ct2-mascot" src="/media/teachers/mascot-graduate.png" alt="" onerror="this.style.display=\'none\'"></div>' +
    '<div id="ct2-list"><div class="empty">\u062F\u0631 \u062D\u0627\u0644 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC \u0627\u0633\u062A\u0627\u062F\u0647\u0627\u2026</div></div>' +
    '<div class="ct2-skipwrap"><button class="onb-skip" id="ct2-skip">\u0641\u0639\u0644\u0627\u064B \u0627\u0633\u062A\u0627\u062F \u0646\u0645\u06CC\u200C\u062E\u0648\u0627\u0645</button></div>' +
    '</div>';
  v.querySelector('#ct2-skip').addEventListener('click', function () { resolveTeacherOffer(null); });
  try {
    var r = await sb.rpc('approved_teachers_for_offer');
    if (r.error) throw r.error;
    ct2Teachers = r.data || [];
    if (!ct2Teachers.length) { resolveTeacherOffer(null); return; }
    paintCt2List(v);
  } catch (e) {
    var list = v.querySelector('#ct2-list');
    list.innerHTML = '<div class="empty">\u062E\u0637\u0627 \u062F\u0631 \u0628\u0627\u0631\u06AF\u0630\u0627\u0631\u06CC — <button class="btn btn-sm" id="ct2-retry">\u062A\u0644\u0627\u0634 \u062F\u0648\u0628\u0627\u0631\u0647</button></div>';
    var rb = list.querySelector('#ct2-retry');
    if (rb) rb.addEventListener('click', function () { renderChooseTeacher(v); });
  }
}
function renderCt2Detail(v, t) {
  var dstudents = '<div class="ct2-dstudents">' + ct2PeopleSVG() + '<span>' + esc(String(t.student_count == null ? '' : t.student_count)) + ' \u0632\u0628\u0627\u0646\u200C\u0622\u0645\u0648\u0632</span>';
  if (t.experience_years) dstudents += '<span class="ct2-dot">·</span><span>' + esc(String(t.experience_years)) + ' \u0633\u0627\u0644 \u0633\u0627\u0628\u0642\u0647</span>';
  dstudents += '</div>';
  v.innerHTML =
    '<div class="ct2-wrap" dir="rtl" lang="fa">' +
    '<div class="ct2-topbar"><button class="ct2-back" id="ct2-back" aria-label="\u0628\u0627\u0632\u06AF\u0634\u062A">' +
    '<svg viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5 8 12l6.5 6.5" stroke="#1E2A4E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
    '<div class="ct2-hero"><div class="ct2-blob" aria-hidden="true"></div>' +
    '<div class="ct2-hi" aria-hidden="true">Hi! 👋</div>' +
    ct2PhotoHTML(t, 'ct2-photo') + '</div>' +
    '<h1 class="ct2-dname">' + esc(t.display_name || '?') + '</h1>' +
    dstudents +
    (t.bio ? '<p class="ct2-bio">' + esc(t.bio) + '</p>' : '') +
    '<div class="ct2-feats">' + ct2FeatRows() + '</div>' +
    '<button class="ct2-select" id="ct2-select"><span>\u0627\u0646\u062A\u062E\u0627\u0628</span>' +
    '<svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5m6-6-6 6 6 6" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
    '</div>';
  v.querySelector('#ct2-back').addEventListener('click', function () { renderChooseTeacher(v); });
  var btn = v.querySelector('#ct2-select');
  btn.addEventListener('click', function () { btn.disabled = true; resolveTeacherOffer(t.ref_code); });
}
async function resolveTeacherOffer(refCode) {
  try {
    const r = await sb.rpc('resolve_teacher_offer', { p_ref_code: refCode || '' });
    if (r.error) throw r.error;
  } catch (e) { /* offline: offer will show again next login; still let them in */ }
  /* FIX 2026-10-09: navigate into the app. Before this, afterLogin() re-rendered
     #/choose-teacher (hash never changed), so choosing a teacher looped back
     to the same page forever. */
  go('home');
  await afterLogin();
}
async function checkLevel() {
  if (state.user.demo) { await afterLogin(); return; }
  try {
    const { data: u } = await sb.auth.getUser();
    const { data: prof } = await sb.from('profiles').select('level').eq('id', u.user.id).single();
    if (prof && prof.level) {
      state.user.level = prof.level;
      state.justSignedUp = false;
      await afterLogin();
    } else {
      show('waiting');
    }
  } catch (e) { show('waiting'); }
}

