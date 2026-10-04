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
  if (typeof syncNativeClient === 'function') syncNativeClient();
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
    slider.style.setProperty('--range-progress', `${position.ratio * 100}%`);
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
      slider.style.setProperty('--range-progress', `${Number(slider.value) / 10}%`);
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

// Settings on a phone: a short sheet (appearance + 翻页方式), with 更多设置
// expanding it to every option.
function setupMobileSettingsSheet() {
  const sheet = document.getElementById('readerSettingsSheet');
  const more = document.getElementById('btnSettingsMore');
  if (more && !more.dataset.bound) {
    more.dataset.bound = 'true';
    more.addEventListener('click', () => {
      const expanded = !sheet?.classList.contains('is-expanded');
      sheet?.classList.toggle('is-expanded', expanded);
      more.setAttribute('aria-expanded', String(expanded));
      more.textContent = expanded ? '收起' : '更多设置';
    });
  }
  document.querySelectorAll('[data-reading-mode-choice]').forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const select = document.getElementById('settingReadingMode');
      if (!select || select.value === button.dataset.readingModeChoice) return;
      select.value = button.dataset.readingModeChoice;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

// ---------------------------------------------------------------------------
// Android client (clients/android). The shell exposes window.ZhenshuNative;
// the page answers it through window.zhenshuNative: back() for the back key
// (close what is open, then leave the book) and turn() for the volume keys.
// Its options live on this device only.
const NATIVE_PREFS_KEY = 'zhenshu.client';
const NATIVE_DEFAULTS = Object.freeze({ volumeKeys: true, keepOn: true, immersive: false });

function nativeClient() {
  return typeof window.ZhenshuNative === 'object' && window.ZhenshuNative ? window.ZhenshuNative : null;
}

function nativePrefs() {
  try {
    return { ...NATIVE_DEFAULTS, ...JSON.parse(localStorage.getItem(NATIVE_PREFS_KEY) || '{}') };
  } catch {
    return { ...NATIVE_DEFAULTS };
  }
}

function saveNativePrefs(prefs) {
  try { localStorage.setItem(NATIVE_PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

function nativeReading() {
  return Boolean(state.currentPath) && !document.body.classList.contains('is-library');
}

// The colour actually showing at a screen edge, as opaque rgb(): the
// backgrounds under that point composited from the page up (bars are often
// translucent, and CSS may report color(srgb …) forms). The shell paints the
// status-bar and navigation-bar strips with it, so page and bars read as one.
let edgeColorCanvas = null;
function screenEdgeColor(y) {
  const layers = [];
  for (let element = document.elementFromPoint(Math.round(window.innerWidth / 2), y); element; element = element.parentElement) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== 'transparent') layers.push(color);
  }
  layers.push(getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor);
  edgeColorCanvas ||= document.createElement('canvas');
  edgeColorCanvas.width = edgeColorCanvas.height = 1;
  const context = edgeColorCanvas.getContext('2d', { willReadFrequently: true });
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#141416';
  context.fillRect(0, 0, 1, 1);
  // Bottom layer first: the page, then each element above it.
  for (const color of layers.reverse()) {
    context.fillStyle = '#000';
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
  }
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

// Tells the shell what the screen is: reading or not, the colours at its
// top and bottom, and the options that apply while reading. Measured after
// the next frame, once the page has settled.
let nativeScreenFrame = 0;
function syncNativeClient() {
  const native = nativeClient();
  if (!native?.setReading && !native?.setScreen) return;
  cancelAnimationFrame(nativeScreenFrame);
  nativeScreenFrame = requestAnimationFrame(() => {
    const prefs = nativePrefs();
    const reading = nativeReading();
    try {
      if (native.setScreen) {
        native.setScreen(reading, screenEdgeColor(1), screenEdgeColor(window.innerHeight - 2),
          prefs.immersive === true, prefs.keepOn !== false, prefs.volumeKeys !== false);
      } else {
        // Shells before 0.2: dark or light only.
        const dark = reading ? state.theme === 'dark' : !document.body.matches('.theme-light, .theme-sepia');
        native.setReading(reading, dark, prefs.immersive === true, prefs.keepOn !== false, prefs.volumeKeys !== false);
      }
    } catch { /* an older shell */ }
  });
}

// Files the page makes (notes as Markdown, share pictures) are blob URLs
// clicked through a download link; a WebView cannot download those. In the
// client every such link hands its file to the shell, which saves it to
// 下载/枕书 (pictures to 相册/枕书).
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function saveBlobInNativeClient(blob, name) {
  const native = nativeClient();
  let where = '';
  try {
    where = native.saveFile(name, blob.type || 'application/octet-stream', await blobToBase64(blob)) || '';
  } catch { /* an older shell */ }
  if (typeof showHighlightHint === 'function') {
    showHighlightHint(where ? `已保存到 ${where}` : '保存失败，请允许枕书保存文件后重试');
  }
}

function installNativeDownloads() {
  const native = nativeClient();
  if (!native?.saveFile || window.__zhenshuNativeDownloads) return;
  window.__zhenshuNativeDownloads = true;
  // Remember each blob by its URL: callers may revoke the URL right after
  // the click, before the file could be read back from it.
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = createObjectURL(object);
    if (object instanceof Blob) {
      blobs.set(url, object);
      setTimeout(() => blobs.delete(url), 120000);
    }
    return url;
  };
  const download = (link) => {
    const blob = link.hasAttribute('download') ? blobs.get(link.href) : null;
    if (!blob) return false;
    void saveBlobInNativeClient(blob, link.getAttribute('download') || 'download');
    return true;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function clickInNativeClient() {
    if (!download(this)) click.call(this);
  };
  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[download]');
    if (link && download(link)) event.preventDefault();
  }, true);
}

function setupNativeClient() {
  const native = nativeClient();
  document.documentElement.toggleAttribute('data-native-client', Boolean(native));
  const group = document.getElementById('settingsNativeGroup');
  if (!native || !group) return;
  installNativeDownloads();
  group.hidden = false;
  const prefs = nativePrefs();
  for (const [id, key] of [['settingNativeVolumeKeys', 'volumeKeys'], ['settingNativeKeepOn', 'keepOn'], ['settingNativeImmersive', 'immersive']]) {
    const input = document.getElementById(id);
    if (!input || input.dataset.bound) continue;
    input.dataset.bound = 'true';
    input.checked = prefs[key] === true;
    input.addEventListener('change', () => {
      saveNativePrefs({ ...nativePrefs(), [key]: input.checked });
      syncNativeClient();
    });
  }
  const serverLabel = document.getElementById('settingNativeServer');
  try { if (serverLabel) serverLabel.textContent = native.server?.() || ''; } catch { /* older shell */ }
  const change = document.getElementById('btnNativeChangeServer');
  if (change && !change.dataset.bound) {
    change.dataset.bound = 'true';
    change.addEventListener('click', () => native.changeServer?.());
  }
  syncNativeClient();
}

window.zhenshuNative = {
  // Volume keys: a page in 左右翻页, a screen's height when scrolling.
  turn(direction) {
    if (!nativeReading() || document.getElementById('tapGuide')) return false;
    const step = direction < 0 ? -1 : 1;
    if (state.contentType === 'pdf') return turnPhonePdfPage(step);
    if (state.effectiveReadingMode === 'scroll') {
      const reader = document.getElementById('reader');
      reader?.scrollBy({ top: step * Math.round((reader.clientHeight || 600) * 0.9) });
      return true;
    }
    return navigatePageGroup(step) !== false;
  },
  // The back key: the topmost thing closes first; in the library the shell
  // decides (history, or leaving the app).
  back() {
    const guide = document.getElementById('tapGuide');
    if (guide) {
      guide.remove();
      return true;
    }
    if (document.getElementById('aiModal')?.hidden === false && typeof closeAiModal === 'function') {
      closeAiModal();
      return true;
    }
    if (typeof activeReaderSurface !== 'undefined' && activeReaderSurface) {
      closeReaderPanel();
      return true;
    }
    if (isMobileChromeOpen()) {
      setMobileChromeOpen(false);
      return true;
    }
    if (nativeReading() && typeof returnToLibrary === 'function') {
      void returnToLibrary();
      return true;
    }
    return false;
  }
};

// PDFs on a phone: a page at a time unless 上下滚动 was chosen.
function syncPhonePdfMode() {
  const pdf = window.pdfReaderController;
  if (state.contentType !== 'pdf' || !pdf?.setPhonePaged) return;
  pdf.setPhonePaged(isMobileReaderSurface() && state.mobilePdfMode !== 'scroll');
}

// One PDF page back or forward: page mode animates the turn; scrolling
// mode (and desktop) just goes to the page.
function turnPhonePdfPage(direction) {
  const pdf = window.pdfReaderController;
  if (!pdf) return false;
  if (!pdf.isPhonePaged?.()) return pdf.stepPage?.(direction) ?? false;
  const style = typeof pageTurnStyle === 'function' ? pageTurnStyle() : 'none';
  return pdf.turnPhonePage(direction, style);
}

// 点击区域 guide: shown over the page the first time a phone pages a book
// (and from 设置 › 查看点击区域). It names what each part of the page does
// for the current 点击翻页 choice; any tap dismisses it.
const TAP_GUIDE_SEEN_KEY = 'zhenshu.tapGuideSeen';

function showTapGuide() {
  document.getElementById('tapGuide')?.remove();
  const forward = state.tapToTurn === 'forward';
  const guide = document.createElement('div');
  guide.id = 'tapGuide';
  guide.className = 'tap-guide';
  guide.setAttribute('role', 'dialog');
  guide.setAttribute('aria-label', '点击区域');
  const zones = forward
    ? [['下一页', ''], ['菜单', '点中间'], ['下一页', '']]
    : [['上一页', '点左侧'], ['菜单', '点中间'], ['下一页', '点右侧']];
  for (const [label, where] of zones) {
    const zone = document.createElement('div');
    zone.className = 'tap-guide-zone';
    const name = document.createElement('strong');
    name.textContent = label;
    zone.appendChild(name);
    if (where) {
      const hint = document.createElement('span');
      hint.textContent = where;
      zone.appendChild(hint);
    }
    guide.appendChild(zone);
  }
  const foot = document.createElement('p');
  foot.className = 'tap-guide-foot';
  foot.textContent = `${state.swipeToTurn !== false ? '左右滑动也可以翻页。' : ''}可在 设置 › 阅读 中更改。点一下开始阅读`;
  guide.appendChild(foot);
  guide.addEventListener('click', (event) => {
    event.stopPropagation();
    guide.remove();
  });
  document.body.appendChild(guide);
  try { localStorage.setItem(TAP_GUIDE_SEEN_KEY, '1'); } catch { /* private mode */ }
}

function maybeShowTapGuide() {
  if (!isMobileReaderSurface()) return;
  const paged = state.contentType === 'pdf'
    ? window.pdfReaderController?.isPhonePaged?.()
    : state.contentType === 'epub' && state.effectiveReadingMode !== 'scroll';
  if (!paged) return;
  let seen = false;
  try { seen = localStorage.getItem(TAP_GUIDE_SEEN_KEY) === '1'; } catch { seen = true; }
  if (!seen) showTapGuide();
}

// The phone reading drawer (目录 / 书签 / 标记与想法) opens from the left
// with the open book on top: cover, title, author and how far in.
function renderReaderDrawerBook() {
  const drawer = document.getElementById('readerDrawer');
  if (!drawer) return;
  let block = drawer.querySelector('.reader-drawer-book');
  if (!block) {
    block = document.createElement('div');
    block.className = 'reader-drawer-book';
    block.innerHTML = '<div class="reader-drawer-book-cover"></div>'
      + '<div class="reader-drawer-book-text"><div class="reader-drawer-book-title"></div>'
      + '<div class="reader-drawer-book-meta"></div></div>';
    drawer.querySelector('.reader-drawer-tabs')?.before(block);
  }
  const info = state.currentBookInfo?.id === state.currentBookId ? state.currentBookInfo : null;
  const cover = block.querySelector('.reader-drawer-book-cover');
  const coverUrl = info?.coverUrl || '';
  if (cover.dataset.src !== coverUrl) {
    cover.dataset.src = coverUrl;
    cover.replaceChildren();
    if (coverUrl) {
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.src = coverUrl;
      image.addEventListener('error', () => image.remove(), { once: true });
      cover.appendChild(image);
    }
  }
  block.querySelector('.reader-drawer-book-title').textContent = info?.title || state.currentName || '';
  const percent = typeof mobileReadingPosition === 'function'
    ? `已读 ${Math.round(mobileReadingPosition().ratio * 100)}%` : '';
  block.querySelector('.reader-drawer-book-meta').textContent = [info?.author, percent].filter(Boolean).join(' · ');
}

// Swiping the drawer to the left closes it; a short swipe springs back.
// Vertical moves are left to the list's own scrolling.
function setupMobileDrawerSwipe() {
  const drawer = document.getElementById('readerDrawer');
  if (!drawer || drawer.dataset.drawerSwipe) return;
  drawer.dataset.drawerSwipe = 'true';
  let start = null;
  let dragging = false;
  const reset = () => {
    drawer.style.transform = '';
    drawer.style.transition = '';
    drawer.classList.remove('is-dragging');
    start = null;
    dragging = false;
  };
  drawer.addEventListener('pointerdown', (event) => {
    if (!isMobileReaderSurface() || event.pointerType === 'mouse') return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  drawer.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { start = null; return; }
      if (dx > -10 || Math.abs(dx) < Math.abs(dy)) return;
      dragging = true;
      drawer.classList.add('is-dragging');
      drawer.style.transition = 'none';
    }
    drawer.style.transform = `translateX(${Math.min(0, dx)}px)`;
  });
  drawer.addEventListener('pointerup', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const wasDragging = dragging;
    reset();
    if (wasDragging && dx < -Math.min(80, drawer.offsetWidth * 0.25)) closeReaderPanel();
  });
  drawer.addEventListener('pointercancel', reset);
}

