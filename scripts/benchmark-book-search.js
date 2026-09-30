#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { zipSync } = require('fflate');
const { searchBookText } = require('../app/server/book-search');
const { ensureIndex, indexPath, isFtsAvailable, toFtsQuery } = require('../app/server/ai-fts');

const CHAPTER_COUNT = 800;
const BOOK_ID = 'b'.repeat(64);

function createSyntheticEpub() {
  const manifest = [];
  const spine = [];
  const files = {
    'META-INF/container.xml': new TextEncoder().encode(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
    )
  };
  for (let chapterIndex = 0; chapterIndex < CHAPTER_COUNT; chapterIndex += 1) {
    const id = `chapter-${chapterIndex}`;
    manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    const blocks = Array.from({ length: 32 }, (_, blockIndex) => {
      const commonHit = blockIndex % 4 === 0 ? ' commonneedle' : '';
      return `Chapter ${chapterIndex} passage ${blockIndex} ordinary reading material${commonHit}.`;
    });
    files[`OEBPS/${id}.xhtml`] = new TextEncoder().encode(
      `<html><body><h1>chapter ${chapterIndex}</h1>${blocks.map((block) => `<p>${block}</p>`).join('')}</body></html>`
    );
  }
  files['OEBPS/content.opf'] = new TextEncoder().encode(
    `<package><manifest>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>`
  );
  return zipSync(files, { level: 1 });
}

function insertSparseCandidateLoad(databasePath) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath);
  try {
    const insertChunk = db.prepare(`
      INSERT INTO ai_chunks(title, headings, body, chapterIndex, chapterHref, chapterLabel, startOffset)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertText = db.prepare(`
      INSERT INTO ai_chunk_text(rowid, bodyText, titleText, headingsText)
      VALUES (?, ?, ?, ?)
    `);
    db.exec('BEGIN');
    for (let index = 0; index < 2390; index += 1) {
      const inserted = insertChunk.run('targetkey', '', 'ordinary searchable prose', 0, '', 'synthetic-candidate', index);
      insertText.run(Number(inserted.lastInsertRowid), 'ordinary searchable prose', 'targetkey', '');
    }
    const exact = insertChunk.run('targetkey', '', '末章唯一 targetkey 命中', CHAPTER_COUNT - 1, '', 'synthetic-last-chapter', 0);
    insertText.run(Number(exact.lastInsertRowid), '末章唯一 targetkey 命中', 'targetkey', '');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function countFtsCandidates(databasePath, query) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const ftsQuery = toFtsQuery(query);
    const row = db.prepare('SELECT COUNT(*) AS count FROM ai_chunks WHERE ai_chunks MATCH ?').get(ftsQuery);
    const plan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT ai_chunks.rowid FROM ai_chunks
      WHERE ai_chunks MATCH ? AND ai_chunks.rowid > ?
      ORDER BY ai_chunks.rowid LIMIT ?
    `).all(ftsQuery, 0, 2001);
    return {
      count: Number(row.count),
      continuationPlan: plan.map((item) => String(item.detail || '')).filter(Boolean)
    };
  } finally {
    db.close();
  }
}

async function run() {
  if (!isFtsAvailable()) throw new Error('SQLite FTS5 is unavailable in this Node runtime');
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'babyreader-search-benchmark-'));
  let peakRssBytes = process.memoryUsage().rss;
  const rssSampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 20);
  try {
    const bookPath = path.join(temporaryRoot, 'synthetic.epub');
    const archive = createSyntheticEpub();
    await fs.writeFile(bookPath, archive);
    const book = { id: BOOK_ID, path: bookPath, type: 'epub', title: 'Synthetic benchmark' };
    const buildStarted = performance.now();
    const databasePath = await ensureIndex(book, temporaryRoot);
    const indexBuildMs = performance.now() - buildStarted;
    if (!databasePath) throw new Error('synthetic index build did not produce an index');
    const rssAfterIndexBytes = process.memoryUsage().rss;
    peakRssBytes = Math.max(peakRssBytes, rssAfterIndexBytes);
    insertSparseCandidateLoad(databasePath);

    const database = countFtsCandidates(databasePath, 'targetkey');
    const frequent = countFtsCandidates(databasePath, 'commonneedle');
    const indexStat = await fs.stat(indexPath(temporaryRoot, BOOK_ID));
    const requests = [];
    async function measuredSearch(label, query, cursor) {
      const started = performance.now();
      const result = await searchBookText(book, temporaryRoot, { query, limit: 20, cursor });
      const elapsedMs = performance.now() - started;
      if (!result.available) throw new Error('synthetic search returned unavailable');
      const record = {
        scenario: label,
        elapsedMs: Number(elapsedMs.toFixed(2)),
        resultCount: result.results.length,
        hasMore: result.hasMore,
        cursorReturned: Boolean(result.nextCursor)
      };
      requests.push(record);
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      return result;
    }

    const frequentFirst = await measuredSearch('frequent-first-page', 'commonneedle');
    if (frequentFirst.nextCursor) await measuredSearch('frequent-continuation', 'commonneedle', frequentFirst.nextCursor);
    const sparseFirst = await measuredSearch('sparse-budget-page', 'targetkey');
    if (sparseFirst.nextCursor) await measuredSearch('sparse-budget-continuation', 'targetkey', sparseFirst.nextCursor);
    await measuredSearch('zero-result', 'absenttoken');

    const report = {
      kind: 'synthetic-only',
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        cpuCount: os.cpus().length
      },
      syntheticBook: {
        chapters: CHAPTER_COUNT,
        archiveBytes: archive.length,
        frequentCandidateRows: frequent.count,
        indexBytes: indexStat.size,
        indexBuildMs: Number(indexBuildMs.toFixed(2))
      },
      scenarios: {
        frequent: { candidateRows: frequent.count },
        sparse: { candidateRows: database.count, injectedFalsePositiveRows: 2390, expectedExactHitChapter: CHAPTER_COUNT - 1 },
        zeroResult: { candidateRows: 0 },
        requests
      },
      continuationQueryPlan: frequent.continuationPlan,
      memory: {
        rssAfterIndexBytes,
        sampledPeakRssBytes: peakRssBytes
      },
      deviceAcceptance: 'pending: synthetic Windows results do not replace x86_64/ARM64 fnOS measurements'
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    clearInterval(rssSampler);
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch((error) => {
  const code = String(error?.code || 'BENCHMARK_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 48);
  process.stderr.write(`FAIL | synthetic search benchmark (${code || 'BENCHMARK_FAILED'})\n`);
  process.exitCode = 1;
});
