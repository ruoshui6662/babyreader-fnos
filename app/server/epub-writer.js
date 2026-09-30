'use strict';

// Deterministic EPUB 3 writer for derived books. Same input, same bytes:
// fixed ZIP timestamps, fixed entry order (mimetype first, stored), and no
// generated-at metadata. Chapter hrefs come from the caller and are part of
// the reader's annotation contract, so this module never renames them.

const { zipSync, deflateSync, strToU8 } = require('fflate');
const { ZIP_LIMITS } = require('./security');

// DOS timestamps cannot go below 1980; fflate converts using local time.
const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0);
const MODIFIED = '2000-01-01T00:00:00Z';

function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xhtmlDocument({ title, language, body, stylesheet }) {
  const lang = escapeXml(language || 'und');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
${stylesheet ? `<link rel="stylesheet" type="text/css" href="${escapeXml(stylesheet)}"/>\n` : ''}</head>
<body>
${body}
</body>
</html>
`;
}

function navList(items) {
  if (!items.length) return '';
  return `<ol>${items.map((item) => `<li><a href="${escapeXml(item.href)}">${escapeXml(item.label)}</a>${navList(item.children || [])}</li>`).join('')}</ol>`;
}

function ncxPoints(items, counter) {
  return items.map((item) => {
    counter.value += 1;
    const order = counter.value;
    return `<navPoint id="nav-${order}" playOrder="${order}"><navLabel><text>${escapeXml(item.label)}</text></navLabel><content src="${escapeXml(item.href)}"/>${ncxPoints(item.children || [], counter)}</navPoint>`;
  }).join('');
}

function mediaTypeFor(href) {
  const extension = href.slice(href.lastIndexOf('.')).toLowerCase();
  return {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
  }[extension] || 'application/octet-stream';
}

/**
 * @param {object} book
 * @param {string} book.identifier Stable identifier (for example the book ID).
 * @param {{href:string,title:string,body:string}[]} book.chapters XHTML body fragments; href like `text/part-0001.xhtml`.
 * @param {{href:string,bytes:Uint8Array}[]} [book.images] href like `images/img-0001.png`.
 * @param {{label:string,href:string,children?:object[]}[]} [book.toc]
 * @returns {Uint8Array}
 */
function buildEpub(book) {
  const {
    identifier, title, authors = [], language = '', publisher = '',
    chapters, images = [], toc = [], css = '', coverHref = null
  } = book;
  if (!Array.isArray(chapters) || !chapters.length) throw new Error('EPUB needs at least one chapter');
  const hrefs = new Set();
  for (const item of [...chapters, ...images]) {
    if (!/^(text|images)\/[A-Za-z0-9._-]+$/.test(item.href) || hrefs.has(item.href)) {
      throw new Error(`Invalid or duplicate EPUB href: ${item.href}`);
    }
    hrefs.add(item.href);
  }
  const effectiveToc = toc.length ? toc : chapters.map((chapter) => ({ label: chapter.title, href: chapter.href }));

  const files = {};
  files['OEBPS/styles/book.css'] = strToU8(css);
  chapters.forEach((chapter) => {
    files[`OEBPS/${chapter.href}`] = strToU8(xhtmlDocument({
      title: chapter.title || title, language, body: chapter.body, stylesheet: '../styles/book.css'
    }));
  });
  images.forEach((image) => { files[`OEBPS/${image.href}`] = image.bytes; });
  files['OEBPS/nav.xhtml'] = strToU8(xhtmlDocument({
    title: '目录',
    language,
    body: `<nav epub:type="toc" id="toc"><h1>目录</h1>${navList(effectiveToc)}</nav>`
  }));
  files['OEBPS/toc.ncx'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXml(identifier)}"/></head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>${ncxPoints(effectiveToc, { value: 0 })}</navMap>
</ncx>
`);
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="styles/book.css" media-type="text/css"/>',
    ...chapters.map((chapter, index) => `<item id="c${index + 1}" href="${escapeXml(chapter.href)}" media-type="application/xhtml+xml"/>`),
    ...images.map((image, index) => `<item id="i${index + 1}" href="${escapeXml(image.href)}" media-type="${mediaTypeFor(image.href)}"${image.href === coverHref ? ' properties="cover-image"' : ''}/>`)
  ];
  const coverId = coverHref ? `i${images.findIndex((image) => image.href === coverHref) + 1}` : null;
  files['OEBPS/content.opf'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(language || 'und')}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(title)}</dc:title>
${authors.map((author) => `<dc:creator>${escapeXml(author)}</dc:creator>\n`).join('')}<dc:language>${escapeXml(language || 'und')}</dc:language>
${publisher ? `<dc:publisher>${escapeXml(publisher)}</dc:publisher>\n` : ''}<meta property="dcterms:modified">${MODIFIED}</meta>
${coverId && coverId !== 'i0' ? `<meta name="cover" content="${coverId}"/>\n` : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${chapters.map((_, index) => `<itemref idref="c${index + 1}"/>`).join('\n')}
</spine>
</package>
`);
  files['META-INF/container.xml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`);

  // The reader and FTS open EPUBs through safeUnzip, which rejects entries
  // whose compression ratio looks like a ZIP bomb. Highly repetitive text can
  // legitimately exceed it, so such entries are stored uncompressed instead.
  const ratioCeiling = ZIP_LIMITS.maxCompressionRatio * 0.8;
  const levelFor = (name, data) => {
    if (/\.(jpe?g|png|gif|webp)$/i.test(name) || data.length < 1024) return 0;
    return data.length / Math.max(1, deflateSync(data, { level: 6 }).length) > ratioCeiling ? 0 : 6;
  };
  const ordered = { mimetype: [strToU8('application/epub+zip'), { level: 0, mtime: FIXED_MTIME }] };
  for (const name of Object.keys(files).sort()) {
    ordered[name] = [files[name], { level: levelFor(name, files[name]), mtime: FIXED_MTIME }];
  }
  return zipSync(ordered);
}

module.exports = { buildEpub, escapeXml };
