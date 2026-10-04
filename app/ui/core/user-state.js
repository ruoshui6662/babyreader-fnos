/* 枕书 UI module: core/user-state */

'use strict';

// First-line indent: 'book' (the book's own layout) or 0-4 characters.
// Older settings stored half steps (1.5, 2.5); they round to the nearest.
function normalizeTextIndent(value, fallback = 2) {
  if (value === 'book') return 'book';
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(4, Math.round(number)));
}

function currentUserSettings() {
  const savedSettings = state.userState.settings || {};
  const savedMode = savedSettings.readingMode === 'single' ? 'double' : savedSettings.readingMode;
  const savedDesktopMode = ['scroll', 'double'].includes(savedMode)
    ? savedMode
    : savedSettings.continuousScroll === false ? 'double' : 'scroll';
  // Phones and desktops keep separate reading modes: a phone saves only its
  // own choice and leaves the desktop one as it was, and the other way round.
  const phone = typeof isMobileReaderSurface === 'function' && isMobileReaderSurface();
  const readingMode = phone || !['scroll', 'double'].includes(state.readingMode)
    ? savedDesktopMode
    : state.readingMode;
  const mobileReadingMode = phone
    ? state.readingMode === 'scroll' ? 'scroll' : 'paged'
    : savedSettings.mobileReadingMode === 'scroll' ? 'scroll' : 'paged';
  return {
    theme: state.theme,
    fontSize: zoomLevel,
    lineHeight: state.lineHeight,
    pageMargin: state.pageMargin,
    readingMode,
    mobileReadingMode,
    pdfLayoutMode: ['continuous', 'single', 'double'].includes(state.pdfLayoutMode)
      ? state.pdfLayoutMode : 'continuous',
    pdfPageColors: state.pdfPageColors === 'original' ? 'original' : 'theme',
    liquidGlass: state.liquidGlass === true,
    glassAmbient: state.glassAmbient === 'uniform' ? 'uniform' : 'cover',
    pageTurnAnimation: ['slide', 'fade', 'none'].includes(state.pageTurnAnimation) ? state.pageTurnAnimation : 'slide',
    mobilePdfMode: state.mobilePdfMode === 'scroll' ? 'scroll' : 'paged',
    readerTips: state.readerTips || { preset: 'default' },
    tapZones: state.tapZones || { preset: 'sides' },
    // Older pages and clients read tapToTurn.
    tapToTurn: state.tapZones?.preset === 'forward' ? 'forward' : 'zones',
    swipeToTurn: state.swipeToTurn !== false,
    continuousScroll: readingMode === 'scroll',
    tocAutoOpen: state.tocOpen,
    highlightColor: state.highlightColor,
    textIndent: state.textIndent,
    paragraphSpacing: state.paragraphSpacing,
    readerFont: state.fontFamily
  };
}

