'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  applyDirectAccessSettings,
  readDirectAccessConfig,
  validatePort,
  verifyPassword
} = require('../app/server/direct-access-config');
const { COOKIE_NAME, createDirectAccess, createSessionToken, safeNext, verifySessionToken } = require('../app/server/direct-access');

const root = path.resolve(__dirname, '..');
const APP_PREFIX = '/app/zhenshu';

function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-direct-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('port validation rejects system ports, fnOS gateway ports and junk', () => {
  assert.equal(validatePort('8089'), 8089);
  for (const value of ['80', '5666', '5667', '70000', '80a', '', '-1']) {
    assert.throws(() => validatePort(value), undefined, value);
  }
});

test('settings store only a password hash and keep blank fields unchanged', async (t) => {
  const dir = sandbox(t);
  assert.equal(applyDirectAccessSettings(dir, { mode: 'off' }), null);
  assert.equal(fs.existsSync(path.join(dir, 'direct-access.json')), false);
  assert.throws(() => applyDirectAccessSettings(dir, { mode: 'on', port: '8089', username: 'reader' }), /访问密码/);

  applyDirectAccessSettings(dir, { mode: 'on', port: '8089', password: 'correct horse', username: 'reader' });
  const raw = fs.readFileSync(path.join(dir, 'direct-access.json'), 'utf8');
  assert.doesNotMatch(raw, /correct horse/);
  const first = readDirectAccessConfig(dir);
  assert.equal(first.enabled, true);
  assert.equal(first.port, 8089);
  assert.equal(await verifyPassword(first, 'correct horse'), true);
  assert.equal(await verifyPassword(first, 'wrong password'), false);

  // Saving the settings form untouched ("keep", blanks) changes nothing.
  applyDirectAccessSettings(dir, { mode: 'keep', port: '', password: '', username: '' });
  assert.deepEqual(readDirectAccessConfig(dir), first);

  applyDirectAccessSettings(dir, { mode: 'off' });
  assert.equal(readDirectAccessConfig(dir).enabled, false);
  assert.equal(readDirectAccessConfig(dir).secret, first.secret);

  // A new password signs existing sessions out.
  applyDirectAccessSettings(dir, { mode: 'on', password: 'another secret' });
  const changed = readDirectAccessConfig(dir);
  assert.notEqual(changed.secret, first.secret);
  assert.equal(verifySessionToken(changed, createSessionToken(first)), false);
});

test('session tokens expire and cannot be forged', () => {
  const config = { secret: Buffer.alloc(32, 7).toString('base64'), username: 'reader', hash: 'h' };
  const now = Date.now();
  const token = createSessionToken(config, now);
  assert.equal(verifySessionToken(config, token, now + 1000), true);
  assert.equal(verifySessionToken(config, token, now + 31 * 24 * 3600 * 1000), false);
  assert.equal(verifySessionToken(config, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), now), false);
  assert.equal(verifySessionToken({ ...config, username: 'other' }, token, now), false);
});

test('login redirects only to app paths', () => {
  assert.equal(safeNext('/app/zhenshu/reader.html?id=1', APP_PREFIX), '/app/zhenshu/reader.html?id=1');
  for (const value of ['https://evil.example/', '//evil.example/app/zhenshu/', '/other', '/app/zhenshu/__direct/login', '']) {
    assert.equal(safeNext(value, APP_PREFIX), '/app/zhenshu/');
  }
});

test('direct port requires the password and reads as the mapped gateway user', async (t) => {
  const dir = sandbox(t);
  const port = await freePort();
  process.env.ZHENSHU_DIRECT_HOST = '127.0.0.1';
  t.after(() => { delete process.env.ZHENSHU_DIRECT_HOST; });
  applyDirectAccessSettings(dir, { mode: 'on', port: String(port), password: 'correct horse', username: 'reader' });

  const seen = [];
  const handleRequest = (request, response) => {
    seen.push({ uid: request.headers['x-trim-userid'], name: request.headers['x-trim-username'], admin: request.headers['x-trim-isadmin'] });
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('app');
  };
  const quiet = { log() {}, warn() {}, error() {} };
  const direct = createDirectAccess({ configRoot: dir, appPrefix: APP_PREFIX, handleRequest, log: quiet });
  t.after(() => direct.close());
  await direct.reconcile();
  assert.equal(direct.port, port);

  const base = `http://127.0.0.1:${port}`;
  const get = (pathname, headers = {}) => fetch(base + pathname, { redirect: 'manual', headers });

  let response = await get('/');
  assert.equal(response.headers.get('location'), `${APP_PREFIX}/`);
  response = await get(`${APP_PREFIX}/`);
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /__direct\/login\?next=/);
  // Spoofed gateway headers are not trusted.
  response = await get(`${APP_PREFIX}/api/library`, { 'X-Trim-Userid': '1000', 'X-Trim-Username': 'admin', 'X-Trim-Isadmin': 'true' });
  assert.equal(response.status, 401);
  assert.equal(seen.length, 0);

  const login = (password) => fetch(`${base}${APP_PREFIX}/__direct/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password, next: `${APP_PREFIX}/reader.html` })
  });
  response = await login('wrong password');
  assert.equal(response.status, 401);
  response = await login('correct horse');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${APP_PREFIX}/reader.html`);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.ok(cookie.startsWith(`${COOKIE_NAME}=`));

  // Signed in, but fnOS has not yet vouched for the user "reader".
  response = await get(`${APP_PREFIX}/`, { Cookie: cookie });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /reader/);

  direct.recordGatewayUser({ headers: { 'x-trim-userid': '1001', 'x-trim-username': 'reader' } });
  response = await get(`${APP_PREFIX}/api/library`, { Cookie: cookie, 'X-Trim-Isadmin': 'true' });
  assert.equal(response.status, 200);
  assert.deepEqual(seen.at(-1), { uid: '1001', name: 'reader', admin: 'false' });

  // Turning direct access off closes the port.
  applyDirectAccessSettings(dir, { mode: 'off' });
  await direct.reconcile();
  assert.equal(direct.port, null);
  await assert.rejects(get('/'));
});

