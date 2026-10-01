/* 枕书 UI module: reader/search */

'use strict';

let _readerSearchBound = false;
let _readerSearchToken = 0;
let _readerSearchAbortController = null;
let _readerSearchBookId = null;
let _readerSearchQuery = '';
let _readerSearchCursor = null;
let _readerSearchResultIds = new Set();
let _readerSearchLoadingMore = false;
let _readerSearchNavigationToken = 0;
let _readerSearchHitFrame = null;
let _readerSearchHitTimer = null;

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
    if (node.nodeValue && !node.parentElement?.closest('.reader-search-hit-layer')) nodes.push(node);
  }
  return nodes;
}

function commonSuffixLength(left, right, limit = 64) {
  let length = 0;
  while (
    length < limit
    && length < left.length
    && length < right.length
    && left[left.length - length - 1] === right[right.length - length - 1]
  ) length += 1;
  return length;
}

function commonPrefixLength(left, right, limit = 64) {
  let length = 0;
  while (length < limit && length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function searchSnippetContexts(snippet, needle) {
  const normalized = normalizedSearchText(snippet);
  const contexts = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const matchStart = normalized.indexOf(needle, cursor);
    if (matchStart < 0) break;
    contexts.push({
      before: normalized.slice(Math.max(0, matchStart - 64), matchStart),
      after: normalized.slice(matchStart + needle.length, matchStart + needle.length + 64)
    });
    cursor = matchStart + 1;
  }
  return contexts;
}

function findSearchTextRange(root, query, locator = {}) {
  const needle = normalizedSearchText(query);
  if (!root || !needle) return null;

  let normalized = '';
  const offsets = [];
  let documentOffset = 0;
  // The index locator uses UTF-16 offsets into normalized source text. Keep
  // DOM source offsets in UTF-16 units too; iterating by code point prevents
  // splitting surrogate pairs while recording character boundaries.
  for (const node of searchTextNodes(root)) {
    let sourceOffset = 0;
    for (const character of String(node.nodeValue)) {
      const start = sourceOffset;
      sourceOffset += character.length;
      if (/\s/u.test(character)) continue;
      const folded = character.toLocaleLowerCase();
      normalized += folded;
      for (let index = 0; index < folded.length; index += 1) {
        offsets.push({ node, start, end: sourceOffset, sourceOffset: documentOffset + start });
      }
    }
    documentOffset += String(node.nodeValue).length;
  }

  const candidates = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const matchStart = normalized.indexOf(needle, cursor);
    if (matchStart < 0) break;
    const first = offsets[matchStart];
    const last = offsets[matchStart + needle.length - 1];
    if (first && last) {
      candidates.push({
        matchStart,
        sourceOffset: first.sourceOffset,
        first,
        last
      });
    }
    cursor = matchStart + 1;
  }
  if (!candidates.length) return null;

  const locatorOffset = Number.isSafeInteger(locator?.offset) && locator.offset >= 0
    ? locator.offset
    : null;
  let selected = null;
  const contexts = candidates.length > 1 ? searchSnippetContexts(locator?.snippet, needle) : [];
  let scored = [];
  if (contexts.length) {
    scored = candidates.map((candidate) => {
      const before = normalized.slice(Math.max(0, candidate.matchStart - 64), candidate.matchStart);
      const after = normalized.slice(candidate.matchStart + needle.length, candidate.matchStart + needle.length + 64);
      const score = contexts.reduce((best, context) => Math.max(
        best,
        commonSuffixLength(before, context.before) + commonPrefixLength(after, context.after)
      ), 0);
      return { candidate, score };
    }).sort((left, right) => right.score - left.score);
    if (scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
      selected = scored[0].candidate;
    }
  }

  // Source offsets are useful hints, but the current shared index stores chunk
  // starts as Unicode code-point counts while local match offsets are UTF-16.
  // Prefer matching bounded snippet context when it decisively disagrees with
  // a numerically coincident DOM offset.
  if (!selected && locatorOffset !== null) {
    selected = candidates.find((candidate) => candidate.sourceOffset === locatorOffset) || null;
  }

  // A unique exact-text occurrence is unambiguous even if source and rendered
  // offsets differ. Repeated occurrences require a verified offset or context.
  if (!selected && candidates.length === 1) selected = candidates[0];
  if (!selected) return null;

  const first = selected.first;
  const last = selected.last;
  if (!first || !last) return null;

  const range = document.createRange();
  range.setStart(first.node, first.start);
  range.setEnd(last.node, last.end);
  const container = range.commonAncestorContainer;
  const element = container.nodeType === 1 ? container : container.parentElement;
  const semanticElement = element?.closest?.('p, li, blockquote, h1, h2, h3, h4, h5, h6, section, article, div');
  return { range, element: semanticElement || element || root };
}

