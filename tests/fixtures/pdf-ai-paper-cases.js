'use strict';

const paper = {
  id: 'synthetic-academic-paper-v1',
  title: '数字阅读助手对研究论文理解的影响（合成夹具）',
  pages: [
    { section: 'abstract', text: '摘要。本研究的问题是数字阅读助手是否能提升大学生理解研究论文的效果。研究目标是比较结构化提问与普通关键词检索。研究结论显示结构化阅读可能改善研究问题、研究方法和主要发现的识别。' },
    { section: 'introduction', text: '引言。近年来数字阅读普及，读者需要快速理解研究论文。现有关键词检索能定位术语，却难以说明研究背景、论文结构和论证关系。' },
    { section: 'introduction', text: '研究问题与目标。本文考察研究问题、研究设计和结果之间的联系，并提出三个问题：阅读助手能否提高理解准确率，能否改善证据定位，读者能否识别研究局限。' },
    { section: 'method', text: '研究方法。研究样本为 120 名大学生，随机分为结构化阅读组和关键词检索组。两组阅读相同的合成研究论文，随后完成理解测验。' },
    { section: 'method', text: '实验设计与数据分析。实验采用随机对照设计，结构化阅读组使用摘要、方法、结果、局限的提示卡。关键词检索组使用全文搜索。主要指标为理解题正确率和证据页定位准确率。' },
    { section: 'results', text: '研究结果。结构化阅读组理解题正确率为 82%，关键词检索组为 68%。结构化阅读组的证据页定位准确率为 91%，对照组为 73%。组间差异来自合成示例数据。' },
    { section: 'discussion', text: '讨论与主要发现。结果表明，跨论文部分组织证据有助于读者把研究问题、方法和结论联系起来。仅凭单个关键词命中，读者较难还原研究论证链条。' },
    { section: 'limitations', text: '研究局限。样本仅来自一所虚构大学，样本规模有限，测量周期只有一次。测试论文为合成材料，结果不能直接推广到真实学术论文或其他学科。' },
    { section: 'conclusion', text: '结论。结构化证据导航在本合成实验中改善了理解题与页码定位表现。未来研究需要使用多学科真实论文、更多样本和长期追踪验证。' }
  ]
};

const cases = [
  { id: 'paper-overview', intent: 'paper_overview', question: '这篇论文的研究问题和整体结论是什么？', expectedPages: [0, 1, 3, 5, 6, 7, 8] },
  { id: 'method', intent: 'method', question: '研究样本和实验方法是什么？', expectedPages: [3, 4] },
  { id: 'findings', intent: 'findings', question: '主要研究发现和数据结果是什么？', expectedPages: [5, 6] },
  { id: 'limitations', intent: 'limitations', question: '论文明确提到了哪些研究局限？', expectedPages: [7] },
  { id: 'lookup', intent: 'lookup', question: '随机对照设计使用了多少名大学生？', expectedPages: [3, 4] }
];

const variants = {
  noOutline: {
    outline: null,
    pageTexts: paper.pages.map((page) => page.text)
  },
  multiColumn: {
    pageColumns: [[
      { x: 60, y: 700, text: '左栏 研究问题与研究背景。关键词检索无法说明论文结构。' },
      { x: 320, y: 700, text: '右栏 研究方法采用随机对照设计，样本为 120 名大学生。' }
    ]]
  },
  imageOnly: { imageOnly: true }
};

module.exports = { paper, cases, variants };
