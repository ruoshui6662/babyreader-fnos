'use strict';

const BOOK_ID_PATTERN = /^[a-f0-9]{64}$/;
const COLLECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_VIEW_MODES = new Set(['flat', 'collections', 'source-folders']);
const MAX_COLLECTIONS = 100;
const MAX_COLLECTION_NAME_LENGTH = 80;
const MAX_ORGANIZATION_BYTES = 2 * 1024 * 1024;

function organizationError(code, message) {
  return Object.assign(new Error(message), { code });
}

function invalidOrganization(message) {
  return organizationError('INVALID_ORGANIZATION', message);
}

function validBookId(value) {
  return BOOK_ID_PATTERN.test(String(value || ''));
}

function validCollectionId(value) {
  return COLLECTION_ID_PATTERN.test(String(value || ''));
}

function normalizeName(value) {
  const name = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!name || name.length > MAX_COLLECTION_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw invalidOrganization('Invalid collection name');
  }
  return name;
}

function normalizeTimestamp(value, fallback) {
  const timestamp = String(value || '').trim();
  return timestamp && timestamp.length <= 64 ? timestamp : fallback;
}

function normalizeBookOrder(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidOrganization('Invalid book order');
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const bookId = String(item || '');
    if (!validBookId(bookId) || seen.has(bookId)) continue;
    seen.add(bookId);
    output.push(bookId);
  }
  return output;
}

function createEmptyLibraryOrganization(now = null) {
  return {
    version: 1,
    revision: 0,
    updatedAt: now,
    preferences: { viewMode: 'flat' },
    collections: [],
    allBookOrder: [],
    unassignedOrder: [],
    collectionOrders: {},
    bookAssignments: {}
  };
}

function normalizeLibraryOrganization(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidOrganization('Invalid organization state');
  }
  if (Number(value.version) !== 1) throw invalidOrganization('Unsupported organization version');

  const revision = Number(value.revision);
  if (!Number.isInteger(revision) || revision < 0) throw invalidOrganization('Invalid organization revision');

  const now = new Date().toISOString();
  const collectionsInput = value.collections === undefined ? [] : value.collections;
  if (!Array.isArray(collectionsInput) || collectionsInput.length > MAX_COLLECTIONS) {
    throw invalidOrganization('Invalid collection list');
  }

  const collections = [];
  const collectionIds = new Set();
  const collectionNames = new Set();
  for (const [index, item] of collectionsInput.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidOrganization('Invalid collection');
    }
    const id = String(item.id || '');
    if (!validCollectionId(id) || collectionIds.has(id)) throw invalidOrganization('Invalid collection ID');
    const name = normalizeName(item.name);
    const nameKey = name.toLocaleLowerCase('zh-CN');
    if (collectionNames.has(nameKey)) throw invalidOrganization('Duplicate collection name');
    collectionIds.add(id);
    collectionNames.add(nameKey);
    collections.push({
      id,
      name,
      position: index,
      createdAt: normalizeTimestamp(item.createdAt, now),
      updatedAt: normalizeTimestamp(item.updatedAt, now)
    });
  }

  const assignmentsInput = value.bookAssignments === undefined ? {} : value.bookAssignments;
  if (!assignmentsInput || typeof assignmentsInput !== 'object' || Array.isArray(assignmentsInput)) {
    throw invalidOrganization('Invalid book assignments');
  }
  const bookAssignments = {};
  for (const [bookId, collectionId] of Object.entries(assignmentsInput)) {
    if (!validBookId(bookId) || !validCollectionId(collectionId) || !collectionIds.has(collectionId)) continue;
    bookAssignments[bookId] = collectionId;
  }

  const ordersInput = value.collectionOrders === undefined ? {} : value.collectionOrders;
  if (!ordersInput || typeof ordersInput !== 'object' || Array.isArray(ordersInput)) {
    throw invalidOrganization('Invalid collection orders');
  }
  const collectionOrders = Object.fromEntries(collections.map(({ id }) => [id, []]));
  for (const { id } of collections) {
    const order = normalizeBookOrder(ordersInput[id]);
    const seen = new Set();
    for (const bookId of order) {
      const assignedTo = bookAssignments[bookId];
      if (assignedTo && assignedTo !== id) continue;
      if (!assignedTo) bookAssignments[bookId] = id;
      if (seen.has(bookId)) continue;
      seen.add(bookId);
      collectionOrders[id].push(bookId);
    }
  }

  // Keep a valid assignment even if an old/corrupt order list omitted it.
  for (const [bookId, collectionId] of Object.entries(bookAssignments)) {
    if (!collectionOrders[collectionId].includes(bookId)) collectionOrders[collectionId].push(bookId);
  }

  const unassignedOrder = normalizeBookOrder(value.unassignedOrder)
    .filter((bookId) => !bookAssignments[bookId]);

  const preferences = value.preferences && typeof value.preferences === 'object' && !Array.isArray(value.preferences)
    ? value.preferences
    : {};
  const viewMode = ALLOWED_VIEW_MODES.has(preferences.viewMode) ? preferences.viewMode : 'flat';

  return {
    version: 1,
    revision,
    updatedAt: normalizeTimestamp(value.updatedAt, null),
    preferences: { viewMode },
    collections,
    allBookOrder: normalizeBookOrder(value.allBookOrder),
    unassignedOrder,
    collectionOrders,
    bookAssignments
  };
}

