/* BabyReader UI module: shell/drawer */

'use strict';

const readerSearchContract = Object.freeze({
  endpointTemplate: '/api/books/:bookId/search',
  scopes: Object.freeze(['book', 'chapter']),
  defaultScope: 'book',
  defaultLimit: 20,
  maxLimit: 50
});

function buildReaderSearchUrl({
  bookId,
  query = '',
  scope = readerSearchContract.defaultScope,
  chapterIndex = null,
  limit = readerSearchContract.defaultLimit
} = {}) {
  if (!bookId) throw new TypeError('bookId is required');
  const normalizedScope = readerSearchContract.scopes.includes(scope)
    ? scope
    : readerSearchContract.defaultScope;
  const requestedLimit = Number(limit);
  const boundedLimit = Math.max(
    1,
    Math.min(
      readerSearchContract.maxLimit,
      Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : readerSearchContract.defaultLimit
    )
  );
  const url = new URL(`/api/books/${encodeURIComponent(bookId)}/search`, window.location.origin);
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery) url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('scope', normalizedScope);
  if (normalizedScope === 'chapter' && Number.isInteger(chapterIndex)) {
    url.searchParams.set('chapterIndex', String(chapterIndex));
  }
  url.searchParams.set('limit', String(boundedLimit));
  return `${url.pathname}${url.search}`;
}

const readerPanels = Object.freeze({
  toc: {
    id: 'readerPanelToc',
    title: '目录',
    surface: 'content',
    enabled: () => state.toc.length > 0
  },
  settings: {
    id: 'readerPanelSettings',
    title: '显示设置',
    surface: 'settings',
    enabled: () => true
  },
  search: {
    id: 'readerSearchSheet',
    title: '搜索',
    surface: 'search',
    enabled: () => false
  },
  bookmarks: {
    id: 'readerPanelBookmarks',
    title: '书签',
    surface: 'content',
    enabled: () => state.contentType === 'epub' && Boolean(state.currentBookId)
  },
  notes: {
    id: 'readerPanelNotes',
    title: '标记与想法',
    surface: 'content',
    enabled: () => state.contentType === 'epub'
  },
});

const readerSurfaceDefinitions = Object.freeze({
  content: { rootId: 'readerDrawer', backdropId: 'readerDrawerBackdrop' },
  settings: { rootId: 'readerSettingsSheet', backdropId: 'readerSettingsBackdrop' },
  search: { rootId: 'readerSearchSheet', backdropId: null }
});

let activeReaderPanel = null;
let activeReaderSurface = null;
let readerSurfaceReturnFocus = null;
let readerSurfaceBackdropsBound = false;

function ensureSettingsSurface() {
  const settingsPanel = document.getElementById('readerPanelSettings');
  const settingsContent = document.getElementById('readerSettingsContent');
  if (!settingsPanel || !settingsContent || settingsPanel.parentElement === settingsContent) return;
  settingsContent.appendChild(settingsPanel);
}

function placeSurfaceCloseButton(surface) {
  const closeButton = document.getElementById('btnCloseSettings');
  if (!closeButton) return;
  if (surface === 'settings') {
    document.querySelector('[data-reader-close-slot="settings"]')?.appendChild(closeButton);
  } else if (surface === 'content') {
    document.querySelector('#readerDrawer .reader-drawer-header')?.appendChild(closeButton);
  }
}

function surfaceDefinition(surface) {
  return readerSurfaceDefinitions[surface] || null;
}

function surfaceElement(surface) {
  const definition = surfaceDefinition(surface);
  return definition ? document.getElementById(definition.rootId) : null;
}

function surfaceBackdrop(surface) {
  const definition = surfaceDefinition(surface);
  return definition?.backdropId ? document.getElementById(definition.backdropId) : null;
}

