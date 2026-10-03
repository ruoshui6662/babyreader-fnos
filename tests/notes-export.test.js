'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatNotesMarkdown, notesExportFileName, escapeNotesMarkdownLine } = require('../app/ui/library/notes-export');

const NOW = new Date('2026-10-03T08:00:00Z');

const book = { bookId: 'b1', title: '灯下读书记', author: '枕书编辑部' };
const notes = [
  { id: '1', chapter: '第一章 · 灯下', text: '书是安静的朋友。', color: 'yellow', createdAt: '2026-09-20T13:00:00Z' },
  { id: '2', chapter: '第一章 · 灯下', text: '第一行\n第二行', thought: '想到了\n另一件事', color: 'green', createdAt: '2026-09-21T13:00:00Z' },
  { id: '3', chapter: '第二章', text: '# 不是标题 *也不是强调*', color: 'pink', createdAt: '2026-09-22T13:00:00Z' },
  { id: '4', chapter: '其他', text: '没有章节的划线。', createdAt: '2026-09-23T13:00:00Z' }
];

test('one book: title, counts, chapters in order, quotes, thoughts, dates', () => {
  const markdown = formatNotesMarkdown([{ book, notes }], { now: NOW });
  const lines = markdown.split('\n');
  assert.equal(lines[0], '# 《灯下读书记》读书笔记');
  assert.equal(lines[2], '作者：枕书编辑部 · 4 条书摘 · 1 条想法 · 导出于 2026-10-03');
  // Each chapter heading once, in reading order; “其他” gets none.
  assert.deepEqual(lines.filter((line) => line.startsWith('## ')), ['## 第一章 · 灯下', '## 第二章']);
  assert.ok(markdown.includes('> 第一行\n> 第二行'));
  assert.ok(markdown.includes('**想法**：想到了  \n另一件事'));
  assert.ok(markdown.includes('<sub>2026-09-21 · 绿色划线</sub>'));
  assert.ok(markdown.includes('> \\# 不是标题 \\*也不是强调\\*'));
  assert.ok(markdown.includes('> 没有章节的划线。'));
  assert.ok(markdown.trimEnd().endsWith('由枕书导出'));
});

test('all notes: books as sections, chapters one level down, totals', () => {
  const other = { book: { bookId: 'b2', title: '《远行》' }, notes: [{ id: 'x', chapter: '第 3 页', text: 'PDF 里的一句。', createdAt: '2026-09-01T00:00:00Z' }] };
  const markdown = formatNotesMarkdown([{ book, notes }, other, { book: { title: '空' }, notes: [] }], { all: true, now: NOW });
  const lines = markdown.split('\n');
  assert.equal(lines[0], '# 全部读书笔记');
  assert.equal(lines[2], '2 本书 · 5 条书摘 · 1 条想法 · 导出于 2026-10-03');
  assert.deepEqual(lines.filter((line) => line.startsWith('## ')), ['## 《灯下读书记》', '## 《远行》']);
  assert.ok(lines.includes('### 第 3 页'));
  assert.ok(lines.includes('作者：枕书编辑部 · 4 条书摘'));
});

test('file names and escaping', () => {
  assert.equal(notesExportFileName([{ book: { title: 'A Book: 2/3' }, notes }], { now: NOW }), 'ABook23-读书笔记-20261003.md');
  assert.equal(notesExportFileName([{ book, notes }], { all: true, extension: 'pdf', now: NOW }), '全部读书笔记-20261003.pdf');
  assert.equal(escapeNotesMarkdownLine('1. 不是列表'), '1\\. 不是列表');
  assert.equal(escapeNotesMarkdownLine('- 不是列表'), '\\- 不是列表');
  assert.equal(escapeNotesMarkdownLine('<b>原样</b>'), '\\<b\\>原样\\</b\\>');
});
