'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { aiTerms } = require('../app/server/ai-fts');
const {
  rankLexicalCandidates,
  fuseRankedMatches,
  assessRetrievalConfidence
} = require('../app/server/ai-retrieval');

function item(id, overrides = {}) {
  return {
    id,
    text: `${id} 蛋白质 健康`,
    title: '',
    headings: [],
    chapterIndex: 0,
    start: 0,
    ...overrides
  };
}

test('lexical ranking prioritizes selected text and title signals', () => {
  const result = rankLexicalCandidates([
    item('body-only'),
    item('title-match', { title: '蛋白质与健康' }),
    item('selected-match', { text: '选中的蛋白质原文' })
  ], {
    query: '蛋白质',
    selectedText: '选中的蛋白质原文',
    currentChapterIndex: null,
    termize: aiTerms
  });

  assert.equal(result[0].id, 'selected-match');
  assert.equal(result[1].id, 'title-match');
});

test('rank fusion puts a candidate shared by FTS and lexical ranking first', () => {
  const result = fuseRankedMatches({
    ftsMatches: [item('fts-only', { start: 0 }), item('shared', { start: 1000 })],
    lexicalMatches: [item('shared', { start: 1000 }), item('lexical-only', { start: 2000 })],
    limit: 3
  });

  assert.deepEqual(result.map((match) => match.id), ['shared', 'fts-only', 'lexical-only']);
});

test('weighted rank fusion keeps FTS as the primary signal when branches disagree', () => {
  const result = fuseRankedMatches({
    ftsMatches: [item('fts-target', { start: 0 }), item('lexical-target', { start: 1000 })],
    lexicalMatches: [item('lexical-target', { start: 1000 }), item('fts-target', { start: 0 })],
    sourceWeights: { fts: 3, lexical: 1 },
    limit: 2
  });

  assert.equal(result[0].id, 'fts-target');
});

test('rank fusion removes overlapping chunks before filling the fixed result budget', () => {
  const result = fuseRankedMatches({
    ftsMatches: [
      item('first', { chapterIndex: 1, start: 0 }),
      item('overlap', { chapterIndex: 1, start: 400 }),
      item('other', { chapterIndex: 2, start: 0 })
    ],
    lexicalMatches: [],
    limit: 2
  });

  assert.deepEqual(result.map((match) => match.id), ['first', 'other']);
});

test('rank fusion removes exact duplicate text and enforces the context character budget', () => {
  const repeatedText = '蛋白质与健康。'.repeat(120);
  const result = fuseRankedMatches({
    ftsMatches: [
      item('duplicate-a', { chapterIndex: 1, start: 0, text: repeatedText }),
      item('unique-b', { chapterIndex: 2, start: 0, text: '维生素与矿物质。'.repeat(120) }),
      item('duplicate-c', { chapterIndex: 3, start: 0, text: repeatedText })
    ],
    lexicalMatches: [],
    limit: 6,
    contextCharBudget: 1000
  });

  assert.ok(result.reduce((total, match) => total + match.text.length, 0) <= 1000);
  assert.equal(result.filter((match) => match.text === repeatedText).length, 1);
});

test('retrieval confidence marks weak matches without treating any candidate as proof', () => {
  const weak = assessRetrievalConfidence([
    item('weak', { lexicalScore: 2, bodyScore: 2, retrievalSources: ['fts', 'lexical'] })
  ], { query: '量子物理火星发动机', termize: aiTerms });
  const strong = assessRetrievalConfidence([
    item('strong', {
      text: '蛋白质与氨基酸是身体营养的重要关系。',
      lexicalScore: 12,
      bodyScore: 4,
      headingScore: 3,
      retrievalSources: ['fts', 'lexical']
    })
  ], { query: '蛋白质与氨基酸有什么关系', termize: aiTerms });

  assert.equal(weak.level, 'low');
  assert.equal(weak.guarded, true);
  assert.equal(strong.level, 'high');
  assert.equal(strong.guarded, false);
});
