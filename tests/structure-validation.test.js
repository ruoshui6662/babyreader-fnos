'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const validator = path.join(root, 'scripts', 'validate-structure.js');

function runValidator(args) {
  return spawnSync(process.execPath, [validator, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

test('portable structure validation never requires a POSIX shell', () => {
  const result = runValidator(['--portable']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /portable mode; POSIX shell syntax skipped/);
});

test('portable and POSIX modes are mutually exclusive', () => {
  const result = runValidator(['--portable', '--posix']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot be used together/);
});

test('POSIX structure validation enforces shell syntax on POSIX hosts', {
  skip: process.platform === 'win32' ? 'POSIX shell validation runs in Linux CI/fnOS' : false
}, () => {
  const result = runValidator(['--posix']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /POSIX shell syntax enforced/);
});
