'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { formatPdfNotesMarkdown } = require('../app/ui/reader/pdf-notes-export');

function note(id, pageIndex, fields = {}) {
  return {
    version: 1,
    type: 'pdf',
    id,
    kind: 'highlight',
    style: 'marker',
    color: 'blue',
    text: `引文 ${id}`,
    thought: '',
    sourceStale: false,
    createdAt: '2026-09-25T10:00:00.000Z',
    targets: [{ pageIndex, quads: [[0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2]] }],
    ...fields
  };
}

test('exports one record per PDF annotation in page order with readable cross-page and stale labels', () => {
  const annotations = [
    note('late', 4, { text: '末页' }),
    note('middle', 1, {
      text: '跨页文字',
      targets: [{ pageIndex: 1, quads: [] }, { pageIndex: 2, quads: [] }],
      thought: '跨页想法',
      sourceStale: true
    }),
    note('early-b', 0, { text: '第二条', createdAt: '2026-09-25T11:00:00.000Z' }),
    note('early-a', 0, { text: '第一条', createdAt: '2026-09-25T09:00:00.000Z' })
  ];
  const markdown = formatPdfNotesMarkdown({ title: '测试.pdf', annotations });
  assert.match(markdown, /^# 《测试》标记与想法\n/m);
  assert.ok(markdown.indexOf('第一条') < markdown.indexOf('第二条'));
  assert.ok(markdown.indexOf('第二条') < markdown.indexOf('跨页文字'));
  assert.ok(markdown.indexOf('跨页文字') < markdown.indexOf('末页'));
  assert.match(markdown, /## 第 1 页/);
  assert.match(markdown, /第 2–3 页/);
  assert.equal((markdown.match(/跨页文字/g) || []).length, 1);
  assert.match(markdown, /原文件已变化，定位不可用/);
  assert.match(markdown, /跨页想法/);
});

test('treats title, quote and thought as plain Markdown text and excludes private record fields', () => {
  const markdown = formatPdfNotesMarkdown({
    title: '# [书](https://bad.example).pdf',
    annotations: [note('safe', 0, {
      text: '# 标题\n[click](https://bad.example)',
      thought: '## 想法\n![image](https://bad.example)',
      path: '/vol1/private/book.pdf',
      uid: 'secret-uid',
      sourceFingerprint: 'secret-fingerprint',
      apiKey: 'secret-key'
    })]
  });
  assert.doesNotMatch(markdown, /^##? (?:标题|想法)/m);
  assert.doesNotMatch(markdown, /\[click\]\(https:\/\/bad\.example\)/);
  for (const secret of ['/vol1/private', 'secret-uid', 'secret-fingerprint', 'secret-key', 'quads']) {
    assert.ok(!markdown.includes(secret), secret);
  }
});

test('untrusted PDF notes cannot emit raw HTML into the Markdown download', () => {
  const markdown = formatPdfNotesMarkdown({
    title: '<img src=x onerror=alert(1)>.pdf',
    annotations: [note('html', 0, {
      text: '<script>alert(1)</script>',
      thought: '<img src=x onerror=alert(2)>'
    })]
  });
  assert.doesNotMatch(markdown, /<(?:script|img)\b/i);
  assert.match(markdown, /&lt;script/);
});

test('empty, malformed, duplicate or oversized inputs fail instead of producing partial files', () => {
  assert.throws(() => formatPdfNotesMarkdown({ title: '空.pdf', annotations: [] }), { code: 'PDF_EXPORT_EMPTY' });
  assert.throws(() => formatPdfNotesMarkdown({ title: '错.pdf', annotations: [note('bad', -1)] }), { code: 'PDF_EXPORT_INVALID' });
  assert.throws(() => formatPdfNotesMarkdown({ title: '错.pdf', annotations: [note('dup', 0), note('dup', 1)] }), { code: 'PDF_EXPORT_INVALID' });
  assert.throws(() => formatPdfNotesMarkdown({ title: '错.pdf', annotations: [note('other', 0, { type: 'epub' })] }), { code: 'PDF_EXPORT_INVALID' });
  assert.throws(() => formatPdfNotesMarkdown({ title: '大.pdf', annotations: [note('large', 0, { text: '字'.repeat(5000) })] }), { code: 'PDF_EXPORT_LIMIT' });
  const large = Array.from({ length: 501 }, (_, index) => note(`n-${index}`, 0));
  assert.throws(() => formatPdfNotesMarkdown({ title: '大.pdf', annotations: large }), { code: 'PDF_EXPORT_LIMIT' });
  const oversizedOutput = Array.from({ length: 100 }, (_, index) => note(`cjk-${index}`, 0, {
    text: '字'.repeat(3990)
  }));
  assert.throws(() => formatPdfNotesMarkdown({ title: '大.pdf', annotations: oversizedOutput }), { code: 'PDF_EXPORT_LIMIT' });
});
