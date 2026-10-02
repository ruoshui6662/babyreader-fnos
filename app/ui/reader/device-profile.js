/* 枕书 UI module: reader/device-profile */

'use strict';

let _readerDeviceProfile = null;
let _mobileChromeOpen = false;

function isMobileChromeOpen() {
  return _mobileChromeOpen;
}

function getReaderDeviceProfile({
  navigatorObject = window.navigator,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  matchMedia = window.matchMedia?.bind(window)
} = {}) {
  const userAgent = String(navigatorObject?.userAgent || '');
  const platform = String(navigatorObject?.platform || '');
  const maxTouchPoints = Number(navigatorObject?.maxTouchPoints || 0);
  const isAndroid = /Android/i.test(userAgent);
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent);
  const isDesktopModeIpad = /Macintosh/i.test(userAgent)
    && /MacIntel/i.test(platform)
    && maxTouchPoints > 1;
  const pointerCoarse = Boolean(matchMedia?.('(pointer: coarse)')?.matches);
  const hoverNone = Boolean(matchMedia?.('(hover: none)')?.matches);
  const isMobile = isAndroid || isAppleMobile || isDesktopModeIpad;

  return Object.freeze({
    surface: isMobile ? 'mobile' : 'desktop',
    kind: isDesktopModeIpad ? 'ipad' : isAppleMobile ? 'ios' : isAndroid ? 'android' : 'desktop',
    isAndroid,
    isAppleMobile,
    isDesktopModeIpad,
    pointerCoarse,
    hoverNone,
    viewportWidth: Math.max(0, Number(viewportWidth) || 0),
    viewportHeight: Math.max(0, Number(viewportHeight) || 0),
    maxTouchPoints
  });
}

function isMobileReaderSurface() {
  return document.documentElement?.dataset.readerSurface === 'mobile';
}

function setMobileTopbarHidden(hidden) {
  const shouldHide = Boolean(
    hidden
    && isMobileReaderSurface()
    && state.contentType === 'epub'
  );
  document.body.classList.toggle('mobile-topbar-hidden', shouldHide);
  return shouldHide;
}

// Desktop continuous scroll lets text run under the frosted top bar and hides
// the bar while reading forward (WeChat Reading). Paged and mobile surfaces
// keep their own chrome rules.
function setDesktopTopbarHidden(hidden) {
  const shouldHide = Boolean(
    hidden
    && !isMobileReaderSurface()
    && state.contentType === 'epub'
    && state.effectiveReadingMode === 'scroll'
  );
  document.body.classList.toggle('reader-topbar-hidden', shouldHide);
  return shouldHide;
}

// Height of the top bar overlapping the reader's scroll viewport; CSS states
// it as the reader's scroll-padding-top (0 where the bar does not overlap).
function readerTopInset(reader) {
  if (!reader) return 0;
  return Math.max(0, parseFloat(window.getComputedStyle(reader).scrollPaddingTop) || 0);
}

// Phone reading chrome: hidden while reading, shown by tapping the middle of
// the page (top bar + two-row bottom bar overlay the text, nothing reflows).
function setMobileChromeOpen(open) {
  _mobileChromeOpen = Boolean(open);
  const hasDocument = Boolean(state.currentPath);
  const reading = isMobileReaderSurface() && hasDocument && !document.body.classList.contains('is-library');
  const isOpen = _mobileChromeOpen && reading;
  document.body.dataset.mobileChrome = isOpen ? 'open' : 'closed';
  document.body.classList.toggle('mobile-chrome-open', isOpen);
  document.body.classList.toggle('mobile-reading', reading);
  const toolbar = document.getElementById('mobileReaderToolbar');
  if (toolbar) toolbar.hidden = !isOpen;
  const footer = document.getElementById('mobileReadingFooter');
  if (footer) footer.hidden = !reading || isOpen;
  if (!isOpen) closeMobileMoreMenu();
  if (isOpen || reading) syncMobileReadingBar();
  return isOpen;
}

function closeMobileMoreMenu() {
  const menu = document.getElementById('mobileMoreMenu');
  const button = document.getElementById('btnMobileMore');
  if (menu) menu.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}

function mobileChapterLabel(index) {
  const path = state.chapterPaths?.[index] || '';
  const toc = (state.toc || []).find((item) => path && String(item.target || item.href || '').includes(path));
  return String(toc?.label || (Number.isInteger(index) ? `第 ${index + 1} 章` : '')).trim();
}

