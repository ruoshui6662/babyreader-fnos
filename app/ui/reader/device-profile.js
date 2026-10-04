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
  if (!open && typeof setMobilePanel === 'function' && activeMobilePanel) setMobilePanel(null);
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
  const header = document.getElementById('mobileReadingHeader');
  if (header) header.hidden = !reading || isOpen || !readerTipRows().header.some((item) => item !== 'none');
  if (!isOpen) closeMobileMoreMenu();
  if (isOpen || reading) syncMobileReadingBar();
  if (typeof syncNativeClient === 'function') syncNativeClient();
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
    slider.style.setProperty('--range-progress', `${position.ratio * 100}%`);
    slider.setAttribute('aria-valuetext', [position.label, percent].filter(Boolean).join(' · '));
  }
  renderReaderTips(position);
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
  syncReadingClock();
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

// ---------------------------------------------------------------------------
// 页眉页脚 (R2): six places, each showing one item.
const READER_TIP_PRESETS = Object.freeze({
  default: { header: ['time', 'none', 'chapter'], footer: ['page', 'none', 'progress'] },
  minimal: { header: ['none', 'none', 'none'], footer: ['none', 'none', 'progress'] },
  full: { header: ['time', 'battery', 'chapter'], footer: ['book', 'page', 'progress'] }
});
const READER_TIP_LABELS = Object.freeze({
  none: '不显示', time: '时间', battery: '电量', book: '书名', chapter: '章节', page: '页码', progress: '进度'
});

function readerTipRows(tips = state.readerTips) {
  const preset = tips?.preset in READER_TIP_PRESETS ? tips.preset : tips?.preset === 'custom' ? 'custom' : 'default';
  if (preset !== 'custom') return READER_TIP_PRESETS[preset];
  const row = (value) => Array.from({ length: 3 }, (_, index) => (value?.[index] in READER_TIP_LABELS ? value[index] : 'none'));
  return { header: row(tips.header), footer: row(tips.footer) };
}

function nativeBattery() {
  try {
    const level = Number(nativeClient()?.battery?.());
    return Number.isFinite(level) && level >= 0 ? Math.round(level) : null;
  } catch {
    return null;
  }
}

function readerTipText(item, position) {
  const now = new Date();
  switch (item) {
    case 'time': return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    case 'battery': {
      const level = nativeBattery();
      return level === null ? '' : `电量 ${level}%`;
    }
    case 'book': return state.currentBookInfo?.title || state.currentName || '';
    case 'chapter': return position.label || '';
    case 'page': {
      if (state.contentType === 'pdf') {
        const pdf = window.pdfReaderController;
        const count = pdf?.getPageCount?.() || 0;
        return count ? `${(pdf.getCurrentPageIndex?.() || 0) + 1}/${count}` : '';
      }
      if (state.contentType === 'epub' && state.effectiveReadingMode !== 'scroll' && state.pageGroupCount > 0) {
        return `${(state.pageGroup || 0) + 1}/${state.pageGroupCount}`;
      }
      return '';
    }
    case 'progress': return `${Math.round((position.ratio || 0) * 100)}%`;
    default: return '';
  }
}

function renderReaderTips(position = typeof mobileReadingPosition === 'function' ? mobileReadingPosition() : { ratio: 0, label: '' }) {
  const rows = readerTipRows();
  const header = document.getElementById('mobileReadingHeader');
  const hasHeader = rows.header.some((item) => item !== 'none');
  document.documentElement.toggleAttribute('data-reading-header', hasHeader && isMobileReaderSurface());
  for (const [element, items] of [[header, rows.header], [document.getElementById('mobileReadingFooter'), rows.footer]]) {
    element?.querySelectorAll('[data-tip-slot]').forEach((slot, index) => {
      const item = items[index] || 'none';
      slot.dataset.tip = item;
      slot.textContent = readerTipText(item, position);
    });
  }
}

// Time and battery change on their own: refresh them every half minute.
let readerTipsTimer = 0;
function syncReadingClock() {
  clearInterval(readerTipsTimer);
  if (!isMobileReaderSurface()) return;
  renderReaderTips();
  readerTipsTimer = setInterval(() => {
    if (nativeReading()) renderReaderTips();
  }, 30000);
}

