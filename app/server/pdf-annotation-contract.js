'use strict';

const MAX_PDF_ANNOTATIONS_PER_BOOK = 500;
const MAX_PDF_ANNOTATION_BYTES = 1024 * 1024;
const MAX_PDF_ANNOTATION_PAGES = 8;
const MAX_PDF_ANNOTATION_QUADS = 512;
const MAX_PDF_ANNOTATION_PAGE_INDEX = 9999;
const MAX_PDF_ANNOTATION_TEXT_LENGTH = 4000;
const MAX_PDF_ANNOTATION_CONTEXT_LENGTH = 1000;
const MAX_PDF_ANNOTATION_THOUGHT_LENGTH = 4000;

const ANNOTATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const ALLOWED_CREATE_FIELDS = new Set([
  'version', 'type', 'id', 'kind', 'style', 'color', 'text',
  'contextBefore', 'contextAfter', 'thought', 'targets'
]);
const ALLOWED_EDIT_FIELDS = new Set(['style', 'color', 'thought']);
const ALLOWED_STYLE = new Set(['marker', 'wave', 'line', 'none']);
const ALLOWED_COLOR = new Set(['yellow', 'green', 'blue', 'pink']);
const ALLOWED_KIND = new Set(['highlight', 'thought']);

function contractError(message, code = 'INVALID_PDF_ANNOTATION', statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyFields(value, allowed, label) {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw contractError(`Invalid ${label}`);
  }
}

function boundedString(value, maxLength, label, { required = false } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || (required && !value.trim())) {
    throw contractError(`Invalid PDF annotation ${label}`);
  }
  return value;
}

function normalizeQuad(input) {
  if (!Array.isArray(input) || input.length !== 8 || input.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw contractError('Invalid PDF annotation quad');
  }
  const rounded = input.map((value) => Math.round(value * 1e6) / 1e6);
  const points = [
    [rounded[0], rounded[1]], [rounded[2], rounded[3]],
    [rounded[4], rounded[5]], [rounded[6], rounded[7]]
  ];
  let direction = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-10) throw contractError('Degenerate PDF annotation quad');
    const sign = Math.sign(cross);
    if (direction && sign !== direction) throw contractError('Invalid PDF annotation quad order');
    direction = sign;
  }
  const area = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  if (area < 1e-8) throw contractError('Degenerate PDF annotation quad');
  return rounded;
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > MAX_PDF_ANNOTATION_PAGES) {
    throw contractError('Invalid PDF annotation pages');
  }
  let quadCount = 0;
  let previousPageIndex = -1;
  return targets.map((target) => {
    if (!isRecord(target) || Object.keys(target).some((key) => !['pageIndex', 'quads'].includes(key))
      || !Number.isInteger(target.pageIndex) || target.pageIndex < 0
      || target.pageIndex > MAX_PDF_ANNOTATION_PAGE_INDEX || target.pageIndex <= previousPageIndex
      || !Array.isArray(target.quads) || target.quads.length === 0) {
      throw contractError('Invalid PDF annotation page target');
    }
    previousPageIndex = target.pageIndex;
    quadCount += target.quads.length;
    if (quadCount > MAX_PDF_ANNOTATION_QUADS) throw contractError('PDF annotation quad limit exceeded', 'PDF_ANNOTATION_LIMIT', 413);
    return { pageIndex: target.pageIndex, quads: target.quads.map(normalizeQuad) };
  });
}

function normalizePdfAnnotationCreate(input, sourceFingerprint) {
  assertOnlyFields(input, ALLOWED_CREATE_FIELDS, 'PDF annotation');
  if (input.version !== 1 || input.type !== 'pdf'
    || typeof input.id !== 'string' || !ANNOTATION_ID_PATTERN.test(input.id)
    || !ALLOWED_KIND.has(input.kind) || !ALLOWED_STYLE.has(input.style) || !ALLOWED_COLOR.has(input.color)
    || typeof sourceFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(sourceFingerprint)) {
    throw contractError('Invalid PDF annotation fields');
  }
  const now = new Date().toISOString();
  return {
    version: 1,
    type: 'pdf',
    id: input.id,
    sourceFingerprint,
    kind: input.kind,
    style: input.style,
    color: input.color,
    text: boundedString(input.text, MAX_PDF_ANNOTATION_TEXT_LENGTH, 'text', { required: true }),
    contextBefore: boundedString(input.contextBefore ?? '', MAX_PDF_ANNOTATION_CONTEXT_LENGTH, 'context'),
    contextAfter: boundedString(input.contextAfter ?? '', MAX_PDF_ANNOTATION_CONTEXT_LENGTH, 'context'),
    thought: boundedString(input.thought ?? '', MAX_PDF_ANNOTATION_THOUGHT_LENGTH, 'thought'),
    targets: normalizeTargets(input.targets),
    createdAt: now,
    updatedAt: now
  };
}

