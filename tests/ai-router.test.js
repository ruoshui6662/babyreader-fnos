'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNavigatorPayload, parseNavigatorReply, routeQuestion } = require('../app/server/ai-router');
const { buildTextStructure, parseNumeral } = require('../app/server/ai-text-structure');

function outline(entries) {
  return entries.map(([id, label, depth = 0, parentId = null, chars = 1000]) => ({ id, label, depth, parentId, chars }));
}

const bookWithPreface = outline([
  ['p', '序言'],
  ['c1', '第一章 起点'],
  ['c1s1', '一、出发', 1, 'c1'],
  ['c1s2', '二、迷路', 1, 'c1'],
  ['c2', '第二章 山谷'],
  ['c3', '第三章 回家'],
  ['a', '后记']
]);

test('Chinese and Arabic numerals parse', () => {
  assert.equal(parseNumeral('十二'), 12);
  assert.equal(parseNumeral('一百零五'), 105);
  assert.equal(parseNumeral('两千'), 2000);
  assert.equal(parseNumeral('３'), 3);
  assert.equal(parseNumeral('abc'), null);
});

test('“第N章” matches the chapter number in the title, not the position', () => {
  const route = routeQuestion({ question: '第2章讲了什么', nodes: bookWithPreface });
  assert.equal(route.type, 'chapter_summary');
  assert.deepEqual(route.nodeIds, ['c2']);
  assert.deepEqual(routeQuestion({ question: '第三章写了什么？', nodes: bookWithPreface }).nodeIds, ['c3']);
});

test('chapter + section references and “本节” resolve to sections', () => {
  assert.deepEqual(routeQuestion({ question: '第一章第二节讲了什么', nodes: bookWithPreface }).nodeIds, ['c1s2']);
  const current = routeQuestion({ question: '总结一下本节', nodes: bookWithPreface, position: { chapterId: 'c1', sectionId: 'c1s1' } });
  assert.equal(current.type, 'section_summary');
  assert.deepEqual(current.nodeIds, ['c1s1']);
});

test('quoted and plain chapter titles are matched', () => {
  assert.deepEqual(routeQuestion({ question: '《山谷》这一章的要点', nodes: bookWithPreface }).nodeIds, ['c2']);
  assert.deepEqual(routeQuestion({ question: '后记里作者说了什么', nodes: bookWithPreface }).nodeIds, []);
  assert.deepEqual(routeQuestion({ question: '“后记”讲了什么', nodes: bookWithPreface }).nodeIds, ['a']);
});

test('volumes: “第三章” looks at chapters, “第二卷” at volumes', () => {
  const nodes = outline([
    ['v1', '第一卷 少年'],
    ['v1c1', '第一章 小镇', 1, 'v1'],
    ['v1c2', '第二章 古井', 1, 'v1'],
    ['v2', '第二卷 远行'],
    ['v2c3', '第三章 渡口', 1, 'v2']
  ]);
  assert.deepEqual(routeQuestion({ question: '第三章讲了什么', nodes }).nodeIds, ['v2c3']);
  assert.deepEqual(routeQuestion({ question: '第二卷讲了什么', nodes }).nodeIds, ['v2']);
  assert.deepEqual(routeQuestion({ question: '最后一章写了什么', nodes }).nodeIds, ['v2c3']);
});

test('unnumbered chapters fall back to their order', () => {
  const nodes = outline([['x', '春'], ['y', '夏'], ['z', '秋']]);
  assert.deepEqual(routeQuestion({ question: '第二章讲了什么', nodes }).nodeIds, ['y']);
});

test('whole-book, comparison, selection and plain lookups', () => {
  assert.equal(routeQuestion({ question: '这本书想表达什么', nodes: bookWithPreface }).type, 'overview');
  const compare = routeQuestion({ question: '对比第一章和第三章', nodes: bookWithPreface });
  assert.equal(compare.type, 'compare');
  assert.deepEqual(compare.nodeIds, ['c1', 'c3']);
  assert.equal(routeQuestion({ question: '什么意思', selectedText: '一句话', nodes: bookWithPreface }).type, 'explain_selection');
  const lookup = routeQuestion({ question: '主人公叫什么名字', nodes: bookWithPreface });
  assert.equal(lookup.type, 'lookup');
  assert.equal(lookup.confidence, 'default');
});

test('unplaceable or unscoped summaries are low confidence (for the navigator)', () => {
  assert.equal(routeQuestion({ question: '本章讲了什么', nodes: bookWithPreface }).confidence, 'low');
  const vague = routeQuestion({ question: '核心观点是什么', nodes: bookWithPreface });
  assert.equal(vague.confidence, 'low');
  assert.equal(routeQuestion({ question: '前后有什么变化', nodes: bookWithPreface }).confidence, 'low');
});

test('navigator payload lists numbered nodes and replies map back to node ids', () => {
  const { payload, visible } = buildNavigatorPayload({
    question: '核心观点是什么', nodes: bookWithPreface, position: { chapterId: 'c2' }, summaries: new Map([['c2', '讲山谷里的生活']])
  });
  const text = payload.input[0].content[0].text;
  assert.match(text, /n5\. 第二章 山谷 —— 讲山谷里的生活/);
  assert.match(text, /读者当前位置：n5/);
  assert.equal(payload.text.format.type, 'json_object');
  assert.deepEqual(parseNavigatorReply('{"type":"chapter_summary","nodes":["n5","n99"],"queries":["山谷"]}', visible),
    { type: 'chapter_summary', nodeIds: ['c2'], queries: ['山谷'] });
  assert.equal(parseNavigatorReply('不是 JSON', visible), null);
  assert.equal(parseNavigatorReply('{"type":"hack"}', visible), null);
});

test('plain-text structure: chapters, sections, front matter and Markdown', () => {
  const text = ['书名', '', '前言', '写在前面。', '', '第一章 出发', '正文一。', '一、清晨', '正文二。', '二、黄昏', '正文三。', '第二章 归来', '正文四。'].join('\n');
  const structure = buildTextStructure(text, { title: '书名' });
  assert.deepEqual(structure.chapters.map((node) => [node.label, node.depth]), [
    ['前言', 0], ['第一章 出发', 0], ['一、清晨', 1], ['二、黄昏', 1], ['第二章 归来', 0]
  ]);
  const section = structure.chapters.find((node) => node.label === '一、清晨');
  assert.equal(section.parentId, structure.chapters[1].id);
  const markdown = buildTextStructure(['# 甲', '内容', '## 甲一', '内容', '# 乙', '内容'].join('\n'));
  assert.deepEqual(markdown.chapters.map((node) => [node.label, node.depth]), [['甲', 0], ['甲一', 1], ['乙', 0]]);
  assert.equal(buildTextStructure('只有一段文字，没有任何标题。'), null);
  // “一、…” outside a chapter is an ordinary list item, not a heading.
  assert.equal(buildTextStructure(['一、苹果', '二、香蕉'].join('\n')), null);
});
