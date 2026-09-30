'use strict';

const PDF_AI_LIMITS = Object.freeze({
  maxQuestionChars: 1000,
  maxSelectionChars: 1200,
  maxHistoryItems: 4,
  maxHistoryChars: 2000,
  maxRangePages: 5,
  maxEvidenceItems: 6,
  maxEvidenceChars: 750,
  maxEvidenceTotalChars: 4200,
  maxOutputTokens: 1200
});

const PDF_AI_STRUCTURE_LIMITS = Object.freeze({
  maxStructureNodes: 256,
  maxOutlineDepth: 8,
  maxHeadingChars: 160,
  maxProfileSourceChars: 24000,
  maxMapInputChars: 8000,
  maxMapTasks: 3,
  maxReduceInputChars: 8000,
  maxProfileOutputTokens: 1600,
  maxProfileDurationMs: 45000
});

function pdfAiStructuredRetrievalEnabled(env = process.env) {
  const value = String(env?.BABYREADER_ENABLE_PDF_AI_STRUCTURE || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function pdfAiError(message, statusCode = 400, code = 'PDF_AI_INVALID_REQUEST') {
  return Object.assign(new Error(message), { statusCode, code });
}

function validatePdfAiRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw pdfAiError('PDF AI 请求无效');
  if (body.context !== undefined || body.sources !== undefined || body.chapter !== undefined) {
    throw pdfAiError('PDF 上下文只能由服务端生成，不能提交客户端上下文');
  }
  const question = String(body.question || '').trim();
  if (!question) throw pdfAiError('问题不能为空');
  if (question.length > PDF_AI_LIMITS.maxQuestionChars) throw pdfAiError('问题过长');
  const selectedText = String(body.selectedText || '').replace(/\s+/g, ' ').trim();
  if (selectedText.length > PDF_AI_LIMITS.maxSelectionChars) throw pdfAiError('选中文本过长');
  const scope = String(body.scope || '');
  if (!['selection', 'page', 'page_range', 'searchable_book'].includes(scope)) throw pdfAiError('PDF 提问范围无效');
  if (selectedText && scope !== 'selection') throw pdfAiError('选中文本只能用于选文提问');
  const pageIndex = body.pageIndex;
  const pageEndIndex = body.pageEndIndex;
  if (scope !== 'searchable_book' && (!Number.isSafeInteger(pageIndex) || pageIndex < 0)) throw pdfAiError('页码无效');
  if (scope === 'page_range' && (!Number.isSafeInteger(pageEndIndex) || pageEndIndex < pageIndex
    || pageEndIndex - pageIndex + 1 > PDF_AI_LIMITS.maxRangePages)) throw pdfAiError('页码范围最多 5 页');
  if (scope === 'selection' && !selectedText) throw pdfAiError('请选择 PDF 文本后提问');
  if (scope !== 'page_range' && pageEndIndex !== undefined) throw pdfAiError('页码范围无效');
  if (scope === 'searchable_book' && pageIndex !== undefined) throw pdfAiError('全书检索不可指定页码');
  if (/(?:本章|这一章|当前章节|这章)/u.test(question) && scope !== 'page_range') {
    throw pdfAiError('PDF 无法确认“本章”，请指定页码范围后重试。', 409, 'PDF_AI_INSUFFICIENT_SCOPE');
  }
  const history = body.history === undefined ? [] : body.history;
  if (!Array.isArray(history) || history.length > PDF_AI_LIMITS.maxHistoryItems) throw pdfAiError('AI 对话历史过长');
  let historyChars = 0;
  for (const item of history) {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') throw pdfAiError('AI 对话历史无效');
    historyChars += item.content.length;
  }
  if (historyChars > PDF_AI_LIMITS.maxHistoryChars) throw pdfAiError('AI 对话历史过长');
  const conversationId = body.conversationId ? String(body.conversationId) : '';
  return { question, selectedText, scope, pageIndex: scope === 'searchable_book' ? null : pageIndex,
    pageEndIndex: scope === 'page_range' ? pageEndIndex : scope === 'searchable_book' ? null : pageIndex,
    history, conversationId };
}

function buildPdfAiContext(rows, { query = '' } = {}) {
  const context = [];
  let total = 0;
  const seen = new Set();
  const queryWords = String(query).toLocaleLowerCase().match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/gi) || [];
  const queryTerms = queryWords.flatMap((word) => /[\u3400-\u9fff]/u.test(word)
    ? Array.from({ length: Math.max(0, word.length - 1) }, (_, index) => word.slice(index, index + 2))
    : [word]);
  for (const row of rows || []) {
    if (context.length >= PDF_AI_LIMITS.maxEvidenceItems) break;
    const pageIndex = Number(row.pageIndex);
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) continue;
    const fullText = String(row.text || '').replace(/\s+/g, ' ').trim();
    const lowerText = fullText.toLocaleLowerCase();
    const firstMatch = queryTerms.map((term) => lowerText.indexOf(term)).filter((position) => position >= 0).sort((a, b) => a - b)[0];
    const windowStart = Number.isInteger(firstMatch)
      ? Math.max(0, Math.min(fullText.length - PDF_AI_LIMITS.maxEvidenceChars, firstMatch - 100)) : 0;
    const text = fullText.slice(windowStart, windowStart + PDF_AI_LIMITS.maxEvidenceChars);
    if (!text || seen.has(`${pageIndex}|${text}`)) continue;
    const remaining = PDF_AI_LIMITS.maxEvidenceTotalChars - total;
    if (remaining <= 0) break;
    const excerpt = text.slice(0, remaining);
    seen.add(`${pageIndex}|${text}`);
    total += excerpt.length;
    context.push({ text: excerpt, chapterIndex: pageIndex, chapterHref: '', chapterLabel: `第${pageIndex + 1}页`,
      startOffset: Number.isSafeInteger(row.start) && row.start >= 0 ? row.start + windowStart : 0 });
  }
  return context;
}

function pdfAiSources(context) {
  return context.map((item, index) => ({ citationIndex: index + 1, citationIndexes: [index + 1],
    pageIndex: item.chapterIndex, chapterIndex: item.chapterIndex, chapterLabel: item.chapterLabel,
    startOffset: item.startOffset }));
}

module.exports = {
  PDF_AI_LIMITS,
  PDF_AI_STRUCTURE_LIMITS,
  pdfAiStructuredRetrievalEnabled,
  pdfAiError,
  validatePdfAiRequest,
  buildPdfAiContext,
  pdfAiSources
};
