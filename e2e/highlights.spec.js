'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const {
  openEpubFixture,
  getEpubFixtureId,
  resetEpubFixtureState,
  resetReaderSettings,
  waitForHighlightsSave,
  selectArticleText,
  selectNthArticleText,
  readHighlightState
} = require('./helpers/reader');
const { FIXTURE_TEXT } = require('./fixtures/reader-fixtures');

test.describe('Highlight CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await openEpubFixture(page);
    await resetReaderSettings(page);
    await resetEpubFixtureState(page);
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 1');
  });

  test.afterEach(async ({ page }) => {
    await resetReaderSettings(page);
    const readingMode = await page.evaluate(async (prefix) => {
      const response = await fetch(`${prefix}/api/state`);
      const state = await response.json();
      return state.settings?.readingMode;
    }, '/app/babyreader-fnos');
    expect(readingMode).toBe('scroll');
  });

  test('highlights: reads only the E2E EPUB fixture server state', async ({ page }) => {
    const fixtureId = await getEpubFixtureId(page);
    const fixtureHighlights = [{ id: 'fixture-highlight', text: 'E2E fixture highlight' }];

    const stateRoute = async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          books: {
            'other-book': { highlights: [{ id: 'foreign-highlight', text: 'Foreign book highlight' }] },
            [fixtureId]: { highlights: fixtureHighlights }
          }
        })
      });
    };
    await page.route('**/api/state', stateRoute);

    await expect(readHighlightState(page)).resolves.toEqual(fixtureHighlights);
    await page.unroute('**/api/state', stateRoute);
  });

  test('highlights: create a single highlight, persist through reload', async ({ page }) => {
    // Select unique text in chapter1
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();

    const btnHighlight = page.locator('#btnHighlight');
    const savePromise = waitForHighlightsSave(page);
    await btnHighlight.click();
    const saveRes = await savePromise;
    expect(saveRes.status()).toBe(200);

    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
    await expect(page.locator('#readingProgress')).toContainText('1/3');

    // Reload and verify still there
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
    await expect(page.locator('#readingProgress')).toContainText('1/3');
  });

  test('highlights: edit existing highlight color, persist through reload', async ({ page }) => {
    // First create one highlight (yellow)
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await firstSave;
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);

    // Click highlight box to open editor
    const yellowBox = page.locator('.br-highlight-box[data-highlight-color="yellow"]');
    await expect(yellowBox).toBeVisible();
    const originalId = await yellowBox.getAttribute('data-highlight-id');
    await yellowBox.click();
    await expect(page.locator('#highlightEditor')).toBeVisible();

    // Change color to green
    await page.locator('#highlightEditorColor').selectOption('green');
    const editSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await editSave;

    await expect(page.locator('.br-highlight-box')).toHaveAttribute('data-highlight-color', 'green');
    const editedState = await readHighlightState(page);
    expect(editedState).toHaveLength(1);
    expect(editedState[0].id).toBe(originalId);
    expect(editedState[0].color).toBe('green');
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    await expect(page.locator('.br-highlight-box')).toHaveAttribute('data-highlight-color', 'green');
    const reloadedState = await readHighlightState(page);
    expect(reloadedState[0].id).toBe(editedState[0].id);
  });

  test('highlights: add/modify note, persist through reload', async ({ page }) => {
    // Create first highlight
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await firstSave;

    // Edit note
    const highlightBox = page.locator('.br-highlight-box').first();
    await highlightBox.click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await page.locator('#highlightEditorNote').fill('This is a new note for testing.');
    const originalId = await highlightBox.getAttribute('data-highlight-id');
    const noteSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await noteSave;

    // Verify note persisted through reload
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    const hls = await readHighlightState(page);
    const notesMatch = hls.find(h => h.note === 'This is a new note for testing.');
    expect(notesMatch).toBeDefined();
    expect(notesMatch.id).toBe(originalId);
  });

  test('highlights: delete only one of two identical-text highlights', async ({ page }) => {
    // Create two identical-text highlights using different DOM ranges.
    await expect(selectNthArticleText(page, FIXTURE_TEXT.repeatedPhrase, 0)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await firstSave;

    // Select second occurrence (same text, different locator → different ID)
    await expect(selectNthArticleText(page, FIXTURE_TEXT.repeatedPhrase, 1)).resolves.toBeTruthy();
    const secondSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await secondSave;

    const idsBefore = await page.locator('.br-highlight-box').evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.dataset.highlightId))
    ]);
    expect(idsBefore).toHaveLength(2);

    // Find and delete first one
    const firstId = idsBefore[0];
    await expect(firstId).not.toBeNull();

    await page.locator(`.br-highlight-box[data-highlight-id="${firstId}"]`).first().click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    const deleteSave = waitForHighlightsSave(page);
    await page.locator('#btnDeleteHighlight').click();
    await deleteSave;

    // Verify only the other stable ID remains.
    const secondId = idsBefore[1];
    const remainingIds = await page.locator('.br-highlight-box').evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.dataset.highlightId))
    ]);
    expect(remainingIds).toEqual([secondId]);
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    expect((await readHighlightState(page)).map((item) => item.id)).toEqual([secondId]);
  });

  test('highlights: export highlights to markdown with multiple chapters', async ({ page, context }) => {
    // Capture initial highlights count
    const initialHls = await readHighlightState(page);

    // Create two highlights in different chapters
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await firstSave;

    const firstBox = page.locator('.br-highlight-box').first();
    const firstId = await firstBox.getAttribute('data-highlight-id');
    await firstBox.click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await page.locator('#highlightEditorNote').fill('Export note');
    const noteSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await noteSave;

    await page.locator('#btnToc').click();
    const tocLinks = page.locator('#tocList a[data-target]');
    await expect(tocLinks).toHaveCount(3);
    await tocLinks.nth(1).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    await expect(page.locator('.br-highlight-box')).toHaveCount(0);
    await expect(tocLinks.nth(1)).toHaveAttribute('aria-current', 'location');
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
    await expect(page.locator('#readingProgress')).toContainText('2/3');
    await expect(selectArticleText(page, FIXTURE_TEXT.secondParagraph)).resolves.toBeTruthy();
    const secondSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await secondSave;
    const secondId = await page.locator('.br-highlight-box').first().getAttribute('data-highlight-id');
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);

    await page.locator('#btnToc').click();
    await tocLinks.nth(0).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 1');
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
    await expect(page.locator('.br-highlight-box')).toHaveAttribute('data-highlight-id', firstId);
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();

    await page.locator('#btnToc').click();
    await tocLinks.nth(1).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
    await expect(page.locator('.br-highlight-box')).toHaveAttribute('data-highlight-id', secondId);
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();

    const beforeExport = await readHighlightState(page);
    expect(beforeExport).toHaveLength(initialHls.length + 2);

    // Enable download capture
    // Click export button
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExportHighlights').click();
    const download = await downloadPromise;

    const savedFile = await download.path();
    const content = fs.readFileSync(savedFile, 'utf8');

    // Verify markdown includes book name, chapter text
    expect(content).toContain('《E2E EPUB》划线笔记');
    expect(content).toContain('作者：Playwright');
    expect(content).toContain('- ');
    expect(content).toContain(FIXTURE_TEXT.firstParagraph);
    expect(content).toContain(FIXTURE_TEXT.secondParagraph);
    expect(content).toContain('Export note');

    // Verify server state unchanged (no additional highlights created by export)
    const afterHls = await readHighlightState(page);
    expect(afterHls).toEqual(beforeExport);
    expect(afterHls.find((item) => item.id === firstId)?.note).toBe('Export note');

    await resetEpubFixtureState(page);
  });

  test('highlights: real mouse selection activates the toolbar highlight action', async ({ page }) => {
    const paragraph = page.locator('#article p').filter({ hasText: FIXTURE_TEXT.firstParagraph }).first();
    await expect(paragraph).toBeVisible();

    const selectionBounds = await paragraph.evaluate((element, target) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const offset = node.nodeValue.indexOf(target);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + target.length);
        const rect = range.getBoundingClientRect();
        return { startX: rect.left + 2, endX: rect.right - 2, y: rect.top + rect.height / 2 };
      }
      return null;
    }, FIXTURE_TEXT.firstParagraph);
    expect(selectionBounds).not.toBeNull();

    await page.mouse.move(selectionBounds.startX, selectionBounds.y);
    await page.mouse.down();
    await page.mouse.move(selectionBounds.endX, selectionBounds.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.highlight-pill')).toBeVisible();

    const save = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await save;
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
  });

  test('highlights: pointer selection without mouseup still exposes the action', async ({ page }) => {
    const selected = await page.evaluate((target) => {
      const article = document.querySelector('#article');
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const offset = node.nodeValue.indexOf(target);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + target.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        article.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
        return true;
      }
      return false;
    }, FIXTURE_TEXT.firstParagraph);
    expect(selected).toBeTruthy();
    await expect(page.locator('.highlight-pill')).toBeVisible();

    const save = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await save;
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
  });

  test('highlights: marker stays on the visible later spread in double-page mode', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = page.waitForResponse((response) =>
      response.url().endsWith('/api/settings')
        && response.request().method() === 'PUT'
        && response.ok()
    );
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#article')).toHaveAttribute('data-pagination-track', /groups=/);

    for (let i = 0; i < 3; i += 1) {
      const next = page.locator('#btnNextPage');
      await expect(next).toBeEnabled();
      await next.click();
    }

    const selectedBounds = await page.evaluate((target) => {
      const article = document.querySelector('#article');
      const articleRect = article.getBoundingClientRect();
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        let offset = node.nodeValue.indexOf(target);
        while (offset >= 0) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + target.length);
          const rect = range.getBoundingClientRect();
          const visible = rect.right > articleRect.left
            && rect.left < articleRect.right
            && rect.bottom > articleRect.top
            && rect.top < articleRect.bottom;
          if (visible) {
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            article.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          }
          offset = node.nodeValue.indexOf(target, offset + target.length);
        }
      }
      return null;
    }, FIXTURE_TEXT.repeatedPhrase);
    expect(selectedBounds).not.toBeNull();

    const save = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await save;
    const visibleMarker = await page.evaluate(() => {
      const article = document.querySelector('#article').getBoundingClientRect();
      return [...document.querySelectorAll('.br-highlight-box')].some((box) => {
        const rect = box.getBoundingClientRect();
        return rect.right > article.left
          && rect.left < article.right
          && rect.bottom > article.top
          && rect.top < article.bottom;
      });
    });
    expect(visibleMarker).toBe(true);
  });
});
