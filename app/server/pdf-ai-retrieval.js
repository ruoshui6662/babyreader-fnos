'use strict';

const { buildPdfAiContext, pdfAiSources } = require('./pdf-ai-context');

const SECTION_TERMS = Object.freeze({
  paper_overview: /(摘要|abstract|引言|introduction|研究问题|目标|方法|method|结果|result|讨论|discussion|结论|conclusion|局限|limitation)/iu,
  method: /(方法|method|数据|样本|实验|experiment|研究设计|变量|procedure)/iu,
  findings: /(结果|发现|findings|result|讨论|discussion|结论|conclusion)/iu,
  limitations: /(局限|limitation|不足|future work|未来研究)/iu,
  comparison: /(摘要|abstract|相关研究|文献综述|引言|introduction|方法|method|结果|result|讨论|discussion|结论|conclusion)/iu,
  lookup: /(摘要|abstract|引言|introduction|方法|method|结果|result|结论|conclusion)/iu
});

function classifyPdfQuestion(question, { hasSelection = false } = {}) {
  if (hasSelection) return 'selection';
  const text = String(question || '').trim().toLocaleLowerCase();
  if (/(比较|相比|对比|差异|异同|compare|comparison|contrast|versus|\bvs\.?\b)/iu.test(text)) return 'comparison';
  if (/(局限|限制|不足|缺陷|未来研究|limitations?|weakness(?:es)?|future work)/iu.test(text)) return 'limitations';
  if (/(主要研究发现|主要发现|研究发现|研究结果|结果如何|结论如何|发现了什么|数据结果|findings?|results?|conclusion)/iu.test(text)) return 'findings';
  if (/(研究方法|方法|样本|数据|实验设计|变量|method(?:ology)?|sample|data|procedure|experiment)/iu.test(text)) return 'method';
  if (/(整体|总体|主要讲什么|核心观点|研究问题和|研究目的|研究目标|论文概述|整体结论|overview|research question|purpose of (?:the )?study)/iu.test(text)) return 'paper_overview';
  return 'lookup';
}

function mergeRanges(ranges, pageCount) {
  const sorted = ranges.flatMap((range) => {
    const pageStart = Math.max(0, Number(range?.pageStart));
    const pageEnd = Math.min(pageCount - 1, Number(range?.pageEnd));
    return Number.isSafeInteger(pageStart) && Number.isSafeInteger(pageEnd) && pageEnd >= pageStart
      ? [{ pageStart, pageEnd }] : [];
  }).sort((a, b) => a.pageStart - b.pageStart || a.pageEnd - b.pageEnd);
  const merged = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.pageStart <= previous.pageEnd) previous.pageEnd = Math.max(previous.pageEnd, range.pageEnd);
    else merged.push({ ...range });
  }
  return merged.slice(0, 6);
}

function planPdfRetrieval({ intent = 'lookup', structure, currentPage = null } = {}) {
  if (intent === 'lookup' || intent === 'selection') {
    return { intent, ranges: [], structureMode: structure?.mode || 'unknown' };
  }
  const pageCount = Number(structure?.pageCount);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) return { intent, ranges: [], structureMode: 'unavailable' };
  const sections = Array.isArray(structure?.sections) ? structure.sections : [];
  if (!sections.length) {
    const page = Number.isSafeInteger(currentPage) ? Math.min(Math.max(currentPage, 0), pageCount - 1) : 0;
    const pageStart = Math.floor(page / 8) * 8;
    return { intent, ranges: [{ pageStart, pageEnd: Math.min(pageCount - 1, pageStart + 7) }], structureMode: structure?.mode || 'page_windows' };
  }
  if (intent === 'paper_overview') {
    const select = (pattern) => sections.find((section) => pattern.test(String(section.title || '')));
    const representative = [
      select(/摘要|abstract/iu),
      select(/引言|绪论|introduction|研究背景/iu),
      select(/方法|method|实验|experiment|数据/iu),
      select(/研究结果|结果|findings?|results?/iu),
      select(/讨论|discussion/iu),
      select(/结论|conclusion/iu) || select(/局限|limitations?/iu)
    ].filter(Boolean);
    return {
      intent,
      structureMode: structure.mode || 'unknown',
      ranges: mergeRanges(representative.map((section) => ({ pageStart: section.pageStart, pageEnd: section.pageEnd })), pageCount)
    };
  }
  const matcher = SECTION_TERMS[intent] || SECTION_TERMS.lookup;
  let matching = sections.filter((section) => matcher.test(String(section.title || '')));
  if (intent === 'method' && matching.length) {
    const primary = matching.filter((section) => /(method|方法|数据|样本|实验)/iu.test(section.title));
    const supporting = sections.filter((section) => /(摘要|abstract|引言|introduction|研究背景)/iu.test(section.title));
    matching = [...primary, ...supporting, ...matching.filter((section) => !primary.includes(section) && !supporting.includes(section))];
  }
  if (!matching.length) matching = sections.slice(0, 6);
  return {
    intent,
    structureMode: structure.mode || 'unknown',
    ranges: mergeRanges(matching.slice(0, 6).map((section) => ({ pageStart: section.pageStart, pageEnd: section.pageEnd })), pageCount)
  };
}

function composePdfEvidence({ rows = [], structure, intent = 'lookup', question = '' } = {}) {
  const context = buildPdfAiContext(rows, { query: question });
  const pageSet = new Set(context.map((item) => item.chapterIndex));
  const covered = (Array.isArray(structure?.sections) ? structure.sections : [])
    .filter((section) => [...pageSet].some((pageIndex) => pageIndex >= section.pageStart && pageIndex <= section.pageEnd))
    .map((section) => ({ id: section.id, title: section.title, pageStart: section.pageStart, pageEnd: section.pageEnd }));
  return {
    context,
    sources: pdfAiSources(context),
    retrievalMode: 'structured_fts',
    intent,
    coverage: {
      sections: covered,
      pages: [...pageSet].sort((a, b) => a - b),
      structureMode: structure?.mode || 'unknown',
      claimsWholePaper: false
    }
  };
}

module.exports = { classifyPdfQuestion, planPdfRetrieval, composePdfEvidence, mergeRanges };
