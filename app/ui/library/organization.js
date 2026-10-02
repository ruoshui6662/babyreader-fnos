/* 枕书 UI module: library/organization */

'use strict';

const LIBRARY_COLLECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIBRARY_SOURCE_ROOT_ID_PATTERN = /^[a-f0-9]{16,64}$/i;

function validLibraryCollectionId(value) {
  return LIBRARY_COLLECTION_ID_PATTERN.test(String(value || ''));
}

function validLibrarySourceRootId(value) {
  return LIBRARY_SOURCE_ROOT_ID_PATTERN.test(String(value || ''));
}

function normalizeLibrarySourceSegments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((segment) => String(segment || '').normalize('NFKC').trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..' && !/[\\/\u0000-\u001f\u007f]/u.test(segment))
    .slice(0, 64);
}

const LIBRARY_COVER_TONES = 8;
const LIBRARY_FORMAT_LABELS = { epub: 'EPUB', pdf: 'PDF', txt: 'TXT', md: 'Markdown', markdown: 'Markdown' };

function libraryBookTitle(book) {
  return book?.title || book?.relativePath || '未命名书籍';
}

function libraryBookFormatLabel(book) {
  const type = String(book?.type || '').toLowerCase();
  if (type === 'mobi' || book?.format === 'mobi' || book?.format === 'azw3') {
    return book?.sourceFormat === 'kf8' || book?.format === 'azw3' ? 'AZW3' : 'MOBI';
  }
  return LIBRARY_FORMAT_LABELS[type] || type.toUpperCase();
}

// Stable per-book tone so a generated cover never changes between renders.
function libraryCoverTone(book) {
  // FNV-1a keeps neighbouring ids (same prefix, sequential names) apart.
  const seed = String(book?.id || libraryBookTitle(book));
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % LIBRARY_COVER_TONES;
}

function libraryBookProgressPercent(book) {
  const value = state.userState?.books?.[book?.id]?.progress?.percentage;
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(Math.min(1, value) * 100);
}

// Books without embedded artwork get a typeset cover (title, author, format)
// instead of an anonymous grey block. PDF covers still replace it once rendered.
function createLibraryCover(book) {
  const cover = document.createElement(book.coverUrl ? 'img' : 'span');
  cover.className = 'library-book-cover';
  cover.draggable = false;
  if (book.coverUrl) {
    cover.src = book.coverUrl;
    cover.alt = '';
    cover.loading = 'lazy';
    return cover;
  }
  cover.setAttribute('aria-hidden', 'true');
  cover.classList.add('is-generated');
  cover.dataset.coverTone = String(libraryCoverTone(book));
  const title = document.createElement('span');
  title.className = 'library-cover-title';
  title.textContent = libraryBookTitle(book);
  cover.appendChild(title);
  if (book.author) {
    const author = document.createElement('span');
    author.className = 'library-cover-author';
    author.textContent = book.author;
    cover.appendChild(author);
  }
  const format = libraryBookFormatLabel(book);
  if (format) {
    const badge = document.createElement('span');
    badge.className = 'library-cover-format';
    badge.textContent = format;
    cover.appendChild(badge);
  }
  return cover;
}

function createLibraryBookCard(book, { open = true } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'library-book';
  button.dataset.bookId = book.id;

  const cover = createLibraryCover(book);
  button.appendChild(cover);
  if (book.type === 'pdf' && !book.coverUrl && typeof window.requestPdfLibraryCover === 'function') {
    window.requestPdfLibraryCover(book, cover);
  }

  const metadata = document.createElement('div');
  metadata.className = 'library-book-metadata';
  const name = document.createElement('strong');
  name.textContent = libraryBookTitle(book);
  metadata.appendChild(name);
  const detail = book.author || libraryBookFormatLabel(book);
  const percent = libraryBookProgressPercent(book);
  if (detail || percent !== null) {
    const line = document.createElement('span');
    line.className = 'library-book-detail';
    const text = document.createElement('span');
    text.className = 'library-book-author';
    text.textContent = detail;
    line.appendChild(text);
    if (percent !== null) {
      const progress = document.createElement('span');
      progress.className = 'library-book-progress';
      progress.textContent = percent >= 100 ? '已读完' : `${percent}%`;
      line.appendChild(progress);
    }
    metadata.appendChild(line);
  }
  button.appendChild(metadata);
  if (percent !== null) {
    button.setAttribute('aria-label', `${libraryBookTitle(book)}${book.author ? `，${book.author}` : ''}，已读 ${percent}%`);
  }
  if (open) {
    button.addEventListener('click', () => {
      window.browserHost.openBook(book).catch((error) => showHighlightHint(error.message));
    });
  } else {
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-label', `${book.title || book.relativePath || '未命名书籍'}，整理模式`);
    button.addEventListener('click', (event) => event.preventDefault());
  }
  return button;
}

function libraryOrganizationRouteFromHistory() {
  const route = window.history?.state?.libraryOrganization;
  if (!route || (route.mode !== 'root' && route.mode !== 'collection' && route.mode !== 'unassigned' && route.mode !== 'source')) return { mode: 'root', collectionId: null };
  if (route.mode === 'collection' && !validLibraryCollectionId(route.collectionId)) {
    return { mode: 'root', collectionId: null };
  }
  if (route.mode === 'source' && !validLibrarySourceRootId(route.sourceRootId)) {
    return { mode: 'root', collectionId: null };
  }
  if (route.mode === 'source') {
    return { mode: 'source', sourceRootId: route.sourceRootId, segments: normalizeLibrarySourceSegments(route.segments) };
  }
  return { mode: route.mode, collectionId: route.collectionId || null };
}

function setLibraryOrganizationHistory(route, { replace = false } = {}) {
  if (typeof window === 'undefined' || !window.history) return;
  const nextState = { ...(window.history.state || {}), libraryOrganization: route };
  if (replace) window.history.replaceState(nextState, '', window.location.href);
  else window.history.pushState(nextState, '', window.location.href);
}

function libraryOrganizationById(organization, id) {
  return (organization?.collections || []).find((collection) => collection.id === id) || null;
}

function libraryOrganizationBooksForRoute(library, route) {
  const organization = library.organization || {};
  const booksById = new Map((organization.books || []).map((book) => [book.id, book]));
  if (route.mode === 'unassigned') return organization.unassignedOrder.map((id) => booksById.get(id)).filter(Boolean);
  if (route.mode !== 'collection') return organization.books || [];
  const order = organization.collectionOrders?.[route.collectionId] || [];
  return order.map((id) => booksById.get(id)).filter(Boolean);
}

