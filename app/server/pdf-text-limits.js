'use strict';

const PDF_TEXT_LIMITS = Object.freeze({
  maxSourceBytes: 64 * 1024 * 1024,
  maxPages: 5000,
  maxPageCharacters: 250_000,
  maxBookCharacters: 8 * 1024 * 1024,
  maxDurationMs: 20_000,
  maxIndexDurationMs: 15_000,
  maxIndexRows: 20_000,
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
  maxStackSizeMb: 4
});

module.exports = { PDF_TEXT_LIMITS };
