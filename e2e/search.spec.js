const { test, expect, devices } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings,
  showMobileReaderChrome
} = require('./helpers/reader');

const APP_PATH = '/app/zhenshu/';

async function openLibraryBook(page, title, text) {
  await page.goto(APP_PATH);
  await expect(page.locator('.library-view h1')).toHaveText('书库');
  const book = page.locator('.library-book').filter({ hasText: title });
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.locator('#article')).toContainText(text);
}

async function runSearch(page, query, launcher = '#btnSearch') {
  await expect(page.locator(launcher)).toBeEnabled();
  await page.locator(launcher).click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await page.locator('#readerSearchQuery').fill(query);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/books/') && response.url().includes('/search') && response.ok()
  );
  await page.locator('#readerSearchForm').press('Enter');
  await responsePromise;
  await expect(page.locator('#readerSearchForm')).toHaveAttribute('data-reader-search-state', /^(results|empty|error)$/);
}

test.beforeEach(async ({ page }) => {
  await page.goto(APP_PATH);
  await resetReaderSettings(page);
  await resetEpubFixtureState(page);
});

test('searches a Markdown book without using the AI search route', async ({ page }) => {
  const searchRequests = [];
  const aiSearchRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/books/') && request.url().includes('/search')) searchRequests.push(request.url());
    if (request.url().includes('/api/books/') && request.url().includes('/ai/search')) aiSearchRequests.push(request.url());
  });

  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await runSearch(page, 'E2E Reader');

  await expect(page.locator('.reader-search-result')).toContainText('E2E Reader');
  expect(searchRequests).toHaveLength(1);
  expect(searchRequests[0]).toMatch(/\/api\/books\/[a-f0-9]{64}\/search\?/);
  expect(aiSearchRequests).toEqual([]);
});

test('loads 45 search results over cursor pages without duplicates or AI requests', async ({ page }) => {
  const searchRequests = [];
  const aiRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/books/') && request.url().includes('/search')) searchRequests.push(request.url());
    if (request.url().includes('/api/books/') && request.url().includes('/ai/')) aiRequests.push(request.url());
  });
  const makeResults = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => {
    const number = start + index;
    return {
      id: `result-${number}`,
      chapterIndex: 0,
      chapterLabel: `第 ${number} 项`,
      snippet: `分页命中 ${number}`,
      matchText: '分页',
      locator: { version: 1, type: 'text-search', chapterIndex: 0, offset: number, text: '分页' }
    };
  });
  await page.route('**/api/books/*/search?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const body = !cursor
      ? { available: true, query: '分页', scope: 'book', results: makeResults(1, 20), hasMore: true, nextCursor: 'page-2' }
      : cursor === 'page-2'
        ? { available: true, query: '分页', scope: 'book', results: makeResults(16, 35), hasMore: true, nextCursor: 'page-3' }
        : { available: true, query: '分页', scope: 'book', results: makeResults(36, 45), hasMore: false, nextCursor: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await runSearch(page, '分页');
  await expect(page.locator('.reader-search-result')).toHaveCount(20);
  await page.locator('#readerSearchMore').click();
  await expect(page.locator('.reader-search-result')).toHaveCount(35);
  await page.locator('#readerSearchMore').click();
  await expect(page.locator('.reader-search-result')).toHaveCount(45);

  const ids = await page.locator('.reader-search-result').evaluateAll((buttons) => buttons.map((button) => button.dataset.searchResultId));
  expect(ids).toEqual(Array.from({ length: 45 }, (_, index) => `result-${index + 1}`));
  expect(searchRequests).toHaveLength(3);
  expect(new URL(searchRequests[1]).searchParams.get('cursor')).toBe('page-2');
  expect(new URL(searchRequests[2]).searchParams.get('cursor')).toBe('page-3');
  expect(aiRequests).toEqual([]);
});

