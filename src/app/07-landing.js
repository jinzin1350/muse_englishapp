/* ---------------- LANDING (public) ---------------- */
function heroPreviewHTML(m) {
  if (!m) {
    return '<div class="lp-lesson-card"><div class="lp-lesson-body">' +
      '<p class="lp-muted">Today’s lesson preview is loading…</p></div></div>';
  }
  const nWords = (m.words || []).length;
  const nQuiz = (m.quiz || []).length;
  const checks = [
    ['📚', 'Learn useful words', nWords ? nWords + ' new words with photos' : 'New words with photos'],
    ['🎧', 'Listen and shadow', m.podcast && m.podcast.title ? esc(m.podcast.title) : 'Podcast + shadowing practice'],
    ['📝', 'Test yourself', nQuiz ? nQuiz + '-question quiz' : 'Quiz on today’s words'],
    ['📈', 'Daily progress', 'Track scores and review mistakes']
  ];
  return '' +
  '<div class="lp-lesson-card" aria-label="Preview of today’s lesson">' +
    '<div class="lp-lesson-head"><span class="lp-lesson-brand"><img src="/icons/icon-192.png" alt=""><span>Muse English</span></span>' +
    '<span class="lp-lesson-level">' + esc(levelLabel(normalizeLevel(m.level))) + '</span></div>' +
    '<div class="lp-lesson-body">' +
      '<div class="lp-lesson-date">' + esc(m.date || '') + ' · Today’s lesson</div>' +
      '<div class="lp-lesson-theme">' + esc(m.theme || 'Daily lesson') + '</div>' +
      '<ul class="lp-lesson-checks">' + checks.map(function (c) {
        return '<li><span class="lp-ck" aria-hidden="true">' + c[0] + '</span><span><b>' + c[1] + '</b><br><span class="lp-muted">' + c[2] + '</span></span></li>';
      }).join('') + '</ul>' +
      '<div class="lp-lesson-bar" role="img" aria-label="Daily progress example"><div></div></div>' +
      '<div class="lp-muted">Your daily progress — tracked automatically</div>' +
      '<a class="lp-cta lp-cta-block" href="#/signup">Start learning</a>' +
    '</div>' +
  '</div>';
}

function renderLanding(v) {
  /* The static landing in index.html IS the landing page — there is no JS
     landing view anymore. The safety net uses the SAME app-mode rule as
     the head script and may drop app-mode ONLY when none of its signals
     is true:
     - WITH a hash (old '#/landing' link, bookmark, stale navigation):
       drop the hash — the static landing at '/' is the one homepage.
       An EXPLICIT '#/landing' means "show me the landing": set a
       one-shot session flag so the '/' redirect shows the landing even
       for a returning app user, whose muse_app_used flag would
       otherwise send '/' straight back to the app preview.
     - WITH an exact '#/' hash from an anonymous visitor (no session,
       no push/referral param — installed-PWA included, whose cold start
       never carries '#/'): '#/' IS the landing —
       show it in place with no redirect. Redirecting to '/' would loop
       straight back into #/preview via the muse_app_used flag: that was
       the 2026-10-14 preview trap (the preview/auth "back" links could
       never reach the landing).
     - WITHOUT a hash (plain '/') but an app signal is true (standalone
       PWA, ?lesson=latest / ?ref=, muse_app_used flag): this is an
       anonymous app user, not a first-time visitor — open the app's
       public lesson preview (#/preview) instead of the landing.
       EXCEPT when the one-shot force-landing flag is set: show the
       landing this once, then consume the flag.
     - Otherwise: clear #view and drop app-mode so the static landing
       shows (first-time visitors and crawlers). */
  var _h = window.location.hash || '';
  if (_h === '#/landing') {
    try { sessionStorage.setItem('muse_force_landing', '1'); } catch (e) {}
    window.location.replace('/'); return;
  }
  /* 2026-10-14: an anonymous '#/' IS the landing (see shouldEnterAppMode).
     Show it in place with no redirect — redirecting to '/' would send a
     returning visitor straight back into #/preview (the muse_app_used
     flag), which is exactly the trap the preview/auth "back" links fell
     into. Signed-in visitors never reach here with '#/' (onRoute moves
     them to #/home). */
  if (_h === '#/' && !shouldEnterAppMode()) {
    document.documentElement.classList.remove('app-mode');
    v.innerHTML = '';
    return;
  }
  if (_h) {
    window.location.replace('/'); return;
  }
  try {
    if (sessionStorage.getItem('muse_force_landing') === '1') {
      sessionStorage.removeItem('muse_force_landing');
      document.documentElement.classList.remove('app-mode');
      v.innerHTML = '';
      return;
    }
  } catch (e) {}
  /* 2026-10-16 (Alireza): teacher referral links (?ref=CODE) land on the app's
     home — never the preview page, which confuses new students. Signed-in
     visitors reach #/home; anonymous visitors reach the public home (landing)
     through onRoute's auth gate, then sign up and get auto-linked to the
     teacher via resolve_teacher_offer. Other app-mode entries (push deep
     links, returning visitors, PWA cold start) keep the preview. */
  if (shouldEnterAppMode()) {
    try {
      if (new URLSearchParams(window.location.search).get('ref')) { go('home'); return; }
    } catch (e) {}
    go('preview'); return;
  }
  document.documentElement.classList.remove('app-mode');
  v.innerHTML = '';
}

function renderPreviewTab(which, m) {
  const body = document.getElementById('preview-tab-body');
  if (!body) return;
  $$('.preview-tab').forEach(function (t) {
    const sel = t.getAttribute('data-ptab') === which;
    t.setAttribute('aria-selected', String(sel));
    body.setAttribute('aria-labelledby', t.id && sel ? t.id : body.getAttribute('aria-labelledby'));
  });
  if (!m) { body.innerHTML = '<p class="muted">Could not load the lesson preview.</p>'; return; }
  if (which === 'words') {
    const words = (m.words || []).slice(0, 4);
    body.innerHTML = '<div class="preview-words">' + words.map(function (w) {
      return '<div class="preview-word">' +
        (w.photo ? '<img src="' + esc(w.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        '<div><div class="pw-word">' + esc(w.word) + '</div>' +
        '<div class="pw-meaning">' + esc(w.meaning || '') + '</div></div></div>';
    }).join('') + '</div>' +
    '<p class="muted" style="margin-top:0.8rem">' + (m.words || []).length + ' words in today’s lesson · <a class="link" href="#/preview">see them all</a></p>';
  } else if (which === 'listen') {
    body.innerHTML = (m.podcast && m.podcast.audio)
      ? audioCardHTML({ id: 'preview-podcast', src: m.podcast.audio, title: m.podcast.title || 'Podcast',
          sub: 'From today’s lesson', speeds: false, download: false, transcript: m.podcast.transcript || null })
      : '<p class="muted">No audio preview available.</p>';
    wireAudioCards(body);
  } else {
    const q = (m.quiz || [])[0];
    body.innerHTML = '<div class="preview-quiz-teaser">' +
      (q ? '<div class="quiz-q">' + esc(q.question) + '</div>' +
        '<div>' + q.options.map(function (o) { return '<span class="badge-level" style="margin:0.15rem">' + esc(o) + '</span>'; }).join(' ') + '</div>'
        : '<p class="muted">A short quiz closes every lesson.</p>') +
      '<p class="muted" style="margin-top:0.9rem">Create an account to take the full quiz and track your score.</p>' +
      '<a class="btn" href="#/signup">Start learning</a></div>';
  }
  refreshTrackCards();
}

