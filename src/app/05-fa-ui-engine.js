/* ---------------- Persian app UI (2026-11-12, Claude for Alireza) ----------------
   Learners at A1–B1 (and everyone on the sign-in / sign-up screens) see the
   app's menus, buttons and labels in Persian. The markup in this file stays
   English; js/fa-ui.js (window.MUSE_FA_UI, written by Claude) holds the
   Persian for each label, and this engine swaps the text in the DOM as views
   render (a MutationObserver), so new screens need no code changes here.
   - Exact match on a whole text node (or placeholder / aria-label / title),
     then the regex rules in MUSE_FA_UI.rx for labels with numbers or names.
   - Learning content (English words, meanings, examples, transcripts,
     questions) is never matched: anything inside FA_SKIP is left alone, and
     a label that is not in the dictionary simply stays English.
   - B2+ learners keep the English UI. Profile > App language overrides it
     (localStorage muse_ui_lang = 'fa' | 'en').
   - Lesson themes come from /data/fa/themes.json (seo/fa-pages/blog_fa.py). */
var FA_OFF_VIEWS = ['admin', 'admin-teacher', 'teacher', 'planner', 'certificate'];
var FA_SKIP = ['#landing', '.pv', 'script', 'style', 'textarea', 'code', 'body [dir="ltr"]', 'body [lang="en"]', '[data-no-fa]',
  '.word-title', '.word-meaning', '.word-example', '.word-pron', '.transcript-panel', '.rule-card', '.example-card',
  'details.practice', '.gt3-sec:not(.gt3-fa)', '.gt-q', '.gt-opt', '.gt-opts', '.gt-sheet-explain:not([lang="fa"])',
  '[data-fa-skip]'].join(',');