test('failed continuation preserves results and retries the same cursor', async ({ page }) => {
  let continuationAttempts = 0;
  await page.route('**/api/books/*/search?*', async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    if (!cursor) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          available: true,
          results: [{ id: 'kept', chapterIndex: 0, chapterLabel: '当前书本', snippet: '已有结果', matchText: '已有', locator: { chapterIndex: 0, offset: 0 } }],
          hasMore: true,
          nextCursor: 'retry-page'
        })
      });
      return;
    }
    continuationAttempts += 1;
    await route.fulfill(continuationAttempts === 1
      ? { status: 503, contentType: 'application/json', body: JSON.stringify({ error: '续取暂时失败' }) }
      : {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          available: true,
          results: [{ id: 'next', chapterIndex: 0, chapterLabel: '当前书本', snippet: '后续结果', matchText: '后续', locator: { chapterIndex: 0, offset: 1 } }],
          hasMore: false,
          nextCursor: null
        })
      });
  });

  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await runSearch(page, '重试');
  await page.locator('#readerSearchMore').click();
  await expect(page.locator('#readerSearchError')).toBeVisible();
  await expect(page.locator('.reader-search-result')).toHaveCount(1);
  await expect(page.locator('#readerSearchMore')).toHaveText('重试加载');
  await page.locator('#readerSearchMore').click();
  await expect(page.locator('.reader-search-result')).toHaveCount(2);
  expect(continuationAttempts).toBe(2);
});

test('searches a TXT book and reports an empty query result without breaking the surface', async ({ page }) => {
  await openLibraryBook(page, 'plain-text', 'deterministic text fixture');
  await runSearch(page, 'deterministic');
  await expect(page.locator('.reader-search-result')).toContainText('deterministic');

  await page.locator('#readerSearchQuery').fill('not-in-this-book');
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/books/') && response.url().includes('/search') && response.ok()
  );
  await page.locator('#readerSearchForm').press('Enter');
  await responsePromise;
  await expect(page.locator('#readerSearchEmpty')).toBeVisible();
  await expect(page.locator('#readerSearchResults')).toBeHidden();
});

test('searches an EPUB and navigates a result to another chapter', async ({ page }) => {
  await openEpubFixture(page);
  await runSearch(page, 'E2E EPUB Chapter 2');

  const result = page.locator('.reader-search-result').filter({ hasText: '第二章' });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();
  await expect(page.locator('.reader-search-result')).toHaveCount(1);
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
  const target = page.locator('#article .reader-search-hit-rect').first();
  await expect(target).toBeVisible();
  const targetStyle = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    const article = document.getElementById('article');
    return {
      outlineStyle: style.outlineStyle,
      pointerEvents: getComputedStyle(element.parentElement).pointerEvents,
      rectWidth: element.getBoundingClientRect().width,
      articleWidth: article.getBoundingClientRect().width
    };
  });
  expect(targetStyle.outlineStyle).toBe('none');
  expect(targetStyle.pointerEvents).toBe('none');
  expect(targetStyle.rectWidth).toBeLessThan(targetStyle.articleWidth / 2);
});

test('search result selects the exact repeated occurrence without changing reading mode', async ({ page }) => {
  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await page.route('**/api/books/*/search?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        query: '蛋白质',
        scope: 'book',
        results: [{
          id: 'repeated-hit',
          chapterIndex: 0,
          chapterLabel: '当前书本',
          snippet: '…第二次蛋白质…',
          matchText: '蛋白质',
          locator: { version: 1, type: 'text-search', chapterIndex: 0, offset: 10, text: '蛋白质' }
        }],
        hasMore: false,
        nextCursor: null
      })
    });
  });

  for (const { mode, width, effective } of [
    { mode: 'double', width: 800, effective: 'single' },
    { mode: 'double', width: 1280, effective: 'double' },
    { mode: 'scroll', width: 1280, effective: 'scroll' }
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((nextMode) => {
      setReadingMode(nextMode, { persist: false, preserveLocator: false });
      document.getElementById('article').innerHTML = '<p>第一次蛋白质</p><p>第二次蛋白质</p>';
    }, mode);
    await runSearch(page, '蛋白质');
    await page.locator('.reader-search-result').click();
    await expect(page.locator('#readerSearchSheet')).toBeVisible();
    await expect(page.locator('.reader-search-result')).toHaveCount(1);
    const paragraphs = page.locator('#article p');
    await expect(paragraphs.nth(0)).not.toHaveClass(/reader-search-target/);
    await expect(paragraphs.nth(1)).not.toHaveClass(/reader-search-target/);
    const hitRect = page.locator('#article .reader-search-hit-rect').first();
    await expect(hitRect).toBeVisible();
    const isExactHit = await hitRect.evaluate((element) => {
      const textNode = document.querySelectorAll('#article p')[1].firstChild;
      const range = document.createRange();
      const offset = textNode.nodeValue.indexOf('蛋白质');
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset + '蛋白质'.length);
      const hit = range.getBoundingClientRect();
      const painted = element.getBoundingClientRect();
      return Math.abs(hit.left - painted.left) < 3
        && Math.abs(hit.top - painted.top) < 3
        && Math.abs(hit.width - painted.width) < 3;
    });
    expect(isExactHit).toBe(true);
    await expect(page.locator('body')).toHaveAttribute('data-effective-reading-mode', effective);
  }
});

