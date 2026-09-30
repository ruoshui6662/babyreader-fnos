'use strict';

const { PDF_AI_STRUCTURE_LIMITS } = require('./pdf-ai-context');
const { PDF_TEXT_LIMITS } = require('./pdf-text-limits');

const PDF_AI_STRUCTURE_VERSION = 'pdf-structure-v1';
const PAGE_WINDOW_SIZE = 8;

function cleanTitle(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim()
    .slice(0, PDF_AI_STRUCTURE_LIMITS.maxHeadingChars);
}

function normalizeOutlineTitle(value) {
  return cleanTitle(value).toLocaleLowerCase();
}

async function resolvePdfOutlinePageIndex(destination, pdfDocument) {
  if (!pdfDocument || typeof pdfDocument.getPageIndex !== 'function') return null;
  try {
    const resolved = typeof destination === 'string'
      ? await pdfDocument.getDestination(destination)
      : destination;
    const pageRef = Array.isArray(resolved) ? resolved[0] : null;
    if (!pageRef) return null;
    const pageIndex = await pdfDocument.getPageIndex(pageRef);
    return Number.isSafeInteger(pageIndex) && pageIndex >= 0 ? pageIndex : null;
  } catch {
    return null;
  }
}

function flattenOutline(outline, pageCount) {
  const result = [];
  const seenTitles = new Set();
  let visited = 0;
  function visit(items, depth) {
    if (!Array.isArray(items) || depth > PDF_AI_STRUCTURE_LIMITS.maxOutlineDepth) return;
    for (const item of items) {
      if (visited >= PDF_AI_STRUCTURE_LIMITS.maxStructureNodes) return;
      visited += 1;
      const title = cleanTitle(item?.title);
      const pageIndex = Number(item?.pageIndex);
      const key = normalizeOutlineTitle(title);
      if (title && !seenTitles.has(key) && Number.isSafeInteger(pageIndex) && pageIndex >= 0 && pageIndex < pageCount) {
        seenTitles.add(key);
        result.push({ title, pageIndex, level: Math.min(depth, PDF_AI_STRUCTURE_LIMITS.maxOutlineDepth), confidence: 1 });
      }
      visit(item?.items, depth + 1);
    }
  }
  visit(outline, 1);
  return result;
}

function normalizeHeadingCandidates(headings, pageCount) {
  const candidates = [];
  const seenTitles = new Set();
  for (const item of Array.isArray(headings) ? headings : []) {
    if (candidates.length >= PDF_AI_STRUCTURE_LIMITS.maxStructureNodes) break;
    const title = cleanTitle(item?.title);
    const pageIndex = Number(item?.pageIndex);
    const confidence = Number(item?.confidence);
    if (!title || !Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount
      || !Number.isFinite(confidence) || confidence < 0.75) continue;
    const key = normalizeOutlineTitle(title);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    candidates.push({ title, pageIndex, level: Math.max(1, Math.min(8, Number(item.level) || 1)), confidence });
  }
  return candidates;
}

function sectionsFromEntries(entries, pageCount, source) {
  const byPage = new Map();
  for (const entry of [...entries].sort((a, b) => a.pageIndex - b.pageIndex || b.confidence - a.confidence)) {
    if (!byPage.has(entry.pageIndex)) byPage.set(entry.pageIndex, entry);
  }
  const ordered = [...byPage.values()].slice(0, PDF_AI_STRUCTURE_LIMITS.maxStructureNodes);
  return ordered.map((entry, index) => {
    const nextPage = ordered[index + 1]?.pageIndex;
    const pageEnd = Math.max(entry.pageIndex, Number.isSafeInteger(nextPage) ? nextPage - 1 : pageCount - 1);
    return {
      id: `section-${index + 1}`,
      title: entry.title,
      pageStart: entry.pageIndex,
      pageEnd,
      level: entry.level,
      source,
      confidence: entry.confidence
    };
  });
}

function pageWindows(pageCount) {
  const sections = [];
  for (let start = 0; start < pageCount; start += PAGE_WINDOW_SIZE) {
    const end = Math.min(pageCount - 1, start + PAGE_WINDOW_SIZE - 1);
    sections.push({
      id: `pages-${start}-${end}`,
      title: `第 ${start + 1}–${end + 1} 页`,
      pageStart: start,
      pageEnd: end,
      level: 1,
      source: 'page_window',
      confidence: 0
    });
  }
  return sections;
}

function buildPdfStructure(signals) {
  const pageCount = Number(signals?.pageCount);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > PDF_TEXT_LIMITS.maxPages) {
    return { mode: 'unavailable', pageCount: 0, sections: [] };
  }
  const outline = flattenOutline(signals.outline, pageCount);
  if (outline.length) return { mode: 'outline', pageCount, sections: sectionsFromEntries(outline, pageCount, 'outline') };
  const headings = normalizeHeadingCandidates(signals.headings, pageCount);
  if (headings.length) return { mode: 'headings', pageCount, sections: sectionsFromEntries(headings, pageCount, 'heading') };
  return { mode: 'page_windows', pageCount, sections: pageWindows(pageCount) };
}

module.exports = {
  PDF_AI_STRUCTURE_VERSION,
  PAGE_WINDOW_SIZE,
  resolvePdfOutlinePageIndex,
  buildPdfStructure
};
