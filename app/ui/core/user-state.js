/* BabyReader UI module: core/user-state */

'use strict';

function currentUserSettings() {
  return {
    theme: state.theme,
    fontSize: zoomLevel,
    lineHeight: state.lineHeight,
    pageMargin: state.pageMargin,
    readingMode: state.readingMode,
    continuousScroll: state.readingMode === 'scroll',
    tocOpen: state.tocOpen,
    highlightColor: state.highlightColor,
    textIndent: state.textIndent,
    paragraphSpacing: state.paragraphSpacing,
    fontFamily: state.fontFamily
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
  state.readingMode = allowedReadingModes.includes(storedMode)
    ? storedMode
    : settings.continuousScroll === false ? 'double' : 'scroll';
  state.continuousScroll = state.readingMode === 'scroll';
  state.effectiveReadingMode = state.readingMode;
  state.tocOpen = settings.tocOpen !== false;
  // P0 typography: clamped exactly like the server does, so a hand-edited
  // settings file can never push the layout out of range.
  state.textIndent = Number.isFinite(settings.textIndent)
    ? Math.max(0, Math.min(4, Math.round(settings.textIndent * 2) / 2))
    : 2;
  state.paragraphSpacing = Number.isFinite(settings.paragraphSpacing)
    ? Math.max(0.4, Math.min(3, Math.round(settings.paragraphSpacing * 10) / 10))
    : 1.1;
  state.fontFamily = FONT_STACKS[settings.fontFamily] ? settings.fontFamily : 'sans';

  applyTheme(state.theme, false);
  applyZoom();
  applyTypography();
  updateTopbarState();
}

const persistUserSettings = debounce(() => {
  return window.browserHost.saveSettings(currentUserSettings())
    .then((settings) => {
      state.userState.settings = { ...state.userState.settings, ...settings };
      return settings;
    })
    .catch((error) => {
      console.error('保存用户设置失败', error);
      showHighlightHint('设置保存失败');
      throw error;
    });
}, 250);

function currentServerBookState() {
  if (!state.currentBookId) return {};
  return state.userState.books[state.currentBookId] || {};
}

function setDirty(nextDirty) {
  state.dirty = !!nextDirty;
}

function storageKey(prefix) {
  if (!state.currentPath) return null;
  return `babyreader:${prefix}:${state.contentType}:${state.currentPath}`;
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

function savePosition(value) {
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
    progress
  };

  _progressSaveChain = _progressSaveChain.catch(() => {}).then(() => {
    if (!bookId) return;
    return apiRequest(`/books/${encodeURIComponent(bookId)}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progress)
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
      note: String(highlight.note || ''),
      date: highlight.date || String(highlight.createdAt || '').slice(0, 10)
    };
  });
}
