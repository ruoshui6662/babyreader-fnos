'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { PDF_AI_STRUCTURE_LIMITS } = require('./pdf-ai-context');
const { resolvePdfOutlinePageIndex } = require('./pdf-ai-structure');

function workerError(code, message) {
  parentPort.postMessage({ ok: false, code, message });
}

function normalizePageText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

async function run() {
  let loadingTask;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (pdfjs.version !== '6.3.289') {
      return workerError('PDF_PARSE_FAILED', 'PDF parser version does not match the audited build');
    }
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(workerData.pdfBytes),
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      verbosity: 0
    });
    const document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > workerData.limits.maxPages) {
      throw Object.assign(new Error('PDF page count exceeds the extraction limit'), { code: 'PDF_EXTRACTION_BUDGET' });
    }
    if (workerData.mode === 'structure') {
      const structure = await extractStructure(document);
      await loadingTask.destroy();
      parentPort.postMessage({
        ok: true,
        status: structure.textCharacters > 0 ? 'ready' : 'no-text',
        pageCount: document.numPages,
        outline: structure.outline,
        headings: structure.headings,
        textAvailable: structure.textCharacters > 0
      });
      return;
    }
    const pages = [];
    let extractedCharacters = 0;
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex + 1);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const combined = content.items.map((item) => {
        if (!item || typeof item.str !== 'string') return '';
        return item.str + (item.hasEOL ? '\n' : ' ');
      }).join('');
      const text = normalizePageText(combined);
      page.cleanup?.();
      if (text.length > workerData.limits.maxPageCharacters) {
        throw Object.assign(new Error('PDF page text exceeds the extraction limit'), { code: 'PDF_EXTRACTION_BUDGET' });
      }
      extractedCharacters += text.length;
      if (extractedCharacters > workerData.limits.maxBookCharacters) {
        throw Object.assign(new Error('PDF text exceeds the book extraction limit'), { code: 'PDF_EXTRACTION_BUDGET' });
      }
      pages.push({ pageIndex, text });
    }
    await loadingTask.destroy();
    parentPort.postMessage({
      ok: true,
      status: extractedCharacters > 0 ? 'ready' : 'no-text',
      pages: extractedCharacters > 0 ? pages : [],
      extractedCharacters
    });
  } catch (error) {
    try { await loadingTask?.destroy?.(); } catch { /* Parser teardown is best effort. */ }
    const name = String(error?.name || '');
    const code = error?.code === 'PDF_EXTRACTION_BUDGET'
      ? error.code
      : name === 'PasswordException'
        ? 'PDF_PASSWORD_REQUIRED'
        : ['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException'].includes(name)
          ? 'PDF_INVALID'
          : 'PDF_PARSE_FAILED';
    workerError(code, code === 'PDF_PASSWORD_REQUIRED'
      ? 'Password-protected PDFs are not searchable'
      : code === 'PDF_EXTRACTION_BUDGET'
        ? 'PDF extraction limit exceeded'
        : 'PDF text extraction failed');
  }
}

function explicitHeading(title) {
  const text = String(title || '').trim();
  if (text.length < 2 || text.length > PDF_AI_STRUCTURE_LIMITS.maxHeadingChars) return false;
  return /^(?:摘要|关键词|引言|绪论|研究背景|相关研究|文献综述|研究问题(?:与目标)?|研究方法|方法|数据(?:与变量)?|实验(?:设计(?:与数据分析)?)?|研究结果|结果|研究发现|讨论(?:与主要发现)?|结论|研究局限|局限(?:性)?|参考文献|附录)(?:\s|[:：、.．。]|$)/u.test(text)
    || /^(?:第[一二三四五六七八九十百0-9]+[章节部分]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+){0,3}\s+\S)/u.test(text)
    || /^(?:abstract|introduction|background|related work|method(?:s|ology)?|data|experiment(?:s)?|result(?:s)?|discussion|conclusion|limitations?|references|appendix)(?:\s|[:：.．]|$)/iu.test(text);
}

