'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { zipSync } = require('fflate');

const { assessSummaryConfidence, classifyAiIntent, planChapterSummary, selectBookSummaryCandidates } = require('../app/server/ai-chapter-retrieval');
const {
  getOrCreateChapterSummary,
  isFtsAvailable,
  listCachedChapterSummaries,
  readBookNavigation,
  readChapterEvidence,
  resolveBookPosition,
  searchBook
} = require('../app/server/ai-fts');

test('rule-based intent classification prioritizes explicit scope without a model call', () => {
  assert.deepEqual(classifyAiIntent({ question: '请总结本章的主要观点' }), {
    intent: 'chapter_summary', scope: 'chapter', scopeConfidence: 'explicit'
  });
  assert.deepEqual(classifyAiIntent({ question: '本书整体的核心观点是什么？' }), {
    intent: 'book_summary', scope: 'book', scopeConfidence: 'explicit'
  });
  assert.deepEqual(classifyAiIntent({ question: '本章如何解释蛋白质的作用？' }), {
    intent: 'chapter_lookup', scope: 'chapter', scopeConfidence: 'explicit'
  });
  assert.deepEqual(classifyAiIntent({ question: '比较第一章和第三章的观点' }), {
    intent: 'cross_chapter', scope: 'book', scopeConfidence: 'explicit'
  });
  assert.deepEqual(classifyAiIntent({
    question: '这段话的观点是什么？', selectedText: '作者认为阅读应当循序渐进。'
  }), { intent: 'selected_text_summary', scope: 'selection', scopeConfidence: 'explicit' });
  assert.deepEqual(classifyAiIntent({ question: '说说看' }), {
    intent: 'ambiguous', scope: 'book', scopeConfidence: 'low'
  });
  for (const question of ['本章讲了什么？', '总结这章内容', '概括本节的论证']) {
    assert.match(classifyAiIntent({ question }).intent, /^(chapter|section)_summary$/);
  }
  for (const question of ['什么是蛋白质？', '为什么会发生这种变化？', '作者在哪一年提出这个结论？']) {
    assert.equal(classifyAiIntent({ question }).intent, 'lookup');
    assert.equal(classifyAiIntent({ question }).scope, 'book');
  }
  assert.equal(classifyAiIntent({ question: '全书整体讲了什么？' }).scope, 'book');
});

test('chapter summary plans preserve opening, middle, ending, and source positions within hard budgets', () => {
  const short = [
    { text: '开头核心论点', chapterHref: 'OPS/ch1.xhtml', start: 10, chapterLabel: '第一章' },
    { text: '中段论据', chapterHref: 'OPS/ch1.xhtml', start: 200, chapterLabel: '第一章' },
    { text: '结尾结论', chapterHref: 'OPS/ch1.xhtml', start: 390, chapterLabel: '第一章' }
  ];
  const complete = planChapterSummary(short);
  assert.equal(complete.mode, 'complete');
  assert.equal(complete.mapTasks.length, 1);
  assert.equal(complete.sources.length, short.length);
  assert.deepEqual(complete.coverage.coveredRegions, ['beginning', 'middle', 'ending']);
  assert.deepEqual(complete.sources.map((item) => item.start), [10, 200, 390]);

  const long = Array.from({ length: 45 }, (_, index) => ({
    text: `段落${index}：${'核心材料。'.repeat(80)}`,
    chapterHref: 'OPS/ch1.xhtml',
    start: index * 1000,
    chapterLabel: '第一章',
    logicalSectionId: index < 20 ? 'section-a' : 'section-b'
  }));
  const mapped = planChapterSummary(long);
  assert.equal(mapped.mode, 'map_reduce');
  assert.ok(mapped.mapTasks.length > 1 && mapped.mapTasks.length <= 12);
  assert.ok(mapped.mapTasks.every((task) => task.text.length <= 3000));
  assert.ok(mapped.totalSourceChars <= 36000);
  assert.ok(mapped.sources[0].start < mapped.sources.at(-1).start);
  assert.ok(mapped.mapTasks.some((task) => task.sourceIds.includes(mapped.sources[0].id)));
  assert.ok(mapped.mapTasks.some((task) => task.sourceIds.includes(mapped.sources.at(-1).id)));
});

