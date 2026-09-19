'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
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
const requiredFiles = [
  'manifest',
  'package.json',
  'package-lock.json',
  'UPSTREAM_BASELINES',
  'app/server/index.js',
  'app/server/library.js',
  'app/server/security.js',
  'app/server/storage.js',
  'app/server/zip.js',
  'app/ui/config',
  'app/ui/index.html',
  'app/ui/app.js',
  'app/ui/styles.css',
  'config/privilege',
  'config/resource',
  ...lifecycleScripts
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
  appname: 'babyreader-fnos',
  source: 'thirdparty',
  platform: 'all',
  install_dep_apps: 'nodejs_v22',
  os_min_version: '1.1.3100',
  desktop_uidir: 'ui',
  desktop_applaunchname: 'babyreader-fnos.main',
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
  try {
    execFileSync('sh', ['-n', file], { stdio: 'pipe' });
  } catch (error) {
    const detail = error.stderr ? error.stderr.toString('utf8').trim() : error.message;
    errors.push(`${relative} failed shell syntax validation: ${detail}`);
  }
}

const mainSource = readText('cmd/main');
if (!mainSource.includes('SERVER_FILE="$APP_DEST/server/index.js"')) {
  errors.push('cmd/main must resolve the Native FPK service entry as $TRIM_APPDEST/server/index.js');
}
if (mainSource.includes('SERVER_FILE="$APP_DEST/app/server/index.js"')) {
  errors.push('cmd/main must not prepend app/ because app.tgz is extracted directly into TRIM_APPDEST');
}
if (!mainSource.includes('BabyReader 服务文件不存在：$SERVER_FILE')) {
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
const entry = uiConfig?.['.url']?.['babyreader-fnos.main'];

if (!entry) errors.push('Missing babyreader-fnos.main UI entry');
if (!['iframe', 'url'].includes(entry?.type)) errors.push('UI entry type must be iframe or url');
if (entry?.protocol !== '') errors.push('Unified gateway protocol must be empty');
if (entry?.gatewayPrefix !== '/app/babyreader-fnos') errors.push('Unexpected gatewayPrefix');
if (entry?.gatewaySocket !== 'app.sock') errors.push('Unexpected gatewaySocket');
if (entry?.url !== '/app/babyreader-fnos/') errors.push('Unexpected gateway URL');
if (entry?.allUsers !== true) errors.push('UI entry must enable allUsers');

if (privilege?.defaults?.['run-as'] !== 'package') {
  errors.push('Application must run as a package user');
}
if (privilege?.username !== 'babyreader_fnos' || privilege?.groupname !== 'babyreader_fnos') {
  errors.push('Package username and groupname must be babyreader_fnos');
}
const shares = resource?.['data-share']?.shares;
if (!Array.isArray(shares) || !shares.some((share) => share?.name === 'babyreader-fnos/library')) {
  errors.push('config/resource must declare babyreader-fnos/library');
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

const appSource = readText('app/ui/app.js');
for (const forbidden of ['window.webkit', 'sendNative(', 'state.isNative', 'WKWebView']) {
  if (appSource.includes(forbidden)) {
    errors.push(`Native bridge reference remains: ${forbidden}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`Structure validation passed (${requiredFiles.length} required files, ${lifecycleScripts.length} lifecycle scripts).`);
