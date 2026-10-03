'use strict';

const { test, expect } = require('@playwright/test');
const API = '/app/zhenshu/api';
const APP = '/app/zhenshu/';

test.beforeEach(async ({ page, request }) => {
  const catalog = await (await request.get(`${API}/library`)).json();
  test.skip(!catalog.features.libraryOrganization, 'Run with ZHENSHU_ENABLE_LIBRARY_ORGANIZATION=1');
  let snapshot = await (await request.get(`${API}/library/organization`)).json();
  for (const collection of snapshot.collections) {
    const removed = await request.delete(`${API}/library/collections/${collection.id}`, { data: { revision: snapshot.revision } });
    expect(removed.ok()).toBeTruthy();
    snapshot = await removed.json();
  }
  const reset = await request.put(`${API}/library/organization/preferences`, { data: { viewMode: 'flat', revision: snapshot.revision } });
  expect(reset.ok()).toBeTruthy();
  await page.goto(APP);
});

async function drag(page, source, target) {
  const draggedId = await source.locator('xpath=ancestor::*[@data-reorder-id][1]').getAttribute('data-reorder-id');
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(page.locator(`[data-reorder-id="${draggedId}"]`)).toHaveClass(/is-library-dragging/);
  const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT');
  await page.mouse.up();
  expect((await saved).status()).toBe(200);
}

test('real API: flat shelf drag persists after refresh', async ({ page }) => {
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const cards = page.locator('.library-reorder-item');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const secondId = await cards.nth(1).getAttribute('data-reorder-id');
  await drag(page, cards.first().locator('.library-book-cover'), cards.nth(1));
  await expect(cards.first()).toHaveAttribute('data-reorder-id', secondId);
  await page.reload();
  await expect(page.locator('.library-book').first()).toHaveAttribute('data-book-id', secondId);
});

test('real pointer: cover drag previews and saves without entering organize mode', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const target = await cards.nth(1).boundingBox();
  const cover = await cards.first().locator('.library-book-cover').boundingBox();
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  const dragged = cards.filter({ has: page.locator(`[data-book-id="${firstId}"]`) });
  await expect(dragged).toHaveClass(/is-library-dragging/);
  const visual = await dragged.evaluate(item => {
    const style = getComputedStyle(item);
    return { opacity: Number(style.opacity), transform: style.transform, boxShadow: style.boxShadow };
  });
  expect(visual.opacity).toBeLessThanOrEqual(0.6);
  expect(visual.transform).toBe('none');
  expect(visual.boxShadow).toBe('none');
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT');
  await page.mouse.up();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('.library-view')).toBeVisible();
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  await page.reload();
  await expect(page.locator('.library-book').nth(1)).toHaveAttribute('data-book-id', firstId);
});

test('real pointer: repeated previews can return a book to its original position without saving', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const second = await cards.nth(1).boundingBox();
  const saves = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.75, second.y + second.height / 2, { steps: 12 });
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  const returnTarget = await cards.first().boundingBox();
  await page.mouse.move(returnTarget.x + returnTarget.width * 0.25, returnTarget.y + returnTarget.height / 2, { steps: 12 });
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  await page.mouse.up();
  expect(saves).toHaveLength(0);
});

test('real pointer: moving inside the source cover activates drag without jumping to another book', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const saves = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2, { steps: 4 });
  await expect(cards.first()).toHaveClass(/is-library-dragging/);
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  await expect(page.locator('.library-grid .is-library-drop-target')).toHaveCount(0);
  await page.mouse.up();
  expect(saves).toHaveLength(0);
});

test('real pointer: Escape cancels a live book-order preview', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const target = await cards.nth(1).boundingBox();
  const saves = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  await page.keyboard.press('Escape');
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  await page.mouse.up();
  await expect(page.locator('.library-view')).toBeVisible();
  expect(saves).toHaveLength(0);
});

test('real pointer: a delayed mouse release after Escape never opens the dragged book', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 8, source.y + source.height / 2);
  await expect(cards.first()).toHaveClass(/is-library-dragging/);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(page.locator('.library-view')).toBeVisible();
});

test('real pointer: leaving the book grid clears the target and cancels on release', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const target = await cards.nth(1).boundingBox();
  const saves = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  const grid = await page.locator('.library-grid').boundingBox();
  await page.mouse.move(grid.x + grid.width / 2, grid.y - 25, { steps: 6 });
  await expect(page.locator('.library-grid .is-library-drop-target')).toHaveCount(0);
  await page.mouse.up();
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  expect(saves).toHaveLength(0);
});