test('renders a server snippet containing markup as plain text', async ({ page }) => {
  await page.route('**/api/books/*/search?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        query: '安全',
        scope: 'book',
        truncated: false,
        results: [{
          id: 'safe-result',
          chapterIndex: 0,
          chapterLabel: '当前书本',
          snippet: '<img src=x onerror=alert(1)>安全文本',
          matchText: '安全',
          locator: { version: 1, type: 'text-search', chapterIndex: 0, offset: 0, text: '安全' }
        }]
      })
    });
  });

  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await runSearch(page, '安全');
  await expect(page.locator('#readerSearchResults')).toContainText('<img src=x onerror=alert(1)>安全文本');
  await expect(page.locator('#readerSearchResults img')).toHaveCount(0);
});

test('search controls use the shared reader control treatment', async ({ page }) => {
  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await page.locator('#btnSearch').click();
  await expect(page.locator('#readerSearchSheet')).toBeVisible();

  const metrics = await page.locator('#readerSearchForm').evaluate((form) => {
    const input = form.querySelector('#readerSearchQuery');
    const button = form.querySelector('#readerSearchSubmit');
    const inputStyle = getComputedStyle(input);
    const buttonStyle = getComputedStyle(button);
    return {
      inputHeight: input.getBoundingClientRect().height,
      buttonHeight: button.getBoundingClientRect().height,
      inputRadius: inputStyle.borderRadius,
      buttonRadius: buttonStyle.borderRadius,
      buttonCursor: buttonStyle.cursor,
      buttonOpacity: buttonStyle.opacity,
      buttonBackground: buttonStyle.backgroundColor
    };
  });

  expect(metrics.inputHeight).toBe(44);
  expect(metrics.buttonHeight).toBe(44);
  expect(metrics.inputRadius).toBe('10px');
  expect(metrics.buttonRadius).toBe('10px');
  expect(metrics.buttonCursor).toBe('pointer');
  expect(metrics.buttonOpacity).toBe('1');
  expect(metrics.buttonBackground).toBe('rgb(10, 132, 255)');
});

test.describe('mobile search entry', () => {
  const { defaultBrowserType, ...pixel7 } = devices['Pixel 7'];
  test.use(pixel7);

  test('opens search from the mobile toolbar', async ({ page }) => {
    await openEpubFixture(page);
    await showMobileReaderChrome(page);
    await runSearch(page, 'E2E EPUB Chapter 1', '#btnMobileTopSearch');
    await expect(page.locator('.reader-search-result')).toContainText('E2E EPUB Chapter 1');
  });

  test('opens search from the mobile toolbar for a Markdown book', async ({ page }) => {
    await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
    await showMobileReaderChrome(page);
    await runSearch(page, 'E2E Reader', '#btnMobileTopSearch');
    await expect(page.locator('.reader-search-result')).toContainText('E2E Reader');
  });
});

test('identical repeated phrases: the result lands on the occurrence the search reports', async ({ page }) => {
  await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
  await page.route('**/api/books/*/search?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        query: '同一句话',
        scope: 'book',
        results: [{
          id: 'third',
          chapterIndex: 0,
          chapterLabel: '当前书本',
          snippet: '…同一句话。…',
          matchText: '同一句话',
          occurrence: 2,
          occurrences: 3,
          position: 0.8,
          // An offset that maps to none of them (index code points vs DOM UTF-16).
          locator: { version: 1, type: 'text-search', chapterIndex: 0, offset: 999, text: '同一句话' }
        }],
        hasMore: false,
        nextCursor: null
      })
    });
  });
  await page.evaluate(() => {
    setReadingMode('scroll', { persist: false, preserveLocator: false });
    document.getElementById('article').innerHTML = '<p>同一句话。</p><p>同一句话。</p><p>同一句话。</p>';
  });
  await runSearch(page, '同一句话');
  await page.locator('.reader-search-result').click();
  const hitRect = page.locator('#article .reader-search-hit-rect').first();
  await expect(hitRect).toBeVisible();
  const paragraph = await hitRect.evaluate((element) => {
    const painted = element.getBoundingClientRect();
    return [...document.querySelectorAll('#article p')].findIndex((p) => {
      const box = p.getBoundingClientRect();
      return painted.top >= box.top - 2 && painted.top <= box.bottom;
    });
  });
  expect(paragraph).toBe(2);
});
