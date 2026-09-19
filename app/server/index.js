'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { UserStorage, readJson } = require('./storage');
const { scanLibrary } = require('./library');
const { resolveAuthorizedPath } = require('./security');

const APP_PREFIX = '/app/babyreader-fnos';
const APP_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.join(APP_ROOT, 'ui');
const DATA_ROOT = path.resolve(process.env.TRIM_PKGVAR || path.join(APP_ROOT, '..', '.runtime', 'var'));
const CONFIG_ROOT = path.resolve(process.env.TRIM_PKGETC || path.join(APP_ROOT, '..', '.runtime', 'etc'));
const SOCKET_PATH = process.env.BABYREADER_SOCKET || path.resolve(process.env.TRIM_APPDEST || path.join(APP_ROOT, '..'), 'app.sock');
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:";

const storage = new UserStorage(DATA_ROOT);
const STARTED_AT = new Date().toISOString();
let authorizedRoots = [];
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

async function runLibraryScan() {
  if (activeScan) return activeScan;

  const startedAt = new Date().toISOString();
  scanState = {
    status: 'running',
    startedAt,
    completedAt: null,
    error: null,
    result: null
  };

  activeScan = (async () => {
    try {
      await loadConfiguration();
      const previousIndex = await storage.getLibraryIndex();
      const index = await scanLibrary(authorizedRoots, {
        coverDirectory: path.join(DATA_ROOT, 'covers'),
        previousIndex
      });
      await storage.saveLibraryIndex(index);
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
  })();

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

function gatewayUser(request) {
  let uid = request.headers['x-trim-userid'];
  let username = request.headers['x-trim-username'];
  let isAdmin = request.headers['x-trim-isadmin'] === 'true';

  if (!uid && process.env.NODE_ENV === 'development') {
    uid = process.env.BABYREADER_DEV_UID || 'development';
    username = process.env.BABYREADER_DEV_USERNAME || 'development';
    isAdmin = true;
  }
  if (!uid) throw Object.assign(new Error('Missing authenticated fnOS user context'), { statusCode: 401 });
  return { uid: String(uid), username: String(username || ''), isAdmin };
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

function publicBook(book) {
  if (!book || book.error) return book;
  const { path: ignoredPath, root: ignoredRoot, ...safe } = book;
  return safe;
}

function parseFnOSPathList(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function loadConfiguration() {
  const config = await readJson(path.join(CONFIG_ROOT, 'settings.json'), { libraryRoots: [] });
  const configured = Array.isArray(config.libraryRoots) ? config.libraryRoots : [];
  const fnOSAuthorized = parseFnOSPathList(process.env.TRIM_DATA_ACCESSIBLE_PATHS);
  const fnOSShared = parseFnOSPathList(process.env.TRIM_DATA_SHARE_PATHS);
  const candidates = [...new Set([...configured, ...fnOSAuthorized, ...fnOSShared].map((root) => String(root).trim()).filter(Boolean))];

  authorizedRoots = [];
  const rejectedRoots = [];
  for (const root of candidates) {
    try {
      const realRoot = await fs.realpath(root);
      const stat = await fs.stat(realRoot);
      if (!stat.isDirectory()) throw new Error('路径不是目录');
      await fs.access(realRoot);
      if (!authorizedRoots.includes(realRoot)) authorizedRoots.push(realRoot);
    } catch (error) {
      const detail = {
        root,
        error: String(error.message || error),
        code: error.code ? String(error.code) : null
      };
      rejectedRoots.push(detail);
      recordError(error, { operation: 'load-library-root', root });
    }
  }

  rootDiagnostics = {
    configuredRoots: configured,
    accessibleRoots: fnOSAuthorized,
    sharedRoots: fnOSShared,
    authorizedRoots: authorizedRoots.slice(),
    rejectedRoots
  };
  return rootDiagnostics;
}

async function findBook(bookId) {
  if (!/^[a-f0-9]{64}$/.test(bookId)) throw Object.assign(new Error('Invalid book ID'), { statusCode: 400 });
  const index = await storage.getLibraryIndex();
  const book = index.books.find((item) => item.id === bookId && !item.error);
  if (!book) throw Object.assign(new Error('Book not found'), { statusCode: 404 });
  book.path = await resolveAuthorizedPath(book.path, authorizedRoots);
  return book;
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
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
  };
  const bytes = await fs.readFile(candidate);
  // Revalidate every request for first-party assets. An FPK upgrade replaces
  // app.js/styles.css under the same URL, so a long max-age would leave the
  // browser running the previous build for an hour after an update — the UI
  // would silently keep the old behaviour. Vendor libs never change in place
  // and keep a long immutable cache.
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const isImmutable = relative.startsWith('lib/') || /\.(png|svg|woff2)$/i.test(relative);
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

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/health`) {
    return sendJson(response, 200, {
      status: 'ok',
      startedAt: STARTED_AT,
      uptimeSeconds: Math.floor(process.uptime()),
      scan: currentScanState()
    });
  }

  const user = gatewayUser(request);
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/session`) {
    return sendJson(response, 200, { uid: user.uid, username: user.username, isAdmin: user.isAdmin });
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/diagnostics`) {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
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
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/library`) {
    const index = await storage.getLibraryIndex();
    return sendJson(response, 200, {
      ...index,
      configured: authorizedRoots.length > 0,
      authorizedRootCount: authorizedRoots.length,
      scanState: currentScanState(),
      books: index.books.map(publicBook)
    });
  }
  if (request.method === 'POST' && pathname === `${APP_PREFIX}/api/library/scan`) {
    if (!user.isAdmin) return sendError(response, 403, 'Administrator access is required');
    const index = await runLibraryScan();
    return sendJson(response, 200, {
      ...index,
      configured: authorizedRoots.length > 0,
      authorizedRootCount: authorizedRoots.length,
      scanState: currentScanState(),
      books: index.books.map(publicBook)
    });
  }
  if (request.method === 'GET' && pathname === `${APP_PREFIX}/api/state`) {
    return sendJson(response, 200, await storage.getState(user.uid));
  }
  if (request.method === 'PUT' && pathname === `${APP_PREFIX}/api/settings`) {
    return sendJson(response, 200, await storage.updateSettings(user.uid, await readJsonBody(request)));
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

  const contentMatch = pathname.match(new RegExp(`^${APP_PREFIX}/api/books/([a-f0-9]{64})/content$`));
  if (request.method === 'GET' && contentMatch) {
    const book = await findBook(contentMatch[1]);
    const data = await fs.readFile(book.path);
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
    await findBook(coverMatch[1]);
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

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(APP_PREFIX)) return sendError(response, 404, 'Route not found');
    if (url.pathname.startsWith(`${APP_PREFIX}/api/`)) return await handleApi(request, response, url.pathname);
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendError(response, 405, 'Method not allowed');
    return await serveStatic(request, response, url.pathname);
  } catch (error) {
    if (error.code === 'ENOENT') return sendError(response, 404, 'Not found');
    recordError(error, { method: request.method, url: request.url });
    console.error(error);
    return sendError(response, error.statusCode || 500, error.statusCode ? error.message : 'Internal server error');
  }
}

async function start() {
  await storage.initialize();
  await loadConfiguration();
  if (process.platform !== 'win32' && !process.env.BABYREADER_DEV_PORT) await fs.rm(SOCKET_PATH, { force: true });

  const server = http.createServer((request, response) => void handleRequest(request, response));
  let shuttingDown = false;
  const removeSocket = async () => {
    if (!process.env.BABYREADER_DEV_PORT && process.platform !== 'win32') {
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
    server.close(async () => {
      clearTimeout(forceExit);
      await removeSocket();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.on('close', () => void removeSocket());

  if (process.env.BABYREADER_DEV_PORT) {
    const port = Number(process.env.BABYREADER_DEV_PORT);
    server.listen(port, '127.0.0.1', () => console.log(`BabyReader fnOS development server: http://127.0.0.1:${port}${APP_PREFIX}/`));
  } else {
    server.listen(SOCKET_PATH, async () => {
      await fs.chmod(SOCKET_PATH, 0o660).catch(() => {});
      console.log(`BabyReader fnOS listening on ${SOCKET_PATH}`);
    });
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { APP_PREFIX, CSP, gatewayUser, handleRequest, loadConfiguration, parseFnOSPathList, start };