// Where the reader is, as a 0..1 fraction of the book plus a label.
function mobileReadingPosition() {
  if (state.contentType === 'pdf') {
    const reader = window.pdfReaderController;
    const pages = Math.max(1, reader?.getPageCount?.() || 1);
    const page = Math.max(0, reader?.getCurrentPageIndex?.() || 0);
    return { ratio: pages > 1 ? page / (pages - 1) : 0, label: `第 ${page + 1}/${pages} 页`, units: pages };
  }
  if (state.contentType === 'epub') {
    const ratio = Number.isFinite(state.readingPercentage) ? state.readingPercentage : 0;
    const index = Number.isInteger(state.currentChapterIndex) ? state.currentChapterIndex : state.epubChapterIndex || 0;
    return { ratio, label: mobileChapterLabel(index), units: Math.max(1, state.epubChapterCount || state.chapterPaths?.length || 1) };
  }
  const reader = document.getElementById('reader');
  const max = Math.max(1, (reader?.scrollHeight || 1) - (reader?.clientHeight || 0));
  return { ratio: Math.max(0, Math.min(1, (reader?.scrollTop || 0) / max)), label: '', units: 0 };
}

function syncMobileReadingBar() {
  if (!isMobileReaderSurface()) return;
  const position = mobileReadingPosition();
  const percent = `${Math.round(position.ratio * 100)}%`;
  const slider = document.getElementById('mobileReaderProgress');
  if (slider && document.activeElement !== slider && !slider.dataset.dragging) {
    slider.value = String(Math.round(position.ratio * 1000));
    slider.setAttribute('aria-valuetext', [position.label, percent].filter(Boolean).join(' · '));
  }
  const chapter = document.getElementById('mobileReadingFooterChapter');
  const footerPercent = document.getElementById('mobileReadingFooterPercent');
  if (chapter) chapter.textContent = position.label;
  if (footerPercent) footerPercent.textContent = percent;
  // PDFs step by page, plain text has no chapters.
  const previous = document.getElementById('btnMobilePreviousChapter');
  const next = document.getElementById('btnMobileNextChapter');
  const isPdf = state.contentType === 'pdf';
  for (const [button, label, action] of [[previous, isPdf ? '上一页' : '上一章', isPdf ? 'previousPage' : 'previousChapter'],
    [next, isPdf ? '下一页' : '下一章', isPdf ? 'nextPage' : 'nextChapter']]) {
    if (!button) continue;
    button.hidden = state.contentType !== 'epub' && !isPdf;
    button.dataset.readerAction = action;
    button.textContent = label;
    button.setAttribute('aria-label', label);
  }
  const theme = document.getElementById('btnMobileTheme');
  if (theme) {
    const dark = state.theme === 'dark';
    const caption = theme.querySelector('.rail-label');
    if (caption) caption.textContent = dark ? '日间' : '夜间';
    theme.setAttribute('aria-label', dark ? '切换日间模式' : '切换夜间模式');
    const icon = theme.querySelector('svg');
    if (icon && typeof themeIconSvg === 'function' && icon.dataset.mode !== (dark ? 'light' : 'dark')) {
      icon.outerHTML = themeIconSvg(dark ? 'light' : 'dark').replace('<svg ', `<svg data-mode="${dark ? 'light' : 'dark'}" `);
    }
  }
}

// Dragging the progress slider previews the chapter; releasing goes there.
function previewMobileProgress(value) {
  const ratio = Math.max(0, Math.min(1, Number(value) / 1000));
  const bubble = document.getElementById('mobileReaderProgressBubble');
  let label = '';
  if (state.contentType === 'epub') {
    const count = Math.max(1, state.epubChapterCount || state.chapterPaths?.length || 1);
    label = mobileChapterLabel(Math.min(count - 1, Math.floor(ratio * count)));
  } else if (state.contentType === 'pdf') {
    const pages = Math.max(1, window.pdfReaderController?.getPageCount?.() || 1);
    label = `第 ${Math.round(ratio * (pages - 1)) + 1} 页`;
  }
  if (bubble) {
    bubble.textContent = [label, `${Math.round(ratio * 100)}%`].filter(Boolean).join(' · ');
    bubble.hidden = false;
    bubble.style.left = `${ratio * 100}%`;
  }
}

function commitMobileProgress(value) {
  const ratio = Math.max(0, Math.min(1, Number(value) / 1000));
  const bubble = document.getElementById('mobileReaderProgressBubble');
  if (bubble) bubble.hidden = true;
  if (state.contentType === 'epub') {
    const count = Math.max(1, state.epubChapterCount || state.chapterPaths?.length || 1);
    const target = Math.min(count - 1, Math.floor(ratio * count));
    if (target !== state.currentChapterIndex && typeof navigateToEpubChapter === 'function') {
      navigateToEpubChapter(target, { page: 1, reason: 'mobile-progress' });
    }
  } else if (state.contentType === 'pdf') {
    const pages = Math.max(1, window.pdfReaderController?.getPageCount?.() || 1);
    window.pdfReaderController?.goToPdfPage?.(Math.round(ratio * (pages - 1)));
  } else {
    const reader = document.getElementById('reader');
    if (reader) reader.scrollTop = ratio * Math.max(0, reader.scrollHeight - reader.clientHeight);
  }
}

