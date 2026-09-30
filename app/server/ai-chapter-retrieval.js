'use strict';

const SUMMARY_PATTERN = /(?:讲了?什么|主要内容|概述|总结|梳理|概括|核心观点|主要观点|观点是什么|主旨|大意|要点|论证)/i;
const FULL_BOOK_PATTERN = /(?:整本书|全书|全本书|整本|全书内容|这本书|本书)/i;
const CROSS_CHAPTER_PATTERN = /(?:比较|对比|异同|跨章节|各章节|不同章节|哪些章节|章节之间|第一章.*第三章|第一章.*第二章)/i;
const SECTION_PATTERN = /(?:本节|这节|当前小节|这一节|本段|这段|这部分)/i;
const CHAPTER_PATTERN = /(?:本章|这章|当前章|当前章节|这一章|该章|该章节)/i;
const COMPLETE_CHAPTER_CONTEXT_CHARS = 5400;
const MAP_INPUT_CHARS = 3000;
const MAX_MAP_TASKS = 8;
const MAX_CHAPTER_SOURCE_CHARS = 22000;
const MAX_BOOK_SUMMARY_CHAPTERS = 8;

function result(intent, scope, scopeConfidence) {
  return { intent, scope, scopeConfidence };
}

function classifyAiIntent({ question = '', selectedText = '' } = {}) {
  const text = String(question || '').replace(/\s+/g, ' ').trim();
  const hasSelection = String(selectedText || '').trim().length > 0;
  const summary = SUMMARY_PATTERN.test(text);

  if (hasSelection && summary && /(?:这段|选中|划线|所选|上述)/i.test(text)) {
    return result('selected_text_summary', 'selection', 'explicit');
  }
  if (FULL_BOOK_PATTERN.test(text) && summary) {
    return result('book_summary', 'book', 'explicit');
  }
  if (CROSS_CHAPTER_PATTERN.test(text)) {
    return result('cross_chapter', 'book', 'explicit');
  }
  if (SECTION_PATTERN.test(text)) {
    return result(summary ? 'section_summary' : 'section_lookup', 'section', 'explicit');
  }
  if (CHAPTER_PATTERN.test(text)) {
    return result(summary ? 'chapter_summary' : 'chapter_lookup', 'chapter', 'explicit');
  }
  if (hasSelection && /(?:这段|选中|划线|所选|上述)/i.test(text)) {
    return result('selected_text_lookup', 'selection', 'explicit');
  }
  if (summary && /(?:核心|主要|整体|全局|整体上)/i.test(text)) {
    return result('ambiguous', 'book', 'low');
  }
  if (!text || /^(?:说说看|讲讲|怎么样|然后呢|继续|分析一下)[？?。！!]*$/i.test(text)) {
    return result('ambiguous', 'book', 'low');
  }
  return result('lookup', 'book', 'default');
}