function sourceFolderProjection(organization, route) {
  const rootId = route.sourceRootId;
  const segments = route.segments || [];
  const books = (organization.books || []).filter((book) => book.sourceRootId === rootId);
  const folders = new Map();
  const directBooks = [];
  for (const book of books) {
    const pathSegments = normalizeLibrarySourceSegments(book.sourcePathSegments);
    if (pathSegments.length <= segments.length || !segments.every((segment, index) => pathSegments[index] === segment)) {
      if (segments.length === 0 && pathSegments.length === 0) directBooks.push(book);
      continue;
    }
    if (pathSegments.length === segments.length) {
      directBooks.push(book);
      continue;
    }
    const folder = pathSegments[segments.length];
    const existing = folders.get(folder) || [];
    existing.push(book);
    folders.set(folder, existing);
  }
  return { folders, directBooks };
}

async function setLibraryViewMode(library, viewMode) {
  setLibraryOrganizationManageMode(false);
  const local = {
    ...library,
    organization: { ...library.organization, preferences: { ...library.organization.preferences, viewMode } }
  };
  setLibraryOrganizationHistory({ mode: 'root', collectionId: null }, { replace: true });
  if (window.browserHost.updateLibraryOrganizationPreferences) {
    try {
      const next = await window.browserHost.updateLibraryOrganizationPreferences(viewMode, library.organization.revision);
      renderLibraryOrganization(Array.isArray(next?.books) ? { ...library, organization: next } : local);
      return;
    } catch (error) {
      showHighlightHint(error.message || '展示模式保存失败');
      try {
        const fresh = await window.browserHost.getLibraryOrganization();
        renderLibraryOrganization({ ...library, organization: fresh });
        return;
      } catch {
        // Keep the local mode available if the optional persistence request failed.
      }
    }
  }
  renderLibraryOrganization(local);
}

function libraryOrganizationManageMode() {
  return typeof window !== 'undefined' && window.__libraryOrganizationManageMode === true;
}

function setLibraryOrganizationManageMode(value) {
  if (typeof window !== 'undefined') window.__libraryOrganizationManageMode = Boolean(value);
}

function createLibraryScanButton() {
  const scanButton = document.createElement('button');
  scanButton.type = 'button';
  scanButton.className = 'mode-btn library-scan-button';
  scanButton.textContent = '重新扫描';
  scanButton.addEventListener('click', async () => {
    scanButton.disabled = true;
    scanButton.textContent = '扫描中…';
    const scanStatus = scanButton.closest('.library-view')?.querySelector('.library-scan-status');
    if (scanStatus) {
      scanStatus.textContent = '正在读取授权目录…';
      scanStatus.hidden = false;
    }
    try {
      const scanned = await window.browserHost.scanLibrary();
      markNextLibraryScanResult();
      if (typeof renderLibraryWithOrganization === 'function') await renderLibraryWithOrganization(scanned);
      else renderLibrary(scanned);
    } catch (error) {
      if (scanStatus) {
        scanStatus.textContent = '读取失败：请检查 fnOS 应用权限后重试。';
        scanStatus.hidden = false;
      }
      showHighlightHint(error.message || '重新扫描失败');
      scanButton.disabled = false;
      scanButton.textContent = '重新扫描';
    }
  });
  return scanButton;
}

function libraryOrderForRoute(organization, route) {
  if (route.mode === 'unassigned') return organization.unassignedOrder || [];
  if (route.mode === 'collection') return organization.collectionOrders?.[route.collectionId] || [];
  return (organization.collections || []).map((collection) => collection.id);
}

function moveLibraryOrderItem(library, scope, order, fromIndex, toIndex, focusId) {
  const reorder = window.libraryReorderApi?.reorderIds;
  if (!reorder) return;
  const nextOrder = reorder(order, fromIndex, toIndex);
  if (nextOrder.every((id, index) => id === order[index])) return;
  void commitLibraryOrganizationOrder(library, scope, nextOrder, focusId);
}

async function commitLibraryOrganizationOrder(library, scope, order, focusId = null) {
  const shell = document.querySelector('.library-organization-view');
  if (shell?.inert) return;
  if (shell) shell.inert = true;
  try {
    const next = await window.browserHost.reorderLibraryOrganization(
      scope,
      order,
      library.organization.revision
    );
    if (shell && !shell.isConnected) return;
    renderLibraryOrganization({ ...library, organization: next });
    const target = focusId
      ? [...document.querySelectorAll('[data-reorder-id]')].find((item) => item.dataset.reorderId === focusId)
      : null;
    target?.querySelector?.('.library-reorder-handle')?.focus?.();
  } catch (error) {
    if (shell && !shell.isConnected) return;
    showHighlightHint(error.message || '排序失败，已恢复服务端顺序');
    try {
      const fresh = await window.browserHost.getLibraryOrganization();
      if (shell && !shell.isConnected) return;
      renderLibraryOrganization({ ...library, organization: fresh });
    } catch {
      renderLibraryOrganization(library);
    }
  } finally {
    if (shell) shell.inert = false;
  }
}

function addLibraryReorderControls(item, id, itemLabel, order, scope, library, { leadingHandle = false, keyboardOnly = false } = {}) {
  item.dataset.reorderId = id;
  const handle = document.createElement('span');
  // Books are dragged by the card itself; their handle only serves keyboard
  // reordering and stays invisible until it has keyboard focus.
  handle.className = keyboardOnly ? 'library-reorder-handle is-keyboard-only' : 'library-reorder-handle';
  handle.dataset.reorderHandle = 'true';
  handle.setAttribute('role', 'group');
  handle.tabIndex = 0;
  handle.setAttribute('aria-label', `拖动排序 ${itemLabel || '项目'}`);
  handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
  handle.title = '拖动排序；聚焦后按上/下方向键调整位置';
  if (leadingHandle) item.insertBefore(handle, item.firstChild);
  else item.appendChild(handle);
}