function canonicalHeadingTitle(title) {
  const chineseLabel = title.match(/^(摘要|关键词|引言|绪论|研究背景|相关研究|文献综述|研究问题(?:与目标)?|研究方法|方法|数据(?:与变量)?|实验(?:设计(?:与数据分析)?)?|研究结果|结果|研究发现|讨论(?:与主要发现)?|结论|研究局限|局限(?:性)?|参考文献|附录)(?=\s|[:：、.．。]|$)/u);
  if (chineseLabel) return chineseLabel[1];
  const numbered = title.match(/^((?:第[一二三四五六七八九十百0-9]+[章节部分]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+){0,3}))\s+[^。！？!?；;]{1,70}$/u);
  if (numbered) return `${numbered[1]} ${title.slice(numbered[0].indexOf(' ') + 1)}`;
  const englishLabel = title.match(/^(abstract|introduction|background|related work|method(?:s|ology)?|data|experiment(?:s)?|result(?:s)?|discussion|conclusion|limitations?|references|appendix)(?=\s|[:：.．]|$)/iu);
  return englishLabel ? englishLabel[1] : title;
}

function itemFontSize(item) {
  const transform = item?.transform;
  if (!Array.isArray(transform) || transform.length < 4) return 0;
  return Math.max(Math.hypot(Number(transform[0]) || 0, Number(transform[1]) || 0),
    Math.hypot(Number(transform[2]) || 0, Number(transform[3]) || 0));
}

function headingCandidates(items, pageIndex) {
  const lines = [];
  let current = [];
  for (const item of items || []) {
    if (typeof item?.str !== 'string') continue;
    const text = normalizePageText(item.str);
    if (text) current.push({ text, size: itemFontSize(item) });
    if (item.hasEOL) {
      if (current.length) lines.push(current);
      current = [];
    }
  }
  if (current.length) lines.push(current);
  const sizes = lines.flatMap((line) => line.map((item) => item.size).filter((size) => size > 0)).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  return lines.slice(0, 512).flatMap((line) => {
    const rawTitle = normalizePageText(line.map((item) => item.text).join(' '))
      .slice(0, PDF_AI_STRUCTURE_LIMITS.maxHeadingChars);
    if (!rawTitle || rawTitle.length < 2) return [];
    const title = canonicalHeadingTitle(rawTitle);
    const maxSize = Math.max(...line.map((item) => item.size), 0);
    const explicit = explicitHeading(title);
    const visuallyDistinct = median > 0 && maxSize >= median * 1.25 && title.length <= 80
      && !/[。！？!?；;]$/u.test(title);
    if (!explicit && !visuallyDistinct) return [];
    return [{ title, pageIndex, level: 1, confidence: explicit ? 0.96 : 0.78 }];
  });
}

async function extractStructure(document) {
  const outline = [];
  let visited = 0;
  const sourceOutline = await document.getOutline().catch(() => null);
  async function visit(items, depth) {
    if (!Array.isArray(items) || depth > PDF_AI_STRUCTURE_LIMITS.maxOutlineDepth) return;
    for (const item of items) {
      if (visited >= PDF_AI_STRUCTURE_LIMITS.maxStructureNodes) return;
      visited += 1;
      const title = normalizePageText(item?.title).slice(0, PDF_AI_STRUCTURE_LIMITS.maxHeadingChars);
      const pageIndex = await resolvePdfOutlinePageIndex(item?.dest, document);
      if (title && Number.isSafeInteger(pageIndex) && pageIndex >= 0 && pageIndex < document.numPages) {
        outline.push({ title, pageIndex, level: depth });
      }
      await visit(item?.items, depth + 1);
    }
  }
  await visit(sourceOutline, 1);

  const headings = [];
  let textCharacters = 0;
  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
    const page = await document.getPage(pageIndex + 1);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const combined = content.items.map((item) => {
      if (!item || typeof item.str !== 'string') return '';
      return item.str + (item.hasEOL ? '\n' : ' ');
    }).join('');
    const text = normalizePageText(combined);
    if (text.length > workerData.limits.maxPageCharacters) {
      throw Object.assign(new Error('PDF page text exceeds the extraction limit'), { code: 'PDF_EXTRACTION_BUDGET' });
    }
    textCharacters += text.length;
    if (textCharacters > workerData.limits.maxBookCharacters) {
      throw Object.assign(new Error('PDF text exceeds the book extraction limit'), { code: 'PDF_EXTRACTION_BUDGET' });
    }
    if (headings.length < PDF_AI_STRUCTURE_LIMITS.maxStructureNodes) {
      headings.push(...headingCandidates(content.items, pageIndex)
        .slice(0, PDF_AI_STRUCTURE_LIMITS.maxStructureNodes - headings.length));
    }
    page.cleanup?.();
  }
  return { outline, headings, textCharacters };
}

void run();
