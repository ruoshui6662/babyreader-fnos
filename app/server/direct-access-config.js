'use strict';

// Direct-port access settings (etc/direct-access.json).
//
// fnOS normally reaches 枕书 through its gateway on port 5666, which signs the
// user in and tells us who they are. The direct port bypasses the gateway, so
// it carries its own password and reads the library as one chosen fnOS user.
// The password is stored only as a scrypt hash; nothing here logs secrets.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE_NAME = 'direct-access.json';
const MAX_FILE_BYTES = 4096;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const RESERVED_PORTS = new Set([5666, 5667]);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const USERNAME_PATTERN = /^[A-Za-z0-9._@-][A-Za-z0-9._@ -]{0,63}$/;

class DirectAccessConfigError extends Error {}

function validatePort(value) {
  const text = String(value ?? '').trim();
  if (!/^[0-9]{1,5}$/.test(text)) throw new DirectAccessConfigError('端口必须是 1024 到 65535 之间的数字。');
  const port = Number(text);
  if (port < 1024 || port > 65535) throw new DirectAccessConfigError('端口必须是 1024 到 65535 之间的数字。');
  if (RESERVED_PORTS.has(port)) throw new DirectAccessConfigError('端口 5666 和 5667 由飞牛系统使用，请换一个端口。');
  return port;
}

function validatePassword(value) {
  const text = String(value ?? '');
  if (text.length < MIN_PASSWORD || text.length > MAX_PASSWORD) {
    throw new DirectAccessConfigError(`访问密码需要 ${MIN_PASSWORD} 到 ${MAX_PASSWORD} 个字符。`);
  }
  return text;
}

function validateUsername(value) {
  const text = String(value ?? '').trim();
  if (!USERNAME_PATTERN.test(text)) throw new DirectAccessConfigError('请填写有效的飞牛用户名。');
  return text;
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function verifyPassword(config, password) {
  if (!config?.hash || !config?.salt || typeof password !== 'string' || password.length > MAX_PASSWORD) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    crypto.scrypt(password, Buffer.from(config.salt, 'base64'), SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (error, derived) => {
        if (error) return resolve(false);
        const expected = Buffer.from(config.hash, 'base64');
        resolve(expected.length === derived.length && crypto.timingSafeEqual(expected, derived));
      });
  });
}

function isValidConfig(data) {
  return Boolean(data) && !Array.isArray(data) && data.version === 1
    && typeof data.enabled === 'boolean'
    && Number.isInteger(data.port) && data.port >= 1024 && data.port <= 65535 && !RESERVED_PORTS.has(data.port)
    && typeof data.username === 'string' && USERNAME_PATTERN.test(data.username)
    && typeof data.salt === 'string' && typeof data.hash === 'string' && typeof data.secret === 'string'
    && data.secret.length >= 32;
}

function readDirectAccessConfig(configRoot) {
  try {
    const file = path.join(configRoot, FILE_NAME);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isValidConfig(data) ? data : null;
  } catch {
    return null;
  }
}

function directAccessRevision(configRoot) {
  try {
    const stat = fs.lstatSync(path.join(configRoot, FILE_NAME));
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : 'unavailable';
  }
}

function writeDirectAccessConfig(configRoot, value) {
  const serialized = `${JSON.stringify(value)}\n`;
  fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
  const target = path.join(configRoot, FILE_NAME);
  const temporary = path.join(configRoot, `${FILE_NAME}.${process.pid}.${crypto.randomUUID()}.tmp`);
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
}

// Applies wizard input. `mode` is "on", "off" or "keep"; blank fields keep the
// stored value, so saving other app settings never resets direct access.
function applyDirectAccessSettings(configRoot, { mode, port, password, username }) {
  const current = readDirectAccessConfig(configRoot);
  const normalizedMode = String(mode || 'keep').trim().toLowerCase();
  if (!['on', 'off', 'keep'].includes(normalizedMode)) throw new DirectAccessConfigError('直连访问选项无效。');
  const enabled = normalizedMode === 'keep' ? Boolean(current?.enabled) : normalizedMode === 'on';
  const blank = (value) => String(value ?? '').trim() === '';

  const next = {
    version: 1,
    enabled,
    port: blank(port) ? current?.port : validatePort(port),
    username: blank(username) ? current?.username : validateUsername(username),
    salt: current?.salt,
    hash: current?.hash,
    secret: current?.secret || crypto.randomBytes(32).toString('base64')
  };
  if (!blank(password)) Object.assign(next, hashPassword(validatePassword(password)));
  if (enabled) {
    if (!next.port) throw new DirectAccessConfigError('开启直连访问需要填写端口。');
    if (!next.hash) throw new DirectAccessConfigError('开启直连访问需要设置访问密码。');
    if (!next.username) throw new DirectAccessConfigError('开启直连访问需要填写以哪个飞牛用户的身份阅读。');
  }
  // Off and never fully configured: nothing worth storing.
  if (!next.port || !next.hash || !next.username) return null;
  // A changed password or user signs every existing session out.
  if (current && (next.hash !== current.hash || next.username !== current.username)) {
    next.secret = crypto.randomBytes(32).toString('base64');
  }
  writeDirectAccessConfig(configRoot, next);
  return next;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'set' || !process.env.TRIM_PKGETC) {
      throw new DirectAccessConfigError('直连访问设置参数无效。');
    }
    applyDirectAccessSettings(process.env.TRIM_PKGETC, {
      mode: process.env.wizard_direct_mode,
      port: process.env.wizard_direct_port,
      password: process.env.wizard_direct_password,
      username: process.env.wizard_direct_user
    });
  } catch (error) {
    process.stderr.write(`${error instanceof DirectAccessConfigError ? error.message : '无法保存直连访问设置。'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DirectAccessConfigError,
  FILE_NAME,
  applyDirectAccessSettings,
  directAccessRevision,
  hashPassword,
  readDirectAccessConfig,
  validatePort,
  verifyPassword
};