// Settings › 页眉页脚: the presets, and the six places when 自定义.
function syncReaderTipsSettings() {
  // Phones only: desktop has its status pill instead.
  const group = document.getElementById('settingsTipsGroup');
  if (group) group.hidden = !isMobileReaderSurface();
  const preset = state.readerTips?.preset in READER_TIP_PRESETS || state.readerTips?.preset === 'custom'
    ? state.readerTips.preset : 'default';
  document.querySelectorAll('[data-tips-preset]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.tipsPreset === preset));
  });
  const rows = readerTipRows();
  const hint = document.getElementById('settingReaderTipsHint');
  if (hint) {
    const describe = (items) => items.filter((item) => item !== 'none').map((item) => READER_TIP_LABELS[item]).join(' · ') || '不显示';
    hint.textContent = `页眉：${describe(rows.header)}；页脚：${describe(rows.footer)}`;
  }
  const custom = document.getElementById('settingReaderTipsCustom');
  if (!custom) return;
  custom.hidden = preset !== 'custom';
  if (preset !== 'custom') return;
  custom.replaceChildren();
  for (const [row, title] of [['header', '页眉'], ['footer', '页脚']]) {
    ['左', '中', '右'].forEach((place, index) => {
      const field = document.createElement('div');
      field.className = 'settings-field settings-tip-place';
      const name = document.createElement('span');
      name.textContent = `${title}${place}`;
      const choices = document.createElement('div');
      choices.className = 'settings-tip-choices';
      choices.setAttribute('role', 'radiogroup');
      choices.setAttribute('aria-label', `${title}${place}`);
      for (const item of Object.keys(READER_TIP_LABELS)) {
        if (item === 'battery' && !nativeClient()) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.dataset.tipItem = item;
        button.textContent = item === 'none' ? '无' : READER_TIP_LABELS[item];
        button.setAttribute('aria-checked', String(rows[row][index] === item));
        button.addEventListener('click', () => {
          const next = readerTipRows();
          const updated = { preset: 'custom', header: [...next.header], footer: [...next.footer] };
          updated[row][index] = item;
          state.readerTips = updated;
          syncReaderTipsSettings();
          renderReaderTips();
          persistUserSettings();
        });
        choices.appendChild(button);
      }
      field.append(name, choices);
      custom.appendChild(field);
    });
  }
}

function setupReaderTipsSettings() {
  const presets = document.getElementById('settingReaderTips');
  if (!presets || presets.dataset.bound) return;
  presets.dataset.bound = 'true';
  presets.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-tips-preset]');
    if (!button) return;
    const preset = button.dataset.tipsPreset;
    // 自定义 starts from what is showing now.
    state.readerTips = preset === 'custom' ? { preset, ...readerTipRows() } : { preset };
    syncReaderTipsSettings();
    renderReaderTips();
    persistUserSettings();
  });
  syncReaderTipsSettings();
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

// ---------------------------------------------------------------------------
// Phone panels (2026-10): 进度 / 主题 / 设置 open one flat panel above the
// toolbar, WeChat-Reading style; a second level lists 字体 / 缩进 / 翻页.
// Every control drives the settings sheet's own control, so the logic and
// saving stay in one place; 更多设置 opens that sheet for the rest.
let activeMobilePanel = null;

function mobilePanelElement(name) {
  return document.querySelector(`#mobileReaderToolbar [data-mobile-panel="${name}"]`);
}

function setMobilePanel(name) {
  activeMobilePanel = name || null;
  document.querySelectorAll('#mobileReaderToolbar [data-mobile-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.mobilePanel !== activeMobilePanel;
  });
  const toggleName = activeMobilePanel === 'sub' ? 'type' : activeMobilePanel;
  document.querySelectorAll('#mobileReaderToolbar [data-mobile-panel-toggle]').forEach((button) => {
    const on = button.dataset.mobilePanelToggle === toggleName;
    button.setAttribute('aria-expanded', String(on));
    button.classList.toggle('is-active', on);
  });
  document.getElementById('mobileReaderToolbar')?.classList.toggle('has-panel', Boolean(activeMobilePanel));
  if (activeMobilePanel === 'progress') syncMobileProgressPanel();
  if (activeMobilePanel === 'theme') syncMobileThemePanel();
  if (activeMobilePanel === 'type') syncMobileTypePanel();
  if (typeof syncNativeClient === 'function') syncNativeClient();
}

