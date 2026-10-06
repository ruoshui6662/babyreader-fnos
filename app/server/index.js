'use strict';

const fs = require('node:fs/promises');
const nodeFs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { UserStorage, readJson } = require('./storage');
const { fingerprintBook, indexBookFile, scanLibrary } = require('./library');
const { resolveAuthorizedPath, isPathInside } = require('./security');
const { parseSingleByteRange } = require('./byte-range');
const { getPdfReaderEnabled } = require('./pdf-feature-config');
const { getMobiReaderEnabled } = require('./mobi-feature-config');
const { createMobiDerivedStore } = require('./mobi-derived');
const { getBookImportEnabled } = require('./import-feature-config');
const { createBookImporter, hashFile, ImportError, IMPORT_DIRECTORY_NAME } = require('./book-import');
const { AiConfigStorage, embeddingSettings, normalizeAiSettings, publicAiConfig } = require('./ai-config');
const { validateAiBookContext } = require('./ai-book-context');
const {
  AI_FTS_SCHEMA_VERSION,
  resolveBookPosition,
  readChapterEvidence,
  readBookNavigation,
  readAllPassages,
  ensurePdfNodes,
  listCachedChapterSummaries,
  getOrCreateChapterSummary,
  getOrCreateChapterSummarySegment,
  searchBook: searchAiBook,
  searchPdfEvidenceRows,
  searchPdfEvidenceRowsByRanges
} = require('./ai-fts');
const { validatePdfAiRequest, buildPdfAiContext, pdfAiSources, pdfAiStructuredRetrievalEnabled } = require('./pdf-ai-context');
const { PDF_AI_STRUCTURE_VERSION, buildPdfStructure } = require('./pdf-ai-structure');
const { PDF_AI_PROFILE_PROMPT_VERSION, planPdfProfile } = require('./pdf-ai-profile');
const { PDF_TEXT_PARSER_VERSION, extractPdfText, extractPdfStructureSignals } = require('./pdf-text');
const { classifyPdfQuestion, planPdfRetrieval, composePdfEvidence } = require('./pdf-ai-retrieval');
const { assessSummaryConfidence, classifyAiIntent, planChapterSummary, selectBookSummaryCandidates } = require('./ai-chapter-retrieval');
const { createAiIndexManager } = require('./ai-index-manager');
const { createAiConversationStorage } = require('./ai-conversation-storage');
const { createPdfAiProfileStore } = require('./pdf-ai-profile-store');
const { parseBookSearchParams, searchBookText } = require('./book-search');
const { parsePathList, resolveLibraryRoots } = require('./library-roots');
const { decodeBookText } = require('./text-encoding');
const { buildReadingStats } = require('./reading-stats-summary');
const { buildBookNotes, buildNotesSummary, searchNotes } = require('./notes');
const { epubTocForBook } = require('./epub-toc');
const { createPlatform } = require('./platform');
const { createDirectAccess } = require('./direct-access');
const { buildAnswerPayload, gatherEvidence, planQuestion, MAP_ROOT_ID, TYPE_LABELS } = require('./ai-answer-pipeline');
const { createBookMapStore } = require('./ai-book-map-store');
const { createBookMapService } = require('./ai-book-map');
const { createEmbeddingService } = require('./ai-embeddings');
const { addUsage } = require('./ai-transport');
const {
  BOOK_ID_PATTERN,
  COLLECTION_ID_PATTERN,
  normalizeBookTitle,
  normalizeLibraryOrganization,
  reconcileLibraryOrganization,
  resolveLibraryOrganization
} = require('./library-organization');
const {
  normalizeAiConfig,
  normalizeAiHistory,
  sanitizeAiAnswerCitations,
  validateAiRequest,
  requestOpenAiAnswer,
  requestOpenAiChapterSummary,
  requestOpenAiPdfProfile,
  requestOpenAiStream,
  testOpenAiConnection
} = require('./ai-service');

const APP_PREFIX = '/app/zhenshu';
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
// The host (fnOS by default): folders, who is signed in, which book folders
// may be read. See platform/index.js.
const platform = createPlatform({ appRoot: APP_ROOT });
const DATA_ROOT = platform.paths.data;
const CONFIG_ROOT = platform.paths.config;
const SOCKET_PATH = platform.paths.socket;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
// Provisional per-response ceiling; Task 0 device benchmarks may lower it.
const MAX_PDF_RANGE_BYTES = 8 * 1024 * 1024;
const PDF_AI_UNVERIFIED_ANSWER = '依据不足：回答未能提供可验证的 PDF 页引用，请缩小页码范围或换一种问法重试。';
const LIBRARY_ORGANIZATION_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ZHENSHU_ENABLE_LIBRARY_ORGANIZATION || '').trim().toLowerCase()
);
function pdfReaderEnabled() {
  return getPdfReaderEnabled(CONFIG_ROOT, process.env.ZHENSHU_PDF_ENABLED);
}
function mobiReaderEnabled() {
  return getMobiReaderEnabled(CONFIG_ROOT, process.env.ZHENSHU_MOBI_ENABLED);
}

// Format switches hide whole book types from every catalog response.
function readerFormatSwitches() {
  return { pdf: pdfReaderEnabled(), mobi: mobiReaderEnabled() };
}

// A book shows only while its file sits inside a folder the app may read
// now: an index from before fnOS took a folder away still lists its books
// until the next scan, and those must not appear (opening them is refused).
function inAuthorizedRoots(book) {
  return typeof book?.path === 'string' && authorizedRoots.some((root) => isPathInside(root, book.path));
}

function isBookVisible(book, switches = readerFormatSwitches()) {
  if (!inAuthorizedRoots(book)) return false;
  if (book?.type === 'pdf') return switches.pdf;
  if (book?.type === 'mobi') return switches.mobi;
  return true;
}

// The library as one user sees it. Admins also get where the books are read
// from: each library folder with its book count and anything it could not
// read, and folders fnOS named that cannot be opened at all. Other users see
// no paths.
function libraryResponse(index, user, switches, bookTitles) {
  const { roots = [], ...scan } = index.scan || {};
  return {
    ...index,
    scan,
    features: libraryFeatures(index, switches, { canImport: user.isAdmin }),
    configured: authorizedRoots.length > 0,
    authorizedRootCount: authorizedRoots.length,
    scanState: currentScanState(),
    ...(user.isAdmin ? {
      folders: {
        // Only folders still authorized, each with where it came from
        // (fnOS authorization, the app's shared folder, or app settings).
        scanned: roots
          .filter((folder) => authorizedRoots.includes(folder.root))
          .map((folder) => ({ ...folder, source: rootDiagnostics.rootSources?.[folder.root] || null })),
        unavailable: rootDiagnostics.rejectedRoots.map(({ root, code, error }) => ({ root, code, error }))
      }
    } : {}),
    books: index.books.filter((book) => isBookVisible(book, switches))
      .map((book) => publicBook(book, bookTitles))
  };
}

// What 阅读统计 and 笔记 read for one user: reading time, reading state, and
// the books as this user sees them (renamed titles, covers, visible formats).
async function readerDataFor(user) {
  const [{ days }, readingState, index, bookTitles] = await Promise.all([
    storage.getReadingTime(user.uid, '2000-01-01', '9999-12-31'),
    storage.getState(user.uid),
    storage.getLibraryIndex(),
    userBookTitles(user.uid)
  ]);
  const switches = readerFormatSwitches();
  const books = new Map(index.books
    .filter((book) => book?.id && !book.error && isBookVisible(book, switches))
    .map((book) => [book.id, publicBook(book, bookTitles)]));
  return { days, readingState, bookInfo: (bookId) => books.get(bookId) || null };
}

function libraryFeatures(index, switches = readerFormatSwitches(), { canImport = false } = {}) {
  const books = Array.isArray(index?.books) ? index.books : [];
  const indexedMobi = books.filter((book) => book.type === 'mobi' && !book.error).length;
  return {
    libraryOrganization: LIBRARY_ORGANIZATION_ENABLED,
    pdfReader: switches.pdf,
    hiddenPdfCount: switches.pdf ? 0 : books.filter((book) => book.type === 'pdf' && !book.error).length,
    mobiReader: switches.mobi,
    // Unparsed Kindle files from a switched-off scan plus any still indexed.
    hiddenMobiCount: switches.mobi ? 0 : indexedMobi + Number(index?.scan?.hiddenMobiCount || 0),
    drmProtectedMobiCount: switches.mobi ? Number(index?.scan?.drmProtectedCount || 0) : 0,
    bookImport: canImport && bookImportEnabled()
  };
}
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:";

const storage = new UserStorage(DATA_ROOT);
const aiConfigStorage = new AiConfigStorage(DATA_ROOT);
const pdfAiProfileStore = createPdfAiProfileStore({ dataRoot: DATA_ROOT });
const mobiDerived = createMobiDerivedStore({ dataRoot: DATA_ROOT });
const aiIndexManager = createAiIndexManager({
  dataRoot: DATA_ROOT,
  schemaVersion: AI_FTS_SCHEMA_VERSION,
  getLibraryIndex: () => storage.getLibraryIndex(),
  onIndexDeleted: async (bookId) => {
    try { await pdfAiProfileStore.deleteBook(bookId); } catch (error) {
      recordError(error, { operation: 'pdf-ai-cache-delete', bookId });
    }
  }
});
const aiConversationStorage = createAiConversationStorage({ dataRoot: DATA_ROOT });
const STARTED_AT = new Date().toISOString();
let authorizedRoots = [];
let authorizationRevision = null;
let rootDiagnostics = {
  configuredRoots: [],
  accessibleRoots: [],
  sharedRoots: [],
  authorizedRoots: [],
  rejectedRoots: []
};
let activeScan = null;
let scanState = {
  status: 'idle',
  startedAt: null,
  completedAt: null,
  error: null,
  result: null
};
const errorLog = [];
const MAX_ERROR_LOG_ENTRIES = 100;

function recordError(error, context = {}) {
  const entry = {
    at: new Date().toISOString(),
    message: String(error?.message || error || 'Unknown error'),
    code: error?.code ? String(error.code) : null,
    context
  };
  errorLog.push(entry);
  if (errorLog.length > MAX_ERROR_LOG_ENTRIES) errorLog.shift();
  return entry;
}

function currentScanState() {
  return {
    ...scanState,
    active: Boolean(activeScan)
  };
}

function isHealthyLibraryIndex(index) {
  return index?.scan?.status === 'completed'
    && Number(index.scan.errorCount || 0) === 0
    && (!Array.isArray(index.scan.rootErrors) || index.scan.rootErrors.length === 0);
}

// ----- Library lock and browser book import (MOBI/import plan Task 4) -----

// Scans and import catalog merges both rewrite library.json; this chain runs
// them one at a time so neither can overwrite the other's result.
let libraryLock = Promise.resolve();
function withLibraryLock(fn) {
  const run = libraryLock.then(fn, fn);
  libraryLock = run.catch(() => {});
  return run;
}

function bookImportEnabled() {
  return getBookImportEnabled(CONFIG_ROOT, process.env.ZHENSHU_IMPORT_ENABLED);
}

function authorizedRootFor(realPath) {
  return authorizedRoots
    .filter((root) => root === realPath || isPathInside(root, realPath))
    .sort((left, right) => right.length - left.length)[0] || null;
}

// Imports go to <zhenshu/library share>/导入, never to a user's own
// authorized folders. The share is itself an authorized library root.
async function resolveImportDirectory() {
  await refreshAuthorizationIfChanged();
  const shares = [];
  for (const candidate of rootDiagnostics.sharedRoots || []) {
    try {
      shares.push(await fs.realpath(candidate));
    } catch {
      // Missing shares are reported by root diagnostics.
    }
  }
  const share = shares.find((root) => /zhenshu[\\/]library$/i.test(root)) || shares[0];
  if (!share || !authorizedRootFor(share)) {
    throw Object.assign(new Error('Import share unavailable'), { code: 'IMPORT_NO_TARGET' });
  }
  const directory = path.join(share, IMPORT_DIRECTORY_NAME);
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  const stat = await fs.lstat(directory);
  const real = await fs.realpath(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isPathInside(share, real)) {
    throw Object.assign(new Error('Import directory is not a plain directory inside the share'), { code: 'IMPORT_NO_TARGET' });
  }
  return real;
}

async function findDuplicateBook(size, sha256) {
  const index = await storage.getLibraryIndex();
  for (const book of index.books) {
    if (book.error || book.size !== size) continue;
    try {
      const safePath = await resolveAuthorizedPath(book.path, authorizedRoots);
      if (await hashFile(safePath) === sha256) return book.id;
    } catch {
      // Unreadable candidates cannot be duplicates we could show anyway.
    }
  }
  return null;
}

async function catalogImportedBook({ path: filePath }) {
  const realRoot = authorizedRootFor(await fs.realpath(filePath));
  if (!realRoot) throw new Error('Imported file is outside the authorized roots');
  const outcome = await indexBookFile({
    filePath,
    realRoot,
    validRoots: authorizedRoots,
    coverDirectory: path.join(DATA_ROOT, 'covers')
  });
  if (outcome.kind !== 'indexed' && outcome.kind !== 'reused') {
    throw new Error(outcome.book?.error || 'Imported file could not be indexed');
  }
  const index = await storage.getLibraryIndex();
  const books = index.books.filter((book) => book.id !== outcome.book.id);
  books.push(outcome.book);
  books.sort((left, right) => String(left.title || left.relativePath).localeCompare(String(right.title || right.relativePath), 'zh-CN'));
  await storage.saveLibraryIndex({ ...index, books });
  return outcome.book;
}

