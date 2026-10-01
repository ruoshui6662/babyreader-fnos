'use strict';

// PDF reading is always on. The fnOS app-settings switch was removed: every
// settings save used to write pdf-feature.json (usually {"enabled":false}),
// so that file is ignored here rather than hiding PDFs with no switch left to
// turn them back on. ZHENSHU_PDF_ENABLED=0/false/no/off remains an
// operator kill switch, read on every request so it needs no restart.
const DISABLED_VALUES = ['0', 'false', 'no', 'off'];

function getPdfReaderEnabled(_configRoot, envValue) {
  return !DISABLED_VALUES.includes(String(envValue ?? '').trim().toLowerCase());
}

module.exports = { getPdfReaderEnabled };
