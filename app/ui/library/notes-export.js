'use strict';

/* global showHighlightHint */

/*
 * 笔记导出：Markdown file, or a print-ready page the browser saves as PDF.
 * Input is one or more note documents `{ book, notes }`, notes already in
 * reading order with their chapter names (from /api/notes/:bookId).
 */

const NOTES_EXPORT_COLORS = Object.freeze({
  yellow: { label: '黄色', hex: '#E2B93B' },
  green: { label: '绿色', hex: '#5BAE78' },
  blue: { label: '蓝色', hex: '#4F8FD8' },
  pink: { label: '粉色', hex: '#D9688F' }
});

function notesExportDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function notesExportChapter(note) {
  const chapter = String(note.chapter || '').trim();
  return chapter && chapter !== '其他' ? chapter : '';
}

function notesExportBookTitle(book) {
  const title = String(book?.title || '').trim() || '已移除的书';
  return /^《.*》$/.test(title) ? title : `《${title}》`;
}

// Text that would otherwise turn into Markdown syntax at the start of a line.
function escapeNotesMarkdownLine(line) {
  return line
    .replace(/([\\`*_[\]<>])/g, '\\$1')
    .replace(/^(\s*)([#+\-=|])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

function notesMarkdownBlock(text, prefix = '') {
  return String(text || '').replace(/\r\n?/g, '\n').trim().split('\n')
    .map((line) => `${prefix}${escapeNotesMarkdownLine(line.trim())}`.trimEnd())
    .join('\n');
}

function notesCounts(notes) {
  const thoughts = notes.filter((note) => String(note.thought || '').trim()).length;
  return { notes: notes.length, thoughts };
}

function appendBookMarkdown(lines, { book, notes }, { level }) {
  const heading = '#'.repeat(level);
  let chapter = null;
  for (const note of notes) {
    const label = notesExportChapter(note);
    if (label && label !== chapter) {
      lines.push(`${heading} ${escapeNotesMarkdownLine(label)}`, '');
      chapter = label;
    }
    if (String(note.text || '').trim()) lines.push(notesMarkdownBlock(note.text, '> '), '');
    if (String(note.thought || '').trim()) {
      lines.push(`**想法**：${notesMarkdownBlock(note.thought).replace(/\n/g, '  \n')}`, '');
    }
    const meta = [notesExportDay(note.createdAt), NOTES_EXPORT_COLORS[note.color]?.label ? `${NOTES_EXPORT_COLORS[note.color].label}划线` : '']
      .filter(Boolean).join(' · ');
    if (meta) lines.push(`<sub>${meta}</sub>`, '');
  }
  return lines;
}

/**
 * Markdown for one book (`documents.length === 1`, `all` false) or for
 * every book ("全部笔记"): books become ## sections, chapters ###.
 */
function formatNotesMarkdown(documents, { all = false, now = new Date() } = {}) {
  const docs = documents.filter((doc) => doc && Array.isArray(doc.notes) && doc.notes.length);
  const lines = [];
  const exported = notesExportDay(now.toISOString());
  if (!all && docs.length === 1) {
    const [{ book, notes }] = docs;
    const counts = notesCounts(notes);
    lines.push(`# ${notesExportBookTitle(book)}读书笔记`, '');
    const meta = [book.author ? `作者：${book.author}` : '', `${counts.notes} 条书摘`, counts.thoughts ? `${counts.thoughts} 条想法` : '', `导出于 ${exported}`]
      .filter(Boolean).join(' · ');
    lines.push(meta, '');
    appendBookMarkdown(lines, docs[0], { level: 2 });
  } else {
    const total = docs.reduce((sum, doc) => sum + doc.notes.length, 0);
    const thoughts = docs.reduce((sum, doc) => sum + notesCounts(doc.notes).thoughts, 0);
    lines.push('# 全部读书笔记', '');
    lines.push([`${docs.length} 本书`, `${total} 条书摘`, thoughts ? `${thoughts} 条想法` : '', `导出于 ${exported}`].filter(Boolean).join(' · '), '');
    for (const doc of docs) {
      lines.push(`## ${notesExportBookTitle(doc.book)}`, '');
      const counts = notesCounts(doc.notes);
      lines.push([doc.book.author ? `作者：${doc.book.author}` : '', `${counts.notes} 条书摘`].filter(Boolean).join(' · '), '');
      appendBookMarkdown(lines, doc, { level: 3 });
    }
  }
  lines.push('---', '', '由枕书导出', '');
  return lines.join('\n');
}

function notesExportFileName(documents, { all = false, extension = 'md', now = new Date() } = {}) {
  const day = notesExportDay(now.toISOString()).replace(/-/g, '');
  const base = !all && documents.length === 1
    ? `${String(documents[0].book?.title || '书摘').replace(/[<>:"/\\|?*\x00-\x1f\s]+/g, '').slice(0, 40) || '书摘'}-读书笔记`
    : '全部读书笔记';
  return `${base}-${day}.${extension}`;
}

/* ---------- Print / PDF ---------- */

function escapeNotesHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function notesHtmlParagraphs(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n+/)
    .map((line) => `<p>${escapeNotesHtml(line.trim())}</p>`).join('');
}

function notesBookHtml({ book, notes }, { level, cover }) {
  const parts = [];
  let chapter = null;
  for (const note of notes) {
    const label = notesExportChapter(note);
    if (label && label !== chapter) {
      parts.push(`<h${level} class="chapter">${escapeNotesHtml(label)}</h${level}>`);
      chapter = label;
    }
    const color = NOTES_EXPORT_COLORS[note.color]?.hex || NOTES_EXPORT_COLORS.yellow.hex;
    parts.push('<article class="note">');
    if (String(note.text || '').trim()) parts.push(`<blockquote style="border-color:${color}">${notesHtmlParagraphs(note.text)}</blockquote>`);
    if (String(note.thought || '').trim()) parts.push(`<div class="thought">${notesHtmlParagraphs(note.thought)}</div>`);
    const day = notesExportDay(note.createdAt);
    if (day) parts.push(`<div class="date">${day}</div>`);
    parts.push('</article>');
  }
  const counts = notesCounts(notes);
  const meta = [book.author || '', `${counts.notes} 条书摘`, counts.thoughts ? `${counts.thoughts} 条想法` : ''].filter(Boolean);
  const coverHtml = cover && book.coverUrl
    ? `<img class="cover" src="${escapeNotesHtml(new URL(book.coverUrl, document.baseURI).href)}" alt="">`
    : '';
  return { meta, coverHtml, body: parts.join('\n') };
}

/** A standalone, print-ready HTML page for the notes. */
function notesPrintHtml(documents, { all = false, now = new Date() } = {}) {
  const docs = documents.filter((doc) => doc && Array.isArray(doc.notes) && doc.notes.length);
  const exported = notesExportDay(now.toISOString());
  const fontCss = ['literata', 'noto-serif-sc'].map((folder) =>
    `<link rel="stylesheet" href="${escapeNotesHtml(new URL(`vendor/fonts/${folder}/font.css?v=1`, document.baseURI).href)}">`).join('');
  let title;
  let content;
  if (!all && docs.length === 1) {
    const doc = docs[0];
    const { meta, coverHtml, body } = notesBookHtml(doc, { level: 2, cover: true });
    title = `${notesExportBookTitle(doc.book)}读书笔记`;
    content = `<header class="title-page">${coverHtml}<h1>${escapeNotesHtml(notesExportBookTitle(doc.book))}</h1>`
      + `<p class="subtitle">读书笔记</p><p class="meta">${escapeNotesHtml(meta.join(' · '))}</p></header>`
      + `<main>${body}</main>`;
  } else {
    title = '全部读书笔记';
    const total = docs.reduce((sum, doc) => sum + doc.notes.length, 0);
    const toc = docs.map((doc) => `<li>${escapeNotesHtml(notesExportBookTitle(doc.book))}<span>${doc.notes.length} 条</span></li>`).join('');
    content = `<header class="title-page"><h1>全部读书笔记</h1><p class="meta">${docs.length} 本书 · ${total} 条书摘</p>`
      + `<ol class="toc">${toc}</ol></header>`
      + docs.map((doc) => {
        const { meta, coverHtml, body } = notesBookHtml(doc, { level: 3, cover: false });
        return `<section class="book"><h2>${coverHtml}${escapeNotesHtml(notesExportBookTitle(doc.book))}</h2>`
          + `<p class="meta">${escapeNotesHtml(meta.join(' · '))}</p>${body}</section>`;
      }).join('\n');
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeNotesHtml(title)}</title>${fontCss}
<style>
@page { size: A4; margin: 20mm 18mm 18mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #2b2822; font: 11pt/1.85 "Literata", "Noto Serif SC", "Songti SC", serif; background: #fff; }
.title-page { padding: 30mm 0 12mm; text-align: center; border-bottom: 0.6pt solid #d8cfbd; margin-bottom: 10mm; }
.title-page .cover { display: block; width: 34mm; margin: 0 auto 8mm; box-shadow: 0 2pt 8pt rgba(0,0,0,.18); }
h1 { margin: 0; font-size: 24pt; font-weight: 400; letter-spacing: .04em; }
.subtitle { margin: 2mm 0 0; color: #7a705f; font-size: 12pt; letter-spacing: .3em; }
.meta { margin: 3mm 0 0; color: #8a8174; font-size: 9.5pt; }
.toc { max-width: 120mm; margin: 10mm auto 0; padding: 0; list-style: none; text-align: left; font-size: 10.5pt; }
.toc li { display: flex; justify-content: space-between; padding: 1.6mm 0; border-bottom: 0.4pt dotted #cfc6b4; }
.toc span { color: #8a8174; }
.book { break-before: page; }
.book h2 { display: flex; align-items: center; gap: 4mm; margin: 0; font-size: 17pt; font-weight: 400; }
.book h2 .cover { width: 14mm; }
.book > .meta { margin: 1mm 0 6mm; }
.chapter { margin: 8mm 0 4mm; color: #7a705f; font-size: 11pt; font-weight: 400; letter-spacing: .15em; text-align: center; }
.chapter::before, .chapter::after { content: ""; display: inline-block; width: 10mm; height: 0; margin: 0 3mm; vertical-align: middle; border-top: 0.5pt solid #cbbf9f; }
.note { margin: 0 0 6mm; break-inside: avoid; }
blockquote { margin: 0; padding: 0 0 0 4mm; border-left: 2pt solid; text-align: justify; }
blockquote p, .thought p { margin: 0; }
.thought { margin: 2.5mm 0 0; padding: 2mm 3.5mm; color: #5b5448; font-size: 10pt; background: #f6f2e9; border-radius: 2mm; }
.date { margin-top: 1.5mm; color: #a39a8a; font-size: 8pt; text-align: right; }
footer { margin-top: 10mm; padding-top: 3mm; color: #a39a8a; font-size: 8.5pt; text-align: center; border-top: 0.5pt solid #e2dacb; }
</style></head><body>${content}<footer>由枕书导出 · ${exported}</footer></body></html>`;
}

function downloadNotesFile(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportNotesMarkdown(documents, { all = false } = {}) {
  const markdown = formatNotesMarkdown(documents, { all });
  downloadNotesFile(markdown, notesExportFileName(documents, { all }), 'text/markdown;charset=utf-8');
  if (typeof showHighlightHint === 'function') showHighlightHint('已导出 Markdown');
}

/**
 * Prints the notes from a hidden frame; the browser's print dialog offers
 * “另存为 PDF”. Waits for the fonts and cover so the first page is complete.
 */
async function printNotesPdf(documents, { all = false } = {}) {
  document.getElementById('notesPrintFrame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'notesPrintFrame';
  frame.title = '打印笔记';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(notesPrintHtml(documents, { all }));
  doc.close();
  const loaded = new Promise((resolve) => {
    if (doc.readyState === 'complete') resolve();
    else frame.contentWindow.addEventListener('load', resolve, { once: true });
  });
  const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await Promise.race([loaded, timeout(8000)]);
  if (doc.fonts?.ready) {
    // Ask for the faces the notes use, then wait until they arrive.
    const sample = doc.body.textContent.slice(0, 20000);
    await Promise.race([doc.fonts.load('11pt "Noto Serif SC"', sample).catch(() => null), timeout(8000)]);
    await Promise.race([doc.fonts.ready, timeout(8000)]);
  }
  const print = typeof window.__zhenshuNotesPrint === 'function'
    ? window.__zhenshuNotesPrint
    : (win) => win.print();
  frame.contentWindow.focus();
  print(frame.contentWindow);
  // Keep the frame until printing is done; Safari prints asynchronously.
  setTimeout(() => frame.remove(), 60000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatNotesMarkdown, notesExportFileName, escapeNotesMarkdownLine };
}
