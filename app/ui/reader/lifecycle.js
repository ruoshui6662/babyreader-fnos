/* 枕书 UI module: reader/lifecycle */

'use strict';

let libraryReturnPending = null;

function returnToLibrary() {
  if (libraryReturnPending) return libraryReturnPending;
  libraryReturnPending = performReturnToLibrary().finally(() => { libraryReturnPending = null; });
  return libraryReturnPending;
}

async function performReturnToLibrary() {
  if (typeof closeHighlightEditor === 'function' && closeHighlightEditor({ restoreFocus: false }) === false) return;
  const bookId = state.currentBookId;
  const reader = document.getElementById('reader');
  const backButtons = [document.getElementById('btnBackToLibrary')].filter(Boolean);

  if (typeof setMobileTopbarHidden === 'function') setMobileTopbarHidden(false);
  if (typeof setDesktopTopbarHidden === 'function') setDesktopTopbarHidden(false);

  if (bookId && reader && state.contentType === 'epub') {
    saveTextScroll();
  }

  backButtons.forEach((button) => { button.disabled = true; });
  try {
    if (state.contentType === 'pdf' && typeof flushPdfProgressSave === 'function') {
      await flushPdfProgressSave();
    }
    await Promise.all([
      saveTextScroll.flush(),
      flushUserSettings()
    ]);
    await Promise.all([
      flushPendingHighlightSaves(),
      flushPendingProgressSave()
    ]);
    const library = await window.browserHost.getLibrary();
    if (library?.features?.libraryOrganization === true) {
      library.organization = await window.browserHost.getLibraryOrganization();
    }
    // No renderer or search state is discarded until all fallible I/O succeeds.
    if (typeof destroyPdfReader === 'function') await destroyPdfReader();
    if (typeof resetReaderSearch === 'function') resetReaderSearch();
    _lastLibraryFocusBookId = bookId;
    // Back to the shelf page the book was opened from.
    if (typeof showShelfView === 'function') await showShelfView(shelfViewFromLocation(), { library });
    else renderLibrary(library);
    const card = [...document.querySelectorAll('[data-book-id]')].find((item) => item.dataset.bookId === bookId);
    (card?.matches('button') ? card : card?.querySelector('button'))?.focus({ preventScroll: true });
  } catch (error) {
    showHighlightHint(error.message || '返回书架失败');
  } finally {
    backButtons.forEach((button) => { button.disabled = false; });
  }
}

function setupHighlightButtons() {
  // Mobile highlight uses the same data-reader-action dispatcher as desktop.
}

