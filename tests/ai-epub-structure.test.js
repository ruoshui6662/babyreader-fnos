'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const structureCases = require('./fixtures/ai-chapter-structure-cases.json');

let parseEpubStructure = null;
let normalizeArchivePath = null;
let MAX_TOC_DEPTH = 0;
try {
  ({ parseEpubStructure, normalizeArchivePath, MAX_TOC_DEPTH } = require('../app/server/ai-epub-structure'));
} catch {
  // The first RED run asserts the intended missing parser behavior directly.
}

function fileMap(entries) {
  return Object.fromEntries(Object.entries(entries).map(([name, content]) => [name, Buffer.from(content)]));
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function relativeToOps(value) {
  return String(value || '').replace(/^OPS\//, '');
}

function renderNavEntries(entries) {
  return `<ol>${entries.map((entry) => `<li><a href="${escapeXml(entry.href)}">${escapeXml(entry.label)}</a>${entry.children?.length ? renderNavEntries(entry.children) : ''}</li>`).join('')}</ol>`;
}

function syntheticEpubFiles(item) {
  const files = {
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
  };
  const hasToc = item.kind !== 'no-toc' && item.kind !== 'unmapped-current-position';
  const manifest = [];
  if (hasToc) manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  item.spine.forEach((href, index) => {
    manifest.push(`<item id="s${index}" href="${escapeXml(relativeToOps(href))}" media-type="application/xhtml+xml"/>`);
  });
  files['OPS/book.opf'] = `<package><manifest>${manifest.join('')}</manifest><spine>${item.spine.map((_, index) => `<itemref idref="s${index}"/>`).join('')}</spine></package>`;
  if (hasToc) files['OPS/nav.xhtml'] = `<html><body><nav epub:type="toc">${renderNavEntries(item.toc)}</nav></body></html>`;

  for (const href of item.spine) {
    const anchors = item.anchors.filter((anchor) => anchor.href === href);
    const body = anchors.length
      ? anchors.map((anchor) => anchor.heading
        ? `<h1 id="${escapeXml(anchor.id)}">${escapeXml(anchor.heading)}</h1><p>合成测试正文内容。</p>`
        : `<p id="${escapeXml(anchor.id)}">合成无标题正文内容。</p>`).join('')
      : `<p>合成测试正文：${escapeXml(href)}</p>`;
    files[href] = `<html><body>${body}</body></html>`;
  }
  return fileMap(files);
}

test('TOC fragment links in one XHTML resource map to distinct logical chapters', () => {
  assert.equal(typeof parseEpubStructure, 'function', 'server EPUB structure parser must be available');
  const structure = parseEpubStructure(fileMap({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="text" href="content.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine><itemref idref="text"/></spine></package>`,
    'OPS/nav.xhtml': `<html><body><nav epub:type="toc"><ol>
      <li><a href="content.xhtml#chapter-a">测试章甲</a></li>
      <li><a href="content.xhtml#chapter-b">测试章乙</a></li>
      </ol></nav></body></html>`,
    'OPS/content.xhtml': `<html><body><h1 id="chapter-a">测试章甲</h1><p>甲段内容。</p>
      <h1 id="chapter-b">测试章乙</h1><p>乙段内容。</p></body></html>`
  }));

  assert.equal(structure.chapters.length, 2);
  assert.deepEqual(structure.chapters.map((chapter) => chapter.label), ['测试章甲', '测试章乙']);
  assert.notEqual(structure.chapters[0].startOffset, structure.chapters[1].startOffset);
  assert.equal(structure.chapters[0].mappingQuality, 'exact');
  assert.equal(structure.chapters[0].endOffset, structure.chapters[1].startOffset);
});

test('synthetic EPUB boundary fixtures preserve chapter hierarchy and conservative mapping quality', () => {
  assert.equal(typeof parseEpubStructure, 'function', 'server EPUB structure parser must be available');
  const cases = structureCases.cases.filter((item) => item.id !== 'unmapped-current-position');
  const structures = new Map(cases.map((item) => [item.id, parseEpubStructure(syntheticEpubFiles(item))]));

  const across = structures.get('chapter-across-spine-resources').chapters;
  assert.equal(across[0].spineStart, 0);
  assert.equal(across[0].spineEnd, 2);
  assert.equal(across[0].end.spineIndex, 2);

  const nested = structures.get('nested-navigation').toc[0];
  assert.equal(nested.children.length, 2);
  assert.equal(nested.children[0].parentId, nested.id);
  assert.equal(nested.children[0].depth, 1);

  const inferred = structures.get('missing-navigation-document').chapters;
  assert.equal(inferred.length, 2);
  assert.ok(inferred.every((chapter) => chapter.mappingQuality === 'inferred'));

  const encoded = structures.get('percent-encoded-fragment').chapters[0];
  assert.equal(encoded.fragment, '章节');
  assert.equal(encoded.mappingQuality, 'exact');

  const ambiguous = structures.get('duplicate-and-missing-headings').chapters;
  assert.equal(ambiguous.length, 2);
  assert.equal(ambiguous[0].mappingQuality, 'exact');
  assert.equal(ambiguous[1].mappingQuality, 'inferred');

  const bodyChapter = structures.get('front-matter-outside-toc').chapters;
  assert.equal(bodyChapter.length, 1);
  assert.equal(bodyChapter[0].spineStart, 2);

  const noToc = structures.get('missing-navigation-document');
  assert.equal(noToc.toc[0].label, '推断测试章甲');
});

test('archive paths reject traversal encoded inside a path segment', () => {
  assert.equal(typeof normalizeArchivePath, 'function');
  assert.equal(normalizeArchivePath('OPS/%2e%2e%2foutside.xhtml'), '');
  assert.equal(normalizeArchivePath('OPS/%2e%2e/outside.xhtml'), 'outside.xhtml');
});

test('legacy NCX navigation resolves chapter fragments', () => {
  const structure = parseEpubStructure(fileMap({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><manifest>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine toc="ncx"><itemref idref="text"/></spine></package>`,
    'OPS/toc.ncx': `<ncx><navMap><navPoint id="p1"><navLabel><text>旧版测试章</text></navLabel>
      <content src="text.xhtml#chapter"/></navPoint></navMap></ncx>`,
    'OPS/text.xhtml': '<html><body><h1 id="chapter">旧版测试章</h1><p>正文</p></body></html>'
  }));

  assert.equal(structure.chapters.length, 1);
  assert.equal(structure.chapters[0].label, '旧版测试章');
  assert.equal(structure.chapters[0].mappingQuality, 'exact');
});

test('nested NCX navigation keeps each chapter under its own volume', () => {
  const point = (id, label, src, children = '') => `<navPoint id="${id}"><navLabel><text>${label}</text></navLabel><content src="${src}"/>${children}</navPoint>`;
  const structure = parseEpubStructure(fileMap({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><manifest>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
      <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>
      <item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>
      </manifest><spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine></package>`,
    'OPS/toc.ncx': `<ncx><navMap>${point('p0', '人物志', 'a.xhtml', point('p1', '甲', 'a.xhtml#x'))}${point('p2', '第一册', 'b.xhtml', point('p3', '第一章', 'b.xhtml#c1') + point('p4', '第二章', 'b.xhtml#c2'))}</navMap></ncx>`,
    'OPS/a.xhtml': '<html><body><h1>人物志</h1><p id="x">甲的介绍</p></body></html>',
    'OPS/b.xhtml': '<html><body><h1>第一册</h1><h2 id="c1">第一章</h2><p>一</p><h2 id="c2">第二章</h2><p>二</p></body></html>'
  }));
  const byLabel = Object.fromEntries(structure.chapters.map((chapter) => [chapter.label, chapter]));
  assert.deepEqual(structure.chapters.map((chapter) => chapter.label), ['人物志', '甲', '第一册', '第一章', '第二章']);
  assert.equal(byLabel['甲'].parentId, byLabel['人物志'].id);
  assert.equal(byLabel['第一章'].parentId, byLabel['第一册'].id);
  assert.equal(byLabel['第二章'].parentId, byLabel['第一册'].id);
});

test('TOC nesting beyond the parser bound fails with a stable error code', () => {
  const nested = `${'<ol><li>'.repeat(MAX_TOC_DEPTH + 1)}<a href="text.xhtml#chapter">超深目录</a>${'</li></ol>'.repeat(MAX_TOC_DEPTH + 1)}`;
  assert.throws(() => parseEpubStructure(fileMap({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf': `<package><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="text"/></spine></package>`,
    'OPS/nav.xhtml': `<html><body><nav epub:type="toc">${nested}</nav></body></html>`,
    'OPS/text.xhtml': '<html><body><h1 id="chapter">标题</h1></body></html>'
  })), (error) => error.code === 'AI_EPUB_TOC_LIMIT');
});
