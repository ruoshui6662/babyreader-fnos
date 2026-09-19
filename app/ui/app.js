/* ============================================================
   BabyReader — app.js
   ============================================================ */

'use strict';











/* ============================================================
   appHost API — browser document receiver
   ============================================================ */
window.appHost = {
  async receiveDocument({ path, name, type, content, data, bookId }) {
    state.currentBookId = bookId || null;
    state.currentPath  = path;
    state.currentName  = name;
    state.contentType  = (type === 'epub') ? 'epub' : 'text';
    state.toc          = [];
    _pendingCfiRange   = null;
    renderToc();
    updateTopbarState();

    const fileNameEl = document.getElementById('fileName');
    if (fileNameEl) fileNameEl.textContent = name;

    if (type === 'epub' && data) {
      // Show loading state
      const article = document.getElementById('article');
      const epubShell = document.getElementById('epubShell');
      if (article) {
        article.style.display = '';
        article.innerHTML = '<p style="color:var(--text-dim);padding:80px 40px;">正在打开 EPUB…</p>';
      }
      if (epubShell) epubShell.style.display = 'none';

      try {
        state.content = '[epub]';
        renderArticle();
        await renderEpubDocument(data);
      } catch (err) {
        destroyEpub();
        state.content = `<p style="color:var(--accent)">EPUB 解析失败：${err.message}</p>`;
        state.contentType = 'text';
      } finally {
        // Always re-measure pagination after EPUB content arrives, because the
        // article now contains real chapter content and needs to grow its column
        // track. Resize won't trigger until viewport changes, so do it eagerly.
        const article = document.getElementById('article');
        if (article && state.effectiveReadingMode !== 'scroll') {
          requestAnimationFrame(() => measurePagination({ preserveLocator: true }));
        }
      }
    } else {
      destroyEpub();
      state.content = content || '';
    }

    setDirty(false);
    setMode('read');
    renderArticle();
    restoreTextScroll();
    renderToc();
    updateTopbarState();
  },

  notifySaved({ path, name } = {}) {
    if (path) state.currentPath = path;
    if (name) state.currentName = name;
    setDirty(false, false);

    const fileNameEl = document.getElementById('fileName');
    if (!fileNameEl) return;

    const displayName = name || state.currentName;
    fileNameEl.textContent = '已保存';
    fileNameEl.style.color = 'var(--accent)';

    setTimeout(() => {
      fileNameEl.textContent = displayName;
      fileNameEl.style.color = '';
    }, 1200);
  },

  notifyHighlightFileWritten({ path, silent } = {}) {
    if (silent) return;
    if (path) flashFileName(`已导出到 ${path}`, 4200);
  },

  getContent() {
    if (state.mode === 'edit') {
      const editor = document.getElementById('editor');
      if (editor) state.content = editor.value;
    }
    return state.contentType === 'epub' ? '' : state.content;
  },

  toggleEditMode() {
    // Don't allow editing EPUB files
    if (state.contentType === 'epub') return;
    setMode(state.mode === 'read' ? 'edit' : 'read');
  },

  toggleTheme,

  highlightSelection() {
    if (state.contentType !== 'epub') return;
    if (!runPendingHighlight() && !highlightCurrentDomSelection()) {
      showHighlightHint('先选中一段 EPUB 文本');
    }
  },

  exportHighlights,

  zoomIn()    { zoomLevel = Math.min(200, zoomLevel + 10); applyZoom(); },
  zoomOut()   { zoomLevel = Math.max(60, zoomLevel - 10);  applyZoom(); },
  zoomReset() { zoomLevel = 100; applyZoom(); },

  setImmersive(on) {
    document.body.classList.toggle('immersive', !!on);
  }
};

/* ============================================================
   DOMContentLoaded — Boot
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  configureMarked();
  setupThemeToggle();
  setupTocToggle();
  setupSettingsPanel();
  setupHighlightButtons();
  setupHighlightEditor();
  setupReaderNavigation();
  setupReaderActionMapping();
  // Topbar 阅读/编辑 buttons removed (P0); setMode is now driven only by
  // openDocument/reset flows. No keyboard shortcut exists, so markdown/txt
  // edit mode has no UI entry (editor DOM kept for a future re-add).

  // Set up editor live preview with debounce
  const editor = document.getElementById('editor');
  if (editor) {
    const debouncedPreview = debounce(() => {
      state.content = editor.value;
      renderPreview();
    }, 300);

    editor.addEventListener('input', () => {
      state.content = editor.value;
      setDirty(true);
      debouncedPreview();
    });
  }

  setupKeyboard();
  setupTocNavigation();
  setupDomHighlightInteraction();
  setupPositionTracking();
  renderArticle();
  updateTopbarState();
  window.addEventListener('resize', debounce(() => {
    measurePagination({ preserveLocator: true });
  }, 120));

  document.addEventListener('click', (e) => {
    if (_highlightPill && e.target !== _highlightPill) {
      dismissHighlightPill();
    }
  });

  Promise.all([
    window.browserHost.getSession(),
    window.browserHost.getUserState(),
    window.browserHost.getLibrary()
  ]).then(([session, userState, library]) => {
    state.session = session;
    applyUserState(userState);
    applyContinuousScroll();
    syncSettingsPanel();
    renderLibrary(library);
  }).catch((error) => showHighlightHint(error.message));
});