// Each segment mirrors a settings button: its label, whether it is chosen,
// and a tap that presses the original.
function mobileProxySegments(sources, onChange) {
  const row = document.createElement('div');
  row.className = 'mobile-segments';
  for (const source of sources) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.textContent = source.getAttribute('aria-label') || source.textContent.trim();
    const checked = source.getAttribute('aria-checked') === 'true' || source.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-checked', String(checked));
    button.addEventListener('click', () => {
      source.click();
      onChange?.();
    });
    row.appendChild(button);
  }
  return row;
}

function mobileField(label, control) {
  const field = document.createElement('div');
  field.className = 'mobile-field';
  const name = document.createElement('span');
  name.className = 'mobile-field-label';
  name.textContent = label;
  field.append(name, control);
  return field;
}

function chosenText(selector, fallback) {
  const chosen = [...document.querySelectorAll(selector)]
    .find((button) => button.getAttribute('aria-checked') === 'true' || button.getAttribute('aria-pressed') === 'true');
  return chosen ? (chosen.querySelector('.settings-font-name')?.textContent || chosen.textContent).trim() : fallback;
}

async function syncMobileProgressPanel() {
  const position = typeof mobileReadingPosition === 'function' ? mobileReadingPosition() : { ratio: 0, label: '' };
  const percent = document.getElementById('mobileStatPercent');
  if (percent) percent.textContent = String(Math.round(position.ratio * 100));
  const chapter = document.getElementById('mobileProgressChapter');
  if (chapter) chapter.textContent = position.label || '';
  const bookId = state.currentBookId;
  if (!bookId || !window.browserHost) return;
  try {
    const today = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const to = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const [time, notes] = await Promise.all([
      window.browserHost.getReadingTime?.('2000-01-01', to),
      window.browserHost.getBookNotes?.(bookId)
    ]);
    if (state.currentBookId !== bookId) return;
    const seconds = Object.values(time?.days || {}).reduce((sum, books) => sum + (Number(books?.[bookId]) || 0), 0);
    const minutes = Math.round(seconds / 60);
    const timeValue = document.getElementById('mobileStatTime');
    const timeUnit = document.getElementById('mobileStatTimeUnit');
    if (timeValue && timeUnit) {
      const hours = minutes >= 60;
      timeValue.textContent = hours ? (minutes / 60).toFixed(minutes >= 600 ? 0 : 1).replace(/\.0$/, '') : String(minutes);
      timeUnit.textContent = hours ? '小时' : '分钟';
    }
    const count = document.getElementById('mobileStatNotes');
    if (count) count.textContent = String(Number(notes?.book?.count) || (notes?.notes?.length ?? 0));
  } catch { /* offline: the percentage is still right */ }
}

function syncMobileThemePanel() {
  document.querySelectorAll('[data-mobile-theme]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.mobileTheme === state.theme));
  });
  const glass = document.getElementById('mobileGlassSwitch');
  if (glass) glass.checked = state.liquidGlass === true;
  const ambientField = document.getElementById('mobileGlassAmbientField');
  if (ambientField) ambientField.hidden = state.liquidGlass !== true;
  const ambient = document.getElementById('mobileGlassAmbient');
  ambient?.replaceWith(Object.assign(mobileProxySegments(document.querySelectorAll('#settingGlassAmbient [data-glass-ambient]'), syncMobileThemePanel), { id: 'mobileGlassAmbient' }));
}

const MOBILE_SLIDERS = [
  ['fontSize', 'mobileFontSize', 'settingFontSize'],
  ['pageMargin', 'mobilePageMargin', 'settingPageMargin'],
  ['lineHeight', 'mobileLineHeight', 'settingLineHeight']
];

