'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function cleanRoots(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((root) => typeof root === 'string')
    .map((root) => root.trim())
    .filter(Boolean);
}

function parsePathList(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const entries = [];
  let current = '';
  for (const character of value) {
    if (character === ':' && !(current.length === 1 && /^[A-Za-z]$/.test(current))) {
      if (current.trim()) entries.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}

function collectRootCandidates({ configuredRoots = [], accessibleRoots = [], sharedRoots = [] } = {}) {
  return [
    ...cleanRoots(configuredRoots).map((root) => ({ root, source: 'configured' })),
    ...cleanRoots(accessibleRoots).map((root) => ({ root, source: 'accessible' })),
    ...cleanRoots(sharedRoots).map((root) => ({ root, source: 'shared' }))
  ];
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function errorDetails(error) {
  return {
    error: String(error?.message || error || 'Unable to access library root'),
    code: error?.code ? String(error.code) : null
  };
}

async function resolveLibraryRoots({
  configuredRoots = [],
  accessibleRoots = [],
  sharedRoots = [],
  fsImpl = fs
} = {}) {
  const normalizedConfigured = cleanRoots(configuredRoots);
  const normalizedAccessible = cleanRoots(accessibleRoots);
  const normalizedShared = cleanRoots(sharedRoots);
  const rejectedRoots = [];
  const resolvedCandidates = [];
  const seenRealRoots = new Set();

  for (const candidate of collectRootCandidates({
    configuredRoots: normalizedConfigured,
    accessibleRoots: normalizedAccessible,
    sharedRoots: normalizedShared
  })) {
    try {
      const realRoot = await fsImpl.realpath(candidate.root);
      const stat = await fsImpl.stat(realRoot);
      if (!stat.isDirectory()) throw Object.assign(new Error('路径不是目录'), { code: 'ENOTDIR' });
      await fsImpl.access(realRoot);
      if (seenRealRoots.has(realRoot)) continue;
      seenRealRoots.add(realRoot);
      resolvedCandidates.push({ ...candidate, realRoot });
    } catch (error) {
      rejectedRoots.push({ root: candidate.root, ...errorDetails(error) });
    }
  }

  const rootSources = {};
  for (const candidate of resolvedCandidates) {
    if (!rootSources[candidate.realRoot]) rootSources[candidate.realRoot] = candidate.source;
  }
  const authorizedRoots = resolvedCandidates
    .map((candidate, index) => ({ ...candidate, index }))
    .sort((left, right) => left.realRoot.length - right.realRoot.length || left.index - right.index)
    .filter((candidate, index, candidates) => !candidates
      .slice(0, index)
      .some((parent) => isPathInside(parent.realRoot, candidate.realRoot)))
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.realRoot);

  return {
    configuredRoots: normalizedConfigured,
    accessibleRoots: normalizedAccessible,
    sharedRoots: normalizedShared,
    authorizedRoots,
    rootSources,
    rejectedRoots
  };
}

module.exports = {
  collectRootCandidates,
  isPathInside,
  parsePathList,
  resolveLibraryRoots
};