function setupReaderNavigation() {
  const reader = document.getElementById('reader');
  let lastScrollTop = Math.max(0, Number(reader?.scrollTop) || 0);

  const closeMobileChrome = () => {
    if (typeof setMobileChromeOpen === 'function') setMobileChromeOpen(false);
  };

  // Phone tap zones (WeChat Reading): in paged EPUBs the left third turns
  // back, the right third forward and the middle shows the reading chrome;
  // scrolling books, plain text and PDFs show the chrome on any tap. While
  // the chrome is open, any tap on the page just hides it.
  reader?.addEventListener('click', (event) => {
    if (!isMobileReaderSurface() || !state.currentPath) return;
    if (!['epub', 'pdf', 'text'].includes(state.contentType)) return;
    if (isPaginationInteractionTarget(event.target)) return;
    if (event.target?.closest?.('.pdf-text-layer a, .pdf-annotation-layer a')) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    // The tap that dismissed a selection or annotation bubble does nothing else.
    if (typeof selectionMenuRecentlyDismissed === 'function' && selectionMenuRecentlyDismissed()) return;
    if (Date.now() - (state.lastMobileSwipeAt || 0) < 400) return;
    if (isMobileChromeOpen()) {
      closeMobileChrome();
      return;
    }
    const pdfPaged = state.contentType === 'pdf' && window.pdfReaderController?.isPhonePaged?.();
    const paged = pdfPaged || state.contentType === 'epub' && state.effectiveReadingMode !== 'scroll';
    // 九宫格点击区: the part of the page tapped decides. Scrolling books
    // have no pages to turn: any tap shows the chrome.
    if (paged && typeof tapZoneActionAt === 'function') {
      runTapZoneAction(tapZoneActionAt(event.clientX, event.clientY), pdfPaged);
      return;
    }
    setMobileChromeOpen(true);
  });

  reader?.addEventListener('scroll', () => {
    const currentScrollTop = Math.max(0, Number(reader.scrollTop) || 0);
    // The shelf's top edge: content under the status bar and the top
    // buttons gets a soft material only once it has scrolled there.
    document.body.classList.toggle('shelf-scrolled', document.body.classList.contains('is-library') && currentScrollTop > 4);
    const isMobileEpub = isMobileReaderSurface() && state.contentType === 'epub';
    if (isMobileReaderSurface() && typeof syncMobileReadingBar === 'function') syncMobileReadingBar();

    if (!isMobileEpub) {
      if (isMobileReaderSurface() && isMobileChromeOpen() && Math.abs(currentScrollTop - lastScrollTop) > 24) closeMobileChrome();
      if (typeof setMobileTopbarHidden === 'function') setMobileTopbarHidden(false);
      if (typeof setDesktopTopbarHidden === 'function') {
        const delta = currentScrollTop - lastScrollTop;
        if (currentScrollTop <= 8 || delta < -4) setDesktopTopbarHidden(false);
        else if (delta > 4) setDesktopTopbarHidden(true);
      }
      lastScrollTop = currentScrollTop;
      return;
    }

    if (isMobileChromeOpen()) closeMobileChrome();

    const scrollDelta = currentScrollTop - lastScrollTop;
    if (currentScrollTop <= 8 || scrollDelta < -4) {
      setMobileTopbarHidden(false);
    } else if (scrollDelta > 4) {
      setMobileTopbarHidden(true);
    }
    lastScrollTop = currentScrollTop;
  }, { passive: true });

  // A hidden desktop top bar comes back when the pointer reaches the top edge
  // or keyboard focus enters it.
  document.addEventListener('mousemove', (event) => {
    if (event.clientY <= 64 && document.body.classList.contains('reader-topbar-hidden')) {
      setDesktopTopbarHidden(false);
    }
  }, { passive: true });
  document.querySelector('.reader-shell-nav')?.addEventListener('focusin', () => setDesktopTopbarHidden(false));
}

function isTextInputTarget(target) {
  const tag = target?.tagName || '';
  return /^(input|textarea|select)$/i.test(tag) || Boolean(target?.isContentEditable);
}

function isPaginationInteractionTarget(target) {
  return Boolean(target?.closest?.('a, button, input, select, textarea, label, [contenteditable="true"], .br-highlight-box, .highlight-editor, .reader-drawer'));
}

