/* BabyReader UI module: reader/pdf-notes-export */

'use strict';

const PDF_EXPORT_MAX_RECORDS = 500;
const PDF_EXPORT_MAX_FIELD_CHARS = 4000;
const PDF_EXPORT_MAX_BYTES = 1024 * 1024;

function pdfExportError(code, message) {
  return Object.assign(new Error(message), { code });
}

function escapePdfExportText(value) {
  return String(value).replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&')
    .replace(/\n/g, '\n> ');
}

function formatPdfNotesMarkdown({ title, annotations } = {}) {
  if (!Array.isArray(annotations)) throw pdfExportError('PDF_EXPORT_INVALID', 'PDF 笔记数据无效');
  if (annotations.length === 0) throw pdfExportError('PDF_EXPORT_EMPTY', '还没有 PDF 标记与想法');
  if (annotations.length > PDF_EXPORT_MAX_RECORDS) throw pdfExportError('PDF_EXPORT_LIMIT', 'PDF 笔记数量超出导出上限');

  const seen = new Set();
  const rows = annotations.map((annotation) => {
    if (!annotation || annotation.type !== 'pdf' || typeof annotation.id !== 'string'
      || !annotation.id || seen.has(annotation.id)
      || !Array.isArray(annotation.targets) || !annotation.targets.length || annotation.targets.length > 8) {
      throw pdfExportError('PDF_EXPORT_INVALID', 'PDF 笔记记录无效');
    }
    seen.add(annotation.id);
    const pages = annotation.targets.map((target) => target?.pageIndex);
    if (pages.some((page) => !Number.isInteger(page) || page < 0 || page >= 10000)) {
      throw pdfExportError('PDF_EXPORT_INVALID', 'PDF 笔记页码无效');
    }
    const text = String(annotation.text || '').trim();
    const thought = String(annotation.thought || '').trim();
    if (!text && !thought) throw pdfExportError('PDF_EXPORT_INVALID', 'PDF 笔记内容为空');
    if (text.length > PDF_EXPORT_MAX_FIELD_CHARS || thought.length > PDF_EXPORT_MAX_FIELD_CHARS) {
      throw pdfExportError('PDF_EXPORT_LIMIT', 'PDF 笔记内容超出导出上限');
    }
    return {
      firstPage: Math.min(...pages) + 1,
      lastPage: Math.max(...pages) + 1,
      text,
      thought,
      stale: annotation.sourceStale === true,
      createdAt: String(annotation.createdAt || ''),
      id: annotation.id
    };
  });
  rows.sort((a, b) => a.firstPage - b.firstPage
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const bookTitle = String(title || '未知书籍').replace(/\.pdf$/i, '').trim();
  if (bookTitle.length > 300) throw pdfExportError('PDF_EXPORT_LIMIT', '书名超出导出上限');
  let markdown = `# 《${escapePdfExportText(bookTitle)}》标记与想法\n\n---\n\n`;
  let currentPage = null;
  for (const row of rows) {
    if (currentPage !== row.firstPage) {
      currentPage = row.firstPage;
      markdown += `## 第 ${currentPage} 页\n\n`;
    }
    const pageLabel = row.firstPage === row.lastPage
      ? `第 ${row.firstPage} 页` : `第 ${row.firstPage}–${row.lastPage} 页`;
    markdown += `- ${pageLabel}${row.stale ? ' · 原文件已变化，定位不可用' : ''}\n\n`;
    if (row.text) markdown += `> ${escapePdfExportText(row.text)}\n\n`;
    if (row.thought) markdown += `想法：\n\n> ${escapePdfExportText(row.thought)}\n\n`;
    if (new TextEncoder().encode(markdown).length > PDF_EXPORT_MAX_BYTES) {
      throw pdfExportError('PDF_EXPORT_LIMIT', 'PDF 笔记文件超出导出上限');
    }
  }
  return markdown;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { formatPdfNotesMarkdown };