function setupLibraryPointerReorder(container, order, scope, library, { dragFromItemContent = false, autoScroll = false } = {}) {
  let activeId = null;
  let overId = null;
  let pointerId = null;
  let holdTimer = null;
  let pointerType = null;
  let startX = 0;
  let startY = 0;
  let pendingItem = null;
  let suppressNextClick = false;
  const clear = () => {
    const capturedId = pointerId;
    pointerId = null;
    clearTimeout(holdTimer);
    holdTimer = null;
    container.querySelectorAll('.is-library-dragging, .is-library-drop-target').forEach((item) => {
      item.classList.remove('is-library-dragging', 'is-library-drop-target');
      delete item.dataset.dropEdge;
    });
    container.querySelectorAll('[aria-grabbed="true"]').forEach((item) => {
      item.removeAttribute('aria-grabbed');
      if (capturedId !== null && item.hasPointerCapture?.(capturedId)) item.releasePointerCapture(capturedId);
    });
    activeId = null;
    overId = null;
    pointerId = null;
    pointerType = null;
    startX = 0;
    startY = 0;
    pendingItem = null;
  };
  const activate = (item) => {
    activeId = item.dataset.reorderId;
    overId = activeId;
    item.classList.add('is-library-dragging');
    item.setAttribute('aria-grabbed', 'true');
    item.setPointerCapture?.(pointerId);
  };
  container.addEventListener('pointerdown', (event) => {
    if (event.button > 0 || event.isPrimary === false || pointerId !== null) return;
    if (event.target.closest?.('.library-organization-card-delete')) return;
    const handle = event.target.closest?.('[data-reorder-handle]');
    if (dragFromItemContent && !handle && event.pointerType === 'touch') return;
    const dragSource = handle || (dragFromItemContent
      ? event.target.closest?.('.library-organization-card-main')
      : null);
    const item = dragSource?.closest?.('[data-reorder-id]');
    if (!item) return;
    clear();
    pointerId = event.pointerId;
    pointerType = event.pointerType || 'mouse';
    pendingItem = item;
    startX = Number(event.clientX) || 0;
    startY = Number(event.clientY) || 0;
    const activation = window.libraryReorderApi?.libraryReorderActivation?.(pointerType) || { delay: 0, moveTolerance: 0 };
    if (activation.delay > 0) holdTimer = setTimeout(() => activate(item), activation.delay);
  });
  container.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    if (!activeId) {
      const activation = window.libraryReorderApi?.libraryReorderActivation?.(pointerType) || { delay: 0, moveTolerance: 0 };
      const delta = Math.hypot((Number(event.clientX) || 0) - startX, (Number(event.clientY) || 0) - startY);
      if (activation.delay > 0) {
        if (delta > activation.moveTolerance) clear();
        return;
      }
      if (delta < 6 || !pendingItem) return;
      activate(pendingItem);
    }
    if (autoScroll && container.scrollWidth > container.clientWidth + 1) {
      const bounds = container.getBoundingClientRect();
      const edgeSize = Math.min(48, bounds.width * 0.2);
      if (event.clientX < bounds.left + edgeSize) {
        const progress = Math.max(0, bounds.left + edgeSize - event.clientX) / edgeSize;
        container.scrollLeft -= Math.max(4, Math.round(progress * 18));
      } else if (event.clientX > bounds.right - edgeSize) {
        const progress = Math.max(0, event.clientX - (bounds.right - edgeSize)) / edgeSize;
        container.scrollLeft += Math.max(4, Math.round(progress * 18));
      }
    }
    const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('[data-reorder-id]');
    if (!target || !container.contains(target)) {
      overId = null;
      container.querySelectorAll('.is-library-drop-target').forEach((item) => {
        item.classList.remove('is-library-drop-target');
        delete item.dataset.dropEdge;
      });
      return;
    }
    overId = target.dataset.reorderId;
    container.querySelectorAll('.is-library-drop-target').forEach((item) => {
      item.classList.remove('is-library-drop-target');
      delete item.dataset.dropEdge;
    });
    target.classList.add('is-library-drop-target');
    target.dataset.dropEdge = order.indexOf(activeId) > order.indexOf(overId) ? 'before' : 'after';
  });
  container.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (!activeId || event.pointerId !== pointerId) return clear();
    const fromIndex = order.indexOf(activeId);
    const toIndex = order.indexOf(overId);
    const movedId = activeId;
    clear();
    suppressNextClick = true;
    window.setTimeout(() => { suppressNextClick = false; }, 0);
    if (fromIndex >= 0 && toIndex >= 0) moveLibraryOrderItem(library, scope, order, fromIndex, toIndex, movedId);
  });
  container.addEventListener('click', (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  container.addEventListener('pointercancel', (event) => { if (event.pointerId === pointerId) clear(); });
  container.addEventListener('lostpointercapture', (event) => { if (event.pointerId === pointerId) clear(); });
  container.addEventListener('keydown', (event) => {
    const handle = event.target.closest?.('[data-reorder-handle]');
    const item = handle?.closest?.('[data-reorder-id]');
    if (!item || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const index = order.indexOf(item.dataset.reorderId);
    const delta = event.key === 'ArrowUp' ? -1 : 1;
    moveLibraryOrderItem(library, scope, order, index, index + delta, item.dataset.reorderId);
  });
}

let cancelActiveLibraryBookDrag = null;

function setupLibraryBookPointerReorder(grid, order, scope, library) {
  const reorderApi = window.libraryReorderApi;
  if (!reorderApi?.createLibraryReorderController) return;
  const originalNodes = [...grid.children];
  const nodesById = new Map(originalNodes.map((item) => [item.dataset.reorderId, item]));
  let pointerId = null;
  let pendingItem = null;
  let activeItem = null;
  let holdTimer = null;
  let startX = 0;
  let startY = 0;
  let pointerType = 'mouse';
  let visibleIds = [];
  let previewIds = [];
  let validDrop = false;
  let suppressNextClick = false;
  let canceledPointerId = null;

  const clearCanceledClick = () => {
    canceledPointerId = null;
    suppressNextClick = false;
    document.removeEventListener('pointerup', onCanceledPointerEnd, true);
    document.removeEventListener('pointercancel', onCanceledPointerEnd, true);
    window.removeEventListener('blur', clearCanceledClick);
  };
  const onCanceledPointerEnd = (event) => {
    if (event.pointerId !== canceledPointerId) return;
    canceledPointerId = null;
    document.removeEventListener('pointerup', onCanceledPointerEnd, true);
    document.removeEventListener('pointercancel', onCanceledPointerEnd, true);
    window.removeEventListener('blur', clearCanceledClick);
    if (event.type === 'pointercancel') suppressNextClick = false;
    else window.setTimeout(() => { suppressNextClick = false; }, 0);
  };

  const restore = () => {
    if (grid.isConnected) grid.append(...originalNodes);
  };
  const controller = reorderApi.createLibraryReorderController({
    onPreview: (next) => {
      if (next.every((id, index) => id === previewIds[index])) return;
      previewIds = next;
      const complete = reorderApi.mergeVisibleOrder(order, visibleIds, next);
      const nodes = complete.map((id) => nodesById.get(id)).filter(Boolean);
      if (nodes.length === originalNodes.length && grid.isConnected) grid.append(...nodes);
    },
    onCommit: (next) => {
      const complete = reorderApi.mergeVisibleOrder(order, visibleIds, next);
      grid.classList.add('is-library-order-saving');
      void commitLibraryOrganizationOrder(library, scope, complete, activeItem?.dataset.reorderId);
    },
    onCancel: restore
  });

  const reset = () => {
    const capturedId = pointerId;
    clearTimeout(holdTimer);
    holdTimer = null;
    pointerId = null;
    pendingItem = null;
    if (activeItem) {
      activeItem.classList.remove('is-library-dragging');
      activeItem.removeAttribute('aria-grabbed');
      activeItem = null;
    }
    grid.classList.remove('is-library-reordering');
    grid.querySelectorAll('.is-library-drop-target').forEach((item) => {
      item.classList.remove('is-library-drop-target');
      delete item.dataset.dropEdge;
    });
    validDrop = false;
    if (capturedId !== null && grid.hasPointerCapture?.(capturedId)) grid.releasePointerCapture(capturedId);
    document.removeEventListener('keydown', onEscape, true);
    document.removeEventListener('input', onFilterInput, true);
    window.removeEventListener('blur', cancel);
  };
  const cancel = () => {
    if (controller.isActive()) controller.cancel({ pointerId });
    reset();
  };
  const onEscape = (event) => {
    if (event.key !== 'Escape' || pointerId === null) return;
    event.preventDefault();
    event.stopPropagation();
    const canceledId = activeItem ? pointerId : null;
    cancel();
    if (canceledId !== null) {
      suppressNextClick = true;
      canceledPointerId = canceledId;
      document.addEventListener('pointerup', onCanceledPointerEnd, true);
      document.addEventListener('pointercancel', onCanceledPointerEnd, true);
      window.addEventListener('blur', clearCanceledClick);
    }
  };
  const onFilterInput = (event) => {
    if (event.target.matches?.('.library-filter')) cancel();
  };
  const activate = () => {
    if (!pendingItem || pointerId === null || !grid.isConnected) return;
    visibleIds = originalNodes.filter((item) => !item.hidden).map((item) => item.dataset.reorderId);
    const index = visibleIds.indexOf(pendingItem.dataset.reorderId);
    if (index < 0 || !controller.begin({ order: visibleIds, index, id: pendingItem.dataset.reorderId, pointerId })) return;
    previewIds = visibleIds.slice();
    activeItem = pendingItem;
    activeItem.classList.add('is-library-dragging');
    activeItem.setAttribute('aria-grabbed', 'true');
    grid.classList.add('is-library-reordering');
    grid.setPointerCapture?.(pointerId);
  };

  const updateDrop = (clientX, clientY) => {
    const bounds = grid.getBoundingClientRect();
    if (clientX < bounds.left || clientX > bounds.right ||
        clientY < bounds.top || clientY > bounds.bottom) {
      validDrop = false;
      grid.querySelectorAll('.is-library-drop-target').forEach((item) => {
        item.classList.remove('is-library-drop-target');
        delete item.dataset.dropEdge;
      });
      return;
    }
    const candidates = [...grid.children].filter((item) => !item.hidden && item !== activeItem);
    let target = document.elementFromPoint?.(clientX, clientY)?.closest?.('[data-reorder-id]');
    if (target === activeItem) {
      validDrop = true;
      grid.querySelectorAll('.is-library-drop-target').forEach((item) => {
        item.classList.remove('is-library-drop-target');
        delete item.dataset.dropEdge;
      });
      return;
    }
    if (!target || target.parentElement !== grid || target.hidden) {
      target = candidates.reduce((best, item) => {
        const rect = item.getBoundingClientRect();
        const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
        const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
        const distance = dx * dx + dy * dy;
        return !best || distance < best.distance ? { item, distance } : best;
      }, null)?.item;
    }
    if (!target) {
      validDrop = false;
      return;
    }
    validDrop = true;
    const rect = target.getBoundingClientRect();
    const before = clientX < rect.left + rect.width / 2;
    const current = [...grid.children].filter((item) => !item.hidden);
    const sourceIndex = current.indexOf(activeItem);
    const targetIndex = current.indexOf(target);
    let insertionIndex = targetIndex + (before ? 0 : 1);
    if (sourceIndex < insertionIndex) insertionIndex--;
    grid.querySelectorAll('.is-library-drop-target').forEach((item) => {
      item.classList.remove('is-library-drop-target');
      delete item.dataset.dropEdge;
    });
    target.classList.add('is-library-drop-target');
    target.dataset.dropEdge = before ? 'before' : 'after';
    controller.update({ index: insertionIndex, pointerId });
  };

  grid.addEventListener('pointerdown', (event) => {
    if (canceledPointerId !== null && event.pointerId !== canceledPointerId) clearCanceledClick();
    if (event.button > 0 || event.isPrimary === false || pointerId !== null ||
        grid.classList.contains('is-library-order-saving') || grid.closest('.library-organization-view')?.inert) return;
    const source = event.target.closest?.('[data-reorder-handle], .library-book');
    const item = source?.closest?.('[data-reorder-id]');
    if (!item || item.parentElement !== grid || item.hidden) return;
    pointerId = event.pointerId;
    pointerType = event.pointerType || 'mouse';
    pendingItem = item;
    startX = Number(event.clientX) || 0;
    startY = Number(event.clientY) || 0;
    document.addEventListener('keydown', onEscape, true);
    document.addEventListener('input', onFilterInput, true);
    window.addEventListener('blur', cancel);
    const activation = reorderApi.libraryReorderActivation(pointerType);
    if (activation.delay > 0) holdTimer = window.setTimeout(activate, activation.delay);
  });
  grid.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    if (!activeItem) {
      const activation = reorderApi.libraryReorderActivation(pointerType);
      const delta = Math.hypot((Number(event.clientX) || 0) - startX, (Number(event.clientY) || 0) - startY);
      if (activation.delay > 0) {
        if (delta > activation.moveTolerance) cancel();
        return;
      }
      if (delta < 6) return;
      activate();
    }
    if (!activeItem) return;
    event.preventDefault();
    updateDrop(event.clientX, event.clientY);
  });
  grid.addEventListener('touchmove', (event) => {
    if (activeItem) event.preventDefault();
  }, { passive: false });
  grid.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    if (!activeItem) return reset();
    updateDrop(event.clientX, event.clientY);
    if (validDrop) controller.finish({ pointerId });
    else controller.cancel({ pointerId });
    reset();
    suppressNextClick = true;
    window.setTimeout(() => { suppressNextClick = false; }, 0);
  });
  grid.addEventListener('pointercancel', (event) => { if (event.pointerId === pointerId) cancel(); });
  grid.addEventListener('lostpointercapture', (event) => { if (event.pointerId === pointerId) cancel(); });
  grid.addEventListener('click', (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  grid.addEventListener('keydown', (event) => {
    const handle = event.target.closest?.('[data-reorder-handle]');
    const item = handle?.closest?.('[data-reorder-id]');
    if (!item || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const index = order.indexOf(item.dataset.reorderId);
    moveLibraryOrderItem(library, scope, order, index, index + (event.key === 'ArrowUp' ? -1 : 1), item.dataset.reorderId);
  });
  cancelActiveLibraryBookDrag = cancel;
}

function libraryOrganizationBookGrid(books, { library, scope, order } = {}) {
  const grid = document.createElement('div');
  grid.className = 'library-grid';
  grid.dataset.librarySlot = 'book-grid';
  const sortable = Boolean(library && scope && Array.isArray(order));
  const manage = sortable && libraryOrganizationManageMode();
  grid.classList.toggle('is-manage-mode', manage);
  for (const book of books) {
    if (!sortable) {
      grid.appendChild(createLibraryBookCard(book));
      continue;
    }
    const item = document.createElement('article');
    item.className = 'library-reorder-item';
    const card = createLibraryBookCard(book, { open: !manage });
    item.appendChild(card);
    addLibraryReorderControls(item, book.id, book.title || book.relativePath, order, scope, library, { keyboardOnly: true });
    if (!manage) {
      grid.appendChild(item);
      continue;
    }
    const select = document.createElement('select');
    select.className = 'library-book-collection-select';
    select.setAttribute('aria-label', `分类：${book.title || '书籍'}`);
    for (const collection of [{ id: '', name: '未分类' }, ...library.organization.collections]) {
      const option = document.createElement('option');
      option.value = collection.id;
      option.textContent = collection.name;
      select.appendChild(option);
    }
    select.value = library.organization.bookAssignments?.[book.id] || '';
    select.addEventListener('change', async () => {
      select.disabled = true;
      try {
        const next = await window.browserHost.placeLibraryBook(book.id, select.value || null, null, library.organization.revision);
        renderLibraryOrganization({ ...library, organization: next });
      } catch (error) {
        showHighlightHint(error.message || '分类保存失败，请重试');
        select.value = library.organization.bookAssignments?.[book.id] || '';
        select.disabled = false;
        try {
          const fresh = await window.browserHost.getLibraryOrganization();
          renderLibraryOrganization({ ...library, organization: fresh });
        } catch { /* Keep the original assignment available for retry. */ }
      }
    });
    const controls = document.createElement('div');
    controls.className = 'library-book-manage-controls';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'library-book-rename';
    rename.setAttribute('aria-label', `重命名：${book.title || '书籍'}`);
    rename.title = '重命名';
    rename.addEventListener('click', () => showLibraryBookRenameDialog(library, book, rename));
    controls.append(select, rename);
    item.appendChild(controls);
    grid.appendChild(item);
  }
  if (sortable) setupLibraryBookPointerReorder(grid, order, scope, library);
  return grid;
}

function libraryOrganizationCount(organization, collectionId) {
  return (organization.collectionOrders?.[collectionId] || []).length;
}

function makeLibraryOrganizationCard({ id = null, title, count, onOpen, onDelete = null, onRename = null, unassigned = false }) {
  const card = document.createElement('article');
  card.className = 'library-organization-card';
  if (id) card.dataset.libraryCollectionId = id;
  if (unassigned) card.dataset.libraryUnassigned = 'true';

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'library-organization-card-main';
  open.setAttribute('aria-label', `${title}，${count} 本`);
  const heading = document.createElement('strong');
  heading.textContent = title;
  const summary = document.createElement('span');
  summary.className = 'library-organization-card-count';
  summary.setAttribute('aria-hidden', 'true');
  summary.textContent = String(count);
  open.append(heading, summary);
  open.addEventListener('click', onOpen);
  card.appendChild(open);

  if (onRename) {
    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'library-organization-card-rename';
    renameButton.setAttribute('aria-label', `重命名分类 ${title}`);
    renameButton.title = `重命名分类 ${title}`;
    renameButton.textContent = '编辑';
    renameButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onRename(renameButton);
    });
    card.appendChild(renameButton);
  }

  if (onDelete) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'library-organization-card-delete';
    deleteButton.setAttribute('aria-label', `删除分类 ${title}`);
    deleteButton.title = `删除分类 ${title}`;
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" data-icon="delete" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="m5 7 1 14h12l1-14"></path><path d="M9 7V4h6v3"></path></svg>';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onDelete(deleteButton);
    });
    card.appendChild(deleteButton);
  }
  return card;
}

