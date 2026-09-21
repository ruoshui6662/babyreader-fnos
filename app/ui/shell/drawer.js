/* BabyReader UI module: shell/drawer */

'use strict';

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

let activeReaderPanel = null;
let activeReaderSurface = null;
let readerDrawerReturnFocus = null;

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

function surfaceElement(surface) {
  if (surface === 'content') return document.getElementById('readerDrawer');
  if (surface === 'settings') return document.getElementById('readerSettingsSheet');
  if (surface === 'search') return document.getElementById('readerSearchSheet');
  return null;
}

function surfaceBackdrop(surface) {
  if (surface === 'content') return document.getElementById('readerDrawerBackdrop');
  if (surface === 'settings') return document.getElementById('readerSettingsBackdrop');
  return null;
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

function hideSurface(surface) {
  const element = surfaceElement(surface);
  const backdrop = surfaceBackdrop(surface);
  if (element) element.hidden = true;
  if (backdrop) backdrop.hidden = true;
}

function closeReaderPanel({ restoreFocus = true } = {}) {
  if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
  hideSurface('content');
  hideSurface('settings');
  hideSurface('search');
  document.body.classList.remove('reader-drawer-open');
  activeReaderPanel = null;
  activeReaderSurface = null;
  setReaderTriggerState();

  if (restoreFocus && readerDrawerReturnFocus?.isConnected) {
    readerDrawerReturnFocus.focus();
  }
  readerDrawerReturnFocus = null;
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
  const surface = panelConfig.surface;
  const surfaceRoot = surfaceElement(surface);
  if (!surfaceRoot) return false;

  if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
  if (!activeReaderSurface) readerDrawerReturnFocus = trigger;

  hideSurface('content');
  hideSurface('settings');
  hideSurface('search');
  activeReaderSurface = surface;
  activeReaderPanel = surface === 'content' ? panelName : null;
  placeSurfaceCloseButton(surface);

  if (surface === 'content') {
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
  } else if (surface === 'settings') {
    syncSettingsPanel();
  }

  surfaceRoot.hidden = false;
  const backdrop = surfaceBackdrop(surface);
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('reader-drawer-open');
  setReaderTriggerState();

  requestAnimationFrame(() => {
    if (surface === 'content') {
      document.querySelector(`#readerDrawer [data-reader-panel-target="${panelName}"]`)?.focus?.();
    } else {
      surfaceRoot.querySelector('.reader-drawer-header button')?.focus?.();
    }
  });
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

  document.getElementById('readerDrawerBackdrop')?.addEventListener('click', () => closeReaderPanel());
  document.getElementById('readerSettingsBackdrop')?.addEventListener('click', () => closeReaderPanel());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeReaderSurface) {
      event.preventDefault();
      closeReaderPanel();
      return;
    }

    if (event.key !== 'Tab' || !activeReaderSurface) return;
    const surface = surfaceElement(activeReaderSurface);
    if (!surface || surface.hidden) return;

    const focusable = [...surface.querySelectorAll(
      'button:not([disabled]):not([hidden]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => !element.closest('[hidden]'));
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