function normalizePdfAnnotationEdit(input) {
  assertOnlyFields(input, ALLOWED_EDIT_FIELDS, 'PDF annotation edit');
  if (!Object.keys(input).length) throw contractError('Invalid PDF annotation edit');
  const patch = {};
  if (Object.hasOwn(input, 'style')) {
    if (!ALLOWED_STYLE.has(input.style)) throw contractError('Invalid PDF annotation style');
    patch.style = input.style;
  }
  if (Object.hasOwn(input, 'color')) {
    if (!ALLOWED_COLOR.has(input.color)) throw contractError('Invalid PDF annotation color');
    patch.color = input.color;
  }
  if (Object.hasOwn(input, 'thought')) {
    patch.thought = boundedString(input.thought, MAX_PDF_ANNOTATION_THOUGHT_LENGTH, 'thought');
  }
  return patch;
}

function normalizeStoredPdfAnnotation(input) {
  if (!isRecord(input)) throw contractError('Corrupt PDF annotation record', 'PDF_ANNOTATION_STORE_CORRUPT', 500);
  const normalized = normalizePdfAnnotationCreate({
    version: input.version,
    type: input.type,
    id: input.id,
    kind: input.kind,
    style: input.style,
    color: input.color,
    text: input.text,
    contextBefore: input.contextBefore,
    contextAfter: input.contextAfter,
    thought: input.thought,
    targets: input.targets
  }, input.sourceFingerprint);
  const createdTime = Date.parse(input.createdAt);
  const updatedTime = Date.parse(input.updatedAt);
  if (!Number.isFinite(createdTime) || !Number.isFinite(updatedTime)) {
    throw contractError('Corrupt PDF annotation timestamps', 'PDF_ANNOTATION_STORE_CORRUPT', 500);
  }
  normalized.createdAt = new Date(createdTime).toISOString();
  normalized.updatedAt = new Date(updatedTime).toISOString();
  return normalized;
}

function assertPdfAnnotationCollection(annotations) {
  if (!Array.isArray(annotations)) {
    throw contractError('Corrupt PDF annotation collection', 'PDF_ANNOTATION_STORE_CORRUPT', 500);
  }
  if (annotations.length > MAX_PDF_ANNOTATIONS_PER_BOOK) {
    throw contractError('PDF annotation limit exceeded', 'PDF_ANNOTATION_LIMIT', 413);
  }
  const ids = new Set();
  const normalized = annotations.map((item) => {
    let record;
    try {
      record = normalizeStoredPdfAnnotation(item);
    } catch (error) {
      if (error.code === 'PDF_ANNOTATION_LIMIT') throw error;
      throw contractError('Corrupt PDF annotation record', 'PDF_ANNOTATION_STORE_CORRUPT', 500);
    }
    if (ids.has(record.id)) throw contractError('Duplicate PDF annotation ID', 'PDF_ANNOTATION_STORE_CORRUPT', 500);
    ids.add(record.id);
    return record;
  });
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_PDF_ANNOTATION_BYTES) {
    throw contractError('PDF annotation limit exceeded', 'PDF_ANNOTATION_LIMIT', 413);
  }
  return normalized;
}

function annotationPayload(record) {
  const { createdAt, updatedAt, ...payload } = record;
  return payload;
}

module.exports = {
  MAX_PDF_ANNOTATIONS_PER_BOOK,
  MAX_PDF_ANNOTATION_BYTES,
  MAX_PDF_ANNOTATION_PAGES,
  MAX_PDF_ANNOTATION_QUADS,
  MAX_PDF_ANNOTATION_PAGE_INDEX,
  normalizePdfAnnotationCreate,
  normalizePdfAnnotationEdit,
  normalizeStoredPdfAnnotation,
  assertPdfAnnotationCollection,
  annotationPayload
};
