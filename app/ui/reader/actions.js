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
function exportChapterPathKey(value) {
  let path = String(value || '').trim();
  if (path.startsWith('epub-path:')) path = path.slice('epub-path:'.length);
  path = path.split('#', 1)[0].split('?', 1)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when an EPUB contains a malformed escape sequence.
  }
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/').toLocaleLowerCase();
}

function exportChapterLabelFromPath(path) {
  if (!path) return '未定位章节';
  const name = path.split('/').pop() || path;
  return name.replace(/\.(?:x?html?|xml)$/i, '') || '未命名章节';
}

function exportChapterInfo() {
  const byPath = new Map();
  for (const [order, item] of (Array.isArray(state.toc) ? state.toc : []).entries()) {
    const key = exportChapterPathKey(item?.target);
    if (!key || byPath.has(key)) continue;
    byPath.set(key, {
      label: String(item.label || '').trim() || exportChapterLabelFromPath(key),
      depth: Math.max(0, Number(item.depth) || 0),
      order
    });
  }
  return byPath;
}

function exportAnnotationChapterKey(annotation) {
  return exportChapterPathKey(
    annotation?.chapterHref
      || annotation?.domRange?.chapterHref
      || annotation?.locatorData?.chapterHref
  );
}

function formatExportAnnotation(annotation) {
  const text = String(annotation.text || '').trim();
  if (!text) return '';
  const datePrefix = annotation.date ? `[${annotation.date}] ` : '';
  const thought = String(annotation.thought || annotation.note || '').trim();
  if (!thought) return `- ${datePrefix}${text}\n\n`;

  const quotedText = text.split(/\r?\n/).map((line) => `> ${datePrefix}${line}`).join('\n');
  return `${quotedText}\n\n想法：${thought}\n\n`;
}

function formatHighlightsMd(highlights) {
  const bookName = (state.currentName || '未知书籍').replace(/\.epub$/i, '');
  const author = state.epubMetadata?.creator || '';
  const chapterInfo = exportChapterInfo();
  const groups = new Map();
  let fallbackOrder = chapterInfo.size;

  let md = `# 《${bookName}》标记与想法\n\n`;
  if (author) md += `作者：${author}\n\n`;
  md += `---\n\n`;

  for (const annotation of highlights || []) {
    if (!annotation?.text) continue;
    const key = exportAnnotationChapterKey(annotation) || '__unlocated__';
    if (!groups.has(key)) {
      const known = chapterInfo.get(key);
      groups.set(key, {
        key,
        label: known?.label || '未定位章节',
        depth: known?.depth || 0,
        order: known?.order ?? fallbackOrder++,
        annotations: []
      });
    }
    groups.get(key).annotations.push(annotation);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => a.order - b.order);
  for (const group of orderedGroups) {
    const headingLevel = Math.min(6, Math.max(2, group.depth + 2));
    md += `${'#'.repeat(headingLevel)} ${group.label}\n\n`;
    for (const annotation of group.annotations) {
      md += formatExportAnnotation(annotation);
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
    thought: String(highlight.thought || highlight.note || '').slice(0, 4000),
    // Mirror the canonical thought into the legacy field during migration.
    note: String(highlight.thought || highlight.note || '').slice(0, 4000),
    kind: ['highlight', 'thought'].includes(highlight.kind) ? highlight.kind : 'highlight',
    style: ['marker', 'wave', 'line', 'none'].includes(highlight.style) ? highlight.style : 'marker',
    color: ['yellow', 'green', 'blue', 'pink'].includes(highlight.color)
      ? highlight.color
      : state.highlightColor,
    createdAt: highlight.createdAt || highlight.date || new Date().toISOString(),
    updatedAt: highlight.updatedAt || highlight.createdAt || highlight.date || new Date().toISOString()
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
    if (revision === _highlightSaveRevision) showHighlightHint('批注已保存');
  }).catch((error) => {
    console.error('保存划线失败', { bookId, revision, error });
    showHighlightHint(`批注保存失败：${error.message || '未知错误'}`);
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

let pdfNotesExportPending = null;

async function exportPdfNotes() {
  const bookId = state.currentBookId;
  const bookName = state.currentName;
  const generation = window.pdfReaderController?.getGeneration?.();
  if (pdfNotesExportPending?.bookId === bookId && pdfNotesExportPending.generation === generation) return;
  if (!bookId || !bookName || typeof window.browserHost?.getPdfAnnotations !== 'function') {
    showHighlightHint('请先打开 PDF');
    return;
  }
  const session = { bookId, generation };
  const button = document.getElementById('btnExportHighlights');
  pdfNotesExportPending = session;
  if (button) {
    button.disabled = true;
    button.dataset.exportBookId = bookId;
    button.dataset.exportGeneration = String(generation ?? '');
  }
  try {
    const result = await window.browserHost.getPdfAnnotations(bookId);
    if (state.contentType !== 'pdf' || state.currentBookId !== bookId || state.currentName !== bookName
      || (generation != null && window.pdfReaderController?.getGeneration?.() !== generation)) {
      if (state.contentType === 'pdf' && pdfNotesExportPending === session) {
        showHighlightHint('已取消上一书的笔记导出');
      }
      return;
    }
    if (!Array.isArray(result?.annotations)) throw new Error('PDF 笔记响应无效');
    const markdown = formatPdfNotesMarkdown({ title: bookName, annotations: result.annotations });
    const safeName = bookName.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'PDF 笔记';
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName}.md`;
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    showHighlightHint(`已导出 ${result.annotations.length} 条 PDF 笔记`);
  } catch (error) {
    if (pdfNotesExportPending === session) {
      showHighlightHint(error?.code === 'PDF_EXPORT_EMPTY' ? '还没有 PDF 标记与想法'
        : error?.code === 'PDF_EXPORT_LIMIT' ? error.message
          : error?.code === 'PDF_EXPORT_INVALID' ? 'PDF 笔记数据无效，未导出'
            : 'PDF 笔记获取失败，未导出');
    }
  } finally {
    if (pdfNotesExportPending === session) {
      pdfNotesExportPending = null;
      if (button) {
        button.disabled = false;
        delete button.dataset.exportBookId;
        delete button.dataset.exportGeneration;
      }
    }
  }
}

function exportHighlights() {
  if (state.contentType === 'pdf') return exportPdfNotes();
  if (state.contentType !== 'epub') return;
  const highlights = loadHighlights();
  if (!highlights.length) {
    showHighlightHint('还没有 EPUB 划线');
    return;
  }

  const md = formatHighlightsMd(highlights);

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = highlightFileName();
  a.click();
  URL.revokeObjectURL(url);
  showHighlightHint(`已导出 ${highlights.length} 条 EPUB 笔记`);
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

let readerFeedbackTimer = null;

function showHighlightHint(message, { persistent = /失败|错误|无法|超时|重试/.test(String(message)) } = {}) {
  let feedback = document.getElementById('readerFeedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'readerFeedback';
    feedback.className = 'reader-feedback';
    const text = document.createElement('span');
    text.setAttribute('role', 'status');
    text.setAttribute('aria-live', 'polite');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.addEventListener('click', () => { feedback.hidden = true; });
    feedback.append(text, close);
    document.body.appendChild(feedback);
  }
  clearTimeout(readerFeedbackTimer);
  feedback.querySelector('span').textContent = String(message || '');
  feedback.hidden = false;
  if (!persistent) readerFeedbackTimer = setTimeout(() => { feedback.hidden = true; }, 5000);
}
