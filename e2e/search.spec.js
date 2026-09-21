const { test, expect, devices } = require('@playwright/test');
const {
  openEpubFixture,
  resetEpubFixtureState,
  resetReaderSettings
} = require('./helpers/reader');

const APP_PATH = '/app/babyreader-fnos/';

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
  await expect(page.locator('#readerSearchSheet')).toBeHidden();
  await expect(page.locator('#article')).toContainText('E2E EPUB Chapter 2');
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
    await expect(page.locator('#mobileReaderChromeToggle')).toBeVisible();
    await page.locator('#mobileReaderChromeToggle').click();
    await expect(page.locator('#mobileReaderToolbar')).toBeVisible();
    await runSearch(page, 'E2E EPUB Chapter 1', '#btnMobileSearch');
    await expect(page.locator('.reader-search-result')).toContainText('E2E EPUB Chapter 1');
  });

  test('opens search from the mobile toolbar for a Markdown book', async ({ page }) => {
    await openLibraryBook(page, 'E2E Markdown', 'E2E Reader');
    await expect(page.locator('#mobileReaderChromeToggle')).toBeVisible();
    await page.locator('#mobileReaderChromeToggle').click();
    await runSearch(page, 'E2E Reader', '#btnMobileSearch');
    await expect(page.locator('.reader-search-result')).toContainText('E2E Reader');
  });
});
