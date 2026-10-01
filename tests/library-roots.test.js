'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parsePathList,
  collectRootCandidates,
  resolveLibraryRoots
} = require('../app/server/library-roots');
const { readFnOSAuthorizedRoots, writeFnOSAuthorizedRoots } = require('../app/server/fnos-roots-config');

async function temporaryDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('parsePathList preserves Chinese and space-containing fnOS paths', () => {
  assert.deepEqual(
    parsePathList(' /vol1/中文 目录 :/vol2/books '),
    ['/vol1/中文 目录', '/vol2/books']
  );
  assert.deepEqual(parsePathList(''), []);
  assert.deepEqual(parsePathList(undefined), []);
  assert.deepEqual(parsePathList('C:\\Books:D:\\共享书库'), ['C:\\Books', 'D:\\共享书库']);
});

test('fnOS authorization snapshot applies additions and revocations without a process restart', async (t) => {
  const configRoot = await temporaryDirectory(t, 'zhenshu-roots-config-');
  const oldRoot = path.join(configRoot, '旧书库');
  const newRoot = path.join(configRoot, '新 书库');
  assert.deepEqual(readFnOSAuthorizedRoots(configRoot, oldRoot), [oldRoot]);
  writeFnOSAuthorizedRoots(configRoot, newRoot);
  assert.deepEqual(readFnOSAuthorizedRoots(configRoot, oldRoot), [newRoot]);
  const snapshot = path.join(configRoot, 'fnos-authorized-roots.json');
  if (process.platform !== 'win32') assert.equal((await fs.stat(snapshot)).mode & 0o777, 0o600);
  writeFnOSAuthorizedRoots(configRoot, '');
  assert.deepEqual(readFnOSAuthorizedRoots(configRoot, oldRoot), []);

  await fs.writeFile(snapshot, '{bad json', 'utf8');
  assert.deepEqual(readFnOSAuthorizedRoots(configRoot, oldRoot), []);
});

test('collectRootCandidates preserves source order and source labels', () => {
  assert.deepEqual(collectRootCandidates({
    configuredRoots: ['/one'],
    accessibleRoots: ['/two'],
    sharedRoots: ['/three']
  }), [
    { root: '/one', source: 'configured' },
    { root: '/two', source: 'accessible' },
    { root: '/three', source: 'shared' }
  ]);
});

test('resolveLibraryRoots authorizes readable directories and rejects files or missing paths', async (t) => {
  const sandbox = await temporaryDirectory(t, 'zhenshu-roots-');
  const parent = path.join(sandbox, '中文 书库');
  const child = path.join(parent, '子目录');
  const regularFile = path.join(sandbox, 'not-a-directory.txt');
  const missing = path.join(sandbox, 'missing');
  await fs.mkdir(child, { recursive: true });
  await fs.writeFile(regularFile, 'not a root', 'utf8');

  const result = await resolveLibraryRoots({
    configuredRoots: [child],
    accessibleRoots: [parent, parent],
    sharedRoots: [regularFile, missing]
  });

  assert.deepEqual(result.authorizedRoots, [await fs.realpath(parent)]);
  assert.equal(result.rejectedRoots.length, 2);
  assert.deepEqual(result.rejectedRoots.map((item) => item.root), [regularFile, missing]);
  assert.ok(result.rejectedRoots.every((item) => typeof item.error === 'string'));
});
