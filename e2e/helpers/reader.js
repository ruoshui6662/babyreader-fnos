'use strict';

const { expect } = require('@playwright/test');

const APP_PREFIX = '/app/zhenshu';

async function getEpubFixtureId(page) {
  return page.evaluate(async (prefix) => {
    const response = await fetch(`${prefix}/api/library`);
    if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
    const library = await response.json();
    const book = (library.books || []).find((item) => item.title === 'E2E EPUB');
    if (!book?.id) throw new Error('E2E EPUB fixture was not indexed');
    return book.id;
  }, APP_PREFIX);
}

async function resetEpubFixtureState(page) {
  return page.evaluate(async (prefix) => {
    const libraryResponse = await fetch(`${prefix}/api/library`);
    if (!libraryResponse.ok) throw new Error(`Library request failed: ${libraryResponse.status}`);
    const library = await libraryResponse.json();
    const book = (library.books || []).find((item) => item.title === 'E2E EPUB');
    if (!book?.id) throw new Error('E2E EPUB fixture was not indexed');

    const progress = {
      locator: JSON.stringify({
        version: 2,
        type: 'semantic-position',
        href: '',
        anchor: '',
        textBefore: '',
        pageNumber: 1,
        scrollTop: 0,
        percentage: 0
      }),
      percentage: 0
    };
    const requests = [
      fetch(`${prefix}/api/books/${encodeURIComponent(book.id)}/highlights`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ highlights: [] })
      }),
      fetch(`${prefix}/api/books/${encodeURIComponent(book.id)}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(progress)
      })
    ];
    const responses = await Promise.all(requests);
    for (const response of responses) {
      if (!response.ok) throw new Error(`Fixture reset failed: ${response.status}`);
    }
    return book.id;
  }, APP_PREFIX);
}

async function resetEpubFixtureBookmarks(page) {
  const bookId = await getEpubFixtureId(page);
  const bookmarks = await page.evaluate(async ({ prefix, id }) => {
    const response = await fetch(`${prefix}/api/books/${encodeURIComponent(id)}/bookmarks`);
    if (!response.ok) throw new Error(`Bookmark list request failed: ${response.status}`);
    return response.json();
  }, { prefix: APP_PREFIX, id: bookId });

  for (const bookmark of bookmarks) {
    const response = await page.request.delete(
      `${APP_PREFIX}/api/books/${encodeURIComponent(bookId)}/bookmarks/${encodeURIComponent(bookmark.id)}`
    );
    if (!response.ok()) throw new Error(`Bookmark reset failed: ${response.status()}`);
  }
}

async function saveEpubFixtureProgress(page, locator) {
  const bookId = await getEpubFixtureId(page);
  return page.evaluate(async ({ prefix, bookId: id, savedLocator }) => {
    const response = await fetch(`${prefix}/api/books/${encodeURIComponent(id)}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locator: JSON.stringify(savedLocator),
        percentage: Number.isFinite(savedLocator.percentage) ? savedLocator.percentage : 0
      })
    });
    if (!response.ok) throw new Error(`Progress save failed: ${response.status}`);
  }, { prefix: APP_PREFIX, bookId, savedLocator: locator });
}

