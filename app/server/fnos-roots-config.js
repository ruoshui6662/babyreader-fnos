'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parsePathList } = require('./library-roots');

const FILE_NAME = 'fnos-authorized-roots.json';
const MAX_PATH_LIST_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = MAX_PATH_LIST_BYTES + 4096;
const MAX_ROOTS = 256;

function normalizeAuthorizedRoots(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_PATH_LIST_BYTES) {
    throw new TypeError('Invalid fnOS authorized root list');
  }
  const roots = parsePathList(value);
  if (roots.length > MAX_ROOTS || roots.some((root) => !path.isAbsolute(root) || /[\x00-\x1f\x7f]/.test(root))) {
    throw new TypeError('Invalid fnOS authorized root list');
  }
  return roots;
}

function writeFnOSAuthorizedRoots(configRoot, value) {
  const accessibleRoots = normalizeAuthorizedRoots(value);
  const serialized = `${JSON.stringify({ version: 1, accessibleRoots })}\n`;
  if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES) {
    throw new TypeError('Invalid fnOS authorized root list');
  }
  fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
  const target = path.join(configRoot, FILE_NAME);
  const temporary = path.join(configRoot, `${FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, serialized);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return accessibleRoots;
}

function readFnOSAuthorizedRoots(configRoot, inheritedValue) {
  let content;
  try {
    const file = path.join(configRoot, FILE_NAME);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return [];
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return parsePathList(inheritedValue);
    return [];
  }
  try {
    const data = JSON.parse(content);
    if (!data || Array.isArray(data) || data.version !== 1 || !Array.isArray(data.accessibleRoots)
      || Object.keys(data).sort().join(',') !== 'accessibleRoots,version'
      || data.accessibleRoots.length > MAX_ROOTS) return [];
    const roots = data.accessibleRoots;
    if (roots.some((root) => typeof root !== 'string' || !path.isAbsolute(root)
      || /[\x00-\x1f\x7f]/.test(root))) return [];
    return roots;
  } catch {
    return [];
  }
}

function fnOSAuthorizationRevision(configRoot) {
  try {
    const stat = fs.lstatSync(path.join(configRoot, FILE_NAME));
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : `unavailable:${error.code || 'unknown'}`;
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'set' || !process.env.TRIM_PKGETC
      || !Object.hasOwn(process.env, 'TRIM_DATA_ACCESSIBLE_PATHS')) {
      throw new TypeError('Invalid fnOS authorized root update');
    }
    writeFnOSAuthorizedRoots(process.env.TRIM_PKGETC, process.env.TRIM_DATA_ACCESSIBLE_PATHS);
  } catch {
    process.stderr.write('Unable to update fnOS authorized roots\n');
    process.exitCode = 1;
  }
}

module.exports = { readFnOSAuthorizedRoots, writeFnOSAuthorizedRoots, fnOSAuthorizationRevision };