function syncMobileSlider(key, input, source) {
  if (!input || !source) return;
  input.min = source.min;
  input.max = source.max;
  input.step = source.step;
  input.value = source.value;
  const progress = Math.max(0, Math.min(100, ((Number(source.value) - Number(source.min)) / (Number(source.max) - Number(source.min))) * 100));
  input.closest('.mobile-slider')?.style.setProperty('--slider-progress', String(progress / 100));
  if (key === 'fontSize') {
    const value = document.getElementById('mobileFontSizeValue');
    if (value && typeof formatTypographySliderValue === 'function') value.textContent = formatTypographySliderValue('fontSize', source.value).replace(/px$/, '');
  }
}

function syncMobileTypePanel() {
  const pdf = state.contentType === 'pdf';
  document.querySelectorAll('#mobilePanelType [data-pdf-inapplicable]').forEach((element) => { element.hidden = pdf; });
  for (const [key, id, sourceId] of MOBILE_SLIDERS) {
    syncMobileSlider(key, document.getElementById(id), document.getElementById(sourceId));
  }
  const font = document.getElementById('mobileChipFont');
  if (font) font.textContent = chosenText('[data-font-choice]', '字体');
  const indent = document.getElementById('mobileChipIndent');
  if (indent) {
    const value = chosenText('#settingTextIndent [data-text-indent]', '');
    indent.textContent = !value ? '缩进' : value === '原书' ? '原书缩进' : value === '无' ? '首行顶格' : `缩进${value.replace(/\s*字$/, '')}字`;
  }
  const turn = document.getElementById('mobileChipTurn');
  if (turn) {
    const scroll = pdf ? state.mobilePdfMode === 'scroll' : state.readingMode === 'scroll';
    turn.textContent = scroll ? '上下滚动' : '左右翻页';
  }
}

function openMobileSub(name) {
  const title = document.getElementById('mobileSubTitle');
  const body = document.getElementById('mobileSubBody');
  if (!title || !body) return;
  body.dataset.sub = name;
  const rerender = () => openMobileSub(name);
  body.replaceChildren();
  if (name === 'font') {
    title.textContent = '字体';
    const list = document.createElement('div');
    list.className = 'mobile-choice-list';
    for (const source of document.querySelectorAll('[data-font-choice]')) {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'radio');
      row.setAttribute('aria-checked', String(source.getAttribute('aria-pressed') === 'true'));
      row.textContent = source.querySelector('.settings-font-name')?.textContent || source.textContent.trim();
      row.style.fontFamily = getComputedStyle(source.querySelector('.settings-font-sample') || source).fontFamily;
      row.addEventListener('click', () => { source.click(); rerender(); });
      list.appendChild(row);
    }
    body.appendChild(list);
  } else if (name === 'indent') {
    title.textContent = '首行缩进';
    body.appendChild(mobileField('每段开头空出', mobileProxySegments(document.querySelectorAll('#settingTextIndent [data-text-indent]'), rerender)));
  } else if (name === 'turn') {
    title.textContent = '翻页';
    syncSettingsPanel();
    const pdf = state.contentType === 'pdf';
    body.appendChild(mobileField('翻页方式', mobileProxySegments(document.querySelectorAll(pdf ? '[data-pdf-phone-mode]' : '[data-reading-mode-choice]'), rerender)));
    // The rows that only apply to left-right paging follow the sheet.
    const pagedOnly = !document.querySelector('[data-phone-paged-only]')?.hidden;
    if (pagedOnly) {
      body.appendChild(mobileField('翻页动画', mobileProxySegments(document.querySelectorAll('[data-page-turn]'), rerender)));
      body.appendChild(mobileField('点击翻页', mobileProxySegments(document.querySelectorAll('[data-tap-turn]'), rerender)));
      const swipeSource = document.getElementById('settingSwipeToTurn');
      const swipe = document.createElement('label');
      swipe.className = 'mobile-switch-row';
      swipe.innerHTML = '<span>左右滑动翻页</span><input type="checkbox" role="switch">';
      const input = swipe.querySelector('input');
      input.checked = swipeSource?.checked !== false;
      input.addEventListener('change', () => {
        if (!swipeSource) return;
        swipeSource.checked = input.checked;
        swipeSource.dispatchEvent(new Event('change', { bubbles: true }));
      });
      body.appendChild(swipe);
      const guide = document.createElement('button');
      guide.type = 'button';
      guide.className = 'mobile-link-button';
      guide.textContent = '查看点击区域';
      guide.addEventListener('click', () => {
        setMobileChromeOpen(false);
        if (typeof showTapGuide === 'function') showTapGuide();
      });
      body.appendChild(guide);
    }
  }
  setMobilePanel('sub');
}

