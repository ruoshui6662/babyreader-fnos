'use strict';

const fs = require('node:fs/promises');
const dns = require('node:dns').promises;
const net = require('node:net');
const path = require('node:path');
const { normalizeApiFormat, resolveApiFormat } = require('./ai-transport');

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-5.5';

function clean(value, max = 1000) {
  return String(value ?? '').replace(/[\u0000\r\n]/g, '').trim().slice(0, max);
}

function normalizeBaseUrl(value) {
  const baseUrl = clean(value, 500).replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('AI 服务 URL 必须以 http:// 或 https:// 开头');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('AI 服务 URL 必须使用 http:// 或 https://，且不能包含账号信息');
  }
  if (parsed.search || parsed.hash) throw new Error('AI 服务 URL 不能包含查询参数或片段');
  if (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
    throw new Error('AI 服务 URL 端口无效');
  }
  if (isPrivateNetworkAddress(parsed.hostname) || ['localhost', 'localhost.localdomain'].includes(parsed.hostname.toLowerCase())) {
    throw new Error('AI 服务 URL 不能指向本机或内网地址');
  }
  return baseUrl;
}

function ipv4Parts(value) {
  const parts = String(value).split('.').map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPrivateNetworkAddress(value) {
  const address = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = ipv4Parts(address) || [];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51)
      || (a === 203 && b === 0);
  }
  if (version === 6) {
    return address === '::' || address === '::1'
      || /^f[cd]/i.test(address)
      || /^fe[89ab]/i.test(address)
      || (address.startsWith('::ffff:') && isPrivateNetworkAddress(address.slice(7)));
  }
  return false;
}

async function resolveSafeAiBaseUrl(value, lookupImpl = dns.lookup) {
  const baseUrl = normalizeBaseUrl(value);
  const parsed = new URL(baseUrl);
  if (net.isIP(parsed.hostname)) return baseUrl;
  let addresses;
  try {
    addresses = await lookupImpl(parsed.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('AI 服务域名无法解析');
  }
  const list = Array.isArray(addresses) ? addresses : [addresses];
  if (!list.length || list.some((item) => isPrivateNetworkAddress(item?.address || item))) {
    throw new Error('AI 服务域名解析到本机或内网地址');
  }
  return baseUrl;
}

function normalizeUserId(value) {
  const uid = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) throw new Error('Invalid fnOS user ID');
  return uid;
}

function nextSecret(input, previous, field, clearField) {
  let value = clean(previous[field], 500);
  if (input[clearField] === true) value = '';
  else if (Object.prototype.hasOwnProperty.call(input, field) && clean(input[field], 500)) value = clean(input[field], 500);
  return value;
}

function normalizeAiSettings(input = {}, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AI 配置格式无效');
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? previous.baseUrl ?? DEFAULT_BASE_URL);
  const model = clean(input.model ?? previous.model ?? DEFAULT_MODEL, 200) || DEFAULT_MODEL;
  if (!model) throw new Error('AI 模型名不能为空');
  const apiKey = nextSecret(input, previous, 'apiKey', 'clearApiKey');
  // Keep the protocol a configuration was saved with; new ones use Chat Completions.
  const apiFormat = input.apiFormat
    ? normalizeApiFormat(input.apiFormat, 'chat')
    : previous.apiFormat || (previous.apiKey || previous.baseUrl || previous.model ? 'responses' : 'chat');
  const embeddingBaseUrlInput = clean(input.embeddingBaseUrl ?? previous.embeddingBaseUrl ?? '', 500);
  return {
    baseUrl,
    model,
    apiKey,
    apiFormat,
    summaryModel: clean(input.summaryModel ?? previous.summaryModel ?? '', 200),
    embeddingModel: clean(input.embeddingModel ?? previous.embeddingModel ?? '', 200),
    embeddingBaseUrl: embeddingBaseUrlInput ? normalizeBaseUrl(embeddingBaseUrlInput) : '',
    embeddingApiKey: nextSecret(input, previous, 'embeddingApiKey', 'clearEmbeddingApiKey')
  };
}

// Embedding requests use their own endpoint and key when given, otherwise the
// chat service's. Blank model = semantic retrieval off.
function embeddingSettings(settings = {}, env = process.env) {
  const model = clean(settings.embeddingModel || env.OPENAI_EMBEDDING_MODEL, 200);
  const baseUrl = normalizeBaseUrl(settings.embeddingBaseUrl || settings.baseUrl || env.OPENAI_BASE_URL || DEFAULT_BASE_URL);
  const apiKey = clean(settings.embeddingApiKey || settings.apiKey || env.OPENAI_API_KEY, 500);
  return { configured: Boolean(model && apiKey), model, baseUrl, apiKey };
}

function publicAiConfig(settings = {}, env = process.env) {
  const baseUrl = normalizeBaseUrl(settings.baseUrl || env.OPENAI_BASE_URL || DEFAULT_BASE_URL);
  const model = clean(settings.model || env.OPENAI_MODEL || DEFAULT_MODEL, 200) || DEFAULT_MODEL;
  const hasApiKey = Boolean(clean(settings.apiKey || env.OPENAI_API_KEY, 500));
  const embedding = embeddingSettings(settings, env);
  return {
    configured: hasApiKey,
    provider: 'openai-compatible',
    baseUrl,
    model,
    apiFormat: resolveApiFormat(settings, env),
    summaryModel: clean(settings.summaryModel || env.OPENAI_SUMMARY_MODEL, 200),
    embeddingModel: embedding.model,
    embeddingBaseUrl: clean(settings.embeddingBaseUrl, 500),
    hasEmbeddingApiKey: Boolean(clean(settings.embeddingApiKey, 500)),
    embeddingConfigured: embedding.configured,
    hasApiKey,
    retrieval: embedding.configured ? 'hybrid' : 'local-lexical-rag'
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

class AiConfigStorage {
  constructor(dataRoot) {
    if (!path.isAbsolute(dataRoot)) throw new Error('AI config root must be absolute');
    this.dataRoot = path.resolve(dataRoot);
  }

  filePath(uid) {
    return path.join(this.dataRoot, 'users', normalizeUserId(uid), 'ai-config.json');
  }

  async get(uid) {
    const raw = await readJson(this.filePath(uid), {});
    return {
      baseUrl: raw.baseUrl ? normalizeBaseUrl(raw.baseUrl) : '',
      model: clean(raw.model, 200),
      apiKey: clean(raw.apiKey, 500),
      apiFormat: raw.apiFormat ? normalizeApiFormat(raw.apiFormat, 'chat') : '',
      summaryModel: clean(raw.summaryModel, 200),
      embeddingModel: clean(raw.embeddingModel, 200),
      embeddingBaseUrl: raw.embeddingBaseUrl ? normalizeBaseUrl(raw.embeddingBaseUrl) : '',
      embeddingApiKey: clean(raw.embeddingApiKey, 500)
    };
  }

  async update(uid, input) {
    const current = await this.get(uid);
    const next = normalizeAiSettings(input, current);
    await writeJsonAtomic(this.filePath(uid), next);
    return next;
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  normalizeBaseUrl,
  isPrivateNetworkAddress,
  resolveSafeAiBaseUrl,
  normalizeAiSettings,
  embeddingSettings,
  publicAiConfig,
  AiConfigStorage
};