function resolveLibraryOrganization(indexBooks, organization) {
  if (!Array.isArray(indexBooks)) throw invalidOrganization('Invalid library books');
  const normalized = normalizeLibraryOrganization(organization);
  const activeBooks = indexBooks.filter((book) => validBookId(book?.id) && !book.error);
  const activeIds = new Set(activeBooks.map((book) => book.id));
  const referencedIds = new Set([
    ...normalized.allBookOrder,
    ...Object.keys(normalized.bookAssignments),
    ...normalized.unassignedOrder,
    ...Object.values(normalized.collectionOrders).flat()
  ]);
  const orphanedBookIds = [...referencedIds].filter((bookId) => !activeIds.has(bookId)).sort();

  const collectionOrders = Object.fromEntries(normalized.collections.map(({ id }) => [id, []]));
  const assignedActive = new Set();
  for (const { id } of normalized.collections) {
    for (const bookId of normalized.collectionOrders[id]) {
      if (!activeIds.has(bookId) || assignedActive.has(bookId)) continue;
      if (normalized.bookAssignments[bookId] !== id) continue;
      assignedActive.add(bookId);
      collectionOrders[id].push(bookId);
    }
  }

  const unassignedOrder = normalized.unassignedOrder
    .filter((bookId) => activeIds.has(bookId) && !assignedActive.has(bookId));
  const seenUnassigned = new Set(unassignedOrder);
  for (const book of activeBooks) {
    if (assignedActive.has(book.id) || seenUnassigned.has(book.id)) continue;
    unassignedOrder.push(book.id);
    seenUnassigned.add(book.id);
  }

  return {
    organization: normalized,
    allBookOrder: [...new Set([...normalized.allBookOrder.filter((id) => activeIds.has(id)), ...activeIds])],
    collections: normalized.collections,
    collectionOrders,
    unassignedOrder,
    bookAssignments: normalized.bookAssignments,
    orphanedBookIds
  };
}

function reconcileLibraryOrganization(value, activeBookIds) {
  const normalized = normalizeLibraryOrganization(value);
  const activeIds = new Set(
    (activeBookIds instanceof Set ? [...activeBookIds] : Array.isArray(activeBookIds) ? activeBookIds : [])
      .filter(validBookId)
  );
  const referencedIds = new Set([
    ...normalized.allBookOrder,
    ...Object.keys(normalized.bookAssignments),
    ...normalized.unassignedOrder,
    ...Object.values(normalized.collectionOrders).flat()
  ]);
  const orphanedBookIds = [...referencedIds].filter((bookId) => !activeIds.has(bookId)).sort();
  const next = structuredClone(normalized);
  next.allBookOrder = next.allBookOrder.filter((bookId) => activeIds.has(bookId));

  next.unassignedOrder = next.unassignedOrder.filter((bookId) => activeIds.has(bookId));
  next.collectionOrders = Object.fromEntries(
    Object.entries(next.collectionOrders).map(([collectionId, order]) => [
      collectionId,
      order.filter((bookId) => activeIds.has(bookId))
    ])
  );
  next.bookAssignments = Object.fromEntries(
    Object.entries(next.bookAssignments).filter(([bookId]) => activeIds.has(bookId))
  );

  return {
    organization: normalizeLibraryOrganization(next),
    orphanedBookIds
  };
}

module.exports = {
  ALLOWED_VIEW_MODES,
  BOOK_ID_PATTERN,
  COLLECTION_ID_PATTERN,
  MAX_COLLECTIONS,
  MAX_COLLECTION_NAME_LENGTH,
  MAX_ORGANIZATION_BYTES,
  createEmptyLibraryOrganization,
  normalizeLibraryOrganization,
  reconcileLibraryOrganization,
  resolveLibraryOrganization
};