test('repeated wrong passwords are rate limited', async (t) => {
  const dir = sandbox(t);
  const port = await freePort();
  process.env.ZHENSHU_DIRECT_HOST = '127.0.0.1';
  t.after(() => { delete process.env.ZHENSHU_DIRECT_HOST; });
  applyDirectAccessSettings(dir, { mode: 'on', port: String(port), password: 'correct horse', username: 'reader' });
  const direct = createDirectAccess({ configRoot: dir, appPrefix: APP_PREFIX, handleRequest() {}, log: { log() {}, error() {} } });
  t.after(() => direct.close());
  await direct.reconcile();
  const login = (password) => fetch(`http://127.0.0.1:${port}${APP_PREFIX}/__direct/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password })
  });
  for (let i = 0; i < 5; i += 1) assert.equal((await login('nope nope')).status, 401);
  assert.equal((await login('correct horse')).status, 429);
});

test('install and config wizards expose the same direct-port fields', () => {
  const fields = (name) => JSON.parse(fs.readFileSync(path.join(root, 'wizard', name), 'utf8'))
    .flatMap((step) => step.items).filter((item) => item.field).map((item) => item.field);
  const expected = ['wizard_direct_mode', 'wizard_direct_port', 'wizard_direct_password', 'wizard_direct_user'];
  assert.deepEqual(fields('install'), expected);
  assert.deepEqual(fields('config'), expected);
  const install = JSON.parse(fs.readFileSync(path.join(root, 'wizard', 'install'), 'utf8'));
  assert.equal(install[0].items.find((item) => item.field === 'wizard_direct_mode').initValue, 'off');
  assert.equal(install[0].items.find((item) => item.field === 'wizard_direct_password').type, 'password');
});

test('lifecycle scripts never echo the direct-access password', () => {
  for (const script of ['install_callback', 'config_callback']) {
    const source = fs.readFileSync(path.join(root, 'cmd', script), 'utf8');
    assert.match(source, /direct-access-config\.js" set/);
    assert.doesNotMatch(source, /\$\{?wizard_direct_password/);
  }
});

function availableShell() {
  for (const candidate of ['/bin/sh', 'C:/Program Files/Git/bin/sh.exe']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

test('install_callback saves direct access when chosen and fails clearly on bad input', {
  skip: !availableShell() ? 'POSIX shell is unavailable' : false
}, (t) => {
  const dir = sandbox(t);
  const appDest = path.join(dir, 'target');
  const configRoot = path.join(dir, 'etc');
  fs.mkdirSync(path.join(appDest, 'cmd'), { recursive: true });
  fs.mkdirSync(path.join(appDest, 'server'), { recursive: true });
  fs.cpSync(path.join(root, 'cmd', 'install_callback'), path.join(appDest, 'cmd', 'install_callback'));
  fs.cpSync(path.join(root, 'app', 'server', 'direct-access-config.js'), path.join(appDest, 'server', 'direct-access-config.js'));
  const run = (extra) => spawnSync(availableShell(), [path.join(appDest, 'cmd', 'install_callback')], {
    encoding: 'utf8',
    env: { ...process.env, TRIM_APPDEST: appDest, TRIM_PKGETC: configRoot, ...extra },
    timeout: 15000
  });

  let result = run({ wizard_direct_mode: 'off' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(configRoot, 'direct-access.json')), false);

  result = run({ wizard_direct_mode: 'on', wizard_direct_port: '5666', wizard_direct_password: 'correct horse', wizard_direct_user: 'reader' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /5666/);
  assert.doesNotMatch(result.stderr + result.stdout, /correct horse/);

  result = run({ wizard_direct_mode: 'on', wizard_direct_port: '8089', wizard_direct_password: 'correct horse', wizard_direct_user: 'reader' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readDirectAccessConfig(configRoot).port, 8089);
});