function applyUserState(userState) {
  const next = userState && typeof userState === 'object' ? userState : {};
  state.userState = {
    version: 2,
    books: next.books && typeof next.books === 'object' && !Array.isArray(next.books) ? next.books : {},
    settings: next.settings && typeof next.settings === 'object' && !Array.isArray(next.settings) ? next.settings : {}
  };

  const settings = state.userState.settings;
  state.theme = ['light', 'sepia'].includes(settings.theme) ? settings.theme : 'dark';
  zoomLevel = Number.isFinite(settings.fontSize)
    ? Math.max(60, Math.min(200, Math.round(settings.fontSize)))
    : 100;
  state.lineHeight = Number.isFinite(settings.lineHeight)
    ? Math.max(1.2, Math.min(2.6, Math.round(settings.lineHeight * 10) / 10))
    : 1.9;
  state.pageMargin = Number.isFinite(settings.pageMargin)
    ? Math.max(8, Math.min(96, Math.round(settings.pageMargin)))
    : 40;
  state.highlightColor = ['yellow', 'green', 'blue', 'pink'].includes(settings.highlightColor)
    ? settings.highlightColor
    : 'yellow';
  // User-facing preference. 'single' is no longer offered: it survives only as
  // the effective mode a narrow window degrades to, never as a stored choice.
  const allowedReadingModes = ['scroll', 'double'];
  const storedMode = settings.readingMode === 'single' ? 'double' : settings.readingMode;
  const restoredMode = allowedReadingModes.includes(storedMode)
    ? storedMode
    : settings.continuousScroll === false ? 'double' : 'scroll';
  // Phones page left and right by default (WeChat Reading); 上下滚动 is the
  // phone's own opt-in and never changes the desktop mode.
  const phone = typeof isMobileReaderSurface === 'function' && isMobileReaderSurface();
  state.readingModeAutoApplied = false;
  state.readingMode = phone
    ? settings.mobileReadingMode === 'scroll' ? 'scroll' : 'double'
    : restoredMode;
  state.pdfLayoutMode = ['continuous', 'single', 'double'].includes(settings.pdfLayoutMode)
    ? settings.pdfLayoutMode : 'continuous';
  state.pdfPageColors = settings.pdfPageColors === 'original' ? 'original' : 'theme';
  state.liquidGlass = settings.liquidGlass === true;
  state.glassAmbient = settings.glassAmbient === 'uniform' ? 'uniform' : 'cover';
  state.continuousScroll = state.readingMode === 'scroll';
  state.effectiveReadingMode = state.readingMode;
  state.tocOpen = settings.tocAutoOpen === true;
  state.pageTurnAnimation = ['slide', 'fade', 'none'].includes(settings.pageTurnAnimation) ? settings.pageTurnAnimation : 'slide';
  state.mobilePdfMode = settings.mobilePdfMode === 'scroll' ? 'scroll' : 'paged';
  state.readerTips = settings.readerTips && typeof settings.readerTips === 'object' ? settings.readerTips : { preset: 'default' };
  state.tapZones = settings.tapZones && typeof settings.tapZones === 'object'
    ? settings.tapZones
    : { preset: settings.tapToTurn === 'forward' ? 'forward' : 'sides' };
  state.swipeToTurn = settings.swipeToTurn !== false;
  // P0 typography: clamped exactly like the server does, so a hand-edited
  // settings file can never push the layout out of range.
  state.textIndent = normalizeTextIndent(settings.textIndent);
  state.paragraphSpacing = Number.isFinite(settings.paragraphSpacing)
    ? Math.max(0.4, Math.min(3, Math.round(settings.paragraphSpacing * 10) / 10))
    : 1.1;
  state.fontFamily = FONT_STACKS[settings.readerFont] ? settings.readerFont : DEFAULT_READER_FONT;

  applyTheme(state.theme, false);
  if (typeof applyGlass === 'function') applyGlass();
  applyZoom();
  applyTypography();
  updateTopbarState();
}

let settingsSaveInFlight = null;
let settingsSaveQueued = false;

async function saveLatestUserSettings() {
  settingsSaveQueued = true;
  if (settingsSaveInFlight) return settingsSaveInFlight;

  settingsSaveInFlight = (async () => {
    try {
      while (settingsSaveQueued) {
        settingsSaveQueued = false;
        const settings = await window.browserHost.saveSettings(currentUserSettings());
        state.userState.settings = { ...state.userState.settings, ...settings };
      }
    } catch (error) {
      console.error('保存用户设置失败', error);
      showHighlightHint('设置保存失败');
      throw error;
    } finally {
      settingsSaveInFlight = null;
    }
  })();

  return settingsSaveInFlight;
}

const persistUserSettings = debounce(() => saveLatestUserSettings(), 250);

async function flushUserSettings() {
  await persistUserSettings.flush();
  if (settingsSaveInFlight) await settingsSaveInFlight;
}

function currentServerBookState() {
  if (!state.currentBookId) return {};
  return state.userState.books[state.currentBookId] || {};
}

function currentServerBookBookmarks() {
  const bookmarks = currentServerBookState().bookmarks;
  return Array.isArray(bookmarks) ? bookmarks : [];
}

function setCurrentServerBookBookmarks(bookmarks) {
  if (!state.currentBookId) return [];
  const cleaned = Array.isArray(bookmarks) ? bookmarks : [];
  state.userState.books[state.currentBookId] = {
    ...currentServerBookState(),
    bookmarks: cleaned
  };
  return cleaned;
}