async function resetReaderSettings(page) {
  return page.evaluate(async (prefix) => {
    const response = await fetch(`${prefix}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme: 'dark',
        fontSize: 100,
        lineHeight: 1.9,
        pageMargin: 40,
        readingMode: 'scroll',
        mobileReadingMode: 'paged',
        pdfPageColors: 'theme',
        continuousScroll: true,
        tocAutoOpen: true,
        highlightColor: 'yellow',
        textIndent: 2,
        paragraphSpacing: 1.1,
        readerFont: 'sans'
      })
    });
    if (!response.ok) throw new Error(`Settings reset failed: ${response.status}`);
  }, APP_PREFIX);
}

// Open a fixture EPUB book from the library.
async function openEpubFixture(page) {
  await page.goto('/app/zhenshu/');
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const book = page.locator('.library-book').filter({ hasText: 'E2E EPUB' });
  await expect(book).toBeVisible();
  await book.click();
  // Any chapter: a reopened book restores its saved chapter, so chapter 1 may
  // never be on screen (waiting for it raced the restore).
  await expect(page.locator('#article')).toContainText(/E2E EPUB Chapter \d/);
  // The EPUB receive flow opens the default TOC after the first chapter has
  // rendered. Give that final UI step a turn before normalizing the helper to
  // a closed reader surface.
  await page.waitForTimeout(50);
  // The product now honors the default directory preference on open. Keep
  // this generic helper focused on the reader surface; tests that verify the
  // preference itself assert the Drawer explicitly.
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }
  await expect(page.locator('#readerDrawer')).toBeHidden();
}

async function waitForSettingsSave(page) {
  return page.waitForResponse((response) =>
    response.url().endsWith('/api/settings') &&
    response.request().method() === 'PUT' &&
    response.ok()
  );
}

async function waitForHighlightsSave(page) {
  return page.waitForResponse((response) =>
    /\/api\/books\/[a-f0-9]{64}\/highlights$/.test(response.url()) &&
    response.request().method() === 'PUT' &&
    response.ok()
  );
}

async function waitForProgressSave(page, requestPredicate = () => true) {
  return page.waitForResponse((response) =>
    /\/api\/books\/[a-f0-9]{64}\/progress$/.test(response.url()) &&
    response.request().method() === 'PUT' &&
    response.ok() &&
    requestPredicate(response.request())
  );
}

async function waitForBookmarkRequest(page, method) {
  return page.waitForResponse((response) =>
    /\/api\/books\/[^/]+\/bookmarks(?:\/[^/]+)?$/.test(response.url()) &&
    response.request().method() === method &&
    response.ok()
  );
}

// Select the first occurrence of `text` inside #article via a real DOM Range,
// then dispatch pointerup/mouseup so setupDomHighlightInteraction's
// readSelection() runs and reveals the six-action selection menu.
async function selectArticleText(page, text) {
  const found = await page.evaluate((target) => {
    const article = document.querySelector('#article');
    if (!article) return false;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let foundLocal = false;
    while (walker.nextNode() && !foundLocal) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('.highlight-layer')) continue;
      const pos = node.textContent.indexOf(target);
      if (pos >= 0) {
        const range = document.createRange();
        range.setStart(node, pos);
        range.setEnd(node, pos + target.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        foundLocal = true;
      }
    }
    return foundLocal;
  }, text);
  if (!found) return false;
  // Mirror a real user lifting the mouse after a drag-select.
  await page.locator('#article').dispatchEvent('pointerup');
  await page.locator('#article').dispatchEvent('mouseup');
  return true;
}

// Select the Nth (0-based) occurrence of `text` inside #article.
async function selectNthArticleText(page, text, occurrence) {
  const found = await page.evaluate(({ target, index }) => {
    const article = document.querySelector('#article');
    if (!article) return false;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let seen = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('.highlight-layer')) continue;
      let pos = node.textContent.indexOf(target);
      while (pos >= 0) {
        if (seen === index) {
          const range = document.createRange();
          range.setStart(node, pos);
          range.setEnd(node, pos + target.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
        seen += 1;
        pos = node.textContent.indexOf(target, pos + target.length);
      }
    }
    return false;
  }, { target: text, index: occurrence });
  if (!found) return false;
  // Mirror a real user lifting the mouse after a drag-select.
  await page.locator('#article').dispatchEvent('pointerup');
  await page.locator('#article').dispatchEvent('mouseup');
  return true;
}

// Create a highlight from the currently selected text by clicking the marker action.
// Waits for the /api/books/:id/highlights PUT response and returns { before, after }.
async function commitSelectionHighlight(page) {
  // Wait for the selection menu to be visible after selection + pointerup events
  await expect(page.locator('#selectionMenu')).toBeVisible({ timeout: 5000 });
  const before = await readHighlightState(page);
  
  // Click marker to render and persist the annotation
  const save = waitForHighlightsSave(page);
  await page.locator('#selectionMenu [data-selection-action="marker"]').click();
  await save;
  const after = await readHighlightState(page);
  return { before, after };
}

// Read all persisted highlights for the open book via the page's own state.
async function readHighlightState(page) {
  const bookId = await getEpubFixtureId(page);
  return page.evaluate(async ({ prefix, id }) => {
    const res = await fetch(`${prefix}/api/state`);
    const json = await res.json();
    const highlights = json.books?.[id]?.highlights;
    return Array.isArray(highlights) ? highlights : [];
  }, { prefix: APP_PREFIX, id: bookId });
}

// Phones show the reading chrome by tapping the middle of the page.
async function showMobileReaderChrome(page) {
  if (await page.locator('#mobileReaderToolbar').isVisible()) return;
  const viewport = page.viewportSize();
  await page.mouse.click(Math.round(viewport.width / 2), Math.round(viewport.height / 2));
  await page.locator('#mobileReaderToolbar').waitFor({ state: 'visible' });
}

module.exports = {
  showMobileReaderChrome,
  openEpubFixture,
  getEpubFixtureId,
  resetEpubFixtureState,
  resetEpubFixtureBookmarks,
  saveEpubFixtureProgress,
  resetReaderSettings,
  waitForSettingsSave,
  waitForHighlightsSave,
  waitForProgressSave,
  waitForBookmarkRequest,
  selectArticleText,
  selectNthArticleText,
  commitSelectionHighlight,
  readHighlightState
};
