/* BabyReader UI module: reader/actions */

'use strict';

/* ============================================================
   File Operations — Browser Fallback
   ============================================================ */
function openFileBrowser() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.md,.txt,.epub,text/markdown,text/plain,application/epub+zip';

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const isEpub = /\.epub$/i.test(file.name);
      const result = ev.target.result || '';
      window.appHost.receiveDocument({
        path: file.name,
        name: file.name,
        type: isEpub ? 'epub' : 'text',
        content: isEpub ? '' : result,
        data: isEpub ? String(result).split(',')[1] : undefined
      });
    };

    if (/\.epub$/i.test(file.name)) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  };

  input.click();
}

function saveFileBrowser() {
  const blob = new Blob([state.content || ''], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = state.currentName || 'document.md';
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   Highlight Export & Auto-save
   ============================================================ */
function formatHighlightsMd(highlights) {
  const bookName = (state.currentName || '未知书籍').replace(/\.epub$/i, '');
  const author = state.epubMetadata?.creator || '';

  let md = `# 《${bookName}》划线笔记\n\n`;
  if (author) md += `作者：${author}\n\n`;
  md += `---\n\n`;

  for (const h of highlights) {
    if (h.text) {
      md += h.date ? `- [${h.date}] ${h.text}\n\n` : `- ${h.text}\n\n`;
    }
  }
  return md;
}

function serializeHighlightForServer(highlight) {
  const domRange = highlight.domRange || highlight.locatorData || null;
  const locator = highlight.cfi || (domRange ? JSON.stringify({
    version: 1,
    type: 'dom-range',
    ...domRange
  }) : String(highlight.locator || highlight.id || ''));

  return {
    id: highlight.id || highlight.cfi || highlightId(),
    locator,
    chapterHref: normalizeChapterHref(highlight.chapterHref || domRange?.chapterHref || ''),
    text: selectedTextSignature(highlight.text),
    contextBefore: String(highlight.contextBefore || domRange?.contextBefore || '').slice(-240),
    contextAfter: String(highlight.contextAfter || domRange?.contextAfter || '').slice(0, 240),
    note: String(highlight.note || '').slice(0, 4000),
    color: ['yellow', 'green', 'blue', 'pink'].includes(highlight.color)
      ? highlight.color
      : state.highlightColor,
    createdAt: highlight.createdAt || highlight.date || new Date().toISOString()
  };
}

function queueHighlightSave() {
  if (!state.currentBookId || state.contentType !== 'epub') return Promise.resolve();

  const bookId = state.currentBookId;
  const revision = ++_highlightSaveRevision;
  const highlights = loadHighlights().map(serializeHighlightForServer);
  _highlightSaveChain = _highlightSaveChain.catch(() => {}).then(async () => {
    // Persist the captured book snapshot even if navigation switched books or
    // returned to the library while this serialized write was pending.
    await window.browserHost.saveHighlights(highlights, bookId);
    if (revision === _highlightSaveRevision) showHighlightHint('划线已保存');
  }).catch((error) => {
    console.error('保存划线失败', { bookId, revision, error });
    showHighlightHint(`划线保存失败：${error.message || '未知错误'}`);
    throw error;
  });
  return _highlightSaveChain;
}

function autoSaveHighlights() {
  return queueHighlightSave();
}

async function flushPendingHighlightSaves() {
  try {
    await _highlightSaveChain;
  } catch {
    throw new Error('仍有划线未能保存，请检查网络后重试');
  }
}

function exportHighlights() {
  if (state.contentType !== 'epub') return;
  const highlights = loadHighlights();
  if (!highlights.length) {
    showHighlightHint('还没有 EPUB 划线');
    return;
  }

  const md = formatHighlightsMd(highlights);

  const showCopied = () => {
    flashFileName(`已导出 ${highlights.length} 条划线`, 2600);
  };

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = highlightFileName();
  a.click();
  URL.revokeObjectURL(url);
  navigator.clipboard?.writeText?.(md).catch(() => {});
  showCopied();
}

function flashFileName(message, duration = 1600) {
  const fileNameEl = document.getElementById('fileName');
  if (!fileNameEl) return;

  const wasHidden = getComputedStyle(fileNameEl).display === 'none';
  const prev = fileNameEl.dataset.flashPrev ?? fileNameEl.textContent;
  fileNameEl.dataset.flashPrev = prev;
  clearTimeout(_fileNameFlashTimeout);

  if (wasHidden) fileNameEl.style.display = 'block';
  fileNameEl.textContent = message;
  fileNameEl.style.color = 'var(--accent)';
  _fileNameFlashTimeout = setTimeout(() => {
    fileNameEl.textContent = fileNameEl.dataset.flashPrev || '';
    fileNameEl.style.color = '';
    if (wasHidden) fileNameEl.style.display = '';
    delete fileNameEl.dataset.flashPrev;
  }, duration);
}

function showHighlightHint(message) {
  flashFileName(message, 1600);
}
