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

function setMobileChromeOpen(open) {
  _mobileChromeOpen = Boolean(open);
  const hasDocument = Boolean(state.currentPath);
  const isOpen = _mobileChromeOpen && isMobileReaderSurface() && hasDocument;
  document.body.dataset.mobileChrome = isOpen ? 'open' : 'closed';
  document.body.classList.toggle('mobile-chrome-open', isOpen);
  const toolbar = document.getElementById('mobileReaderToolbar');
  const trigger = document.getElementById('mobileReaderChromeToggle');
  if (toolbar) toolbar.hidden = !isOpen;
  if (trigger) {
    trigger.hidden = !isMobileReaderSurface() || !hasDocument;
    trigger.setAttribute('aria-expanded', String(isOpen));
    trigger.setAttribute('aria-label', isOpen ? '隐藏阅读工具' : '显示阅读工具');
    trigger.setAttribute('title', isOpen ? '隐藏阅读工具' : '显示阅读工具');
  }
  return isOpen;
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
  window.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.screen?.orientation?.addEventListener?.('change', update, { passive: true });
  return update;
}