var _faOn = false, _faObs = null, _faThemes = false, _faLog = [];
/* Undo log, so the English UI comes back when Persian turns off (e.g. a B2 learner signs in). */
function faRestore() {
  for (var i = _faLog.length - 1; i >= 0; i--) {
    var r = _faLog[i], x = r[0];
    if (!x.isConnected) continue;
    if (r[1] === '#text') {
      x.nodeValue = r[2];
      var sp = x.parentNode;
      if (sp && sp.nodeName === 'SPAN' && sp.hasAttribute('data-fa-wrap') && sp.parentNode) sp.parentNode.replaceChild(x, sp);
    } else if (r[2] === null) x.removeAttribute(r[1]);
    else x.setAttribute(r[1], r[2]);
  }
  _faLog = [];
}
function faUi() { return (typeof window !== 'undefined' && window.MUSE_FA_UI) || null; }
function uiLang() {
  var o = null;
  try { o = localStorage.getItem('muse_ui_lang'); } catch (e) {}
  if (o === 'fa' || o === 'en') return o;
  var u = state.user;
  if (!u) return 'fa';
  if (u.isAdmin) return 'en';
  var lv = normalizeLevel(u.level);
  return (!u.level || lv === 'a1' || lv === 'a2' || lv === 'b1') ? 'fa' : 'en';
}
function faNum(s) { return String(s).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.charAt(+d); }); }
function faLookup(k) {
  var F = faUi(); if (!F) return null;
  var v = F.t[k];
  if (v !== undefined) return v;
  var rx = F.rx || [];
  for (var i = 0; i < rx.length; i++) {
    var m = k.match(rx[i][0]);
    if (m) { var r = rx[i][1](m, faLookup, faNum); if (r != null) return r; }
  }
  return null;
}
function faAttrs(el) {
  ['placeholder', 'aria-label', 'title'].forEach(function (a) {
    var v = el.getAttribute(a);
    if (!v || !/[A-Za-z]/.test(v)) return;
    var r = faLookup(v.replace(/\s+/g, ' ').trim());
    if (r != null) { _faLog.push([el, a, v]); el.setAttribute(a, r); }
  });
}
function faApply(nodes) {
  var byParent = [];
  nodes.forEach(function (n) {
    var raw = n.nodeValue;
    if (!raw || !/[A-Za-z]/.test(raw)) return;
    var el = n.parentNode;
    if (!el || el.nodeType !== 1) return;
    var r = faLookup(raw.replace(/\s+/g, ' ').trim());
    if (r == null) return;
    _faLog.push([n, '#text', raw]);
    n.nodeValue = (/^\s/.test(raw) ? ' ' : '') + r + (/\s$/.test(raw) ? ' ' : '');
    var rec = null;
    for (var i = 0; i < byParent.length; i++) if (byParent[i][0] === el) { rec = byParent[i]; break; }
    if (!rec) { rec = [el, []]; byParent.push(rec); }
    rec[1].push(n);
  });
  byParent.forEach(function (rec) {
    var el = rec[0];
    if (!/[A-Za-z]/.test(el.textContent)) {
      if (!el.hasAttribute('data-fa')) { _faLog.push([el, 'data-fa', null]); el.setAttribute('data-fa', ''); }
      if (!el.hasAttribute('dir')) { _faLog.push([el, 'dir', null]); el.setAttribute('dir', 'rtl'); }
      return;
    }
    rec[1].forEach(function (n) {
      if (n.parentNode !== el) return;
      var sp = document.createElement('span');
      sp.setAttribute('dir', 'rtl'); sp.setAttribute('data-fa', ''); sp.setAttribute('data-fa-wrap', '');
      el.replaceChild(sp, n); sp.appendChild(n);
    });
  });
}
function faWalk(root) {
  if (!root || !_faOn) return;
  if (root.nodeType === 3) {
    var p = root.parentNode;
    if (p && p.nodeType === 1 && !p.closest(FA_SKIP)) faApply([root]);
    return;
  }
  if (root.nodeType !== 1 || root.closest(FA_SKIP)) return;
  var texts = [], done = [], F = faUi(), multi = F && F.m;
  faAttrs(root);
  if (multi) faMulti(root, multi, done);
  var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: function (n) {
      if (n.nodeType === 1) return n.matches(FA_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  var n;
  while ((n = tw.nextNode())) {
    if (n.nodeType === 3) { if (done.indexOf(n) === -1) texts.push(n); }
    else {
      if (n.hasAttribute('placeholder') || n.hasAttribute('aria-label') || n.hasAttribute('title')) faAttrs(n);
      if (multi) faMulti(n, multi, done);
    }
  }
  faApply(texts);
}
/* A label split over several text nodes ("Real<br>meanings", "Vocabulary <em>Builder</em>"):
   MUSE_FA_UI.m maps the parts joined by '|' to the Persian parts joined by '|'. */
function faMulti(el, multi, done) {
  if (el.childNodes.length < 2) return;
  var nodes = [], tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), x;
  while ((x = tw.nextNode())) {
    if (!x.nodeValue.trim()) continue;
    nodes.push(x);
    if (nodes.length > 5) return;
  }
  if (nodes.length < 2) return;
  var sig = nodes.map(function (z) { return z.nodeValue.replace(/\s+/g, ' ').trim(); }).join('|');
  var v = multi[sig];
  if (v === undefined) return;
  var parts = v.split('|');
  nodes.forEach(function (z, i) {
    var raw = z.nodeValue;
    _faLog.push([z, '#text', raw]);
    z.nodeValue = (/^\s/.test(raw) ? ' ' : '') + (parts[i] || '') + (/\s$/.test(raw) ? ' ' : '');
    done.push(z);
  });
  if (!el.hasAttribute('data-fa')) { _faLog.push([el, 'data-fa', null]); el.setAttribute('data-fa', ''); }
  if (!el.hasAttribute('dir')) { _faLog.push([el, 'dir', null]); el.setAttribute('dir', 'rtl'); }
}
function faLoadThemes() {
  if (_faThemes) return;
  _faThemes = true;
  fetch('/data/fa/themes.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    .then(function (d) {
      var F = faUi();
      if (!d || !F) return;
      Object.keys(d.themes || {}).forEach(function (k) {
        var fa = d.themes[k];
        if (F.t[k] === undefined) F.t[k] = fa;
        F.t[k + ' 🔁'] = fa + ' 🔁';
        F.t['Open lesson ' + k] = 'باز کردن درس ' + fa;
      });
      if (_faOn) faWalk(document.body);
    });
}
function faSync() {
  var on = !!(faUi() && uiLang() === 'fa' && FA_OFF_VIEWS.indexOf(state.view) === -1 && !isTeachersPath() && !isPanelPath());
  var was = _faOn;
  _faOn = on;
  document.documentElement.classList.toggle('ui-fa', on);
  if (!on) { if (was) faRestore(); return; }
  _faLog = _faLog.filter(function (r) { return r[0].isConnected; });
  faLoadThemes();
  if (!_faObs && typeof MutationObserver !== 'undefined') {
    _faObs = new MutationObserver(function (list) {
      if (!_faOn) return;
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) faWalk(m.addedNodes[j]); }
        else if (m.type === 'characterData') faWalk(m.target);
        else if (m.type === 'attributes' && m.target.nodeType === 1 && !m.target.closest(FA_SKIP)) faAttrs(m.target);
      }
    });
    _faObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'title'] });
  }
  faWalk(document.body);
}
function setUiLang(l) {
  try { localStorage.setItem('muse_ui_lang', l); } catch (e) {}
  window.location.reload();
}

