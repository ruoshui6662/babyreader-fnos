'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Mirrors pdf-/mobi-feature-config.js on purpose: each lifecycle script copies and
// runs its switch module standalone, so the two must not share a dependency.
const FILE_NAME = 'import-feature.json';

function environmentEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getBookImportEnabled(configRoot, envValue) {
  let content;
  try {
    content = fs.readFileSync(path.join(configRoot, FILE_NAME), 'utf8');
  } catch (error) {
    return error.code === 'ENOENT' ? environmentEnabled(envValue) : false;
  }
  try {
    const value = JSON.parse(content);
    if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
    if (value.version !== 1 || typeof value.enabled !== 'boolean') return false;
    if (Object.keys(value).sort().join(',') !== 'enabled,version') return false;
    return value.enabled;
  } catch {
    return false;
  }
}

function setBookImportEnabled(configRoot, wizardValue) {
  if (wizardValue !== 'true' && wizardValue !== 'false') {
    throw new TypeError('Invalid import switch value');
  }
  const enabled = wizardValue === 'true';
  fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
  const target = path.join(configRoot, FILE_NAME);
  const temporary = path.join(configRoot, `${FILE_NAME}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ version: 1, enabled })}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    return enabled;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== 'set' || !process.env.TRIM_PKGETC) {
      throw new TypeError('Invalid import switch value');
    }
    setBookImportEnabled(process.env.TRIM_PKGETC, process.argv[3]);
  } catch {
    process.stderr.write('Invalid import feature configuration\n');
    process.exitCode = 1;
  }
}

module.exports = { getBookImportEnabled, setBookImportEnabled };