function setSurfaceVisibility(surface, visible) {
  const root = surfaceElement(surface);
  const backdrop = surfaceBackdrop(surface);
  if (root) {
    root.hidden = !visible;
    root.setAttribute('aria-hidden', visible ? 'false' : 'true');
    root.setAttribute('aria-modal', 'true');
  }
  if (backdrop) {
    backdrop.hidden = !visible;
    backdrop.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }
}

function updateSurfaceBodyState() {
  const readerSurfaceOpen = ['content', 'settings', 'search'].includes(activeReaderSurface);
  document.body.classList.toggle('reader-drawer-open', readerSurfaceOpen);
}

function setReaderTriggerState() {
  document.querySelectorAll('[data-reader-action]').forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    const action = button.dataset.readerAction;
    let expanded = false;
    if (activeReaderSurface === 'content') {
      expanded = ['openToc', 'openBookmarks', 'openNotes'].includes(action)
        && button.dataset.readerPanel === activeReaderPanel;
    } else if (activeReaderSurface === 'settings') {
      expanded = action === 'openSettings';
    } else if (activeReaderSurface === 'search') {
      expanded = action === 'openSearch';
    }
    if (button.hasAttribute('aria-expanded')) {
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  });
}

function focusableElements(surface) {
  const root = surfaceElement(surface);
  if (!root || root.hidden) return [];
  return [...root.querySelectorAll(
    'button:not([disabled]):not([hidden]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.closest('[hidden]'));
}

const readerSurfaceController = Object.freeze({
  get activeSurface() {
    return activeReaderSurface;
  },

  activate(surface, trigger = document.activeElement, { focus = true } = {}) {
    if (!surfaceDefinition(surface) || !surfaceElement(surface)) return false;
    ensureSettingsSurface();
    if (!activeReaderSurface) readerSurfaceReturnFocus = trigger;

    Object.keys(readerSurfaceDefinitions).forEach((name) => {
      setSurfaceVisibility(name, false);
    });
    activeReaderSurface = surface;
    setSurfaceVisibility(surface, true);
    updateSurfaceBodyState();
    setReaderTriggerState();

    if (focus) {
      requestAnimationFrame(() => {
        focusableElements(surface)[0]?.focus?.();
      });
    }
    return true;
  },

  close({ surface = null, restoreFocus = true } = {}) {
    if (surface && activeReaderSurface !== surface) return false;
    Object.keys(readerSurfaceDefinitions).forEach((name) => {
      setSurfaceVisibility(name, false);
    });
    activeReaderSurface = null;
    activeReaderPanel = null;
    updateSurfaceBodyState();
    setReaderTriggerState();

    if (restoreFocus && readerSurfaceReturnFocus?.isConnected) {
      readerSurfaceReturnFocus.focus();
    }
    readerSurfaceReturnFocus = null;
    return true;
  },

  focusInitial(surface, panelName = null) {
    requestAnimationFrame(() => {
      if (surface === 'content' && panelName) {
        document.querySelector(`#readerDrawer [data-reader-panel-target="${panelName}"]`)?.focus?.();
        return;
      }
      focusableElements(surface)[0]?.focus?.();
    });
  },

  bindBackdrops() {
    if (readerSurfaceBackdropsBound) return;
    readerSurfaceBackdropsBound = true;
    Object.keys(readerSurfaceDefinitions).forEach((surface) => {
      surfaceBackdrop(surface)?.addEventListener('click', () => {
        this.close();
      });
    });
  },

  syncAccessibility() {
    Object.keys(readerSurfaceDefinitions).forEach((surface) => {
      const root = surfaceElement(surface);
      if (!root) return;
      setSurfaceVisibility(surface, !root.hidden && activeReaderSurface === surface);
    });
    updateSurfaceBodyState();
    setReaderTriggerState();
  }
});

function closeReaderPanel({ restoreFocus = true } = {}) {
  if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
  return readerSurfaceController.close({ restoreFocus });
}

function openReaderPanel(panelName, trigger = document.activeElement) {
  const panelConfig = readerPanels[panelName];
  if (!panelConfig) return false;
  if (typeof setMobileChromeOpen === 'function' && isMobileReaderSurface()) {
    setMobileChromeOpen(false);
  }
  if (!panelConfig.enabled()) {
    showHighlightHint(`${panelConfig.title}功能尚未实现`);
    return false;
  }

  ensureSettingsSurface();
  if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
  activeReaderPanel = panelConfig.surface === 'content' ? panelName : null;
  if (!readerSurfaceController.activate(panelConfig.surface, trigger, { focus: false })) return false;
  placeSurfaceCloseButton(panelConfig.surface);

  if (panelConfig.surface === 'content') {
    const title = document.getElementById('readerDrawerTitle');
    document.querySelectorAll('#readerDrawer [data-reader-panel-name]').forEach((panel) => {
      panel.hidden = panel.dataset.readerPanelName !== panelName;
    });
    document.querySelectorAll('#readerDrawer [data-reader-panel-target]').forEach((tab) => {
      const selected = tab.dataset.readerPanelTarget === panelName;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    if (title) title.textContent = panelConfig.title;
    if (panelName === 'notes' && typeof renderNotesPanel === 'function') renderNotesPanel();
    if (panelName === 'bookmarks' && typeof renderBookmarkList === 'function') {
      renderBookmarkList();
      if (typeof refreshBookmarks === 'function') void refreshBookmarks();
    }
  } else if (panelConfig.surface === 'settings') {
    syncSettingsPanel();
  }

  setReaderTriggerState();
  readerSurfaceController.focusInitial(panelConfig.surface, panelName);
  return true;
}

function triggerHighlightAction() {
  if (state.contentType !== 'epub') return;
  if (!runPendingHighlight() && !highlightCurrentDomSelection()) {
    showHighlightHint('先选中一段 EPUB 文本');
  }
}

const readerActions = Object.freeze({
  backToLibrary: () => returnToLibrary(),
  previousChapter: () => navigateChapter(-1),
  nextChapter: () => navigateChapter(1),
  previousPage: () => navigatePageGroup(-1),
  nextPage: () => navigatePageGroup(1),
  highlight: () => triggerHighlightAction(),
  exportHighlights: () => exportHighlights(),
  toggleBookmark: () => toggleCurrentBookmark(),
  toggleTheme: () => {
    toggleTheme();
    syncSettingsPanel();
    persistUserSettings();
  },
  openToc: (trigger) => openReaderPanel('toc', trigger),
  openSettings: (trigger) => openReaderPanel('settings', trigger),
  openSearch: (trigger) => openReaderPanel('search', trigger),
  openBookmarks: (trigger) => openReaderPanel('bookmarks', trigger),
  openNotes: (trigger) => openReaderPanel('notes', trigger),
  openAi: (trigger) => typeof openAiModal === 'function' ? openAiModal(null, trigger) : false,
  closePanel: () => closeReaderPanel()
});

function setupReaderActionMapping() {
  ensureSettingsSurface();
  readerSurfaceController.bindBackdrops();
  document.addEventListener('click', (event) => {
    const panelTab = event.target.closest?.('[data-reader-panel-target]');
    if (panelTab) {
      event.preventDefault();
      openReaderPanel(panelTab.dataset.readerPanelTarget, panelTab);
      return;
    }

    const trigger = event.target.closest?.('[data-reader-action]');
    if (!trigger || trigger.disabled) return;
    const action = readerActions[trigger.dataset.readerAction];
    if (typeof action !== 'function') return;
    event.preventDefault();
    action(trigger);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeReaderSurface) {
      event.preventDefault();
      closeReaderPanel();
      return;
    }

    if (event.key !== 'Tab' || !activeReaderSurface) return;
    const focusable = focusableElements(activeReaderSurface);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

ensureSettingsSurface();
readerSurfaceController.syncAccessibility();
window.readerSurfaceController = readerSurfaceController;
window.readerSearchContract = readerSearchContract;
window.buildReaderSearchUrl = buildReaderSearchUrl;
