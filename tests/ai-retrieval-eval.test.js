'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const dataset = require('./fixtures/ai-retrieval-questions.json');
const structureCases = require('./fixtures/ai-chapter-structure-cases.json');
const { validateDataset, evaluateCase, summarizeEvaluation } = require('../scripts/evaluate-ai-retrieval');
const { evaluateSummaryEvidence, evaluateSyntheticChapter } = require('../scripts/evaluate-ai-chapter-understanding');

test('AI retrieval evaluation dataset covers the book chapters with valid annotations', () => {
  const summary = validateDataset(dataset);

  assert.equal(summary.chapterCount, 32);
  assert.equal(summary.caseCount, 40);
  assert.equal(summary.singleChapterCaseCount, 34);
  assert.equal(summary.multiChapterCaseCount, 6);
  assert.ok(summary.chapterIndexes.includes(4));
  assert.ok(summary.chapterIndexes.includes(125));
});

test('AI retrieval evaluation reports chapter-summary and cross-chapter intent coverage', () => {
  const summary = validateDataset(dataset);

  assert.deepEqual(summary.intentCounts, {
    lookup: 32,
    cross_chapter: 6,
    chapter_summary: 2
  });
  assert.ok(dataset.cases
    .filter((item) => item.retrievalIntent === 'chapter_summary')
    .every((item) => item.expectedChapterIndexes.length === 1 && item.expectedChapterHrefs?.length === 1));
});

test('synthetic EPUB structure fixtures cover chapter boundary and unresolved cases', () => {
  assert.equal(structureCases.schemaVersion, 1);
  assert.deepEqual(
    structureCases.cases.map((item) => item.id),
    [
      'multiple-chapters-one-resource',
      'chapter-across-spine-resources',
      'nested-navigation',
      'missing-navigation-document',
      'percent-encoded-fragment',
      'duplicate-and-missing-headings',
      'front-matter-outside-toc',
      'unmapped-current-position'
    ]
  );
  assert.equal(structureCases.cases.at(-1).expected.mappingQuality, 'unresolved');
});

test('AI retrieval evaluation calculates false recall at chapter level', () => {
  const result = evaluateCase(
    { id: 'q', question: '问题', expectedChapterIndexes: [4] },
    [{ chapterIndex: 4 }, { chapterIndex: 4 }, { chapterIndex: 7 }],
    6
  );

  assert.deepEqual(result.rankedChapterIndexes, [4, 4, 7]);
  assert.deepEqual(result.uniqueRankedChapterIndexes, [4, 7]);
  assert.equal(result.falseRecallRate, 0.5);
  assert.equal(Object.hasOwn(result, 'question'), false, 'reports must not repeat user query text');
});

test('offline chapter evaluator checks scope purity, beginning/middle/ending coverage, valid citations, and budgets', () => {
  const result = evaluateSyntheticChapter();
  assert.deepEqual(result.coverage, { beginning: true, middle: true, ending: true });
  assert.equal(result.sourcePurity, 1);
  assert.equal(result.sourceReferencesValid, true);
  assert.equal(result.mapSourceReferencesValid, true);
  assert.equal(result.withinBudget, true);

  const impure = evaluateSummaryEvidence({
    expectedChapterId: 'target',
    chapterLength: 100,
    plan: {
      sources: [{ id: 'source-1', logicalChapterId: 'other', start: 0 }],
      mapTasks: [{ sourceIds: ['unknown'] }],
      totalSourceChars: 24000
    },
    answer: 'unsupported citation【9】'
  });
  assert.equal(impure.sourcePurity, 0);
  assert.equal(impure.sourceReferencesValid, false);
  assert.equal(impure.mapSourceReferencesValid, false);
  assert.equal(impure.withinBudget, false);
});

test('AI retrieval evaluation separates recall and false recall by intent', () => {
  const summary = summarizeEvaluation([
    { retrievalIntent: 'chapter_summary', hitAt6: true, falseRecallRate: 0 },
    { retrievalIntent: 'chapter_summary', hitAt6: false, falseRecallRate: 0.5 },
    { retrievalIntent: 'lookup', hitAt6: true, falseRecallRate: 0.25 }
  ]);

  assert.deepEqual(summary.intentBreakdown, {
    lookup: { caseCount: 1, recallAt6: 1, meanFalseRecallRate: 0.25 },
    chapter_summary: { caseCount: 2, recallAt6: 0.5, meanFalseRecallRate: 0.25 }
  });
});