function libraryOrganizationBookOrigin(organization, bookId) {
  const collectionId = organization?.bookAssignments?.[bookId];
  if (!collectionId) return '未分类';
  return libraryOrganizationById(organization, collectionId)?.name || '其他分类';
}

function showLibraryBookPicker(shell, library, collection) {
  if (!shell || !collection || shell.querySelector('.library-book-picker')) return;
  const organization = library.organization || {};
  const candidates = (organization.books || [])
    .filter((book) => organization.bookAssignments?.[book.id] !== collection.id);

  const picker = document.createElement('section');
  picker.className = 'library-book-picker';
  picker.setAttribute('aria-label', `添加书籍到${collection.name}`);
  const heading = document.createElement('div');
  heading.className = 'library-book-picker-header';
  const title = document.createElement('h2');
  title.className = 'library-book-picker-title';
  title.textContent = '添加书籍';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'library-book-picker-close';
  close.textContent = '完成';
  close.addEventListener('click', () => picker.remove());
  heading.append(title, close);
  picker.appendChild(heading);
  const query = document.createElement('input');
  query.type = 'search';
  query.className = 'library-book-picker-search';
  query.placeholder = '查找书名或作者';
  query.setAttribute('aria-label', '查找可移入的书籍');
  picker.appendChild(query);
  const moveSelected = document.createElement('button');
  moveSelected.type = 'button';
  moveSelected.className = 'mode-btn library-book-picker-move-selected';
  moveSelected.textContent = '移入所选';
  moveSelected.disabled = true;
  picker.appendChild(moveSelected);
  const status = document.createElement('p');
  status.className = 'library-book-picker-empty';
  status.setAttribute('role', 'status');
  picker.appendChild(status);
  const updateSelection = () => {
    moveSelected.disabled = !picker.querySelector('.library-book-picker-row input:checked');
  };
  query.addEventListener('input', () => {
    const term = query.value.trim().normalize('NFKC').toLocaleLowerCase();
    let visible = 0;
    picker.querySelectorAll('.library-book-picker-row').forEach((row) => {
      row.hidden = Boolean(term) && !row.dataset.searchText.includes(term);
      if (!row.hidden) visible += 1;
    });
    status.textContent = term && !visible ? '没有匹配的书籍，请换个关键词。' : '';
  });
  let moving = false;
  const moveBooks = async (ids) => {
    if (moving || !ids.length) return;
    moving = true;
    close.disabled = true;
    query.disabled = true;
    moveSelected.disabled = true;
    picker.querySelectorAll('.library-book-picker-row button, .library-book-picker-row input').forEach((item) => { item.disabled = true; });
    let latest = organization;
    let moved = 0;
    let failure = null;
    for (const id of ids) {
      status.textContent = `正在移入 ${moved + 1} / ${ids.length} 本…`;
      try {
        latest = await window.browserHost.placeLibraryBook(id, collection.id, null, latest.revision);
        moved += 1;
      } catch (error) {
        failure = error;
        break;
      }
    }
    if (failure) {
      try { latest = await window.browserHost.getLibraryOrganization(); }
      catch { /* Keep the last confirmed server response. */ }
    }
    if (!picker.isConnected || window.__libraryOrganizationLibrary !== library) return;
    const oldScrollTop = picker.querySelector('.library-book-picker-list')?.scrollTop || 0;
    const updated = { ...library, organization: latest };
    renderLibraryOrganization(updated);
    const nextShell = document.querySelector('.library-organization-view');
    if (nextShell && window.history?.state?.libraryOrganization?.collectionId === collection.id) {
      showLibraryBookPicker(nextShell, updated, collection);
      const next = nextShell.querySelector('.library-book-picker');
      const nextQuery = next?.querySelector('input[type="search"]');
      if (nextQuery) {
        nextQuery.value = query.value;
        nextQuery.dispatchEvent(new Event('input'));
        nextQuery.focus();
      }
      const nextList = next?.querySelector('.library-book-picker-list');
      if (nextList) nextList.scrollTop = oldScrollTop;
      if (failure && next) next.querySelector('[role="status"]').textContent = `已移入 ${moved} 本；剩余 ${ids.length - moved} 本未完成，请重试。`;
    }
    if (failure) showHighlightHint(failure.message || '部分书籍移入失败，请重试');
  };
  moveSelected.addEventListener('click', () => {
    void moveBooks([...picker.querySelectorAll('.library-book-picker-row input:checked')].map((item) => item.value));
  });

  if (!candidates.length) {
    const empty = document.createElement('p');
    empty.className = 'library-book-picker-empty';
    empty.textContent = '没有可加入的书籍';
    picker.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'library-book-picker-list';
    for (const book of candidates) {
      const row = document.createElement('article');
      row.className = 'library-book-picker-row';
      row.dataset.searchText = `${book.title || ''} ${book.author || ''}`.normalize('NFKC').toLocaleLowerCase();
      const choice = document.createElement('input');
      choice.type = 'checkbox';
      choice.value = book.id;
      choice.setAttribute('aria-label', `选择${book.title || '书籍'}，当前在${libraryOrganizationBookOrigin(organization, book.id)}`);
      choice.addEventListener('change', updateSelection);
      const details = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = book.title || book.relativePath || '未命名书籍';
      const origin = document.createElement('span');
      origin.textContent = `当前：${libraryOrganizationBookOrigin(organization, book.id)}`;
      details.append(name, origin);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'mode-btn library-book-picker-add';
      add.textContent = '移入';
      add.addEventListener('click', () => { void moveBooks([book.id]); });
      row.append(choice, details, add);
      list.appendChild(row);
    }
    picker.appendChild(list);
  }

  const anchor = shell.querySelector('.library-grid, .library-empty, .library-organization-grid');
  const anchorParent = anchor?.parentElement || shell;
  anchorParent.insertBefore(picker, anchor || null);
}