const bookImporter = createBookImporter({
  resolveTarget: resolveImportDirectory,
  isFormatEnabled: (type) => (type === 'pdf' ? pdfReaderEnabled() : type === 'mobi' ? mobiReaderEnabled() : true),
  findDuplicate: findDuplicateBook,
  runExclusive: withLibraryLock,
  afterPublish: catalogImportedBook
});

// Rejections may happen before the body is read; close the connection instead
// of draining a large upload nobody will use.
function sendImportError(request, response, error) {
  const statusCode = error.statusCode || 500;
  const body = error instanceof ImportError
    ? { error: error.message, code: error.code, ...error.details }
    : { error: '导入失败，请稍后重试。', code: 'IMPORT_FAILED' };
  if (!(error instanceof ImportError)) recordError(error, { operation: 'book-import' });
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    Connection: 'close'
  });
  response.end(payload);
  if (!request.readableEnded) request.resume();
}

async function handleBookImport(request, response, user) {
  if (!bookImportEnabled()) return sendImportError(request, response, new ImportError('IMPORT_DISABLED', 404, '书籍导入未启用。'));
  if (!user.isAdmin) return sendImportError(request, response, new ImportError('IMPORT_FORBIDDEN', 403, '只有管理员可以导入书籍。'));
  // A custom header forces a CORS preflight, which this server never grants,
  // so cross-site pages cannot submit uploads with the user's session.
  const fetchSite = request.headers['sec-fetch-site'];
  if (request.headers['x-zhenshu-request'] !== 'import' || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
    return sendImportError(request, response, new ImportError('IMPORT_BAD_REQUEST', 403, '导入请求来源无效。'));
  }
  try {
    const result = await bookImporter.importStream(request, {
      userId: user.uid,
      encodedName: request.headers['x-zhenshu-filename'],
      contentLength: request.headers['content-length']
    });
    return sendJson(response, 201, { book: publicBook(result.book), name: result.name });
  } catch (error) {
    return sendImportError(request, response, error);
  }
}

async function runLibraryScan() {
  if (activeScan) return activeScan;

  const startedAt = new Date().toISOString();
  scanState = {
    status: 'running',
    startedAt,
    completedAt: null,
    error: null,
    result: null,
    progress: null
  };

  activeScan = withLibraryLock(async () => {
    try {
      await loadConfiguration();
      const previousIndex = await storage.getLibraryIndex();
      const index = await scanLibrary(authorizedRoots, {
        coverDirectory: path.join(DATA_ROOT, 'covers'),
        previousIndex,
        mobiEnabled: mobiReaderEnabled(),
        // Read by GET /library/scan/status while the scan runs.
        onProgress: (progress) => {
          if (scanState.startedAt === startedAt) scanState = { ...scanState, progress };
        }
      });
      await storage.saveLibraryIndex(index);
      if (isHealthyLibraryIndex(index) && rootDiagnostics.rejectedRoots.length === 0) {
        try {
          const cleanup = await aiIndexManager.cleanup({
            kind: 'orphans',
            libraryIndex: index.books,
            scanHealthy: true,
            confirm: true
          });
          index.scan = {
            ...index.scan,
            indexCleanup: {
              attempted: true,
              deletedCount: cleanup.deleted.length,
              skippedCount: cleanup.skipped.length,
              manifestRemovedCount: cleanup.manifestRemoved.length,
              bytesFreed: cleanup.bytesFreed
            }
          };
          await storage.saveLibraryIndex(index);
        } catch (cleanupError) {
          recordError(cleanupError, { operation: 'ai-index-orphan-cleanup' });
        }
        try {
          await mobiDerived.prune(index.books);
        } catch (pruneError) {
          recordError(pruneError, { operation: 'mobi-derived-prune' });
        }
      }
      scanState = {
        status: index.scan?.status || 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: null,
        result: index.scan || null
      };
      return index;
    } catch (error) {
      const logged = recordError(error, { operation: 'library-scan' });
      scanState = {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: logged.message,
        result: null
      };
      throw error;
    } finally {
      activeScan = null;
    }
  });

  return activeScan;
}

function sendJson(response, status, value) {
  const payload = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(payload);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: String(message || 'Request failed') });
}

function aiUserError(error) {
  const messages = {
    AI_NOT_CONFIGURED: 'AI 服务尚未配置 API Key',
    AI_TIMEOUT: 'AI 请求超时，请稍后重试',
    AI_UPSTREAM_RESPONSE_TOO_LARGE: 'AI 服务返回内容过大，请稍后重试',
    AI_UPSTREAM_FAILED: 'AI 服务未能完成回答，请检查配置或稍后重试',
    AI_INCOMPLETE_RESPONSE: 'AI 回答传输中断，请重试',
    AI_FETCH_UNAVAILABLE: '当前运行环境不支持 AI 请求',
    AI_EMPTY_RESPONSE: 'AI 服务未返回可读内容'
  };
  if (error?.code === 'AI_BOOK_CONTEXT_INVALID') return error.message;
  if (messages[error?.code]) return messages[error.code];
  return error?.statusCode === 400 ? String(error.message || 'AI 请求参数无效') : 'AI 服务暂时不可用，请稍后重试';
}

function aiConversationError(response, error) {
  const statusByCode = {
    INVALID_BOOK_ID: 400,
    INVALID_CONVERSATION_ID: 400,
    INVALID_CONVERSATION_TITLE: 400,
    INVALID_CONVERSATION_SOURCE: 400,
    INVALID_CONVERSATION_MESSAGE: 400,
    CONVERSATION_NOT_FOUND: 404,
    CONVERSATION_LIMIT: 409,
    CONVERSATION_MESSAGE_LIMIT: 409,
    CONVERSATION_SIZE_LIMIT: 413,
    CONVERSATION_STORE_CORRUPT: 503,
    CONVERSATION_STORE_UNAVAILABLE: 503,
    CONVERSATION_UNSAFE_TARGET: 503
  };
  const messageByCode = {
    INVALID_BOOK_ID: '请求参数无效',
    INVALID_CONVERSATION_ID: '请求参数无效',
    INVALID_CONVERSATION_TITLE: '会话标题无效',
    INVALID_CONVERSATION_SOURCE: '会话来源无效',
    INVALID_CONVERSATION_MESSAGE: '会话消息无效',
    CONVERSATION_NOT_FOUND: '会话不存在',
    CONVERSATION_LIMIT: '会话数量已达到上限',
    CONVERSATION_MESSAGE_LIMIT: '会话消息数量已达到上限',
    CONVERSATION_SIZE_LIMIT: '会话数据已达到大小上限',
    CONVERSATION_STORE_CORRUPT: '会话暂时无法读取',
    CONVERSATION_STORE_UNAVAILABLE: '会话暂时无法读取',
    CONVERSATION_UNSAFE_TARGET: '会话暂时无法读取'
  };
  const status = statusByCode[error?.code] || error?.statusCode || 500;
  const message = messageByCode[error?.code] || (status >= 500 ? '会话服务暂时不可用' : '请求无效');
  return sendError(response, status, message);
}

function aiConversationPersistenceErrorCode(error) {
  const allowed = new Set([
    'INVALID_CONVERSATION_ID',
    'INVALID_CONVERSATION_MESSAGE',
    'INVALID_CONVERSATION_SOURCE',
    'CONVERSATION_NOT_FOUND',
    'CONVERSATION_MESSAGE_LIMIT',
    'CONVERSATION_SIZE_LIMIT',
    'CONVERSATION_STORE_CORRUPT',
    'CONVERSATION_STORE_UNAVAILABLE',
    'CONVERSATION_UNSAFE_TARGET'
  ]);
  return allowed.has(error?.code) ? error.code : 'CONVERSATION_PERSIST_FAILED';
}

function aiPersistenceSources(context) {
  return aiSourcesFromContext(context).map((source) => ({
    citationIndex: source.citationIndex,
    chapterIndex: source.chapterIndex,
    chapterHref: source.chapterHref || '',
    chapterLabel: source.chapterLabel || '',
    ...(Number.isSafeInteger(source.startOffset) && source.startOffset >= 0 ? { startOffset: source.startOffset } : {})
  }));
}

function sendSseHeaders(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
}

function sendSseEvent(response, event, payload) {
  if (response.writableEnded || response.destroyed) return false;
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  return true;
}

function aiSourcesFromContext(context) {
  const sources = [];
  for (const [index, item] of context.entries()) {
    const key = `${item.chapterIndex ?? ''}|${item.chapterHref || ''}`;
    const existing = sources.find((source) => source.key === key);
    if (existing) {
      existing.citationIndexes.push(index + 1);
      continue;
    }
    sources.push({
      key,
      citationIndex: index + 1,
      citationIndexes: [index + 1],
      chapterIndex: item.chapterIndex,
      chapterHref: item.chapterHref,
      chapterLabel: item.chapterLabel,
      ...(Number.isSafeInteger(item.startOffset) && item.startOffset >= 0 ? { startOffset: item.startOffset } : {})
    });
  }
  return sources.map(({ key, ...source }) => source);
}

function pdfConversationWithSourceValidity(conversation, fingerprint) {
  return {
    ...conversation,
    messages: conversation.messages.map((message) => message.role !== 'assistant' ? message : ({
      ...message,
      sources: (message.sources || []).map(({ sourceFingerprint, ...source }) => ({
        ...source,
        stale: !fingerprint || !sourceFingerprint || sourceFingerprint !== fingerprint
      }))
    }))
  };
}

async function preparePdfAiEvidence(bookId, body, { signal } = {}) {
  const input = validatePdfAiRequest(body);
  if (!pdfReaderEnabled()) return { error: { status: 404, message: 'PDF 阅读尚未启用' } };
  const book = await findBook(bookId, { requirePathIdentity: true });
  const fingerprint = await currentPdfFingerprint(book);
  if (!fingerprint || fingerprint !== book.fingerprint) {
    return { error: { status: 409, message: 'PDF 文件已变化，请重新扫描书库后再提问。' } };
  }
  const scoped = input.scope !== 'searchable_book';
  const result = await searchPdfEvidenceRows(book, DATA_ROOT, {
    query: input.question,
    selectedText: input.selectedText,
    pageStart: scoped ? input.pageIndex : null,
    pageEnd: scoped ? input.pageEndIndex : null,
    signal
  });
  // Extraction/index creation can take seconds. Refuse the evidence if the
  // source changed while that work was in flight; never send stale page text.
  if (await currentPdfFingerprint(book) !== book.fingerprint) {
    return { error: { status: 409, message: 'PDF 文件已变化，请重新扫描书库后再提问。' } };
  }
  const unavailable = {
    'no-text': [409, '这份 PDF 没有可提取文本，暂不能用于 AI 问书。'],
    'password-protected': [409, '加密 PDF 暂不能用于 AI 问书。'],
    'extraction-limit': [413, 'PDF 超出安全文本提取上限，请缩小文件或使用其他书籍。'],
    'selection-not-found': [409, '选中文本未能在当前页索引中核验，请重新选择后提问。'],
    unavailable: [409, 'PDF 文本索引暂不可用，请刷新书库后重试。']
  };
  if (result.status !== 'ready') {
    const [status, message] = unavailable[result.status] || unavailable.unavailable;
    return { error: { status, message } };
  }
  const context = buildPdfAiContext(result.rows, { query: input.selectedText || input.question });
  if (!context.length) return { error: { status: 409, message: '当前范围没有足够的可检索原文依据，请换一种问法或页码范围。' } };
  return { input, context, sources: pdfAiSources(context), book };
}

