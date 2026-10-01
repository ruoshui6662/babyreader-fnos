'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { searchPdfEvidenceRows, isFtsAvailable } = require('../app/server/ai-fts');
const { searchPdfEvidenceRowsByRanges } = require('../app/server/ai-fts');
const { extractPdfStructureSignals } = require('../app/server/pdf-text');
const { buildPdfStructure } = require('../app/server/pdf-ai-structure');
const { classifyPdfQuestion, planPdfRetrieval } = require('../app/server/pdf-ai-retrieval');
const { createImageOnlyPdfFixture, createPdfFixture } = require('../tests/fixtures/pdf-fixtures');
const { paper, cases, variants } = require('../tests/fixtures/pdf-ai-paper-cases');

function pageRecall(expectedPages, actualPages) {
  if (!expectedPages.length) return null;
  const actual = new Set(actualPages);
  return expectedPages.filter((page) => actual.has(page)).length / expectedPages.length;
}

async function evaluateQuery({ id, intent, question, expectedPages, bytes, root, compare = false }) {
  const bookPath = path.join(root, `${id}.pdf`);
  await fs.writeFile(bookPath, bytes);
  const bookId = crypto.createHash('sha256').update(id).digest('hex');
  const result = await searchPdfEvidenceRows({ id: bookId, path: bookPath, type: 'pdf', title: id },
    path.join(root, 'var'), { query: question, limit: 6 });
  const baselinePages = [...new Set(result.rows.map((row) => row.pageIndex))];
  const report = {
    caseId: id,
    intent,
    status: result.status,
    expectedPages,
    baselinePages,
    pageRecall: pageRecall(expectedPages, baselinePages),
    evidenceChars: result.rows.reduce((sum, row) => sum + row.text.length, 0)
  };
  if (compare) {
    const signals = await extractPdfStructureSignals({ id: bookId, path: bookPath, type: 'pdf', title: id });
    const structure = buildPdfStructure(signals);
    const resolvedIntent = classifyPdfQuestion(question);
    const plan = planPdfRetrieval({ intent: resolvedIntent || intent, structure });
    const structured = plan.ranges.length
      ? await searchPdfEvidenceRowsByRanges({ id: bookId, path: bookPath, type: 'pdf', title: id },
        path.join(root, 'var'), { query: question, ranges: plan.ranges, limit: 6 })
      : result;
    const structuredPages = [...new Set(structured.rows.map((row) => row.pageIndex))];
    report.structuredStatus = structured.status;
    report.structureMode = structure.mode;
    report.structureSections = structure.sections.map((section) => ({ title: section.title, pageStart: section.pageStart, pageEnd: section.pageEnd }));
    report.plannedRanges = plan.ranges;
    report.retrievalMode = plan.ranges.length ? 'structure_ranges+fts' : 'fts_fallback';
    report.structuredPages = structuredPages;
    report.baselinePageRecall = report.pageRecall;
    report.pageRecall = pageRecall(expectedPages, structuredPages);
    report.structuredEvidenceChars = structured.rows.reduce((sum, row) => sum + row.text.length, 0);
  }
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const compare = argv.includes('--compare');
  if (!argv.includes('--baseline') && !compare) {
    throw new Error('用法：node scripts/evaluate-pdf-ai-structured-retrieval.js --baseline|--compare');
  }
  if (!isFtsAvailable()) throw new Error('当前 Node.js 运行时不可用 SQLite FTS5');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-pdf-ai-baseline-'));
  try {
    const bytes = createPdfFixture({ pageTexts: paper.pages.map((page) => page.text) });
    const reports = [];
    for (const item of cases) {
      reports.push(await evaluateQuery({ ...item, bytes, root, compare }));
    }
    reports.push(await evaluateQuery({
      id: 'multi-column', intent: 'lookup', question: '研究方法 随机对照设计 样本 大学生',
      expectedPages: [0], bytes: createPdfFixture({ pageColumns: variants.multiColumn.pageColumns }), root, compare
    }));
    reports.push(await evaluateQuery({
      id: 'image-only', intent: 'unsupported', question: '论文主要发现是什么？',
      expectedPages: [], bytes: createImageOnlyPdfFixture(), root, compare
    }));
    const report = {
      mode: compare ? 'structured-vs-baseline' : 'baseline',
      generatedAt: new Date().toISOString(),
      source: 'synthetic-fixtures-only',
      providerCalls: 0,
      note: compare ? 'offline structure and FTS comparison; no profile model calls' : undefined,
      cases: reports
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (reports.some((item) => !['ready', 'no-text'].includes(item.status))) process.exitCode = 1;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { evaluateQuery, pageRecall, main };
