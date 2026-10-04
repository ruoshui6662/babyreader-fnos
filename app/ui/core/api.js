/* 枕书 UI module: core/api */

'use strict';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    },
    ...options
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Object.assign(new Error(detail.error || `请求失败：${response.status}`), {
      status: response.status,
      ...(typeof detail.code === 'string' ? { code: detail.code } : {})
    });
  }
  return response;
}

const MOBI_PREPARE_RETRY_MS = [1500, 3000, 5000, 8000, 12000, 20000];

// MOBI/AZW3 books are converted on first open; the server answers
// MOBI_PREPARING while that runs, so keep the user informed and retry.
async function requestBookContent(book) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await apiRequest(`/books/${encodeURIComponent(book.id)}/content`, {
        headers: { Accept: book.type === 'epub' ? 'application/epub+zip' : 'text/plain' }
      });
    } catch (error) {
      if (error.code !== 'MOBI_PREPARING' || attempt >= MOBI_PREPARE_RETRY_MS.length) throw error;
      if (attempt === 0 && typeof showHighlightHint === 'function') showHighlightHint('正在准备这本书，请稍候…');
      await new Promise((resolve) => setTimeout(resolve, MOBI_PREPARE_RETRY_MS[attempt]));
    }
  }
}

async function readAiEventStream(response, handlers = {}) {
  if (!response.body?.getReader) {
    const payload = await response.json().catch(() => ({}));
    handlers.onDone?.(payload);
    return payload;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastEvent = null;
  let completed = false;
  let streamError = null;
  const dispatch = (frame) => {
    const lines = frame.split('\n');
    let eventName = 'message';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    const data = dataLines.join('\n').trim();
    if (!data) return;
    if (data === '[DONE]') {
      completed = true;
      lastEvent = { event: 'done', data: {} };
      handlers.onDone?.({});
      return;
    }
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    lastEvent = { event: eventName, data: payload };
    if (eventName === 'meta') handlers.onMeta?.(payload);
    else if (eventName === 'progress') handlers.onProgress?.(payload);
    else if (eventName === 'delta') handlers.onDelta?.(payload.delta || '');
    else if (eventName === 'done') { completed = true; handlers.onDone?.(payload); }
    else if (eventName === 'error') {
      streamError = new Error(payload?.message || 'AI 回答失败，请重试。');
      handlers.onError?.(payload);
    }
  };

  const consume = (chunk, flush = false) => {
    buffer += chunk.replace(/\r/g, '');
    const frames = buffer.split('\n\n');
    buffer = flush ? '' : (frames.pop() || '');
    for (const frame of flush ? frames.concat(buffer) : frames) {
      if (frame.trim()) dispatch(frame);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) consume(tail);
  if (buffer.trim()) consume('\n\n', true);
  if (streamError) throw streamError;
  if (!completed) throw new Error('AI 回答传输中断，请重试。');
  return lastEvent?.data || {};
}

window.browserHost = {
  async getSession() {
    return (await apiRequest('/session')).json();
  },

  async saveReadingTime(entries, { keepalive = false } = {}) {
    return (await apiRequest('/reading-time', {
      method: 'POST',
      body: JSON.stringify({ entries }),
      ...(keepalive ? { keepalive: true } : {})
    })).json();
  },

  async getNotesSummary() {
    return (await apiRequest('/notes')).json();
  },

  async getBookNotes(bookId) {
    return (await apiRequest(`/notes/${encodeURIComponent(bookId)}`)).json();
  },

  async searchNotes(query) {
    return (await apiRequest(`/notes/search?q=${encodeURIComponent(query)}`)).json();
  },

  async getReadingStats(range, anchor) {
    const query = new URLSearchParams({ range, anchor, tz: String(new Date().getTimezoneOffset()) });
    return (await apiRequest(`/stats?${query}`)).json();
  },

  async getReadingTime(from, to) {
    return (await apiRequest(`/reading-time?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).json();
  },

  async getLibrary() {
    return (await apiRequest('/library')).json();
  },

  // Uploads one file to the admin import endpoint. XHR (not fetch) so the
  // queue can show upload progress and cancel an in-flight transfer.
  importBook(file, { onProgress } = {}) {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open('PUT', `${API_PREFIX}/library/imports`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Zhenshu-Request', 'import');
      xhr.setRequestHeader('X-Zhenshu-Filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onProgress === 'function') onProgress(event.loaded / event.total);
      };
      xhr.onload = () => {
        let body = {};
        try {
          body = JSON.parse(xhr.responseText || '{}');
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(Object.assign(new Error(body.error || `导入失败：${xhr.status}`), { status: xhr.status, code: body.code, details: body }));
      };
      xhr.onerror = () => reject(Object.assign(new Error('网络连接中断，导入未完成。'), { code: 'IMPORT_NETWORK' }));
      xhr.onabort = () => reject(Object.assign(new Error('已取消'), { code: 'IMPORT_CANCELLED' }));
      xhr.send(file);
    });
    return { promise, abort: () => xhr.abort() };
  },

  async getLibraryOrganization() {
    return (await apiRequest('/library/organization')).json();
  },

  async createLibraryCollection(name, revision) {
    return (await apiRequest('/library/collections', {
      method: 'POST',
      body: JSON.stringify({ name, revision })
    })).json();
  },

  async renameLibraryCollection(collectionId, name, revision) {
    if (!collectionId) throw new Error('分类标识无效');
    return (await apiRequest(`/library/collections/${encodeURIComponent(collectionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, revision })
    })).json();
  },

  async deleteLibraryCollection(collectionId, revision) {
    if (!collectionId) throw new Error('分类标识无效');
    return (await apiRequest(`/library/collections/${encodeURIComponent(collectionId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ revision })
    })).json();
  },

  async placeLibraryBook(bookId, collectionId, beforeBookId, revision) {
    if (!bookId) throw new Error('书籍标识无效');
    return (await apiRequest(`/library/books/${encodeURIComponent(bookId)}/placement`, {
      method: 'PUT',
      body: JSON.stringify({ collectionId: collectionId ?? null, beforeBookId: beforeBookId ?? null, revision })
    })).json();
  },

  async renameLibraryBook(bookId, title, revision) {
    if (!bookId) throw new Error('书籍标识无效');
    return (await apiRequest(`/library/books/${encodeURIComponent(bookId)}/title`, {
      method: 'PUT',
      body: JSON.stringify({ title: title ?? '', revision })
    })).json();
  },

  async reorderLibraryOrganization(scope, order, revision) {
    return (await apiRequest('/library/organization/order', {
      method: 'PUT',
      body: JSON.stringify({ scope, order, revision })
    })).json();
  },

  async updateLibraryOrganizationPreferences(viewMode, revision) {
    return (await apiRequest('/library/organization/preferences', {
      method: 'PUT',
      body: JSON.stringify({ viewMode, revision })
    })).json();
  },

  async getUserState() {
    return (await apiRequest('/state')).json();
  },

  async saveSettings(settings) {
    return (await apiRequest('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    })).json();
  },

  async getScanStatus() {
    return (await apiRequest('/library/scan/status')).json();
  },

  async scanLibrary() {
    return (await apiRequest('/library/scan', { method: 'POST' })).json();
  },

  async openBook(book) {
    if (typeof setGlassAmbientBook === 'function') setGlassAmbientBook(book);
    // The phone reading drawer shows the open book on top.
    state.currentBookInfo = { id: book.id, title: book.title || '', author: book.author || '', coverUrl: book.coverUrl || null };
    if (book.type === 'pdf') {
      return window.appHost.receiveDocument({
        path: book.relativePath,
        name: book.title,
        type: 'pdf',
        contentUrl: `${API_PREFIX}/books/${encodeURIComponent(book.id)}/content`,
        bookId: book.id
      });
    }
    const response = await requestBookContent(book);
    if (book.type === 'epub') {
      return window.appHost.receiveDocument({
        path: book.relativePath,
        name: book.title,
        type: 'epub',
        content: '',
        // Keep the archive binary. Converting a large EPUB to a binary string
        // and then Base64 duplicates the whole book before JSZip even starts
        // parsing it, which can monopolise the fnOS browser main thread.
        data: await response.arrayBuffer(),
        bookId: book.id
      });
    }
    return window.appHost.receiveDocument({
      path: book.relativePath,
      name: book.title,
      type: 'text',
      content: await response.text(),
      bookId: book.id
    });
  },

  async saveProgress(progress) {
    if (!state.currentBookId) return;
    await apiRequest(`/books/${state.currentBookId}/progress`, {
      method: 'PUT',
      body: JSON.stringify(progress)
    });
  },

  async saveHighlights(highlights, bookId = state.currentBookId) {
    if (!bookId) return;
    await apiRequest(`/books/${encodeURIComponent(bookId)}/highlights`, {
      method: 'PUT',
      body: JSON.stringify({ highlights })
    });
  },

  async getPdfAnnotations(bookId = state.currentBookId) {
    if (!bookId) return { annotations: [] };
    const result = await (await apiRequest(`/books/${encodeURIComponent(bookId)}/pdf-annotations`)).json();
    if (typeof savePdfAnnotations === 'function') savePdfAnnotations(bookId, result.annotations || []);
    return result;
  },

  async createPdfAnnotation(annotation, bookId = state.currentBookId) {
    if (!bookId) throw new Error('当前没有打开的 PDF');
    const result = await (await apiRequest(`/books/${encodeURIComponent(bookId)}/pdf-annotations`, {
      method: 'POST',
      body: JSON.stringify(annotation)
    })).json();
    if (result.annotation && typeof loadPdfAnnotations === 'function') {
      const current = loadPdfAnnotations(bookId).filter((item) => item.id !== result.annotation.id);
      savePdfAnnotations(bookId, [...current, result.annotation]);
    }
    return result;
  },

  async updatePdfAnnotation(annotationId, patch, bookId = state.currentBookId) {
    if (!bookId || !annotationId) throw new Error('PDF 标记标识无效');
    const result = await (await apiRequest(`/books/${encodeURIComponent(bookId)}/pdf-annotations/${encodeURIComponent(annotationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    })).json();
    if (result.annotation && typeof loadPdfAnnotations === 'function') {
      const current = loadPdfAnnotations(bookId).map((item) => item.id === annotationId ? result.annotation : item);
      savePdfAnnotations(bookId, current);
    }
    return result;
  },

  async deletePdfAnnotation(annotationId, bookId = state.currentBookId) {
    if (!bookId || !annotationId) return { deleted: false, id: annotationId };
    const result = await (await apiRequest(`/books/${encodeURIComponent(bookId)}/pdf-annotations/${encodeURIComponent(annotationId)}`, {
      method: 'DELETE'
    })).json();
    if (result.deleted && typeof loadPdfAnnotations === 'function') {
      savePdfAnnotations(bookId, loadPdfAnnotations(bookId).filter((item) => item.id !== annotationId));
    }
    return result;
  },

  async getBookmarks(bookId = state.currentBookId) {
    if (!bookId) return [];
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/bookmarks`)).json();
  },

  async createBookmark(bookmark, bookId = state.currentBookId) {
    if (!bookId) return null;
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify(bookmark)
    })).json();
  },

  async deleteBookmark(bookmarkId, bookId = state.currentBookId) {
    if (!bookId || !bookmarkId) return { deleted: false, id: bookmarkId };
    return (await apiRequest(
      `/books/${encodeURIComponent(bookId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      { method: 'DELETE' }
    )).json();
  },

  async getAiConversations(bookId = state.currentBookId) {
    if (!bookId) return { activeConversationId: null, conversations: [] };
    return (await apiRequest(
      `/books/${encodeURIComponent(bookId)}/ai/conversations`
    )).json();
  },

  async getAiConversation(conversationId, bookId = state.currentBookId) {
    if (!bookId || !conversationId) throw new Error('会话标识无效');
    return (await apiRequest(
      `/books/${encodeURIComponent(bookId)}/ai/conversations/${encodeURIComponent(conversationId)}`
    )).json();
  },

  async createAiConversation(title = '', bookId = state.currentBookId) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(
      `/books/${encodeURIComponent(bookId)}/ai/conversations`,
      {
        method: 'POST',
        body: JSON.stringify({ title: String(title || '').trim() })
      }
    )).json();
  },

  async deleteAiConversation(conversationId, bookId = state.currentBookId) {
    if (!bookId || !conversationId) throw new Error('会话标识无效');
    return (await apiRequest(
      `/books/${encodeURIComponent(bookId)}/ai/conversations/${encodeURIComponent(conversationId)}`,
      { method: 'DELETE' }
    )).json();
  },

  async clearAiConversation(conversationId, bookId = state.currentBookId) {
    if (!bookId || !conversationId) throw new Error('会话标识无效');
    return (await apiRequest(
      `/books/${encodeURIComponent(bookId)}/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'DELETE' }
    )).json();
  },

  async aiStatus() {
    return (await apiRequest('/ai/status')).json();
  },

  async getAiConfig() {
    return (await apiRequest('/ai/config')).json();
  },

  async saveAiConfig(config) {
    return (await apiRequest('/ai/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    })).json();
  },

  async testAiConnection(config) {
    return (await apiRequest('/ai/test-connection', {
      method: 'POST',
      body: JSON.stringify(config)
    })).json();
  },

  async listAiIndexes() {
    return (await apiRequest('/ai/indexes')).json();
  },

  async deleteAiIndex(bookId) {
    if (!bookId) throw new Error('索引标识无效');
    return (await apiRequest('/ai/indexes/' + encodeURIComponent(bookId), {
      method: 'DELETE'
    })).json();
  },

  async cleanupAiIndexes(kind = 'all') {
    return (await apiRequest('/ai/indexes/cleanup', {
      method: 'POST',
      body: JSON.stringify({ kind, confirm: true })
    })).json();
  },

  async askAi(bookId, payload) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/ai/ask`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })).json();
  },

  async searchAiBook(bookId, payload) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/ai/search`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })).json();
  },

  async searchBook(bookId, {
    query = '',
    scope = 'book',
    chapterIndex = null,
    limit = 20,
    cursor = null,
    signal
  } = {}) {
    if (!bookId) throw new Error('当前没有打开的书');
    const params = new URLSearchParams();
    params.set('q', String(query || '').trim());
    params.set('scope', scope === 'chapter' ? 'chapter' : 'book');
    if (scope === 'chapter' && Number.isInteger(chapterIndex)) {
      params.set('chapterIndex', String(chapterIndex));
    }
    params.set('limit', String(Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)))));
    if (typeof cursor === 'string' && cursor) params.set('cursor', cursor);
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/search?${params.toString()}`, {
      signal
    })).json();
  },

  async getAiBookMap(bookId) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/ai/map`)).json();
  },

  async generateAiBookMap(bookId, { force = false } = {}) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/ai/map`, {
      method: 'POST',
      body: JSON.stringify({ force })
    })).json();
  },

  async cancelAiBookMap(bookId) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/ai/map/job`, { method: 'DELETE' })).json();
  },

  async buildAiVectors(bookId) {
    if (!bookId) throw new Error('当前没有打开的书');
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/ai/vectors`, { method: 'POST', body: JSON.stringify({}) })).json();
  },

  async askAiStream(bookId, payload, handlers = {}, signal) {
    if (!bookId) throw new Error('当前没有打开的书');
    const response = await fetch(`${API_PREFIX}/books/${encodeURIComponent(bookId)}/ai/ask/stream`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `请求失败：${response.status}`);
    }
    return readAiEventStream(response, handlers);
  }
};