function renderLibraryOrganization(library) {
  const organization = library?.organization;
  if (!organization || !Array.isArray(organization.books)) return false;
  if (cancelActiveLibraryBookDrag) {
    cancelActiveLibraryBookDrag();
    cancelActiveLibraryBookDrag = null;
  }
  if (typeof window !== 'undefined') {
    window.__libraryOrganizationLibrary = library;
    if (!window.history?.state?.libraryOrganization) {
      setLibraryOrganizationHistory({ mode: 'root', collectionId: null }, { replace: true });
    }
  }
  const article = typeof prepareLibrarySurface === 'function' ? prepareLibrarySurface() : null;
  if (!article) return false;

  let route = libraryOrganizationRouteFromHistory();
  if (route.mode === 'source') {
    setLibraryOrganizationHistory({ mode: 'root', collectionId: null }, { replace: true });
    route = { mode: 'root', collectionId: null };
  }
  const collection = route.mode === 'collection'
    ? libraryOrganizationById(organization, route.collectionId)
    : null;
  if (route.mode === 'collection' && !collection) {
    setLibraryOrganizationHistory({ mode: 'root', collectionId: null }, { replace: true });
    return renderLibraryOrganization(library);
  }

  const shell = document.createElement('section');
  shell.className = 'library-view library-organization-view';
  shell.dataset.libraryMode = route.mode === 'collection' || route.mode === 'unassigned' ? route.mode : 'flat';
  shell.dataset.libraryOrganizationEnabled = 'true';

  const header = document.createElement('div');
  header.className = 'library-header';
  header.dataset.librarySlot = 'header';
  const heading = document.createElement('div');
  heading.className = 'library-heading';
  const title = document.createElement('h1');
  const isDetail = Boolean(collection) || route.mode === 'unassigned';
  const manage = libraryOrganizationManageMode();
  title.textContent = collection
    ? collection.name
    : route.mode === 'unassigned'
      ? '未分类'
      : '书库';
  heading.appendChild(title);
  const summary = document.createElement('p');
  summary.className = 'library-summary';
  summary.textContent = collection
    ? `${libraryOrganizationCount(organization, collection.id)} 本书`
    : route.mode === 'unassigned' ? `${organization.unassignedOrder.length} 本书`
      : `${organization.books.length} 本书 · ${organization.collections.length} 个分类`;
  heading.appendChild(summary);
  if (typeof createLibraryHiddenPdfNotice === 'function') {
    const hiddenPdfNotice = createLibraryHiddenPdfNotice(library);
    if (hiddenPdfNotice) heading.appendChild(hiddenPdfNotice);
  }
  header.appendChild(heading);

  const actions = document.createElement('div');
  actions.className = 'library-header-actions';
  actions.dataset.librarySlot = 'header-actions';

  if (isDetail) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'mode-btn library-back-button';
    back.textContent = '返回书库';
    back.addEventListener('click', () => {
      setLibraryOrganizationManageMode(false);
      setLibraryOrganizationHistory({ mode: 'root', collectionId: null }, { replace: true });
      renderLibraryOrganization(library);
    });
    actions.append(back, createLibraryScanButton());
    if (collection) {
        const addBooks = document.createElement('button');
        addBooks.type = 'button';
        addBooks.className = 'mode-btn library-create-button';
        addBooks.textContent = '添加书籍';
        addBooks.addEventListener('click', () => showLibraryBookPicker(shell, library, collection));
        actions.appendChild(addBooks);
    }
    if (collection || route.mode === 'unassigned') {
      const manageButton = document.createElement('button');
      manageButton.type = 'button';
      manageButton.className = 'mode-btn library-mode-button';
      manageButton.textContent = manage ? '完成' : '整理';
      manageButton.setAttribute('aria-pressed', String(manage));
      manageButton.addEventListener('click', () => {
        setLibraryOrganizationManageMode(!manage);
        renderLibraryOrganization(library);
      });
      actions.appendChild(manageButton);
    }
  } else {
    const manageButton = document.createElement('button');
    manageButton.type = 'button';
    manageButton.className = 'mode-btn library-mode-button';
    manageButton.textContent = manage ? '完成' : '整理';
    manageButton.setAttribute('aria-pressed', String(manage));
    manageButton.addEventListener('click', () => {
      setLibraryOrganizationManageMode(!manage);
      renderLibraryOrganization(library);
    });
    actions.append(createLibraryScanButton(), manageButton);
  }
  if (!isDetail) {
    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'mode-btn library-create-button';
    createButton.textContent = '新建分类';
    createButton.addEventListener('click', () => showLibraryCollectionForm(shell, library));
    actions.insertBefore(createButton, actions.querySelector('.library-scan-button'));
  }
  // Import sits beside the other library actions for admins only; inside a
  // collection it files new books into that collection.
  const importContext = { collectionId: collection?.id || null };
  if (typeof libraryImportAvailable === 'function' && libraryImportAvailable(library)) {
    const importButton = createLibraryImportButton(library, importContext);
    if (isDetail) actions.insertBefore(importButton, actions.querySelector('.library-mode-button'));
    else actions.insertBefore(importButton, actions.querySelector('.library-scan-button'));
  }
  header.appendChild(actions);
  shell.appendChild(header);
  const scanStatus = createLibraryScanStatus(library.scan);
  shell.appendChild(scanStatus);

  if (manage) {
    const hint = document.createElement('p');
    hint.className = 'library-summary library-manage-hint';
    // Books move by their cover; category chips keep a grip because touch
    // screens cannot drag them by their label.
    hint.textContent = organization.collections.length
      ? '拖动书籍封面调整顺序（手机上长按后拖动），点铅笔按钮重命名书籍；分类拖动左侧的 ⋮⋮ 调整顺序。'
      : '拖动书籍封面调整顺序（手机上长按后拖动），点铅笔按钮重命名书籍。';
    shell.appendChild(hint);
  }

  const booksSection = document.createElement('section');
  booksSection.className = 'library-content-section library-books-section';
  const navigation = document.createElement('nav');
  navigation.className = 'library-category-navigation';
  navigation.dataset.librarySlot = 'categories';
  navigation.setAttribute('aria-label', '书库分类');
  const switchCategory = (nextRoute) => {
    setLibraryOrganizationManageMode(false);
    setLibraryOrganizationHistory(nextRoute);
    renderLibraryOrganization(library);
    const selected = article.querySelector('.library-category-navigation [aria-current="page"]');
    selected?.focus({ preventScroll: true });
  };
  const appendCategory = (item, nextRoute, selected) => {
    const card = makeLibraryOrganizationCard(item);
    const button = card.querySelector('.library-organization-card-main');
    if (selected) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => switchCategory(nextRoute));
    navigation.appendChild(card);
  };
  appendCategory({
    title: '我的书籍', count: organization.books.length, onOpen: () => {}
  }, { mode: 'root', collectionId: null }, !isDetail);
  for (const item of organization.collections) {
    appendCategory({
      id: item.id, title: item.name,
      count: libraryOrganizationCount(organization, item.id),
      onOpen: () => {},
      onRename: manage ? (button) => showLibraryCollectionRenameForm(shell, library, item, button) : null,
      onDelete: manage ? (button) => deleteLibraryCollectionFromView(library, item, button) : null
    }, { mode: 'collection', collectionId: item.id }, collection?.id === item.id);
  }
  appendCategory({
    title: '未分类', count: organization.unassignedOrder.length,
    unassigned: true, onOpen: () => {}
  }, { mode: 'unassigned', collectionId: null }, route.mode === 'unassigned');
  {
    const collectionOrder = libraryOrderForRoute(organization, { mode: 'root' });
    for (const item of organization.collections) {
      const card = navigation.querySelector(`[data-library-collection-id="${item.id}"]`);
      if (card) addLibraryReorderControls(card, item.id, item.name, collectionOrder, 'collections', library, { leadingHandle: manage });
    }
    if (manage) navigation.classList.add('is-manage-mode');
    setupLibraryPointerReorder(navigation, collectionOrder, 'collections', library, {
      dragFromItemContent: manage,
      autoScroll: true
    });
  }
  booksSection.appendChild(navigation);
  const byId = new Map(organization.books.map((book) => [book.id, book]));
  const order = isDetail
    ? libraryOrderForRoute(organization, route)
    : organization.allBookOrder || organization.books.map((book) => book.id);
  const books = order.map((id) => byId.get(id)).filter(Boolean);
  const scope = collection ? collection.id : route.mode === 'unassigned' ? 'unassigned' : 'all';
  // Category chips scope everything below them, including Continue Reading.
  const recentCard = createLibraryRecentCard(books);
  if (recentCard) booksSection.appendChild(recentCard);
  booksSection.appendChild(books.length
    ? libraryOrganizationBookGrid(books, { library, scope, order })
    : collection
      ? makeLibraryOrganizationEmpty('这个分类还没有书', '点击上方的“添加书籍”，把书放进这个分类。')
      : route.mode === 'unassigned'
        ? makeLibraryOrganizationEmpty('所有书都已归类', '新扫描到的书会先出现在这里。')
        : makeLibraryOrganizationEmpty('书库还是空的', '在 fnOS 中授权书库目录后，EPUB、PDF、MOBI/AZW3、Markdown 和 TXT 会出现在这里。'));
  shell.appendChild(booksSection);
  article.appendChild(shell);
  setupLibraryFilter(shell);
  if (typeof setupLibraryImportDrop === 'function') setupLibraryImportDrop(shell, library, importContext);
  return true;
}

