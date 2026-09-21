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

  test('highlights: add/modify thought, persist through reload', async ({ page }) => {
    // Create first highlight
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#btnHighlight').click();
    await firstSave;

    // Edit thought
    const highlightBox = page.locator('.br-highlight-box').first();
    await highlightBox.click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await expect(page.locator('#highlightEditorTitle')).toHaveText('编辑批注');
    await page.locator('#highlightEditorThought').fill('This is a new thought for testing.');
    const originalId = await highlightBox.getAttribute('data-highlight-id');
    const thoughtSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await thoughtSave;

    // Verify thought persisted through reload
    await page.reload({ waitUntil: 'load' });
    await openEpubFixture(page);
    const hls = await readHighlightState(page);
    const thoughtsMatch = hls.find(h => h.thought === 'This is a new thought for testing.');
    expect(thoughtsMatch).toBeDefined();
    expect(thoughtsMatch.id).toBe(originalId);
  });

  test('thought composer creates a thought without a visual mark', async ({ page }) => {
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    await page.locator('#selectionMenu [data-selection-action="thought"]').click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await expect(page.locator('#highlightEditorTitle')).toHaveText('写想法');
    await page.locator('#highlightEditorThought').fill('This is a standalone thought.');
    const save = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await save;

    const thoughts = await readHighlightState(page);
    expect(thoughts).toContainEqual(expect.objectContaining({
      kind: 'thought',
      style: 'none',
      thought: 'This is a standalone thought.'
    }));
    await expect(page.locator('.br-highlight-box')).toHaveCount(0);
  });

  test('cancelling thought composer does not create a record', async ({ page }) => {
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    await page.locator('#selectionMenu [data-selection-action="thought"]').click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await page.locator('#btnCloseHighlightEditor').click();
    await expect(page.locator('#highlightEditor')).toBeHidden();
    expect(await readHighlightState(page)).toEqual([]);
  });

  test('notes panel lists the book annotations and filters thoughts', async ({ page }) => {
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const highlightSave = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await highlightSave;

    await page.locator('.br-highlight-box').first().click();
    await page.locator('#highlightEditorThought').fill('A thought visible in the notes panel.');
    const thoughtSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await thoughtSave;

    await page.locator('#btnNotes').click();
    await expect(page.locator('#readerPanelNotes')).toBeVisible();
    await expect(page.locator('#readerDrawerTitle')).toHaveText('标记与想法');
    await expect(page.locator('#notesPanelSummary')).toHaveText('1 条标记 · 1 条想法');
    await expect(page.locator('#notesList [data-annotation-id]')).toHaveCount(1);

    const notesToolbarLayout = await page.evaluate(() => {
      const filters = document.querySelector('.notes-panel-filters');
      const sortField = document.querySelector('.notes-panel-sort');
      const sortLabel = sortField?.querySelector(':scope > span');
      const sortControl = sortField?.querySelector('select');
      const filterButton = filters?.querySelector('button');
      const thoughtButton = filters?.querySelector('[data-notes-filter="thought"]');
      const sortOption = sortControl?.querySelector('option');
      const filterRect = filters?.getBoundingClientRect();
      const sortRect = sortField?.getBoundingClientRect();
      const controlRect = sortControl?.getBoundingClientRect();
      const filterStyle = filterButton ? getComputedStyle(filterButton) : null;
      const thoughtStyle = thoughtButton ? getComputedStyle(thoughtButton) : null;
      const sortStyle = sortControl ? getComputedStyle(sortControl) : null;
      const optionStyle = sortOption ? getComputedStyle(sortOption) : null;
      const labelStyle = sortLabel ? getComputedStyle(sortLabel) : null;
      return {
        filterTop: filterRect?.top,
        filterHeight: filterRect?.height,
        sortTop: sortRect?.top,
        sortHeight: sortRect?.height,
        controlHeight: controlRect?.height,
        thoughtColor: thoughtStyle?.color,
        sortColor: sortStyle?.color,
        sortOptionColor: optionStyle?.color,
        filterFontSize: filterStyle?.fontSize,
        sortFontSize: sortStyle?.fontSize,
        sortOptionFontSize: optionStyle?.fontSize,
        labelPosition: labelStyle?.position,
        labelClip: labelStyle?.clip
      };
    });
    expect(notesToolbarLayout.sortTop).toBeCloseTo(notesToolbarLayout.filterTop, 0);
    expect(notesToolbarLayout.filterHeight).toBeCloseTo(36, 0);
    expect(notesToolbarLayout.sortHeight).toBeCloseTo(36, 0);
    expect(notesToolbarLayout.controlHeight).toBeCloseTo(36, 0);
    expect(notesToolbarLayout.sortColor).toBe(notesToolbarLayout.thoughtColor);
    expect(notesToolbarLayout.sortOptionColor).toBe(notesToolbarLayout.thoughtColor);
    expect(notesToolbarLayout.filterFontSize).toBe('11px');
    expect(notesToolbarLayout.sortFontSize).toBe(notesToolbarLayout.filterFontSize);
    expect(notesToolbarLayout.sortOptionFontSize).toBe(notesToolbarLayout.filterFontSize);
    expect(notesToolbarLayout.labelPosition).toBe('absolute');
    expect(notesToolbarLayout.labelClip).toBe('rect(0px, 0px, 0px, 0px)');

    await page.locator('[data-notes-filter="thought"]').click();
    await expect(page.locator('#notesList [data-annotation-id]')).toHaveCount(1);
    await expect(page.locator('#notesList')).toContainText('A thought visible in the notes panel.');
    await page.locator('[data-notes-filter="marker"]').click();
    await expect(page.locator('#notesList [data-annotation-id]')).toHaveCount(1);
  });

  test('notes panel jumps to a later chapter without flashing a focus border', async ({ page }) => {
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await firstSave;

    await page.locator('#btnToc').click();
    const tocLinks = page.locator('#tocList a[data-target]');
    await expect(tocLinks).toHaveCount(3);
    await tocLinks.nth(1).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    await page.locator('#btnCloseSettings').click();

    await expect(selectArticleText(page, FIXTURE_TEXT.secondParagraph)).resolves.toBeTruthy();
    const secondSave = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await secondSave;

    await page.locator('#btnToc').click();
    await tocLinks.nth(0).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 1');
    await page.locator('#btnCloseSettings').click();

    await page.locator('#btnNotes').click();
    const laterRow = page.locator('#notesList [data-annotation-id]').filter({ hasText: FIXTURE_TEXT.secondParagraph });
    await expect(laterRow).toHaveCount(1);
    await laterRow.click();

    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    expect(await page.locator('.annotation-focus-flash').count()).toBe(0);
  });

  test('notes panel jumps to a later chapter after pagination settles in double-page mode', async ({ page }) => {
    await page.locator('#btnSettings').click();
    const settingsSave = page.waitForResponse((response) =>
      response.url().endsWith('/api/settings')
        && response.request().method() === 'PUT'
        && response.ok()
    );
    await page.locator('#settingReadingMode').selectOption('double');
    await settingsSave;
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('body')).toHaveClass(/double-page-reading/);

    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const firstSave = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await firstSave;

    await page.locator('#btnToc').click();
    const tocLinks = page.locator('#tocList a[data-target]');
    await expect(tocLinks).toHaveCount(3);
    await tocLinks.nth(1).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    await page.locator('#btnCloseSettings').click();

    await expect(selectArticleText(page, FIXTURE_TEXT.secondParagraph)).resolves.toBeTruthy();
    const secondSave = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await secondSave;

    await page.locator('#btnToc').click();
    await tocLinks.nth(0).click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 1');
    await page.locator('#btnCloseSettings').click();

    await page.locator('#btnNotes').click();
    const laterRow = page.locator('#notesList [data-annotation-id]').filter({ hasText: FIXTURE_TEXT.secondParagraph });
    await laterRow.click();
    await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
    expect(await page.locator('.annotation-focus-flash').count()).toBe(0);
  });

  test('notes panel edits and deletes an annotation through row actions', async ({ page }) => {
    await expect(selectArticleText(page, FIXTURE_TEXT.firstParagraph)).resolves.toBeTruthy();
    const save = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await save;

    await page.locator('#btnNotes').click();
    const row = page.locator('#notesList [data-annotation-id]').first();
    await expect(row.locator('[data-notes-action="edit"]')).toHaveCount(1);
    await row.locator('[data-notes-action="edit"]').click();
    await expect(page.locator('#highlightEditor')).toBeVisible();
    await page.locator('#highlightEditorThought').fill('从侧栏编辑的想法');
    const editSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await editSave;
    await expect(row).toContainText('从侧栏编辑的想法');

    const deleteSave = waitForHighlightsSave(page);
    await row.locator('[data-notes-action="delete"]').click();
    await deleteSave;
    await expect(page.locator('#notesList [data-annotation-id]')).toHaveCount(0);
    await expect(page.locator('#notesPanelSummary')).toHaveText('0 条标记 · 0 条想法');
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
    await page.locator('#highlightEditorThought').fill('Export thought');
    const thoughtSave = waitForHighlightsSave(page);
    await page.locator('#btnSaveHighlight').click();
    await thoughtSave;

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
    expect(content).toContain('《E2E EPUB》标记与想法');
    expect(content).toContain('作者：Playwright');
    expect(content).toContain('- ');
    expect(content).toContain('## 第一章');
    expect(content).toContain('## 第二章');
    expect(content).toContain(FIXTURE_TEXT.firstParagraph);
    expect(content).toContain(FIXTURE_TEXT.secondParagraph);
    expect(content).toMatch(new RegExp(`> \\[\\d{4}-\\d{2}-\\d{2}\\] ${FIXTURE_TEXT.firstParagraph}`));
    expect(content).toContain('Export thought');
    expect(content).toContain('想法：Export thought');
    expect(content).not.toContain('> 想法：Export thought');

    // Verify server state unchanged (no additional highlights created by export)
    const afterHls = await readHighlightState(page);
    expect(afterHls).toEqual(beforeExport);
    expect(afterHls.find((item) => item.id === firstId)?.thought).toBe('Export thought');

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
    await expect(page.locator('#selectionMenu')).toBeVisible();

    const save = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
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
    await expect(page.locator('#selectionMenu')).toBeVisible();

    const save = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="marker"]').click();
    await save;
    await expect(page.locator('.br-highlight-box')).toHaveCount(1);
  });

