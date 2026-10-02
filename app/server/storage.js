'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MAX_ORGANIZATION_BYTES,
  createEmptyLibraryOrganization,
  normalizeLibraryOrganization
} = require('./library-organization');
const {
  MAX_PDF_ANNOTATIONS_PER_BOOK,
  normalizePdfAnnotationCreate,
  normalizePdfAnnotationEdit,
  assertPdfAnnotationCollection,
  annotationPayload
} = require('./pdf-annotation-contract');

const MAX_BOOKMARKS_PER_BOOK = 200;
const MAX_BOOKMARK_LABEL_LENGTH = 120;
const MAX_BOOKMARK_LOCATOR_TEXT_LENGTH = 240;
const MAX_BOOKMARK_LOCATOR_HREF_LENGTH = 2048;
const MAX_BOOKMARK_LOCATOR_ANCHOR_LENGTH = 512;
const MAX_BOOKMARK_PDF_PAGE_COUNT = 10000;

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

function normalizeBookmarkLocator(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bookmark locator');
  }

  const version = Number(value.version);
  const type = String(value.type || '');
  if (version === 1 && type === 'pdf') {
    if (!Number.isInteger(value.pageIndex)
      || value.pageIndex < 0
      || value.pageIndex >= MAX_BOOKMARK_PDF_PAGE_COUNT) {
      throw new Error('Invalid bookmark locator');
    }
    return { version: 1, type: 'pdf', pageIndex: value.pageIndex };
  }

  const readingScope = String(value.readingScope || '');
  const href = String(value.href || '').replace(/\\/g, '/');
  if (version !== 2 || type !== 'semantic-position' || !['page', 'chapter'].includes(readingScope)) {
    throw new Error('Invalid bookmark locator');
  }
  if (!href || href.length > MAX_BOOKMARK_LOCATOR_HREF_LENGTH
    || href.startsWith('/')
    || /^[a-z]+:/i.test(href)
    || href.split('/').includes('..')) {
    throw new Error('Invalid bookmark locator');
  }

  const locator = { version: 2, type, readingScope, href };
  const optionalStrings = [
    ['anchor', MAX_BOOKMARK_LOCATOR_ANCHOR_LENGTH],
    ['textBefore', MAX_BOOKMARK_LOCATOR_TEXT_LENGTH]
  ];
  for (const [key, maxLength] of optionalStrings) {
    if (value[key] !== undefined && value[key] !== null) {
      const normalized = String(value[key]).trim().slice(0, maxLength);
      if (normalized) locator[key] = normalized;
    }
  }

  const optionalNumbers = [
    ['pageNumber', Number.isInteger],
    ['scrollTop', Number.isFinite],
    ['percentage', Number.isFinite],
    ['chapterPercentage', Number.isFinite]
  ];
  for (const [key, validator] of optionalNumbers) {
    if (value[key] === undefined || value[key] === null) continue;
    const number = Number(value[key]);
    if (!validator(number)
      || number < 0
      || (['percentage', 'chapterPercentage'].includes(key) && number > 1)) {
      throw new Error('Invalid bookmark locator');
    }
    locator[key] = number;
  }

  if (!locator.anchor && !locator.textBefore && !Number.isFinite(locator.pageNumber)) {
    throw new Error('Invalid bookmark locator');
  }
  return locator;
}

function bookmarkLocatorKey(locator) {
  const normalized = normalizeBookmarkLocator(locator);
  if (normalized.type === 'pdf') return JSON.stringify(normalized);
  return JSON.stringify({
    version: normalized.version,
    type: normalized.type,
    readingScope: normalized.readingScope,
    href: normalized.href,
    anchor: normalized.anchor || '',
    textBefore: normalized.textBefore || '',
    pageNumber: normalized.anchor || normalized.textBefore ? null : normalized.pageNumber
  });
}

function normalizeBookmarkLabel(value) {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  if (label.length > MAX_BOOKMARK_LABEL_LENGTH) throw new Error('Bookmark label is too long');
  return label || '书签';
}