function setDirty(nextDirty) {
  state.dirty = !!nextDirty;
}

function storageKey(prefix) {
  if (!state.currentPath) return null;
  return `zhenshu:${prefix}:${state.contentType}:${state.currentPath}`;
}

function savedPosition() {
  const serverProgress = currentServerBookState().progress;
  if (serverProgress?.locator) {
    try {
      return JSON.parse(serverProgress.locator);
    } catch {
      return { locator: serverProgress.locator, percentage: serverProgress.percentage };
    }
  }

  const key = storageKey('position');
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

let _progressSaveChain = Promise.resolve();

function savePosition(value, { keepalive = false } = {}) {
  const key = storageKey('position');
  if (!key || !value) return Promise.resolve();
  localStorage.setItem(key, JSON.stringify(value));

  if (!state.currentBookId) return Promise.resolve();
  const bookId = state.currentBookId;
  const progress = {
    locator: JSON.stringify(value),
    percentage: Number.isFinite(value.percentage) ? value.percentage : null
  };
  const previous = currentServerBookState();
  state.userState.books[bookId] = {
    ...previous,
    progress: { ...progress, updatedAt: new Date().toISOString() }
  };

  _progressSaveChain = _progressSaveChain.catch(() => {}).then(() => {
    if (!bookId) return;
    return apiRequest(`/books/${encodeURIComponent(bookId)}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progress),
      ...(keepalive ? { keepalive: true } : {})
    });
  }).catch((error) => {
    console.error('保存阅读进度失败', { bookId, error });
    throw error;
  });
  return _progressSaveChain;
}

async function flushPendingProgressSave() {
  await _progressSaveChain;
}

function saveHighlights(highlights) {
  const cleaned = Array.isArray(highlights) ? highlights : [];
  if (!state.currentBookId) return;

  const previous = currentServerBookState();
  state.userState.books[state.currentBookId] = {
    ...previous,
    highlights: cleaned
  };

  // The server is authoritative. Remove legacy cached highlights so a deleted
  // highlight cannot reappear after refresh or an application restart.
  const key = storageKey('highlights');
  if (key) localStorage.removeItem(key);
}

function loadHighlights() {
  const serverHighlights = currentServerBookState().highlights;
  if (!Array.isArray(serverHighlights)) return [];

  return serverHighlights.map((highlight) => {
    let domRange = highlight.domRange || highlight.locatorData || null;
    const locator = String(highlight.locator || '');
    if (!domRange && locator.startsWith('{')) {
      try {
        const parsed = JSON.parse(locator);
        if (parsed?.type === 'dom-range') domRange = parsed;
      } catch {
        domRange = null;
      }
    }

    return {
      ...highlight,
      domRange,
      cfi: highlight.cfi || (locator.startsWith('epubcfi(') ? locator : undefined),
      chapterHref: normalizeChapterHref(highlight.chapterHref || domRange?.chapterHref || ''),
      color: ['yellow', 'green', 'blue', 'pink'].includes(highlight.color) ? highlight.color : 'yellow',
      kind: ['highlight', 'thought'].includes(highlight.kind) ? highlight.kind : 'highlight',
      style: ['marker', 'wave', 'line', 'none'].includes(highlight.style) ? highlight.style : 'marker',
      thought: String(highlight.thought || highlight.note || ''),
      note: String(highlight.thought || highlight.note || ''),
      date: highlight.date || String(highlight.createdAt || '').slice(0, 10),
      updatedAt: String(highlight.updatedAt || highlight.createdAt || '')
    };
  });
}

function savePdfAnnotations(bookId, annotations) {
  if (!bookId || !Array.isArray(annotations)) return false;
  const previous = state.userState.books[bookId] || {};
  state.userState.books[bookId] = { ...previous, pdfAnnotations: annotations };
  if (state.currentBookId === bookId && state.contentType === 'pdf'
      && typeof renderNotesPanel === 'function') renderNotesPanel();
  return true;
}

function loadPdfAnnotations(bookId = state.currentBookId) {
  const annotations = state.userState.books?.[bookId]?.pdfAnnotations;
  return Array.isArray(annotations) ? annotations : [];
}