test('real pointer: a shifted grid cannot commit a stale drop target on mouse release', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const target = await cards.nth(1).boundingBox();
  const saves = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  await page.locator('.library-grid').evaluate(grid => { grid.style.transform = 'translateY(2000px)'; });
  await page.mouse.up();
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  expect(saves).toHaveLength(0);
});

test('real pointer: filtered book drag preserves hidden book positions in the full API order', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const original = await cards.evaluateAll(items => items.map(item => item.dataset.reorderId));
  await page.locator('.library-filter').fill('e2e');
  const visible = page.locator('.library-grid .library-reorder-item:visible');
  const ids = await visible.evaluateAll(items => items.map(item => item.dataset.reorderId));
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(ids.length).toBeLessThan(original.length);
  const source = await visible.first().locator('.library-book-cover').boundingBox();
  const target = await visible.nth(1).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT');
  await page.mouse.up();
  const response = await saved;
  expect(response.status()).toBe(200);
  const submitted = response.request().postDataJSON().order;
  const expected = original.map(id => id === ids[0] ? ids[1] : id === ids[1] ? ids[0] : id);
  expect(submitted).toEqual(expected);
  await page.reload();
  const persisted = await page.locator('.library-grid .library-reorder-item').evaluateAll(items => items.map(item => item.dataset.reorderId));
  expect(persisted).toEqual(expected);
});

test('real pointer: rejected order save restores the server order without opening a book', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const target = await cards.nth(1).boundingBox();
  let requests = 0;
  await page.route('**/api/library/organization/order', async route => {
    requests++;
    await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"revision conflict"}' });
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  await page.mouse.up();
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  await expect(page.locator('.library-view')).toBeVisible();
  expect(requests).toBe(1);
});

test('real pointer: changing the book filter cancels the active order preview', async ({ page }) => {
  const cards = page.locator('.library-grid .library-reorder-item');
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const target = await cards.nth(1).boundingBox();
  const saves = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
  });
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 12 });
  await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
  await page.locator('.library-filter').evaluate(input => {
    input.value = 'no-match-for-drag-cancel';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.library-grid .is-library-dragging')).toHaveCount(0);
  await page.mouse.up();
  await page.locator('.library-filter').fill('');
  await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
  expect(saves).toHaveLength(0);
});

test('real pointer: a book can cross a row boundary without opening it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const cards = page.locator('.library-grid .library-reorder-item');
  // count() does not wait: let the shelf render before measuring it.
  await expect(cards.nth(6)).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(7);
  const firstId = await cards.first().getAttribute('data-reorder-id');
  const source = await cards.first().locator('.library-book-cover').boundingBox();
  const target = await cards.nth(6).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width * 0.75, target.y + target.height / 2, { steps: 24 });
  await expect(cards.nth(6)).toHaveAttribute('data-reorder-id', firstId);
  const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT');
  await page.mouse.up();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('.library-view')).toBeVisible();
});

test('real pointer: reduced-motion preference removes drag-state animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const first = page.locator('.library-grid .library-reorder-item').first();
  const cover = await first.locator('.library-book-cover').boundingBox();
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await page.mouse.down();
  await page.mouse.move(cover.x + cover.width / 2 + 8, cover.y + cover.height / 2);
  await expect(first).toHaveClass(/is-library-dragging/);
  expect(await first.evaluate(item => getComputedStyle(item).transitionDuration)).toBe('0s');
  await page.mouse.up();
});