test('book summary map tasks never merge evidence from different logical chapters', () => {
  const plan = planChapterSummary([
    { text: '第一章证据', logicalChapterId: 'ch-1', chapterLabel: '第一章', chapterHref: 'OPS/shared.xhtml', start: 10 },
    { text: '第一章补充', logicalChapterId: 'ch-1', chapterLabel: '第一章', chapterHref: 'OPS/shared.xhtml', start: 20 },
    { text: '第二章证据', logicalChapterId: 'ch-2', chapterLabel: '第二章', chapterHref: 'OPS/shared.xhtml', start: 30 }
  ]);
  assert.equal(plan.mapTasks.length, 2);
  assert.deepEqual(plan.mapTasks.map((task) => task.logicalChapterId), ['ch-1', 'ch-2']);
  assert.match(plan.mapTasks[0].text, /第一章证据/);
  assert.doesNotMatch(plan.mapTasks[0].text, /第二章证据/);
});

test('chapter summary refuses an over-budget full chapter instead of silently sampling', () => {
  const oversized = Array.from({ length: 100 }, (_, index) => ({
    text: `段落${index} ${'超预算材料。'.repeat(100)}`,
    chapterHref: 'OPS/ch1.xhtml',
    start: index * 2000,
    chapterLabel: '第一章'
  }));
  assert.throws(() => planChapterSummary(oversized), { code: 'AI_CHAPTER_BUDGET_EXCEEDED' });
});

test('book summary navigation ranks relevant chapters then fills chapter coverage under a hard cap', () => {
  const chapters = Array.from({ length: 14 }, (_, index) => ({
    id: `chapter-${index + 1}`,
    label: index === 7 ? '营养与代谢' : `第${index + 1}章 普通主题`,
    depth: 0,
    order: index
  }));
  const result = selectBookSummaryCandidates({
    chapters,
    query: '这本书中营养代谢的主要观点是什么？',
    matches: [{ logicalChapterId: 'chapter-8', score: 10 }],
    maxChapters: 8
  });
  assert.equal(result.candidates.length, 8);
  assert.equal(result.candidates[0].id, 'chapter-8');
  assert.ok(result.candidates.some((item) => item.id === 'chapter-1'));
  assert.ok(result.candidates.some((item) => item.id === 'chapter-14'));
  assert.equal(result.coverage.totalChapters, 14);
  assert.equal(result.coverage.selectedChapters, 8);
  assert.equal(result.coverage.ratio, 8 / 14);
});

test('book summary navigation rejects missing structure and never exceeds selected chapter bounds', () => {
  assert.equal(selectBookSummaryCandidates({ chapters: [], query: '全书总结' }).status, 'insufficient_scope');
  const chapters = Array.from({ length: 40 }, (_, index) => ({ id: `ch-${index}`, label: `第${index}章`, depth: 0, order: index }));
  assert.equal(selectBookSummaryCandidates({ chapters, query: '全书总结' }).candidates.length, 8);
});

test('summary confidence is downgraded for inferred locations, partial coverage, or invalid citations', () => {
  const complete = assessSummaryConfidence({
    mappingQuality: 'exact', coverage: { ratio: 1 }, sourceIntegrity: true, citationIntegrity: true
  });
  assert.equal(complete.level, 'high');
  for (const input of [
    { mappingQuality: 'inferred', coverage: { ratio: 1 }, sourceIntegrity: true, citationIntegrity: true },
    { mappingQuality: 'exact', coverage: { ratio: 0.5 }, sourceIntegrity: true, citationIntegrity: true },
    { mappingQuality: 'exact', coverage: { ratio: 1 }, sourceIntegrity: false, citationIntegrity: true },
    { mappingQuality: 'exact', coverage: { ratio: 1 }, sourceIntegrity: true, citationIntegrity: false }
  ]) assert.equal(assessSummaryConfidence(input).level, 'low');
});

