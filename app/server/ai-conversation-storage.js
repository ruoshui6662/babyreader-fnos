'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  normalizeUserId,
  readJson,
  writeJsonAtomic
} = require('./storage');

const CONVERSATION_VERSION = 1;
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES = 100;
const MAX_QUESTION_LENGTH = 4000;
const MAX_ANSWER_LENGTH = 32000;
const MAX_TITLE_LENGTH = 120;
const MAX_SOURCES = 12;
const MAX_SOURCE_LABEL_LENGTH = 240;
const MAX_SOURCE_HREF_LENGTH = 2048;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validBookId(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''));
}

function validConversationId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeUid(uid) {
  try {
    return normalizeUserId(uid);
  } catch {
    throw storageError('INVALID_USER_ID', 'Invalid fnOS user ID');
  }
}

function normalizeBookId(bookId) {
  const normalized = String(bookId || '');
  if (!validBookId(normalized)) throw storageError('INVALID_BOOK_ID', 'Invalid book ID');
  return normalized;
}

function normalizeConversationId(conversationId) {
  const normalized = String(conversationId || '');
  if (!validConversationId(normalized)) {
    throw storageError('INVALID_CONVERSATION_ID', 'Invalid conversation ID');
  }
  return normalized;
}

function normalizeTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (title.length > MAX_TITLE_LENGTH) {
    throw storageError('INVALID_CONVERSATION_TITLE', 'Conversation title is too long');
  }
  return title || '新对话';
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw storageError('INVALID_CONVERSATION_SOURCE', 'Invalid conversation source');
  }
  const allowedKeys = new Set(['citationIndex', 'chapterIndex', 'chapterHref', 'chapterLabel', 'startOffset', 'sourceFingerprint']);
  if (Object.keys(source).some((key) => !allowedKeys.has(key))) {
    throw storageError('INVALID_CONVERSATION_SOURCE', 'Conversation source contains unsupported data');
  }

  const citationIndex = Number(source.citationIndex);
  const chapterIndex = Number(source.chapterIndex);
  const chapterHref = String(source.chapterHref || '').replace(/\\/g, '/').trim();
  const chapterLabel = String(source.chapterLabel || '').replace(/\s+/g, ' ').trim();
  const startOffset = source.startOffset === undefined ? null : Number(source.startOffset);
  const sourceFingerprint = source.sourceFingerprint === undefined ? null : String(source.sourceFingerprint);
  if (!Number.isInteger(citationIndex) || citationIndex < 1
    || !Number.isInteger(chapterIndex) || chapterIndex < 0
    || chapterHref.length > MAX_SOURCE_HREF_LENGTH
    || chapterHref.startsWith('/') || chapterHref.split('/').includes('..')
    || /^[a-z]+:/i.test(chapterHref)
    || chapterLabel.length > MAX_SOURCE_LABEL_LENGTH
    || (startOffset !== null && (!Number.isSafeInteger(startOffset) || startOffset < 0))
    || (sourceFingerprint !== null && !/^[a-f0-9]{64}$/.test(sourceFingerprint))) {
    throw storageError('INVALID_CONVERSATION_SOURCE', 'Invalid conversation source');
  }
  return {
    citationIndex,
    chapterIndex,
    chapterHref,
    chapterLabel,
    ...(startOffset !== null ? { startOffset } : {}),
    ...(sourceFingerprint !== null ? { sourceFingerprint } : {})
  };
}

function normalizeSources(sources) {
  if (sources === undefined || sources === null) return [];
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES) {
    throw storageError('INVALID_CONVERSATION_SOURCE', 'Too many conversation sources');
  }
  return sources.map(normalizeSource);
}

function normalizeCompletedTurn(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw storageError('INVALID_CONVERSATION_MESSAGE', 'Invalid completed conversation turn');
  }
  const question = String(input.question || '').trim();
  const answer = String(input.answer || '').trim();
  if (!question || question.length > MAX_QUESTION_LENGTH
    || !answer || answer.length > MAX_ANSWER_LENGTH) {
    throw storageError('INVALID_CONVERSATION_MESSAGE', 'Invalid completed conversation turn');
  }
  return { question, answer, sources: normalizeSources(input.sources) };
}

function validateStoredMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || !validConversationId(message.id)
    || !['user', 'assistant'].includes(message.role)
    || typeof message.content !== 'string'
    || !message.content.trim()
    || message.content.length > (message.role === 'user' ? MAX_QUESTION_LENGTH : MAX_ANSWER_LENGTH)
    || typeof message.createdAt !== 'string') {
    throw storageError('CONVERSATION_STORE_CORRUPT', 'Conversation store is invalid');
  }
  const allowedKeys = message.role === 'assistant'
    ? new Set(['id', 'role', 'content', 'sources', 'createdAt'])
    : new Set(['id', 'role', 'content', 'createdAt']);
  if (Object.keys(message).some((key) => !allowedKeys.has(key))) {
    throw storageError('CONVERSATION_STORE_CORRUPT', 'Conversation store is invalid');
  }
  if (message.role === 'assistant') normalizeSources(message.sources);
}

function validateStore(store, bookId) {
  if (!store || typeof store !== 'object' || Array.isArray(store)
    || store.version !== CONVERSATION_VERSION
    || store.bookId !== bookId
    || !Array.isArray(store.conversations)
    || store.conversations.length > MAX_CONVERSATIONS
    || (store.activeConversationId !== null && !validConversationId(store.activeConversationId))) {
    throw storageError('CONVERSATION_STORE_CORRUPT', 'Conversation store is invalid');
  }
  const ids = new Set();
  for (const conversation of store.conversations) {
    if (!conversation || typeof conversation !== 'object' || Array.isArray(conversation)
      || !validConversationId(conversation.id)
      || ids.has(conversation.id)
      || typeof conversation.title !== 'string'
      || conversation.title.length > MAX_TITLE_LENGTH
      || typeof conversation.createdAt !== 'string'
      || typeof conversation.updatedAt !== 'string'
      || !Array.isArray(conversation.messages)
      || conversation.messages.length > MAX_MESSAGES) {
      throw storageError('CONVERSATION_STORE_CORRUPT', 'Conversation store is invalid');
    }
    ids.add(conversation.id);
    for (const message of conversation.messages) validateStoredMessage(message);
  }
  if (store.activeConversationId && !ids.has(store.activeConversationId)) {
    throw storageError('CONVERSATION_STORE_CORRUPT', 'Conversation store is invalid');
  }
  return store;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializedSize(store) {
  return Buffer.byteLength(`${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function createAiConversationStorage({ dataRoot, now = () => new Date() } = {}) {
  if (!path.isAbsolute(String(dataRoot || ''))) {
    throw new Error('AI conversation storage root must be absolute');
  }
  const resolvedDataRoot = path.resolve(dataRoot);
  const mutationQueues = new Map();

  function filePath(uid, bookId) {
    const normalizedUid = normalizeUid(uid);
    const normalizedBookId = normalizeBookId(bookId);
    return path.join(
      resolvedDataRoot,
      'users',
      normalizedUid,
      'ai-conversations',
      `${normalizedBookId}.json`
    );
  }

  function emptyStore(bookId) {
    return {
      version: CONVERSATION_VERSION,
      bookId,
      activeConversationId: null,
      conversations: []
    };
  }

  async function readStore(uid, bookId) {
    const normalizedBookId = normalizeBookId(bookId);
    const target = filePath(uid, normalizedBookId);
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw storageError('CONVERSATION_UNSAFE_TARGET', 'Conversation store target is unsafe');
      }
      if (stat.size > MAX_FILE_BYTES) {
        throw storageError('CONVERSATION_SIZE_LIMIT', 'Conversation store exceeds the size limit');
      }
    } catch (error) {
      if (error.code === 'ENOENT') return emptyStore(normalizedBookId);
      if (error.code === 'CONVERSATION_SIZE_LIMIT' || error.code === 'CONVERSATION_UNSAFE_TARGET') throw error;
      throw storageError('CONVERSATION_STORE_UNAVAILABLE', 'Conversation store is unavailable');
    }

    let store;
    try {
      store = await readJson(target, null);
    } catch {
      throw storageError('CONVERSATION_STORE_CORRUPT', 'Conversation store is corrupt');
    }
    if (store === null) return emptyStore(normalizedBookId);
    return validateStore(store, normalizedBookId);
  }

  async function mutateStore(uid, bookId, mutation) {
    const normalizedUid = normalizeUid(uid);
    const normalizedBookId = normalizeBookId(bookId);
    const key = `${normalizedUid}:${normalizedBookId}`;
    const previous = mutationQueues.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const store = await readStore(normalizedUid, normalizedBookId);
      let changed = false;
      const markChanged = () => { changed = true; };
      const result = await mutation(store, markChanged);
      if (changed) {
        if (serializedSize(store) > MAX_FILE_BYTES) {
          throw storageError('CONVERSATION_SIZE_LIMIT', 'Conversation store exceeds the size limit');
        }
        await writeJsonAtomic(filePath(normalizedUid, normalizedBookId), store);
      }
      return result;
    });
    mutationQueues.set(key, operation);
    operation.finally(() => {
      if (mutationQueues.get(key) === operation) mutationQueues.delete(key);
    }).catch(() => {});
    return operation;
  }

  function findConversation(store, conversationId) {
    const normalizedId = normalizeConversationId(conversationId);
    const conversation = store.conversations.find((item) => item.id === normalizedId);
    if (!conversation) throw storageError('CONVERSATION_NOT_FOUND', 'Conversation not found');
    return conversation;
  }

  async function createConversation(uid, bookId, { title = '' } = {}) {
    return mutateStore(uid, bookId, async (store, markChanged) => {
      if (store.conversations.length >= MAX_CONVERSATIONS) {
        throw storageError('CONVERSATION_LIMIT', 'Conversation limit exceeded');
      }
      const timestamp = now().toISOString();
      const conversation = {
        id: crypto.randomUUID(),
        title: normalizeTitle(title),
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
      };
      store.conversations.push(conversation);
      store.activeConversationId = conversation.id;
      markChanged();
      return clone(conversation);
    });
  }

  async function listConversations(uid, bookId) {
    const store = await readStore(uid, bookId);
    return store.conversations
      .slice()
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        messageCount: conversation.messages.length,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      }));
  }

  async function getConversationState(uid, bookId) {
    const normalizedBookId = normalizeBookId(bookId);
    const store = await readStore(uid, normalizedBookId);
    return {
      activeConversationId: store.activeConversationId,
      conversations: store.conversations
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          messageCount: conversation.messages.length,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        }))
    };
  }

  async function getConversation(uid, bookId, conversationId) {
    const store = await readStore(uid, bookId);
    return clone(findConversation(store, conversationId));
  }

  async function appendCompletedTurn(uid, bookId, conversationId, input) {
    const turn = normalizeCompletedTurn(input);
    return mutateStore(uid, bookId, async (store, markChanged) => {
      const conversation = findConversation(store, conversationId);
      if (conversation.messages.length + 2 > MAX_MESSAGES) {
        throw storageError('CONVERSATION_MESSAGE_LIMIT', 'Conversation message limit exceeded');
      }
      const timestamp = now().toISOString();
      conversation.messages.push(
        { id: crypto.randomUUID(), role: 'user', content: turn.question, createdAt: timestamp },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: turn.answer,
          sources: turn.sources,
          createdAt: timestamp
        }
      );
      if (!conversation.messages.length || conversation.title === '新对话') {
        conversation.title = turn.question.slice(0, MAX_TITLE_LENGTH);
      }
      conversation.updatedAt = timestamp;
      store.activeConversationId = conversation.id;
      markChanged();
      return clone(conversation);
    });
  }

  async function clearConversation(uid, bookId, conversationId) {
    return mutateStore(uid, bookId, async (store, markChanged) => {
      const conversation = findConversation(store, conversationId);
      conversation.messages = [];
      conversation.updatedAt = now().toISOString();
      store.activeConversationId = conversation.id;
      markChanged();
      return clone(conversation);
    });
  }

  async function deleteConversation(uid, bookId, conversationId) {
    return mutateStore(uid, bookId, async (store, markChanged) => {
      const normalizedId = normalizeConversationId(conversationId);
      const index = store.conversations.findIndex((item) => item.id === normalizedId);
      if (index < 0) return { deleted: false, id: normalizedId };
      store.conversations.splice(index, 1);
      if (store.activeConversationId === normalizedId) {
        const next = store.conversations.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        store.activeConversationId = next?.id || null;
      }
      markChanged();
      return { deleted: true, id: normalizedId };
    });
  }

  return {
    createConversation,
    listConversations,
    getConversationState,
    getConversation,
    appendCompletedTurn,
    deleteConversation,
    clearConversation
  };
}

module.exports = {
  createAiConversationStorage,
  MAX_CONVERSATIONS,
  MAX_MESSAGES,
  MAX_QUESTION_LENGTH,
  MAX_ANSWER_LENGTH,
  MAX_SOURCES,
  MAX_FILE_BYTES
};
