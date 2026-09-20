'use strict';

const FIXTURE_TEXT = Object.freeze({
  firstParagraph: '第一章第1段',
  secondParagraph: '第二章第1段',
  repeatedPhrase: '重复文本甲乙丙'
});

// Helper to select text range on an element (browser-native selection)
function selectRange(el, startOffset, endOffset) {
  const range = document.createRange();
  // If el is not a Text node, find the correct text node containing offsets
  let currentOffset = 0;
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const nextOffset = currentOffset + node.length;
      if (startOffset >= currentOffset && startOffset < nextOffset ||
          endOffset > currentOffset && endOffset <= nextOffset) {
        if (!range.setStart(node, Math.max(0, startOffset - currentOffset))) return false;
        if (!range.setEnd(node, Math.min(nextOffset, endOffset))) return false;
        return true;
      }
      currentOffset = nextOffset;
    }
    for (const child of node.childNodes) {
      if (walk(child)) break;
    }
    return false;
  }
  walk(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

module.exports = { FIXTURE_TEXT, selectRange };
