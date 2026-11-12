/* ---------------- events (delegation) ---------------- */
function bindEvents() {
  // Global guard: direct hash links (profile dropdown, score screens, …)
  // bypass go(), so confirm here before an in-progress quiz is discarded.
  document.addEventListener('click', function (e) {
    if (!state.quiz) return;
    const a = e.target.closest('a[href^="#/"]');
    if (a && a.getAttribute('href') !== window.location.hash && !quizGuardOk()) {
      e.preventDefault();
    }
  }, true);

  $('#view').addEventListener('click', async function (e) {
    const t = e.target.closest('[data-action]');
    // Landing preview tabs (not data-action based)
    const ptab = e.target.closest('[data-ptab]');
    if (ptab) { renderPreviewTab(ptab.getAttribute('data-ptab'), state.previewLesson); return; }
    if (!t) return;
    const a = t.getAttribute('data-action');

    if (a === 'demo-learner') demoLogin(false);
    else if (a === 'demo-admin') demoLogin(true);
    else if (a === 'pw-toggle') togglePw(t);
    else if (a === 'skip-back') { const card = t.closest('[data-audio-card]'); if (card) skipCard(card, -10); }
    else if (a === 'skip-fwd') { const card = t.closest('[data-audio-card]'); if (card) skipCard(card, 10); }
    else if (a === 'check-level') checkLevel();
    else if (a === 'save-level') saveWaitingLevel();
    else if (a === 'save-my-level') saveMyLevel();
    else if (a === 'save-country') saveCountryManual();
    else if (a === 'logout') doLogout();
    else if (a === 'tut-replay') startTutorial();
    else if (a === 'ui-lang') setUiLang(t.getAttribute('data-lang') === 'en' ? 'en' : 'fa');
    else if (a === 'open-lesson') { state.lessonTab = 'words'; go('lesson', t.getAttribute('data-date')); }
    else if (a === 'today-cta') {
      const d = t.getAttribute('data-date');
      state.lessonTab = t.getAttribute('data-tab') || 'words';
      go('lesson', d);
    }
    else if (a === 'lesson-rate') {
      const sc = parseInt(t.getAttribute('data-score'), 10);
      const lm = state.lesson;
      try { trackEvent('lesson_rating', { score: sc, level: lm && lm.level, date: lm && lm.date }); } catch (e) {}
      const card = t.closest('.rate-card');
      if (card) {
        const fa = (typeof uiLang === 'function' && uiLang() === 'fa');
        const dict = window.MUSE_FA_UI && window.MUSE_FA_UI.t;
        const thanks = fa && dict && dict['Thanks for your feedback!'] ? dict['Thanks for your feedback!'] : 'Thanks for your feedback!';
        card.innerHTML = '<p class="rate-thanks">' + thanks + '</p>';
      }
    }
    else if (a === 'toggle-lesson-fa') {
      state.lessonFaShow = !state.lessonFaShow;
      renderLessonTab($('#lesson-body'));
    }
    else if (a === 'lesson-tab') {
      if (!quizGuardOk()) return;
      state.lessonTab = t.getAttribute('data-tab');
      $$('.lesson-tab').forEach(function (b) {
        const sel = b.getAttribute('data-tab') === state.lessonTab;
        b.setAttribute('aria-selected', String(sel));
      });
      renderLessonTab($('#lesson-body'));
    }
    else if (a === 'play-track') playTrack(t.getAttribute('data-src'), t.getAttribute('data-title'));
    else if (a === 'toggle-transcript') {
      toggleTranscript(t);
      t.setAttribute('aria-expanded', String(!t.closest('[data-audio-card]').querySelector('.transcript-panel').classList.contains('hidden')));
    }
    else if (a === 'speed') { player.el.playbackRate = parseFloat(t.getAttribute('data-rate')); refreshTrackCards(); }
    else if (a === 'quiz-start') startQuiz(t.getAttribute('data-kind'));
    else if (a === 'quiz-opt') answerQuiz(parseInt(t.getAttribute('data-idx'), 10));
    else if (a === 'quiz-next') nextQuiz();
    else if (a === 'duo-opt') duoAnswer(parseInt(t.getAttribute('data-idx'), 10));
    else if (a === 'duo-next') duoNext();
    else if (a === 'duo-pick') duoPick(parseInt(t.getAttribute('data-bi'), 10));
    else if (a === 'duo-hint') duoHint();
    else if (a === 'duo-unpick') duoUnpick(parseInt(t.getAttribute('data-bi'), 10));
    else if (a === 'duo-check') duoCheck();
    else if (a === 'duo-typein-check') duoTypeinCheck();
    else if (a === 'duo-exit') duoExit();
    else if (a === 'duo-quit') duoQuit();
    else if (a === 'duo-keep') duoKeep();
    else if (a === 'duo-earn-heart') {
      /* wait for the just-saved mistake (max ~5s), then open the review quiz.
         An in-progress quiz is stashed so the student can resume it exactly
         where they left off after the review (Fix 2: word/grammar too). */
      t.disabled = true;
      if (state.quiz && (state.quiz.kind === 'assignment' || state.quiz.kind === 'word' || state.quiz.kind === 'grammar' || state.quiz.kind === 'sentence' || state.quiz.kind === 'tricky')) {
        state.pausedQuiz = state.quiz;
        saveProgressAny();
      }
      var waitSave = duoSavePending.catch(function () {});
      var timeout = new Promise(function (res) { setTimeout(res, 5000); });
      Promise.race([waitSave, timeout]).then(function () { return getMistakes(); }).then(function (arr) {
        if (arr.length) {
          state.quiz = null;
          document.body.classList.remove('duo-playing');
          startQuiz('mistakes');
        } else {
          t.disabled = false;
          var note = document.getElementById('duo-earn-note');
          if (note) {
            note.textContent = 'No mistakes to review yet — hearts refill tomorrow! 🌅';
            note.style.display = 'block';
          }
        }
      });
    }
    else if (a === 'duo-buy-hearts') { buyHearts(t); }
    else if (a === 'resume-paused') {
      const pq = state.pausedQuiz;
      state.pausedQuiz = null;
      if (pq && (pq.kind === 'assignment' || pq.kind === 'word' || pq.kind === 'grammar' || pq.kind === 'saved' || pq.kind === 'srs' || pq.kind === 'sentence' || pq.kind === 'tricky')) {
        /* the heart-killing question was answered wrong — let them retry it fresh.
           Hearts earned in review apply: keep the better of saved/current (Fix 2). */
        if (pq.log && pq.log.length > pq.idx) pq.log.pop();
        pq.answered = false; pq.picked = -1; pq.wasCorrect = false;
        pq.hearts = Math.max(pq.hearts || 0, getHearts());
        state.quiz = pq;
        document.body.classList.add('duo-playing');
        saveProgressAny();
        renderDuoQuizView();
      } else { go('home'); }
    }
    else if (a === 'att-toggle') { toggleAttemptDetail(parseInt(t.getAttribute('data-i'), 10) || 0); }
    else if (a === 'home-mistakes') {
      getMistakes().then(function (arr) {
        if (mistakesDueCount(arr)) startQuiz('mistakes');
        else showMistakesNotice(arr.length);
      });
    }
    else if (a === 'practice-again') {
      getMistakes().then(function (arr) {
        if (arr.length) startQuiz('mistakes');
        else go('review');
      });
    }
    else if (a === 'practice-saved') {
      getSavedWords().then(function (arr) {
        if (arr.length >= 2) startQuiz('saved');
        else go('review');
      });
    }
    else if (a === 'review-due-start') {
      getSavedWords().then(function (arr) {
        if (arr.length >= 2 && srsDueRows(arr).length) startQuiz('srs');
        else location.hash = '#/review/words';
      });
    }
    else if (a === 'sentence-game') {
      getSavedWords().then(function (arr) {
        if (buildSentenceDeck(arr).length) startQuiz('sentence');
        else go('review');
      });
    }
    else if (a === 'tricky-all') { state._trickyScope = 'all'; startQuiz('tricky'); }
    else if (a === 'tricky-cat') { state._trickyScope = t.getAttribute('data-cat'); startQuiz('tricky'); }
    else if (a === 'toggle-save-word') { toggleSaveWordBtn(t); }
    else if (a === 'vc-toggle-save') { toggleVocabSaveBtn(t); }
    else if (a === 'unsave-word') {
      removeSavedWord(t.getAttribute('data-id'), t.getAttribute('data-word'), t.getAttribute('data-date')).then(function () {
        if (state.view === 'review') renderMistakes($('#view'), state.reviewArg);
        else if (state.view === 'lesson' && state.lessonTab === 'words') renderLessonTab($('#lesson-body'));
      });
    }
    else if (a === 'unsave-sp') {
      removeSavedSp(t.getAttribute('data-date'), t.getAttribute('data-i'));
      if (state.view === 'review') renderMistakes($('#view'), state.reviewArg);
    }
    else if (a === 'sp-say-saved') {
      /* TTS fallback for saved sentences from lessons without per-sentence
         audio (same fallback the shadowing tab itself uses). */
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(t.getAttribute('data-text') || '');
        u.lang = 'en-US'; u.rate = 0.9;
        speechSynthesis.speak(u);
      } catch (e) {}
    }
    else if (a === 'sp-practice-saved') { practiceSavedSentence(t); }
    else if (a === 'review-today') {
      const d = t.getAttribute('data-date');
      getMistakes().then(function (arr) {
        if (arr.some(function (x) { return x.date === d; })) startQuiz('mistakes', d);
        else go('review');
      });
    }
    else if (a === 'enable-push') promptPush(t);
    else if (a === 'ch-period') { state.challengePeriod = t.getAttribute('data-p'); renderChallenge($('#view')); }
    else if (a === 'choose-nickname') {
      ensureNickname().then(function () { if (state.view === 'challenge') renderChallenge($('#view')); });
    }
    else if (a === 'copy-teacher-link') copyTeacherLink(t);
    else if (a === 'copy-ptest-link') copyPlacementLink();
    else if (a === 'ptest-detail') openPlacementDetail(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'ptest-detail-close') { const pd = document.getElementById('tch-ptest-detail'); if (pd) pd.innerHTML = ''; }
    else if (a === 'teacher-student') openTeacherStudent(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'teacher-student-close') { const d = document.getElementById('tch-detail'); if (d) d.innerHTML = ''; }
    else if (a === 'teacher-set-level') teacherSetLevel(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-cert-issue') teacherIssueCert(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-remove-student') teacherRemoveStudent(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-cert-revoke') teacherRevokeCert(t.getAttribute('data-code'), parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'cert-print') printCertificate();
    else if (a === 'cert-share') shareCertificate(t.getAttribute('data-code'), t);
    else if (a === 'vc-say') playVocabAudio(t.getAttribute('data-audio'));
    else if (a === 'teacher-nudge') teacherNudge(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-sent') toggleTeacherSent(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'teacher-message') teacherMessageComposer(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'assignment-compose') teacherAssignmentComposer();
    else if (a === 'tw-logout') twLogout();
    else if (a === 'assignment-create') createAssignment(t);
    else if (a === 'planner-save') savePlanner(t);
    else if (a === 'ai-report-student') aiReportStudent(t);
    else if (a === 'ai-report-tstudent') aiReportTeacherStudent(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'ai-report-class') aiReportClass(t);
    else if (a === 'an-wrong') {
      const w = document.getElementById('an-w-' + t.getAttribute('data-i') + '-' + t.getAttribute('data-k'));
      if (w) w.classList.toggle('hidden');
    }
    else if (a === 'assignment-open') openTeacherAssignment(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'sum-record') toggleSummaryRecording();
    else if (a === 'as-toggle') {
      const uid = t.getAttribute('data-uid');
      state._asCollapsed = state._asCollapsed || {};
      state._asCollapsed[uid] = !state._asCollapsed[uid];
      loadTeacherAssignments();
    }
    else if (a === 'assignment-cancel') cancelScheduledAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'assignment-delete') deleteTeacherAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (a === 'assignment-start') startAssignment(parseInt(t.getAttribute('data-i'), 10));
    else if (a === 'inbox-open') { closeModal(); go('inbox'); }
    else if (a === 'inbox-retry') { renderInbox(document.getElementById('view')); }
    else if (a === 'bot-save') { saveAdminBot(t); }
    else if (a === 'bot-chat-save') { saveAdminBotChat(t); }
    else if (a === 'google-signin') signInWithGoogle(t.getAttribute('data-prefix'), t);
    else if (a === 'approve-teacher') adminApproveTeacher(t.getAttribute('data-id'));
    else if (a === 'reject-teacher') adminRejectTeacher(t.getAttribute('data-id'));
    else if (a === 'adm-metric') { state.adminMetric = t.getAttribute('data-m'); renderAdminAnalytics(); }
    else if (a === 'adm-user') openAdminUser(t.getAttribute('data-id'));
    else if (a === 'adm-teacher-view') {
      const ref = t.getAttribute('data-ref');
      sb.from('teachers').select('user_id').eq('ref_code', ref).maybeSingle().then(function (r) {
        if (r.data && r.data.user_id) go('admin-teacher', r.data.user_id);
      });
    }
    else if (a === 'adm-user-close') { const d = document.getElementById('adm-detail'); if (d) d.innerHTML = ''; }
  });

  $('#view').addEventListener('change', function (e) {
    const t = e.target.closest('[data-user-id]');
    if (t) setUserLevel(t.getAttribute('data-user-id'), t.value);
  });

  $('#view').addEventListener('submit', function (e) {
    if (e.target.id === 'form-signin') { e.preventDefault(); doLogin(); }
    else if (e.target.id === 'form-signup') { e.preventDefault(); doSignup(); }
    else if (e.target.id === 'form-teacher-add') { e.preventDefault(); adminAddTeacher(); }
  });

  // Tabbar: quiz guard before navigating away
  $$('#tabbar .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      const tv = t.getAttribute('data-view');
      if (tv === 'lesson') {
        if (!quizGuardOk()) return;
        state.lessonTab = 'words';
        if (state.lessons.length) go('lesson', state.lessons[0].date);
        else go('home');
      } else {
        go(tv);
      }
    });
  });


  // Modal popups live on document.body (outside #view), so they need their own handler.
  document.addEventListener('click', function (e) {
    const t = e.target.closest('#app-modal [data-action]');
    if (!t) return;
    const ma = t.getAttribute('data-action');
    if (ma === 'modal-close') closeModal();
    else if (ma === 'welcome-tour') { closeModal(); startTutorial(); }
    else if (ma === 'welcome-start') { closeModal(); state.lessonTab = 'words'; if (state.lessons && state.lessons.length) go('lesson', state.lessons[0].date); else go('lesson'); }
    else if (ma === 'teacher-message-send') teacherMessageSend(parseInt(t.getAttribute('data-i'), 10), t);
    else if (ma === 'assignment-create') createAssignment(t);
    else if (ma === 'assignment-cancel') cancelScheduledAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (ma === 'assignment-delete') deleteTeacherAssignment(parseInt(t.getAttribute('data-i'), 10), t);
    else if (ma === 'inbox-open') { closeModal(); go('inbox'); }
  });
  // Tutorial overlay buttons live on document.body too, but they wire their
  // own listeners in startTutorial() (the dim advances on tap).
  $('#mp-toggle').addEventListener('click', function () {
    if (!player.src) return;
    if (player.el.paused) player.el.play().catch(function () {});
    else player.el.pause();
  });
  $('#mp-close').addEventListener('click', function () { closePlayer(); });
  const mpProg = $('#mp-progress');
  if (mpProg) {
    mpProg.addEventListener('click', seekFromEvent);
    mpProg.addEventListener('keydown', function (e) {
      const dur = player.el.duration;
      if (!dur || !isFinite(dur)) return;
      if (e.key === 'ArrowRight') { player.el.currentTime = Math.min(dur, player.el.currentTime + 10); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { player.el.currentTime = Math.max(0, player.el.currentTime - 10); e.preventDefault(); }
      refreshTrackCards();
    });
  }

  window.addEventListener('hashchange', onRoute);
}

