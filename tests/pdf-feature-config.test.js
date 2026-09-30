'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { getPdfReaderEnabled, setPdfReaderEnabled } = require('../app/server/pdf-feature-config');

function temporaryConfigRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babyreader-pdf-feature-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('missing private setting defaults off and preserves the legacy test environment override', (t) => {
  const root = temporaryConfigRoot(t);
  assert.equal(getPdfReaderEnabled(root, undefined), false);
  assert.equal(getPdfReaderEnabled(root, 'true'), true);
  assert.equal(getPdfReaderEnabled(root, '0'), false);
});

test('persisted switch takes priority over the process environment', (t) => {
  const root = temporaryConfigRoot(t);
  fs.writeFileSync(path.join(root, 'pdf-feature.json'), '{"version":1,"enabled":false}');
  assert.equal(getPdfReaderEnabled(root, 'true'), false);
  fs.writeFileSync(path.join(root, 'pdf-feature.json'), '{"version":1,"enabled":true}');
  assert.equal(getPdfReaderEnabled(root, 'false'), true);
});

test('existing malformed or unreadable settings fail closed instead of enabling an environment override', (t) => {
  const root = temporaryConfigRoot(t);
  const configFile = path.join(root, 'pdf-feature.json');
  for (const value of ['not json', '{"version":2,"enabled":true}', '{"version":1,"enabled":"true"}']) {
    fs.writeFileSync(configFile, value);
    assert.equal(getPdfReaderEnabled(root, 'true'), false);
  }
  fs.rmSync(configFile);
  fs.mkdirSync(configFile);
  assert.equal(getPdfReaderEnabled(root, 'true'), false);
});

test('switch writes only exact boolean values, preserves existing data on rejection, and leaves no temp files', (t) => {
  const root = temporaryConfigRoot(t);
  const configFile = path.join(root, 'pdf-feature.json');
  assert.equal(setPdfReaderEnabled(root, 'true'), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')), { version: 1, enabled: true });
  assert.equal(setPdfReaderEnabled(root, 'false'), false);
  const afterDisable = fs.readFileSync(configFile, 'utf8');
  assert.deepEqual(JSON.parse(afterDisable), { version: 1, enabled: false });
  assert.throws(() => setPdfReaderEnabled(root, 'yes'), /Invalid PDF switch value/);
  assert.equal(fs.readFileSync(configFile, 'utf8'), afterDisable);
  assert.deepEqual(fs.readdirSync(root), ['pdf-feature.json']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
});

test('CLI writes a private setting from fnOS configuration without printing it', (t) => {
  const root = temporaryConfigRoot(t);
  const modulePath = path.join(__dirname, '..', 'app', 'server', 'pdf-feature-config.js');
  const result = spawnSync(process.execPath, [modulePath, 'set', 'true'], {
    encoding: 'utf8',
    env: { ...process.env, TRIM_PKGETC: root }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'pdf-feature.json'), 'utf8')), {
    version: 1,
    enabled: true
  });
});
