'use strict';

// fnOS: the app runs behind the fnOS gateway, which signs users in and passes
// who they are in x-trim-* headers; fnOS hands the app its data and config
// folders (TRIM_PKGVAR / TRIM_PKGETC) and the folders it may read
// (TRIM_DATA_ACCESSIBLE_PATHS, kept in a private snapshot that the
// config_callback rewrites, and TRIM_DATA_SHARE_PATHS).

const path = require('node:path');
const { parsePathList } = require('../library-roots');
const {
  readFnOSAuthorizedRoots,
  writeFnOSAuthorizedRoots,
  fnOSAuthorizationRevision
} = require('../fnos-roots-config');

function createFnOSPlatform({ env = process.env, appRoot }) {
  const runtime = path.join(appRoot, '..', '.runtime');
  return {
    name: 'fnos',
    paths: {
      data: path.resolve(env.TRIM_PKGVAR || path.join(runtime, 'var')),
      config: path.resolve(env.TRIM_PKGETC || path.join(runtime, 'etc')),
      socket: env.ZHENSHU_SOCKET || path.resolve(env.TRIM_APPDEST || path.join(appRoot, '..'), 'app.sock')
    },

    // Who is asking. Only the gateway (or the direct-access listener, which
    // strips client-sent x-trim-* headers and signs in by password) sets these.
    identify(request) {
      let uid = request.headers['x-trim-userid'];
      let username = request.headers['x-trim-username'];
      let isAdmin = request.headers['x-trim-isadmin'] === 'true';
      if (!uid && env.NODE_ENV === 'development') {
        uid = env.ZHENSHU_DEV_UID || 'development';
        username = env.ZHENSHU_DEV_USERNAME || 'development';
        isAdmin = true;
      }
      if (!uid) throw Object.assign(new Error('Missing authenticated fnOS user context'), { statusCode: 401 });
      return { uid: String(uid), username: String(username || ''), isAdmin };
    },

    // The folders the platform lets the app read, besides app settings.
    libraryRoots(configRoot) {
      return {
        accessibleRoots: readFnOSAuthorizedRoots(configRoot, env.TRIM_DATA_ACCESSIBLE_PATHS),
        sharedRoots: parsePathList(env.TRIM_DATA_SHARE_PATHS)
      };
    },

    // Changes when those folders may have changed (the snapshot's revision).
    rootsRevision(configRoot) {
      return fnOSAuthorizationRevision(configRoot);
    },

    // fnOS hands the app its current folder authorization when it starts it.
    // That is the truth at start: rewrite the private snapshot from it, so a
    // folder taken away while a change callback was missed (or failed) does
    // not stay readable. Only when fnOS set the variable (empty means “no
    // folders”); cmd/main says so in ZHENSHU_FNOS_ACCESSIBLE_AT_START.
    syncAtStart(configRoot) {
      if (env.ZHENSHU_FNOS_ACCESSIBLE_AT_START !== '1') return;
      writeFnOSAuthorizedRoots(configRoot, env.TRIM_DATA_ACCESSIBLE_PATHS || '');
    }
  };
}

module.exports = { createFnOSPlatform };
