'use strict';

const { PDF_AI_STRUCTURE_LIMITS } = require('./pdf-ai-context');

const PDF_AI_PROFILE_PROMPT_VERSION = 'pdf-paper-profile-v1';
const PROFILE_FIELDS = ['researchQuestion', 'method', 'findings', 'limitations', 'sectionSummaries'];
const FIELD_LIMITS = Object.freeze({
  researchQuestion: 5,
  method: 8,
  findings: 10,
  limitations: 8,
  sectionSummaries: 12
});
const FACT_MAX_CHARS = 500;

function normalizePages(pages) {
  return (Array.isArray(pages) ? pages : []).flatMap((page) => {
    const pageIndex = Number(page?.pageIndex);
    const text = String(page?.text || '').replace(/\s+/gu, ' ').trim();
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || !text) return [];
    return [{ pageIndex, text, sectionTitle: String(page.sectionTitle || '').slice(0, 160) }];
  }).sort((a, b) => a.pageIndex - b.pageIndex);
}

function sectionPriority(page) {
  const title = page.sectionTitle.toLocaleLowerCase();
  if (/(摘要|abstract|引言|introduction|研究问题|background)/iu.test(title)) return 0;
  if (/(方法|method|数据|experiment)/iu.test(title)) return 1;
  if (/(结果|findings|result|讨论|discussion)/iu.test(title)) return 2;
  if (/(局限|limitations?|结论|conclusion)/iu.test(title)) return 3;
  return 4;
}

function selectProfilePages(structure, pages) {
  const sections = Array.isArray(structure?.sections) ? structure.sections : [];
  const withSections = pages.map((page) => {
    const section = sections.find((item) => page.pageIndex >= item.pageStart && page.pageIndex <= item.pageEnd);
    return { ...page, sectionTitle: page.sectionTitle || section?.title || '' };
  });
  const total = withSections.reduce((sum, page) => sum + page.text.length, 0);
  if (total <= PDF_AI_STRUCTURE_LIMITS.maxProfileSourceChars) return withSections;

  const groups = Array.from({ length: 5 }, () => []);
  for (const page of withSections) groups[sectionPriority(page)].push(page);
  const ordered = [];
  const cursors = groups.map(() => 0);
  while (ordered.length < withSections.length) {
    let changed = false;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      if (cursors[groupIndex] >= groups[groupIndex].length) continue;
      ordered.push(groups[groupIndex][cursors[groupIndex]++]);
      changed = true;
      if (ordered.reduce((sum, page) => sum + Math.min(page.text.length, PDF_AI_STRUCTURE_LIMITS.maxProfileSourceChars), 0)
        >= PDF_AI_STRUCTURE_LIMITS.maxProfileSourceChars) break;
    }
    if (!changed || ordered.reduce((sum, page) => sum + page.text.length, 0) >= PDF_AI_STRUCTURE_LIMITS.maxProfileSourceChars) break;
  }
  let remaining = PDF_AI_STRUCTURE_LIMITS.maxProfileSourceChars;
  return ordered.flatMap((page) => {
    if (remaining <= 0) return [];
    const text = page.text.slice(0, remaining);
    remaining -= text.length;
    return text ? [{ ...page, text }] : [];
  }).sort((a, b) => a.pageIndex - b.pageIndex);
}

function planPdfProfile({ structure, pages } = {}) {
  const selected = selectProfilePages(structure, normalizePages(pages));
  const mapTasks = [];
  let current = [];
  let currentChars = 0;
  let currentTextChars = 0;
  const flush = () => {
    if (!current.length) return;
    const sourceIds = [...new Set(current.map((page) => `page-${page.pageIndex + 1}`))];
    const pageIndexes = [...new Set(current.map((page) => page.pageIndex))];
    mapTasks.push({
      id: `map-${mapTasks.length + 1}`,
      sourceIds,
      pageIndexes,
      text: current.map((page) => page.block).join('\n\n'),
      inputChars: currentChars
    });
    current = [];
    currentChars = 0;
    currentTextChars = 0;
  };
  for (const page of selected) {
    if (mapTasks.length >= PDF_AI_STRUCTURE_LIMITS.maxMapTasks) break;
    let offset = 0;
    const heading = `[page-${page.pageIndex + 1}｜第 ${page.pageIndex + 1} 页${page.sectionTitle ? `｜${page.sectionTitle}` : ''}]\n`;
    while (offset < page.text.length && mapTasks.length < PDF_AI_STRUCTURE_LIMITS.maxMapTasks) {
      const separatorChars = current.length ? 2 : 0;
      const available = PDF_AI_STRUCTURE_LIMITS.maxMapInputChars - currentTextChars - separatorChars - heading.length;
      if (available <= 0) { flush(); continue; }
      const text = page.text.slice(offset, offset + available);
      if (!text) break;
      const block = `${heading}${text}`;
      current.push({ ...page, text, block });
      currentChars += text.length;
      currentTextChars += separatorChars + block.length;
      offset += text.length;
      if (offset < page.text.length || currentTextChars >= PDF_AI_STRUCTURE_LIMITS.maxMapInputChars) flush();
    }
  }
  flush();
  const totalSourceChars = mapTasks.reduce((sum, task) => sum + task.inputChars, 0);
  return {
    mode: mapTasks.length <= 1 ? 'single_map' : 'map_reduce',
    mapTasks,
    totalSourceChars,
    coverage: {
      selectedPages: [...new Set(mapTasks.flatMap((task) => task.pageIndexes))].sort((a, b) => a - b),
      totalPages: normalizePages(pages).length,
      truncated: totalSourceChars < normalizePages(pages).reduce((sum, page) => sum + page.text.length, 0)
    }
  };
}

function normalizeFactList(value, allowedEvidence, maxItems, uncovered) {
  if (!Array.isArray(value)) return [];
  const facts = [];
  for (const item of value.slice(0, maxItems * 2)) {
    const text = String(item?.text || '').replace(/\s+/gu, ' ').trim().slice(0, FACT_MAX_CHARS);
    const evidenceIds = [...new Set((Array.isArray(item?.evidenceIds) ? item.evidenceIds : [])
      .filter((id) => typeof id === 'string' && allowedEvidence.has(id)))].slice(0, 8);
    if (!text || evidenceIds.length === 0) {
      if (text) uncovered.push(text.slice(0, 160));
      continue;
    }
    facts.push({ text, evidenceIds });
    if (facts.length >= maxItems) break;
  }
  return facts;
}

function validatePdfProfile(value, evidence) {
  const allowedEvidence = new Set((Array.isArray(evidence) ? evidence : [])
    .map((item) => String(item?.evidenceId || '')).filter(Boolean));
  const uncovered = [];
  const profile = {};
  for (const field of PROFILE_FIELDS) profile[field] = normalizeFactList(value?.[field], allowedEvidence, FIELD_LIMITS[field], uncovered);
  if (!PROFILE_FIELDS.some((field) => profile[field].length)) {
    throw Object.assign(new Error('PDF 画像缺少可核验的材料依据'), { code: 'PDF_AI_PROFILE_INSUFFICIENT_EVIDENCE' });
  }
  return { version: 1, ...profile, uncovered: uncovered.slice(0, 20) };
}

module.exports = { PDF_AI_PROFILE_PROMPT_VERSION, planPdfProfile, validatePdfProfile };
