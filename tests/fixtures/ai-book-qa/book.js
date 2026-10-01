'use strict';

// A deterministic test book for AI 问书 evaluation: 《山居茶事》.
//
// Five chapters with sections, one chapter longer than 30,000 characters,
// and a handful of planted facts the questions in cases.json ask about.
// Filler sentences come from a seeded generator and never contain the
// planted keywords, so a fact can only be found where it was planted.

const { strToU8, zipSync } = require('fflate');

const FILLER_SUBJECTS = ['山间的雾气', '清晨的露水', '院子里的竹篱', '远处的溪流', '屋后的菜畦', '石阶上的苔痕', '窗外的松涛', '灶间的柴火'];
const FILLER_VERBS = ['慢慢地铺开', '静静地停留', '一点点褪去', '悄悄地聚拢', '缓缓地流过', '不紧不慢地变化'];
const FILLER_TAILS = ['日子也跟着安稳下来。', '仿佛时间放慢了脚步。', '让人想起许多旧事。', '村里的人早已习以为常。', '这样的景象年年如此。', '谁也说不清它从何时开始。'];

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function filler(seed, chars) {
  const random = seeded(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const paragraphs = [];
  let total = 0;
  while (total < chars) {
    const sentences = [];
    for (let index = 0; index < 4; index += 1) sentences.push(`${pick(FILLER_SUBJECTS)}${pick(FILLER_VERBS)}，${pick(FILLER_TAILS)}`);
    const paragraph = sentences.join('');
    paragraphs.push(paragraph);
    total += paragraph.length;
  }
  return paragraphs;
}

// Each section: title, planted paragraphs (facts) and filler size.
const CHAPTERS = [
  {
    title: '第一章 初到云岭',
    sections: [
      { title: '一、搬进山里', facts: ['作者在四十岁那年辞去城里的工作，搬到云岭村一座废弃的老屋里居住。', '作者认为，喝茶首先是一种放慢生活的方式，而不是为了追求名贵的茶叶。'], filler: 1800 },
      { title: '二、第一杯茶', facts: ['作者喝到的第一杯山茶，是邻居用粗陶碗泡的，茶汤微苦而回甘。'], filler: 1500 }
    ]
  },
  {
    title: '第二章 采茶的时令',
    sections: [
      { title: '一、明前与雨前', facts: ['云岭村的人把清明前采摘的嫩芽叫作“明前尖”，价格是雨前茶的三倍。'], filler: 3500 },
      { title: '二、看天采茶', facts: ['采茶最怕连日阴雨，老人们说“雨水茶，三日香”，意思是雨天采的茶香气保持不久。'], filler: 3500 }
    ]
  },
  {
    title: '第三章 制茶的手艺',
    sections: [
      { title: '一、拜师陈守义', facts: ['村里最年长的茶农陈守义，用松枝的余火慢慢烘焙茶叶，他说松烟能让茶带上山林的气息。'], filler: 11000 },
      { title: '二、杀青与揉捻', facts: ['杀青时锅温要高到手掌悬在锅上一寸便觉灼热，揉捻则要“轻—重—轻”三遍。'], filler: 11000 },
      { title: '三、失败的一锅', facts: ['作者第一次独自制茶时炒焦了整整一锅，陈守义只说了一句“火候是熬出来的”。'], filler: 10000 }
    ]
  },
  {
    title: '第四章 茶与邻里',
    sections: [
      { title: '一、换茶', facts: ['村里有以茶换物的旧俗：一斤春茶可以换十斤新米。'], filler: 2800 },
      { title: '二、茶会', facts: ['每年秋分，村民会在祠堂前举办茶会，各家拿出自己最好的茶互相品评。'], filler: 2800 }
    ]
  },
  {
    title: '第五章 离开与回望',
    sections: [
      { title: '一、下山', facts: ['住满七年后，作者因母亲生病回到城里，只带走了一包陈守义送的老茶。'], filler: 2200 },
      { title: '二、茶的意义', facts: ['作者最后写道：茶的意义不在于茶本身，而在于泡茶时愿意等待的那份心。与第一章不同，他此时认为喝茶更是一种与人相处的方式。'], filler: 2200 }
    ]
  }
];

function buildSections() {
  let seed = 7;
  return CHAPTERS.map((chapter) => ({
    title: chapter.title,
    sections: chapter.sections.map((section) => {
      const fill = filler(seed += 11, section.filler);
      // Facts sit at the start and in the middle of the section.
      const middle = Math.floor(fill.length / 2);
      const paragraphs = [section.facts[0], ...fill.slice(0, middle), ...section.facts.slice(1), ...fill.slice(middle)];
      return { title: section.title, paragraphs };
    })
  }));
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEpub() {
  const chapters = buildSections();
  const files = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  };
  const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'];
  const spine = [];
  const navItems = [];
  chapters.forEach((chapter, chapterIndex) => {
    const file = `chapter${chapterIndex + 1}.xhtml`;
    manifest.push(`<item id="c${chapterIndex + 1}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${chapterIndex + 1}"/>`);
    const body = [`<h1 id="top">${escapeXml(chapter.title)}</h1>`];
    const sectionItems = [];
    chapter.sections.forEach((section, sectionIndex) => {
      const id = `s${sectionIndex + 1}`;
      body.push(`<h2 id="${id}">${escapeXml(section.title)}</h2>`);
      for (const paragraph of section.paragraphs) body.push(`<p>${escapeXml(paragraph)}</p>`);
      sectionItems.push(`<li><a href="${file}#${id}">${escapeXml(section.title)}</a></li>`);
    });
    files[`OEBPS/${file}`] = strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(chapter.title)}</title></head><body>${body.join('')}</body></html>`);
    navItems.push(`<li><a href="${file}">${escapeXml(chapter.title)}</a><ol>${sectionItems.join('')}</ol></li>`);
  });
  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${navItems.join('')}</ol></nav></body></html>`);
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">shanju-chashi</dc:identifier><dc:title>山居茶事</dc:title><dc:creator>测试作者</dc:creator><dc:language>zh</dc:language></metadata><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`);
  return Buffer.from(zipSync(files, { level: 0 }));
}

function buildText() {
  const lines = ['山居茶事', ''];
  for (const chapter of buildSections()) {
    lines.push(chapter.title, '');
    for (const section of chapter.sections) {
      lines.push(section.title, '');
      for (const paragraph of section.paragraphs) lines.push(paragraph, '');
    }
  }
  return lines.join('\n');
}

module.exports = { CHAPTERS, buildEpub, buildSections, buildText };
