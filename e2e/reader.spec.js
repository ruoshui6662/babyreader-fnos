'use strict';

const { test, expect } = require('@playwright/test');
const { resetEpubFixtureState, resetReaderSettings } = require('./helpers/reader');

const APP_PATH = '/app/babyreader-fnos/';

async function openFixtureBook(page) {
  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const book = page.locator('.library-book').filter({ hasText: 'E2E Markdown' });
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.locator('#fileName')).toHaveText('E2E Markdown');
  await expect(page.locator('#article')).toContainText('E2E Reader');
}

async function openEpubFixture(page) {
  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const book = page.locator('.library-book').filter({ hasText: 'E2E EPUB' });
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.locator('#fileName')).toHaveText('E2E EPUB');
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter');
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
});

test('loads split UI modules in Chromium and opens a real library book', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await openFixtureBook(page);

  const loadedScripts = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.endsWith('.js'))
  );

  for (const modulePath of [
    '/app/babyreader-fnos/core/state.js',
    '/app/babyreader-fnos/core/utils.js',
    '/app/babyreader-fnos/core/api.js',
    '/app/babyreader-fnos/core/user-state.js',
    '/app/babyreader-fnos/reader/device-profile.js',
    '/app/babyreader-fnos/reader/epub.js',
    '/app/babyreader-fnos/reader/document.js',
    '/app/babyreader-fnos/reader/editor.js',
    '/app/babyreader-fnos/reader/highlights.js',
    '/app/babyreader-fnos/reader/ai.js',
    '/app/babyreader-fnos/reader/actions.js',
    '/app/babyreader-fnos/reader/progress.js',
    '/app/babyreader-fnos/reader/bookmarks.js',
    '/app/babyreader-fnos/reader/pagination.js',
    '/app/babyreader-fnos/reader/settings.js',
    '/app/babyreader-fnos/reader/navigation.js',
    '/app/babyreader-fnos/reader/lifecycle.js',
    '/app/babyreader-fnos/shell/drawer.js',
    '/app/babyreader-fnos/library/view.js',
    '/app/babyreader-fnos/app.js'
  ]) {
    expect(loadedScripts).toContain(modulePath);
  }

  await expect(page.locator('script[src*="reader/settings.js?v=29"]')).toHaveCount(1);
  await expect(page.locator('script[src*="reader/highlights.js?v=31"]')).toHaveCount(1);
  await expect(page.locator('script[src*="reader/ai.js?v=1"]')).toHaveCount(1);
  await expect(page.locator('script[src*="shell/drawer.js?v=31"]')).toHaveCount(1);

  expect(pageErrors).toEqual([]);
});

test('library and welcome states expose the dense library structure', async ({ page }) => {
  await page.goto(APP_PATH);

  await expect(page.locator('.library-heading h1')).toHaveText('书库');
  await expect(page.locator('.library-summary')).toContainText('本可阅读内容');
  await expect(page.locator('.library-scan-button')).toHaveText('重新扫描');
  await expect(page.locator('.library-book').first()).toHaveCSS('border-radius', '0px');
  await expect(page.locator('.library-book').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.library-book-cover').first()).toBeVisible();
  const appShell = await (await page.request.get(APP_PATH)).text();
  expect(appShell).toContain('class="welcome-mark"');
  expect(appShell).toContain('把书放进书库目录，即可从这里开始阅读。');

  await page.evaluate(() => renderLibrary({ books: [] }));
  await expect(page.locator('.library-empty')).toBeVisible();
  await expect(page.locator('.library-empty-title')).toHaveText('书库还是空的');
  await expect(page.locator('.library-empty-copy')).toContainText('授权书库目录');
});

test('wide library uses a six-column compact shelf with small summary text', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP_PATH);

  await expect(page.locator('body')).toHaveClass(/is-library/);
  await expect(page.locator('.library-summary')).toHaveCSS('font-size', '12px');
  await expect(page.locator('#article')).toHaveCSS('max-width', 'none');

  const columns = await page.locator('.library-grid').evaluate((grid) =>
    getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length
  );
  expect(columns).toBe(6);
});

test('wide library keeps compact left-aligned WeChat-style cover slots', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP_PATH);

  await expect(page.locator('.library-grid')).toHaveCSS('justify-content', 'start');
  await expect(page.locator('.library-book').first()).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.library-book-cover').first()).toHaveCSS('width', '152px');
});

test('WeChat-style library uses small metadata and still opens a selected book', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(APP_PATH);

  await expect(page.locator('.library-book strong').first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('.library-book span').first()).toHaveCSS('font-size', '12px');

  await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
  await expect(page.locator('#fileName')).toHaveText('E2E Markdown');
});

test('switching EPUB to continuous scroll mounts chapter HTML instead of object text', async ({ page }) => {
  await page.evaluate(async () => {
    const response = await fetch('/app/babyreader-fnos/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readingMode: 'double', continuousScroll: false })
    });
    if (!response.ok) throw new Error(`Settings setup failed: ${response.status}`);
  });
  await page.reload({ waitUntil: 'load' });
  await openEpubFixture(page);

  await page.locator('#btnSettings').click();
  const scrollSave = page.waitForResponse((response) =>
    response.url().endsWith('/api/settings') && response.request().method() === 'PUT' && response.ok()
  );
  await page.locator('#settingReadingMode').selectOption('scroll');
  await scrollSave;
  await page.locator('#btnCloseSettings').click();

  await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
  await expect(page.locator('#article')).not.toContainText('[object Object]');
});

