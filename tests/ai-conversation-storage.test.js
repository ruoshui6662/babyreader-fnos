'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createAiConversationStorage } = require('../app/server/ai-conversation-storage');

const BOOK_ID = 'a'.repeat(64);
const OTHER_BOOK_ID = 'b'.repeat(64);
const USER_ID = 'reader_1';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-ai-conversations-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function conversationFile(dataRoot, uid, bookId) {
  return path.join(dataRoot, 'users', uid, 'ai-conversations', `${bookId}.json`);
}

function completedTurn(question = '这本书主要讲了什么？', answer = '书中强调了均衡饮食。') {
  return {
    question,
    answer,
    sources: [{
      citationIndex: 1,
      chapterIndex: 2,
      chapterHref: 'chapter-03.xhtml',
      chapterLabel: '认识营养'
    }]
  };
}

test('creates and restores an isolated conversation with atomic storage metadata', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({
    dataRoot,
    now: () => new Date('2026-09-21T05:11:32.835Z')
  });

  const created = await storage.createConversation(USER_ID, BOOK_ID, { title: '首个问题' });
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.title, '首个问题');

  const updated = await storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, completedTurn());
  assert.equal(updated.messages.length, 2);
  assert.equal(updated.messages[0].role, 'user');
  assert.equal(updated.messages[1].role, 'assistant');
  assert.deepEqual(updated.messages[1].sources, [{
    citationIndex: 1,
    chapterIndex: 2,
    chapterHref: 'chapter-03.xhtml',
    chapterLabel: '认识营养'
  }]);

  const summaries = await storage.listConversations(USER_ID, BOOK_ID);
  assert.deepEqual(summaries, [{
    id: created.id,
    title: '首个问题',
    messageCount: 2,
    createdAt: '2026-09-21T05:11:32.835Z',
    updatedAt: '2026-09-21T05:11:32.835Z'
  }]);
  assert.deepEqual(await storage.getConversation(USER_ID, BOOK_ID, created.id), updated);

  const filePath = conversationFile(dataRoot, USER_ID, BOOK_ID);
  await fs.access(filePath);
  if (process.platform !== 'win32') {
    const directoryStat = await fs.stat(path.dirname(filePath));
    const fileStat = await fs.stat(filePath);
    assert.equal(directoryStat.mode & 0o777, 0o700);
    assert.equal(fileStat.mode & 0o777, 0o600);
  }
});

test('rejects invalid identity and keeps conversations isolated by book', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const created = await storage.createConversation(USER_ID, BOOK_ID);

  await assert.rejects(
    () => storage.createConversation('../outside', BOOK_ID),
    (error) => error.code === 'INVALID_USER_ID'
  );
  await assert.rejects(
    () => storage.createConversation(USER_ID, '../outside'),
    (error) => error.code === 'INVALID_BOOK_ID'
  );
  await assert.rejects(
    () => storage.getConversation(USER_ID, OTHER_BOOK_ID, created.id),
    (error) => error.code === 'CONVERSATION_NOT_FOUND'
  );
  assert.deepEqual(await storage.listConversations(USER_ID, OTHER_BOOK_ID), []);
});

test('normalizes completed messages and rejects unsafe or incomplete content', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const created = await storage.createConversation(USER_ID, BOOK_ID);

  await assert.rejects(
    () => storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, {
      question: '',
      answer: '回答'
    }),
    (error) => error.code === 'INVALID_CONVERSATION_MESSAGE'
  );
  await assert.rejects(
    () => storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, {
      question: '问题',
      answer: '回答',
      sources: [{ chapterHref: '/etc/passwd' }]
    }),
    (error) => error.code === 'INVALID_CONVERSATION_SOURCE'
  );
  await assert.rejects(
    () => storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, {
      question: '问题',
      answer: '回答',
      sources: Array.from({ length: 13 }, (_, index) => ({
        citationIndex: index + 1,
        chapterIndex: index,
        chapterHref: `chapter-${index}.xhtml`,
        chapterLabel: '章节'
      }))
    }),
    (error) => error.code === 'INVALID_CONVERSATION_SOURCE'
  );
  await assert.rejects(
    () => storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, {
      question: '问题',
      answer: '回答',
      sources: [{
        citationIndex: 1,
        chapterIndex: 1,
        chapterHref: 'chapter.xhtml',
        chapterLabel: '章节',
        text: '不应持久化检索片段'
      }]
    }),
    (error) => error.code === 'INVALID_CONVERSATION_SOURCE'
  );
});

