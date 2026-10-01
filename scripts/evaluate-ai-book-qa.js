'use strict';

// AI 问书 evaluation on the generated test book 《山居茶事》.
//
//   node scripts/evaluate-ai-book-qa.js [--pipeline=legacy|planned] [--format=epub|txt] [--json]
//
// Offline (default) it measures what the model would be given: whether the
// question was routed to the right scope, whether the evidence contains the
// planted facts, and how many chapters an overview covers. Set
// ZHENSHU_EVAL_API=1 with OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
// (and optionally OPENAI_API_FORMAT, OPENAI_SUMMARY_MODEL, OPENAI_EMBEDDING_MODEL)
// to also generate answers, have the model grade them, and count tokens.

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildEpub, buildText, CHAPTERS } = require('../tests/fixtures/ai-book-qa/book');
const cases = require('../tests/fixtures/ai-book-qa/cases.json').cases;

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const PIPELINE = argument('pipeline', 'legacy');
const FORMAT = argument('format', 'epub');
const AS_JSON = process.argv.includes('--json');
const LIVE = process.env.ZHENSHU_EVAL_API === '1';

const CHAPTER_TITLES = CHAPTERS.map((chapter) => chapter.title);

async function prepareBook() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-ai-eval-'));
  const fileName = FORMAT === 'txt' ? 'shanju.txt' : 'shanju.epub';
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, FORMAT === 'txt' ? buildText() : buildEpub());
  const book = {
    id: crypto.createHash('sha256').update(`eval:${FORMAT}`).digest('hex'),
    path: filePath,
    type: FORMAT === 'txt' ? 'txt' : 'epub',
    title: '山居茶事',
    author: '测试作者',
    relativePath: fileName
  };
  return { directory, book, dataRoot: path.join(directory, 'data') };
}

function chapterLocator(position) {
  if (!position?.chapter) return null;
  const href = `OEBPS/chapter${position.chapter}.xhtml`;
  return { index: position.chapter - 1, href, label: CHAPTER_TITLES[position.chapter - 1], position: { href, anchor: '', offset: 0 } };
}

// Today's production behaviour: regex intent with chapter/book summaries
// switched off, then up to six lexical matches as the model's context.
async function legacyPipeline(item, { book, dataRoot }) {
  const { classifyAiIntent } = require('../app/server/ai-chapter-retrieval');
  const { resolveBookPosition, searchBook } = require('../app/server/ai-fts');
  let intent = classifyAiIntent({ question: item.question, selectedText: item.selectedText || '' });
  if (['chapter_summary', 'book_summary'].includes(intent.intent)) intent = { intent: 'lookup', scope: 'book' };
  const locator = chapterLocator(item.position);
  let logicalChapterId = null;
  let logicalSectionId = null;
  if (intent.scope === 'chapter' || intent.scope === 'section') {
    const resolution = await resolveBookPosition(book, dataRoot, locator);
    logicalChapterId = resolution.status === 'resolved' ? resolution.chapterId : null;
    logicalSectionId = resolution.status === 'resolved' ? resolution.sectionId : null;
    if (!logicalChapterId) return { scope: intent.scope, failed: 'insufficient_scope', evidence: [] };
  }
  const result = await searchBook(book, dataRoot, {
    query: item.question,
    selectedText: item.selectedText || '',
    currentChapterIndex: locator ? locator.index : null,
    logicalChapterId,
    logicalSectionId,
    intent: intent.intent,
    limit: 6
  });
  const scope = intent.scope === 'book' ? (item.selectedText ? 'selection' : 'passage') : intent.scope;
  return {
    scope,
    intent: intent.intent,
    evidence: (result.matches || []).map((match) => ({ text: match.text, label: match.chapterLabel, headings: match.headings || [] }))
  };
}

let liveMap = null;

// With a model configured the planned pipeline also uses the book map (导读),
// generated once for the evaluation book and shared by every case.
function liveContext(context, usage) {
  if (!LIVE) return null;
  if (!liveMap) {
    const { createBookMapStore } = require('../app/server/ai-book-map-store');
    const { createBookMapService } = require('../app/server/ai-book-map');
    const store = createBookMapStore({ dataRoot: context.dataRoot });
    liveMap = { store, service: createBookMapService({ dataRoot: context.dataRoot, store }), bookSummary: '' };
  }
  return {
    savedConfig: {},
    env: process.env,
    onUsage: usage,
    map: { service: liveMap.service, savedConfig: {}, env: process.env, onUsage: usage, summaries: new Map() },
    bookSummary: () => liveMap.bookSummary
  };
}