test('chapter summary retrieval is hard-scoped and never falls back to another chapter', { skip: !isFtsAvailable() }, async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-chapter-retrieval-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const bookPath = path.join(dataRoot, 'scoped.epub');
  const firstText = Array.from({ length: 90 }, (_, index) => `第一章第${index}段 主张证据甲。`).join(' ');
  const secondText = Array.from({ length: 90 }, (_, index) => `第二章第${index}段 独有词汇乙。`).join(' ');
  const zipEntries = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine><itemref idref="content"/></spine></package>`,
    'OPS/nav.xhtml': `<html><body><nav epub:type="toc"><ol>
      <li><a href="content.xhtml#one">第一章标题</a></li>
      <li><a href="content.xhtml#two">第二章标题</a></li>
      </ol></nav></body></html>`,
    'OPS/content.xhtml': `<html><body>
      <h1 id="one">第一章标题</h1><p>${firstText}</p>
      <h1 id="two">第二章标题</h1><p>${secondText}</p>
      </body></html>`
  };
  await fs.writeFile(bookPath, zipSync(Object.fromEntries(
    Object.entries(zipEntries).map(([name, text]) => [name, new TextEncoder().encode(text)])
  )));
  const book = { id: 'e'.repeat(64), path: bookPath, type: 'epub', title: '章节隔离测试' };
  const firstChapter = await resolveBookPosition(book, dataRoot, {
    index: 0,
    href: 'OPS/content.xhtml',
    position: { href: 'OPS/content.xhtml', anchor: 'one' }
  });
  const secondChapter = await resolveBookPosition(book, dataRoot, {
    index: 0,
    href: 'OPS/content.xhtml',
    position: { href: 'OPS/content.xhtml', anchor: 'two' }
  });
  const chapterEvidence = await readChapterEvidence(book, dataRoot, firstChapter.chapterId);
  const navigation = await readBookNavigation(book, dataRoot);
  await getOrCreateChapterSummary({
    book, dataRoot, userId: 'reader-a', logicalChapterId: firstChapter.chapterId,
    bookFingerprint: chapterEvidence.bookFingerprint, parserVersion: chapterEvidence.parserVersion,
    baseUrl: 'https://api.example.test/v1', model: 'reader-model', build: async () => ({ answer: '营养代谢章节摘要' })
  });
  await getOrCreateChapterSummary({
    book, dataRoot, userId: 'reader-b', logicalChapterId: secondChapter.chapterId,
    bookFingerprint: chapterEvidence.bookFingerprint, parserVersion: chapterEvidence.parserVersion,
    baseUrl: 'https://api.example.test/v1', model: 'reader-model', build: async () => ({ answer: '其他用户私有摘要' })
  });
  const cachedSummaries = await listCachedChapterSummaries({
    book, dataRoot, userId: 'reader-a', baseUrl: 'https://api.example.test/v1', model: 'reader-model'
  });

  const scoped = await searchBook(book, dataRoot, {
    query: '第二章 独有词汇乙',
    currentChapterIndex: 0,
    logicalChapterId: firstChapter.chapterId,
    intent: 'chapter_summary',
    limit: 6
  });
  const unscoped = await searchBook(book, dataRoot, { query: '独有词汇乙', limit: 6 });
  const unresolved = await searchBook(book, dataRoot, {
    query: '独有词汇乙',
    logicalChapterId: 'forged-chapter-id',
    intent: 'chapter_summary',
    limit: 6
  });
  const unresolvedSection = await searchBook(book, dataRoot, {
    query: '第一章 主张证据甲',
    logicalChapterId: firstChapter.chapterId,
    intent: 'section_summary',
    limit: 6
  });
  const unresolvedSectionLookup = await searchBook(book, dataRoot, {
    query: '独有词汇乙',
    logicalChapterId: firstChapter.chapterId,
    intent: 'section_lookup',
    limit: 6
  });

  assert.notEqual(firstChapter.chapterId, secondChapter.chapterId);
  assert.equal(chapterEvidence.available, true);
  assert.equal(navigation.available, true);
  assert.deepEqual(navigation.chapters.map((chapter) => chapter.label), ['第一章标题', '第二章标题']);
  assert.deepEqual(cachedSummaries.map((summary) => summary.text), ['营养代谢章节摘要']);
  assert.ok(chapterEvidence.chunks.length > 1);
  assert.ok(chapterEvidence.chunks.every((item) => item.chapterHref === 'OPS/content.xhtml'));
  assert.ok(chapterEvidence.chunks.every((item) => item.text.includes('主张证据甲')));
  assert.ok(chapterEvidence.chunks.every((item) => !item.text.includes('独有词汇乙')));
  assert.ok(scoped.matches.length > 0);
  assert.ok(scoped.matches.every((item) => item.logicalChapterId === firstChapter.chapterId));
  assert.ok(scoped.matches.every((item) => !item.text.includes('独有词汇乙')));
  assert.ok(unscoped.matches.some((item) => item.logicalChapterId === secondChapter.chapterId));
  assert.deepEqual(unresolved.matches, []);
  assert.deepEqual(unresolvedSection.matches, []);
  assert.equal(unresolvedSection.retrievalStatus, 'insufficient_scope');
  assert.deepEqual(unresolvedSectionLookup.matches, []);
  assert.equal(unresolvedSectionLookup.retrievalStatus, 'insufficient_scope');
  assert.equal(scoped.coverage.mode, 'chapter-sample');
});
