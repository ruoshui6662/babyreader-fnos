'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createLibraryReorderController,
  reorderIds,
  libraryReorderActivation,
  mergeVisibleOrder
} = require('../app/ui/library/reorder');

test('reorder activation is immediate for fine pointers and delayed for touch', () => {
  assert.deepEqual(libraryReorderActivation('mouse'), { delay: 0, moveTolerance: 0 });
  assert.deepEqual(libraryReorderActivation('pen'), { delay: 0, moveTolerance: 0 });
  assert.deepEqual(libraryReorderActivation('touch'), { delay: 350, moveTolerance: 8 });
});

test('reorderIds moves one item without mutating the source order', () => {
  const source = ['a', 'b', 'c'];
  assert.deepEqual(reorderIds(source, 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(source, ['a', 'b', 'c']);
  assert.deepEqual(reorderIds(source, 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(reorderIds(source, 1, 1), source);
});

test('reorder controller previews, commits once, and cancels stale pointer work', () => {
  const previews = [];
  const commits = [];
  const cancels = [];
  const controller = createLibraryReorderController({
    onPreview: (order) => previews.push(order),
    onCommit: (order) => commits.push(order),
    onCancel: () => cancels.push(true)
  });

  controller.begin({ order: ['a', 'b', 'c'], index: 0, id: 'a', pointerId: 1 });
  controller.update({ index: 2, pointerId: 1 });
  assert.deepEqual(previews.at(-1), ['b', 'c', 'a']);
  controller.finish({ pointerId: 1 });
  controller.finish({ pointerId: 1 });
  assert.deepEqual(commits, [['b', 'c', 'a']]);

  controller.begin({ order: ['a', 'b'], index: 0, id: 'a', pointerId: 2 });
  controller.cancel({ pointerId: 2 });
  assert.equal(cancels.length, 1);
});

test('reorder controller can return the dragged book to its original slot after repeated previews', () => {
  const previews = [];
  const commits = [];
  const controller = createLibraryReorderController({
    onPreview: (order) => previews.push(order),
    onCommit: (order) => commits.push(order)
  });
  controller.begin({ order: ['a', 'b', 'c'], index: 0, id: 'a', pointerId: 7 });
  controller.update({ index: 2, pointerId: 7 });
  controller.update({ index: 0, pointerId: 7 });
  assert.deepEqual(previews, [['b', 'c', 'a'], ['a', 'b', 'c']]);
  assert.equal(controller.finish({ pointerId: 7 }), false);
  assert.deepEqual(commits, []);
});

test('mergeVisibleOrder changes only filtered book slots in the complete order', () => {
  const full = ['a', 'hidden-1', 'b', 'hidden-2', 'c'];
  assert.deepEqual(mergeVisibleOrder(full, ['a', 'b', 'c'], ['c', 'a', 'b']),
    ['c', 'hidden-1', 'a', 'hidden-2', 'b']);
  assert.deepEqual(full, ['a', 'hidden-1', 'b', 'hidden-2', 'c']);
  assert.deepEqual(mergeVisibleOrder(full, [], []), full);
  assert.deepEqual(mergeVisibleOrder(full, ['b'], ['b']), full);
  assert.deepEqual(mergeVisibleOrder(full, ['a', 'b'], ['b', 'unknown']), full);
});