test('EPUB continuous and paged modes keep the same reading surface color', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }

  for (const theme of ['dark', 'light', 'sepia']) {
    await page.evaluate((nextTheme) => {
      applyTheme(nextTheme, false);
      setReadingMode('scroll', { persist: false, preserveLocator: false });
    }, theme);
    await expect(page.locator('body')).toHaveClass(/continuous-scroll/);
    const continuousColor = await page.locator('#article').evaluate((element) => getComputedStyle(element).backgroundColor);

    await page.evaluate(() => setReadingMode('double', { persist: false, preserveLocator: false }));
    await expect(page.locator('body')).toHaveClass(/double-page-reading/);
    const pagedColor = await page.locator('#article').evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(pagedColor, `theme ${theme} should keep one reading surface`).toBe(continuousColor);
  }
});

test('continuous scroll chapter boundary renders dedicated previous and next controls', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }

  await expect(page.locator('body')).toHaveClass(/continuous-scroll/);
  await expect(page.locator('#scrollChapterHeader')).toBeVisible();
  await expect(page.locator('#btnScrollPreviousChapter')).toBeHidden();
  await expect(page.locator('#scrollChapterFooter')).toBeVisible();
  await expect(page.locator('#btnScrollNextChapter')).toBeVisible();
  await expect(page.locator('.topbar-right .chapter-nav-btn')).toHaveCount(2);
  await expect(page.locator('.topbar-right .chapter-nav-btn').first()).toBeHidden();
  await expect(page.locator('.topbar-right .chapter-nav-btn').last()).toBeHidden();

  await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
  await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', /chapter1\.xhtml/);
  await page.locator('#btnScrollNextChapter').click();
  await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
  await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', /chapter2\.xhtml/);
  await expect(page.locator('#btnScrollPreviousChapter')).toBeVisible();

  const boundaryGeometry = await page.evaluate(() => {
    const frame = document.querySelector('#scrollChapterFrame').getBoundingClientRect();
    const article = document.querySelector('#article').getBoundingClientRect();
    const previous = document.querySelector('#btnScrollPreviousChapter').getBoundingClientRect();
    const next = document.querySelector('#btnScrollNextChapter').getBoundingClientRect();
    const previousStyle = getComputedStyle(document.querySelector('#btnScrollPreviousChapter'));
    const nextStyle = getComputedStyle(document.querySelector('#btnScrollNextChapter'));
    return {
      frame,
      article,
      previous,
      next,
      previousLeftInset: previous.left - frame.left,
      nextRightInset: frame.right - next.right,
      previousStyle: {
        width: previousStyle.width,
        height: previousStyle.height,
        backgroundColor: previousStyle.backgroundColor,
        borderColor: previousStyle.borderColor,
        borderRadius: previousStyle.borderRadius,
        padding: previousStyle.padding
      },
      nextStyle: {
        width: nextStyle.width,
        height: nextStyle.height,
        backgroundColor: nextStyle.backgroundColor,
        borderColor: nextStyle.borderColor,
        borderRadius: nextStyle.borderRadius,
        padding: nextStyle.padding
      }
    };
  });
  expect(boundaryGeometry.previousLeftInset).toBeGreaterThanOrEqual(0);
  expect(boundaryGeometry.previousLeftInset).toBeLessThanOrEqual(120);
  expect(boundaryGeometry.previous.top).toBeGreaterThanOrEqual(boundaryGeometry.frame.top);
  expect(boundaryGeometry.previous.bottom).toBeLessThanOrEqual(boundaryGeometry.frame.top + 120);
  expect(boundaryGeometry.nextRightInset).toBeGreaterThanOrEqual(0);
  expect(boundaryGeometry.nextRightInset).toBeLessThanOrEqual(120);
  expect(boundaryGeometry.next.bottom).toBeLessThanOrEqual(boundaryGeometry.frame.bottom);
  expect(boundaryGeometry.next.top).toBeGreaterThanOrEqual(boundaryGeometry.frame.bottom - 120);
  expect(boundaryGeometry.article.left).toBeGreaterThanOrEqual(boundaryGeometry.frame.left);
  expect(boundaryGeometry.article.right).toBeLessThanOrEqual(boundaryGeometry.frame.right);
  expect(boundaryGeometry.previousStyle).toEqual(boundaryGeometry.nextStyle);

  await page.locator('#btnScrollPreviousChapter').click();
  await expect(page.locator('#article .epub-chapter')).toHaveCount(1);
  await expect(page.locator('#article .epub-chapter')).toHaveAttribute('data-source-path', /chapter1\.xhtml/);
});

test('sepia reader uses the same white surface as the library', async ({ page }) => {
  await openEpubFixture(page);
  await page.locator('#btnSettings').click();
  await page.locator('#settingTheme').selectOption('sepia');
  await page.locator('#btnCloseSettings').click();

  const readerSurface = await page.locator('#article').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(readerSurface).toBe('rgb(255, 255, 255)');

  await page.locator('#btnBackToLibrary').click();
  const librarySurface = await page.locator('#article').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(librarySurface).toBe(readerSurface);
});

test('reader navigation and floating toolbar controls keep 44px icon targets', async ({ page }) => {
  await openEpubFixture(page);

  for (const id of [
    'btnBackToLibrary',
    'btnPreviousChapter',
    'btnPreviousPage',
    'btnNextPage',
    'btnNextChapter',
    'btnToc',
    'btnHighlight',
    'btnExportHighlights',
    'btnTheme',
    'btnSettings'
  ]) {
    await expect(page.locator(`#${id}`)).toHaveCSS('width', '44px');
  }
});

