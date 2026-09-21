'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const dataset = require('./fixtures/ai-retrieval-questions.json');
const { validateDataset, evaluateCase } = require('../scripts/evaluate-ai-retrieval');

test('AI retrieval evaluation dataset covers the book chapters with valid annotations', () => {
  const summary = validateDataset(dataset);

  assert.equal(summary.chapterCount, 32);
  assert.equal(summary.caseCount, 38);
  assert.equal(summary.singleChapterCaseCount, 32);
  assert.equal(summary.multiChapterCaseCount, 6);
  assert.ok(summary.chapterIndexes.includes(4));
  assert.ok(summary.chapterIndexes.includes(125));
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
});