test('real API: category drag persists after refresh', async ({ page, request }) => {
  let snapshot = await (await request.get(`${API}/library/organization`)).json();
  for (const name of ['拖动分类甲', '拖动分类乙', '拖动分类丙']) {
    const created = await request.post(`${API}/library/collections`, {
      data: { name, revision: snapshot.revision }
    });
    expect(created.ok()).toBeTruthy();
    snapshot = await created.json();
  }

  await page.reload();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const categories = page.locator('.library-category-navigation [data-reorder-id]');
  await expect(categories).toHaveCount(3);
  const originalFirstId = await categories.nth(0).getAttribute('data-reorder-id');
  const originalSecondId = await categories.nth(1).getAttribute('data-reorder-id');
  await drag(page, categories.nth(0).locator('.library-organization-card-main'), categories.nth(1));
  expect(await page.evaluate(() => window.history.state.libraryOrganization.mode)).toBe('root');
  await expect(categories.nth(0)).toHaveAttribute('data-reorder-id', originalSecondId);
  await expect(categories.nth(1)).toHaveAttribute('data-reorder-id', originalFirstId);
  await page.reload();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const persisted = page.locator('.library-category-navigation [data-reorder-id]');
  await expect(persisted.nth(0)).toHaveAttribute('data-reorder-id', originalSecondId);
  await expect(persisted.nth(1)).toHaveAttribute('data-reorder-id', originalFirstId);
});

test('category navigation auto-scrolls while a category is dragged at the horizontal edge', async ({ page, request }) => {
  let snapshot = await (await request.get(`${API}/library/organization`)).json();
  for (let index = 0; index < 14; index += 1) {
    const created = await request.post(`${API}/library/collections`, {
      data: { name: `横向移动${index + 1}`, revision: snapshot.revision }
    });
    expect(created.ok()).toBeTruthy();
    snapshot = await created.json();
  }

  await page.setViewportSize({ width: 820, height: 760 });
  await page.reload();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const navigation = page.locator('.library-category-navigation');
  const source = navigation.locator('[data-reorder-id] .library-organization-card-main').first();
  const sourceBounds = await source.boundingBox();
  const navBounds = await navigation.boundingBox();
  await page.mouse.move(sourceBounds.x + sourceBounds.width / 2, sourceBounds.y + sourceBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBounds.x + sourceBounds.width / 2 + 8, sourceBounds.y + sourceBounds.height / 2);
  await expect(source.locator('..')).toHaveClass(/is-library-dragging/);
  const edgeX = navBounds.x + navBounds.width - 3;
  const edgeY = navBounds.y + navBounds.height / 2;
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.move(edgeX - (index % 2), edgeY, { steps: 1 });
  }
  await expect.poll(() => navigation.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.up();
});

test('category delete control is a compact icon button with an accessible name', async ({ page, request }) => {
  const snapshot = await (await request.get(`${API}/library/organization`)).json();
  const created = await request.post(`${API}/library/collections`, {
    data: { name: '图标删除回归', revision: snapshot.revision }
  });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '整理', exact: true }).click();

  const deleteButton = page.getByRole('button', { name: '删除分类 图标删除回归' });
  await expect(deleteButton.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await expect(deleteButton).toHaveText('');
  const layout = await deleteButton.evaluate(button => {
    const rect = element => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const card = button.closest('[data-reorder-id]');
    return {
      handle: rect(card.querySelector('.library-reorder-handle')),
      label: rect(card.querySelector('.library-organization-card-main')),
      remove: rect(button)
    };
  });
  expect(layout.handle.right).toBeLessThanOrEqual(layout.label.left + 1);
  expect(layout.label.right).toBeLessThanOrEqual(layout.remove.left + 1);
});

test('real API: create a collection, add consecutive books, reopen and reorder', async ({ page }) => {
  await page.getByRole('button', { name: '新建分类', exact: true }).click();
  const title = `回归分类-${Date.now()}`;
  await page.getByRole('textbox', { name: '分类名称' }).fill(title);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.library-heading h1')).toHaveText(title);
  await page.getByRole('button', { name: '添加书籍', exact: true }).click();
  for (let index = 0; index < 2; index += 1) {
    const saved = page.waitForResponse(r => r.url().includes('/placement') && r.request().method() === 'PUT');
    await page.locator('.library-book-picker-add').first().click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator('.library-heading .library-summary')).toHaveText(`${index + 1} 本书`);
    await expect(page.locator('.library-book-picker')).toBeVisible();
  }
  await page.locator('.library-book-picker-close').click();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const cards = page.locator('.library-reorder-item');
  const secondId = await cards.nth(1).getAttribute('data-reorder-id');
  await drag(page, cards.first().locator('.library-book-cover'), cards.nth(1));
  await expect(cards.first()).toHaveAttribute('data-reorder-id', secondId);
  await page.reload();
  await expect(page.locator('.library-heading h1')).toHaveText(title);
  await expect(page.locator('.library-book').first()).toHaveAttribute('data-book-id', secondId);
  await page.getByRole('button', { name: /^我的书籍，/ }).click();
  await expect(page.getByRole('button', { name: `${title}，2 本`, exact: true })).toBeVisible();
});