test('highlights: wave underline stays aligned with the selected text line', async ({ page }) => {
    await selectArticleText(page, FIXTURE_TEXT.firstParagraph);
    const rangeRects = await page.evaluate(() => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return [];
      return [...selection.getRangeAt(0).getClientRects()].map((rect) => ({
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right
      }));
    });
    const save = waitForHighlightsSave(page);
    await page.locator('#selectionMenu [data-selection-action="wave"]').click();
    await save;
    const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-annotation-style="wave"]')].map((box) => {
      const boxRect = box.getBoundingClientRect();
      const svg = box.querySelector('.br-highlight-wave');
      const svgRect = svg?.getBoundingClientRect();
      return {
        box: { top: boxRect.top, bottom: boxRect.bottom, height: boxRect.height },
        svg: svgRect ? { top: svgRect.top, bottom: svgRect.bottom, height: svgRect.height } : null,
        cssBottom: svg ? getComputedStyle(svg).bottom : null,
        cssTop: svg ? getComputedStyle(svg).top : null,
        boxPosition: getComputedStyle(box).position,
        svgPosition: svg ? getComputedStyle(svg).position : null,
        offsetParent: svg?.offsetParent?.className || null
      };
    }));
    expect(boxes).toHaveLength(rangeRects.length);
    for (const item of boxes) {
      expect(Math.abs(item.svg.bottom - item.box.bottom)).toBeLessThanOrEqual(2);
    }
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