async function plannedPipeline(item, context) {
  const planner = require('../app/server/ai-answer-pipeline');
  let usage = null;
  const onUsage = (value) => {
    usage = {
      inputTokens: (usage?.inputTokens || 0) + (value?.inputTokens || 0),
      outputTokens: (usage?.outputTokens || 0) + (value?.outputTokens || 0),
      cachedTokens: (usage?.cachedTokens || 0) + (value?.cachedTokens || 0)
    };
  };
  const live = liveContext(context, onUsage);
  if (live && liveMap) {
    const latest = await liveMap.store.latest(context.book.id);
    liveMap.bookSummary = latest.get('__book__')?.summary || '';
  }
  const outcome = await planner.evaluatePlan({
    ...context, question: item.question, selectedText: item.selectedText || '', chapter: chapterLocator(item.position), live
  });
  return { ...outcome, usage };
}

function expectedScopeMatches(item, actual) {
  if (item.expectedScope === actual) return true;
  // A summary of the current chapter answered from that chapter's evidence is fine.
  return item.expectedScope === 'passage' && actual === 'book';
}

function score(item, outcome) {
  const evidenceText = outcome.evidence.map((entry) => entry.text).join('\n');
  const gold = item.gold || [];
  const goldHits = gold.filter((snippet) => evidenceText.includes(snippet)).length;
  const coveredChapters = new Set();
  for (const entry of outcome.evidence) {
    const title = CHAPTER_TITLES.find((chapterTitle) => String(entry.label || '').includes(chapterTitle)
      || entry.text.includes(chapterTitle));
    if (title) coveredChapters.add(title);
  }
  const expectedNodes = item.expectedNodes || [];
  const nodeHits = expectedNodes.filter((node) => [...coveredChapters].includes(node)
    || outcome.evidence.some((entry) => (entry.headings || []).includes(node) || String(entry.label || '').includes(node))
    || (outcome.nodes || []).includes(node)).length;
  return {
    id: item.id,
    type: item.type,
    scopeOk: !outcome.failed && expectedScopeMatches(item, outcome.scope),
    goldRecall: gold.length ? goldHits / gold.length : null,
    // Ranking quality: does the first piece of evidence already hold an answer?
    topHit: gold.length && item.type === 'lookup' ? (gold.some((snippet) => String(outcome.evidence[0]?.text || '').includes(snippet)) ? 1 : 0) : null,
    nodeRecall: expectedNodes.length ? nodeHits / expectedNodes.length : null,
    chapterCoverage: item.type === 'overview' ? coveredChapters.size / CHAPTER_TITLES.length : null,
    evidenceChars: evidenceText.length,
    failed: outcome.failed || null,
    usage: outcome.usage || null
  };
}

async function liveAnswer(item, outcome) {
  const { requestOpenAiAnswer } = require('../app/server/ai-service');
  let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  const addUsage = (value) => {
    usage = {
      inputTokens: usage.inputTokens + (value?.inputTokens || 0),
      outputTokens: usage.outputTokens + (value?.outputTokens || 0),
      cachedTokens: usage.cachedTokens + (value?.cachedTokens || 0)
    };
  };
  const startedAt = Date.now();
  const answer = outcome.answerPayload ? await requestOpenAiAnswer({
    request: { rawPayload: outcome.answerPayload },
    env: process.env,
    onUsage: addUsage,
    timeoutMs: 120000
  }) : await requestOpenAiAnswer({
    request: {
      question: item.question,
      selectedText: item.selectedText || '',
      chapter: null,
      context: outcome.evidence.slice(0, 8).map((entry) => ({ text: entry.text.slice(0, 3000), chapterLabel: entry.label || '' })),
      history: []
    },
    env: process.env,
    onUsage: addUsage,
    timeoutMs: 120000
  });
  const elapsedMs = Date.now() - startedAt;
  const reference = [...(item.gold || []), ...(item.expectedNodes || [])].join('；') || '应覆盖全书五章：初到云岭、采茶的时令、制茶的手艺、茶与邻里、离开与回望';
  const verdict = await requestOpenAiAnswer({
    request: {
      rawPayload: {
        instructions: '你是严格的阅读理解评分员。只输出 JSON：{"score":0|1|2,"reason":"一句话"}。2=准确且切题，1=部分正确或不完整，0=错误、答非所问或编造。',
        input: [{ role: 'user', content: [{ type: 'input_text', text: `问题：${item.question}\n参考要点：${reference}\n待评回答：${answer}` }] }],
        max_output_tokens: 200,
        text: { format: { type: 'json_object' } }
      }
    },
    env: process.env,
    modelRole: 'summary',
    timeoutMs: 60000
  });
  let grade = null;
  try { grade = JSON.parse(String(verdict).replace(/^```(?:json)?|```$/g, '').trim()); } catch {}
  return { answer, grade: Number(grade?.score), reason: grade?.reason || '', usage: outcome.usage ? addUsageTotals(outcome.usage, usage) : usage, elapsedMs };
}