function setupPositionTracking() {
  const reader = document.getElementById('reader');
  if (!reader) return;

  let scrollSnapTimer = null;
  let pointerStartX = null;
  let pointerStartY = null;
  let pointerBlocked = false;

  const handleScroll = () => {
    saveTextScroll();
    if (state.effectiveReadingMode === 'scroll' || state.pageDragging) return;
    clearTimeout(scrollSnapTimer);
    scrollSnapTimer = setTimeout(() => snapPaginationToNearestGroup({ save: true }), 120);
  };

  // scroll events do not bubble, and the scroll container differs per mode:
  // the reader scrolls in continuous mode, the multicol article scrolls in
  // paged mode.
  reader.addEventListener('scroll', handleScroll);
  document.getElementById('article')?.addEventListener('scroll', handleScroll);

  // On a phone with 平移, the page follows a horizontal swipe under the
  // finger; letting go turns (or springs back) from where it is.
  let pageDrag = null;
  const swipeAllowed = (event) => event.pointerType === 'mouse' || state.swipeToTurn !== false;
  const endPageDrag = () => {
    if (!pageDrag) return;
    pageDrag = null;
    state.pageDragging = false;
  };

  reader.addEventListener('pointerdown', (event) => {
    pointerBlocked = event.button !== 0 || isPaginationInteractionTarget(event.target);
    pointerStartX = pointerBlocked ? null : event.clientX;
    pointerStartY = pointerBlocked ? null : event.clientY;
    endPageDrag();
  });

  reader.addEventListener('pointermove', (event) => {
    if (pointerStartX === null || event.pointerType === 'mouse' || state.effectiveReadingMode === 'scroll') return;
    if (!swipeAllowed(event) || typeof pageTurnStyle !== 'function' || pageTurnStyle() !== 'slide') return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    const article = document.getElementById('article');
    if (!pageDrag) {
      if (Math.abs(deltaX) < 10 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      const selection = window.getSelection?.();
      if (!article || isEpubChapterLoading() || (selection && !selection.isCollapsed)) return;
      if (typeof cancelPageTurnAnimation === 'function') cancelPageTurnAnimation();
      pageDrag = { base: state.pageOffset, max: Math.max(0, pageLeftForGroup(state.pageGroupCount - 1)) };
      state.pageDragging = true;
    }
    // Past the first or last page of the chapter the page moves at a third
    // of the finger's pace: it can be pulled, it will not run away.
    let left = pageDrag.base - deltaX;
    if (left < 0) left /= 3;
    if (left > pageDrag.max) left = pageDrag.max + (left - pageDrag.max) / 3;
    article.scrollLeft = left;
  });

  reader.addEventListener('pointerup', (event) => {
    const dragged = Boolean(pageDrag);
    endPageDrag();
    // PDFs on a phone: a swipe turns the page unless the page is zoomed in
    // (then it pans).
    if (state.contentType === 'pdf') {
      const pdf = window.pdfReaderController;
      if (pointerBlocked || pointerStartX === null || event.pointerType === 'mouse' || !pdf?.isPhonePaged?.()) return;
      const deltaX = event.clientX - pointerStartX;
      const deltaY = event.clientY - pointerStartY;
      pointerStartX = null;
      pointerStartY = null;
      if (state.swipeToTurn === false || pdf.phonePagedZoomed() || Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      state.lastMobileSwipeAt = Date.now();
      turnPhonePdfPage(deltaX < 0 ? 1 : -1);
      return;
    }
    if (pointerBlocked || pointerStartX === null || state.effectiveReadingMode === 'scroll') return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    pointerStartX = null;
    pointerStartY = null;
    const article = document.getElementById('article');
    const settle = () => {
      if (dragged && article) animatePagedOffset(article, state.pageOffset);
      else snapPaginationToNearestGroup({ save: true });
    };
    if (!swipeAllowed(event) || Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      settle();
      return;
    }
    state.lastMobileSwipeAt = Date.now();
    // Into the next chapter the new chapter replaces the page; at the very
    // first or last page nothing turns and the page springs back.
    if (!navigatePageGroup(deltaX < 0 ? 1 : -1)) settle();
  });

  reader.addEventListener('pointercancel', () => {
    if (pageDrag) {
      const article = document.getElementById('article');
      if (article) animatePagedOffset(article, state.pageOffset);
    }
    endPageDrag();
    pointerStartX = null;
    pointerStartY = null;
    pointerBlocked = false;
  });

  // Real keystrokes land on the focused element and bubble to `document`; a
  // non-focusable div such as #reader never sees them (tabIndex -1), which is
  // why keyboard paging looked dead even though the geometry was correct.
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Page turners and keyboards on a phone's PDF read a page at a time.
    if (state.contentType === 'pdf' && window.pdfReaderController?.isPhonePaged?.() && !isTextInputTarget(event.target)) {
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
      const back = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
      if (forward || back) {
        event.preventDefault();
        turnPhonePdfPage(forward ? 1 : -1);
      }
      return;
    }
    if (state.contentType !== 'epub' || state.effectiveReadingMode === 'scroll') return;
    // Typing in the note box or a form field always wins.
    if (isTextInputTarget(event.target)) return;
    // An open Drawer is a focused task of its own; do not move the page under it.
    const drawerOpen = document.body.classList.contains('reader-drawer-open');
    if (drawerOpen) return;
    const key = event.key;
    // Up and down too: many Bluetooth page turners send them.
    if (['ArrowRight', 'ArrowDown', 'PageDown', 'Home', 'End', 'ArrowLeft', 'ArrowUp', 'PageUp'].includes(key)) {
      // Arrows and Page keys never activate buttons, so they can page even
      // while a toolbar button still holds focus after a click.
      event.preventDefault();
      if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown') navigatePageGroup(1);
      else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') navigatePageGroup(-1);
      else if (key === 'Home') setPageGroup(0, { save: true });
      else setPageGroup(state.pageGroupCount - 1, { save: true });
      return;
    }
    if (key === ' ') {
      // Space activates a focused control; only page when it would otherwise
      // just scroll the viewport.
      if (isPaginationInteractionTarget(event.target)) return;
      event.preventDefault();
      navigatePageGroup(event.shiftKey ? -1 : 1);
    }
  });
}
