'use strict';

const { planChapterSummary } = require('../app/server/ai-chapter-retrieval');

function evaluateSummaryEvidence({ expectedChapterId, plan, answer = '', chapterLength = 0 } = {}) {
  const sources = Array.isArray(plan?.sources) ? plan.sources : [];
  const tasks = Array.isArray(plan?.mapTasks) ? plan.mapTasks : [];
  const ordered = sources.slice().sort((left, right) => left.start - right.start);
  const sourcePurity = ordered.length
    ? ordered.filter((source) => source.logicalChapterId === expectedChapterId).length / ordered.length
    : 0;
  const regions = { beginning: false, middle: false, ending: false };
  if (ordered.length && Number.isFinite(chapterLength) && chapterLength > 0) {
    for (const source of ordered) {
      const ratio = source.start / chapterLength;
      if (ratio <= 0.2) regions.beginning = true;
      if (ratio >= 0.4 && ratio <= 0.6) regions.middle = true;
      if (ratio >= 0.8) regions.ending = true;
    }
  }
  const citations = [...String(answer).matchAll(/【(\d+)】/g)].map((match) => Number(match[1]));
  const sourceReferencesValid = citations.length > 0 && citations.every((index) => Number.isInteger(index) && index > 0 && index <= tasks.length);
  const mapSourceReferencesValid = tasks.every((task) => task.sourceIds.every((sourceId) => sources.some((source) => source.id === sourceId)));
  return {
    sourceCount: sources.length,
    sourcePurity,
    coverage: regions,
    sourceReferencesValid,
    mapSourceReferencesValid,
    withinBudget: Number(plan?.totalSourceChars) <= 22000 && tasks.length <= 8
  };
}

function evaluateSyntheticChapter() {
  const chapterId = 'synthetic-chapter';
  const chunks = ['beginning', 'middle', 'ending'].map((region, index) => ({
    text: `Synthetic ${region} evidence ${index}`,
    logicalChapterId: chapterId,
    chapterHref: 'OPS/chapter.xhtml',
    chapterLabel: 'Synthetic chapter',
    chapterIndex: 0,
    start: [0, 150, 270][index]
  }));
  const plan = planChapterSummary(chunks);
  return evaluateSummaryEvidence({ expectedChapterId: chapterId, plan, answer: 'Supported summary【1】', chapterLength: 300 });
}

if (require.main === module) process.stdout.write(`${JSON.stringify(evaluateSyntheticChapter(), null, 2)}\n`);

module.exports = { evaluateSummaryEvidence, evaluateSyntheticChapter };