test('reader controls use grouped Apple-style icon geometry', async ({ page }) => {
  await openEpubFixture(page);

  await expect(page.locator('.reader-toolbar-divider')).toHaveCount(3);

  const chapterIcons = await page.locator('#btnPreviousChapter svg, #btnNextChapter svg').evaluateAll((icons) =>
    icons.map((icon) => ({
      name: icon.dataset.icon,
      linecap: icon.getAttribute('stroke-linecap'),
      linejoin: icon.getAttribute('stroke-linejoin'),
      paths: icon.querySelectorAll('path').length
    }))
  );
  expect(chapterIcons).toEqual([
    { name: 'chapter-previous', linecap: 'round', linejoin: 'round', paths: 2 },
    { name: 'chapter-next', linecap: 'round', linejoin: 'round', paths: 2 }
  ]);

  const toolbarIcons = await page.locator('#readerFloatingToolbar button svg').evaluateAll((icons) =>
    icons.map((icon) => ({
      name: icon.dataset.icon,
      linecap: icon.getAttribute('stroke-linecap'),
      linejoin: icon.getAttribute('stroke-linejoin'),
      strokeWidth: icon.getAttribute('stroke-width')
    }))
  );
  expect(toolbarIcons.map((icon) => icon.name)).toEqual([
    'toc', 'highlight', 'export', 'search', 'bookmark', 'note', 'ai', 'theme', 'settings'
  ]);
  expect(toolbarIcons.every((icon) =>
    icon.linecap === 'round' && icon.linejoin === 'round' && icon.strokeWidth === '1.8'
  )).toBe(true);
});

test('double-page navigation places previous and next controls at the lower corners', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }
  await expect(page.locator('#readerDrawer')).toBeHidden();
  await page.locator('#btnSettings').click();

  const save = page.waitForResponse((response) =>
    response.url().endsWith('/api/settings') &&
    response.request().method() === 'PUT' &&
    response.ok()
  );
  await page.locator('#settingReadingMode').selectOption('double');
  await save;
  await page.locator('#btnCloseSettings').click();

  await expect(page.locator('body')).toHaveClass(/double-page-reading/);
  const previous = page.locator('#btnPreviousPage');
  const next = page.locator('#btnNextPage');
  await expect(previous).toHaveCSS('position', 'absolute');
  await expect(next).toHaveCSS('position', 'absolute');
  await expect(previous).toHaveCSS('width', '80px');
  await expect(previous).toHaveCSS('height', '40px');
  await expect(next).toHaveCSS('width', '80px');
  await expect(next).toHaveCSS('height', '40px');
  await expect(previous).not.toHaveCSS('left', 'auto');
  await expect(next).not.toHaveCSS('right', 'auto');

  const bounds = await Promise.all([
    previous.boundingBox(),
    next.boundingBox()
  ]);
  const paper = await page.locator('#article').boundingBox();
  expect(bounds[0]).not.toBeNull();
  expect(bounds[1]).not.toBeNull();
  expect(paper).not.toBeNull();
  expect(Math.abs(bounds[0].y - bounds[1].y)).toBeLessThanOrEqual(1);
  expect(bounds[0].x).toBeLessThan(bounds[1].x);
  expect(bounds[0].y).toBeGreaterThan(page.viewportSize().height - 140);
  expect(bounds[1].y).toBeGreaterThan(page.viewportSize().height - 140);
  expect(bounds[0].x).toBeGreaterThanOrEqual(paper.x + 16);
  expect(bounds[1].x + bounds[1].width).toBeLessThanOrEqual(paper.x + paper.width - 16);
  expect(bounds[0].y + bounds[0].height).toBeLessThanOrEqual(paper.y + paper.height - 16);
});

test('last page group stays aligned when chapter navigation reaches an odd final page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
  }
  await page.locator('#btnSettings').click();
  await page.locator('#settingReadingMode').selectOption('double');
  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('body')).toHaveClass(/double-page-reading/);

  const next = page.locator('#btnNextPage');
  for (let attempt = 0; attempt < 80 && !(await next.isDisabled()); attempt += 1) {
    await next.click();
    await page.waitForTimeout(90);
  }

  const metrics = await page.locator('#article').evaluate((article) => ({
    scrollLeft: article.scrollLeft,
    pageGroupWidth: Number(article.dataset.paginationStep || 0),
    pageCount: Number((article.dataset.paginationTrack || '').match(/cols=(\d+)/)?.[1] || 0),
    clientWidth: article.clientWidth,
    scrollWidth: article.scrollWidth
  }));

  expect(metrics.pageCount % 2).toBe(1);
  const lastPageGroup = Math.floor((metrics.pageCount - 1) / 2);
  expect(Math.abs(metrics.scrollLeft - lastPageGroup * metrics.pageGroupWidth)).toBeLessThanOrEqual(1);
  expect(metrics.scrollLeft + metrics.clientWidth).toBeLessThanOrEqual(metrics.scrollWidth + 1);
});

