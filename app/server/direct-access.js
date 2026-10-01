'use strict';

// Optional direct-port listener. It serves the same /app/zhenshu/ paths as the
// fnOS gateway socket, but the gateway is not in front of it: nobody has been
// signed in and any x-trim-* identity header comes from the client. So this
// listener strips those headers, asks for the access password, and then reads
// the library as the one fnOS user chosen in app settings.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { directAccessRevision, readDirectAccessConfig, verifyPassword } = require('./direct-access-config');

const DIRECT_REQUEST = Symbol('zhenshu.directRequest');
const COOKIE_NAME = 'zhenshu_direct';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_BODY = 4096;
const USERS_FILE = 'gateway-users.json';
const MAX_USERS = 256;

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function page({ title, message = '', tone = '', form = null }) {
  const formHtml = form ? `
    <form method="post" action="${escapeHtml(form.action)}">
      <input type="hidden" name="next" value="${escapeHtml(form.next)}">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus maxlength="128">
      <button type="submit">进入书房</button>
    </form>` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · 枕书</title>
<style>
:root{color-scheme:light dark;--bg:#f6f1e8;--card:#fffdf8;--ink:#2b2420;--muted:#7a6e64;--line:#e6dccd;--accent:#d9773a;--warn:#b4442f}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--card:#26221f;--ink:#efe7dc;--muted:#a89c90;--line:#3a332e;--accent:#f08a3c;--warn:#f0907c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif}
main{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px 24px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
h1{margin:0 0 4px;font:600 22px/1.3 "Noto Serif SC","Songti SC",serif;letter-spacing:.08em}p{margin:0 0 18px;color:var(--muted)}
p.notice{color:var(--warn)}label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
input{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:16px;width:100%;font:inherit;font-weight:600;padding:10px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}
</style></head><body><main>
<h1>枕书</h1>
<p class="${tone === 'warning' ? 'notice' : ''}">${escapeHtml(message || '请输入访问密码。')}</p>${formHtml}
</main></body></html>`;
}

function sendPage(response, status, options, extraHeaders = {}) {
  const body = Buffer.from(page(options));
  response.writeHead(status, { ...PAGE_HEADERS, 'Content-Length': body.length, ...extraHeaders });
  response.end(body);
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function redirect(response, location, extraHeaders = {}) {
  response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...extraHeaders });
  response.end();
}

function readCookie(request, name) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}

function sessionSignature(config, expires) {
  return crypto.createHmac('sha256', Buffer.from(config.secret, 'base64'))
    .update(`${expires}.${config.username}.${config.hash}`).digest('base64url');
}

function createSessionToken(config, now = Date.now()) {
  const expires = now + SESSION_MS;
  return `${expires}.${sessionSignature(config, expires)}`;
}

function verifySessionToken(config, token, now = Date.now()) {
  const match = /^([0-9]{1,16})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!config || !match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + SESSION_MS) return false;
  const expected = Buffer.from(sessionSignature(config, expires));
  const actual = Buffer.from(match[2]);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safeNext(value, appPrefix) {
  const text = String(value || '');
  if (!text.startsWith(`${appPrefix}/`) || text.startsWith('//') || /[\\\x00-\x1f]/.test(text)) return `${appPrefix}/`;
  if (text.startsWith(`${appPrefix}/__direct/`)) return `${appPrefix}/`;
  return text;
}

function readFormBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_LOGIN_BODY) {
        reject(Object.assign(new Error('Login form is too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
    request.on('error', reject);
  });
}

function createDirectAccess({ configRoot, appPrefix, handleRequest, pollMs = 5000, log = console }) {
  let config = null;
  let revision = null;
  let server = null;
  let listeningPort = null;
  let lastError = '';
  let timer = null;
  const failures = new Map();
  const usersFile = path.join(configRoot, USERS_FILE);
  let users = loadUsers();

  function loadUsers() {
    try {
      const data = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  // Remembers which fnOS uid belongs to which username, as told by the
  // gateway. The direct port can only read as a user fnOS has vouched for.
  function recordGatewayUser(request) {
    if (request[DIRECT_REQUEST]) return;
    const uid = request.headers['x-trim-userid'];
    const username = request.headers['x-trim-username'];
    if (!uid || !username || String(uid).length > 128 || String(username).length > 64) return;
    if (users[username]?.uid === String(uid)) return;
    const next = { ...users, [username]: { uid: String(uid) } };
    if (Object.keys(next).length > MAX_USERS) return;
    users = next;
    try {
      fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
      const temporary = `${usersFile}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(users)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, usersFile);
    } catch (error) {
      log.warn?.(`枕书 direct access: unable to record gateway user (${error.code || 'error'})`);
    }
  }

  function tooManyFailures(ip, now = Date.now()) {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt <= now) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  function noteFailure(ip, now = Date.now()) {
    const entry = failures.get(ip);
    if (!entry || entry.resetAt <= now) failures.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
    else entry.count += 1;
    if (failures.size > 10000) failures.clear();
  }

  const loginPath = `${appPrefix}/__direct/login`;
  const logoutPath = `${appPrefix}/__direct/logout`;
  const cookieBase = `${COOKIE_NAME}=; Path=${appPrefix}/; HttpOnly; SameSite=Strict`;

  async function handleLogin(request, response, url) {
    const ip = request.socket.remoteAddress || 'unknown';
    if (request.method === 'GET') {
      return sendPage(response, 200, { title: '登录', form: { action: loginPath, next: safeNext(url.searchParams.get('next'), appPrefix) } });
    }
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    const origin = request.headers.origin;
    let originHost = request.headers.host;
    try { if (origin && origin !== 'null') originHost = new URL(origin).host; } catch { originHost = ''; }
    if (originHost !== request.headers.host) {
      return sendJson(response, 403, { error: 'Cross-site login is not allowed' });
    }
    if (tooManyFailures(ip)) {
      return sendPage(response, 429, { title: '稍后再试', tone: 'warning', message: '密码错误次数过多，请 15 分钟后再试。' });
    }
    const form = await readFormBody(request);
    const next = safeNext(form.get('next'), appPrefix);
    if (!await verifyPassword(config, form.get('password') || '')) {
      noteFailure(ip);
      return sendPage(response, 401, { title: '登录', tone: 'warning', message: '密码不正确，请重试。', form: { action: loginPath, next } });
    }
    failures.delete(ip);
    const cookie = `${COOKIE_NAME}=${createSessionToken(config)}; Path=${appPrefix}/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
    return redirect(response, next, { 'Set-Cookie': cookie });
  }

  async function handle(request, response) {
    try {
      for (const name of Object.keys(request.headers)) {
        if (name.startsWith('x-trim-')) delete request.headers[name];
      }
      request[DIRECT_REQUEST] = true;
      const url = new URL(request.url, 'http://direct.invalid');
      if (!config?.enabled) return sendJson(response, 503, { error: 'Direct access is disabled' });
      if (url.pathname === '/' || url.pathname === appPrefix) return redirect(response, `${appPrefix}/`);
      if (url.pathname === loginPath) return await handleLogin(request, response, url);
      if (url.pathname === logoutPath) {
        return redirect(response, loginPath, { 'Set-Cookie': `${cookieBase}; Max-Age=0` });
      }
      if (!url.pathname.startsWith(`${appPrefix}/`)) return sendJson(response, 404, { error: 'Route not found' });

      if (!verifySessionToken(config, readCookie(request, COOKIE_NAME))) {
        if (url.pathname.startsWith(`${appPrefix}/api/`)) return sendJson(response, 401, { error: '请先输入直连访问密码' });
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 401, { error: 'Login required' });
        return redirect(response, `${loginPath}?next=${encodeURIComponent(url.pathname + url.search)}`);
      }

      const user = users[config.username];
      if (!user?.uid) {
        const message = `还没有找到飞牛用户“${config.username}”。请先用该账号在飞牛桌面打开一次枕书，然后刷新本页。`;
        if (url.pathname.startsWith(`${appPrefix}/api/`)) return sendJson(response, 503, { error: message });
        return sendPage(response, 503, { title: '等待绑定用户', tone: 'warning', message });
      }
      request.headers['x-trim-userid'] = user.uid;
      request.headers['x-trim-username'] = config.username;
      // Administrator actions (library scans, imports) stay on the fnOS gateway.
      request.headers['x-trim-isadmin'] = 'false';
      return await handleRequest(request, response);
    } catch (error) {
      if (response.headersSent || response.writableEnded) return;
      sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error' });
    }
  }

  function stopListener() {
    if (!server) return Promise.resolve();
    const closing = server;
    server = null;
    listeningPort = null;
    return new Promise((resolve) => {
      closing.close(() => resolve());
      closing.closeAllConnections?.();
    });
  }

  async function reconcile() {
    const nextRevision = directAccessRevision(configRoot);
    if (nextRevision !== revision) {
      revision = nextRevision;
      config = readDirectAccessConfig(configRoot);
      users = loadUsers();
    }
    const wantedPort = config?.enabled ? config.port : null;
    if (wantedPort === listeningPort && (server || !wantedPort)) return;
    await stopListener();
    if (!wantedPort) {
      lastError = '';
      return;
    }
    const candidate = http.createServer((request, response) => void handle(request, response));
    await new Promise((resolve) => {
      candidate.once('error', (error) => {
        // Keep polling: once the port frees up or settings change we retry.
        const message = `枕书 direct access: cannot listen on port ${wantedPort} (${error.code || 'error'})`;
        if (message !== lastError) log.error?.(message);
        lastError = message;
        resolve();
      });
      candidate.listen(wantedPort, process.env.ZHENSHU_DIRECT_HOST || '0.0.0.0', () => {
        server = candidate;
        listeningPort = wantedPort;
        lastError = '';
        log.log?.(`枕书 direct access listening on port ${wantedPort}`);
        resolve();
      });
    });
  }

  function start() {
    const tick = () => reconcile().catch((error) => log.error?.(error));
    tick();
    timer = setInterval(tick, pollMs);
    timer.unref();
  }

  async function close() {
    if (timer) clearInterval(timer);
    timer = null;
    await stopListener();
  }

  return { start, close, reconcile, recordGatewayUser, handle, get port() { return listeningPort; } };
}

module.exports = {
  COOKIE_NAME,
  DIRECT_REQUEST,
  createDirectAccess,
  createSessionToken,
  safeNext,
  verifySessionToken
};
