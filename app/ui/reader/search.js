/* BabyReader UI module: reader/search */

'use strict';

let _readerSearchBound = false;
let _readerSearchToken = 0;
let _readerSearchAbortController = null;
let _readerSearchBookId = null;

function searchElement(id) {
  return document.getElementById(id);
}

function normalizedSearchText(value) {
  return String(value || '').replace(/\s+/gu, '').toLocaleLowerCase();
}

function searchTextNodes(root) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, 4);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue) nodes.push(node);
  }
  return nodes;
}

function findSearchTextRange(root, query) {
  const needle = normalizedSearchText(query);
  if (!root || !needle) return null;

  let normalized = '';
  const offsets = [];
  for (const node of searchTextNodes(root)) {
    let sourceOffset = 0;
    for (const character of String(node.nodeValue)) {
      const start = sourceOffset;
      sourceOffset += character.length;
      if (/\s/u.test(character)) continue;
      const folded = character.toLocaleLowerCase();
      normalized += folded;
      for (let index = 0; index < folded.length; index += 1) {
        offsets.push({ node, start, end: sourceOffset });
      }
    }
  }

  const matchStart = normalized.indexOf(needle);
  if (matchStart < 0) return null;
  const first = offsets[matchStart];
  const last = offsets[matchStart + needle.length - 1];
  if (!first || !last) return null;

  const range = document.createRange();
  range.setStart(first.node, first.start);
  range.setEnd(last.node, last.end);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === 1 ? container : container.parentElement;
  return { range, element: element || root };
}

function setSearchState(state, message = '') {
  const form = searchElement('readerSearchForm');
  const status = searchElement('readerSearchStatus');
  const loading = searchElement('readerSearchLoading');
  const empty = searchElement('readerSearchEmpty');
  const results = searchElement('readerSearchResults');
  const error = searchElement('readerSearchError');
  if (form) form.dataset.readerSearchState = state;
  if (status) {
    status.hidden = !message;
    status.textContent = message;
  }
  if (loading) loading.hidden = state !== 'loading';
  if (empty) empty.hidden = state !== 'empty';
  if (results && state !== 'results') {
    results.hidden = true;
    results.replaceChildren();
  }
  if (error) {
    error.hidden = state !== 'error';
    if (state === 'error' && message) error.textContent = message;
  }
}

function searchResultLabel(result) {
  const label = String(result?.chapterLabel || '').trim();
  if (label) return label;
  const chapterIndex = Number(result?.chapterIndex);
  return Number.isInteger(chapterIndex) ? `第${chapterIndex + 1}章` : '当前书本';
}

function renderReaderSearchResults(payload) {
  const results = searchElement('readerSearchResults');
  if (!results) return;
  results.replaceChildren();

  if (!payload?.available) {
    setSearchState('error', '搜索索引暂不可用，请稍后重试。');
    return;
  }

  const matches = Array.isArray(payload.results) ? payload.results : [];
  if (!matches.length) {
    setSearchState('empty', '没有找到匹配内容。');
    return;
  }

  for (const result of matches) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const meta = document.createElement('span');
    const excerpt = document.createElement('span');
    item.className = 'reader-search-result-item';
    button.className = 'reader-search-result';
    button.type = 'button';
    button.dataset.searchResultId = String(result.id || '');
    button.setAttribute('aria-label', `跳转到${searchResultLabel(result)}`);
    meta.className = 'reader-search-result-meta';
    meta.textContent = searchResultLabel(result);
    excerpt.className = 'reader-search-result-excerpt';
    excerpt.textContent = String(result.snippet || result.matchText || '');
    button.append(meta, excerpt);
    button.addEventListener('click', () => {
      void navigateToSearchResult(result);
    });
    item.appendChild(button);
    results.appendChild(item);
  }

  results.hidden = false;
  const suffix = payload.truncated ? '（仅显示部分结果）' : '';
  setSearchState('results', suffix);
}

async function navigateToSearchResult(result) {
  const locator = result?.locator || {};
  if (!state.currentBookId) return false;

  closeReaderPanel({ restoreFocus: false });
  if (state.contentType === 'epub' && Number.isInteger(locator.chapterIndex)) {
    const currentChapter = Number.isInteger(state.epubChapterIndex) ? state.epubChapterIndex : 0;
    if (locator.chapterIndex !== currentChapter) {
      const rendered = await navigateToEpubChapter(locator.chapterIndex, { page: 1 });
      if (!rendered) return false;
    }
  }

  const target = findSearchTextRange(document.getElementById('article'), result.matchText || locator.text);
  if (!target) {
    showHighlightHint('已打开章节，但未能定位到匹配原文');
    return false;
  }

  const navigated = navigateToSemanticTarget(target.element);
  if (navigated) {
    target.element.classList.add('reader-search-target');
    window.setTimeout(() => target.element.classList.remove('reader-search-target'), 1600);
  }
  return navigated;
}

async function submitReaderSearch(event) {
  event.preventDefault();
  const input = searchElement('readerSearchQuery');
  const scope = searchElement('readerSearchScope');
  const query = String(input?.value || '').trim();
  if (!query) {
    setSearchState('error', '请输入要搜索的内容。');
    input?.focus?.();
    return;
  }
  if (!state.currentBookId) {
    setSearchState('error', '请先打开一本书。');
    return;
  }

  _readerSearchAbortController?.abort();
  _readerSearchAbortController = new AbortController();
  const token = ++_readerSearchToken;
  _readerSearchBookId = state.currentBookId;
  setSearchState('loading', '正在搜索…');

  try {
    const payload = await window.browserHost.searchBook(state.currentBookId, {
      query,
      scope: scope?.value === 'chapter' ? 'chapter' : 'book',
      chapterIndex: Number.isInteger(state.currentChapterIndex) ? state.currentChapterIndex : 0,
      limit: 20,
      signal: _readerSearchAbortController.signal
    });
    if (token !== _readerSearchToken || _readerSearchBookId !== state.currentBookId) return;
    renderReaderSearchResults(payload);
  } catch (error) {
    if (token !== _readerSearchToken || error?.name === 'AbortError') return;
    setSearchState('error', error?.message || '搜索失败，请稍后重试。');
  } finally {
    if (token === _readerSearchToken) _readerSearchAbortController = null;
  }
}

function resetReaderSearch() {
  _readerSearchAbortController?.abort();
  _readerSearchAbortController = null;
  _readerSearchToken += 1;
  _readerSearchBookId = state.currentBookId || null;
  const input = searchElement('readerSearchQuery');
  const scope = searchElement('readerSearchScope');
  if (input) input.value = '';
  if (scope) scope.value = 'book';
  setSearchState('idle');
}

function setupReaderSearch() {
  if (_readerSearchBound) return;
  const form = searchElement('readerSearchForm');
  if (!form) return;
  _readerSearchBound = true;
  form.addEventListener('submit', submitReaderSearch);
  resetReaderSearch();
}

window.readerSearchApi = {
  findSearchTextRange,
  navigateToSearchResult,
  renderReaderSearchResults,
  resetReaderSearch,
  setupReaderSearch
};
