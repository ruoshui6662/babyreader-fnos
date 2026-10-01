'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getPdfReaderEnabled } = require('../app/server/pdf-feature-config');

function temporaryConfigRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babyreader-pdf-feature-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('PDF reading is on by default', (t) => {
  const root = temporaryConfigRoot(t);
  assert.equal(getPdfReaderEnabled(root, undefined), true);
  assert.equal(getPdfReaderEnabled(root, ''), true);
  assert.equal(getPdfReaderEnabled(root, '1'), true);
});

test('a stale disabled setting from the removed fnOS switch is ignored', (t) => {
  const root = temporaryConfigRoot(t);
  fs.writeFileSync(path.join(root, 'pdf-feature.json'), '{"version":1,"enabled":false}');
  assert.equal(getPdfReaderEnabled(root, undefined), true);
  fs.writeFileSync(path.join(root, 'pdf-feature.json'), 'not json');
  assert.equal(getPdfReaderEnabled(root, undefined), true);
});

test('BABYREADER_PDF_ENABLED stays an operator kill switch', (t) => {
  const root = temporaryConfigRoot(t);
  for (const value of ['0', 'false', 'FALSE', ' no ', 'off']) {
    assert.equal(getPdfReaderEnabled(root, value), false, value);
  }
});