test('settings drawer changes theme and typography in a real browser', async ({ page }) => {
  await openFixtureBook(page);

  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
  await expect(page.locator('#settingsUser')).toContainText('Playwright User');

  await page.locator('#settingTheme').selectOption('sepia');
  await expect(page.locator('body')).toHaveClass(/theme-sepia/);

  await page.locator('#settingFontFamily').selectOption('songti');
  const settingsSaved = page.waitForResponse((response) =>
    response.url().endsWith('/api/settings')
      && response.request().method() === 'PUT'
      && response.ok()
  );
  await page.locator('#settingTextIndent').evaluate((element) => {
    element.value = '1.5';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settingsSaved;

  await expect(page.locator('html')).toHaveCSS(
    '--reader-font-family',
    /SimSun|STSong|Songti SC|宋体|serif/
  );
  await expect(page.locator('html')).toHaveCSS('--reader-text-indent', '1.5em');

  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#readerDrawer')).toBeHidden();

  await page.reload();
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  await page.locator('.library-book').filter({ hasText: 'E2E Markdown' }).click();
  await page.locator('#btnSettings').click();
  await expect(page.locator('#settingTheme')).toHaveValue('sepia');
  await expect(page.locator('#settingFontFamily')).toHaveValue('songti');
  await expect(page.locator('#settingTextIndent')).toHaveValue('1.5');
  await expect(page.locator('body')).toHaveClass(/theme-sepia/);
});

test('settings drawer presents grouped controls and a selected segmented tab', async ({ page }) => {
  await openFixtureBook(page);

  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
  await expect(page.locator('.settings-group')).toHaveCount(4);
  await expect(page.locator('.settings-group-card')).toHaveCount(4);
  await expect(page.locator('.settings-group-title').allTextContents()).resolves.toEqual([
    '外观', '阅读', '划线', '排版'
  ]);
  await expect(page.locator('#readerDrawer .reader-drawer-tabs [role="tab"]')).toHaveCount(3);
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
  await expect(page.locator('.reader-drawer-tabs')).toHaveCSS('border-radius', '999px');
  await expect(page.locator('.settings-group-card').first()).toHaveCSS('border-radius', '16px');
  await expect(page.locator('#settingTocOpen')).toHaveCSS('width', '44px');
  await expect(page.locator('#settingTocOpen')).toHaveCSS('height', '26px');
  await expect(page.locator('.settings-checkbox span')).toHaveText('默认展开目录');

  for (const id of ['settingTheme', 'settingFontFamily', 'settingReadingMode', 'settingHighlightColor']) {
    await expect(page.locator(`#${id}`)).toHaveCSS('border-radius', '10px');
    await expect(page.locator(`#${id}`)).toHaveCSS('width', '136px');
    await expect(page.locator(`#${id}`)).toHaveCSS('text-align', 'center');
    await expect(page.locator(`#${id}`)).toHaveCSS('text-align-last', 'center');
    await expect(page.locator(`#${id}`)).toHaveCSS('appearance', 'none');
  }
});

test('settings selects use a rounded custom menu that always opens below the trigger', async ({ page }) => {
  await openFixtureBook(page);

  await page.locator('#btnSettings').click();
  const trigger = page.locator('[data-custom-select-for="settingHighlightColor"] .custom-select-trigger');
  await expect(trigger).toBeVisible();

  await trigger.click();
  const menu = page.locator('#custom-options-settingHighlightColor');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('position', 'fixed');
  await expect(menu).toHaveCSS('border-radius', '12px');

  const openTriggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(openTriggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox.y).toBeGreaterThanOrEqual(openTriggerBox.y + openTriggerBox.height);
  await expect(menu.locator('[role="option"]')).toHaveCount(4);
  await expect(menu.locator('[role="option"]').first()).toHaveCSS('text-align', 'center');
  await expect(menu.locator('[role="option"]').first()).toHaveCSS('font-size', '14px');
});

test('custom select choices keep the native value and change event contract', async ({ page }) => {
  await openFixtureBook(page);

  await page.locator('#btnSettings').click();
  await page.locator('[data-custom-select-for="settingReadingMode"] .custom-select-trigger').click();
  await page.locator('#custom-options-settingReadingMode [role="option"][data-value="double"]').click();

  await expect(page.locator('#settingReadingMode')).toHaveValue('double');
  await expect(page.locator('[data-custom-select-for="settingReadingMode"] .custom-select-trigger'))
    .toHaveText('双页分页');
});

test('custom select menus stay hidden until a trigger is activated', async ({ page }) => {
  await page.goto(APP_PATH);
  await expect(page.locator('.custom-select-menu')).toHaveCount(5);
  await expect(page.locator('[data-custom-select-for="highlightEditorColor"]')).toHaveCount(0);
  await expect(page.locator('.custom-select-menu:not([hidden])')).toHaveCount(0);

  await openFixtureBook(page);
  await expect(page.locator('.custom-select-menu:not([hidden])')).toHaveCount(0);
  await expect(page.locator('#highlightEditor')).toBeHidden();
});

test('custom select menus never stack and close after choosing an option', async ({ page }) => {
  await openFixtureBook(page);
  await page.locator('#btnSettings').click();

  const visibleMenus = page.locator('.custom-select-menu:not([hidden])');
  await page.locator('[data-custom-select-for="settingTheme"] .custom-select-trigger').click();
  await expect(visibleMenus).toHaveCount(1);

  await page.locator('[data-custom-select-for="settingFontFamily"] .custom-select-trigger').click();
  await expect(visibleMenus).toHaveCount(1);

  await page.locator('#custom-options-settingFontFamily [role="option"][data-value="songti"]').click();
  await expect(visibleMenus).toHaveCount(0);

  await page.locator('[data-custom-select-for="settingHighlightColor"] .custom-select-trigger').click();
  await expect(visibleMenus).toHaveCount(1);
  await page.locator('#btnCloseSettings').click();
  await expect(visibleMenus).toHaveCount(0);
});

test('custom select closes before an expensive setting update begins', async ({ page }) => {
  await openFixtureBook(page);
  await page.locator('#btnSettings').click();

  await page.evaluate(() => {
    window.__selectOrder = [];
    const menu = document.getElementById('custom-options-settingReadingMode');
    const original = window.setReadingMode;
    window.setReadingMode = (...args) => {
      window.__selectOrder.push(menu.hidden ? 'setting-update-after-menu-closed' : 'setting-update-before-menu-closed');
      return original(...args);
    };
  });

  await page.locator('[data-custom-select-for="settingReadingMode"] .custom-select-trigger').click();
  await page.locator('#custom-options-settingReadingMode [role="option"][data-value="double"]').click();
  await expect.poll(() => page.evaluate(() => window.__selectOrder)).toEqual(['setting-update-after-menu-closed']);
});

test('highlight color change redraws highlights once after the setting is applied', async ({ page }) => {
  await openEpubFixture(page);
  await page.locator('#btnSettings').click();
  await page.evaluate(() => {
    window.__highlightRedrawCount = 0;
    const original = window.redrawDomHighlights;
    window.redrawDomHighlights = (...args) => {
      window.__highlightRedrawCount += 1;
      return original(...args);
    };
  });

  await page.locator('[data-custom-select-for="settingHighlightColor"] .custom-select-trigger').click();
  await page.locator('#custom-options-settingHighlightColor [role="option"][data-value="green"]').click();
  await page.waitForTimeout(160);
  await expect.poll(() => page.evaluate(() => window.__highlightRedrawCount)).toBe(1);
});

test('a hidden settings trigger cannot reopen its menu from the keyboard', async ({ page }) => {
  await openEpubFixture(page);
  await page.locator('#btnSettings').click();

  await page.evaluate(() => {
    const select = document.getElementById('settingHighlightColor');
    select._customSelect.trigger.focus();
    openReaderPanel('toc', document.getElementById('btnToc'));
  });
  await expect(page.locator('#readerPanelSettings')).toBeHidden();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#custom-options-settingHighlightColor')).toBeHidden();
});

test('switching drawer panels closes an open settings menu', async ({ page }) => {
  await openEpubFixture(page);
  await page.locator('#btnSettings').click();

  await page.locator('[data-custom-select-for="settingHighlightColor"] .custom-select-trigger').click();
  await expect(page.locator('#custom-options-settingHighlightColor')).toBeVisible();

  await page.evaluate(() => {
    openReaderPanel('toc', document.getElementById('btnToc'));
  });

  await expect(page.locator('#readerPanelSettings')).toBeHidden();
  await expect(page.locator('#custom-options-settingHighlightColor')).toBeHidden();
});

test('default directory preference opens the generic TOC panel for a book with a TOC', async ({ page }) => {
  await openEpubFixture(page);

  await expect(page.locator('#readerDrawer')).toBeVisible();
  await expect(page.locator('#readerPanelToc')).toBeVisible();
  await expect(page.locator('#readerPanelSettings')).toBeHidden();
  await expect(page.locator('#tocList a[data-target]')).toHaveCount(3);
});

test('TOC panel uses the same rounded material surface as settings', async ({ page }) => {
  await openEpubFixture(page);

  await expect(page.locator('#readerDrawer')).toBeVisible();
  await expect(page.locator('#readerPanelToc')).toBeVisible();
  await expect(page.locator('#readerPanelToc .toc')).toHaveCSS('border-radius', '16px');
  await expect(page.locator('#readerPanelToc .toc')).toHaveCSS('border-width', '1px');
  await expect(page.locator('#readerPanelToc .toc a').first()).toHaveCSS('border-radius', '10px');
  await expect(page.locator('#readerPanelToc .toc a').first()).toHaveCSS('padding-top', '9px');
});

test('EPUB TOC navigates between chapters and updates semantic reading state', async ({ page }) => {
  await openEpubFixture(page);

  await expect(page.locator('#readerDrawer')).toBeVisible();
  await expect(page.locator('#readerPanelToc')).toBeVisible();
  const tocLinks = page.locator('#tocList a[data-target]');
  await expect(tocLinks).toHaveCount(3);
  await expect(tocLinks.nth(1)).toHaveText('第二章');

  await tocLinks.nth(1).click();
  await expect(tocLinks.nth(1)).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('#readingProgress')).toContainText('2/3');
});

test('reader shell has unique IDs, reserved actions disabled, and restores Drawer focus', async ({ page }) => {
  await openFixtureBook(page);

  const duplicateIds = await page.evaluate(() => {
    const counts = new Map();
    for (const element of document.querySelectorAll('[id]')) {
      counts.set(element.id, (counts.get(element.id) || 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1);
  });
  expect(duplicateIds).toEqual([]);

  for (const selector of ['#btnSearch', '#btnBookmarks', '#btnNotes', '#btnAi']) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  await expect(page.locator('#btnBookmarks')).not.toHaveAttribute('data-reader-status', 'reserved');

  const settingsButton = page.locator('#btnSettings');
  await settingsButton.focus();
  await settingsButton.click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#readerSettingsSheet')).toBeHidden();
  await expect(settingsButton).toBeFocused();
});

test('selected text opens book-grounded AI panel and sends bounded retrieval context', async ({ page }) => {
  await openEpubFixture(page);
  let askPayload = null;
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'test-model', retrieval: 'local-lexical-rag' })
    });
  });
  await page.route('**/app/babyreader-fnos/api/books/*/ai/ask/stream', async (route) => {
    askPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: meta',
        'data: {"sources":[{"chapterIndex":0,"chapterHref":"OEBPS/chapter1.xhtml","chapterLabel":"⑦ 第一章"},{"chapterIndex":1,"chapterHref":"OEBPS/chapter2.xhtml","chapterLabel":"⑧ 第二章"}]}',
        '',
        'event: delta',
        'data: {"delta":"这段内容说明了本章的 **核心观点**【1】。\\n\\n- 依据一\\n- 依据二\\n\\n<script>不应执行</script>"}',
        '',
        'event: done',
        'data: {"answer":"这段内容说明了本章的 **核心观点**【1】。\\n\\n- 依据一\\n- 依据二\\n\\n<script>不应执行</script>","sources":[{"chapterIndex":0,"chapterHref":"OEBPS/chapter1.xhtml","chapterLabel":"⑦ 第一章"},{"chapterIndex":1,"chapterHref":"OEBPS/chapter2.xhtml","chapterLabel":"⑧ 第二章"}]}',
        ''
      ].join('\n')
    });
  });

  const selected = await require('./helpers/reader').selectArticleText(page, 'E2E EPUB Chapter 1');
  expect(selected).toBe(true);
  await expect(page.locator('#selectionMenu')).toBeVisible();
  await page.locator('#selectionMenu [data-selection-action="ai"]').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await expect(page.locator('#aiSelectedText')).toContainText('E2E EPUB Chapter 1');
  await page.locator('#aiQuestion').fill('这一段的核心观点是什么？');
  await page.locator('#btnAiAsk').click();
  await expect(page.locator('#aiAnswer')).toContainText('这段内容说明了本章的');
  await expect(page.locator('#aiAnswer strong')).toContainText('核心观点');
  await expect(page.locator('#aiAnswer li')).toHaveCount(2);
  await expect(page.locator('#aiAnswer script')).toHaveCount(0);
  await expect(page.locator('#aiSources')).toContainText('第一章');
  await expect(page.locator('#aiAnswer [data-ai-citation="1"]')).toHaveText('①');
  await expect(page.locator('#aiSources .ai-source')).toHaveCount(1);
  await expect(page.locator('#aiSources')).not.toContainText('第二章');
  await expect(page.locator('#aiSources')).not.toContainText('⑦');
  const sourceIndexStyle = await page.locator('#aiSources .ai-source-index').evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { fontSize: style.fontSize, width: rect.width, height: rect.height };
  });
  expect(sourceIndexStyle.fontSize).toBe('9px');
  expect(sourceIndexStyle.width).toBe(16);
  expect(sourceIndexStyle.height).toBe(16);
  expect(askPayload).toEqual(expect.objectContaining({ question: '这一段的核心观点是什么？' }));
  expect(Array.isArray(askPayload.context)).toBe(true);
  expect(askPayload.context.length).toBeLessThanOrEqual(6);
  expect(askPayload.context.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(7200);
});