function addUsageTotals(left, right) {
  return {
    inputTokens: (left.inputTokens || 0) + (right.inputTokens || 0),
    outputTokens: (left.outputTokens || 0) + (right.outputTokens || 0),
    cachedTokens: (left.cachedTokens || 0) + (right.cachedTokens || 0)
  };
}

function summarize(rows) {
  const average = (values) => {
    const list = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
  };
  const byType = {};
  for (const row of rows) (byType[row.type] ||= []).push(row);
  const section = (list) => ({
    cases: list.length,
    scopeAccuracy: average(list.map((row) => (row.scopeOk ? 1 : 0))),
    goldRecall: average(list.map((row) => row.goldRecall)),
    topHit: average(list.map((row) => row.topHit)),
    nodeRecall: average(list.map((row) => row.nodeRecall)),
    chapterCoverage: average(list.map((row) => row.chapterCoverage)),
    evidenceChars: average(list.map((row) => row.evidenceChars)),
    failures: list.filter((row) => row.failed).length,
    answerScore: average(list.map((row) => (Number.isFinite(row.grade) ? row.grade / 2 : null))),
    inputTokens: average(list.map((row) => row.usage?.inputTokens ?? null)),
    outputTokens: average(list.map((row) => row.usage?.outputTokens ?? null))
  });
  return { overall: section(rows), byType: Object.fromEntries(Object.entries(byType).map(([type, list]) => [type, section(list)])) };
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

function printTable(summary) {
  const lines = [
    `管线：${PIPELINE}　格式：${FORMAT}　真实模型：${LIVE ? '是' : '否'}`,
    '',
    '| 类型 | 题数 | 范围正确 | 证据命中 | 首条命中 | 节点命中 | 章节覆盖 | 平均证据字数 | 失败 | 回答得分 | 平均输入 token |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  const row = (name, data) => lines.push(`| ${name} | ${data.cases} | ${percent(data.scopeAccuracy)} | ${percent(data.goldRecall)} | ${percent(data.topHit)} | ${percent(data.nodeRecall)} | ${percent(data.chapterCoverage)} | ${data.evidenceChars === null ? '—' : Math.round(data.evidenceChars)} | ${data.failures} | ${percent(data.answerScore)} | ${data.inputTokens === null ? '—' : Math.round(data.inputTokens)} |`);
  for (const [type, data] of Object.entries(summary.byType)) row(type, data);
  row('合计', summary.overall);
  console.log(lines.join('\n'));
}

async function main() {
  const context = await prepareBook();
  const pipeline = PIPELINE === 'planned' ? plannedPipeline : legacyPipeline;
  const rows = [];
  try {
    for (const item of cases) {
      let outcome;
      try {
        outcome = await pipeline(item, context);
      } catch (error) {
        outcome = { scope: null, failed: error.code || error.message, evidence: [] };
      }
      const row = score(item, outcome);
      if (LIVE && !outcome.failed) {
        try {
          Object.assign(row, await liveAnswer(item, outcome));
        } catch (error) {
          row.failed = `live:${error.code || error.message}`;
        }
      }
      rows.push(row);
    }
  } finally {
    await fs.rm(context.directory, { recursive: true, force: true }).catch(() => {});
  }
  const summary = summarize(rows);
  if (AS_JSON) console.log(JSON.stringify({ pipeline: PIPELINE, format: FORMAT, live: LIVE, summary, rows }, null, 2));
  else printTable(summary);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { score, summarize };
