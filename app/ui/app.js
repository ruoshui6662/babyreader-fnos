/* ============================================================
   枕书 — app.js
   ============================================================ */

'use strict';

let readerStartupPending = null;

function startReaderSession() {
  if (readerStartupPending) return readerStartupPending;
  readerStartupPending = loadReaderSession().finally(() => { readerStartupPending = null; });
  return readerStartupPending;
}

// Skeletons stand in for content while it loads (shape first, no spinner);
// the wording stays for screen readers.
function renderSkeleton(container, label, kind) {
  container.replaceChildren();
  container.classList.add('is-skeleton');
  const text = document.createElement('span');
  text.className = 'visually-hidden';
  text.textContent = label;
  const shape = document.createElement('div');
  shape.className = `skeleton skeleton-${kind}`;
  shape.setAttribute('aria-hidden', 'true');
  if (kind === 'shelf') {
    shape.innerHTML = '<div class="skeleton-bar skeleton-title"></div><div class="skeleton-bar skeleton-subtitle"></div>'
      + `<div class="skeleton-grid">${'<div class="skeleton-cover"></div>'.repeat(8)}</div>`;
  } else {
    shape.innerHTML = '<div class="skeleton-bar skeleton-heading"></div>'
      + ['96', '100', '92', '100', '88', '100', '97', '64'].map((width) => `<div class="skeleton-bar skeleton-line" style="width:${width}%"></div>`).join('');
  }
  container.append(text, shape);
}

async function loadReaderSession() {
  let status = document.getElementById('readerStartupStatus');
  if (!status) {
    status = document.createElement('section');
    status.id = 'readerStartupStatus';
    status.className = 'reader-startup-status';
    status.setAttribute('role', 'status');
    document.getElementById('reader')?.prepend(status);
  }
  status.hidden = false;
  renderSkeleton(status, '正在加载书库…', 'shelf');
  try {
    const [session, userState, library] = await Promise.all([
      window.browserHost.getSession(), window.browserHost.getUserState(), window.browserHost.getLibrary()
    ]);
    state.session = session;
    syncAiIndexManagerAccess();
    applyUserState(userState);
    applyContinuousScroll();
    syncSettingsPanel();
    await restoreReaderFromLocation(library);
    status.hidden = true;
  } catch (error) {
    status.classList.remove('is-skeleton');
    status.textContent = error?.status === 401 || error?.status === 403
      ? '登录已失效或没有访问权限，请从 fnOS 重新登录并打开应用。'
      : '书库加载失败，请检查网络或应用运行状态后重试。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'mode-btn';
    retry.textContent = '重试';
    retry.addEventListener('click', () => { void startReaderSession(); });
    status.appendChild(retry);
  }
}

function openDefaultReaderToc() {
  if (!state.tocOpen || state.toc.length === 0 || typeof openReaderPanel !== 'function') return false;
  // A generated page list (PDF without an outline) is navigation, not a
  // table of contents worth opening on arrival.
  if (state.toc.every((item) => item?.generated === true)) return false;
  const trigger = document.getElementById('btnToc') || document.activeElement;
  return openReaderPanel('toc', trigger);
}

