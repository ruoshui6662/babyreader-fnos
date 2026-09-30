'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

async function createScheduler(options = {}) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/' });
  const source = await fs.readFile(
    path.resolve(__dirname, '../app/ui/reader/pdf-render-scheduler.js'),
    'utf8'
  );
  window.eval(source);
  return window.createPdfRenderScheduler(options);
}

function take(scheduler) {
  const job = scheduler.next();
  assert.ok(job);
  assert.equal(scheduler.markRunning(job), true);
  return JSON.parse(JSON.stringify(job));
}

test('PDF render scheduler prioritizes current and visible pages before directional neighbors', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1, maxFrames: 10 });
  scheduler.update({
    visible: [5, 6, 5],
    buffered: [3, 4, 5, 6, 7, 8],
    selected: [],
    currentPage: 6,
    scrollDirection: 'down',
    generation: 'book-a:1'
  });

  const order = [];
  for (let index = 0; index < 6; index += 1) {
    const job = take(scheduler);
    order.push(job.pageIndex);
    assert.equal(scheduler.markReady(job), true);
  }
  assert.deepEqual(order, [6, 5, 7, 8, 4, 3]);
  assert.equal(scheduler.next(), null);
});

test('PDF render scheduler reverses neighbor priority when scrolling upward', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1 });
  scheduler.update({
    visible: [5],
    buffered: [2, 3, 4, 5, 6, 7],
    selected: [],
    currentPage: 5,
    scrollDirection: 'up',
    generation: 1
  });

  const order = [];
  for (let index = 0; index < 6; index += 1) {
    const job = take(scheduler);
    order.push(job.pageIndex);
    scheduler.markReady(job);
  }
  assert.deepEqual(order, [5, 4, 3, 2, 6, 7]);
});

test('PDF render scheduler reserves no second job while the concurrency budget is full', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1 });
  scheduler.update({ visible: [0, 1], buffered: [0, 1], currentPage: 0, generation: 1 });

  const first = take(scheduler);
  assert.equal(first.pageIndex, 0);
  assert.equal(scheduler.next(), null);
  assert.equal(scheduler.getState().activeCount, 1);
  scheduler.markReady(first);
  assert.equal(scheduler.next().pageIndex, 1);
});

test('PDF render scheduler can defer transiently blocked work without treating it as a failure', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1 });
  const request = { visible: [0], buffered: [0], currentPage: 0, generation: 1 };
  scheduler.update(request);
  const blocked = take(scheduler);
  assert.equal(scheduler.markDeferred(blocked), true);
  assert.deepEqual(JSON.parse(JSON.stringify(scheduler.getState().failedPages)), []);

  scheduler.update(request);
  assert.equal(scheduler.next().pageIndex, 0);
});

test('PDF render scheduler drops stale work on generation changes and does not spin on failures', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1 });
  scheduler.update({ visible: [0, 1], buffered: [0, 1], currentPage: 0, generation: 'old' });
  const oldJob = take(scheduler);

  scheduler.update({ visible: [2], buffered: [2, 3], currentPage: 2, generation: 'new' });
  assert.equal(scheduler.markReady(oldJob), false);
  const failed = take(scheduler);
  assert.equal(failed.pageIndex, 2);
  assert.equal(scheduler.markFailed(failed), true);
  assert.equal(take(scheduler).pageIndex, 3);
  scheduler.markReady({ pageIndex: 3, generation: 'new' });
  assert.equal(scheduler.next(), null);

  scheduler.update({ visible: [2], buffered: [2], currentPage: 2, generation: 'new' });
  assert.equal(scheduler.next(), null);
  scheduler.update({ visible: [2], buffered: [2], currentPage: 2, generation: 'newer' });
  assert.equal(scheduler.next().pageIndex, 2);
});

test('PDF render scheduler retries a neighbor failure once when that page becomes current', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1 });
  scheduler.update({ visible: [0, 1], buffered: [0, 1], currentPage: 0, generation: 1 });
  const current = take(scheduler);
  scheduler.markReady(current);
  const neighbor = take(scheduler);
  assert.equal(neighbor.pageIndex, 1);
  scheduler.markFailed(neighbor);

  scheduler.update({ visible: [1], buffered: [1], currentPage: 1, generation: 1 });
  const retry = take(scheduler);
  assert.equal(retry.pageIndex, 1);
  scheduler.markFailed(retry);
  scheduler.update({ visible: [1], buffered: [1], currentPage: 1, generation: 1 });
  assert.equal(scheduler.next(), null);
});

test('PDF render scheduler evicts least-recent frames without evicting visible or selected pages', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1, maxFrames: 2 });
  scheduler.update({ visible: [0], buffered: [0, 1, 2], selected: [], currentPage: 0, generation: 1 });
  for (const expected of [0, 1, 2]) {
    const job = take(scheduler);
    assert.equal(job.pageIndex, expected);
    scheduler.markReady(job);
  }

  scheduler.update({ visible: [2], buffered: [2], selected: [0], currentPage: 2, generation: 1 });
  assert.deepEqual(Array.from(scheduler.evict()), [1]);
  assert.deepEqual(JSON.parse(JSON.stringify(scheduler.getState().readyPages)), [0, 2]);
  scheduler.update({ visible: [2], buffered: [2, 3], selected: [0], currentPage: 2, generation: 1 });
  const extra = take(scheduler);
  assert.equal(extra.pageIndex, 3);
  scheduler.markReady(extra);
  scheduler.update({ visible: [2], buffered: [2], selected: [0], currentPage: 2, generation: 1 });
  assert.deepEqual(Array.from(scheduler.evict([3])), [3]);
  assert.deepEqual(JSON.parse(JSON.stringify(scheduler.getState().readyPages)), [0, 2]);
  scheduler.destroy();
  assert.equal(scheduler.next(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(scheduler.getState().queuedPages)), []);
});

test('PDF render scheduler forgets an explicitly released frame before it is queued again', async () => {
  const scheduler = await createScheduler({ maxConcurrent: 1, maxFrames: 10 });
  scheduler.update({ visible: [0], buffered: [0], selected: [], currentPage: 0, generation: 1 });
  const job = take(scheduler);
  scheduler.markReady(job);
  scheduler.update({ visible: [], buffered: [], selected: [], currentPage: 0, generation: 1 });

  assert.deepEqual(Array.from(scheduler.evict([0])), [0]);
  scheduler.update({ visible: [0], buffered: [0], selected: [], currentPage: 0, generation: 1 });
  assert.equal(scheduler.next().pageIndex, 0);
});