function makeLibraryOrganizationEmpty(message, guidance = '') {
  const empty = document.createElement('section');
  empty.className = 'library-empty';
  const icon = document.createElement('span');
  icon.className = 'library-empty-icon';
  icon.setAttribute('aria-hidden', 'true');
  empty.appendChild(icon);
  const title = document.createElement('h2');
  title.className = 'library-empty-title';
  title.textContent = message;
  empty.appendChild(title);
  if (guidance) {
    const copy = document.createElement('p');
    copy.className = 'library-empty-copy';
    copy.textContent = guidance;
    empty.appendChild(copy);
  }
  return empty;
}

function showLibraryCollectionForm(shell, library) {
  const existing = shell.querySelector('.library-collection-form:not(.library-collection-rename-form)');
  if (existing) { existing.querySelector('input')?.focus(); return; }
  const form = document.createElement('form');
  form.className = 'library-collection-form library-collection-create-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 80;
  input.placeholder = '分类名称';
  input.setAttribute('aria-label', '分类名称');
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'mode-btn';
  save.textContent = '保存';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mode-btn';
  cancel.textContent = '取消';
  const close = () => {
    form.remove();
    shell.querySelector('.library-create-button')?.focus({ preventScroll: true });
  };
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  form.append(input, save, cancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value.trim()) {
      input.setCustomValidity('请输入分类名称');
      input.reportValidity();
      return;
    }
    save.disabled = true;
    try {
      const next = await window.browserHost.createLibraryCollection(input.value, library.organization.revision);
      const created = next.collections.find((item) => !library.organization.collections.some((old) => old.id === item.id));
      if (created) setLibraryOrganizationHistory({ mode: 'collection', collectionId: created.id });
      setLibraryOrganizationManageMode(false);
      renderLibraryOrganization({ ...library, organization: next });
    } catch (error) {
      showHighlightHint(error.message || '创建分类失败');
      save.disabled = false;
    }
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  // Inline after the last category chip, where the new chip will appear.
  const navigation = shell.querySelector('.library-category-navigation');
  if (navigation) navigation.appendChild(form);
  else shell.insertBefore(form, shell.firstChild || null);
  input.focus({ preventScroll: true });
  form.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

function showLibraryCollectionRenameForm(shell, library, collection, trigger) {
  shell.querySelector('.library-collection-rename-form')?.remove();
  const form = document.createElement('form');
  form.className = 'library-collection-form library-collection-rename-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 80;
  input.value = collection.name;
  input.setAttribute('aria-label', `分类 ${collection.name} 的新名称`);
  input.addEventListener('input', () => input.setCustomValidity(''));
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'mode-btn';
  save.textContent = '保存名称';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mode-btn';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => { form.remove(); trigger.focus(); });
  form.append(input, save, cancel);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || name === collection.name) {
      if (!name) { input.setCustomValidity('请输入分类名称'); input.reportValidity(); }
      else { form.remove(); trigger.focus(); }
      return;
    }
    save.disabled = true;
    try {
      const next = await window.browserHost.renameLibraryCollection(collection.id, name, library.organization.revision);
      renderLibraryOrganization({ ...library, organization: next });
      document.querySelector(`[data-library-collection-id="${collection.id}"] .library-organization-card-rename`)?.focus();
    } catch (error) {
      showHighlightHint(error.message || '重命名失败，请重试');
      save.disabled = false;
    }
  });
  shell.querySelector('.library-category-navigation')?.after(form);
  input.focus();
  input.select();
}

