/* BabyReader UI module: reader/lifecycle */

'use strict';

async function returnToLibrary() {
  const bookId = state.currentBookId;
  const reader = document.getElementById('reader');
  const backButtons = [
    document.getElementById('btnBackToLibrary'),
    document.getElementById('btnMobileBackToLibrary')
  ].filter(Boolean);

  if (bookId && reader && state.contentType === 'epub') {
    saveTextScroll();
  }

  backButtons.forEach((button) => { button.disabled = true; });
  try {
    await Promise.all([
      saveTextScroll.flush(),
      persistUserSettings.flush()
    ]);
    await Promise.all([
      flushPendingHighlightSaves(),
      flushPendingProgressSave()
    ]);
    _lastLibraryFocusBookId = bookId;
    const library = await window.browserHost.getLibrary();
    renderLibrary(library);
  } catch (error) {
    showHighlightHint(error.message || '返回书架失败');
  } finally {
    backButtons.forEach((button) => { button.disabled = false; });
  }
}

function setupHighlightButtons() {
  // Desktop actions are delegated through readerActions; retain the mobile compatibility control.
  document.getElementById('btnMobileHighlight')?.addEventListener('click', triggerHighlightAction);
}

function setupReaderNavigation() {
  // Desktop navigation is delegated through readerActions; retain existing mobile IDs and behavior.
  document.getElementById('btnMobilePreviousChapter')?.addEventListener('click', () => navigateChapter(-1));
  document.getElementById('btnMobileNextChapter')?.addEventListener('click', () => navigateChapter(1));
  document.getElementById('btnMobilePreviousPage')?.addEventListener('click', () => navigatePageGroup(-1));
  document.getElementById('btnMobileNextPage')?.addEventListener('click', () => navigatePageGroup(1));
  document.getElementById('btnMobileBackToLibrary')?.addEventListener('click', returnToLibrary);
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
    if (state.effectiveReadingMode === 'scroll') return;
    clearTimeout(scrollSnapTimer);
    scrollSnapTimer = setTimeout(() => snapPaginationToNearestGroup({ save: true }), 120);
  };

  // scroll events do not bubble, and the scroll container differs per mode:
  // the reader scrolls in continuous mode, the multicol article scrolls in
  // paged mode.
  reader.addEventListener('scroll', handleScroll);
  document.getElementById('article')?.addEventListener('scroll', handleScroll);

  reader.addEventListener('pointerdown', (event) => {
    pointerBlocked = event.button !== 0 || isPaginationInteractionTarget(event.target);
    pointerStartX = pointerBlocked ? null : event.clientX;
    pointerStartY = pointerBlocked ? null : event.clientY;
  });

  reader.addEventListener('pointerup', (event) => {
    if (pointerBlocked || pointerStartX === null || state.effectiveReadingMode === 'scroll') return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    pointerStartX = null;
    pointerStartY = null;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      snapPaginationToNearestGroup({ save: true });
      return;
    }
    navigatePageGroup(deltaX < 0 ? 1 : -1);
  });

  reader.addEventListener('pointercancel', () => {
    pointerStartX = null;
    pointerStartY = null;
    pointerBlocked = false;
  });

  // Real keystrokes land on the focused element and bubble to `document`; a
  // non-focusable div such as #reader never sees them (tabIndex -1), which is
  // why keyboard paging looked dead even though the geometry was correct.
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (state.contentType !== 'epub' || state.effectiveReadingMode === 'scroll') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Typing in the note box or a form field always wins.
    if (isTextInputTarget(event.target)) return;
    // An open Drawer is a focused task of its own; do not move the page under it.
    const drawerOpen = document.body.classList.contains('reader-drawer-open');
    if (drawerOpen) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'PageDown' || key === 'Home' || key === 'End' || key === 'ArrowLeft' || key === 'PageUp') {
      // Arrows and Page keys never activate buttons, so they can page even
      // while a toolbar button still holds focus after a click.
      event.preventDefault();
      if (key === 'ArrowRight' || key === 'PageDown') navigatePageGroup(1);
      else if (key === 'ArrowLeft' || key === 'PageUp') navigatePageGroup(-1);
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
