'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function availableShell() {
  if (process.platform !== 'win32') return 'sh';
  const gitShell = 'C:\\Program Files\\Git\\usr\\bin\\sh.exe';
  return fs.existsSync(gitShell) ? gitShell : null;
}

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

test('build includes the fnOS acceptance tool in the packaged documentation', () => {
  const source = read('scripts/build-fpk.sh');
  assert.match(source, /cp \"\$ROOT\/scripts\/fnos-device-acceptance\.sh\" \"\$BUILD_ROOT\/app\/docs\/\"/);
});

test('FPK repacker excludes source maps that are not runtime assets', () => {
  const source = read('scripts/build-fpk.sh');
  assert.match(source, /\.map/);
  assert.match(source, /normalized\.lower\(\)\.endswith/);
});

test('acceptance tool checks the outer FPK lifecycle entry, not target contents', () => {
  const source = read('scripts/fnos-device-acceptance.sh');
  assert.match(source, /PKG_ROOT=.*TRIM_PKGROOT/);
  assert.match(source, /MAIN=\"\$\{TRIM_MAIN:-\$PKG_ROOT\/cmd\/main\}\"/);
  assert.doesNotMatch(source, /MAIN=\"\$APP_DEST\/cmd\/main\"/);
  assert.match(source, /TRIM_APPDEST=\"\$APP_DEST\"/);
});

test('acceptance reconciles supervisor status 3 with a healthy target socket', () => {
  const source = read('scripts/fnos-device-acceptance.sh');
  assert.match(source, /LIFECYCLE_STATUS_DEFERRED=0/);
  assert.match(source, /STATUS.*-eq 3.*SOCKET_FILE/);
  assert.match(source, /service is running under fnOS supervisor/);
});

test('acceptance tool exposes a server-side AI connection check without accepting an API key', () => {
  const source = read('scripts/fnos-device-acceptance.sh');
  assert.match(source, /ai-test/);
  assert.match(source, /ZHENSHU_GATEWAY_URL/);
  assert.match(source, /ZHENSHU_GATEWAY_COOKIE/);
  assert.match(source, /api\/ai\/test-connection/);
  assert.match(source, /-X POST/);
  assert.doesNotMatch(source, /ZHENSHU_AI_KEY|OPENAI_API_KEY|--api-key/);
});

test('acceptance tool checks admin library root counts without dumping root paths', () => {
  const source = read('scripts/fnos-device-acceptance.sh');
  assert.match(source, /check_gateway_root_diagnostics/);
  assert.match(source, /api\/diagnostics/);
  assert.match(source, /root_counts=/);
  assert.match(source, /configured.*accessible.*shared.*authorized.*rejected/);
});

test('acceptance tool checks the authenticated library organization contract without mutating it', () => {
  const source = read('scripts/fnos-device-acceptance.sh');
  assert.match(source, /library-organization/);
  assert.match(source, /api\/library\/organization/);
  assert.match(source, /organization contract/);
  assert.match(source, /features\?\.libraryOrganization !== true/);
  assert.doesNotMatch(source, /organization\/reconcile[\s\S]*confirm[^\n]*true/);
});

test('PDF acceptance checks the pinned local parser, browser assets, MIME/CSP, and authorized Range contract', () => {
  const source = read('scripts/fnos-device-acceptance.sh');
  assert.match(source, /check_pdf_runtime_contract/);
  assert.match(source, /PDF_PACKAGE=.*pdfjs-dist/);
  assert.match(source, /legacy\/build\/pdf\.mjs/);
  assert.match(source, /PDF_UI=.*ui\/vendor\/pdfjs/);
  assert.match(source, /\$PDF_UI\/build\/pdf\.mjs/);
  assert.match(source, /\$PDF_UI\/build\/pdf\.worker\.mjs/);
  assert.match(source, /ZHENSHU_PDF_TEST_BOOK_ID/);
  assert.match(source, /枕书 PDF Acceptance Fixture/);
  assert.match(source, /Range: bytes=0-0/);
  assert.match(source, /Range: bytes=0-/);
  assert.match(source, /Range: bytes=-1/);
  assert.match(source, /curl[^\n]*-I/);
  assert.match(source, /416/);
  assert.match(source, /content-security-policy/);
  assert.match(source, /text\/javascript/);
  assert.match(source, /pdfReader/);
});

test('FPK provenance requires PDF reader, parser, worker, and license assets', () => {
  const source = read('scripts/write-build-provenance.py');
  for (const member of [
    'server/pdf-text.js',
    'server/pdf-text-worker.js',
    'server/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    'ui/reader/pdf.js',
    'ui/vendor/pdfjs/build/pdf.mjs',
    'ui/vendor/pdfjs/build/pdf.worker.mjs',
    'ui/vendor/pdfjs/LICENSE',
    'ui/vendor/pdfjs/cmaps/LICENSE',
    'ui/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION',
    'ui/vendor/pdfjs/wasm/LICENSE_OPENJPEG',
    'server/node_modules/pdfjs-dist/LICENSE',
    'ui/vendor/pdfjs/UPSTREAM.md'
  ]) assert.ok(source.includes(member), `missing required PDF archive member: ${member}`);
});

test('FPK provenance records the exact PDF.js tarball version and integrity', () => {
  const source = read('scripts/write-build-provenance.py');
  assert.match(source, /pdfjs_dist/);
  assert.match(source, /"integrity"/);
  assert.match(source, /"resolved"/);
});

test('structure validation requires the server PDF extractor and worker modules', () => {
  const source = read('scripts/validate-structure.js');
  assert.ok(source.includes("'app/server/pdf-text.js'"));
  assert.ok(source.includes("'app/server/pdf-text-worker.js'"));
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
  assert.match(source, /枕书 服务文件不存在：\$SERVER_FILE/);
  assert.match(source, /PID_FILE="\$PKG_TMP\/zhenshu\.pid"/);
  assert.match(source, /LOG_FILE="\$PKG_VAR\/zhenshu\.log"/);
  assert.match(source, /SOCKET_FILE="\$APP_DEST\/app\.sock"/);
  assert.match(source, /TRIM_APPDEST="\$APP_DEST"/);
  assert.match(source, /TRIM_PKGVAR="\$PKG_VAR"/);
  assert.match(source, /TRIM_PKGETC="\$PKG_ETC"/);
  assert.match(source, /TRIM_PKGTMP="\$PKG_TMP"/);
  assert.match(source, /TRIM_DATA_ACCESSIBLE_PATHS="\$\{TRIM_DATA_ACCESSIBLE_PATHS:-\}"/);
  assert.match(source, /TRIM_DATA_SHARE_PATHS="\$\{TRIM_DATA_SHARE_PATHS:-\}"/);
});

test('main preserves fnOS authorized and shared path environment inherited from the supervisor', () => {
  const source = read('cmd/main');
  assert.doesNotMatch(source, /\benv\s+-i\b/);
  assert.doesNotMatch(source, /\bunset\b[^\n]*(?:TRIM_DATA_ACCESSIBLE_PATHS|TRIM_DATA_SHARE_PATHS)/);
  assert.match(source, /nohup "\$NODE_BIN" "\$SERVER_FILE"/);
});

test('release enables library organization but gates new AI chapter summaries behind an explicit opt-in', () => {
  const source = read('cmd/main');
  assert.match(source, /ZHENSHU_ENABLE_LIBRARY_ORGANIZATION="\$\{ZHENSHU_ENABLE_LIBRARY_ORGANIZATION:-1\}"/);
  assert.match(source, /ZHENSHU_ENABLE_LIBRARY_ORGANIZATION="\$\{ZHENSHU_ENABLE_LIBRARY_ORGANIZATION:-1\}"[\s\S]*NODE_ENV=production/);
  assert.match(source, /ZHENSHU_ENABLE_AI_CHAPTER_UNDERSTANDING="\$\{ZHENSHU_ENABLE_AI_CHAPTER_UNDERSTANDING:-0\}"/);
  const server = read('app/server/index.js');
  assert.match(server, /function isAiChapterUnderstandingEnabled\(\)[\s\S]*ZHENSHU_ENABLE_AI_CHAPTER_UNDERSTANDING === '1'/);
  assert.match(server, /allowEmptyContext: isAiChapterUnderstandingEnabled\(\)/);
});

test('fnOS app settings carry no format or import switches: all formats are always on', () => {
  const steps = JSON.parse(read('wizard/config'));
  const items = steps.flatMap((step) => step.items || []);
  assert.deepEqual(items.filter((item) => item.type !== 'tips'), []);
  assert.ok(items.some((item) => /PDF/.test(item.helpText) && /MOBI\/AZW3/.test(item.helpText)));
  assert.doesNotMatch(read('cmd/config_callback'), /feature-config|wizard_(pdf_reader|mobi_reader|import)_enabled/);
});

test('configuration callback ignores legacy switch fields and leaves service state alone', {
  skip: !availableShell() ? 'POSIX shell is unavailable' : false
}, (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-config-callback-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const appDest = path.join(sandbox, 'target');
  const configRoot = path.join(sandbox, 'etc');
  const tempRoot = path.join(sandbox, 'tmp');
  fs.mkdirSync(path.join(appDest, 'cmd'), { recursive: true });
  fs.mkdirSync(path.join(appDest, 'server'), { recursive: true });
  fs.mkdirSync(tempRoot);
  fs.cpSync(path.join(root, 'cmd', 'config_callback'), path.join(appDest, 'cmd', 'config_callback'));
  fs.cpSync(path.join(root, 'app', 'server', 'fnos-roots-config.js'), path.join(appDest, 'server', 'fnos-roots-config.js'));
  fs.cpSync(path.join(root, 'app', 'server', 'library-roots.js'), path.join(appDest, 'server', 'library-roots.js'));
  const socketMarker = path.join(appDest, 'app.sock');
  const pidMarker = path.join(tempRoot, 'zhenshu.pid');
  fs.writeFileSync(socketMarker, 'existing socket marker');
  fs.writeFileSync(pidMarker, '999999');

  // A settings form from an older version may still post the old switches.
  const result = spawnSync(availableShell(), [path.join(appDest, 'cmd', 'config_callback')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRIM_APPDEST: appDest,
      TRIM_PKGETC: configRoot,
      TRIM_PKGTMP: tempRoot,
      wizard_pdf_reader_enabled: 'false',
      wizard_mobi_reader_enabled: 'false',
      wizard_import_enabled: 'false'
    },
    timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
  for (const name of ['pdf-feature.json', 'mobi-feature.json', 'import-feature.json']) {
    assert.equal(fs.existsSync(path.join(configRoot, name)), false, name);
  }
  // It still snapshots the authorised folders, and never restarts the service.
  assert.ok(fs.existsSync(path.join(configRoot, 'fnos-authorized-roots.json')));
  assert.equal(fs.readFileSync(socketMarker, 'utf8'), 'existing socket marker');
  assert.equal(fs.readFileSync(pidMarker, 'utf8'), '999999');
});

test('fnOS library authorization changes update the private snapshot without lifecycle restart', {
  skip: !availableShell() ? 'POSIX shell is unavailable' : false
}, (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-root-config-callback-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const appDest = path.join(sandbox, 'target');
  const configRoot = path.join(sandbox, 'etc');
  const restartLog = path.join(sandbox, 'restart.log');
  fs.mkdirSync(path.join(appDest, 'cmd'), { recursive: true });
  fs.mkdirSync(path.join(appDest, 'server'), { recursive: true });
  fs.cpSync(path.join(root, 'cmd', 'config_init'), path.join(appDest, 'cmd', 'config_init'));
  fs.cpSync(path.join(root, 'cmd', 'config_callback'), path.join(appDest, 'cmd', 'config_callback'));
  fs.cpSync(path.join(root, 'app', 'server', 'fnos-roots-config.js'), path.join(appDest, 'server', 'fnos-roots-config.js'));
  fs.cpSync(path.join(root, 'app', 'server', 'library-roots.js'), path.join(appDest, 'server', 'library-roots.js'));
  fs.writeFileSync(path.join(appDest, 'cmd', 'main'), [
    '#!/bin/sh',
    'if [ "$1" = status ]; then exit "${ZHENSHU_TEST_SERVICE_STATUS:-0}"; fi',
    'if [ "$1" = restart ]; then printf "restart\\n" >> "$ZHENSHU_TEST_RESTART_LOG"; exit 0; fi',
    'exit 2',
    ''
  ].join('\n'));
  for (const script of ['config_init', 'config_callback', 'main']) {
    fs.chmodSync(path.join(appDest, 'cmd', script), 0o755);
  }

  const call = (script, accessibleRoots, serviceStatus = '0') => {
    const env = {
      ...process.env,
      PATH: '/usr/bin:/bin:/c/Program Files/Git/usr/bin:/c/Program Files/nodejs',
      ZHENSHU_TEST_RESTART_LOG: restartLog,
      ZHENSHU_TEST_SERVICE_STATUS: serviceStatus,
      TRIM_APPDEST: appDest,
      TRIM_PKGETC: configRoot,
      TRIM_DATA_SHARE_PATHS: '/shared/library'
    };
    if (accessibleRoots === undefined) delete env.TRIM_DATA_ACCESSIBLE_PATHS;
    else env.TRIM_DATA_ACCESSIBLE_PATHS = accessibleRoots;
    return spawnSync(availableShell(), [path.join(appDest, 'cmd', script)], {
      encoding: 'utf8', env, timeout: 15000
    });
  };

  const snapshot = path.join(configRoot, 'fnos-authorized-roots.json');
  const assertSnapshot = (suffix) => {
    const roots = JSON.parse(fs.readFileSync(snapshot, 'utf8')).accessibleRoots;
    assert.equal(roots.length, 1);
    assert.ok(roots[0].replaceAll('\\', '/').endsWith(suffix), `unexpected root: ${roots[0]}`);
  };
  let result = call('config_callback', '/first/library');
  assert.equal(result.status, 0, `first config_callback failed\\n${result.stderr}`);
  assertSnapshot('/first/library');
  assert.equal(fs.existsSync(restartLog), false);

  result = call('config_init', '/first/library');
  assert.equal(result.status, 0, `config_init failed\\n${result.stderr}`);
  result = call('config_callback', '/new/library');
  assert.equal(result.status, 0, `config_callback failed\\n${result.stderr}`);
  assertSnapshot('/new/library');
  assert.equal(fs.existsSync(restartLog), false);

  result = call('config_init', '/new/library');
  assert.equal(result.status, 0, `second config_init failed\\n${result.stderr}`);
  result = call('config_callback', '/new/library');
  assert.equal(result.status, 0, `unchanged config_callback failed\\n${result.stderr}`);
  assertSnapshot('/new/library');
  assert.equal(fs.existsSync(restartLog), false);

  result = call('config_init', '/new/library');
  assert.equal(result.status, 0, `third config_init failed\\n${result.stderr}`);
  result = call('config_callback', '/another/library', '3');
  assert.equal(result.status, 0, `stopped-service config_callback failed\\n${result.stderr}`);
  assertSnapshot('/another/library');
  assert.equal(fs.existsSync(restartLog), false);
  result = call('config_callback', undefined);
  assert.equal(result.status, 0, `empty authorization config_callback failed\\n${result.stderr}`);
  assert.deepEqual(JSON.parse(fs.readFileSync(snapshot, 'utf8')).accessibleRoots, []);
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

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-lifecycle-'));
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
  assert.equal(result.status, 0, `start failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}\nlog: ${fs.existsSync(path.join(pkgVar, 'zhenshu.log')) ? fs.readFileSync(path.join(pkgVar, 'zhenshu.log'), 'utf8') : ''}`);
  assert.equal(fs.lstatSync(path.join(appDest, 'app.sock')).isSocket(), true);
  assert.match(fs.readFileSync(path.join(pkgTmp, 'zhenshu.pid'), 'utf8'), /^\d+\s*$/);
  assert.equal(fs.existsSync(path.join(pkgVar, 'zhenshu.log')), true);

  result = command('main', 'status');
  assert.equal(result.status, 0, `running status failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

  result = command('main', 'stop');
  assert.equal(result.status, 0, `stop failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(fs.existsSync(path.join(appDest, 'app.sock')), false);
  assert.equal(fs.existsSync(path.join(pkgTmp, 'zhenshu.pid')), false);

  result = command('main', 'status');
  assert.equal(result.status, 3, `stopped status must return to 3\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});

test('main finds a supervised server when the PID file is missing or stale, and fails unknown actions with 1', {
  skip: !availableShell() ? 'POSIX shell is unavailable' : false
}, (t) => {
  // fnOS app settings restart the app and then ask `main status`. When the PID
  // file could not vouch for a running server, status said 3 and start removed
  // the live socket for a second copy; fnOS then reported 无法启用.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-main-pid-fallback-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const posix = (value) => value.replace(/\\/g, '/');
  const appDest = path.join(sandbox, 'target');
  const procRoot = path.join(sandbox, 'proc');
  const tempRoot = path.join(sandbox, 'tmp');
  fs.mkdirSync(path.join(appDest, 'server'), { recursive: true });
  fs.mkdirSync(procRoot);
  fs.mkdirSync(tempRoot);
  fs.cpSync(path.join(root, 'cmd', 'main'), path.join(sandbox, 'main'));
  const serverFile = posix(path.join(appDest, 'server', 'index.js'));
  fs.writeFileSync(serverFile, '');
  const pidFile = path.join(tempRoot, 'zhenshu.pid');
  const fakeProcess = (pid, ...args) => {
    fs.mkdirSync(path.join(procRoot, String(pid)), { recursive: true });
    fs.writeFileSync(path.join(procRoot, String(pid), 'cmdline'), `${args.join('\0')}\0`);
  };
  const main = (action) => spawnSync(availableShell(), [posix(path.join(sandbox, 'main')), action], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TRIM_APPDEST: posix(appDest),
      TRIM_PKGTMP: posix(tempRoot),
      TRIM_PKGVAR: posix(path.join(sandbox, 'var')),
      TRIM_PKGETC: posix(path.join(sandbox, 'etc')),
      ZHENSHU_PROC_ROOT: posix(procRoot)
    },
    timeout: 30000
  });

  // Another app's server never counts as ours.
  fakeProcess(100, 'node', '/var/apps/other/target/server/index.js');
  assert.equal(main('status').status, 3);
  assert.equal(fs.existsSync(pidFile), false);

  // A supervised server (no PID file; reached through a non-canonical path) is
  // found and re-adopted. start must not launch a second copy: without the
  // socket (Windows cannot create one here) it reports the running process.
  fakeProcess(4242, 'node', serverFile.replace('/server/', '/./server/'));
  const start = main('start');
  assert.equal(start.status, 1);
  assert.match(start.stderr, /进程正在运行/);
  assert.equal(fs.readFileSync(pidFile, 'utf8').trim(), '4242');

  // A stale PID file naming a dead process falls back to the process table.
  fs.writeFileSync(pidFile, '999999\n');
  assert.match(main('start').stderr, /进程正在运行/);
  assert.equal(fs.readFileSync(pidFile, 'utf8').trim(), '4242');

  // Once the server is gone, status reports stopped again.
  fs.rmSync(path.join(procRoot, '4242'), { recursive: true });
  fs.rmSync(pidFile);
  assert.equal(main('status').status, 3);

  // fnOS lifecycle contract: unsupported actions fail with 1, not 2.
  assert.equal(main('reload').status, 1);
});

test('package and launcher icons meet the fnOS spec: exact square sizes, PNG, at most 1024 KB', () => {
  const png = (relative) => {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', relative);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), size: bytes.length };
  };
  for (const [relative, size] of [
    ['ICON.PNG', 64],
    ['ICON_256.PNG', 256],
    ['app/ui/images/icon_64.png', 64],
    ['app/ui/images/icon_256.png', 256]
  ]) {
    const icon = png(relative);
    assert.equal(icon.width, size, relative);
    assert.equal(icon.height, size, relative);
    assert.ok(icon.size <= 1024 * 1024, `${relative} is over 1024 KB`);
  }
  const entry = JSON.parse(read('app/ui/config'))['.url']['zhenshu.main'];
  assert.equal(entry.icon, 'images/icon_{0}.png');
});
