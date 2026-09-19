'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeUserId(value) {
  const uid = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(uid)) {
    throw new Error('Invalid fnOS user ID');
  }
  return uid;
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await ensureDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await fs.writeFile(temporary, payload, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

class UserStorage {
  constructor(dataRoot) {
    if (!path.isAbsolute(dataRoot)) {
      throw new Error('Storage root must be absolute');
    }
    this.dataRoot = path.resolve(dataRoot);
    this.userMutationQueues = new Map();
  }

  userDirectory(uid) {
    return path.join(this.dataRoot, 'users', normalizeUserId(uid));
  }

  async mutateUserState(uid, mutation) {
    const normalizedUid = normalizeUserId(uid);
    const previous = this.userMutationQueues.get(normalizedUid) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const state = await this.getState(normalizedUid);
      const result = await mutation(state);
      await writeJsonAtomic(
        path.join(this.userDirectory(normalizedUid), 'reading-state.json'),
        state
      );
      return result;
    });
    this.userMutationQueues.set(normalizedUid, operation);
    operation.finally(() => {
      if (this.userMutationQueues.get(normalizedUid) === operation) {
        this.userMutationQueues.delete(normalizedUid);
      }
    }).catch(() => {});
    return operation;
  }

  async initialize() {
    await ensureDirectory(path.join(this.dataRoot, 'users'));
    await ensureDirectory(path.join(this.dataRoot, 'index'));
  }

  async getState(uid) {
    const directory = this.userDirectory(uid);
    const state = await readJson(path.join(directory, 'reading-state.json'), {
      version: 2,
      books: {},
      settings: {}
    });
    return {
      version: 2,
      books: state.books && typeof state.books === 'object' && !Array.isArray(state.books)
        ? state.books
        : {},
      settings: state.settings && typeof state.settings === 'object' && !Array.isArray(state.settings)
        ? state.settings
        : {}
    };
  }

  async updateSettings(uid, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('Invalid user settings');
    }

    return this.mutateUserState(uid, async (state) => {
      const allowedThemes = new Set(['dark', 'light', 'sepia']);
      const allowedHighlightColors = new Set(['yellow', 'green', 'blue', 'pink']);
      // Body font stacks are keyed, not free-form: the client owns the actual
      // font-family strings, the server only accepts known keys.
      const allowedFontFamilies = new Set(['sans', 'songti', 'source-serif']);
      // 'single' is no longer a user-selectable mode: legacy values migrate to
      // 'double'. It survives only as the client's narrow-window fallback.
      const allowedReadingModes = new Set(['scroll', 'double']);
      const normalizeMode = (value) => (value === 'single' ? 'double' : value);
      const previousReadingMode = allowedReadingModes.has(state.settings.readingMode)
        ? state.settings.readingMode
        : state.settings.continuousScroll === false ? 'double' : 'scroll';
      const readingMode = allowedReadingModes.has(settings.readingMode)
        ? normalizeMode(settings.readingMode)
        : typeof settings.continuousScroll === 'boolean'
          ? settings.continuousScroll ? 'scroll' : 'double'
          : previousReadingMode;
      const next = {
        theme: allowedThemes.has(settings.theme) ? settings.theme : 'dark',
        fontSize: Number.isFinite(settings.fontSize)
          ? Math.max(60, Math.min(200, Math.round(settings.fontSize)))
          : Number.isFinite(state.settings.fontSize) ? state.settings.fontSize : 100,
        lineHeight: Number.isFinite(settings.lineHeight)
          ? Math.max(1.2, Math.min(2.6, Math.round(settings.lineHeight * 10) / 10))
          : Number.isFinite(state.settings.lineHeight) ? state.settings.lineHeight : 1.9,
        pageMargin: Number.isFinite(settings.pageMargin)
          ? Math.max(8, Math.min(96, Math.round(settings.pageMargin)))
          : Number.isFinite(state.settings.pageMargin) ? state.settings.pageMargin : 40,
        readingMode,
        continuousScroll: readingMode === 'scroll',
        tocOpen: settings.tocOpen !== false,
        highlightColor: allowedHighlightColors.has(settings.highlightColor)
          ? settings.highlightColor
          : allowedHighlightColors.has(state.settings.highlightColor) ? state.settings.highlightColor : 'yellow',
        // Typography (P0). Same clamps as the client so a hand-crafted request
        // cannot push the reader outside the supported range.
        textIndent: Number.isFinite(settings.textIndent)
          ? Math.max(0, Math.min(4, Math.round(settings.textIndent * 2) / 2))
          : Number.isFinite(state.settings.textIndent) ? state.settings.textIndent : 2,
        paragraphSpacing: Number.isFinite(settings.paragraphSpacing)
          ? Math.max(0.4, Math.min(3, Math.round(settings.paragraphSpacing * 10) / 10))
          : Number.isFinite(state.settings.paragraphSpacing) ? state.settings.paragraphSpacing : 1.1,
        fontFamily: allowedFontFamilies.has(settings.fontFamily)
          ? settings.fontFamily
          : allowedFontFamilies.has(state.settings.fontFamily) ? state.settings.fontFamily : 'sans',
        updatedAt: new Date().toISOString()
      };
      state.settings = { ...state.settings, ...next };
      return state.settings;
    });
  }

  async updateProgress(uid, bookId, progress) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
      throw new Error('Invalid reading progress');
    }

    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || { highlights: [] };
      state.books[bookId] = {
        ...previous,
        progress: {
          locator: String(progress.locator || '').slice(0, 4096),
          percentage: Number.isFinite(progress.percentage)
            ? Math.max(0, Math.min(1, progress.percentage))
            : null,
          updatedAt: new Date().toISOString()
        }
      };
      return state.books[bookId].progress;
    });
  }

  async replaceHighlights(uid, bookId, highlights) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    if (!Array.isArray(highlights) || highlights.length > 10000) {
      throw new Error('Invalid highlights collection');
    }

    const allowedColors = new Set(['yellow', 'green', 'blue', 'pink']);
    const cleaned = highlights.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`Invalid highlight at index ${index}`);
      }

      const id = String(item.id || '').trim().slice(0, 128);
      const locator = String(item.locator || '').slice(0, 32768);
      const chapterHref = String(item.chapterHref || '').replace(/\\/g, '/').slice(0, 2048);
      const text = String(item.text || '').slice(0, 4000);
      if (!id || !locator || !text) {
        throw new Error(`Incomplete highlight at index ${index}`);
      }
      if (chapterHref.startsWith('/') || chapterHref.split('/').includes('..')) {
        throw new Error(`Invalid highlight chapterHref at index ${index}`);
      }

      return {
        id,
        locator,
        chapterHref,
        text,
        contextBefore: String(item.contextBefore || '').slice(-1000),
        contextAfter: String(item.contextAfter || '').slice(0, 1000),
        note: String(item.note || '').slice(0, 4000),
        color: allowedColors.has(item.color) ? item.color : 'yellow',
        createdAt: String(item.createdAt || new Date().toISOString()).slice(0, 64)
      };
    });

    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || {};
      state.books[bookId] = {
        ...previous,
        highlights: cleaned,
        highlightsUpdatedAt: new Date().toISOString()
      };
      return cleaned;
    });
  }

  async saveLibraryIndex(index) {
    if (!index || !Array.isArray(index.books)) {
      throw new Error('Invalid library index');
    }
    await writeJsonAtomic(path.join(this.dataRoot, 'index', 'library.json'), index);
  }

  async getLibraryIndex() {
    return readJson(path.join(this.dataRoot, 'index', 'library.json'), {
      version: 1,
      generatedAt: null,
      books: []
    });
  }
}

module.exports = {
  UserStorage,
  normalizeUserId,
  readJson,
  writeJsonAtomic
};