// 划线颜色 on the phone's settings page: four dots instead of a dropdown.
function setupHighlightColorDots() {
  const select = document.getElementById('settingHighlightColor');
  const field = select?.closest('.settings-field');
  if (!select || !field || field.querySelector('.settings-color-dots')) return;
  const dots = document.createElement('div');
  dots.className = 'settings-color-dots';
  dots.setAttribute('role', 'radiogroup');
  dots.setAttribute('aria-label', '划线颜色');
  const sync = () => dots.querySelectorAll('button').forEach((dot) => {
    dot.setAttribute('aria-checked', String(dot.dataset.color === select.value));
  });
  for (const option of select.options) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('role', 'radio');
    dot.dataset.color = option.value;
    dot.setAttribute('aria-label', option.textContent);
    dot.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    });
    dots.appendChild(dot);
  }
  select.addEventListener('change', sync);
  field.appendChild(dots);
  sync();
}

function setupMobilePanels() {
  setupHighlightColorDots();
  const toolbar = document.getElementById('mobileReaderToolbar');
  if (!toolbar || toolbar.dataset.panelsBound) return;
  toolbar.dataset.panelsBound = 'true';
  toolbar.addEventListener('click', (event) => {
    const toggle = event.target.closest?.('[data-mobile-panel-toggle]');
    if (toggle) {
      const name = toggle.dataset.mobilePanelToggle;
      const current = activeMobilePanel === 'sub' ? 'type' : activeMobilePanel;
      setMobilePanel(current === name ? null : name);
      return;
    }
    const sub = event.target.closest?.('[data-mobile-sub]');
    if (sub) openMobileSub(sub.dataset.mobileSub);
  });
  document.getElementById('btnMobileSubBack')?.addEventListener('click', () => setMobilePanel('type'));
  document.getElementById('btnMobileMoreSettings')?.addEventListener('click', (event) => {
    setMobilePanel(null);
    openReaderPanel('settings', event.currentTarget);
    // The full sheet, already expanded, with 自定义 open.
    document.getElementById('readerSettingsSheet')?.classList.add('is-expanded');
    const advanced = document.getElementById('settingsTypographyAdvanced');
    if (advanced) advanced.open = true;
    const more = document.getElementById('btnSettingsMore');
    if (more) {
      more.setAttribute('aria-expanded', 'true');
      more.textContent = '收起';
    }
  });
  document.querySelectorAll('[data-mobile-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector(`[data-theme-choice="${button.dataset.mobileTheme}"]`)?.click();
      syncMobileThemePanel();
    });
  });
  document.getElementById('mobileGlassSwitch')?.addEventListener('change', (event) => {
    const source = document.getElementById('settingLiquidGlass');
    if (!source) return;
    source.checked = event.target.checked;
    source.dispatchEvent(new Event('change', { bubbles: true }));
    syncMobileThemePanel();
  });
  for (const [key, id, sourceId] of MOBILE_SLIDERS) {
    const input = document.getElementById(id);
    if (!input) continue;
    for (const type of ['input', 'change']) {
      input.addEventListener(type, () => {
        const source = document.getElementById(sourceId);
        if (!source) return;
        source.value = input.value;
        source.dispatchEvent(new Event(type, { bubbles: true }));
        syncMobileSlider(key, input, source);
      });
    }
  }
}

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
  setupMobilePanels();
  setupReaderTipsSettings();
  setupNativeClient();
  window.addEventListener('resize', update, { passive: true });
  window.visualViewport?.addEventListener('resize', update, { passive: true });
  window.screen?.orientation?.addEventListener?.('change', update, { passive: true });
  return update;
}