function planChapterSummary(chunks, {
  completeContextChars = COMPLETE_CHAPTER_CONTEXT_CHARS,
  mapInputChars = MAP_INPUT_CHARS,
  maxMapTasks = MAX_MAP_TASKS,
  maxSourceChars = MAX_CHAPTER_SOURCE_CHARS
} = {}) {
  if (!Array.isArray(chunks) || !chunks.length) {
    throw Object.assign(new Error('当前章节没有可用的原文片段'), { code: 'AI_CHAPTER_EVIDENCE_UNAVAILABLE' });
  }
  const sources = chunks.map((chunk, index) => ({
    id: `source-${index + 1}`,
    text: String(chunk?.text || '').trim(),
    chapterHref: String(chunk?.chapterHref || '').slice(0, 500),
    chapterLabel: String(chunk?.chapterLabel || '').slice(0, 300),
    logicalChapterId: String(chunk?.logicalChapterId || '').slice(0, 256),
    logicalSectionId: String(chunk?.logicalSectionId || '').slice(0, 200),
    chapterIndex: Number.isSafeInteger(chunk?.chapterIndex) ? chunk.chapterIndex : null,
    headings: Array.isArray(chunk?.headings) ? chunk.headings.map((heading) => String(heading || '').slice(0, 200)).filter(Boolean).slice(0, 6) : [],
    start: Number.isSafeInteger(chunk?.start) && chunk.start >= 0 ? chunk.start : 0
  })).filter((source) => source.text);
  const totalSourceChars = sources.reduce((total, source) => total + source.text.length, 0);
  const formattedSourceChars = totalSourceChars + sources.reduce((total, source) => total + source.id.length + 5, 0);
  if (!sources.length || totalSourceChars > maxSourceChars) {
    throw Object.assign(new Error('本章内容超出单次 AI 概述预算，请缩小范围后重试。'), {
      code: 'AI_CHAPTER_BUDGET_EXCEEDED',
      statusCode: 413
    });
  }
  const mode = formattedSourceChars <= completeContextChars ? 'complete' : 'map_reduce';
  const maxInput = mode === 'complete' ? completeContextChars : mapInputChars;
  const mapTasks = [];
  let current = [];
  let currentChars = 0;
  const flush = () => {
    if (!current.length) return;
    mapTasks.push({
      id: `map-${mapTasks.length + 1}`,
      sourceIds: current.map((source) => source.id),
      chapterIndex: current[0].chapterIndex,
      chapterHref: current[0].chapterHref,
      chapterLabel: current[0].chapterLabel,
      logicalChapterId: current[0].logicalChapterId,
      start: current[0].start,
      text: current.map((source) => `[${source.id}${source.headings.length ? `｜${source.headings.join(' / ')}` : ''}]\n${source.text}`).join('\n\n')
    });
    current = [];
    currentChars = 0;
  };
  for (const source of sources) {
    const renderedLength = source.text.length + source.id.length + source.headings.join('').length + 4
      + (source.headings.length ? 1 + (source.headings.length - 1) * 3 : 0);
    const resourceChanged = current.length && (
      source.chapterHref !== current[0].chapterHref
      || source.logicalChapterId !== current[0].logicalChapterId
    );
    if (current.length && (currentChars + renderedLength > maxInput || resourceChanged)) flush();
    if (renderedLength > maxInput) {
      throw Object.assign(new Error('章节片段超出单段 AI 处理上限。'), { code: 'AI_CHAPTER_BUDGET_EXCEEDED', statusCode: 413 });
    }
    current.push(source);
    currentChars += renderedLength;
  }
  flush();
  if (mapTasks.length > maxMapTasks) {
    throw Object.assign(new Error('本章内容超出单次 AI 概述预算，请缩小范围后重试。'), {
      code: 'AI_CHAPTER_BUDGET_EXCEEDED',
      statusCode: 413
    });
  }
  return {
    mode,
    sources,
    mapTasks,
    totalSourceChars,
    maxMapTasks,
    reduceInputChars: Math.min(12000, mapTasks.length * 1200),
    formattedSourceChars,
    estimatedInputTokens: Math.ceil((formattedSourceChars + mapTasks.length * 1600) / 1.4),
    coverage: {
      mode: mode === 'complete' ? 'complete-chapter' : 'map-reduce',
      totalChunks: sources.length,
      selectedChunks: sources.length,
      coveredRegions: ['beginning', 'middle', 'ending'],
      ratio: 1
    }
  };
}

