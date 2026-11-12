/* ---------------- auth: separate sign-in / create-account views ---------------- */
function authShell(inner) {
  return '<div class="auth">' +
    '<div class="auth-glow" aria-hidden="true"></div>' +
    '<a class="auth-back" href="#/"><img src="/icons/icon-192.png" alt=""><span>Muse English</span></a>' +
    '<div class="auth-card">' +
      '<img class="auth-mascot" src="/media/podcast/mascot-96.webp" alt="Muse English mascot">' +
      inner +
    '</div>' +
  '</div>';
}

function renderSignin(v) {
  const configured = supabaseKeysPresent();
  v.innerHTML = authShell(
    '<h1>Welcome back 👋</h1>' +
    '<p class="muted">Sign in to continue your lessons.</p>' +
    (configured ?
      googleButtonHTML('si') +
      '<form id="form-signin" novalidate>' +
        '<div class="field"><label for="si-email">Email</label>' +
        '<input id="si-email" name="signin-email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label for="si-pass">Password</label>' +
        '<div class="pw-wrap"><input id="si-pass" name="signin-password" type="password" autocomplete="current-password" placeholder="••••••••" required>' +
        '<button type="button" class="pw-toggle" data-action="pw-toggle" aria-label="Show password">👁️</button></div></div>' +
        '<div class="form-error" id="si-error" role="alert"></div>' +
        '<div class="form-note" id="si-note" role="status"></div>' +
        '<button class="btn btn-block" type="submit" id="si-submit">Sign in</button>' +
      '</form>' +
      '<p class="auth-switch">New here? <a class="link" href="#/signup">Create an account</a></p>'
    :
      '<div class="coming-soon">🔑 Real login is not connected yet — add your Supabase keys in <b>js/config.js</b> to enable it.</div>' +
      '<button class="btn btn-block" data-action="demo-learner">Continue in demo mode (learner)</button>' +
      '<button class="btn btn-ghost btn-block" data-action="demo-admin">Continue in demo mode (admin)</button>'
    )
  );
  if (peekAuthReturnPath() === '/teachers') {
    authNote('si', '🍎 Teacher login: after you sign in (Google or email) you go straight to the teacher portal.');
  }
  // Arriving here right after signup: prefill email + explain the next step.
  if (state.afterSignup) {
    const em = document.getElementById('si-email');
    if (em) em.value = state.afterSignup;
    authNote('si', '✓ Account created! Check your inbox for the confirmation email, then sign in.');
    state.afterSignup = null;
  }
  // Signup with email confirmation required: popup explaining they must
  // confirm the email before they can enter the app.
  if (state.showConfirmPopup) {
    const em2 = state.showConfirmPopup;
    state.showConfirmPopup = null;
    showModal(
      '<div class="modal-ico">📧</div>' +
      '<h2>Check your inbox</h2>' +
      '<p>We sent a confirmation email to<br><b>' + esc(em2) + '</b>.</p>' +
      '<p>Click the link inside it to confirm your email address — then you can sign in and enter the app.</p>' +
      '<button class="btn btn-block" data-action="modal-close">OK, got it</button>',
      true
    );
  }
}

/* Self-declared level at signup: 5 levels, A1 preselected so one tap on
   "Start learning" continues. No waiting for manual approval — the user
   enters the app immediately. */
const SIGNUP_LEVELS = [
  { id: 'a1', name: 'Beginner', desc: "I'm starting from zero", icon: '🌱' },
  { id: 'a2', name: 'Elementary', desc: 'I understand simple sentences', icon: '🌿' },
  { id: 'b1', name: 'Intermediate', desc: 'I can hold a conversation', icon: '📊' },
  { id: 'b2', name: 'Upper-intermediate', desc: 'I speak well but want to improve', icon: '💬' },
  { id: 'c1', name: 'Advanced', desc: "I'm fluent, I want depth", icon: '🚀' },
];
function levelPickerHTML(name) {
  return '<div class="level-pick">' + SIGNUP_LEVELS.map(function (l) {
    return '<label class="level-opt"><input type="radio" name="' + name + '" value="' + l.id + '"' + (l.id === 'a1' ? ' checked' : '') + '>' +
      '<span class="level-card"><span class="level-ico">' + l.icon + '</span>' +
      '<span class="level-name">' + l.name + '</span>' +
      '<span class="level-desc">' + l.desc + '</span></span></label>';
  }).join('') + '</div>';
}

function renderSignup(v) {
  const configured = supabaseKeysPresent();  v.innerHTML = authShell(
    '<h1>Create your account ✨</h1>' +
    '<p class="muted">One lesson a day — words, listening, speaking and a quiz, for your level.</p>' +
    (configured ?
      // Distinct form/field names + autocomplete=new-password keep the browser
      // from dropping saved *login* credentials into the signup form.
      googleButtonHTML('su') +
      '<form id="form-signup" novalidate autocomplete="off">' +
        '<div class="field"><label for="su-email">Email</label>' +
        '<input id="su-email" name="signup-email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="field"><label for="su-pass">Password</label>' +
        '<div class="pw-wrap"><input id="su-pass" name="signup-password" type="password" autocomplete="new-password" placeholder="Choose a password (min 6 characters)" required minlength="6">' +
        '<button type="button" class="pw-toggle" data-action="pw-toggle" aria-label="Show password">👁️</button></div></div>' +
        '<div class="field"><label for="su-nick">Nickname</label>' +
        '<input id="su-nick" name="signup-nickname" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. word_warrior" maxlength="20" required>' +
        '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">Shown on the Challenge leaderboard · 3–20 characters: A–Z, 0–9, _ or -</p></div>' +
        '<div class="field"><label for="su-phone">Mobile number</label>' +
        '<input id="su-phone" name="signup-phone" type="tel" autocomplete="tel" placeholder="e.g. +98 912 345 6789" required>' +
        '<p class="muted" style="margin:0.3rem 0 0;font-size:0.8rem">So your teacher can reach you — international format is fine.</p></div>' +
        '<div class="field"><label>Your English level</label>' + levelPickerHTML('su-level') +
        '<p class="muted" style="margin-top:0.4rem">Pick the closest one — your lessons start right away.</p></div>' +
        '<div class="form-error" id="su-error" role="alert"></div>' +
        '<div class="form-note" id="su-note" role="status"></div>' +
        '<button class="btn btn-block" type="submit" id="su-submit">Create account</button>' +
      '</form>' +
      '<p class="auth-switch">Already have an account? <a class="link" href="#/signin">Sign in</a></p>'
    :
      '<div class="coming-soon">🔑 Real signup is not connected yet — add your Supabase keys in <b>js/config.js</b> to enable it.</div>' +
      '<button class="btn btn-block" data-action="demo-learner">Continue in demo mode (learner)</button>'
    )
  );
}