test('AI panel keeps a temporary multi-turn transcript and sends completed history', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'test-model', retrieval: 'local-lexical-rag' })
    });
  });
  const payloads = [];
  await page.route('**/app/babyreader-fnos/api/books/*/ai/ask/stream', async (route) => {
    payloads.push(route.request().postDataJSON());
    const answer = payloads.length === 1 ? '第一轮回答' : '第二轮回答';
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: delta',
        `data: {"delta":"${answer}"}`,
        '',
        'event: done',
        `data: {"answer":"${answer}","sources":[]}`,
        ''
      ].join('\n')
    });
  });

  await page.locator('#btnAi').click();
  await page.locator('#aiQuestion').fill('第一轮问题');
  await page.locator('#btnAiAsk').click();
  await expect(page.locator('#aiAnswer')).toContainText('第一轮回答');

  await page.locator('#aiQuestion').fill('第二轮问题');
  await page.locator('#btnAiAsk').click();
  await expect(page.locator('.ai-message-assistant').nth(1)).toContainText('第二轮回答');
  await expect(page.locator('.ai-message-user')).toHaveCount(2);
  expect(payloads).toHaveLength(2);
  expect(payloads[1].history).toEqual([
    { role: 'user', content: '第一轮问题' },
    { role: 'assistant', content: '第一轮回答' }
  ]);
});

