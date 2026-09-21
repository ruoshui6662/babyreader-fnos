/* BabyReader UI module: core/api */

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
    throw new Error(detail.error || `请求失败：${response.status}`);
  }
  return response;
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
    else if (eventName === 'delta') handlers.onDelta?.(payload.delta || '');
    else if (eventName === 'done') handlers.onDone?.(payload);
    else if (eventName === 'error') handlers.onError?.(payload);
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
  return lastEvent?.data || {};
}

window.browserHost = {
  async getSession() {
    return (await apiRequest('/session')).json();
  },

  async getLibrary() {
    return (await apiRequest('/library')).json();
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
    const response = await apiRequest(`/books/${encodeURIComponent(book.id)}/content`, {
      headers: { Accept: book.type === 'epub' ? 'application/epub+zip' : 'text/plain' }
    });
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
    return (await apiRequest(`/books/${encodeURIComponent(bookId)}/search?${params.toString()}`, {
      signal
    })).json();
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