async function prepareStructuredPdfAiEvidence(user, bookId, body, { signal } = {}) {
  if (!pdfAiStructuredRetrievalEnabled(process.env)) return preparePdfAiEvidence(bookId, body, { signal });
  const input = validatePdfAiRequest(body);
  const intent = classifyPdfQuestion(input.question, { hasSelection: Boolean(input.selectedText) });
  if (input.scope !== 'searchable_book' || !['paper_overview', 'method', 'findings', 'limitations', 'comparison'].includes(intent)) {
    return preparePdfAiEvidence(bookId, body, { signal });
  }
  const fallback = async () => {
    const prepared = await preparePdfAiEvidence(bookId, body, { signal });
    return { ...prepared, profileStatus: 'fallback', retrievalMode: 'fts_fallback', structureCoverage: null };
  };
  try {
    if (signal?.aborted) return { error: { status: 499, message: 'PDF 问答已取消' } };
    if (!pdfReaderEnabled()) return { error: { status: 404, message: 'PDF 阅读尚未启用' } };
    const book = await findBook(bookId, { requirePathIdentity: true });
    const fingerprint = await currentPdfFingerprint(book);
    if (!fingerprint || fingerprint !== book.fingerprint) return fallback();

    let structure = await pdfAiProfileStore.getStructure({ bookId, sourceFingerprint: fingerprint,
      parserVersion: PDF_TEXT_PARSER_VERSION, structureVersion: PDF_AI_STRUCTURE_VERSION });
    if (!structure) {
      const signals = await extractPdfStructureSignals(book, { signal });
      if (await currentPdfFingerprint(book) !== fingerprint) return fallback();
      structure = buildPdfStructure(signals);
      await pdfAiProfileStore.putStructure({ bookId, sourceFingerprint: fingerprint,
        parserVersion: PDF_TEXT_PARSER_VERSION, structureVersion: PDF_AI_STRUCTURE_VERSION, structure });
    }
    if (structure.mode === 'unavailable' || structure.mode === 'page_windows') return fallback();

    const savedConfig = await aiConfigStorage.get(user.uid);
    const config = publicAiConfig(savedConfig, process.env);
    if (!config.configured) return fallback();
    const profileInput = {
      uid: user.uid,
      bookId,
      sourceFingerprint: fingerprint,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      parserVersion: PDF_TEXT_PARSER_VERSION,
      structureVersion: PDF_AI_STRUCTURE_VERSION,
      strategyVersion: 'pdf-profile-map-reduce-v1',
      promptVersion: PDF_AI_PROFILE_PROMPT_VERSION
    };
    const cachedProfile = await pdfAiProfileStore.getProfile(profileInput);
    let profile = cachedProfile;
    if (!profile) {
      const extracted = await extractPdfText(book, { signal });
      if (extracted.status !== 'ready' || await currentPdfFingerprint(book) !== fingerprint) return fallback();
      const pages = extracted.pages.map((page) => {
        const section = structure.sections.find((item) => page.pageIndex >= item.pageStart && page.pageIndex <= item.pageEnd);
        return { ...page, sectionTitle: section?.title || '' };
      });
      const plan = planPdfProfile({ structure, pages });
      if (!plan.mapTasks.length || plan.totalSourceChars > 24000) return fallback();
      const evidence = plan.mapTasks.flatMap((task) => task.pageIndexes.map((pageIndex) => {
        const page = pages.find((item) => item.pageIndex === pageIndex);
        return page ? { evidenceId: `page-${pageIndex + 1}`, pageIndex, text: page.text } : null;
      })).filter(Boolean);
      profile = await pdfAiProfileStore.getOrCreateProfile({
        ...profileInput,
        signal,
        validateBeforeWrite: async (sharedSignal) => !sharedSignal?.aborted
          && await currentPdfFingerprint(book) === fingerprint
          && Boolean(await findBook(bookId, { requirePathIdentity: true }).catch(() => null)),
        build: (sharedSignal) => requestOpenAiPdfProfile({ plan, evidence, env: process.env, savedConfig, signal: sharedSignal })
      });
    }
    if (signal?.aborted || await currentPdfFingerprint(book) !== fingerprint) return fallback();
    const plan = planPdfRetrieval({ intent, structure });
    const result = await searchPdfEvidenceRowsByRanges(book, DATA_ROOT, {
      query: input.question,
      ranges: plan.ranges,
      limit: 6,
      signal
    });
    if (result.status !== 'ready') return fallback();
    if (await currentPdfFingerprint(book) !== fingerprint) return fallback();
    const composed = composePdfEvidence({ rows: result.rows, structure, intent, question: input.question, profile });
    if (!composed.context.length) return fallback();
    return {
      input, context: composed.context, sources: composed.sources, book, profile,
      profileStatus: cachedProfile ? 'cached' : 'ready',
      retrievalMode: composed.retrievalMode,
      structureCoverage: composed.coverage
    };
  } catch (error) {
    if (signal?.aborted) return { error: { status: 499, message: 'PDF 问答已取消' } };
    recordError(error, { operation: 'pdf-ai-structured-retrieval', bookId, code: error.code || null });
    return fallback();
  }
}

async function handlePdfAiSearch(request, response, bookId, body) {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  const onClose = () => { if (!response.writableEnded) onAbort(); };
  request.once('aborted', onAbort);
  response.once('close', onClose);
  try {
    const prepared = await preparePdfAiEvidence(bookId, body, { signal: abortController.signal });
    if (abortController.signal.aborted || response.destroyed) return;
    if (prepared.error) return sendError(response, prepared.error.status, prepared.error.message);
    return sendJson(response, 200, {
      available: true, retrievalStatus: 'ok', scope: prepared.input.scope,
      sources: prepared.sources,
      matches: prepared.context.map((item, index) => ({
        evidenceId: index + 1, pageIndex: item.chapterIndex,
        text: item.text, chapterIndex: item.chapterIndex, chapterLabel: item.chapterLabel
      }))
    });
  } finally {
    request.removeListener('aborted', onAbort);
    response.removeListener('close', onClose);
  }
}

async function handlePdfAiAnswer(request, response, user, bookId, body) {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  const onClose = () => { if (!response.writableEnded) onAbort(); };
  request.once('aborted', onAbort);
  response.once('close', onClose);
  try {
    const prepared = await prepareStructuredPdfAiEvidence(user, bookId, body, { signal: abortController.signal });
    if (abortController.signal.aborted || response.destroyed) return;
    if (prepared.error) return sendError(response, prepared.error.status, prepared.error.message);
    const savedConfig = await aiConfigStorage.get(user.uid);
    if (!publicAiConfig(savedConfig, process.env).configured) return sendError(response, 503, 'AI 服务尚未配置');
    if (abortController.signal.aborted || response.destroyed) return;
    const result = await requestOpenAiAnswer({
      request: { pdfEvidence: true, question: prepared.input.question,
        history: prepared.input.history, context: prepared.context,
        ...(prepared.profile ? { paperContext: prepared.profile, answerProtocol: 'paper-profile' } : {}) },
      env: process.env, savedConfig, signal: abortController.signal
    });
    if (abortController.signal.aborted || response.destroyed) return;
    return sendJson(response, 200, {
      answer: result.citationIntegrity ? result.answer : PDF_AI_UNVERIFIED_ANSWER,
      sources: result.citationIntegrity ? prepared.sources : [],
      citationIntegrity: result.citationIntegrity === true,
      scope: prepared.input.scope
    });
  } catch (error) {
    if (!abortController.signal.aborted && !response.destroyed) {
      recordError(error, { operation: 'pdf-ai-answer', bookId, code: error.code || null });
      return sendError(response, error.statusCode || 502, aiUserError(error));
    }
  } finally {
    request.removeListener('aborted', onAbort);
    response.removeListener('close', onClose);
  }
}

async function handlePdfAiStream(request, response, user, bookId, body) {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  const onClose = () => { if (!response.writableEnded) onAbort(); };
  request.once('aborted', onAbort);
  response.once('close', onClose);
  try {
    const prepared = await prepareStructuredPdfAiEvidence(user, bookId, body, { signal: abortController.signal });
    if (abortController.signal.aborted || response.destroyed) return;
    if (prepared.error) return sendError(response, prepared.error.status, prepared.error.message);
    const savedConfig = await aiConfigStorage.get(user.uid);
    const config = publicAiConfig(savedConfig, process.env);
    if (!config.configured) return sendError(response, 503, 'AI 服务尚未配置');
    if (prepared.input.conversationId) {
      try {
        await aiConversationStorage.getConversation(user.uid, bookId, prepared.input.conversationId);
      } catch (error) {
        return aiConversationError(response, error);
      }
    }
    if (abortController.signal.aborted || response.destroyed) return;
    sendSseHeaders(response);
    sendSseEvent(response, 'meta', { scope: prepared.input.scope, sources: prepared.sources, model: config.model,
      evidenceChars: prepared.context.reduce((sum, item) => sum + item.text.length, 0),
      ...(prepared.retrievalMode ? { retrievalMode: prepared.retrievalMode } : {}),
      ...(prepared.profileStatus ? { profileStatus: prepared.profileStatus } : {}),
      ...(prepared.structureCoverage ? { structureCoverage: prepared.structureCoverage } : {}) });
    try {
      const result = await requestOpenAiStream({
        request: { pdfEvidence: true, question: prepared.input.question,
          context: prepared.context, history: prepared.input.history,
          ...(prepared.profile ? { paperContext: prepared.profile, answerProtocol: 'paper-profile' } : {}) },
        env: process.env, savedConfig, signal: abortController.signal,
        onEvent: async (event) => {
          if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            sendSseEvent(response, 'delta', { delta: event.delta });
          }
        }
      });
      const verified = result.citationIntegrity === true;
      const answer = verified ? result.answer : PDF_AI_UNVERIFIED_ANSWER;
      const done = { answer, responseId: result.responseId, streamed: result.streamed,
        citationIntegrity: verified, scope: prepared.input.scope,
        sources: verified ? prepared.sources : [],
        ...(result.usage ? { usage: result.usage } : {}) };
      if (verified && prepared.input.conversationId && !abortController.signal.aborted && !request.aborted) {
        try {
          await aiConversationStorage.appendCompletedTurn(user.uid, bookId, prepared.input.conversationId, {
            question: prepared.input.question, answer,
            sources: prepared.context.map((item, index) => ({
              citationIndex: index + 1, chapterIndex: item.chapterIndex,
              chapterHref: '', chapterLabel: item.chapterLabel, startOffset: item.startOffset,
              sourceFingerprint: prepared.book.fingerprint
            }))
          });
          done.persisted = true;
        } catch (error) {
          done.persisted = false;
          done.persistenceErrorCode = aiConversationPersistenceErrorCode(error);
          recordError(error, { operation: 'pdf-ai-conversation-persist', bookId, code: done.persistenceErrorCode });
        }
      }
      sendSseEvent(response, 'done', done);
    } catch (error) {
      if (error.code !== 'AI_ABORTED' && !response.destroyed) {
        recordError(error, { operation: 'pdf-ai-stream', bookId, code: error.code || null });
        sendSseEvent(response, 'error', { code: error.code || 'AI_STREAM_FAILED', message: aiUserError(error) });
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) throw error;
  } finally {
    request.removeListener('aborted', onAbort);
    response.removeListener('close', onClose);
    if (response.headersSent && !response.writableEnded) response.end();
  }
}

// Sources worth keeping with a saved answer: the ones the answer cites, at
// most the conversation store's limit.
function plannedPersistenceSources(context, answer, book = null) {
  const cited = new Set([...String(answer || '').matchAll(/【(\d+)】/g)].map((match) => Number(match[1])));
  // PDF sources remember the file they came from, so a changed PDF marks them stale.
  const fingerprint = book?.type === 'pdf' && /^[a-f0-9]{64}$/.test(String(book.fingerprint || '')) ? book.fingerprint : null;
  return aiPersistenceSources(context)
    .filter((source) => !cited.size || cited.has(source.citationIndex))
    .slice(0, 12)
    .map((source) => (fingerprint ? { ...source, sourceFingerprint: fingerprint } : source));
}

// PDFs get a table of contents from bookmarks, detected headings or page
// windows; computed once per file and written into the search index.
async function ensurePdfOutline(book, { signal, onProgress } = {}) {
  if (book?.type !== 'pdf') return;
  const fingerprint = await currentPdfFingerprint(book);
  const key = { bookId: book.id, sourceFingerprint: fingerprint, parserVersion: PDF_TEXT_PARSER_VERSION, structureVersion: PDF_AI_STRUCTURE_VERSION };
  let structure = fingerprint ? await pdfAiProfileStore.getStructure(key) : null;
  if (!structure) {
    onProgress?.({ stage: 'structure', message: '正在分析 PDF 的目录结构（首次需要一点时间）…' });
    structure = buildPdfStructure(await extractPdfStructureSignals(book, { signal }));
    if (fingerprint) await pdfAiProfileStore.putStructure({ ...key, structure });
  }
  await ensurePdfNodes(book, DATA_ROOT, structure);
}

function plannedAiInput(body) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('AI 请求格式无效'), { statusCode: 400 });
  const question = String(body.question ?? '').trim();
  const selectedText = String(body.selectedText ?? '').trim();
  if (!question) throw Object.assign(new Error('问题不能为空'), { statusCode: 400 });
  if (question.length > 4000) throw Object.assign(new Error('问题过长'), { statusCode: 400 });
  if (selectedText.length > 4000) throw Object.assign(new Error('选中文本过长'), { statusCode: 400 });
  let history;
  try {
    history = normalizeAiHistory(body.history);
  } catch (error) {
    throw Object.assign(error, { statusCode: 400 });
  }
  const chapter = body.chapter && typeof body.chapter === 'object' ? {
    index: Number.isInteger(body.chapter.index) ? body.chapter.index : null,
    href: String(body.chapter.href || '').slice(0, 500),
    label: String(body.chapter.label || '').slice(0, 300),
    position: {
      href: String(body.chapter.position?.href || '').slice(0, 500),
      anchor: String(body.chapter.position?.anchor || '').slice(0, 500),
      text: String(body.chapter.position?.text || '').slice(0, 200)
    }
  } : null;
  return {
    question,
    selectedText,
    history,
    chapter,
    conversationId: body.conversationId ? String(body.conversationId) : ''
  };
}

let bookMapService = null;
function getBookMapService() {
  if (!bookMapService) {
    bookMapService = createBookMapService({ dataRoot: DATA_ROOT, store: getBookMapStore() });
  }
  return bookMapService;
}
let bookMapStore = null;
function getBookMapStore() {
  if (!bookMapStore) bookMapStore = createBookMapStore({ dataRoot: DATA_ROOT });
  return bookMapStore;
}

let embeddingService = null;
function getEmbeddingService() {
  if (!embeddingService) {
    embeddingService = createEmbeddingService({ dataRoot: DATA_ROOT, readPassages: (book) => readAllPassages(book, DATA_ROOT) });
  }
  return embeddingService;
}

async function bookMapSummaries(bookId) {
  try {
    return await getBookMapStore().latest(bookId);
  } catch {
    return new Map();
  }
}

