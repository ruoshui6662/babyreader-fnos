'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlatform } = require('../app/server/platform');

const appRoot = path.resolve(__dirname, '..', 'app');
const request = (headers = {}) => ({ headers });

test('fnOS is the default platform: fnOS folders, gateway identity, authorized and shared roots', () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhenshu-platform-'));
  try {
    const env = {
      TRIM_PKGVAR: '/var/apps/zhenshu/var',
      TRIM_PKGETC: configRoot,
      TRIM_APPDEST: '/var/apps/zhenshu/target',
      TRIM_DATA_ACCESSIBLE_PATHS: '/vol1/1000/book',
      TRIM_DATA_SHARE_PATHS: '/vol1/@appshare/zhenshu/library'
    };
    const platform = createPlatform({ env, appRoot });
    assert.equal(platform.name, 'fnos');
    assert.equal(platform.paths.data, path.resolve('/var/apps/zhenshu/var'));
    assert.equal(platform.paths.config, path.resolve(configRoot));
    assert.equal(platform.paths.socket, path.resolve('/var/apps/zhenshu/target', 'app.sock'));

    assert.deepEqual(platform.identify(request({ 'x-trim-userid': '1000', 'x-trim-username': 'ann', 'x-trim-isadmin': 'true' })),
      { uid: '1000', username: 'ann', isAdmin: true });
    assert.throws(() => platform.identify(request()), (error) => error.statusCode === 401);

    // No snapshot yet: the start-time variable; after a start-time sync, the snapshot.
    assert.deepEqual(platform.libraryRoots(configRoot), {
      accessibleRoots: ['/vol1/1000/book'],
      sharedRoots: ['/vol1/@appshare/zhenshu/library']
    });
    const before = platform.rootsRevision(configRoot);
    platform.syncAtStart(configRoot);
    assert.equal(fs.existsSync(path.join(configRoot, 'fnos-authorized-roots.json')), false, 'only when fnOS set the variable');
    const started = createPlatform({ env: { ...env, ZHENSHU_FNOS_ACCESSIBLE_AT_START: '1', TRIM_DATA_ACCESSIBLE_PATHS: '/vol1/1000/new' }, appRoot });
    started.syncAtStart(configRoot);
    assert.deepEqual(platform.libraryRoots(configRoot).accessibleRoots, ['/vol1/1000/new']);
    assert.notEqual(platform.rootsRevision(configRoot), before);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test('the generic platform (reserved for Docker) takes its folders from ZHENSHU_* and trusts no fallback user', () => {
  const platform = createPlatform({
    env: {
      ZHENSHU_PLATFORM: 'generic',
      ZHENSHU_DATA_DIR: '/srv/zhenshu/data',
      ZHENSHU_CONFIG_DIR: '/srv/zhenshu/config',
      ZHENSHU_LIBRARY_ROOTS: '/books:/media/comics',
      NODE_ENV: 'development'
    },
    appRoot
  });
  assert.equal(platform.name, 'generic');
  assert.equal(platform.paths.data, path.resolve('/srv/zhenshu/data'));
  assert.equal(platform.paths.config, path.resolve('/srv/zhenshu/config'));
  assert.equal(platform.paths.socket, path.join(path.resolve('/srv/zhenshu/data'), 'app.sock'));
  assert.deepEqual(platform.libraryRoots(), { accessibleRoots: ['/books', '/media/comics'], sharedRoots: [] });
  assert.equal(platform.rootsRevision(), platform.rootsRevision());
  assert.doesNotThrow(() => platform.syncAtStart());
  assert.deepEqual(platform.identify(request({ 'x-trim-userid': 'owner', 'x-trim-isadmin': 'true' })),
    { uid: 'owner', username: '', isAdmin: true });
  // Unlike fnOS development mode, no signed-in user is never made up.
  assert.throws(() => platform.identify(request()), (error) => error.statusCode === 401);
});

test('an unknown platform name is refused at start-up', () => {
  assert.throws(() => createPlatform({ env: { ZHENSHU_PLATFORM: 'docker-desktop' }, appRoot }), /Unknown ZHENSHU_PLATFORM/);
});