function replaceReaderLocation(url) {
  if (!url || typeof window === 'undefined' || !window.history?.replaceState) return;
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function syncReaderBookLocation(bookId) {
  if (!bookId || typeof setReaderBookId !== 'function') return;
  replaceReaderLocation(setReaderBookId(bookId, window.location.href));
}

function clearReaderBookLocation() {
  if (typeof clearReaderBookId !== 'function' || typeof window === 'undefined') return;
  replaceReaderLocation(clearReaderBookId(window.location.href));
}

function readerBookFromLocation(library) {
  if (typeof getReaderBookId !== 'function' || typeof window === 'undefined') return null;
  const bookId = getReaderBookId(window.location.href);
  if (!bookId) return null;
  return (library?.books || []).find((book) => book?.id === bookId && !book.error) || null;
}

async function renderLibraryWithOrganization(library) {
  if (library?.features?.libraryOrganization === true
      && typeof window.browserHost.getLibraryOrganization === 'function') {
    try {
      const organization = await window.browserHost.getLibraryOrganization();
      return renderLibrary({ ...library, organization });
    } catch {
      // Keep the existing flat shelf usable if the optional organization API is unavailable.
    }
  }
  return renderLibrary(library);
}

async function restoreReaderFromLocation(library) {
  const bookId = typeof getReaderBookId === 'function' && typeof window !== 'undefined'
    ? getReaderBookId(window.location.href)
    : null;
  if (!bookId) {
    await renderLibraryWithOrganization(library);
    return false;
  }

  const book = readerBookFromLocation(library);
  if (!book) {
    clearReaderBookLocation();
    await renderLibraryWithOrganization(library);
    return false;
  }

  try {
    await window.browserHost.openBook(book);
    return true;
  } catch (error) {
    clearReaderBookLocation();
    await renderLibraryWithOrganization(library);
    showHighlightHint(error.message || '恢复阅读页面失败');
    return false;
  }
}











/* ============================================================
   appHost API — browser document receiver
   ============================================================ */
window.appHost = {
  async receiveDocument({ path, name, type, content, data, bookId, contentUrl }) {
    // A document transition can replace or hide the settings drawer while a
    // custom select is open. Close its body-level portal before changing UI.
    if (typeof closeAllCustomSelects === 'function') closeAllCustomSelects();
    if (typeof closeSelectionMenu === 'function') closeSelectionMenu({ clearSelection: false });
    if (!document.getElementById('highlightEditor')?.hidden && typeof closeHighlightEditor === 'function') {
      if (closeHighlightEditor({ restoreFocus: false }) === false) return false;
    }
    if (state.contentType === 'pdf' && typeof flushPdfProgressSave === 'function') {
      try { await flushPdfProgressSave(); } catch (error) {
        console.error('切换文档前保存 PDF 阅读进度失败', error);
      }
    }
    if (typeof destroyPdfReader === 'function'
        && (state.contentType === 'pdf' || type !== 'pdf')) {
      await destroyPdfReader();
    }
    if (state.currentBookId && state.currentBookId !== bookId && typeof closeAiModal === 'function') {
      closeAiModal({ restoreFocus: false, cancelRequest: true });
      if (typeof resetAiConversation === 'function') {
        resetAiConversation({ clearConversationId: true, clearConversationList: true });
      }
    }
    if (typeof setMobileChromeOpen === 'function') setMobileChromeOpen(false);
    if (typeof setMobileTopbarHidden === 'function') setMobileTopbarHidden(false);
    if (typeof setDesktopTopbarHidden === 'function') setDesktopTopbarHidden(false);
    if (typeof dismissJumpBack === 'function') dismissJumpBack();
    state.currentBookId = bookId || null;
    state.currentPath  = path;
    state.currentName  = name;
    state.contentType  = type === 'epub' || type === 'pdf' ? type : 'text';
    syncSettingsPanel();
    syncReaderBookLocation(state.currentBookId);
    if (typeof resetReaderSearch === 'function') resetReaderSearch();
    state.toc          = [];
    _pendingCfiRange   = null;
    renderToc();
    updateTopbarState();

    const fileNameEl = document.getElementById('fileName');
    if (fileNameEl) fileNameEl.textContent = name;

    if (type === 'pdf') {
      pdfReaderController.setLayoutMode(state.pdfLayoutMode);
      await destroyEpub();
      state.content = '';
      state.mode = 'read';
      renderArticle();
      try {
        await pdfReaderController.openPdf(bookId, contentUrl, savedPosition());
        try {
          await refreshPdfAnnotations(bookId);
        } catch (error) {
          showHighlightHint(error.message || 'PDF 标记暂时无法加载，仍可继续阅读');
        }
      } catch {
        // The PDF surface owns a sanitized, user-facing load error message.
      }
    } else if (type === 'epub' && data) {
      // Show loading state
      const article = document.getElementById('article');
      const epubShell = document.getElementById('epubShell');
      if (article) {
        article.style.display = '';
        renderSkeleton(article, '正在打开 EPUB…', 'page');
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
        if (article && !state.epubRenderPending && state.effectiveReadingMode !== 'scroll') {
          requestAnimationFrame(() => measurePagination({ preserveLocator: true }));
        }
      }
    } else {
      destroyEpub();
      state.content = content || '';
    }

    setDirty(false);
    setMode('read');
    // The chapter-window renderer owns the EPUB DOM once it is available.
    // Keep the existing article path as a compatibility bridge while Task 2's
    // renderer is not present, and for all non-EPUB documents.
    if (state.contentType !== 'epub' && state.contentType !== 'pdf'
        || (state.contentType === 'epub' && typeof renderEpubChapter !== 'function')) {
      renderArticle();
    }
    if (state.contentType !== 'pdf') restoreTextScroll();
    renderToc();
    updateTopbarState();
    openDefaultReaderToc();
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
    return state.contentType === 'epub' || state.contentType === 'pdf' ? '' : state.content;
  },

  toggleEditMode() {
    // Don't allow editing EPUB files
    if (state.contentType === 'epub' || state.contentType === 'pdf') return;
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
  setupReaderDeviceProfile();
  configureMarked();
  setupThemeToggle();
  setupTocToggle();
  setupSettingsPanel();
  setupHighlightButtons();
  setupHighlightEditor();
  setupSelectionMenu();
  setupAiPanel();
  setupAiIndexManager();
  setupNotesPanel();
  setupReaderNavigation();
  setupReaderActionMapping();
  setupReaderSearch();
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
  const handleViewportChange = debounce(() => {
    measurePagination({ preserveLocator: true });
  }, 120);
  window.addEventListener('resize', handleViewportChange);
  window.visualViewport?.addEventListener('resize', handleViewportChange);
  window.screen?.orientation?.addEventListener?.('change', handleViewportChange);
  const orientationQuery = window.matchMedia?.('(orientation: portrait)');
  orientationQuery?.addEventListener?.('change', handleViewportChange);

  document.addEventListener('click', (e) => {
    if (_highlightPill && e.target !== _highlightPill) {
      dismissHighlightPill();
    }
  });

  void startReaderSession();
});