test('real API: unassigned order saves and a book can move into a collection from the flat shelf', async ({ page, request }) => {
  const snapshot = await (await request.get(`${API}/library/organization`)).json();
  const created = await request.post(`${API}/library/collections`, { data: { name: '分类选择回归', revision: snapshot.revision } });
  expect(created.ok()).toBeTruthy();
  await page.reload();
  await page.locator('[data-library-unassigned] .library-organization-card-main').click();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const cards = page.locator('.library-reorder-item');
  const secondId = await cards.nth(1).getAttribute('data-reorder-id');
  await drag(page, cards.first().locator('.library-book-cover'), cards.nth(1));
  await expect(cards.first()).toHaveAttribute('data-reorder-id', secondId);
  await page.getByRole('button', { name: /^我的书籍，/ }).click();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  const book = page.locator(`[data-reorder-id="${secondId}"]`);
  const select = book.locator('select');
  const collectionId = await select.locator('option').nth(1).getAttribute('value');
  const saved = page.waitForResponse(r => r.url().includes('/placement') && r.request().method() === 'PUT');
  // The app's own menu opens below the trigger.
  await book.locator('.custom-select-trigger').click();
  const menu = page.locator('.custom-select-menu:not([hidden])');
  await expect(menu).toBeVisible();
  if (process.env.ZHENSHU_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.ZHENSHU_SCREENSHOT_DIR}/library-collection-menu.png` });
  await menu.locator(`[data-value="${collectionId}"]`).click();
  expect((await saved).status()).toBe(200);
  await expect(book.locator('select')).toHaveValue(collectionId);
  await page.reload();
  await page.locator(`[data-library-collection-id="${collectionId}"] .library-organization-card-main`).click();
  await expect(page.locator(`[data-book-id="${secondId}"]`)).toBeVisible();
});

test('real API: picker survives a revision conflict and retries without losing the collection', async ({ page, request }) => {
  await page.getByRole('button', { name: '新建分类', exact: true }).click();
  const title = `冲突恢复-${Date.now()}`;
  await page.getByRole('textbox', { name: '分类名称' }).fill(title);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.library-heading h1')).toHaveText(title);
  await page.getByRole('button', { name: '添加书籍', exact: true }).click();
  const snapshot = await (await request.get(`${API}/library/organization`)).json();
  const changed = await request.put(`${API}/library/organization/preferences`, {
    data: { viewMode: 'collections', revision: snapshot.revision }
  });
  expect(changed.ok()).toBeTruthy();
  await page.locator('.library-book-picker-add').first().click();
  await expect(page.locator('.library-book-picker [role="status"]')).toContainText('请重试');
  await page.locator('.library-book-picker-add').first().click();
  await expect(page.locator('.library-heading .library-summary')).toHaveText('1 本书');
  await expect(page.locator('.library-heading h1')).toHaveText(title);
});

test.describe('mobile organization', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('real touch: book cover long-press sorts but a quick scroll gesture does not', async ({ page }) => {
    const cards = page.locator('.library-grid .library-reorder-item');
    const firstId = await cards.first().getAttribute('data-reorder-id');
    const from = await cards.first().locator('.library-book-cover').boundingBox();
    const client = await page.context().newCDPSession(page);
    const point = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 16 }] });
    await page.waitForTimeout(400);
    await expect(cards.first()).not.toHaveClass(/is-library-dragging/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const current = await cards.first().locator('.library-book-cover').boundingBox();
    const fresh = { x: current.x + current.width / 2, y: current.y + current.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [fresh] });
    await expect(cards.first()).toHaveClass(/is-library-dragging/);
    const to = await cards.nth(1).boundingBox();
    const target = { x: to.x + to.width * 0.75, y: to.y + to.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
    await expect(cards.filter({ has: page.locator(`[data-book-id="${firstId}"]`) })).toHaveClass(/is-library-dragging/);
    await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
    const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT', { timeout: 5000 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await saved).status()).toBe(200);
    await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
    await expect(page.locator('.library-view')).toBeVisible();
  });
  test('real touch: long-pressed book can move vertically into the next row', async ({ page }) => {
    const cards = page.locator('.library-grid .library-reorder-item');
    const firstId = await cards.first().getAttribute('data-reorder-id');
    const from = await cards.first().locator('.library-book-cover').boundingBox();
    const to = await cards.nth(2).boundingBox();
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
      x: from.x + from.width / 2, y: from.y + from.height / 2
    }] });
    await expect(cards.first()).toHaveClass(/is-library-dragging/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: to.x + to.width * 0.75, y: to.y + to.height / 2
    }] });
    await expect(cards.filter({ has: page.locator(`[data-book-id="${firstId}"]`) })).toHaveClass(/is-library-dragging/);
    await expect(cards.nth(2)).toHaveAttribute('data-reorder-id', firstId);
    const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT', { timeout: 5000 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await saved).status()).toBe(200);
  });
  test('real touch: cancellation after a live preview restores the original order', async ({ page }) => {
    const cards = page.locator('.library-grid .library-reorder-item');
    const firstId = await cards.first().getAttribute('data-reorder-id');
    const from = await cards.first().locator('.library-book-cover').boundingBox();
    const to = await cards.nth(1).boundingBox();
    const client = await page.context().newCDPSession(page);
    const saves = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/organization/order') && request.method() === 'PUT') saves.push(request);
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
      x: from.x + from.width / 2, y: from.y + from.height / 2
    }] });
    await expect(cards.first()).toHaveClass(/is-library-dragging/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: to.x + to.width * 0.75, y: to.y + to.height / 2
    }] });
    await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(cards.first()).toHaveAttribute('data-reorder-id', firstId);
    await expect(page.locator('.library-grid .is-library-dragging')).toHaveCount(0);
    expect(saves).toHaveLength(0);
  });
  test('real touch pointer holds before sorting and persists the result', async ({ page }, testInfo) => {
    await page.getByRole('button', { name: '整理', exact: true }).click();
    const cards = page.locator('.library-reorder-item');
    const secondId = await cards.nth(1).getAttribute('data-reorder-id');
    const from = await cards.first().locator('.library-book-cover').boundingBox();
    const to = await cards.nth(1).boundingBox();
    const client = await page.context().newCDPSession(page);
    const point = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    // A scrolling gesture before the long-press deadline must never save an order.
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + 15 }] });
    await page.waitForTimeout(400);
    await expect(cards.first()).not.toHaveClass(/is-library-dragging/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect(cards.first()).not.toHaveClass(/is-library-dragging/);
    await expect(cards.first()).toHaveClass(/is-library-dragging/);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width / 2, y: point.y }] });
    const saved = page.waitForResponse(r => r.url().endsWith('/organization/order') && r.request().method() === 'PUT');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await saved).status()).toBe(200);
    await expect(cards.first()).toHaveAttribute('data-reorder-id', secondId);
    expect(await page.locator('.library-view').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('mobile-organize.png'), fullPage: true });
    await page.reload();
    await expect(page.locator('.library-book').first()).toHaveAttribute('data-book-id', secondId);
  });
});

test.describe('phone library with organization', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      });
    });
    await page.goto(APP);
    await expect(page.locator('html')).toHaveAttribute('data-reader-surface', 'mobile');
  });

  test('⋯ creates a category and the long-press sheet moves a book into it', async ({ page }) => {
    await page.locator('.library-more-button').click();
    await page.locator('.library-more-menu').getByRole('menuitem', { name: '新建分类' }).click();
    const name = `手机分类${Date.now() % 10000}`;
    await page.locator('.library-collection-form input').fill(name);
    await page.locator('.library-collection-form').getByRole('button', { name: /创建|保存|确定/ }).click();
    await expect(page.locator('.library-category-navigation')).toContainText(name);
    await expect(page.locator('.library-empty, .library-organization-empty').first()).toContainText('⋯');
    await page.locator('.library-category-navigation').getByRole('button', { name: /我的书籍/ }).click();
    await expect(page.locator('.library-heading h1')).toHaveText('书库');

    const book = page.locator('.library-grid .library-book').first();
    const bookId = await book.getAttribute('data-book-id');
    const client = await page.context().newCDPSession(page);
    const box = await book.locator('.library-book-cover').boundingBox();
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    const sheet = page.locator('.library-book-sheet');
    await expect(sheet).toBeVisible();
    // Outside 整理 the long press does not start dragging.
    await expect(page.locator('.library-reorder-item.is-library-dragging')).toHaveCount(0);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('body')).toHaveClass(/is-library/);
    await expect(sheet.locator('.library-book-sheet-action')).toHaveText(['打开', '重命名', '移动到分类', '书籍信息', '取消']);

    await sheet.getByRole('button', { name: '移动到分类' }).click();
    const saved = page.waitForResponse((response) => /\/library\/books\//.test(response.url()) && response.request().method() !== 'GET');
    await sheet.getByRole('button', { name }).click();
    expect((await saved).ok()).toBeTruthy();
    await expect(sheet).toHaveCount(0);
    await page.locator('.library-category-navigation').getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.locator(`.library-grid [data-book-id="${bookId}"]`)).toBeVisible();
  });

  test('the sheet renames a book; 整理 shows a bottom bar where touch sorting works', async ({ page }) => {
    const book = page.locator('.library-grid .library-book').first();
    await book.dispatchEvent('contextmenu');
    await page.locator('.library-book-sheet').getByRole('button', { name: '重命名' }).click();
    const dialog = page.locator('.library-rename-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消' }).click();

    await page.locator('.library-more-button').click();
    await page.locator('.library-more-menu').getByRole('menuitem', { name: '整理' }).click();
    const bar = page.locator('.library-manage-bar');
    await expect(bar).toBeVisible();
    const cards = page.locator('.library-grid .library-reorder-item');
    const firstId = await cards.first().getAttribute('data-reorder-id');
    const from = await cards.first().locator('.library-book-cover').boundingBox();
    const to = await cards.nth(1).boundingBox();
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
    await expect(cards.first()).toHaveClass(/is-library-dragging/);
    await expect(page.locator('.library-book-sheet')).toHaveCount(0);
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width * 0.75, y: to.y + to.height / 2 }] });
    await expect(cards.nth(1)).toHaveAttribute('data-reorder-id', firstId);
    const saved = page.waitForResponse((r) => r.url().endsWith('/organization/order') && r.request().method() === 'PUT', { timeout: 5000 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await saved).status()).toBe(200);
    await page.locator('.library-manage-bar').getByRole('button', { name: '完成' }).click();
    await expect(page.locator('.library-manage-bar')).toHaveCount(0);
  });
});

test('button language: header actions, the new-category form, the book picker and 完成 take the shared roles', async ({ page }) => {
  const roleOf = (locator) => locator.evaluate((button) => {
    const roles = ['zs-btn-primary', 'zs-btn-secondary', 'zs-btn-plain'].filter((role) => button.classList.contains(role));
    return button.classList.contains('zs-btn') && roles.length === 1 ? roles[0] : `unruled: ${button.className}`;
  });
  const header = page.locator('.library-header-actions');
  for (const name of ['新建分类', '重新扫描', '整理']) {
    expect(await roleOf(header.getByRole('button', { name, exact: true }))).toBe('zs-btn-secondary');
  }
  await header.getByRole('button', { name: '整理', exact: true }).click();
  expect(await roleOf(header.getByRole('button', { name: '完成', exact: true }))).toBe('zs-btn-primary');
  await header.getByRole('button', { name: '完成', exact: true }).click();

  await header.getByRole('button', { name: '新建分类', exact: true }).click();
  const form = page.locator('.library-collection-create-form');
  expect(await roleOf(form.getByRole('button', { name: '保存', exact: true }))).toBe('zs-btn-primary');
  expect(await roleOf(form.getByRole('button', { name: '取消', exact: true }))).toBe('zs-btn-plain');
  await page.getByRole('textbox', { name: '分类名称' }).fill(`按钮-${Date.now()}`);
  await form.getByRole('button', { name: '保存', exact: true }).click();

  // Inside a collection there is no 返回书库: the 我的书籍 chip goes back.
  await expect(header.getByRole('button', { name: '返回书库' })).toHaveCount(0);
  await header.getByRole('button', { name: '添加书籍', exact: true }).click();
  expect(await roleOf(page.locator('.library-book-picker-add').first())).toBe('zs-btn-secondary');
  await page.locator('.library-book-picker-close').click();
  await page.getByRole('button', { name: /^我的书籍，/ }).click();
  await expect(page.locator('.library-heading h1')).toHaveText('书库');
});
