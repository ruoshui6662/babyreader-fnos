'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCorruptPdfFixture, createPdfFixture } = require('./fixtures/pdf-fixtures');

async function fixtureFile(t, name, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhenshu-pdf-text-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, bytes);
  return { id: 'a'.repeat(64), path: filePath, type: 'pdf', title: name };
}

test('extractPdfText parses Chinese pages sequentially with stable zero-based indexes', async (t) => {
  const { extractPdfText, PDF_TEXT_PARSER_VERSION } = require('../app/server/pdf-text');
  const book = await fixtureFile(t, 'multi.pdf', createPdfFixture({
    pageTexts: ['第一页的中文内容。', '第二页含有目标词。']
  }));

  const result = await extractPdfText(book);

  assert.equal(result.status, 'ready');
  assert.equal(result.parserVersion, PDF_TEXT_PARSER_VERSION);
  assert.deepEqual(result.pages.map(({ pageIndex, text }) => [pageIndex, text]), [
    [0, '第一页的中文内容。'],
    [1, '第二页含有目标词。']
  ]);
});

test('structure extraction leaves the existing PDF text contract unchanged and omits page bodies', async (t) => {
  const { extractPdfText, extractPdfStructureSignals, PDF_TEXT_PARSER_VERSION } = require('../app/server/pdf-text');
  const book = await fixtureFile(t, 'structure-contract.pdf', createPdfFixture({
    pageTexts: ['摘要 本文研究一个合成问题。', '研究方法使用合成样本。']
  }));

  const [textResult, structure] = await Promise.all([
    extractPdfText(book), extractPdfStructureSignals(book)
  ]);

  assert.deepEqual(textResult, {
    status: 'ready',
    parserVersion: PDF_TEXT_PARSER_VERSION,
    pages: [
      { pageIndex: 0, text: '摘要 本文研究一个合成问题。' },
      { pageIndex: 1, text: '研究方法使用合成样本。' }
    ],
    extractedCharacters: '摘要 本文研究一个合成问题。'.length + '研究方法使用合成样本。'.length
  });
  assert.equal(structure.pageCount, 2);
  assert.equal('pages' in structure, false);
  assert.equal(JSON.stringify(structure).includes('本文研究一个合成问题'), false);
});

test('extractPdfText distinguishes image-only documents from successful text extraction', async (t) => {
  const { extractPdfText } = require('../app/server/pdf-text');
  const book = await fixtureFile(t, 'image-only.pdf', createPdfFixture({ pageTexts: [null, ''] }));

  const result = await extractPdfText(book);

  assert.equal(result.status, 'no-text');
  assert.deepEqual(result.pages, []);
});

test('extractPdfText fails closed for malformed and password-protected PDF files', async (t) => {
  const { extractPdfText } = require('../app/server/pdf-text');
  const malformed = await fixtureFile(t, 'malformed.pdf', createCorruptPdfFixture());
  const encrypted = await fixtureFile(t, 'encrypted.pdf', createPdfFixture({ text: 'secret', encrypted: true }));

  await assert.rejects(extractPdfText(malformed), (error) => error.code === 'PDF_INVALID');
  await assert.rejects(extractPdfText(encrypted), (error) => error.code === 'PDF_PASSWORD_REQUIRED');
});

test('extractPdfText enforces source and extracted-text budgets before returning indexable pages', async (t) => {
  const { extractPdfText } = require('../app/server/pdf-text');
  const book = await fixtureFile(t, 'over-budget.pdf', createPdfFixture({ pageTexts: ['预算测试文本', '第二页内容'] }));

  await assert.rejects(
    extractPdfText(book, { limits: { maxSourceBytes: 16 } }),
    (error) => error.code === 'PDF_EXTRACTION_BUDGET'
  );
  await assert.rejects(
    extractPdfText(book, { limits: { maxPageCharacters: 4 } }),
    (error) => error.code === 'PDF_EXTRACTION_BUDGET'
  );
  await assert.rejects(
    extractPdfText(book, { limits: { maxBookCharacters: 4 } }),
    (error) => error.code === 'PDF_EXTRACTION_BUDGET'
  );
  await assert.rejects(
    extractPdfText(book, { limits: { maxPages: 1 } }),
    (error) => error.code === 'PDF_EXTRACTION_BUDGET'
  );
  await assert.rejects(
    extractPdfText(book, { limits: { maxDurationMs: 1 } }),
    (error) => error.code === 'PDF_EXTRACTION_BUDGET'
  );
});

test('extractPdfText cancels parser work when the caller aborts', async (t) => {
  const { extractPdfText } = require('../app/server/pdf-text');
  const book = await fixtureFile(t, 'cancelled.pdf', createPdfFixture({
    pageTexts: Array.from({ length: 500 }, (_, index) => `第${index + 1}页：可取消解析测试文本。`)
  }));
  const controller = new AbortController();
  const extraction = extractPdfText(book, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);

  await assert.rejects(extraction, (error) => error.code === 'PDF_EXTRACTION_ABORTED');
});

test('extractPdfText uses explicit conservative parser resource ceilings', () => {
  const { PDF_TEXT_LIMITS } = require('../app/server/pdf-text');
  assert.ok(PDF_TEXT_LIMITS.maxSourceBytes > 0 && PDF_TEXT_LIMITS.maxSourceBytes <= 64 * 1024 * 1024);
  assert.ok(PDF_TEXT_LIMITS.maxPages > 0 && PDF_TEXT_LIMITS.maxPages <= 10000);
  assert.ok(PDF_TEXT_LIMITS.maxPageCharacters > 0);
  assert.ok(PDF_TEXT_LIMITS.maxBookCharacters > 0);
  assert.ok(PDF_TEXT_LIMITS.maxDurationMs > 0 && PDF_TEXT_LIMITS.maxDurationMs <= 30000);
  assert.ok(PDF_TEXT_LIMITS.maxIndexDurationMs > 0 && PDF_TEXT_LIMITS.maxIndexDurationMs <= 30000);
  assert.ok(PDF_TEXT_LIMITS.maxIndexRows > 0);
  assert.ok(PDF_TEXT_LIMITS.maxOldGenerationSizeMb > 0 && PDF_TEXT_LIMITS.maxOldGenerationSizeMb <= 192);
});
