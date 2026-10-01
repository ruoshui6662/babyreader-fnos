'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync } = require('fflate');

const { buildEpub, buildSections, buildText, CHAPTERS } = require('./fixtures/ai-book-qa/book');
const { parseEpubStructure } = require('../app/server/ai-epub-structure');
const { cases } = require('./fixtures/ai-book-qa/cases.json');
const { score, summarize } = require('../scripts/evaluate-ai-book-qa');

test('the evaluation book is deterministic and has a chapter over the old 22,000-character cap', () => {
  assert.equal(buildText(), buildText());
  const chapters = buildSections();
  assert.equal(chapters.length, 5);
  const longest = Math.max(...chapters.map((chapter) => chapter.sections.flatMap((section) => section.paragraphs).join('').length));
  assert.ok(longest > 30000, `longest chapter has ${longest} characters`);
});

test('the evaluation EPUB has a nested table of contents', () => {
  const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buildEpub()))));
  const structure = parseEpubStructure(files);
  const top = structure.chapters.filter((chapter) => chapter.depth === 0).map((chapter) => chapter.label);
  assert.deepEqual(top, CHAPTERS.map((chapter) => chapter.title));
  assert.equal(structure.chapters.filter((chapter) => chapter.depth === 1).length, 11);
});

test('every planted fact a case asks about exists exactly where it was planted', () => {
  const text = buildText();
  for (const item of cases) {
    for (const snippet of item.gold || []) assert.ok(text.includes(snippet), `${item.id}: ${snippet}`);
  }
});

test('evaluation scoring reports scope, evidence and coverage', () => {
  const row = score(
    { id: 'x', type: 'lookup', expectedScope: 'passage', gold: ['松枝的余火'] },
    { scope: 'passage', evidence: [{ text: '陈守义用松枝的余火慢慢烘焙', label: '第三章 制茶的手艺' }] }
  );
  assert.equal(row.scopeOk, true);
  assert.equal(row.goldRecall, 1);
  const overview = score({ id: 'o', type: 'overview', expectedScope: 'book' }, { scope: 'book', evidence: [{ text: '…', label: '第一章 初到云岭' }] });
  assert.equal(overview.chapterCoverage, 0.2);
  assert.equal(summarize([row, overview]).overall.cases, 2);
});
