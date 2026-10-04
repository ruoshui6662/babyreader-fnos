'use strict';

// Where the app runs. Everything the server needs from its host goes through
// one platform object:
//   paths            { data, config, socket }
//   identify(req)    the signed-in user { uid, username, isAdmin }, or throws 401
//   libraryRoots(c)  { accessibleRoots, sharedRoots } besides app settings
//   rootsRevision(c) changes when those folders may have changed
//   syncAtStart(c)   reconciles the host's folder grant at start-up
// fnOS is the default; ZHENSHU_PLATFORM=generic selects the generic host
// reserved for a Docker image.

const { createFnOSPlatform } = require('./fnos');
const { createGenericPlatform } = require('./generic');

const PLATFORMS = { fnos: createFnOSPlatform, generic: createGenericPlatform };

function createPlatform({ env = process.env, appRoot }) {
  const name = String(env.ZHENSHU_PLATFORM || 'fnos').trim().toLowerCase();
  const create = PLATFORMS[name];
  if (!create) throw new Error(`Unknown ZHENSHU_PLATFORM: ${name}`);
  return create({ env, appRoot });
}

module.exports = { createPlatform };