function clearSearchHit() {
  if (_readerSearchHitFrame !== null) cancelAnimationFrame(_readerSearchHitFrame);
  if (_readerSearchHitTimer !== null) window.clearTimeout(_readerSearchHitTimer);
  _readerSearchHitFrame = null;
  _readerSearchHitTimer = null;
  document.querySelector('#article > .reader-search-hit-layer')?.remove();
  document.querySelectorAll('.pdf-search-hit-layer').forEach((layer) => layer.remove());
}

function onPdfSearchPageFrameCommitted(context = {}) {
  if (!context.pageElement || typeof context.frameId !== 'string') return false;
  const layer = context.pageElement.querySelector('.pdf-search-hit-layer');
  if (layer && layer.dataset.frameId !== context.frameId) layer.remove();
  return true;
}

function showSearchHit(range, article, bookId, token) {
  _readerSearchHitFrame = requestAnimationFrame(() => {
    _readerSearchHitFrame = null;
    if (token !== _readerSearchNavigationToken || state.currentBookId !== bookId
      || !article.contains(range.startContainer)) return;

    const articleRect = article.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter((rect) =>
      Number.isFinite(rect.left) && Number.isFinite(rect.top)
      && Number.isFinite(rect.width) && Number.isFinite(rect.height)
      && rect.width > 0 && rect.height > 0
    ).slice(0, 64);
    if (!rects.length) return;

    const layer = document.createElement('div');
    layer.className = 'reader-search-hit-layer';
    layer.setAttribute('aria-hidden', 'true');
    for (const rect of rects) {
      const box = document.createElement('span');
      box.className = 'reader-search-hit-rect';
      box.style.left = `${rect.left - articleRect.left + article.scrollLeft}px`;
      box.style.top = `${rect.top - articleRect.top + article.scrollTop}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      layer.appendChild(box);
    }
    article.appendChild(layer);
    _readerSearchHitTimer = window.setTimeout(() => {
      if (token === _readerSearchNavigationToken) clearSearchHit();
    }, 6000);
  });
}

function setSearchState(state, message = '', { preserveResults = false } = {}) {
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
  if (results && state !== 'results' && !preserveResults) {
    results.hidden = true;
    results.replaceChildren();
  }
  updateReaderSearchStepper();
  if (error) {
    error.hidden = state !== 'error';
    if (state === 'error' && message) error.textContent = message;
  }
}

function updateReaderSearchStepper() {
  const buttons = [...(searchElement('readerSearchResults')?.querySelectorAll('.reader-search-result') || [])];
  const current = buttons.findIndex((button) => button.getAttribute('aria-current') === 'true');
  const previous = searchElement('readerSearchPrevious');
  const next = searchElement('readerSearchNext');
  const busy = searchElement('readerSearchForm')?.dataset.readerSearchState === 'loading';
  if (previous) previous.disabled = busy || !buttons.length || current <= 0;
  if (next) next.disabled = busy || !buttons.length || (current >= buttons.length - 1 && !_readerSearchCursor);
}

async function stepReaderSearchResult(direction) {
  const results = searchElement('readerSearchResults');
  const searchToken = _readerSearchToken;
  const bookId = state.currentBookId;
  const buttons = [...(results?.querySelectorAll('.reader-search-result') || [])];
  const current = buttons.findIndex((button) => button.getAttribute('aria-current') === 'true');
  let target = direction > 0 ? current + 1 : current - 1;
  if (current < 0) target = direction > 0 ? 0 : buttons.length - 1;
  if (target >= buttons.length && _readerSearchCursor) {
    await loadMoreReaderSearchResults();
    if (searchToken !== _readerSearchToken || bookId !== state.currentBookId
        || results !== searchElement('readerSearchResults')) return;
  }
  const nextButtons = [...(results?.querySelectorAll('.reader-search-result') || [])];
  nextButtons[target]?.click();
}

function searchResultLabel(result) {
  const label = String(result?.chapterLabel || '').trim();
  if (label) return label;
  const chapterIndex = Number(result?.chapterIndex);
  return Number.isInteger(chapterIndex) ? `第${chapterIndex + 1}章` : '当前书本';
}

function renderReaderSearchResults(payload, { append = false } = {}) {
  const results = searchElement('readerSearchResults');
  if (!results) return;
  if (!append) {
    results.replaceChildren();
    _readerSearchResultIds = new Set();
  }

  if (!payload?.available) {
    if (append) {
      setReaderSearchMoreError('搜索暂时失败，请重试。');
      return;
    }
    const message = payload?.unavailableReason === 'pdf_no_searchable_text'
      ? '此 PDF 没有可搜索文本。'
      : payload?.unavailableReason === 'pdf_extraction_limit'
        ? '此 PDF 超出本地搜索资源上限。'
        : payload?.unavailableReason === 'pdf_password_protected'
          ? '此 PDF 受密码保护，暂不支持搜索。'
          : '搜索索引暂不可用，请稍后重试。';
    setSearchState('error', message);
    return;
  }

  const matches = Array.isArray(payload.results) ? payload.results : [];
  const existingCount = results.querySelectorAll('.reader-search-result').length;
  for (const result of matches) {
    const resultId = String(result.id || '');
    if (_readerSearchResultIds.has(resultId)) continue;
    _readerSearchResultIds.add(resultId);
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
    const snippet = String(result.snippet || result.matchText || '');
    const term = String(result.matchText || _readerSearchQuery || '');
    const matchAt = term ? snippet.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()) : -1;
    if (matchAt >= 0) {
      const mark = document.createElement('mark');
      mark.textContent = snippet.slice(matchAt, matchAt + term.length);
      excerpt.append(document.createTextNode(snippet.slice(0, matchAt)), mark,
        document.createTextNode(snippet.slice(matchAt + term.length)));
    } else excerpt.textContent = snippet;
    button.append(meta, excerpt);
    button.addEventListener('click', () => {
      results.querySelectorAll('[aria-current]').forEach((item) => item.removeAttribute('aria-current'));
      button.setAttribute('aria-current', 'true');
      updateReaderSearchStepper();
      void navigateToSearchResult(result);
    });
    item.appendChild(button);
    results.appendChild(item);
  }

  const hasResults = results.querySelectorAll('.reader-search-result').length > 0;
  const hasCursor = payload.hasMore === true
    && typeof payload.nextCursor === 'string'
    && payload.nextCursor.length > 0;
  _readerSearchCursor = hasCursor ? payload.nextCursor : null;
  updateReaderSearchMore(hasCursor);
  updateReaderSearchStepper();

  if (!append && !hasResults && !hasCursor && payload.truncated !== true) {
    results.hidden = true;
    setSearchState('empty', '没有找到匹配内容。');
    return;
  }

  results.hidden = !hasResults;
  let message = hasResults ? `已加载 ${results.querySelectorAll('.reader-search-result').length} 条匹配` : '';
  if (!hasResults && hasCursor) message = '暂未发现匹配内容，可继续检索。';
  else if (payload.truncated === true && !hasCursor) message = '结果可能不完整，当前服务暂不支持继续加载。';
  else if (payload.hasMore === undefined && payload.truncated === true) message = '（仅显示部分结果）';
  else if (!append && !hasResults) message = '没有找到匹配内容。';
  setSearchState('results', message);
  if (!hasResults && !hasCursor && append && existingCount === 0) {
    results.hidden = true;
    setSearchState('empty', '没有找到匹配内容。');
  }
}

function updateReaderSearchMore(available) {
  const button = searchElement('readerSearchMore');
  if (!button) return;
  button.hidden = !available;
  button.disabled = !available || _readerSearchLoadingMore;
  button.textContent = _readerSearchLoadingMore ? '正在加载…' : '加载更多';
  button.setAttribute('aria-busy', _readerSearchLoadingMore ? 'true' : 'false');
}

function setReaderSearchMoreError(message) {
  const error = searchElement('readerSearchError');
  const button = searchElement('readerSearchMore');
  if (error) {
    error.hidden = false;
    error.textContent = message;
  }
  if (button) {
    button.hidden = false;
    button.disabled = false;
    button.textContent = '重试加载';
    button.setAttribute('aria-busy', 'false');
  }
}

function navigateToSearchResult(result) {
  return (typeof withJumpBack === 'function' ? withJumpBack : (jump) => jump())(() => navigateToSearchResultDirect(result));
}

async function navigateToSearchResultDirect(result) {
  const locator = result?.locator || {};
  if (!state.currentBookId) return false;
  const bookId = state.currentBookId;
  const token = ++_readerSearchNavigationToken;
  clearSearchHit();
  if (state.contentType === 'pdf') {
    return navigateToPdfSearchResult(result, { token, bookId });
  }
  const chapterIndex = Number.isInteger(locator.chapterIndex) ? locator.chapterIndex : result?.chapterIndex;
  if (state.contentType === 'epub' && Number.isInteger(chapterIndex) && chapterIndex >= 0) {
    const currentChapter = Number.isInteger(state.epubChapterIndex) ? state.epubChapterIndex : 0;
    if (chapterIndex !== currentChapter) {
      const rendered = await navigateToEpubChapter(chapterIndex, { page: 1 });
      if (!rendered || token !== _readerSearchNavigationToken || bookId !== state.currentBookId) return false;
    }
  }

  const article = document.getElementById('article');
  const target = findSearchTextRange(article, result?.matchText || locator.text, {
    ...locator,
    snippet: result?.snippet
  });
  if (!target) {
    if (article && state.effectiveReadingMode === 'scroll') {
      article.scrollIntoView({ block: 'start', behavior: 'auto' });
    } else if (article) {
      setPageGroup(0, { behavior: 'auto', save: true, redrawHighlights: true });
    }
    showHighlightHint('已打开章节，但未能定位到匹配原文');
    return false;
  }

  const navigated = navigateToSemanticTarget(target.range);
  if (navigated) showSearchHit(target.range, article, bookId, token);
  return navigated;
}

async function navigateToPdfSearchResult(result, { token, bookId }) {
  const locator = result?.locator || {};
  const pageIndex = locator.type === 'pdf' ? locator.pageIndex : result?.chapterIndex;
  const controller = window.pdfReaderController;
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || !controller
      || controller.getCurrentBookId?.() !== bookId || !controller.goToPdfPage(pageIndex)) return false;
  const generation = controller.getGeneration?.();
  const page = document.querySelector(`.pdf-page[data-page-index="${pageIndex}"]`);
  if (!page) return false;

  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (token !== _readerSearchNavigationToken || bookId !== state.currentBookId
        || generation !== controller.getGeneration?.()) return false;
    if (page.dataset.textLayerState === 'ready' || page.dataset.textLayerState === 'unavailable') break;
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  }

  if (token !== _readerSearchNavigationToken || bookId !== state.currentBookId
      || generation !== controller.getGeneration?.()) return false;
  const frame = controller.getRenderedPageGeometry?.(pageIndex);
  if (!frame?.frameId || frame.pageElement !== page) {
    showHighlightHint(`已定位到第 ${pageIndex + 1} 页，但无法确认精确文本`);
    return true;
  }
  const textLayer = page.querySelector('.pdf-page-text-layer');
  const target = findSearchTextRange(textLayer, result?.matchText || locator.quote, {
    offset: locator.textOffset,
    snippet: result?.snippet
  });
  if (!target) {
    showHighlightHint(`已定位到第 ${pageIndex + 1} 页，但无法确认精确文本`);
    return true;
  }

  _readerSearchHitFrame = requestAnimationFrame(() => {
    _readerSearchHitFrame = null;
    const currentFrame = controller.getRenderedPageGeometry?.(pageIndex);
    if (token !== _readerSearchNavigationToken || bookId !== state.currentBookId
        || generation !== controller.getGeneration?.() || currentFrame?.frameId !== frame.frameId
        || !page.contains(target.range.startContainer)) return;
    const pageRect = page.getBoundingClientRect();
    const rects = Array.from(target.range.getClientRects()).filter((rect) =>
      Number.isFinite(rect.left) && Number.isFinite(rect.top)
      && Number.isFinite(rect.width) && Number.isFinite(rect.height)
      && rect.width > 0 && rect.height > 0
    ).slice(0, 64);
    if (!rects.length) {
      showHighlightHint(`已定位到第 ${pageIndex + 1} 页，但无法确认精确文本`);
      return;
    }
    const layer = document.createElement('div');
    layer.className = 'pdf-search-hit-layer';
    layer.dataset.frameId = frame.frameId;
    layer.setAttribute('aria-hidden', 'true');
    for (const rect of rects) {
      const box = document.createElement('span');
      box.className = 'pdf-search-hit-rect';
      box.style.left = `${rect.left - pageRect.left}px`;
      box.style.top = `${rect.top - pageRect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      layer.appendChild(box);
    }
    page.appendChild(layer);
    _readerSearchHitTimer = window.setTimeout(() => {
      if (token === _readerSearchNavigationToken) clearSearchHit();
    }, 6000);
  });
  return true;
}

async function submitReaderSearch(event) {
  event.preventDefault();
  const input = searchElement('readerSearchQuery');
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

  const previousQuery = _readerSearchBookId === state.currentBookId ? _readerSearchQuery : '';
  const hasPrevious = Boolean(previousQuery && searchElement('readerSearchResults')?.querySelector('.reader-search-result'));
  const previousCursor = _readerSearchCursor;
  const restorePrevious = (message) => {
    if (!hasPrevious) {
      setSearchState('error', message);
      return;
    }
    _readerSearchCursor = previousCursor;
    updateReaderSearchMore(Boolean(previousCursor));
    setSearchState('results', `搜索未完成，仍显示“${previousQuery}”的结果。`);
    const error = searchElement('readerSearchError');
    if (error) { error.hidden = false; error.textContent = message; }
  };
  _readerSearchAbortController?.abort();
  _readerSearchAbortController = new AbortController();
  const token = ++_readerSearchToken;
  const bookId = state.currentBookId;
  _readerSearchLoadingMore = false;
  updateReaderSearchMore(false);
  setSearchState('loading', hasPrevious ? '正在搜索新关键词，暂时保留上次结果…' : '', { preserveResults: hasPrevious });

  try {
    const payload = await window.browserHost.searchBook(bookId, {
      query,
      scope: 'book',
      signal: _readerSearchAbortController.signal
    });
    if (token !== _readerSearchToken || bookId !== state.currentBookId) return;
    if (!payload?.available && hasPrevious) {
      restorePrevious('本次搜索暂不可用，请重试。');
      return;
    }
    _readerSearchBookId = bookId;
    _readerSearchQuery = query;
    _readerSearchCursor = null;
    _readerSearchResultIds = new Set();
    renderReaderSearchResults(payload);
  } catch (error) {
    if (token !== _readerSearchToken || error?.name === 'AbortError') return;
    restorePrevious(error?.message || '搜索失败，请稍后重试。');
  } finally {
    if (token === _readerSearchToken) _readerSearchAbortController = null;
  }
}

async function loadMoreReaderSearchResults() {
  if (_readerSearchLoadingMore || !_readerSearchCursor || !_readerSearchBookId || !_readerSearchQuery) return;
  const token = _readerSearchToken;
  const bookId = _readerSearchBookId;
  const query = _readerSearchQuery;
  const cursor = _readerSearchCursor;
  const controller = new AbortController();
  _readerSearchAbortController?.abort();
  _readerSearchAbortController = controller;
  _readerSearchLoadingMore = true;
  updateReaderSearchMore(true);
  const error = searchElement('readerSearchError');
  if (error) error.hidden = true;

  try {
    const payload = await window.browserHost.searchBook(bookId, {
      query,
      scope: 'book',
      cursor,
      signal: controller.signal
    });
    if (token !== _readerSearchToken || bookId !== state.currentBookId || query !== _readerSearchQuery) return;
    renderReaderSearchResults(payload, { append: true });
  } catch (requestError) {
    if (token !== _readerSearchToken || bookId !== state.currentBookId || requestError?.name === 'AbortError') return;
    setReaderSearchMoreError(requestError?.message || '加载更多结果失败，请重试。');
  } finally {
    if (token === _readerSearchToken && _readerSearchAbortController === controller) {
      _readerSearchAbortController = null;
      _readerSearchLoadingMore = false;
      const button = searchElement('readerSearchMore');
      if (button && !button.hidden && button.textContent !== '重试加载') updateReaderSearchMore(Boolean(_readerSearchCursor));
    }
  }
}

function resetReaderSearch() {
  _readerSearchNavigationToken += 1;
  clearSearchHit();
  _readerSearchAbortController?.abort();
  _readerSearchAbortController = null;
  _readerSearchToken += 1;
  _readerSearchBookId = state.currentBookId || null;
  _readerSearchQuery = '';
  _readerSearchCursor = null;
  _readerSearchResultIds = new Set();
  _readerSearchLoadingMore = false;
  updateReaderSearchMore(false);
  const error = searchElement('readerSearchError');
  if (error) error.hidden = true;
  const input = searchElement('readerSearchQuery');
  if (input) input.value = '';
  setSearchState('idle');
}

function setupReaderSearch() {
  if (_readerSearchBound) return;
  const form = searchElement('readerSearchForm');
  if (!form) return;
  _readerSearchBound = true;
  form.addEventListener('submit', submitReaderSearch);
  searchElement('readerSearchMore')?.addEventListener('click', () => {
    void loadMoreReaderSearchResults();
  });
  searchElement('readerSearchPrevious')?.addEventListener('click', () => {
    void stepReaderSearchResult(-1);
  });
  searchElement('readerSearchNext')?.addEventListener('click', () => {
    void stepReaderSearchResult(1);
  });
  resetReaderSearch();
}

window.readerSearchApi = {
  clearSearchHit,
  findSearchTextRange,
  navigateToSearchResult,
  onPdfPageFrameCommitted: onPdfSearchPageFrameCommitted,
  renderReaderSearchResults,
  resetReaderSearch,
  setupReaderSearch
};
window.onPdfSearchPageFrameCommitted = onPdfSearchPageFrameCommitted;
