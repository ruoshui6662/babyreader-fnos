/* BabyReader UI module: shell/drawer */

'use strict';

const readerPanels = Object.freeze({
  toc: {
    id: 'readerPanelToc',
    title: '目录',
    enabled: () => state.contentType === 'epub' && state.toc.length > 0
  },
  settings: {
    id: 'readerPanelSettings',
    title: '显示设置',
    enabled: () => true
  },
  search: {
    id: 'readerPanelSearch',
    title: '搜索',
    enabled: () => false
  },
  bookmarks: {
    id: 'readerPanelBookmarks',
    title: '书签',
    enabled: () => false
  },
  notes: {
    id: 'readerPanelNotes',
    title: '笔记',
    enabled: () => false
  },
  ai: {
    id: 'readerPanelAi',
    title: 'AI',
    enabled: () => false
  }
});

let activeReaderPanel = null;
let readerDrawerReturnFocus = null;

function closeReaderPanel({ restoreFocus = true } = {}) {
  const drawer = document.getElementById('readerDrawer');
  const backdrop = document.getElementById('readerDrawerBackdrop');
  if (drawer) drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('reader-drawer-open');
  document.querySelectorAll('[aria-controls="readerDrawer"]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
  activeReaderPanel = null;

  if (restoreFocus && readerDrawerReturnFocus?.isConnected) {
    readerDrawerReturnFocus.focus();
  }
  readerDrawerReturnFocus = null;
}

function openReaderPanel(panelName, trigger = document.activeElement) {
  const panelConfig = readerPanels[panelName];
  if (!panelConfig) return false;
  if (!panelConfig.enabled()) {
    showHighlightHint(`${panelConfig.title}功能尚未实现`);
    return false;
  }

  const drawer = document.getElementById('readerDrawer');
  const backdrop = document.getElementById('readerDrawerBackdrop');
  const title = document.getElementById('readerDrawerTitle');
  if (!drawer) return false;

  // Preserve the original launcher while switching panels inside the same Drawer.
  // Otherwise Esc may try to restore focus to a tab that has just become hidden.
  if (!activeReaderPanel) readerDrawerReturnFocus = trigger;
  activeReaderPanel = panelName;
  document.querySelectorAll('[data-reader-panel-name]').forEach((panel) => {
    panel.hidden = panel.dataset.readerPanelName !== panelName;
  });
  document.querySelectorAll('[data-reader-panel-target]').forEach((tab) => {
    const selected = tab.dataset.readerPanelTarget === panelName;
    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[aria-controls="readerDrawer"]').forEach((button) => {
    button.setAttribute('aria-expanded', button === trigger ? 'true' : 'false');
  });
  if (title) title.textContent = panelConfig.title;
  if (panelName === 'settings') syncSettingsPanel();
  drawer.hidden = false;
  if (backdrop) backdrop.hidden = false;
  document.body.classList.add('reader-drawer-open');
  requestAnimationFrame(() => document.getElementById(panelConfig.id)?.focus?.());
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
  openAi: (trigger) => openReaderPanel('ai', trigger),
  closePanel: () => closeReaderPanel()
});

function setupReaderActionMapping() {
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

  document.getElementById('readerDrawerBackdrop')?.addEventListener('click', () => {
    closeReaderPanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeReaderPanel) {
      event.preventDefault();
      closeReaderPanel();
      return;
    }

    if (event.key !== 'Tab' || !activeReaderPanel) return;
    const drawer = document.getElementById('readerDrawer');
    if (!drawer || drawer.hidden) return;

    const focusable = [...drawer.querySelectorAll(
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
