/* 枕书 UI module: library/reorder */

'use strict';

const LIBRARY_TOUCH_REORDER_DELAY = 350;
const LIBRARY_TOUCH_REORDER_TOLERANCE = 8;

function libraryReorderActivation(pointerType) {
  if (pointerType === 'touch') {
    return { delay: LIBRARY_TOUCH_REORDER_DELAY, moveTolerance: LIBRARY_TOUCH_REORDER_TOLERANCE };
  }
  return { delay: 0, moveTolerance: 0 };
}

function reorderIds(order, fromIndex, toIndex) {
  if (!Array.isArray(order)) return [];
  const from = Number(fromIndex);
  const to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return order.slice();
  }
  const next = order.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function mergeVisibleOrder(fullOrder, visibleOrder, reorderedVisibleOrder) {
  if (!Array.isArray(fullOrder)) return [];
  const original = fullOrder.slice();
  if (!Array.isArray(visibleOrder) || !Array.isArray(reorderedVisibleOrder) ||
      visibleOrder.length !== reorderedVisibleOrder.length) return original;
  const all = new Set(original);
  const visible = new Set(visibleOrder);
  if (all.size !== original.length || visible.size !== visibleOrder.length ||
      reorderedVisibleOrder.some((id) => !visible.has(id)) ||
      new Set(reorderedVisibleOrder).size !== visible.size ||
      visibleOrder.some((id) => !all.has(id))) return original;
  let cursor = 0;
  return original.map((id) => visible.has(id) ? reorderedVisibleOrder[cursor++] : id);
}

function createLibraryReorderController({ onPreview, onCommit, onCancel } = {}) {
  let session = null;

  return {
    begin({ order, index, id, pointerId = null }) {
      if (!Array.isArray(order) || !Number.isInteger(index) || index < 0 || index >= order.length || !id) return false;
      session = {
        order: order.slice(),
        id,
        originalIndex: index,
        index,
        pointerId,
        preview: order.slice(),
        finished: false
      };
      return true;
    },

    update({ index, pointerId = null }) {
      if (!session || session.finished || (session.pointerId !== null && pointerId !== null && session.pointerId !== pointerId)) return false;
      const next = reorderIds(session.order, session.originalIndex, Number(index));
      session.preview = next;
      session.index = next.indexOf(session.id);
      onPreview?.(next.slice());
      return true;
    },

    finish({ pointerId = null } = {}) {
      if (!session || session.finished || (session.pointerId !== null && pointerId !== null && session.pointerId !== pointerId)) return false;
      session.finished = true;
      const committed = session.preview.slice();
      const changed = committed.some((value, index) => value !== session.order[index]);
      if (changed) onCommit?.(committed);
      else onCancel?.();
      session = null;
      return changed;
    },

    cancel({ pointerId = null } = {}) {
      if (!session || session.finished || (session.pointerId !== null && pointerId !== null && session.pointerId !== pointerId)) return false;
      session.finished = true;
      onCancel?.();
      session = null;
      return true;
    },

    isActive() {
      return Boolean(session && !session.finished);
    }
  };
}

if (typeof window !== 'undefined') {
  window.libraryReorderApi = { createLibraryReorderController, reorderIds, mergeVisibleOrder, libraryReorderActivation };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLibraryReorderController, reorderIds, mergeVisibleOrder, libraryReorderActivation };
}