// 问书 with server-side routing and evidence. Events: progress → meta → delta… → done.
async function handlePlannedAiStream(request, response, user, book, bookId, body) {
  const input = plannedAiInput(body);
  if (book.type === 'pdf' && !pdfReaderEnabled()) return sendError(response, 404, 'PDF 阅读尚未启用');
  const savedConfig = await aiConfigStorage.get(user.uid);
  const config = publicAiConfig(savedConfig, process.env);
  if (!config.configured) return sendError(response, 503, 'AI 服务尚未配置');
  if (input.conversationId) {
    try {
      await aiConversationStorage.getConversation(user.uid, bookId, input.conversationId);
    } catch (error) {
      return aiConversationError(response, error);
    }
  }
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  request.once('aborted', onAbort);
  response.once('close', () => { if (!response.writableEnded) abortController.abort(); });
  const signal = abortController.signal;
  let usage = null;
  const onUsage = (value) => { usage = addUsage(usage, value); };
  const progress = (event) => sendSseEvent(response, 'progress', event);

  sendSseHeaders(response);
  try {
    progress({ stage: 'routing', message: '正在理解问题…' });
    await ensurePdfOutline(book, { signal, onProgress: progress });
    const summaries = await bookMapSummaries(book.id);
    const plan = await planQuestion({
      book, dataRoot: DATA_ROOT, question: input.question, selectedText: input.selectedText,
      chapter: input.chapter, savedConfig, env: process.env, signal, onUsage, onProgress: progress,
      summaries: new Map([...summaries].map(([id, entry]) => [id, entry.summary]))
    });
    if (signal.aborted) return;
    progress({ stage: 'reading', message: '正在读取书中相关内容…' });
    const vectorSettings = embeddingSettings(savedConfig, process.env);
    const semantic = vectorSettings.configured ? { service: getEmbeddingService(), settings: vectorSettings, signal } : null;
    // Build the book's semantic index in the background for later questions.
    if (semantic) semantic.service.ensureInBackground(book, vectorSettings).catch(() => {});
    const evidence = await gatherEvidence({
      book, dataRoot: DATA_ROOT, plan, question: input.question, selectedText: input.selectedText,
      map: { service: getBookMapService(), savedConfig, env: process.env, onUsage, onProgress: progress, summaries },
      semantic
    });
    if (signal.aborted) return;
    if (!evidence.context.length) {
      sendSseEvent(response, 'error', {
        code: 'AI_NO_EVIDENCE',
        message: book.type === 'pdf' && !plan.outline.totalChars
          ? '这份 PDF 没有可提取的文字（可能是扫描版），暂时无法回答。'
          : '没有在书中找到相关内容，请换一种问法。'
      });
      return;
    }
    const planInfo = {
      type: plan.type,
      typeLabel: TYPE_LABELS[plan.type] || '',
      scopeLabel: evidence.scopeLabel,
      nodes: evidence.coverage?.nodes || [],
      mode: evidence.coverage?.mode || '',
      navigated: Boolean(plan.navigated),
      ...(evidence.coverage?.mapEstimate ? { mapEstimate: evidence.coverage.mapEstimate } : {})
    };
    const sources = aiSourcesFromContext(evidence.context);
    sendSseEvent(response, 'meta', {
      sources,
      model: config.model,
      plan: planInfo,
      evidenceChars: evidence.context.reduce((sum, item) => sum + item.text.length, 0)
    });
    progress({ stage: 'answering', message: '正在生成回答…' });
    const result = await requestOpenAiStream({
      request: { rawPayload: buildAnswerPayload({
        book, plan, evidence, question: input.question, selectedText: input.selectedText, history: input.history,
        bookSummary: (await bookMapSummaries(book.id)).get(MAP_ROOT_ID)?.summary || ''
      }) },
      env: process.env,
      savedConfig,
      signal,
      timeoutMs: 120000,
      onEvent: async (event) => {
        if (event?.type === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta) {
          sendSseEvent(response, 'delta', { delta: event.delta });
        }
      }
    });
    usage = addUsage(usage, result.usage);
    const answer = sanitizeAiAnswerCitations(result.answer, evidence.context.length).answer;
    const done = { answer, responseId: result.responseId, streamed: result.streamed, sources, plan: planInfo, ...(usage ? { usage } : {}) };
    if (input.conversationId && !signal.aborted && !request.aborted) {
      try {
        await aiConversationStorage.appendCompletedTurn(user.uid, bookId, input.conversationId, {
          question: input.question,
          answer,
          sources: plannedPersistenceSources(evidence.context, answer, book)
        });
        done.persisted = true;
      } catch (error) {
        done.persisted = false;
        done.persistenceErrorCode = aiConversationPersistenceErrorCode(error);
        recordError(error, { operation: 'ai-conversation-persist', bookId, code: done.persistenceErrorCode });
      }
    }
    sendSseEvent(response, 'done', done);
  } catch (error) {
    if (error.code !== 'AI_ABORTED' && !signal.aborted && !response.destroyed) {
      recordError(error, { operation: 'ai-planned-stream', bookId, code: error.code || null });
      sendSseEvent(response, 'error', { code: error.code || 'AI_STREAM_FAILED', message: aiUserError(error) });
    }
  } finally {
    request.removeListener('aborted', onAbort);
    if (!response.writableEnded) response.end();
  }
}

async function resolveAiInputChapter(book, input) {
  if (book?.type !== 'epub' || !input?.chapter) return { status: 'unresolved', reason: 'position_unavailable' };
  const resolution = await resolveBookPosition(book, DATA_ROOT, input.chapter);
  input.chapterResolution = resolution;
  if (resolution.status === 'resolved') {
    input.chapter = {
      index: resolution.spineIndex,
      href: resolution.href,
      label: resolution.chapterLabel
    };
  } else {
    // Never forward a client-authored chapter label as a verified location.
    input.chapter = { index: null, href: '', label: '当前阅读位置未能可靠确认' };
  }
  return resolution;
}

function isAiChapterUnderstandingEnabled() {
  return process.env.ZHENSHU_ENABLE_AI_CHAPTER_UNDERSTANDING === '1';
}

function effectiveAiIntent(question, selectedText = '') {
  const intent = classifyAiIntent({ question, selectedText });
  if (!isAiChapterUnderstandingEnabled() && ['chapter_summary', 'book_summary'].includes(intent.intent)) {
    return { ...intent, intent: 'lookup', scope: 'book', scopeConfidence: 'default' };
  }
  return intent;
}

async function prepareBookSummary(book, userId, question, config) {
  const navigation = await readBookNavigation(book, DATA_ROOT);
  if (!navigation.available || !navigation.chapters.length) {
    return { error: Object.assign(new Error('无法读取本书目录，暂时不能安全生成全书概述。'), { statusCode: 409 }) };
  }
  const [retrieval, cachedSummaries] = await Promise.all([
    searchAiBook(book, DATA_ROOT, { query: question, intent: 'lookup', limit: 12 }),
    listCachedChapterSummaries({
      book, dataRoot: DATA_ROOT, userId, baseUrl: config.baseUrl, model: config.model
    })
  ]);
  const selection = selectBookSummaryCandidates({
    chapters: navigation.chapters,
    query: question,
    matches: retrieval.matches,
    cachedSummaries
  });
  if (selection.status !== 'selected' || !selection.candidates.length) {
    return { error: Object.assign(new Error('未能从本书目录确定可用章节。'), { statusCode: 409 }) };
  }
  const evidenceResults = await Promise.all(selection.candidates.map(async (chapter) => ({
    chapter,
    evidence: await readChapterEvidence(book, DATA_ROOT, chapter.id)
  })));
  const failed = evidenceResults.find(({ evidence }) => !evidence.available || evidence.truncated || !evidence.chunks.length);
  if (failed) {
    return { error: Object.assign(new Error(failed.evidence.truncated
      ? '代表性章节超出单次安全读取上限，请改为逐章提问。'
      : '部分目录章节缺少可用原文，请重建本地索引后重试。'), { statusCode: failed.evidence.truncated ? 413 : 409 }) };
  }
  const chunks = evidenceResults.flatMap(({ chapter, evidence }) => evidence.chunks.map((chunk) => ({
    ...chunk,
    logicalChapterId: chapter.id,
    chapterLabel: chapter.label || chunk.chapterLabel
  })));
  let plan;
  try {
    plan = planChapterSummary(chunks);
  } catch (error) {
    return { error };
  }
  plan.coverage = selection.coverage;
  plan.mode = 'book-map-reduce';
  const fingerprint = evidenceResults[0].evidence.bookFingerprint;
  const parserVersion = evidenceResults[0].evidence.parserVersion;
  if (evidenceResults.some(({ evidence }) => evidence.bookFingerprint !== fingerprint || evidence.parserVersion !== parserVersion)) {
    return { error: Object.assign(new Error('书籍索引在处理中发生变化，请重试。'), { statusCode: 409 }) };
  }
  const bookSummaryFingerprint = crypto.createHash('sha256').update(JSON.stringify({
    fingerprint,
    chapters: selection.candidates.map((chapter) => chapter.id),
    question: String(question || '').trim().toLocaleLowerCase()
  }), 'utf8').digest('hex');
  return { plan, evidence: { bookFingerprint: bookSummaryFingerprint, parserVersion }, coverage: selection.coverage };
}

function gatewayUser(request) {
  return platform.identify(request);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON request body'), { statusCode: 400 });
  }
}

function publicBook(book, bookTitles = null) {
  if (!book || book.error) return book;
  const { path: ignoredPath, root: ignoredRoot, ...renamed } = book;
  // A reader's own name replaces the title everywhere; the original stays
  // available so the rename dialog can offer it back.
  const customTitle = bookTitles?.[book.id];
  const safe = customTitle ? { ...renamed, title: customTitle, originalTitle: book.title || '' } : renamed;
  // Readers open MOBI/AZW3 through their derived EPUB; the real format is kept
  // for labels only.
  if (safe.type === 'mobi') return { ...safe, type: 'epub', format: safe.sourceFormat === 'kf8' ? 'azw3' : 'mobi' };
  return safe;
}

const parseFnOSPathList = parsePathList;

function currentRootCounts() {
  return {
    configured: rootDiagnostics.configuredRoots.length,
    accessible: rootDiagnostics.accessibleRoots.length,
    shared: rootDiagnostics.sharedRoots.length,
    authorized: rootDiagnostics.authorizedRoots.length,
    rejected: rootDiagnostics.rejectedRoots.length
  };
}

function organizationApiError(response, error) {
  const statusByCode = {
    INVALID_ORGANIZATION: 400,
    INVALID_ORGANIZATION_REVISION: 400,
    INVALID_ORGANIZATION_MUTATION: 400,
    INVALID_BOOK_TITLE: 400,
    COLLECTION_NOT_FOUND: 404,
    BOOK_NOT_FOUND: 404,
    ORGANIZATION_CONFLICT: 409,
    LIBRARY_INDEX_UNHEALTHY: 503,
    ORGANIZATION_STORE_CORRUPT: 503,
    ORGANIZATION_STORE_TOO_LARGE: 503,
    ORGANIZATION_UNSAFE_TARGET: 503
  };
  const messageByCode = {
    INVALID_ORGANIZATION: '组织参数无效',
    INVALID_ORGANIZATION_REVISION: '组织版本无效',
    INVALID_ORGANIZATION_MUTATION: '组织操作无效',
    INVALID_BOOK_TITLE: '书名最多 200 个字，且不能包含控制字符',
    COLLECTION_NOT_FOUND: '分类不存在',
    BOOK_NOT_FOUND: '书籍不存在',
    ORGANIZATION_CONFLICT: '书库已在其他页面更新，请重新加载',
    LIBRARY_INDEX_UNHEALTHY: '当前书库扫描未完成，暂不能修改分类',
    ORGANIZATION_STORE_CORRUPT: '书库分类数据暂时无法读取',
    ORGANIZATION_STORE_TOO_LARGE: '书库分类数据过大',
    ORGANIZATION_UNSAFE_TARGET: '书库分类数据暂时无法读取'
  };
  const status = statusByCode[error?.code] || error?.statusCode || 500;
  const message = messageByCode[error?.code]
    || (status === 404 ? '资源不存在' : status >= 500 ? '书库分类服务暂时不可用' : '请求无效');
  return sendError(response, status, message);
}

function assertOrganizationBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Invalid organization body'), { code: 'INVALID_ORGANIZATION' });
  }
  return body;
}

function organizationRevision(body) {
  if (!Number.isInteger(body.revision) || body.revision < 0) {
    throw Object.assign(new Error('Invalid organization revision'), { code: 'INVALID_ORGANIZATION_REVISION' });
  }
  return body.revision;
}

function assertOrganizationCatalogHealthy(index) {
  if (index?.scan && !isHealthyLibraryIndex(index)) {
    throw Object.assign(new Error('Library index is not healthy'), { code: 'LIBRARY_INDEX_UNHEALTHY' });
  }
}

async function getLibraryOrganizationSnapshot(uid, index = null) {
  const currentIndex = index || await storage.getLibraryIndex();
  const stored = await storage.getLibraryOrganization(uid);
  const resolved = resolveLibraryOrganization(currentIndex.books, stored);
  const switches = readerFormatSwitches();
  const visibleBooks = currentIndex.books.filter((book) => !book.error && isBookVisible(book, switches));
  const visibleIds = new Set(visibleBooks.map((book) => book.id));
  const visibleOrder = (order) => order.filter((bookId) => visibleIds.has(bookId));
  return {
    version: resolved.organization.version,
    revision: resolved.organization.revision,
    updatedAt: resolved.organization.updatedAt,
    preferences: resolved.organization.preferences,
    collections: resolved.collections,
    allBookOrder: visibleOrder(resolved.allBookOrder),
    collectionOrders: Object.fromEntries(Object.entries(resolved.collectionOrders)
      .map(([collectionId, order]) => [collectionId, visibleOrder(order)])),
    unassignedOrder: visibleOrder(resolved.unassignedOrder),
    bookAssignments: Object.fromEntries(Object.entries(resolved.bookAssignments)
      .filter(([bookId]) => visibleIds.has(bookId))),
    bookTitles: Object.fromEntries(Object.entries(resolved.bookTitles)
      .filter(([bookId]) => visibleIds.has(bookId))),
    orphanedBookIds: resolved.orphanedBookIds,
    books: visibleBooks.map((book) => publicBook(book, resolved.bookTitles)),
    features: libraryFeatures(currentIndex, switches)
  };
}

