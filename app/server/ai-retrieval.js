'use strict';

const DEFAULT_LIMIT = 6;
const DEFAULT_RRF_K = 60;
const DEFAULT_MIN_DIVERSE_DISTANCE = 900;
const DEFAULT_CONTEXT_CHAR_BUDGET = 5400;
const TITLE_WEIGHT = 4;
const HEADING_WEIGHT = 3;
const BODY_WEIGHT = 1;
const SELECTED_TEXT_WEIGHT = 12;
const CURRENT_CHAPTER_WEIGHT = 2;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function defaultTermize(value) {
  const text = cleanText(value).toLocaleLowerCase();
  const terms = new Set(text.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2}/gi) || []);
  for (const phrase of text.match(/[\u3400-\u9fff]{1,}/g) || []) {
    const chars = Array.from(phrase);
    for (let index = 0; index < chars.length - 1; index += 1) {
      terms.add(chars[index] + chars[index + 1]);
    }
  }
  return [...terms];
}

function valuesToText(value) {
  if (Array.isArray(value)) return value.join(' ');
  return String(value || '');
}

function normalizeLimit(value) {
  return Math.max(1, Math.min(DEFAULT_LIMIT, Number.isFinite(Number(value)) ? Number(value) : DEFAULT_LIMIT));
}

function normalizeContextCharBudget(value) {
  return Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : DEFAULT_CONTEXT_CHAR_BUDGET);
}

function assessRetrievalConfidence(matches, {
  query = '',
  selectedText = '',
  termize = defaultTermize
} = {}) {
  const items = Array.isArray(matches) ? matches.filter((item) => item && typeof item === 'object') : [];
  if (!items.length) {
    return {
      level: 'none',
      guarded: true,
      reason: 'no-matches',
      message: '没有检索到足够的书本内容，请换一种问法。'
    };
  }

  const queryTerms = new Set(termize(`${query} ${selectedText}`));
  const selectedNeedle = cleanText(selectedText);
  const scored = items.map((item) => {
    const text = cleanText(item.text || item.bodyText);
    const itemTerms = new Set(termize(text));
    const matchedTermCount = [...queryTerms].filter((term) => itemTerms.has(term)).length;
    const lexicalScore = Number.isFinite(Number(item.lexicalScore))
      ? Number(item.lexicalScore)
      : matchedTermCount;
    const selectedHit = Boolean(selectedNeedle && text.includes(selectedNeedle));
    const retrievalSources = new Set(Array.isArray(item.retrievalSources) ? item.retrievalSources : []);
    const sourceAgreement = retrievalSources.has('fts') && retrievalSources.has('lexical');
    return {
      lexicalScore,
      matchedTermCount,
      queryCoverage: queryTerms.size ? matchedTermCount / queryTerms.size : 0,
      selectedHit,
      sourceAgreement
    };
  }).sort((left, right) => (
    Number(right.selectedHit) - Number(left.selectedHit)
    || right.lexicalScore - left.lexicalScore
    || right.queryCoverage - left.queryCoverage
    || Number(right.sourceAgreement) - Number(left.sourceAgreement)
  ));

  const best = scored[0];
  const highConfidence = best.selectedHit
    || (best.queryCoverage >= 0.4 && best.lexicalScore >= 4)
    || (best.sourceAgreement && best.queryCoverage >= 0.5 && best.lexicalScore >= 3);
  return {
    level: highConfidence ? 'high' : 'low',
    guarded: !highConfidence,
    reason: highConfidence ? 'matched-evidence' : 'weak-term-coverage',
    topScore: best.lexicalScore,
    queryCoverage: best.queryCoverage,
    message: highConfidence
      ? '书本检索依据充分。'
      : '检索到的书本依据与问题匹配度有限，回答将严格限于可确认内容。'
  };
}