function storedBookmark(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  try {
    const locator = normalizeBookmarkLocator(item.locator);
    const id = String(item.id || '').trim().slice(0, 128);
    if (!id) return null;
    return {
      id,
      locator,
      label: normalizeBookmarkLabel(item.label),
      createdAt: String(item.createdAt || '').slice(0, 64) || new Date().toISOString(),
      updatedAt: String(item.updatedAt || item.createdAt || '').slice(0, 64) || new Date().toISOString()
    };
  } catch {
    return null;
  }
}

class UserStorage {
  constructor(dataRoot) {
    if (!path.isAbsolute(dataRoot)) {
      throw new Error('Storage root must be absolute');
    }
    this.dataRoot = path.resolve(dataRoot);
    this.userMutationQueues = new Map();
    this.libraryOrganizationMutationQueues = new Map();
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
      const allowedReaderFonts = new Set(['source-serif', 'wenkai', 'fangsong', 'sans', 'songti']);
      // 'single' is no longer a user-selectable mode: legacy values migrate to
      // 'double'. It survives only as the client's narrow-window fallback.
      const allowedReadingModes = new Set(['scroll', 'double']);
      const allowedPdfLayoutModes = new Set(['continuous', 'single', 'double']);
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
        // Phones keep their own mode; default 左右翻页.
        mobileReadingMode: ['paged', 'scroll'].includes(settings.mobileReadingMode)
          ? settings.mobileReadingMode
          : ['paged', 'scroll'].includes(state.settings.mobileReadingMode) ? state.settings.mobileReadingMode : 'paged',
        pdfLayoutMode: allowedPdfLayoutModes.has(settings.pdfLayoutMode)
          ? settings.pdfLayoutMode
          : allowedPdfLayoutModes.has(state.settings.pdfLayoutMode)
            ? state.settings.pdfLayoutMode : 'continuous',
        // Opt-in: opening a book shows the text, not the contents panel.
        // Replaces tocOpen, which every save wrote as true.
        tocAutoOpen: settings.tocAutoOpen === true,
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
        // Replaces fontFamily, which every save wrote as 'sans' (the old
        // default), so it could not tell a real choice apart.
        readerFont: allowedReaderFonts.has(settings.readerFont)
          ? settings.readerFont
          : allowedReaderFonts.has(state.settings.readerFont) ? state.settings.readerFont : 'source-serif',
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
    const allowedKinds = new Set(['highlight', 'thought']);
    const allowedStyles = new Set(['marker', 'wave', 'line', 'none']);
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

      const thought = String(item.thought || item.note || '').slice(0, 4000);
      return {
        id,
        locator,
        chapterHref,
        text,
        contextBefore: String(item.contextBefore || '').slice(-1000),
        contextAfter: String(item.contextAfter || '').slice(0, 1000),
        thought,
        // Keep the legacy field mirrored for older clients and existing data.
        note: thought,
        color: allowedColors.has(item.color) ? item.color : 'yellow',
        kind: allowedKinds.has(item.kind) ? item.kind : 'highlight',
        style: allowedStyles.has(item.style) ? item.style : 'marker',
        createdAt: String(item.createdAt || new Date().toISOString()).slice(0, 64),
        updatedAt: String(item.updatedAt || item.createdAt || new Date().toISOString()).slice(0, 64)
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

  async listPdfAnnotations(uid, bookId) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    const state = await this.getState(uid);
    const saved = state.books[bookId]?.pdfAnnotations;
    if (saved === undefined) return [];
    return assertPdfAnnotationCollection(saved);
  }

  async createPdfAnnotation(uid, bookId, input, sourceFingerprint) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    const annotation = normalizePdfAnnotationCreate(input, sourceFingerprint);
    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || {};
      const existing = previous.pdfAnnotations === undefined
        ? [] : assertPdfAnnotationCollection(previous.pdfAnnotations);
      const duplicate = existing.find((item) => item.id === annotation.id);
      if (duplicate) {
        if (JSON.stringify(annotationPayload(duplicate)) !== JSON.stringify(annotationPayload(annotation))) {
          throw Object.assign(new Error('PDF annotation ID already exists with different content'), {
            code: 'PDF_ANNOTATION_CONFLICT', statusCode: 409
          });
        }
        return duplicate;
      }
      if (existing.length >= MAX_PDF_ANNOTATIONS_PER_BOOK) {
        throw Object.assign(new Error('PDF annotation limit exceeded'), { code: 'PDF_ANNOTATION_LIMIT', statusCode: 413 });
      }

      const annotations = assertPdfAnnotationCollection([...existing, annotation]);
      state.books[bookId] = {
        ...previous,
        pdfAnnotations: annotations,
        pdfAnnotationsUpdatedAt: annotation.updatedAt
      };
      return annotation;
    });
  }

  async updatePdfAnnotation(uid, bookId, annotationId, input) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    const id = String(annotationId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw Object.assign(new Error('Invalid PDF annotation ID'), { code: 'INVALID_PDF_ANNOTATION', statusCode: 400 });
    }
    const patch = normalizePdfAnnotationEdit(input);
    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || {};
      const existing = previous.pdfAnnotations === undefined
        ? [] : assertPdfAnnotationCollection(previous.pdfAnnotations);
      const index = existing.findIndex((item) => item.id === id);
      if (index < 0) throw Object.assign(new Error('PDF annotation not found'), { code: 'PDF_ANNOTATION_NOT_FOUND', statusCode: 404 });
      const updated = { ...existing[index], ...patch, updatedAt: new Date().toISOString() };
      const annotations = existing.slice();
      annotations[index] = updated;
      const normalized = assertPdfAnnotationCollection(annotations);
      state.books[bookId] = {
        ...previous,
        pdfAnnotations: normalized,
        pdfAnnotationsUpdatedAt: updated.updatedAt
      };
      return normalized[index];
    });
  }

  async deletePdfAnnotation(uid, bookId, annotationId) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    const id = String(annotationId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw Object.assign(new Error('Invalid PDF annotation ID'), { code: 'INVALID_PDF_ANNOTATION', statusCode: 400 });
    }
    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || {};
      const existing = previous.pdfAnnotations === undefined
        ? [] : assertPdfAnnotationCollection(previous.pdfAnnotations);
      const annotations = existing.filter((item) => item.id !== id);
      if (annotations.length === existing.length) return { deleted: false, id };
      state.books[bookId] = {
        ...previous,
        pdfAnnotations: annotations,
        pdfAnnotationsUpdatedAt: new Date().toISOString()
      };
      return { deleted: true, id };
    });
  }

  async listBookmarks(uid, bookId) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    const state = await this.getState(uid);
    const bookmarks = state.books[bookId]?.bookmarks;
    if (!Array.isArray(bookmarks)) return [];
    return bookmarks.map(storedBookmark).filter(Boolean);
  }

  async addBookmark(uid, bookId, input) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Invalid bookmark');
    }

    const locator = normalizeBookmarkLocator(input.locator);
    const label = normalizeBookmarkLabel(input.label);
    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || {};
      const existing = Array.isArray(previous.bookmarks)
        ? previous.bookmarks.map(storedBookmark).filter(Boolean)
        : [];
      const key = bookmarkLocatorKey(locator);
      const duplicate = existing.find((bookmark) => bookmarkLocatorKey(bookmark.locator) === key);
      if (duplicate) return duplicate;
      if (existing.length >= MAX_BOOKMARKS_PER_BOOK) {
        throw new Error('Bookmark limit exceeded');
      }

      const now = new Date().toISOString();
      const bookmark = {
        id: crypto.randomUUID(),
        locator,
        label,
        createdAt: now,
        updatedAt: now
      };
      state.books[bookId] = {
        ...previous,
        bookmarks: [...existing, bookmark],
        bookmarksUpdatedAt: now
      };
      return bookmark;
    });
  }

  async deleteBookmark(uid, bookId, bookmarkId) {
    if (!/^[a-f0-9]{64}$/.test(String(bookId || ''))) {
      throw new Error('Invalid book ID');
    }
    const id = String(bookmarkId || '').trim();
    if (!id || id.length > 128) throw new Error('Invalid bookmark ID');

    return this.mutateUserState(uid, async (state) => {
      const previous = state.books[bookId] || {};
      const existing = Array.isArray(previous.bookmarks)
        ? previous.bookmarks.map(storedBookmark).filter(Boolean)
        : [];
      const next = existing.filter((bookmark) => bookmark.id !== id);
      if (next.length === existing.length) return { deleted: false, id };
      state.books[bookId] = {
        ...previous,
        bookmarks: next,
        bookmarksUpdatedAt: new Date().toISOString()
      };
      return { deleted: true, id };
    });
  }

  libraryOrganizationPath(uid) {
    return path.join(this.userDirectory(uid), 'library-organization.json');
  }

  async getLibraryOrganization(uid) {
    const normalizedUid = normalizeUserId(uid);
    const filePath = this.libraryOrganizationPath(normalizedUid);
    let raw;
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw Object.assign(new Error('Unsafe organization store target'), { code: 'ORGANIZATION_UNSAFE_TARGET' });
      }
      if (stat.size > MAX_ORGANIZATION_BYTES) {
        throw Object.assign(new Error('Organization store is too large'), { code: 'ORGANIZATION_STORE_TOO_LARGE' });
      }
      raw = await readJson(filePath, null);
    } catch (error) {
      if (error.code === 'ENOENT') return createEmptyLibraryOrganization();
      if (String(error.code || '').startsWith('ORGANIZATION_')) throw error;
      throw Object.assign(new Error('Organization store is corrupt'), { code: 'ORGANIZATION_STORE_CORRUPT' });
    }

    try {
      return normalizeLibraryOrganization(raw);
    } catch {
      throw Object.assign(new Error('Organization store is corrupt'), { code: 'ORGANIZATION_STORE_CORRUPT' });
    }
  }

  async mutateLibraryOrganization(uid, expectedRevision, mutation) {
    const normalizedUid = normalizeUserId(uid);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw Object.assign(new Error('Invalid organization revision'), { code: 'INVALID_ORGANIZATION_REVISION' });
    }
    if (typeof mutation !== 'function') {
      throw Object.assign(new Error('Invalid organization mutation'), { code: 'INVALID_ORGANIZATION_MUTATION' });
    }

    const previous = this.libraryOrganizationMutationQueues.get(normalizedUid) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const current = await this.getLibraryOrganization(normalizedUid);
      if (current.revision !== expectedRevision) {
        throw Object.assign(new Error('Organization revision conflict'), { code: 'ORGANIZATION_CONFLICT' });
      }

      const draft = structuredClone(current);
      const result = await mutation(draft);
      const next = normalizeLibraryOrganization(result === undefined ? draft : result);
      next.revision = current.revision + 1;
      next.updatedAt = new Date().toISOString();
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_ORGANIZATION_BYTES) {
        throw Object.assign(new Error('Organization store is too large'), { code: 'ORGANIZATION_STORE_TOO_LARGE' });
      }

      const userDirectory = this.userDirectory(normalizedUid);
      await writeJsonAtomic(this.libraryOrganizationPath(normalizedUid), next);
      await fs.chmod(userDirectory, 0o700);
      await fs.chmod(this.libraryOrganizationPath(normalizedUid), 0o600);
      return next;
    });
    this.libraryOrganizationMutationQueues.set(normalizedUid, operation);
    operation.finally(() => {
      if (this.libraryOrganizationMutationQueues.get(normalizedUid) === operation) {
        this.libraryOrganizationMutationQueues.delete(normalizedUid);
      }
    }).catch(() => {});
    return operation;
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