async function userBookTitles(uid) {
  try {
    return normalizeLibraryOrganization(await storage.getLibraryOrganization(uid)).bookTitles;
  } catch {
    return {};
  }
}

async function mutateLibraryOrganization(user, body, mutation) {
  const payload = assertOrganizationBody(body);
  const revision = organizationRevision(payload);
  const index = await storage.getLibraryIndex();
  assertOrganizationCatalogHealthy(index);
  const switches = readerFormatSwitches();
  const activeBookIds = new Set(index.books
    .filter((book) => !book.error && isBookVisible(book, switches))
    .map((book) => book.id));
  await storage.mutateLibraryOrganization(user.uid, revision, async (draft) => {
    return mutation(draft, activeBookIds);
  });
  return getLibraryOrganizationSnapshot(user.uid, index);
}

function organizationCollection(draft, collectionId) {
  return draft.collections.find((collection) => collection.id === collectionId) || null;
}

function ensureOrganizationCollection(draft, collectionId) {
  if (!COLLECTION_ID_PATTERN.test(String(collectionId || '')) || !organizationCollection(draft, collectionId)) {
    throw Object.assign(new Error('Collection not found'), { code: 'COLLECTION_NOT_FOUND' });
  }
}

function ensureExactOrder(order, expected, message = 'Invalid organization order') {
  if (!Array.isArray(order) || order.length !== expected.length) {
    throw Object.assign(new Error(message), { code: 'INVALID_ORGANIZATION' });
  }
  const expectedSet = new Set(expected);
  const seen = new Set();
  for (const item of order) {
    if (typeof item !== 'string' || !expectedSet.has(item) || seen.has(item)) {
      throw Object.assign(new Error(message), { code: 'INVALID_ORGANIZATION' });
    }
    seen.add(item);
  }
}

async function loadConfiguration() {
  const revision = platform.rootsRevision(CONFIG_ROOT);
  const config = await readJson(path.join(CONFIG_ROOT, 'settings.json'), { libraryRoots: [] });
  const configured = Array.isArray(config.libraryRoots) ? config.libraryRoots : [];
  const { accessibleRoots, sharedRoots } = platform.libraryRoots(CONFIG_ROOT);
  rootDiagnostics = await resolveLibraryRoots({
    configuredRoots: configured,
    accessibleRoots,
    sharedRoots
  });
  authorizedRoots = rootDiagnostics.authorizedRoots.slice();
  authorizationRevision = revision;
  for (const rejected of rootDiagnostics.rejectedRoots) {
    recordError(new Error(rejected.error), {
      operation: 'load-library-root',
      root: rejected.root,
      code: rejected.code
    });
  }
  return rootDiagnostics;
}

async function refreshAuthorizationIfChanged() {
  if (authorizationRevision !== platform.rootsRevision(CONFIG_ROOT)) await loadConfiguration();
}

async function findBook(bookId, options = {}) {
  await refreshAuthorizationIfChanged();
  if (!/^[a-f0-9]{64}$/.test(bookId)) throw Object.assign(new Error('Invalid book ID'), { statusCode: 400 });
  const index = await storage.getLibraryIndex();
  const book = index.books.find((item) => item.id === bookId && !item.error);
  if (!book) throw Object.assign(new Error('Book not found'), { statusCode: 404 });
  const indexedPath = book.path;
  try {
    book.path = await resolveAuthorizedPath(indexedPath, authorizedRoots);
  } catch {
    throw Object.assign(new Error('Book not found'), { statusCode: 404 });
  }
  if (options.requirePathIdentity && book.type === 'pdf' && path.resolve(indexedPath) !== path.resolve(book.path)) {
    throw Object.assign(new Error('Book file no longer matches its indexed path'), { statusCode: 404 });
  }
  if (book.type === 'mobi') {
    if (!mobiReaderEnabled()) throw Object.assign(new Error('Book not found'), { statusCode: 404 });
    if (!options.allowMobiMetadata) return mobiEpubView(book);
  }
  return book;
}

const MOBI_ERRORS = Object.freeze({
  DRM_PROTECTED: [415, '这本书受 DRM 保护，无法阅读。'],
  TOO_LARGE: [413, '这本书过大，暂不支持阅读。'],
  SOURCE_CHANGED: [409, '文件已变化，请重新扫描书库后再打开。'],
  TIMEOUT: [503, '准备这本书超时，请稍后重试。']
});

// Every handler that reads book content (content, search, FTS, AI) receives a
// MOBI book as an EPUB view of its authorized, converted derivative, so none of
// them can ever read the raw Kindle bytes. The source was re-authorized above.
async function mobiEpubView(book) {
  let derived;
  try {
    derived = await mobiDerived.ensure(book);
  } catch (error) {
    const [statusCode, message] = MOBI_ERRORS[error?.code] || [422, '无法转换这本书，文件可能已损坏。'];
    throw Object.assign(new Error(message), { statusCode, publicCode: `MOBI_${error?.code || 'CONVERSION_FAILED'}` });
  }
  if (derived.status !== 'ready') {
    throw Object.assign(new Error('正在准备这本书，请稍候…'), { statusCode: 409, publicCode: 'MOBI_PREPARING' });
  }
  return { ...book, type: 'epub', path: derived.path, sourceType: 'mobi', sourcePath: book.path };
}

async function currentPdfFingerprint(book) {
  const flags = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0);
  const handle = await fs.open(book.path, flags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    const header = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!/%PDF-[0-9]\.[0-9]/.test(header.subarray(0, bytesRead).toString('latin1'))) return null;
    return fingerprintBook(book.path, stat);
  } finally {
    await handle.close();
  }
}

async function servePdfContent(request, response, book) {
  const flags = nodeFs.constants.O_RDONLY | (nodeFs.constants.O_NOFOLLOW || 0);
  const handle = await fs.open(book.path, flags);
  let streamOwnsHandle = false;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw Object.assign(new Error('Book is not a regular file'), { statusCode: 404 });
    const header = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!/%PDF-[0-9]\.[0-9]/.test(header.subarray(0, bytesRead).toString('latin1'))) {
      throw Object.assign(new Error('PDF file changed or is no longer valid'), { statusCode: 409 });
    }

    const commonHeaders = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    };
    const rangeHeader = request.headers.range;
    const range = rangeHeader ? parseSingleByteRange(rangeHeader, stat.size) : null;
    if (range && (range.kind || range.start === undefined
      || range.end - range.start + 1 > MAX_PDF_RANGE_BYTES)) {
      await handle.close();
      const headers = { ...commonHeaders, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': '0' };
      response.writeHead(416, headers);
      return response.end();
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, stat.size - 1);
    const length = range ? end - start + 1 : stat.size;
    const status = range ? 206 : 200;
    const headers = {
      ...commonHeaders,
      'Content-Length': String(length),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {})
    };
    if (request.method === 'HEAD') {
      await handle.close();
      response.writeHead(status, headers);
      return response.end();
    }

    response.writeHead(status, headers);
    const stream = handle.createReadStream({ start, end, autoClose: true });
    streamOwnsHandle = true;
    response.on('close', () => {
      if (!response.writableEnded) stream.destroy();
    });
    stream.on('error', (error) => {
      if (!response.headersSent) return sendError(response, 500, 'Unable to read PDF');
      response.destroy(error);
    });
    stream.pipe(response);
  } catch (error) {
    if (!streamOwnsHandle) await handle.close().catch(() => {});
    throw error;
  }
}

async function serveStatic(request, response, pathname) {
  let relative = pathname === APP_PREFIX || pathname === `${APP_PREFIX}/`
    ? 'index.html'
    : pathname.slice(APP_PREFIX.length + 1);
  relative = decodeURIComponent(relative);
  if (!relative || relative.includes('\0') || relative.split('/').includes('..')) {
    throw Object.assign(new Error('Invalid static path'), { statusCode: 400 });
  }
  const candidate = path.resolve(UI_ROOT, relative);
  if (candidate !== UI_ROOT && !candidate.startsWith(`${UI_ROOT}${path.sep}`)) {
    throw Object.assign(new Error('Static path escapes UI root'), { statusCode: 403 });
  }
  const stat = await fs.stat(candidate);
  if (!stat.isFile()) throw Object.assign(new Error('Not found'), { statusCode: 404 });
  const extension = path.extname(candidate).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  };
  const bytes = await fs.readFile(candidate);
  // Revalidate every request for first-party assets. An FPK upgrade replaces
  // app.js/styles.css under the same URL, so a long max-age would leave the
  // browser running the previous build for an hour after an update — the UI
  // would silently keep the old behaviour. Vendor libs never change in place
  // and keep a long immutable cache.
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const isImmutable = relative.startsWith('lib/') || relative.startsWith('vendor/pdfjs/') || /\.(png|svg|woff2)$/i.test(relative);
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    response.end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
    'Content-Length': bytes.length,
    'ETag': etag,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  });
  response.end(bytes);
}