test('AI streaming exposes a stop state and cancels the active request', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'test-model', retrieval: 'local-lexical-rag' })
    });
  });
  let releaseStream;
  const streamGate = new Promise((resolve) => { releaseStream = resolve; });
  await page.route('**/app/babyreader-fnos/api/books/*/ai/ask/stream', async (route) => {
    await streamGate;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'event: done\ndata: {"answer":"不应在停止后显示","sources":[]}\n\n'
    });
  });

  await page.locator('#btnAi').click();
  await page.locator('#aiQuestion').fill('停止测试');
  await page.locator('#btnAiAsk').click();
  await expect(page.locator('#btnAiAsk')).toHaveAttribute('aria-label', '停止回答');
  const stopGlyph = await page.locator('#btnAiAsk .ai-stop-glyph').evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { display: style.display, width: rect.width, height: rect.height };
  });
  expect(stopGlyph.display).toBe('block');
  expect(stopGlyph.width).toBeGreaterThanOrEqual(8);
  expect(stopGlyph.height).toBeGreaterThanOrEqual(8);
  await page.locator('#btnAiAsk').click();
  await expect(page.locator('#btnAiAsk')).toHaveAttribute('aria-label', '发送问题');
  await expect(page.locator('#aiStatus')).toContainText('回答已停止');
  releaseStream();
});

test('direct AI opening hides the selection hint and fills common questions into the composer', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'test-model', retrieval: 'local-lexical-rag' })
    });
  });

  await page.locator('#btnAi').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await expect(page.locator('#aiSelectedText')).toBeHidden();
  await expect(page.locator('.ai-suggested-title')).toContainText('常用问题');

  const commonQuestion = page.locator('[data-ai-prompt="本章主要讲了什么？"]');
  await expect(commonQuestion).toBeVisible();
  await commonQuestion.click();
  await expect(page.locator('#aiQuestion')).toHaveValue('本章主要讲了什么？');
  await expect(page.locator('#aiQuestion')).toBeFocused();

  const focusStyle = await page.locator('#aiQuestion').evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, borderColor: style.borderColor, boxShadow: style.boxShadow };
  });
  expect(focusStyle.outlineStyle).toBe('none');
  expect(focusStyle.borderColor).toBe('rgb(184, 184, 194)');
  expect(focusStyle.boxShadow).toContain('rgba(10, 132, 255, 0.16)');
});

