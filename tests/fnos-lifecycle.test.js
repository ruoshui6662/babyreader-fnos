'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function run(script, args, env) {
  return spawnSync('sh', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30000
  });
}

test('build installs production dependencies inside app/server', () => {
  const source = read('scripts/build-fpk.sh');
  assert.match(source, /cp \"\$BUILD_ROOT\/package\.json\" \"\$BUILD_ROOT\/package-lock\.json\" \"\$BUILD_ROOT\/app\/server\/\"/);
  assert.match(source, /npm ci --omit=dev --ignore-scripts --prefix \"\$BUILD_ROOT\/app\/server\"/);
  assert.doesNotMatch(source, /npm ci --omit=dev --ignore-scripts --prefix \"\$BUILD_ROOT\"\s*$/m);
});

test('install_callback does not start the service inside the install transaction', () => {
  const source = read('cmd/install_callback');
  const executableLines = source.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(executableLines, /cmd\/main[^\n]*start/);
  assert.doesNotMatch(source, /\bnohup\b|app\.sock|PID_FILE|LOG_FILE/);
});

test('main uses the Native FPK target layout and fnOS runtime directories', () => {
  const source = read('cmd/main');
  assert.match(source, /SERVER_FILE="\$APP_DEST\/server\/index\.js"/);
  assert.doesNotMatch(source, /SERVER_FILE="\$APP_DEST\/app\/server\/index\.js"/);
  assert.match(source, /BabyReader 服务文件不存在：\$SERVER_FILE/);
  assert.match(source, /PID_FILE="\$PKG_TMP\/babyreader-fnos\.pid"/);
  assert.match(source, /LOG_FILE="\$PKG_VAR\/babyreader-fnos\.log"/);
  assert.match(source, /SOCKET_FILE="\$APP_DEST\/app\.sock"/);
  assert.match(source, /TRIM_APPDEST="\$APP_DEST"/);
  assert.match(source, /TRIM_PKGVAR="\$PKG_VAR"/);
  assert.match(source, /TRIM_PKGETC="\$PKG_ETC"/);
  assert.match(source, /TRIM_PKGTMP="\$PKG_TMP"/);
});

test('POSIX fnOS lifecycle installs, starts, reports status, and stops cleanly', {
  skip: process.platform === 'win32' ? 'Unix-domain socket lifecycle requires a Linux/POSIX test host' : false,
  timeout: 60000
}, (t) => {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) {
    t.skip('Lifecycle test requires Node.js 22 or newer');
    return;
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'babyreader-fnos-lifecycle-'));
  const appDest = path.join(sandbox, 'target');
  const pkgEtc = path.join(sandbox, 'etc');
  const pkgVar = path.join(sandbox, 'var');
  const pkgTmp = path.join(sandbox, 'tmp');
  const tempLog = path.join(sandbox, 'lifecycle.stderr');

  fs.mkdirSync(appDest, { recursive: true });
  fs.cpSync(path.join(root, 'app', 'server'), path.join(appDest, 'server'), { recursive: true });
  fs.cpSync(path.join(root, 'app', 'ui'), path.join(appDest, 'ui'), { recursive: true });
  fs.cpSync(path.join(root, 'cmd'), path.join(appDest, 'cmd'), { recursive: true });
  fs.cpSync(path.join(root, 'node_modules'), path.join(appDest, 'server', 'node_modules'), { recursive: true });
  for (const name of fs.readdirSync(path.join(appDest, 'cmd'))) {
    fs.chmodSync(path.join(appDest, 'cmd', name), 0o755);
  }

  const env = {
    TRIM_APPDEST: appDest,
    TRIM_PKGETC: pkgEtc,
    TRIM_PKGVAR: pkgVar,
    TRIM_PKGTMP: pkgTmp,
    TRIM_TEMP_LOGFILE: tempLog,
    PATH: `${path.dirname(process.execPath)}:${process.env.PATH || '/usr/bin:/bin'}`
  };
  const command = (name, ...args) => run(path.join(appDest, 'cmd', name), args, env);

  t.after(() => {
    command('main', 'stop');
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  let result = command('install_init');
  assert.equal(result.status, 0, `install_init failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(fs.existsSync(pkgEtc), false, 'install_init must not create TRIM_PKGETC before fnOS prepares it');
  assert.equal(fs.existsSync(pkgVar), false, 'install_init must not create TRIM_PKGVAR before fnOS prepares it');
  assert.equal(fs.existsSync(pkgTmp), false, 'install_init must not create TRIM_PKGTMP before fnOS prepares it');

  const beforeCallback = fs.readdirSync(appDest).sort();
  result = command('install_callback');
  assert.equal(result.status, 0, `install_callback failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.deepEqual(fs.readdirSync(appDest).sort(), beforeCallback);
  assert.equal(fs.existsSync(path.join(appDest, 'app.sock')), false);

  result = command('main', 'status');
  assert.equal(result.status, 3, `stopped status must be 3\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

  result = command('main', 'start');
  assert.equal(result.status, 0, `start failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nlog: ${fs.existsSync(path.join(pkgVar, 'babyreader-fnos.log')) ? fs.readFileSync(path.join(pkgVar, 'babyreader-fnos.log'), 'utf8') : ''}`);
  assert.equal(fs.lstatSync(path.join(appDest, 'app.sock')).isSocket(), true);
  assert.match(fs.readFileSync(path.join(pkgTmp, 'babyreader-fnos.pid'), 'utf8'), /^\d+\s*$/);
  assert.equal(fs.existsSync(path.join(pkgVar, 'babyreader-fnos.log')), true);

  result = command('main', 'status');
  assert.equal(result.status, 0, `running status failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

  result = command('main', 'stop');
  assert.equal(result.status, 0, `stop failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(fs.existsSync(path.join(appDest, 'app.sock')), false);
  assert.equal(fs.existsSync(path.join(pkgTmp, 'babyreader-fnos.pid')), false);

  result = command('main', 'status');
  assert.equal(result.status, 3, `stopped status must return to 3\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});
