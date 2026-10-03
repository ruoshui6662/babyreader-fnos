'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const forcePortable = process.argv.includes('--portable');
const forcePosix = process.argv.includes('--posix');
if (forcePortable && forcePosix) {
  console.error('ERROR: --portable and --posix cannot be used together');
  process.exit(2);
}
const validatePosixShell = forcePosix || (!forcePortable && process.platform !== 'win32');
const uiScriptFiles = [
  'app/ui/core/state.js',
  'app/ui/core/utils.js',
  'app/ui/core/api.js',
  'app/ui/core/user-state.js',
  'app/ui/reader/annotations.js',
  'app/ui/reader/epub.js',
  'app/ui/reader/paragraphs.js',
  'app/ui/reader/reading-timer.js',
  'app/ui/reader/document.js',
  'app/ui/reader/editor.js',
  'app/ui/reader/highlights.js',
  'app/ui/reader/pdf-notes-export.js',
  'app/ui/reader/actions.js',
  'app/ui/reader/progress.js',
  'app/ui/reader/pagination.js',
  'app/ui/reader/settings.js',
  'app/ui/reader/navigation.js',
  'app/ui/reader/pdf-annotation-geometry.js',
  'app/ui/reader/pdf-annotations.js',
  'app/ui/reader/pdf-render-scheduler.js',
  'app/ui/reader/pdf-colors.js',
  'app/ui/reader/pdf.js',
  'app/ui/reader/lifecycle.js',
  'app/ui/shell/drawer.js',
  'app/ui/library/pdf-covers.js',
  'app/ui/library/import.js',
  'app/ui/library/shelf-nav.js',
  'app/ui/library/stats-page.js',
  'app/ui/library/view.js',
  'app/ui/app.js'
];
const lifecycleScripts = [
  'cmd/main',
  'cmd/install_init',
  'cmd/install_callback',
  'cmd/upgrade_init',
  'cmd/upgrade_callback',
  'cmd/uninstall_init',
  'cmd/uninstall_callback',
  'cmd/config_init',
  'cmd/config_callback'
];
const auxiliaryShellScripts = [
  'scripts/fnos-device-acceptance.sh'
];
const requiredFiles = [
  'manifest',
  'package.json',
  'package-lock.json',
  'UPSTREAM_BASELINES',
  'app/server/index.js',
  'app/server/fnos-roots-config.js',
  'app/server/direct-access.js',
  'app/server/direct-access-config.js',
  'app/server/ai-transport.js',
  'app/server/ai-text-structure.js',
  'app/server/ai-router.js',
  'app/server/ai-answer-pipeline.js',
  'app/server/ai-book-map.js',
  'app/server/ai-book-map-store.js',
  'app/server/ai-embeddings.js',
  'app/server/pdf-ai-structure.js',
  'app/server/pdf-ai-profile.js',
  'app/server/pdf-ai-profile-store.js',
  'app/server/pdf-ai-retrieval.js',
  'app/server/pdf-text.js',
  'app/server/pdf-text-limits.js',
  'app/server/pdf-text-worker.js',
  'app/server/library.js',
  'app/server/security.js',
  'app/server/storage.js',
  'app/server/zip.js',
  'app/server/mobi-format.js',
  'app/server/mobi-feature-config.js',
  'app/server/mobi-convert.js',
  'app/server/mobi-convert-worker.js',
  'app/server/mobi-derived.js',
  'app/server/epub-writer.js',
  'app/server/vendor/lingo-mobi/mobi-parser.mjs',
  'app/server/vendor/lingo-mobi/LICENSE',
  'app/server/vendor/lingo-mobi/PATCHES.md',
  'app/server/import-feature-config.js',
  'app/server/book-import.js',
  'app/ui/config',
  'app/ui/images/logo.svg',
  'app/ui/images/icon_64.png',
  'app/ui/images/icon_256.png',
  'app/ui/index.html',
  'app/ui/styles.css',
  'app/ui/vendor/pdfjs/UPSTREAM.md',
  'app/ui/vendor/pdfjs/LICENSE',
  'app/ui/vendor/pdfjs/build/pdf.mjs',
  'app/ui/vendor/pdfjs/build/pdf.worker.mjs',
  ...uiScriptFiles,
  'config/privilege',
  'config/resource',
  'wizard/config',
  'wizard/install',
  ...lifecycleScripts,
  ...auxiliaryShellScripts
];

const errors = [];
const resolve = (relative) => path.join(root, relative);

function readText(relative) {
  try {
    return fs.readFileSync(resolve(relative), 'utf8');
  } catch (error) {
    errors.push(`Cannot read ${relative}: ${error.message}`);
    return '';
  }
}

function readJson(relative) {
  try {
    return JSON.parse(readText(relative));
  } catch (error) {
    errors.push(`Invalid JSON in ${relative}: ${error.message}`);
    return null;
  }
}

for (const relative of requiredFiles) {
  const file = resolve(relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    errors.push(`Missing required file: ${relative}`);
  }
}

const manifest = Object.create(null);
for (const rawLine of readText('manifest').split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const separator = line.indexOf('=');
  if (separator <= 0) {
    errors.push(`Invalid manifest line: ${line}`);
    continue;
  }
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (Object.prototype.hasOwnProperty.call(manifest, key)) {
    errors.push(`Duplicate manifest field: ${key}`);
  }
  manifest[key] = value;
}