async function handleApi(request, response, pathname, searchParams = new URLSearchParams()) {
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/health`) {
    return sendJson(response, 200, {
      status: 'ok',
      startedAt: STARTED_AT,
      uptimeSeconds: Math.floor(process.uptime()),
      scan: currentScanState()
    });
  }

  const user = gatewayUser(request);
  if (pathname === APP_PREFIX + '/api/ai/indexes' && request.method === 'GET') {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    const index = await storage.getLibraryIndex();
    return sendJson(response, 200, await aiIndexManager.listIndexes({
      libraryIndex: index.books,
      scanHealthy: isHealthyLibraryIndex(index)
    }));
  }
  const aiIndexDeleteMatch = pathname.match(new RegExp('^' + APP_PREFIX + '/api/ai/indexes/([a-f0-9]{64})$'));
  if (aiIndexDeleteMatch && request.method === 'DELETE') {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    return sendJson(response, 200, await aiIndexManager.deleteIndex(aiIndexDeleteMatch[1]));
  }
  if (pathname === APP_PREFIX + '/api/ai/indexes/cleanup' && request.method === 'POST') {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    const index = await storage.getLibraryIndex();
    const body = await readJsonBody(request);
    return sendJson(response, 200, await aiIndexManager.cleanup({
      ...body,
      libraryIndex: index.books,
      scanHealthy: isHealthyLibraryIndex(index)
    }));
  }
  if (request.method === 'POST' && pathname === `${APP_PREFIX}/api/reading-time`) {
    const body = await readJsonBody(request);
    return sendJson(response, 200, await storage.addReadingTime(user.uid, body));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/stats`) {
    // 阅读统计: one week or month (with the one before it) for this user.
    const { days, readingState, bookInfo } = await readerDataFor(user);
    return sendJson(response, 200, buildReadingStats({
      days,
      readingState,
      bookInfo,
      range: searchParams.get('range') || 'week',
      anchor: searchParams.get('anchor'),
      timezoneOffset: Number(searchParams.get('tz') || 0)
    }));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/notes`) {
    const { days, readingState, bookInfo } = await readerDataFor(user);
    return sendJson(response, 200, buildNotesSummary({ readingState, bookInfo, readingDays: days }));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/notes/search`) {
    const { readingState, bookInfo } = await readerDataFor(user);
    return sendJson(response, 200, searchNotes({ readingState, bookInfo, query: String(searchParams.get('q') || '').slice(0, 200) }));
  }
  const notesBookMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/notes/([a-f0-9]{64})$`));
  if (request.method === 'GET' && notesBookMatch) {
    const bookId = notesBookMatch[1];
    const { days, readingState, bookInfo } = await readerDataFor(user);
    let toc = null;
    if (bookInfo(bookId)?.type === 'epub') {
      // Chapter names; a book that can no longer be read keeps its notes.
      try {
        toc = await epubTocForBook(await findBook(bookId));
      } catch {
        toc = null;
      }
    }
    return sendJson(response, 200, buildBookNotes({ bookId, readingState, bookInfo, toc, readingDays: days }));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/reading-time`) {
    return sendJson(response, 200, await storage.getReadingTime(user.uid, searchParams.get('from'), searchParams.get('to')));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/session`) {
    return sendJson(response, 200, { uid: user.uid, username: user.username, isAdmin: user.isAdmin });
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/diagnostics`) {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    await refreshAuthorizationIfChanged();
    const index = await storage.getLibraryIndex();
    return sendJson(response, 200, {
      status: 'ok',
      startedAt: STARTED_AT,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      dataRoot: DATA_ROOT,
      configRoot: CONFIG_ROOT,
      authorizedRootCount: authorizedRoots.length,
      rootCounts: currentRootCounts(),
      roots: rootDiagnostics,
      libraryGeneratedAt: index.generatedAt || null,
      bookCount: index.books.filter((book) => !book.error).length,
      indexErrorCount: index.books.filter((book) => book.error).length,
      scan: currentScanState(),
      recentErrors: errorLog.slice(-20).reverse()
    });
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/errors`) {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    return sendJson(response, 200, { errors: errorLog.slice().reverse() });
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/library/scan/status`) {
    return sendJson(response, 200, currentScanState());
  }
  if (request.method === 'PUT' && pathname === `${APP_PREFIX}/api/library/imports`) {
    return handleBookImport(request, response, user);
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/library`) {
    await refreshAuthorizationIfChanged();
    const index = await storage.getLibraryIndex();
    const bookTitles = await userBookTitles(user.uid);
    const switches = readerFormatSwitches();
    return sendJson(response, 200, libraryResponse(index, user, switches, bookTitles));
  }
  if (request.method === 'POST' && pathname === `${APP_PREFIX}/api/library/scan`) {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    const index = await runLibraryScan();
    const switches = readerFormatSwitches();
    const bookTitles = await userBookTitles(user.uid);
    return sendJson(response, 200, libraryResponse(index, user, switches, bookTitles));
  }

  const organizationCollectionMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/library/collections/([^/]+)$`));
  const organizationPlacementMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/library/books/([^/]+)/placement$`));
  const organizationTitleMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/library/books/([^/]+)/title$`));
  try {
    if (organizationTitleMatch && request.method === 'PUT') {
      const bookId = decodeURIComponent(organizationTitleMatch[1]);
      if (!BOOK_ID_PATTERN.test(bookId)) {
        throw Object.assign(new Error('Invalid book ID'), { code: 'INVALID_ORGANIZATION' });
      }
      const book = await findBook(bookId, { allowMobiMetadata: true });
      const body = await readJsonBody(request);
      const title = normalizeBookTitle(body?.title);
      const result = await mutateLibraryOrganization(user, body, (draft, activeBookIds) => {
        if (!activeBookIds.has(bookId)) {
          throw Object.assign(new Error('Book not found'), { code: 'BOOK_NOT_FOUND' });
        }
        // Naming a book back to its own title clears the override.
        if (!title || title === String(book?.title || '').normalize('NFKC').replace(/\s+/gu, ' ').trim()) {
          delete draft.bookTitles[bookId];
        } else {
          draft.bookTitles[bookId] = title;
        }
        return draft;
      });
      return sendJson(response, 200, result);
    }

    if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/library/organization`) {
      return sendJson(response, 200, await getLibraryOrganizationSnapshot(user.uid));
    }

    if (request.method === 'POST' && pathname === `${APP_PREFIX}/api/library/organization/reconcile`) {
      const body = await readJsonBody(request);
      const revision = organizationRevision(body);
      if (body.confirm !== undefined && typeof body.confirm !== 'boolean') {
        throw Object.assign(new Error('Invalid organization confirmation'), { code: 'INVALID_ORGANIZATION_MUTATION' });
      }
      const index = await storage.getLibraryIndex();
      assertOrganizationCatalogHealthy(index);
      const stored = await storage.getLibraryOrganization(user.uid);
      if (stored.revision !== revision) {
        throw Object.assign(new Error('Organization revision conflict'), { code: 'ORGANIZATION_CONFLICT' });
      }
      const activeBookIds = new Set(index.books.filter((book) => !book.error).map((book) => book.id));
      const preview = reconcileLibraryOrganization(stored, activeBookIds);
      if (body.confirm !== true || preview.orphanedBookIds.length === 0) {
        return sendJson(response, 200, {
          dryRun: body.confirm !== true,
          confirmed: body.confirm === true,
          removedCount: 0,
          orphanCount: preview.orphanedBookIds.length,
          orphanedBookIds: preview.orphanedBookIds,
          revision: stored.revision
        });
      }

      await storage.mutateLibraryOrganization(user.uid, revision, (current) => {
        return reconcileLibraryOrganization(current, activeBookIds).organization;
      });
      return sendJson(response, 200, {
        ...(await getLibraryOrganizationSnapshot(user.uid, index)),
        dryRun: false,
        confirmed: true,
        removedCount: preview.orphanedBookIds.length
      });
    }

    if (request.method === 'POST' && pathname === `${APP_PREFIX}/api/library/collections`) {
      const body = await readJsonBody(request);
      const result = await mutateLibraryOrganization(user, body, (draft) => {
        const name = body.name;
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        draft.collections.push({ id, name, createdAt: now, updatedAt: now });
        draft.collectionOrders[id] = [];
        return draft;
      });
      return sendJson(response, 201, result);
    }

    if (organizationCollectionMatch && ['PATCH', 'DELETE'].includes(request.method)) {
      const collectionId = decodeURIComponent(organizationCollectionMatch[1]);
      if (!COLLECTION_ID_PATTERN.test(collectionId)) {
        throw Object.assign(new Error('Invalid collection ID'), { code: 'INVALID_ORGANIZATION' });
      }
      const body = await readJsonBody(request);
      if (request.method === 'PATCH') {
        const result = await mutateLibraryOrganization(user, body, (draft) => {
          const collection = organizationCollection(draft, collectionId);
          if (!collection) throw Object.assign(new Error('Collection not found'), { code: 'COLLECTION_NOT_FOUND' });
          collection.name = body.name;
          collection.updatedAt = new Date().toISOString();
          return draft;
        });
        return sendJson(response, 200, result);
      }

      const result = await mutateLibraryOrganization(user, body, (draft) => {
        ensureOrganizationCollection(draft, collectionId);
        const removedOrder = Array.isArray(draft.collectionOrders[collectionId])
          ? draft.collectionOrders[collectionId]
          : [];
        draft.collections = draft.collections.filter((collection) => collection.id !== collectionId);
        delete draft.collectionOrders[collectionId];
        for (const [bookId, assignedCollectionId] of Object.entries(draft.bookAssignments)) {
          if (assignedCollectionId === collectionId) delete draft.bookAssignments[bookId];
        }
        const nextUnassigned = [...draft.unassignedOrder];
        for (const bookId of removedOrder) {
          if (!nextUnassigned.includes(bookId)) nextUnassigned.push(bookId);
        }
        draft.unassignedOrder = nextUnassigned;
        return draft;
      });
      return sendJson(response, 200, result);
    }

    if (organizationPlacementMatch && request.method === 'PUT') {
      const bookId = decodeURIComponent(organizationPlacementMatch[1]);
      if (!BOOK_ID_PATTERN.test(bookId)) {
        throw Object.assign(new Error('Invalid book ID'), { code: 'INVALID_ORGANIZATION' });
      }
      await findBook(bookId);
      const body = await readJsonBody(request);
      const result = await mutateLibraryOrganization(user, body, (draft, activeBookIds) => {
        if (!activeBookIds.has(bookId)) {
          throw Object.assign(new Error('Book not found'), { code: 'BOOK_NOT_FOUND' });
        }
        const collectionId = body.collectionId === null || body.collectionId === undefined
          ? null
          : String(body.collectionId);
        if (collectionId !== null) ensureOrganizationCollection(draft, collectionId);
        const beforeBookId = body.beforeBookId === null || body.beforeBookId === undefined
          ? null
          : String(body.beforeBookId);
        if (beforeBookId !== null && !activeBookIds.has(beforeBookId)) {
          throw Object.assign(new Error('Invalid placement target'), { code: 'INVALID_ORGANIZATION' });
        }

        for (const order of Object.values(draft.collectionOrders)) {
          const index = order.indexOf(bookId);
          if (index >= 0) order.splice(index, 1);
        }
        draft.unassignedOrder = draft.unassignedOrder.filter((id) => id !== bookId);
        if (collectionId === null) {
          delete draft.bookAssignments[bookId];
          const index = beforeBookId === null ? -1 : draft.unassignedOrder.indexOf(beforeBookId);
          if (index < 0) draft.unassignedOrder.push(bookId);
          else draft.unassignedOrder.splice(index, 0, bookId);
          return draft;
        }

        draft.bookAssignments[bookId] = collectionId;
        const targetOrder = draft.collectionOrders[collectionId] || (draft.collectionOrders[collectionId] = []);
        const index = beforeBookId === null ? -1 : targetOrder.indexOf(beforeBookId);
        if (beforeBookId !== null && index < 0) {
          throw Object.assign(new Error('Invalid placement target'), { code: 'INVALID_ORGANIZATION' });
        }
        if (index < 0) targetOrder.push(bookId);
        else targetOrder.splice(index, 0, bookId);
        return draft;
      });
      return sendJson(response, 200, result);
    }

    if (request.method === 'PUT' && pathname === `${APP_PREFIX}/api/library/organization/order`) {
      const body = await readJsonBody(request);
      const result = await mutateLibraryOrganization(user, body, (draft, activeBookIds) => {
        const scope = String(body.scope || '');
        const visible = resolveLibraryOrganization([...activeBookIds].map((id) => ({ id })), draft);
        const preserveMissing = (previous) => previous.filter((id) => !activeBookIds.has(id));
        if (scope === 'all') {
          ensureExactOrder(body.order, visible.allBookOrder, 'Invalid all-book order');
          draft.allBookOrder = [...body.order, ...preserveMissing(draft.allBookOrder || [])];
          return draft;
        }
        if (scope === 'collections') {
          const current = draft.collections.map((collection) => collection.id);
          ensureExactOrder(body.order, current, 'Invalid collection order');
          const byId = new Map(draft.collections.map((collection) => [collection.id, collection]));
          draft.collections = body.order.map((id) => byId.get(id));
          return draft;
        }
        if (scope === 'unassigned') {
          ensureExactOrder(body.order, visible.unassignedOrder, 'Invalid unassigned order');
          draft.unassignedOrder = [...body.order, ...preserveMissing(draft.unassignedOrder)];
          return draft;
        }
        ensureOrganizationCollection(draft, scope);
        const current = draft.collectionOrders[scope] || [];
        ensureExactOrder(body.order, visible.collectionOrders[scope], 'Invalid collection book order');
        draft.collectionOrders[scope] = [...body.order, ...preserveMissing(current)];
        return draft;
      });
      return sendJson(response, 200, result);
    }

    if (request.method === 'PUT' && pathname === `${APP_PREFIX}/api/library/organization/preferences`) {
      const body = await readJsonBody(request);
      const result = await mutateLibraryOrganization(user, body, (draft) => {
        draft.preferences = { viewMode: body.viewMode };
        return draft;
      });
      return sendJson(response, 200, result);
    }
  } catch (error) {
    return organizationApiError(response, error);
  }

  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/state`) {
    return sendJson(response, 200, await storage.getState(user.uid));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/ai/status`) {
    const saved = await aiConfigStorage.get(user.uid);
    return sendJson(response, 200, publicAiConfig(saved, process.env));
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/ai/config`) {
    const saved = await aiConfigStorage.get(user.uid);
    return sendJson(response, 200, publicAiConfig(saved, process.env));
  }
  if (request.method === 'PUT' && pathname === `${APP_PREFIX}/api/ai/config`) {
    const saved = await aiConfigStorage.update(user.uid, await readJsonBody(request));
    return sendJson(response, 200, publicAiConfig(saved, process.env));
  }
  if (request.method === 'POST' && pathname === `${APP_PREFIX}/api/ai/test-connection`) {
    let candidate;
    try {
      const saved = await aiConfigStorage.get(user.uid);
      candidate = normalizeAiSettings(await readJsonBody(request), saved);
    } catch (error) {
      return sendError(response, 400, error.message);
    }
    try {
      const result = await testOpenAiConnection({ env: process.env, savedConfig: candidate });
      return sendJson(response, 200, result);
    } catch (error) {
      recordError(error, { operation: 'ai-test-connection', code: error.code || null });
      return sendError(response, error.statusCode || 502, aiUserError(error));
    }
  }
  if (request.method === 'PUT' && pathname === `${APP_PREFIX}/api/settings`) {
    return sendJson(response, 200, await storage.updateSettings(user.uid, await readJsonBody(request)));
  }

  const searchMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/search$`));
  if (request.method === 'GET' && searchMatch) {
    const book = await findBook(searchMatch[1]);
    const options = parseBookSearchParams(searchParams);
    if (book.type === 'pdf') {
      if (!pdfReaderEnabled()) {
        return sendJson(response, 200, {
          available: false,
          query: options.query,
          scope: options.scope,
          results: [],
          hasMore: false,
          nextCursor: null,
          truncated: false,
          unavailableReason: 'pdf_search_disabled'
        });
      }
    }
    const abortController = new AbortController();
    const abortSearch = () => abortController.abort();
    const abortOnResponseClose = () => {
      if (!response.writableEnded) abortSearch();
    };
    request.once('aborted', abortSearch);
    response.once('close', abortOnResponseClose);
    try {
      const payload = await searchBookText(book, DATA_ROOT, { ...options, signal: abortController.signal });
      if (request.aborted || response.destroyed) return;
      return sendJson(response, 200, payload);
    } finally {
      request.off('aborted', abortSearch);
      response.off('close', abortOnResponseClose);
    }
  }

  const openedMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/opened$`));
  if (request.method === 'POST' && openedMatch) {
    await findBook(openedMatch[1]);
    return sendJson(response, 200, await storage.markBookOpened(user.uid, openedMatch[1]));
  }

  const progressMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/progress$`));
  if (request.method === 'PUT' && progressMatch) {
    await findBook(progressMatch[1]);
    return sendJson(response, 200, await storage.updateProgress(user.uid, progressMatch[1], await readJsonBody(request)));
  }

  const highlightsMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/highlights$`));
  if (request.method === 'PUT' && highlightsMatch) {
    await findBook(highlightsMatch[1]);
    const body = await readJsonBody(request);
    return sendJson(response, 200, await storage.replaceHighlights(user.uid, highlightsMatch[1], body.highlights));
  }

  const bookmarksMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/bookmarks(?:/([^/]+))?$`));
  if (bookmarksMatch) {
    await findBook(bookmarksMatch[1]);
    if (request.method === 'GET' && !bookmarksMatch[2]) {
      return sendJson(response, 200, await storage.listBookmarks(user.uid, bookmarksMatch[1]));
    }
    if (request.method === 'POST' && !bookmarksMatch[2]) {
      return sendJson(response, 201, await storage.addBookmark(user.uid, bookmarksMatch[1], await readJsonBody(request)));
    }
    if (request.method === 'DELETE' && bookmarksMatch[2]) {
      return sendJson(response, 200, await storage.deleteBookmark(
        user.uid,
        bookmarksMatch[1],
        decodeURIComponent(bookmarksMatch[2])
      ));
    }
  }

  const aiConversationCollectionMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([^/]+)/ai/conversations$`));
  const aiConversationItemMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([^/]+)/ai/conversations/([^/]+)$`));
  const aiConversationMessagesMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([^/]+)/ai/conversations/([^/]+)/messages$`));
  if (aiConversationCollectionMatch || aiConversationItemMatch || aiConversationMessagesMatch) {
    try {
      const match = aiConversationCollectionMatch || aiConversationItemMatch || aiConversationMessagesMatch;
      const bookId = match[1];
      const conversationBook = await findBook(bookId, { requirePathIdentity: true });
      if (aiConversationCollectionMatch) {
        if (request.method === 'GET') {
          return sendJson(response, 200, await aiConversationStorage.getConversationState(user.uid, bookId));
        }
        if (request.method === 'POST') {
          const body = await readJsonBody(request);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw Object.assign(new Error('Invalid conversation title'), { code: 'INVALID_CONVERSATION_TITLE' });
          }
          return sendJson(response, 201, await aiConversationStorage.createConversation(user.uid, bookId, {
            title: body.title
          }));
        }
      } else if (aiConversationMessagesMatch) {
        if (request.method === 'DELETE') {
          return sendJson(response, 200, await aiConversationStorage.clearConversation(
            user.uid,
            bookId,
            aiConversationMessagesMatch[2]
          ));
        }
      } else {
        if (request.method === 'GET') {
          const conversation = await aiConversationStorage.getConversation(
            user.uid,
            bookId,
            aiConversationItemMatch[2]
          );
          if (conversationBook.type !== 'pdf') return sendJson(response, 200, conversation);
          const currentFingerprint = await currentPdfFingerprint(conversationBook).catch(() => null);
          return sendJson(response, 200, pdfConversationWithSourceValidity(
            conversation, currentFingerprint === conversationBook.fingerprint ? currentFingerprint : null
          ));
        }
        if (request.method === 'DELETE') {
          return sendJson(response, 200, await aiConversationStorage.deleteConversation(
            user.uid,
            bookId,
            aiConversationItemMatch[2]
          ));
        }
      }
      return sendError(response, 405, 'Method not allowed');
    } catch (error) {
      return aiConversationError(response, error);
    }
  }

  const aiSearchMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/ai/search$`));
  if (request.method === 'POST' && aiSearchMatch) {
    const book = await findBook(aiSearchMatch[1]);
    if (book.type === 'pdf') return handlePdfAiSearch(request, response, aiSearchMatch[1], await readJsonBody(request));
    const body = await readJsonBody(request);
    const question = String(body.question || '').trim();
    const selectedText = String(body.selectedText || '').trim();
    if (!question || question.length > 4000) return sendError(response, 400, '检索问题无效');
    if (selectedText.length > 12000) return sendError(response, 400, '选中文本过长');
    const intent = effectiveAiIntent(question, selectedText);
    const chapterIndex = Number.isInteger(body.chapter?.index) ? body.chapter.index : null;
    let chapterResolution = null;
    let logicalChapterId = null;
    let logicalSectionId = null;
    if (intent.scope === 'chapter' || intent.scope === 'section') {
      chapterResolution = await resolveBookPosition(book, DATA_ROOT, body.chapter || null);
      logicalChapterId = chapterResolution.status === 'resolved' ? chapterResolution.chapterId : null;
      logicalSectionId = intent.scope === 'section' && chapterResolution.status === 'resolved'
        ? chapterResolution.sectionId
        : null;
      if (!logicalChapterId || (intent.scope === 'section' && !logicalSectionId)) {
        return sendJson(response, 200, {
          available: true,
          matches: [],
          confidence: { level: 'none', guarded: true, reason: 'insufficient-scope', message: '无法确认当前章节范围。' },
          intent: intent.intent,
          scope: intent.scope,
          scopeConfidence: 'unresolved',
          coverage: { mode: 'unavailable', totalChunks: 0, selectedChunks: 0, coveredRegions: [], ratio: 0 },
          retrievalStatus: 'insufficient_scope',
          chapterResolution
        });
      }
    }
    const result = await searchAiBook(book, DATA_ROOT, {
      query: question,
      selectedText,
      currentChapterIndex: chapterIndex,
      logicalChapterId,
      logicalSectionId,
      intent: intent.intent,
      limit: 6
    });
    return sendJson(response, 200, {
      ...result,
      intent: intent.intent,
      scope: intent.scope,
      scopeConfidence: chapterResolution?.mappingQuality || intent.scopeConfidence,
      chapterResolution
    });
  }

  // 导读图: status and outline, start generating, cancel.
  const aiMapMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/ai/map(/job)?$`));
  if (aiMapMatch) {
    const book = await findBook(aiMapMatch[1]);
    if (book.type === 'pdf') {
      if (!pdfReaderEnabled()) return sendError(response, 404, 'PDF 阅读尚未启用');
      await ensurePdfOutline(book);
    }
    const service = getBookMapService();
    const vectorSettings = embeddingSettings(await aiConfigStorage.get(user.uid), process.env);
    const mapStatus = async () => ({
      ...(await service.status(book)),
      vectors: await getEmbeddingService().status(book, vectorSettings).catch(() => ({ state: 'off' }))
    });
    if (aiMapMatch[2]) {
      if (request.method !== 'DELETE') return sendError(response, 405, 'Method not allowed');
      service.cancel(book.id);
      return sendJson(response, 200, await mapStatus());
    }
    if (request.method === 'GET') return sendJson(response, 200, await mapStatus());
    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      const savedConfig = await aiConfigStorage.get(user.uid);
      if (!publicAiConfig(savedConfig, process.env).configured) return sendError(response, 503, 'AI 服务尚未配置');
      if (!service.isRunning(book.id)) {
        service.run(book, { savedConfig, env: process.env, force: body?.force === true })
          .catch((error) => { if (error.code !== 'AI_ABORTED') recordError(error, { operation: 'ai-book-map', bookId: book.id, code: error.code || null }); });
      }
      return sendJson(response, 202, await mapStatus());
    }
    return sendError(response, 405, 'Method not allowed');
  }

  // Semantic index (向量): start building or stop.
  const aiVectorsMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/ai/vectors(/job)?$`));
  if (aiVectorsMatch) {
    const book = await findBook(aiVectorsMatch[1]);
    if (book.type === 'pdf' && !pdfReaderEnabled()) return sendError(response, 404, 'PDF 阅读尚未启用');
    const settings = embeddingSettings(await aiConfigStorage.get(user.uid), process.env);
    if (!settings.configured) return sendError(response, 503, '尚未配置嵌入模型');
    const service = getEmbeddingService();
    if (aiVectorsMatch[2]) {
      if (request.method !== 'DELETE') return sendError(response, 405, 'Method not allowed');
      service.cancel(book.id);
    } else if (request.method === 'POST') {
      if (!service.isRunning(book.id)) {
        service.run(book, settings).catch((error) => {
          if (error.code !== 'AI_ABORTED') recordError(error, { operation: 'ai-vectors', bookId: book.id, code: error.code || null });
        });
      }
    } else {
      return sendError(response, 405, 'Method not allowed');
    }
    return sendJson(response, request.method === 'POST' ? 202 : 200, await service.status(book, settings));
  }

  const aiStreamMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/ai/ask/stream$`));
  if (request.method === 'POST' && aiStreamMatch) {
    const book = await findBook(aiStreamMatch[1]);
    const body = await readJsonBody(request);
    if (body?.mode === 'planned') return handlePlannedAiStream(request, response, user, book, aiStreamMatch[1], body);
    if (book.type === 'pdf') return handlePdfAiStream(request, response, user, aiStreamMatch[1], body);
    const conversationId = body?.conversationId ? String(body.conversationId) : '';
    let input;
    try {
      input = validateAiRequest(body, {
        allowEmptyContext: isAiChapterUnderstandingEnabled()
          && classifyAiIntent({ question: body?.question, selectedText: body?.selectedText }).intent === 'book_summary'
      });
    } catch (error) {
      throw Object.assign(error, { statusCode: 400 });
    }
    await validateAiBookContext(book, input);
    const chapterResolution = await resolveAiInputChapter(book, input);
    const savedConfig = await aiConfigStorage.get(user.uid);
    const config = publicAiConfig(savedConfig, process.env);
    if (!config.configured) return sendError(response, 503, 'AI 服务尚未配置');

    const requestIntent = effectiveAiIntent(input.question, input.selectedText);
    let chapterSummaryPlan = null;
    let chapterSummaryEvidence = null;
    let bookSummaryEvidence = null;
    if (requestIntent.intent === 'chapter_summary') {
      if (chapterResolution.status !== 'resolved' || !chapterResolution.chapterId) {
        return sendError(response, 409, '无法确认当前章节范围，请跳转到明确的章节标题后重试。');
      }
      chapterSummaryEvidence = await readChapterEvidence(book, DATA_ROOT, chapterResolution.chapterId);
      if (!chapterSummaryEvidence.available || chapterSummaryEvidence.truncated || !chapterSummaryEvidence.chunks.length) {
        return sendError(response, chapterSummaryEvidence.truncated ? 413 : 409, chapterSummaryEvidence.truncated
          ? '本章内容超出安全读取上限，请缩小范围后重试。'
          : '当前章节没有可用的原文证据。');
      }
      try {
        chapterSummaryPlan = planChapterSummary(chapterSummaryEvidence.chunks);
      } catch (error) {
        return sendError(response, error.statusCode || 413, error.message || '本章超出 AI 概述预算，请缩小范围后重试。');
      }
      input.context = chapterSummaryPlan.mapTasks.map((task) => ({
        text: task.text,
        chapterIndex: task.chapterIndex,
        chapterHref: task.chapterHref,
        chapterLabel: task.chapterLabel,
        startOffset: task.start
      }));
    } else if (requestIntent.intent === 'book_summary') {
      bookSummaryEvidence = await prepareBookSummary(book, user.uid, input.question, config);
      if (bookSummaryEvidence.error) return sendError(response, bookSummaryEvidence.error.statusCode || 413, bookSummaryEvidence.error.message);
      chapterSummaryPlan = bookSummaryEvidence.plan;
      input.scope = 'book';
      input.context = chapterSummaryPlan.mapTasks.map((task) => ({
        text: task.text, chapterIndex: task.chapterIndex, chapterHref: task.chapterHref,
        chapterLabel: task.chapterLabel, startOffset: task.start
      }));
    }

    const abortController = new AbortController();
    const abortOnClientClose = () => abortController.abort();
    request.once('aborted', abortOnClientClose);
    response.once('close', () => {
      if (!response.writableEnded) abortController.abort();
    });

    sendSseHeaders(response);
    sendSseEvent(response, 'meta', {
      sources: aiSourcesFromContext(input.context),
      model: config.model,
      chapterResolution,
      ...(chapterSummaryPlan ? {
        summaryMode: chapterSummaryPlan.mode,
        scope: bookSummaryEvidence ? 'book' : 'chapter',
        coverage: chapterSummaryPlan.coverage,
        estimatedSourceChars: chapterSummaryPlan.totalSourceChars,
        estimatedInputTokens: chapterSummaryPlan.estimatedInputTokens
      } : {})
    });
    try {
      const result = chapterSummaryPlan
        ? await getOrCreateChapterSummary({
          book,
          dataRoot: DATA_ROOT,
          userId: user.uid,
          logicalChapterId: bookSummaryEvidence ? '__book_summary__' : chapterResolution.chapterId,
          bookFingerprint: (bookSummaryEvidence || chapterSummaryEvidence).bookFingerprint,
          parserVersion: (bookSummaryEvidence || chapterSummaryEvidence).parserVersion,
          baseUrl: config.baseUrl,
          model: config.model,
          cachePurpose: bookSummaryEvidence ? 'book-summary' : 'chapter-summary',
          build: () => requestOpenAiChapterSummary({
            request: { ...input, scope: bookSummaryEvidence ? 'book' : 'chapter' },
            plan: chapterSummaryPlan,
            env: process.env,
            savedConfig,
            signal: abortController.signal,
            mapTaskCache: (task, build) => getOrCreateChapterSummarySegment({
              book,
              dataRoot: DATA_ROOT,
              userId: user.uid,
              logicalChapterId: task.logicalChapterId || chapterResolution.chapterId,
              parserVersion: (bookSummaryEvidence || chapterSummaryEvidence).parserVersion,
              baseUrl: config.baseUrl,
              model: config.model,
              task,
              build
            })
          })
        })
        : await requestOpenAiStream({
          request: input,
          env: process.env,
          savedConfig,
          signal: abortController.signal,
          onEvent: async (event) => {
            const delta = event?.type === 'response.output_text.delta' && typeof event.delta === 'string'
              ? event.delta
              : '';
            if (delta) sendSseEvent(response, 'delta', { delta });
          }
        });
      if (chapterSummaryPlan && result.answer) sendSseEvent(response, 'delta', { delta: result.answer });
      const done = {
        answer: result.answer,
        responseId: result.responseId,
        streamed: result.streamed ?? false,
        sources: aiSourcesFromContext(input.context),
        ...(result.usage ? { usage: result.usage } : {})
      };
      if (chapterSummaryPlan) {
        done.summaryCacheHit = result.cacheHit;
        done.summaryMode = chapterSummaryPlan.mode;
        done.coverage = chapterSummaryPlan.coverage;
        done.scope = bookSummaryEvidence ? 'book' : 'chapter';
        done.summaryConfidence = assessSummaryConfidence({
          mappingQuality: bookSummaryEvidence ? chapterSummaryPlan.coverage.mappingQuality : chapterResolution.mappingQuality,
          coverage: chapterSummaryPlan.coverage,
          sourceIntegrity: true,
          citationIntegrity: result.citationIntegrity === true
        });
      }
      if (conversationId && !abortController.signal.aborted && !request.aborted) {
        try {
          await aiConversationStorage.appendCompletedTurn(user.uid, aiStreamMatch[1], conversationId, {
            question: input.question,
            answer: result.answer,
            sources: aiPersistenceSources(input.context)
          });
          done.persisted = true;
        } catch (error) {
          done.persisted = false;
          done.persistenceErrorCode = aiConversationPersistenceErrorCode(error);
          recordError(error, {
            operation: 'ai-conversation-persist',
            bookId: aiStreamMatch[1],
            code: done.persistenceErrorCode
          });
        }
      }
      sendSseEvent(response, 'done', done);
    } catch (error) {
      if (error.code !== 'AI_ABORTED' && !response.destroyed) {
        recordError(error, { operation: 'ai-stream', bookId: aiStreamMatch[1], code: error.code || null });
        sendSseEvent(response, 'error', {
          code: error.code || 'AI_STREAM_FAILED',
          message: aiUserError(error)
        });
      }
    } finally {
      request.removeListener('aborted', abortOnClientClose);
      if (!response.writableEnded) response.end();
    }
    return;
  }

  const aiMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/ai/ask$`));
  if (request.method === 'POST' && aiMatch) {
    const book = await findBook(aiMatch[1]);
    if (book.type === 'pdf') return handlePdfAiAnswer(request, response, user, aiMatch[1], await readJsonBody(request));
    const body = await readJsonBody(request);
    let input;
    try {
      input = validateAiRequest(body, {
        allowEmptyContext: isAiChapterUnderstandingEnabled()
          && classifyAiIntent({ question: body?.question, selectedText: body?.selectedText }).intent === 'book_summary'
      });
    } catch (error) {
      throw Object.assign(error, { statusCode: 400 });
    }
    await validateAiBookContext(book, input);
    const chapterResolution = await resolveAiInputChapter(book, input);
    const savedConfig = await aiConfigStorage.get(user.uid);
    const config = publicAiConfig(savedConfig, process.env);
    if (!config.configured) return sendError(response, 503, 'AI 服务尚未配置');

    const requestIntent = effectiveAiIntent(input.question, input.selectedText);
    let chapterSummaryPlan = null;
    let chapterSummaryEvidence = null;
    let bookSummaryEvidence = null;
    if (requestIntent.intent === 'chapter_summary') {
      if (chapterResolution.status !== 'resolved' || !chapterResolution.chapterId) {
        return sendError(response, 409, '无法确认当前章节范围，请跳转到明确的章节标题后重试。');
      }
      chapterSummaryEvidence = await readChapterEvidence(book, DATA_ROOT, chapterResolution.chapterId);
      if (!chapterSummaryEvidence.available || chapterSummaryEvidence.truncated || !chapterSummaryEvidence.chunks.length) {
        return sendError(response, chapterSummaryEvidence.truncated ? 413 : 409, chapterSummaryEvidence.truncated
          ? '本章内容超出安全读取上限，请缩小范围后重试。'
          : '当前章节没有可用的原文证据。');
      }
      try {
        chapterSummaryPlan = planChapterSummary(chapterSummaryEvidence.chunks);
      } catch (error) {
        return sendError(response, error.statusCode || 413, error.message || '本章超出 AI 概述预算，请缩小范围后重试。');
      }
      input.context = chapterSummaryPlan.mapTasks.map((task) => ({
        text: task.text,
        chapterIndex: task.chapterIndex,
        chapterHref: task.chapterHref,
        chapterLabel: task.chapterLabel,
        startOffset: task.start
      }));
    } else if (requestIntent.intent === 'book_summary') {
      bookSummaryEvidence = await prepareBookSummary(book, user.uid, input.question, config);
      if (bookSummaryEvidence.error) return sendError(response, bookSummaryEvidence.error.statusCode || 413, bookSummaryEvidence.error.message);
      chapterSummaryPlan = bookSummaryEvidence.plan;
      input.scope = 'book';
      input.context = chapterSummaryPlan.mapTasks.map((task) => ({
        text: task.text,
        chapterIndex: task.chapterIndex,
        chapterHref: task.chapterHref,
        chapterLabel: task.chapterLabel,
        startOffset: task.start
      }));
    }

    try {
      const summaryResult = chapterSummaryPlan
        ? await getOrCreateChapterSummary({
          book,
          dataRoot: DATA_ROOT,
          userId: user.uid,
          logicalChapterId: bookSummaryEvidence ? '__book_summary__' : chapterResolution.chapterId,
          bookFingerprint: (bookSummaryEvidence || chapterSummaryEvidence).bookFingerprint,
          parserVersion: (bookSummaryEvidence || chapterSummaryEvidence).parserVersion,
          baseUrl: config.baseUrl,
          model: config.model,
          cachePurpose: bookSummaryEvidence ? 'book-summary' : 'chapter-summary',
          build: () => requestOpenAiChapterSummary({
            request: { ...input, scope: bookSummaryEvidence ? 'book' : 'chapter' },
            plan: chapterSummaryPlan,
            env: process.env,
            savedConfig,
            mapTaskCache: (task, build) => getOrCreateChapterSummarySegment({
              book,
              dataRoot: DATA_ROOT,
              userId: user.uid,
              logicalChapterId: task.logicalChapterId || chapterResolution.chapterId,
              parserVersion: (bookSummaryEvidence || chapterSummaryEvidence).parserVersion,
              baseUrl: config.baseUrl,
              model: config.model,
              task,
              build
            })
          })
        })
        : null;
      const answer = summaryResult?.answer
        || await requestOpenAiAnswer({ request: input, env: process.env, savedConfig });
      const sources = aiSourcesFromContext(input.context);
      return sendJson(response, 200, {
        answer,
        sources,
        chapterResolution,
        ...(chapterSummaryPlan ? {
          summaryMode: chapterSummaryPlan.mode,
          scope: bookSummaryEvidence ? 'book' : 'chapter',
          coverage: chapterSummaryPlan.coverage,
          estimatedSourceChars: chapterSummaryPlan.totalSourceChars,
          estimatedInputTokens: chapterSummaryPlan.estimatedInputTokens,
          summaryCacheHit: summaryResult.cacheHit,
          summaryConfidence: assessSummaryConfidence({
            mappingQuality: bookSummaryEvidence ? chapterSummaryPlan.coverage.mappingQuality : chapterResolution.mappingQuality,
            coverage: chapterSummaryPlan.coverage,
            sourceIntegrity: true,
            citationIntegrity: summaryResult.citationIntegrity === true
          })
        } : {})
      });
    } catch (error) {
      recordError(error, { operation: 'ai-answer', bookId: aiMatch[1], code: error.code || null });
      return sendError(response, error.statusCode || 502, aiUserError(error));
    }
  }

  const contentMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/content$`));

  const pdfAnnotationCollectionMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/pdf-annotations$`));
  const pdfAnnotationItemMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/pdf-annotations/([0-9a-f-]{36})$`));
  if (pdfAnnotationCollectionMatch || pdfAnnotationItemMatch) {
    const match = pdfAnnotationCollectionMatch || pdfAnnotationItemMatch;
    const bookId = match[1];
    const annotationId = pdfAnnotationItemMatch?.[2] || '';
    const isCollection = Boolean(pdfAnnotationCollectionMatch);
    if ((isCollection && !['GET', 'POST'].includes(request.method))
      || (!isCollection && !['PATCH', 'DELETE'].includes(request.method))) {
      return sendError(response, 405, 'Method not allowed');
    }

    try {
      const book = await findBook(bookId, { requirePathIdentity: true });
      if (book.type !== 'pdf') return sendError(response, 415, 'PDF annotations require a PDF book');
      if (!pdfReaderEnabled()) return sendError(response, 404, 'PDF reading is disabled');

      if (request.method === 'DELETE') {
        const result = await storage.deletePdfAnnotation(user.uid, bookId, annotationId);
        return sendJson(response, 200, result);
      }

      const currentFingerprint = await currentPdfFingerprint(book);
      const sourceMatchesIndex = Boolean(currentFingerprint
        && /^[a-f0-9]{64}$/.test(String(book.fingerprint || ''))
        && currentFingerprint === book.fingerprint);

      if (request.method === 'GET') {
        const annotations = await storage.listPdfAnnotations(user.uid, bookId);
        return sendJson(response, 200, {
          annotations: annotations.map((annotation) => ({
            ...annotation,
            sourceStale: !sourceMatchesIndex || annotation.sourceFingerprint !== book.fingerprint
          }))
        });
      }

      if (!sourceMatchesIndex) {
        return sendError(response, 409, 'PDF source changed; rescan the library before creating or editing annotations');
      }

      if (request.method === 'POST') {
        const body = await readJsonBody(request);
        const annotation = await storage.createPdfAnnotation(user.uid, bookId, body, book.fingerprint);
        return sendJson(response, 200, { annotation });
      }

      const saved = (await storage.listPdfAnnotations(user.uid, bookId)).find((item) => item.id === annotationId);
      if (!saved) return sendError(response, 404, 'PDF annotation not found');
      if (saved.sourceFingerprint !== book.fingerprint) {
        return sendError(response, 409, 'PDF source changed; stale annotations cannot be edited');
      }
      const body = await readJsonBody(request);
      const annotation = await storage.updatePdfAnnotation(user.uid, bookId, annotationId, body);
      return sendJson(response, 200, { annotation });
    } catch (error) {
      if (error.statusCode) return sendError(response, error.statusCode, error.message);
      if (error.code === 'ELOOP') return sendError(response, 409, 'PDF source is no longer a regular authorized file');
      throw error;
    }
  }

  if (['GET', 'HEAD'].includes(request.method) && contentMatch) {
    const book = await findBook(contentMatch[1], { requirePathIdentity: true });
    if (book.type === 'pdf') {
      if (!pdfReaderEnabled()) return sendError(response, 404, 'PDF reading is disabled');
      return servePdfContent(request, response, book);
    }
    if (request.method === 'HEAD') return sendError(response, 405, 'Method not allowed');
    const raw = await fs.readFile(book.path);
    // Text books are sent as UTF-8 whatever encoding the file uses.
    const data = book.type === 'epub' ? raw : Buffer.from(decodeBookText(raw).text, 'utf8');
    const type = book.type === 'epub' ? 'application/epub+zip' : 'text/plain; charset=utf-8';
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return response.end(data);
  }

  const coverMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/cover$`));
  if (request.method === 'GET' && coverMatch) {
    await findBook(coverMatch[1], { allowMobiMetadata: true });
    const entries = await fs.readdir(path.join(DATA_ROOT, 'covers')).catch(() => []);
    const name = entries.find((entry) => entry.startsWith(coverMatch[1]));
    if (!name) return sendError(response, 404, 'Cover not found');
    const file = path.join(DATA_ROOT, 'covers', name);
    const data = await fs.readFile(file);
    const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    response.writeHead(200, {
      'Content-Type': types[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    });
    return response.end(data);
  }

  return sendError(response, 404, 'API route not found');
}

let directAccess = null;

async function handleRequest(request, response) {
  try {
    directAccess?.recordGatewayUser(request);
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(APP_PREFIX)) return sendError(response, 404, 'Route not found');
    if (url.pathname.startsWith(`${APP_PREFIX}/api/`)) {
      return await handleApi(request, response, url.pathname, url.searchParams);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendError(response, 405, 'Method not allowed');
    return await serveStatic(request, response, url.pathname);
  } catch (error) {
    if (response.destroyed || response.writableEnded) return;
    if (error.code === 'ENOENT') return sendError(response, 404, 'Not found');
    recordError(error, { method: request.method, url: request.url });
    console.error(error);
    if (error.statusCode && error.publicCode) {
      return sendJson(response, error.statusCode, { error: error.message, code: error.publicCode });
    }
    return sendError(response, error.statusCode || 500, error.statusCode ? error.message : 'Internal server error');
  }
}

// The host's folder grant at start-up (on fnOS: the start-time
// authorization replaces a stale snapshot; see platform/fnos.js).
function syncFnOSAuthorizationAtStart() {
  try {
    platform.syncAtStart(CONFIG_ROOT);
  } catch (error) {
    recordError(error, { operation: 'sync-fnos-authorization' });
  }
}

async function start() {
  await storage.initialize();
  syncFnOSAuthorizationAtStart();
  await loadConfiguration();
  if (process.platform !== 'win32' && !process.env.ZHENSHU_DEV_PORT) await fs.rm(SOCKET_PATH, { force: true });

  const server = http.createServer((request, response) => void handleRequest(request, response));
  directAccess = createDirectAccess({ configRoot: CONFIG_ROOT, appPrefix: APP_PREFIX, handleRequest });
  directAccess.start();
  let shuttingDown = false;
  const removeSocket = async () => {
    if (!process.env.ZHENSHU_DEV_PORT && process.platform !== 'win32') {
      await fs.rm(SOCKET_PATH, { force: true }).catch(() => {});
    }
  };
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(async () => {
      await removeSocket();
      process.exit(1);
    }, 10000);
    forceExit.unref();
    void directAccess?.close();
    server.close(async () => {
      clearTimeout(forceExit);
      await removeSocket();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.on('close', () => void removeSocket());

  if (process.env.ZHENSHU_DEV_PORT) {
    const port = Number(process.env.ZHENSHU_DEV_PORT);
    server.listen(port, '127.0.0.1', () => console.log(`枕书 fnOS development server: http://127.0.0.1:${port}${APP_PREFIX}/`));
  } else {
    server.listen(SOCKET_PATH, async () => {
      await fs.chmod(SOCKET_PATH, 0o660).catch(() => {});
      console.log(`枕书 fnOS listening on ${SOCKET_PATH}`);
    });
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { APP_PREFIX, CSP, gatewayUser, handleRequest, loadConfiguration, parseFnOSPathList, start, syncFnOSAuthorizationAtStart };
