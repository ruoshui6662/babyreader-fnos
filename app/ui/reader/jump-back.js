/* 枕书 UI module: reader/jump-back */

'use strict';

// Apple Books-style safety net: after jumping from the contents, a search
// result, a note or a bookmark, a "返回原处" button takes the reader back to
// where they were. One origin at a time; it expires so it never lingers.
const JUMP_BACK_TIMEOUT_MS = 20000;
let _jumpOrigin = null;
let _jumpBackTimer = null;

function captureJumpOrigin() {
  const bookId = state.currentBookId;
  if (!bookId) return null;
  if (state.contentType === 'pdf') {
    const pageIndex = window.pdfReaderController?.getCurrentPageIndex?.();
    return Number.isInteger(pageIndex) ? { bookId, kind: 'pdf', pageIndex } : null;
  }
  if (state.contentType !== 'epub' || typeof currentReadingLocator !== 'function') return null;
  const reader = document.getElementById('reader');
  if (!reader) return null;
  return {
    bookId,
    kind: 'epub',
    chapterIndex: state.epubArchive && Number.isInteger(state.epubChapterIndex) ? state.epubChapterIndex : null,
    locator: currentReadingLocator(reader)
  };
}

function jumpBackButton() {
  let button = document.getElementById('btnJumpBack');
  if (button) return button;
  button = document.createElement('button');
  button.type = 'button';
  button.id = 'btnJumpBack';
  button.className = 'reader-jump-back';
  button.hidden = true;
  button.setAttribute('aria-label', '返回跳转前的位置');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"></path></svg><span>返回原处</span>';
  button.addEventListener('click', () => void returnToJumpOrigin());
  document.body.appendChild(button);
  return button;
}

function dismissJumpBack() {
  clearTimeout(_jumpBackTimer);
  _jumpBackTimer = null;
  _jumpOrigin = null;
  const button = document.getElementById('btnJumpBack');
  if (button) button.hidden = true;
}

function offerJumpBack(origin) {
  if (!origin || origin.bookId !== state.currentBookId) return;
  _jumpOrigin = origin;
  jumpBackButton().hidden = false;
  clearTimeout(_jumpBackTimer);
  _jumpBackTimer = setTimeout(dismissJumpBack, JUMP_BACK_TIMEOUT_MS);
}

async function returnToJumpOrigin() {
  const origin = _jumpOrigin;
  dismissJumpBack();
  if (!origin || origin.bookId !== state.currentBookId) return false;
  if (origin.kind === 'pdf') {
    return Boolean(window.pdfReaderController?.goToPdfPage(origin.pageIndex));
  }
  if (Number.isInteger(origin.chapterIndex) && typeof navigateToEpubChapter === 'function') {
    return Boolean(await navigateToEpubChapter(origin.chapterIndex, { locator: origin.locator }));
  }
  return typeof restoreReadingLocator === 'function' && Boolean(restoreReadingLocator(origin.locator));
}

// Runs a jump and, if it landed, offers the way back to the starting point.
async function withJumpBack(jump) {
  const origin = captureJumpOrigin();
  const landed = await jump();
  if (landed && origin) offerJumpBack(origin);
  return landed;
}