const expectedManifest = {
  appname: 'zhenshu',
  source: 'thirdparty',
  platform: 'all',
  install_dep_apps: 'nodejs_v22',
  os_min_version: '1.1.3100',
  desktop_uidir: 'ui',
  desktop_applaunchname: 'zhenshu.main',
  ctl_stop: 'true',
  checkport: 'false',
  disable_authorization_path: 'false'
};
for (const [key, expected] of Object.entries(expectedManifest)) {
  if (manifest[key] !== expected) {
    errors.push(`Manifest ${key} must equal ${expected}`);
  }
}
for (const key of ['version', 'display_name', 'desc', 'maintainer', 'maintainer_url', 'changelog']) {
  if (!manifest[key]) errors.push(`Manifest field ${key} must not be empty`);
}
if (manifest.version && !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  errors.push('Manifest version must use numeric major.minor.patch format');
}

for (const relative of lifecycleScripts) {
  const file = resolve(relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const data = fs.readFileSync(file);
  const text = data.toString('utf8');
  if (data.includes(13)) errors.push(`${relative} must use LF line endings only`);
  if (!text.startsWith('#!/bin/sh\n')) {
    errors.push(`${relative} must use the POSIX #!/bin/sh shebang`);
  }
  if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o111) === 0) {
    errors.push(`${relative} must be executable`);
  }
  if (validatePosixShell) {
    try {
      execFileSync('sh', ['-n', file], { stdio: 'pipe' });
    } catch (error) {
      const detail = error.stderr ? error.stderr.toString('utf8').trim() : error.message;
      errors.push(`${relative} failed shell syntax validation: ${detail}`);
    }
  }
}

for (const relative of auxiliaryShellScripts) {
  const file = resolve(relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  const data = fs.readFileSync(file);
  const text = data.toString('utf8');
  if (data.includes(13)) errors.push(`${relative} must use LF line endings only`);
  if (!text.startsWith('#!/bin/sh\n')) {
    errors.push(`${relative} must use the POSIX #!/bin/sh shebang`);
  }
  if (validatePosixShell) {
    try {
      execFileSync('sh', ['-n', file], { stdio: 'pipe' });
    } catch (error) {
      const detail = error.stderr ? error.stderr.toString('utf8').trim() : error.message;
      errors.push(`${relative} failed shell syntax validation: ${detail}`);
    }
  }
}

const mainSource = readText('cmd/main');
if (!mainSource.includes('SERVER_FILE="$APP_DEST/server/index.js"')) {
  errors.push('cmd/main must resolve the Native FPK service entry as $TRIM_APPDEST/server/index.js');
}
if (mainSource.includes('SERVER_FILE="$APP_DEST/app/server/index.js"')) {
  errors.push('cmd/main must not prepend app/ because app.tgz is extracted directly into TRIM_APPDEST');
}
if (!mainSource.includes('枕书 服务文件不存在：$SERVER_FILE')) {
  errors.push('cmd/main missing-path error must include the actual SERVER_FILE path');
}
for (const token of [
  '/var/apps/nodejs_v22/target/bin',
  'process.versions.node',
  'PID_FILE=',
  'LOG_FILE=',
  'SOCKET_FILE=',
  'kill -0',
  '[ -S "$SOCKET_FILE" ]',
  'nohup "$NODE_BIN" "$SERVER_FILE"',
  'TRIM_PKGTMP="$PKG_TMP"',
  'status_service',
  'return 3',
  'stop_service',
  'remove_stale_state'
]) {
  if (!mainSource.includes(token)) {
    errors.push(`cmd/main is missing required startup logic: ${token}`);
  }
}

const uiConfig = readJson('app/ui/config');
const privilege = readJson('config/privilege');
const resource = readJson('config/resource');
const entry = uiConfig?.['.url']?.['zhenshu.main'];

if (!entry) errors.push('Missing zhenshu.main UI entry');
if (!['iframe', 'url'].includes(entry?.type)) errors.push('UI entry type must be iframe or url');
if (entry?.protocol !== '') errors.push('Unified gateway protocol must be empty');
if (entry?.gatewayPrefix !== '/app/zhenshu') errors.push('Unexpected gatewayPrefix');
if (entry?.gatewaySocket !== 'app.sock') errors.push('Unexpected gatewaySocket');
if (entry?.url !== '/app/zhenshu/') errors.push('Unexpected gateway URL');
if (entry?.allUsers !== true) errors.push('UI entry must enable allUsers');

if (privilege?.defaults?.['run-as'] !== 'package') {
  errors.push('Application must run as a package user');
}
if (privilege?.username !== 'zhenshu' || privilege?.groupname !== 'zhenshu') {
  errors.push('Package username and groupname must be zhenshu');
}
const shares = resource?.['data-share']?.shares;
if (!Array.isArray(shares) || !shares.some((share) => share?.name === 'zhenshu/library')) {
  errors.push('config/resource must declare zhenshu/library');
}

for (const name of ['install', 'upgrade', 'uninstall', 'config']) {
  const relative = `wizard/${name}`;
  const file = resolve(relative);
  if (!fs.existsSync(file)) continue;
  if (!fs.statSync(file).isFile()) {
    errors.push(`${relative} must be a JSON file`);
    continue;
  }
  if (!Array.isArray(readJson(relative))) {
    errors.push(`${relative} must contain a JSON array`);
  }
}

const appSource = uiScriptFiles.map(readText).join('\n');
for (const forbidden of ['window.webkit', 'sendNative(', 'state.isNative', 'WKWebView']) {
  if (appSource.includes(forbidden)) {
    errors.push(`Native bridge reference remains: ${forbidden}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

const shellMode = validatePosixShell ? 'POSIX shell syntax enforced' : 'portable mode; POSIX shell syntax skipped';
console.log(`Structure validation passed (${requiredFiles.length} required files, ${lifecycleScripts.length} lifecycle scripts; ${shellMode}).`);