function chapterSearchTerms(value) {
  const normalized = String(value || '').toLocaleLowerCase()
    .replace(/这本书|本书|全书|全本书|整本书|整本|主要|核心|观点|是什么|什么|总结|概述|梳理|讲了|讲讲|内容|哪些|章节|章节|整体|请问|请|作者|的|是|和|与|中|吗|呢|？|\?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const terms = new Set(normalized.split(/[^\p{Script=Han}\p{L}\p{N}]+/u).filter(Boolean));
  for (const run of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const text = run[0];
    for (let index = 0; index < text.length - 1; index += 1) terms.add(text.slice(index, index + 2));
  }
  return [...terms].filter((term) => term.length >= 2);
}

function selectBookSummaryCandidates({ chapters, query = '', matches = [], cachedSummaries = [], maxChapters = MAX_BOOK_SUMMARY_CHAPTERS } = {}) {
  const limit = Math.max(1, Math.min(MAX_BOOK_SUMMARY_CHAPTERS, Number.isInteger(maxChapters) ? maxChapters : MAX_BOOK_SUMMARY_CHAPTERS));
  const topLevel = (Array.isArray(chapters) ? chapters : [])
    .filter((chapter) => chapter && typeof chapter.id === 'string' && chapter.id && Number(chapter.depth) === 0)
    .sort((left, right) => Number(left.order) - Number(right.order));
  if (!topLevel.length) return { status: 'insufficient_scope', candidates: [], coverage: { totalChapters: 0, selectedChapters: 0, ratio: 0 } };

  const terms = chapterSearchTerms(query);
  const scores = new Map();
  const summaryByChapter = new Map((Array.isArray(cachedSummaries) ? cachedSummaries : [])
    .filter((summary) => summary?.chapterId && typeof summary.text === 'string')
    .map((summary) => [summary.chapterId, summary.text.toLocaleLowerCase()]));
  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match?.logicalChapterId) continue;
    const current = scores.get(match.logicalChapterId) || 0;
    const retrievalScore = Number(match.score);
    scores.set(match.logicalChapterId, current + (Number.isFinite(retrievalScore) ? Math.max(0, retrievalScore) : 1));
  }
  const ranked = topLevel.map((chapter, index) => {
    const title = String(chapter.label || '').toLocaleLowerCase();
    let lexical = 0;
    for (const term of terms) if (title.includes(term)) lexical += term.length > 2 ? 2 : 1;
    const summary = summaryByChapter.get(chapter.id) || '';
    let summaryRelevance = 0;
    for (const term of terms) if (summary.includes(term)) summaryRelevance += term.length > 2 ? 1 : 0.5;
    return { chapter, index, score: lexical + summaryRelevance + (scores.get(chapter.id) || 0) };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = new Map();
  for (const item of ranked) {
    if (item.score <= 0 || selected.size >= limit) break;
    selected.set(item.chapter.id, item.chapter);
  }
  if (selected.size < limit) {
    const remaining = topLevel.filter((chapter) => !selected.has(chapter.id));
    const slots = limit - selected.size;
    for (let index = 0; index < slots && remaining.length; index += 1) {
      const position = slots === 1 ? Math.floor((remaining.length - 1) / 2) : Math.round(index * (remaining.length - 1) / (slots - 1));
      selected.set(remaining[position].id, remaining[position]);
    }
  }
  const selectedIds = new Set(selected.keys());
  const candidates = ranked
    .filter((item) => selectedIds.has(item.chapter.id))
    .map((item) => item.chapter);
  return {
    status: 'selected',
    candidates,
    coverage: {
      mode: 'chapter-sample',
      totalChapters: topLevel.length,
      selectedChapters: candidates.length,
      ratio: candidates.length / topLevel.length,
      mappingQuality: candidates.every((chapter) => chapter.mappingQuality === 'exact') ? 'exact' : 'inferred'
    }
  };
}

function assessSummaryConfidence({ mappingQuality = 'unresolved', coverage = null, sourceIntegrity = false, citationIntegrity = false, evidenceConflict = false } = {}) {
  const ratio = Number(coverage?.ratio);
  const completeCoverage = Number.isFinite(ratio) && ratio >= 1;
  const exactMapping = mappingQuality === 'exact';
  const level = exactMapping && completeCoverage && sourceIntegrity && citationIntegrity && !evidenceConflict ? 'high' : 'low';
  const reasons = [];
  if (!exactMapping) reasons.push('章节位置仅能推断或未确认');
  if (!completeCoverage) reasons.push('原文覆盖并非完整范围');
  if (!sourceIntegrity) reasons.push('来源未能通过一致性校验');
  if (!citationIntegrity) reasons.push('回答引用不完整或无法全部对应到本次原文来源');
  if (evidenceConflict) reasons.push('原文证据存在冲突');
  return {
    level,
    guarded: level !== 'high',
    reasons,
    message: level === 'high' ? '章节概述有完整原文覆盖和有效来源。' : `概述依据有限：${reasons.join('；')}。`
  };
}

module.exports = { assessSummaryConfidence, classifyAiIntent, planChapterSummary, selectBookSummaryCandidates };