// Every bottom sheet on a phone gets a grip; dragging the grip or header
// down closes the sheet, a short drag springs back. (The reading drawer
// opens from the left instead: setupMobileDrawerSwipe.)
const MOBILE_SHEETS = [
  ['readerSettingsSheet', () => closeReaderPanel()],
  ['readerSearchSheet', () => closeReaderPanel()],
  ['aiModal', () => closeAiModal()]
];

function setupMobileSheetGestures() {
  setupMobileDrawerSwipe();
  for (const [id, close] of MOBILE_SHEETS) {
    const sheet = document.getElementById(id);
    if (!sheet || sheet.dataset.sheetGesture) continue;
    sheet.dataset.sheetGesture = 'true';
    const grip = document.createElement('div');
    grip.className = 'sheet-grip';
    grip.setAttribute('aria-hidden', 'true');
    sheet.prepend(grip);
    let startY = null;
    let dragging = false;
    let pointerId = null;
    const reset = () => {
      sheet.style.transform = '';
      sheet.style.transition = '';
      sheet.classList.remove('is-dragging');
      startY = null;
      dragging = false;
      pointerId = null;
    };
    sheet.addEventListener('pointerdown', (event) => {
      if (!isMobileReaderSurface() || event.pointerType === 'mouse') return;
      const handle = event.target.closest?.('.sheet-grip, .reader-drawer-header, .ai-modal-header');
      if (!handle || event.target.closest('button, a, input, select, textarea')) return;
      startY = event.clientY;
      pointerId = event.pointerId;
    });
    sheet.addEventListener('pointermove', (event) => {
      if (startY === null || event.pointerId !== pointerId) return;
      const delta = event.clientY - startY;
      if (!dragging && delta < 8) return;
      dragging = true;
      sheet.classList.add('is-dragging');
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${Math.max(0, delta)}px)`;
    });
    const finish = (event) => {
      if (startY === null || event.pointerId !== pointerId) return;
      const delta = event.clientY - startY;
      const wasDragging = dragging;
      reset();
      if (wasDragging && delta > Math.min(120, sheet.offsetHeight * 0.25)) close();
    };
    sheet.addEventListener('pointerup', finish);
    sheet.addEventListener('pointercancel', reset);
  }
}

// AI on a phone: the header keeps the title, ⋯ and close; 导读 / 会话 /
// 新对话 / 设置 move into the ⋯ menu. The composer rides above the keyboard.
function setupMobileAiPanel() {
  const more = document.getElementById('btnAiMore');
  const menu = document.getElementById('aiMoreMenu');
  if (more && menu && !more.dataset.bound) {
    more.dataset.bound = 'true';
    const closeMenu = () => {
      menu.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    };
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
    });
    menu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-ai-proxy]');
      if (!item) return;
      closeMenu();
      document.getElementById(item.dataset.aiProxy)?.click();
    });
    document.addEventListener('pointerdown', (event) => {
      if (!menu.hidden && !menu.contains(event.target) && !more.contains(event.target)) closeMenu();
    }, true);
    const modal = document.getElementById('aiModal');
    if (modal) {
      new MutationObserver(() => { if (modal.hidden) closeMenu(); })
        .observe(modal, { attributes: true, attributeFilter: ['hidden'] });
    }
  }
  const viewport = window.visualViewport;
  if (viewport && !window.__zhenshuKeyboardInsetBound) {
    window.__zhenshuKeyboardInsetBound = true;
    const update = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
    };
    viewport.addEventListener('resize', update, { passive: true });
    viewport.addEventListener('scroll', update, { passive: true });
    update();
  }
}

function setupReaderDeviceProfile() {
  const update = () => applyReaderDeviceProfile(getReaderDeviceProfile());
  update();
  setupMobileReadingBar();
  setupMobileHistory();
  setupMobileSettingsSheet();
  setupMobileSheetGestures();
  setupMobileAiPanel();
  setupNativeClient();
  window.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.screen?.orientation?.addEventListener?.('change', update, { passive: true });
  return update;
}
