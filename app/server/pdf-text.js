'use strict';

const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { PDF_TEXT_LIMITS } = require('./pdf-text-limits');

const PDF_TEXT_PARSER_VERSION = 'pdfjs-6.3.289-page-text-v1';

function extractionError(code, message) {
  return Object.assign(new Error(message), { code });
}

function effectiveLimits(overrides = {}) {
  const limits = { ...PDF_TEXT_LIMITS };
  for (const key of Object.keys(limits)) {
    if (Number.isSafeInteger(overrides[key]) && overrides[key] > 0) {
      limits[key] = Math.min(limits[key], overrides[key]);
    }
  }
  return limits;
}

async function readAuthorizedPdfBytes(bookPath, maxSourceBytes) {
  let before;
  try {
    before = await fs.lstat(bookPath);
  } catch {
    throw extractionError('PDF_INVALID', 'PDF source is unavailable');
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size < 8) {
    throw extractionError('PDF_INVALID', 'PDF source is not a regular file');
  }
  if (before.size > maxSourceBytes) {
    throw extractionError('PDF_EXTRACTION_BUDGET', 'PDF source exceeds the extraction limit');
  }

  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    handle = await fs.open(bookPath, flags);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw extractionError('PDF_INVALID', 'PDF source changed during validation');
    }
    if (opened.size > maxSourceBytes) {
      throw extractionError('PDF_EXTRACTION_BUDGET', 'PDF source exceeds the extraction limit');
    }
    const buffer = Buffer.allocUnsafeSlow(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) throw extractionError('PDF_INVALID', 'PDF source changed while being read');
      offset += bytesRead;
    }
    if (!buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-', 'ascii'))) {
      throw extractionError('PDF_INVALID', 'PDF signature is missing');
    }
    return buffer;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function runPdfExtraction(book, mode, { signal, limits: overrides } = {}) {
  if (book?.type !== 'pdf' || typeof book.path !== 'string') {
    throw extractionError('PDF_INVALID', 'PDF book is invalid');
  }
  const limits = effectiveLimits(overrides);
  if (signal?.aborted) throw extractionError('PDF_EXTRACTION_ABORTED', 'PDF extraction was cancelled');
  const bytes = await readAuthorizedPdfBytes(book.path, limits.maxSourceBytes);
  if (signal?.aborted) throw extractionError('PDF_EXTRACTION_ABORTED', 'PDF extraction was cancelled');

  return new Promise((resolve, reject) => {
    const transferredBytes = bytes.buffer;
    let settled = false;
    let timer = null;
    let worker;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker?.terminate().catch(() => {});
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(extractionError('PDF_EXTRACTION_ABORTED', 'PDF extraction was cancelled'));
    try {
      worker = new Worker(path.join(__dirname, 'pdf-text-worker.js'), {
        workerData: {
          pdfBytes: transferredBytes,
          limits,
          parserVersion: PDF_TEXT_PARSER_VERSION,
          mode
        },
        transferList: [transferredBytes],
        resourceLimits: {
          maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
          maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
          stackSizeMb: limits.maxStackSizeMb
        }
      });
    } catch {
      finish(extractionError('PDF_PARSE_FAILED', 'PDF parser could not be started'));
      return;
    }
    timer = setTimeout(() => finish(
      extractionError('PDF_EXTRACTION_BUDGET', 'PDF extraction exceeded its time limit')
    ), limits.maxDurationMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message) => {
      if (!message || message.ok !== true) {
        const code = ['PDF_INVALID', 'PDF_PASSWORD_REQUIRED', 'PDF_EXTRACTION_BUDGET'].includes(message?.code)
          ? message.code
          : 'PDF_PARSE_FAILED';
        finish(extractionError(code, message?.message || 'PDF text extraction failed'));
        return;
      }
      finish(null, {
        status: message.status,
        parserVersion: PDF_TEXT_PARSER_VERSION,
        ...(mode === 'structure'
          ? {
              pageCount: Number.isSafeInteger(message.pageCount) ? message.pageCount : 0,
              outline: Array.isArray(message.outline) ? message.outline : [],
              headings: Array.isArray(message.headings) ? message.headings : [],
              textAvailable: message.textAvailable === true
            }
          : {
              pages: Array.isArray(message.pages) ? message.pages : [],
              extractedCharacters: Number.isSafeInteger(message.extractedCharacters) ? message.extractedCharacters : 0
            })
      });
    });
    worker.once('error', () => finish(extractionError('PDF_PARSE_FAILED', 'PDF parser failed')));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(extractionError('PDF_PARSE_FAILED', 'PDF parser stopped unexpectedly'));
    });
  });
}

async function extractPdfText(book, options) {
  return runPdfExtraction(book, 'text', options);
}

async function extractPdfStructureSignals(book, options) {
  return runPdfExtraction(book, 'structure', options);
}

module.exports = {
  PDF_TEXT_LIMITS,
  PDF_TEXT_PARSER_VERSION,
  extractPdfText,
  extractPdfStructureSignals
};
