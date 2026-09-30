'use strict';

function createPdfFixture({ text = 'BabyReader synthetic PDF fixture', pages = 1, pageTexts = null, pageColumns = null, encrypted = false } = {}) {
  const pageCount = Array.isArray(pageColumns) ? pageColumns.length : Array.isArray(pageTexts) ? pageTexts.length : pages;
  const fontObject = 3 + pageCount * 2;
  const pdfText = (value) => {
    const bytes = Buffer.from(String(value), 'utf16le');
    for (let index = 0; index < bytes.length; index += 2) {
      const first = bytes[index];
      bytes[index] = bytes[index + 1];
      bytes[index + 1] = first;
    }
    return `FEFF${bytes.toString('hex').toUpperCase()}`;
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`
  ];
  for (let page = 0; page < pageCount; page += 1) {
    const pageObject = 3 + page * 2;
    const streamObject = pageObject + 1;
    const pageText = Array.isArray(pageTexts) ? pageTexts[page] : text;
    const columns = Array.isArray(pageColumns?.[page]) ? pageColumns[page] : null;
    const stream = columns ? columns.map(({ text: columnText, x, y }) =>
      `BT /F1 12 Tf ${x} ${y} Td 12 TL ${String(columnText).split(/\r?\n/)
        .map((line) => `<${pdfText(line)}> Tj T*`).join('\n')} ET`).join('\n')
      : pageText == null ? '' : `BT /F1 12 Tf 72 720 Td 12 TL ${String(pageText)
        .split(/\r?\n/).map((line) => `<${pdfText(line)}> Tj T*`).join('\n')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${streamObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  const cmapObject = fontObject + 3;
  objects.push(`<< /Type /Font /Subtype /Type0 /BaseFont /BabyReaderFixture /Encoding /Identity-H /DescendantFonts [${fontObject + 1} 0 R] /ToUnicode ${cmapObject} 0 R >>`);
  objects.push('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /BabyReaderFixture /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>');
  objects.push('<< /Length 0 >>');
  const sourceText = Array.isArray(pageColumns)
    ? pageColumns.flatMap((columns) => Array.isArray(columns) ? columns.map((column) => column.text) : []).join('')
    : Array.isArray(pageTexts) ? pageTexts.filter((value) => value != null).join('') : text;
  const codePoints = [...new Set(Array.from(String(sourceText)))];
  const mappings = codePoints.map((character) => {
    const code = character.codePointAt(0).toString(16).padStart(4, '0').slice(-4).toUpperCase();
    return `<${code}> <${code}>`;
  });
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${mappings.length} beginbfchar`,
    ...mappings,
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end'
  ].join('\n');
  objects.push(`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`);
  if (encrypted) {
    objects.push('<< /Filter /Standard /V 1 /R 2 /O (01234567890123456789012345678901) /U (01234567890123456789012345678901) /P -4 >>');
  }
  let pdf = '%PDF-1.7\n% BabyReader test fixture\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypted ? ` /Encrypt ${objects.length} 0 R` : ''} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function createInvalidPdfFixture(prefixBytes = 4096) {
	return Buffer.concat([
		Buffer.alloc(prefixBytes, 0x20),
		Buffer.from('%PDF-1.7\n%%EOF\n', 'ascii')
	]);
}

function createCorruptPdfFixture() {
	return Buffer.from('%PDF-1.7\nnot a valid PDF object graph\n%%EOF\n', 'ascii');
}

function createImageOnlyPdfFixture() {
  const stream = 'q 100 0 0 100 72 600 cm /Im1 Do Q';
  const pixels = 'FF0000>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`
  ];
  let pdf = '%PDF-1.7\n% BabyReader image-only fixture\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

module.exports = { createCorruptPdfFixture, createImageOnlyPdfFixture, createInvalidPdfFixture, createPdfFixture };
