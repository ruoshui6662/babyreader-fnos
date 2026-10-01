'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getMobiReaderEnabled } = require('../app/server/mobi-feature-config');
const { getBookImportEnabled } = require('../app/server/import-feature-config');

const switches = [
  ['MOBI/AZW3 reading', getMobiReaderEnabled, 'mobi-feature.json'],
  ['admin book import', getBookImportEnabled, 'import-feature.json']
];

for (const [name, isEnabled, fileName] of switches) {
  test(`${name} is on by default and ignores a stale disabled setting`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-format-switch-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    assert.equal(isEnabled(root, undefined), true);
    assert.equal(isEnabled(root, ''), true);
    // What older versions left behind after any app-settings save.
    fs.writeFileSync(path.join(root, fileName), '{"version":1,"enabled":false}');
    assert.equal(isEnabled(root, undefined), true);
  });

  test(`${name} keeps its environment kill switch`, () => {
    for (const value of ['0', 'false', 'FALSE', ' no ', 'off']) {
      assert.equal(isEnabled(os.tmpdir(), value), false, value);
    }
    assert.equal(isEnabled(os.tmpdir(), '1'), true);
  });
}