function setupMobileReadingBar() {
  const slider = document.getElementById('mobileReaderProgress');
  if (slider && !slider.dataset.bound) {
    slider.dataset.bound = 'true';
    slider.addEventListener('input', () => {
      slider.dataset.dragging = 'true';
      previewMobileProgress(slider.value);
    });
    slider.addEventListener('change', () => {
      delete slider.dataset.dragging;
      commitMobileProgress(slider.value);
    });
  }
  const more = document.getElementById('btnMobileMore');
  const menu = document.getElementById('mobileMoreMenu');
  if (more && menu && !more.dataset.bound) {
    more.dataset.bound = 'true';
    more.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', () => closeMobileMoreMenu());
    document.addEventListener('pointerdown', (event) => {
      if (!menu.hidden && !menu.contains(event.target) && event.target !== more && !more.contains(event.target)) closeMobileMoreMenu();
    }, true);
  }
}

// Phone back gesture / back key: close the top-most panel first, then leave
// the book for the shelf. Each open panel (and an open book) holds one
// history entry; closing a panel from the page removes its entry again.
const MOBILE_OVERLAYS = [
  ['highlightEditor', () => closeHighlightEditor()],
  ['aiBookMapView', () => closeAiBookMapSheet()],
  ['aiConversationsView', () => closeAiConversationsSheet()],
  ['aiConfigView', () => closeAiConfigSheet()],
  ['aiModal', () => closeAiModal()],
  ['readerSearchSheet', () => closeReaderPanel()],
  ['readerSettingsSheet', () => closeReaderPanel()],
  ['readerDrawer', () => closeReaderPanel()],
  ['mobileMoreMenu', () => closeMobileMoreMenu()]
];

let _mobileHistoryDepth = 0;
let _mobileHistoryBook = false;
let _mobileHistoryIgnore = 0;
let _mobileHistoryClosing = false;

function openMobileOverlays() {
  return MOBILE_OVERLAYS.filter(([id]) => {
    const element = document.getElementById(id);
    return element && !element.hidden && !element.closest('[hidden]');
  });
}

function syncMobileHistory() {
  if (!isMobileReaderSurface() || !window.history?.pushState) return;
  const reading = Boolean(state.currentPath) && !document.body.classList.contains('is-library');
  if (reading && !_mobileHistoryBook) {
    window.history.pushState({ ...(window.history.state || {}), zhenshuReader: true }, '');
    _mobileHistoryBook = true;
  }
  if (_mobileHistoryClosing) return;
  const open = reading ? openMobileOverlays().length : 0;
  while (_mobileHistoryDepth < open) {
    window.history.pushState({ ...(window.history.state || {}), zhenshuOverlay: _mobileHistoryDepth + 1 }, '');
    _mobileHistoryDepth += 1;
  }
  let extra = _mobileHistoryDepth - open;
  if (!reading && _mobileHistoryBook) {
    extra += 1;
    _mobileHistoryBook = false;
  }
  if (extra > 0) {
    _mobileHistoryDepth = open;
    _mobileHistoryIgnore += 1;
    window.history.go(-extra);
  }
}

function setupMobileHistory() {
  if (window.__zhenshuMobileHistoryBound) return;
  window.__zhenshuMobileHistoryBound = true;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; syncMobileHistory(); });
  };
  const observer = new MutationObserver(schedule);
  for (const [id] of MOBILE_OVERLAYS) {
    const element = document.getElementById(id);
    if (element) observer.observe(element, { attributes: true, attributeFilter: ['hidden'] });
  }
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('popstate', () => {
    if (_mobileHistoryIgnore > 0) {
      _mobileHistoryIgnore -= 1;
      return;
    }
    if (!isMobileReaderSurface()) return;
    const overlays = openMobileOverlays();
    if (_mobileHistoryDepth > 0 && overlays.length) {
      _mobileHistoryDepth -= 1;
      _mobileHistoryClosing = true;
      try { overlays[0][1](); } catch {}
      _mobileHistoryClosing = false;
      return;
    }
    if (_mobileHistoryBook && state.currentPath && !document.body.classList.contains('is-library')) {
      _mobileHistoryBook = false;
      _mobileHistoryDepth = 0;
      if (typeof returnToLibrary === 'function') returnToLibrary();
    }
  });
}

function applyReaderDeviceProfile(profile) {
  _readerDeviceProfile = profile;
  if (profile.surface !== 'mobile') _mobileChromeOpen = false;
  document.documentElement.dataset.readerSurface = profile.surface;
  document.documentElement.dataset.readerDevice = profile.kind;
  setMobileTopbarHidden(false);
  setDesktopTopbarHidden(false);
  setMobileChromeOpen(_mobileChromeOpen);
  return profile;
}

function setupReaderDeviceProfile() {
  const update = () => applyReaderDeviceProfile(getReaderDeviceProfile());
  update();
  setupMobileReadingBar();
  setupMobileHistory();
  window.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.screen?.orientation?.addEventListener?.('change', update, { passive: true });
  return update;
}
