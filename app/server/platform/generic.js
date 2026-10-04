'use strict';

// Generic host (reserved for a later Docker image; not shipped yet). No
// gateway in front: people sign in through the direct-access listener, which
// sets the x-trim-* identity of the one user chosen in its settings. Folders
// come from the environment:
//   ZHENSHU_DATA_DIR      app data (default /data)
//   ZHENSHU_CONFIG_DIR    settings (default /config)
//   ZHENSHU_LIBRARY_ROOTS the book folders, separated by ':'
//   ZHENSHU_SOCKET        optional unix socket (default <data>/app.sock)

const path = require('node:path');
const { parsePathList } = require('../library-roots');

function createGenericPlatform({ env = process.env }) {
  const data = path.resolve(env.ZHENSHU_DATA_DIR || '/data');
  return {
    name: 'generic',
    paths: {
      data,
      config: path.resolve(env.ZHENSHU_CONFIG_DIR || '/config'),
      socket: env.ZHENSHU_SOCKET || path.join(data, 'app.sock')
    },

    identify(request) {
      const uid = request.headers['x-trim-userid'];
      if (!uid) throw Object.assign(new Error('Missing authenticated user context'), { statusCode: 401 });
      return {
        uid: String(uid),
        username: String(request.headers['x-trim-username'] || ''),
        isAdmin: request.headers['x-trim-isadmin'] === 'true'
      };
    },

    libraryRoots() {
      return { accessibleRoots: parsePathList(env.ZHENSHU_LIBRARY_ROOTS), sharedRoots: [] };
    },

    // The folders are fixed for the life of the process.
    rootsRevision() {
      return 'static';
    },

    syncAtStart() {}
  };
}

module.exports = { createGenericPlatform };