// Renames a book for this reader only: the file on the NAS keeps its name and
// other fnOS users keep seeing the book's own title.
function showLibraryBookRenameDialog(library, book, trigger) {
  document.querySelector('.library-rename-dialog')?.remove();
  const originalTitle = book.originalTitle || book.title || '';
  const dialog = document.createElement('dialog');
  dialog.className = 'library-rename-dialog';
  dialog.setAttribute('aria-labelledby', 'libraryRenameTitle');
  const form = document.createElement('form');
  form.method = 'dialog';
  const heading = document.createElement('h2');
  heading.id = 'libraryRenameTitle';
  heading.textContent = '重命名';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 200;
  input.value = book.title || '';
  input.setAttribute('aria-label', '书名');
  input.addEventListener('input', () => input.setCustomValidity(''));
  const hint = document.createElement('p');
  hint.className = 'library-rename-hint';
  hint.textContent = book.originalTitle
    ? `原书名：${originalTitle}`
    : '只改变你在枕书里看到的书名，不会修改 NAS 上的文件。';
  const actions = document.createElement('div');
  actions.className = 'library-rename-actions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'library-rename-reset';
  reset.textContent = '恢复原名';
  reset.hidden = !book.originalTitle;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'is-primary';
  save.textContent = '保存';
  actions.append(reset, cancel, save);
  form.append(heading, input, hint, actions);
  dialog.appendChild(form);

  const close = () => {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
  const commit = async (title) => {
    for (const button of [reset, cancel, save]) button.disabled = true;
    try {
      const next = await window.browserHost.renameLibraryBook(book.id, title, library.organization.revision);
      const renamed = (next.books || []).find((entry) => entry.id === book.id);
      // The shelf, 继续阅读 and the reader all read titles from library.books.
      for (const entry of library.books || []) {
        if (entry.id !== book.id || !renamed) continue;
        entry.title = renamed.title;
        if (renamed.originalTitle) entry.originalTitle = renamed.originalTitle;
        else delete entry.originalTitle;
      }
      dialog.remove();
      renderLibraryOrganization({ ...library, organization: next });
      document.querySelector(`[data-reorder-id="${book.id}"] .library-book-rename`)?.focus({ preventScroll: true });
    } catch (error) {
      showHighlightHint(error.message || '重命名失败，请重试');
      for (const button of [reset, cancel, save]) button.disabled = false;
    }
  };
  cancel.addEventListener('click', close);
  reset.addEventListener('click', () => commit(''));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = input.value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (!title) {
      input.setCustomValidity('请输入书名');
      input.reportValidity();
      return;
    }
    if (title === book.title) return close();
    commit(title);
  });
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  input.focus();
  input.select();
}

async function deleteLibraryCollectionFromView(library, collection, button) {
  if (!window.browserHost.deleteLibraryCollection) return;
  if (!window.confirm(`删除分类“${collection.name}”？其中书籍将移到未分类，不会删除书籍文件。`)) return;
  button.disabled = true;
  try {
    const next = await window.browserHost.deleteLibraryCollection(collection.id, library.organization.revision);
    renderLibraryOrganization({ ...library, organization: next });
  } catch (error) {
    showHighlightHint(error.message || '删除分类失败');
    button.disabled = false;
  }
}

if (typeof window !== 'undefined') {
  window.renderLibraryOrganization = renderLibraryOrganization;
  window.createLibraryBookCard = createLibraryBookCard;
  if (!window.__libraryOrganizationPopstateBound) {
    window.__libraryOrganizationPopstateBound = true;
    window.addEventListener('popstate', () => {
      if (!document.querySelector('.library-organization-view')) return;
      const library = window.__libraryOrganizationLibrary;
      if (library) renderLibraryOrganization(library);
    });
  }
}
