'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { searchBook } = require('../app/server/ai-fts');

function validateDataset(dataset) {
  if (!dataset || typeof dataset !== 'object') throw new Error('评测数据集格式无效');
  if (dataset.schemaVersion !== 1) throw new Error('评测数据集版本不支持');
  if (!Array.isArray(dataset.chapters) || !dataset.chapters.length) throw new Error('评测章节表不能为空');
  if (!Array.isArray(dataset.cases) || !dataset.cases.length) throw new Error('评测问题集不能为空');

  const chapterIndexes = dataset.chapters.map((chapter) => Number(chapter?.chapterIndex));
  if (chapterIndexes.some((index) => !Number.isInteger(index) || index < 0)) {
    throw new Error('评测章节索引无效');
  }
  if (new Set(chapterIndexes).size !== chapterIndexes.length) throw new Error('评测章节索引重复');
  const knownIndexes = new Set(chapterIndexes);
  const caseIds = new Set();
  let singleChapterCaseCount = 0;
  let multiChapterCaseCount = 0;

  for (const item of dataset.cases) {
    if (!item || typeof item !== 'object' || !String(item.id || '').trim()) throw new Error('评测问题缺少 id');
    if (caseIds.has(item.id)) throw new Error(`评测问题 id 重复：${item.id}`);
    caseIds.add(item.id);
    if (!String(item.question || '').trim()) throw new Error(`评测问题为空：${item.id}`);
    if (!Array.isArray(item.expectedChapterIndexes) || !item.expectedChapterIndexes.length) {
      throw new Error(`评测问题缺少期望章节：${item.id}`);
    }
    if (item.expectedChapterIndexes.some((index) => !knownIndexes.has(Number(index)))) {
      throw new Error(`评测问题引用了未登记章节：${item.id}`);
    }
    if (item.expectedChapterIndexes.length === 1) singleChapterCaseCount += 1;
    else multiChapterCaseCount += 1;
  }

  return {
    chapterCount: dataset.chapters.length,
    caseCount: dataset.cases.length,
    singleChapterCaseCount,
    multiChapterCaseCount,
    chapterIndexes
  };
}

function evaluateCase(item, matches, limit = 6) {
  const expected = new Set(item.expectedChapterIndexes.map(Number));
  const rankedChapterIndexes = (Array.isArray(matches) ? matches : [])
    .slice(0, limit)
    .map((match) => Number(match?.chapterIndex))
    .filter((index) => Number.isInteger(index));
  const uniqueRankedChapterIndexes = [...new Set(rankedChapterIndexes)];
  const firstHitPosition = rankedChapterIndexes.findIndex((index) => expected.has(index));
  const firstHitRank = firstHitPosition < 0 ? null : firstHitPosition + 1;
  const falseRecallCount = uniqueRankedChapterIndexes.filter((index) => !expected.has(index)).length;
  return {
    id: item.id,
    question: item.question,
    expectedChapterIndexes: [...expected],
    rankedChapterIndexes,
    uniqueRankedChapterIndexes,
    firstHitRank,
    hitAt1: firstHitRank === 1,
    hitAt3: firstHitRank !== null && firstHitRank <= 3,
    hitAt6: firstHitRank !== null && firstHitRank <= 6,
    reciprocalRankAt6: firstHitRank === null ? 0 : 1 / firstHitRank,
    falseRecallRate: uniqueRankedChapterIndexes.length ? falseRecallCount / uniqueRankedChapterIndexes.length : 0
  };
}

function summarizeEvaluation(results) {
  const cases = Array.isArray(results) ? results : [];
  const count = cases.length || 1;
  return {
    caseCount: cases.length,
    recallAt1: cases.filter((item) => item.hitAt1).length / count,
    recallAt3: cases.filter((item) => item.hitAt3).length / count,
    recallAt6: cases.filter((item) => item.hitAt6).length / count,
    mrrAt6: cases.reduce((total, item) => total + item.reciprocalRankAt6, 0) / count,
    meanFalseRecallRate: cases.reduce((total, item) => total + item.falseRecallRate, 0) / count,
    cases
  };
}

async function evaluateBook({ bookPath, dataset, dataRoot, bookId }) {
  const validation = validateDataset(dataset);
  const resultBook = {
    id: bookId || crypto.createHash('sha256').update(path.resolve(bookPath)).digest('hex'),
    path: path.resolve(bookPath),
    type: 'epub',
    title: dataset.book?.title || path.basename(bookPath)
  };
  const results = [];
  for (const item of dataset.cases) {
    const search = await searchBook(resultBook, dataRoot, {
      query: item.question,
      limit: 6
    });
    results.push({
      ...evaluateCase(item, search.matches, 6),
      available: search.available
    });
  }
  return {
    book: dataset.book,
    dataset: validation,
    metrics: summarizeEvaluation(results)
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    args[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.book) throw new Error('用法：node scripts/evaluate-ai-retrieval.js --book <book.epub> [--dataset <questions.json>]');
  const datasetPath = args.dataset
    ? path.resolve(String(args.dataset))
    : path.resolve(__dirname, '../tests/fixtures/ai-retrieval-questions.json');
  const dataset = JSON.parse(await fs.readFile(datasetPath, 'utf8'));
  const dataRoot = args['data-root']
    ? path.resolve(String(args['data-root']))
    : await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-ai-eval-'));
  try {
    const report = await evaluateBook({ bookPath: String(args.book), dataset, dataRoot });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (!args['data-root']) await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  validateDataset,
  evaluateCase,
  summarizeEvaluation,
  evaluateBook,
  parseArgs
};