test('does not overwrite a corrupt store automatically', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const filePath = conversationFile(dataRoot, USER_ID, BOOK_ID);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '{not-json\n', { encoding: 'utf8', mode: 0o600 });

  await assert.rejects(
    () => storage.listConversations(USER_ID, BOOK_ID),
    (error) => error.code === 'CONVERSATION_STORE_CORRUPT'
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), '{not-json\n');
});

test('does not follow a conversation file symlink', {
  skip: process.platform === 'win32'
}, async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const filePath = conversationFile(dataRoot, USER_ID, BOOK_ID);
  const outsidePath = path.join(dataRoot, 'outside.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(outsidePath, JSON.stringify({
    version: 1,
    bookId: BOOK_ID,
    activeConversationId: null,
    conversations: []
  }));
  await fs.symlink(outsidePath, filePath);

  await assert.rejects(
    () => storage.listConversations(USER_ID, BOOK_ID),
    (error) => error.code === 'CONVERSATION_UNSAFE_TARGET'
  );
});

test('serializes concurrent appends without losing a completed turn', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const created = await storage.createConversation(USER_ID, BOOK_ID);

  await Promise.all([
    storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, completedTurn('问题一', '回答一')),
    storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, completedTurn('问题二', '回答二'))
  ]);

  const restored = await storage.getConversation(USER_ID, BOOK_ID, created.id);
  assert.equal(restored.messages.length, 4);
  assert.deepEqual(
    restored.messages.filter((message) => message.role === 'user').map((message) => message.content).sort(),
    ['问题一', '问题二']
  );
});

test('clears and deletes only the selected conversation', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const first = await storage.createConversation(USER_ID, BOOK_ID, { title: '第一个' });
  const second = await storage.createConversation(USER_ID, BOOK_ID, { title: '第二个' });
  await storage.appendCompletedTurn(USER_ID, BOOK_ID, first.id, completedTurn());

  const cleared = await storage.clearConversation(USER_ID, BOOK_ID, first.id);
  assert.equal(cleared.messages.length, 0);
  assert.equal((await storage.listConversations(USER_ID, BOOK_ID)).length, 2);

  const deleted = await storage.deleteConversation(USER_ID, BOOK_ID, first.id);
  assert.deepEqual(deleted, { deleted: true, id: first.id });
  assert.equal((await storage.listConversations(USER_ID, BOOK_ID))[0].id, second.id);
  assert.deepEqual(await storage.deleteConversation(USER_ID, BOOK_ID, first.id), {
    deleted: false,
    id: first.id
  });
});

test('rejects a conversation file that exceeds the bounded size', async (t) => {
  const dataRoot = await temporaryDirectory(t);
  const storage = createAiConversationStorage({ dataRoot });
  const created = await storage.createConversation(USER_ID, BOOK_ID);
  const largeAnswer = '答'.repeat(32000);

  let rejected = null;
  for (let index = 0; index < 70 && !rejected; index += 1) {
    try {
      await storage.appendCompletedTurn(USER_ID, BOOK_ID, created.id, completedTurn(`问题${index}`, largeAnswer));
    } catch (error) {
      rejected = error;
    }
  }
  assert.equal(rejected?.code, 'CONVERSATION_SIZE_LIMIT');
});