function rankLexicalCandidates(items, {
  query = '',
  selectedText = '',
  currentChapterIndex = null,
  termize
} = {}) {
  if (typeof termize !== 'function') throw new TypeError('termize must be a function');
  const queryTerms = new Set(termize(`${query} ${selectedText}`));
  if (!queryTerms.size) return [];
  const normalizedSelectedText = cleanText(selectedText);
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const text = cleanText(item.text || item.bodyText);
      const title = cleanText(item.title || item.titleText || item.chapterLabel);
      const headings = cleanText(valuesToText(item.headings || item.headingsText));
      const itemTerms = new Set(termize(text));
      const titleTerms = new Set(termize(title));
      const headingTerms = new Set(termize(headings));
      let titleScore = 0;
      let headingScore = 0;
      let bodyScore = 0;
      for (const term of queryTerms) {
        if (titleTerms.has(term)) titleScore += TITLE_WEIGHT;
        if (headingTerms.has(term)) headingScore += HEADING_WEIGHT;
        if (itemTerms.has(term)) bodyScore += BODY_WEIGHT;
      }
      const selectedScore = normalizedSelectedText && text.includes(normalizedSelectedText)
        ? SELECTED_TEXT_WEIGHT
        : 0;
      const contentScore = titleScore + headingScore + bodyScore + selectedScore;
      const chapterScore = Number.isInteger(currentChapterIndex)
        && Number(item.chapterIndex) === currentChapterIndex
        && contentScore > 0
        ? CURRENT_CHAPTER_WEIGHT
        : 0;
      return {
        ...item,
        text,
        title,
        headings: Array.isArray(item.headings) ? item.headings : headings ? headings.split('\n').filter(Boolean) : [],
        titleScore,
        headingScore,
        bodyScore,
        selectedScore,
        chapterScore,
        lexicalScore: contentScore + chapterScore
      };
    })
    .filter((item) => item.lexicalScore > 0)
    .sort((left, right) => (
      right.lexicalScore - left.lexicalScore
      || Number(left.chapterIndex) - Number(right.chapterIndex)
      || Number(left.start || left.startOffset || 0) - Number(right.start || right.startOffset || 0)
    ));
}

function matchKey(item) {
  return [
    Number.isInteger(Number(item?.chapterIndex)) ? Number(item.chapterIndex) : '',
    String(item?.chapterHref || ''),
    Number(item?.start ?? item?.startOffset ?? 0)
  ].join('|');
}

function isOverlapping(left, right, minDistance) {
  return Number(left.chapterIndex) === Number(right.chapterIndex)
    && Math.abs(Number(left.start ?? left.startOffset ?? 0) - Number(right.start ?? right.startOffset ?? 0)) < minDistance;
}

function fuseRankedMatches({
  ftsMatches = [],
  lexicalMatches = [],
  limit = DEFAULT_LIMIT,
  rrfK = DEFAULT_RRF_K,
  minDiverseDistance = DEFAULT_MIN_DIVERSE_DISTANCE,
  contextCharBudget = DEFAULT_CONTEXT_CHAR_BUDGET,
  sourceWeights = {}
} = {}) {
  const candidates = new Map();
  const addRanked = (matches, source) => {
    const sourceWeight = Number.isFinite(Number(sourceWeights[source])) ? Number(sourceWeights[source]) : 1;
    (Array.isArray(matches) ? matches : []).forEach((match, index) => {
      const key = matchKey(match);
      const existing = candidates.get(key) || {
        ...match,
        retrievalSources: [],
        fusionScore: 0,
        ftsRank: null,
        lexicalRank: null
      };
      Object.assign(existing, match);
      existing.retrievalSources = [...new Set([...existing.retrievalSources, source])];
      existing.fusionScore += sourceWeight / (rrfK + index + 1);
      existing[`${source}Rank`] = index + 1;
      candidates.set(key, existing);
    });
  };
  addRanked(ftsMatches, 'fts');
  addRanked(lexicalMatches, 'lexical');

  const ranked = [...candidates.values()].sort((left, right) => (
    right.fusionScore - left.fusionScore
    || right.retrievalSources.length - left.retrievalSources.length
    || (left.lexicalRank ?? Infinity) - (right.lexicalRank ?? Infinity)
    || (left.ftsRank ?? Infinity) - (right.ftsRank ?? Infinity)
    || Number(left.chapterIndex) - Number(right.chapterIndex)
    || Number(left.start ?? left.startOffset ?? 0) - Number(right.start ?? right.startOffset ?? 0)
  ));
  const selected = [];
  const seenTexts = new Set();
  let contextChars = 0;
  const normalizedLimit = normalizeLimit(limit);
  const normalizedContextCharBudget = normalizeContextCharBudget(contextCharBudget);
  for (const item of ranked) {
    if (selected.some((match) => isOverlapping(match, item, minDiverseDistance))) continue;
    const text = cleanText(item.text || item.bodyText);
    if (!text || seenTexts.has(text)) continue;
    if (contextChars + text.length > normalizedContextCharBudget) continue;
    selected.push({
      ...item,
      text,
      score: item.fusionScore
    });
    seenTexts.add(text);
    contextChars += text.length;
    if (selected.length >= normalizedLimit) break;
  }
  return selected;
}

module.exports = {
  DEFAULT_LIMIT,
  DEFAULT_RRF_K,
  DEFAULT_MIN_DIVERSE_DISTANCE,
  DEFAULT_CONTEXT_CHAR_BUDGET,
  defaultTermize,
  assessRetrievalConfidence,
  rankLexicalCandidates,
  fuseRankedMatches
};