test('AI composer sends on Enter, keeps Shift+Enter for newline, and uses an SVG send icon', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
  let askCount = 0;
  let releaseAsk;
  const askGate = new Promise((resolve) => { releaseAsk = resolve; });
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'test-model', retrieval: 'local-lexical-rag' })
    });
  });
  await page.route('**/app/babyreader-fnos/api/books/*/ai/ask/stream', async (route) => {
    askCount += 1;
    await askGate;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: delta',
        'data: {"delta":"已发送。"}',
        '',
        'event: done',
        'data: {"answer":"已发送。","sources":[]}',
        ''
      ].join('\n')
    });
  });

  await page.locator('#btnAi').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await expect(page.locator('#btnAiAsk svg')).toHaveCount(1);
  const iconAlignment = await page.locator('#btnAiAsk').evaluate((button) => {
    const icon = button.querySelector('svg');
    const buttonRect = button.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      horizontal: Math.abs((buttonRect.left + buttonRect.width / 2) - (iconRect.left + iconRect.width / 2)),
      vertical: Math.abs((buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2))
    };
  });
  expect(iconAlignment.horizontal).toBeLessThanOrEqual(1);
  expect(iconAlignment.vertical).toBeLessThanOrEqual(1);
  await page.locator('#aiQuestion').fill('用一句话概括本章');
  await page.locator('#aiQuestion').press('Enter');
  await expect.poll(() => askCount).toBe(1);
  await expect(page.locator('#aiQuestion')).toHaveValue('');
  await expect(page.locator('#aiStatus')).toBeVisible();
  await expect(page.locator('#aiStatus')).toContainText('正在思考');
  releaseAsk();
  await expect(page.locator('#aiAnswer')).toContainText('已发送');
  await expect(page.locator('#aiStatus')).toBeHidden();

  await page.locator('#aiQuestion').fill('第一行');
  await page.locator('#aiQuestion').press('Shift+Enter');
  await page.locator('#aiQuestion').type('第二行');
  await expect(page.locator('#aiQuestion')).toHaveValue('第一行\n第二行');
  expect(askCount).toBe(1);

  await page.locator('#aiQuestion').evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
  });
  expect(askCount).toBe(1);
});

test('AI modal keeps configuration separate and saves endpoint/model without returning the key', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: false, provider: 'openai-compatible', model: null, baseUrl: 'https://api.openai.com/v1', hasApiKey: false, retrieval: 'local-lexical-rag' })
    });
  });
  await page.route('**/app/babyreader-fnos/api/ai/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false, provider: 'openai-compatible', model: 'gpt-5.5', baseUrl: 'https://api.openai.com/v1', hasApiKey: false, retrieval: 'local-lexical-rag' }) });
      return;
    }
    const payload = route.request().postDataJSON();
    expect(payload.apiKey).toBe('test-secret');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: payload.model, baseUrl: payload.baseUrl, hasApiKey: true, retrieval: 'local-lexical-rag' }) });
  });
  await page.route('**/app/babyreader-fnos/api/ai/test-connection', async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.apiKey).toBe('test-secret');
    expect(payload).not.toHaveProperty('context');
    expect(payload).not.toHaveProperty('selectedText');
    expect(payload).not.toHaveProperty('history');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, model: payload.model }) });
  });

  await page.locator('#btnAi').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await expect(page.locator('#readerDrawer')).toBeHidden();
  await page.locator('#btnAiSettings').click();
  await expect(page.locator('#aiConfigView')).toBeVisible();
  await expect(page.locator('#btnClearAiKey')).toBeDisabled();
  await page.locator('#aiBaseUrl').fill('https://gateway.example/v1');
  await page.locator('#aiModel').fill('reader-model');
  await page.locator('#aiApiKey').fill('test-secret');
  await page.locator('#btnTestAiConnection').click();
  await expect(page.locator('#aiConfigHint')).toHaveText('连接成功 · reader-model');
  await page.locator('#btnSaveAiSettings').click();
  await expect(page.locator('#aiConfigView')).toBeHidden();
  await expect(page.locator('#aiStatus')).toBeHidden();
  await expect(page.locator('.ai-answer-title')).toHaveCount(0);
  await expect(page.locator('#aiApiKey')).toHaveValue('');
});

test('AI key clear uses a unified secondary button and only persists after saving', async ({ page }) => {
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }
  await page.route('**/app/babyreader-fnos/api/ai/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'reader-model', baseUrl: 'https://api.example/v1', hasApiKey: true, retrieval: 'local-lexical-rag' })
    });
  });
  await page.route('**/app/babyreader-fnos/api/ai/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'reader-model', baseUrl: 'https://api.example/v1', hasApiKey: true, retrieval: 'local-lexical-rag' }) });
      return;
    }
    const payload = route.request().postDataJSON();
    expect(payload.clearApiKey).toBe(true);
    expect(payload.apiKey).toBe('');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: false, provider: 'openai-compatible', model: payload.model, baseUrl: payload.baseUrl, hasApiKey: false, retrieval: 'local-lexical-rag' }) });
  });

  await page.locator('#btnAi').click();
  await page.locator('#btnAiSettings').click();
  const clearButton = page.locator('#btnClearAiKey');
  await expect(clearButton).toBeEnabled();
  await expect(clearButton).toHaveClass(/ai-secondary-button/);
  await clearButton.click();
  await expect(clearButton).toHaveText('取消清除');
  await expect(clearButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#aiConfigHint')).toHaveText('保存后将清除当前 API Key。');
  await clearButton.click();
  await expect(clearButton).toHaveText('清除 Key');
  await expect(clearButton).toHaveAttribute('aria-pressed', 'false');
  await clearButton.click();
  await page.locator('#btnSaveAiSettings').click();
  await expect(page.locator('#aiConfigView')).toBeHidden();
});

