

function isPanelPath() { return window.location.pathname.indexOf('/manage') === 0; }

document.addEventListener('DOMContentLoaded', init);

/* Test/debug hooks (harmless in production). */
window.MuseApp = {
  state: state, player: player, showModal: showModal, closeModal: closeModal,
  detectCountry: detectCountry, maybeShowWelcome: maybeShowWelcome,
  renderSignin: renderSignin, renderProfile: renderProfile,
  ensureCountrySaved: ensureCountrySaved,
  queuePointsPopup: queuePointsPopup, ensureNickname: ensureNickname,
  renderChallenge: renderChallenge, awardPoints: awardPoints, demoLogin: demoLogin,
  launchCelebration: launchCelebration, maybeShowInboxPrompt: maybeShowInboxPrompt,
  renderInbox: renderInbox, loadAdminBot: loadAdminBot, saveAdminBot: saveAdminBot,
};

