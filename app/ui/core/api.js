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
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return window.appHost.receiveDocument({
        path: book.relativePath,
        name: book.title,
        type: 'epub',
        content: '',
        data: btoa(binary),
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
  }
};