test('AI desktop panel floats left of the toolbar and remains open until manually closed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }

  await page.locator('#btnAi').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await page.waitForFunction(() => Math.abs(Number.parseFloat(getComputedStyle(document.getElementById('readerFloatingToolbar')).right) - 20) < 1);
  await expect(page.locator('#aiChatScroll')).toBeVisible();
  await expect(page.locator('.ai-composer')).toBeVisible();

  const layout = await page.evaluate(() => {
    const reader = document.getElementById('reader');
    const modal = document.getElementById('aiModal');
    const backdrop = document.getElementById('aiModalBackdrop');
    const toolbar = document.getElementById('readerFloatingToolbar');
    const readerStyle = getComputedStyle(reader);
    const modalStyle = getComputedStyle(modal);
    const backdropStyle = getComputedStyle(backdrop);
    return {
      reader: reader.getBoundingClientRect().toJSON(),
      modal: modal.getBoundingClientRect().toJSON(),
      toolbar: toolbar.getBoundingClientRect().toJSON(),
      drawer: document.getElementById('readerDrawer').getBoundingClientRect().toJSON(),
      readerRight: readerStyle.right,
      modalPosition: modalStyle.position,
      modalWidth: modalStyle.width,
      backdropBackground: backdropStyle.backgroundColor,
      backdropFilter: backdropStyle.backdropFilter,
      backdropPointerEvents: backdropStyle.pointerEvents
    };
  });

  expect(layout.modalPosition).toBe('fixed');
  expect(Number.parseFloat(layout.modalWidth)).toBeGreaterThanOrEqual(380);
  expect(Number.parseFloat(layout.modalWidth)).toBeLessThanOrEqual(420);
  expect(layout.modal.width / layout.modal.height).toBeGreaterThanOrEqual(0.58);
  expect(layout.modal.width / layout.modal.height).toBeLessThanOrEqual(0.66);
  expect(layout.modal.x + layout.modal.width).toBeLessThanOrEqual(layout.toolbar.x - 11);
  expect(layout.modal.y).toBeGreaterThanOrEqual(70);
  expect(layout.modal.height).toBeLessThanOrEqual(660);
  expect(layout.readerRight).toBe('0px');
  expect(layout.toolbar.x + layout.toolbar.width).toBeLessThanOrEqual(1261);
  expect(layout.backdropBackground).toBe('rgba(0, 0, 0, 0)');
  expect(layout.backdropFilter).toBe('none');
  expect(layout.backdropPointerEvents).toBe('none');

  await page.mouse.click(40, 400);
  await expect(page.locator('#aiModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#aiModal')).toBeVisible();

  await page.locator('#btnSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
  await expect(page.locator('#aiModal')).toBeVisible();
  const coexist = await page.evaluate(() => ({
    modal: document.getElementById('aiModal').getBoundingClientRect().toJSON(),
    drawer: document.getElementById('readerSettingsSheet').getBoundingClientRect().toJSON()
  }));
  expect(coexist.modal.x + coexist.modal.width).toBeLessThanOrEqual(coexist.drawer.x - 11);
  await page.locator('#btnCloseSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeHidden();
  await expect(page.locator('#aiModal')).toBeVisible();

  await page.locator('#btnCloseAiModal').click();
  await expect(page.locator('#aiModal')).toBeHidden();
  const restored = await page.locator('#reader').boundingBox();
  expect(restored).not.toBeNull();
  expect(Math.abs(restored.width - layout.reader.width)).toBeLessThanOrEqual(2);
});

test('AI panel keeps the composer at the bottom with a white macOS surface', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEpubFixture(page);
  if (await page.locator('#readerDrawer').isVisible()) {
    await page.locator('#btnCloseSettings').click();
    await expect(page.locator('#readerDrawer')).toBeHidden();
  }

  await page.locator('#btnAi').click();
  await expect(page.locator('#aiModal')).toBeVisible();
  await page.waitForFunction(() => Math.abs(Number.parseFloat(getComputedStyle(document.getElementById('readerFloatingToolbar')).right) - 20) < 1);

  const layout = await page.evaluate(() => {
    const modal = document.getElementById('aiModal');
    const body = document.querySelector('.ai-modal-body');
    const scroll = document.getElementById('aiChatScroll');
    const composer = document.querySelector('.ai-composer');
    const field = document.querySelector('.ai-question-field');
    const send = document.getElementById('btnAiAsk');
    const reader = document.getElementById('reader');
    const modalStyle = modal ? getComputedStyle(modal) : null;
    const bodyStyle = body ? getComputedStyle(body) : null;
    const scrollStyle = scroll ? getComputedStyle(scroll) : null;
    const readerStyle = reader ? getComputedStyle(reader) : null;
    return {
      modal: modal?.getBoundingClientRect().toJSON(),
      body: body?.getBoundingClientRect().toJSON(),
      scroll: scroll?.getBoundingClientRect().toJSON(),
      composer: composer?.getBoundingClientRect().toJSON(),
      field: field?.getBoundingClientRect().toJSON(),
      send: send?.getBoundingClientRect().toJSON(),
      modalBackground: modalStyle?.backgroundColor,
      bodyOverflowY: bodyStyle?.overflowY,
      scrollOverflowY: scrollStyle?.overflowY,
      readerScrollbarWidth: readerStyle?.scrollbarWidth
    };
  });

  expect(layout.modalBackground).toBe('rgb(255, 255, 255)');
  expect(layout.bodyOverflowY).toBe('hidden');
  expect(layout.scrollOverflowY).toBe('auto');
  expect(layout.readerScrollbarWidth).toBe('none');
  expect(layout.composer.bottom).toBeLessThanOrEqual(layout.body.bottom + 1);
  expect(layout.composer.bottom).toBeGreaterThan(layout.body.bottom - 90);
  expect(layout.scroll.bottom).toBeLessThanOrEqual(layout.composer.top + 1);
  expect(layout.send.right).toBeLessThanOrEqual(layout.field.right - 8);
  expect(layout.send.bottom).toBeLessThanOrEqual(layout.field.bottom - 8);
  expect(layout.send.left).toBeGreaterThanOrEqual(layout.field.left + layout.field.width - 52);
});

test('mobile viewport keeps the reader chrome collapsed until requested', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
    });
  });

  await openEpubFixture(page);

  await expect(page.locator('#mobileReaderToolbar')).toBeHidden();
  await page.locator('#mobileReaderChromeToggle').click();
  await expect(page.locator('#mobileReaderToolbar')).toBeVisible();
  await page.locator('#btnMobileSettings').click();
  await expect(page.locator('#readerSettingsSheet')).toBeVisible();
  await expect(page.locator('#settingReadingMode')).toHaveValue('scroll');
  expect(pageErrors).toEqual([]);
});
