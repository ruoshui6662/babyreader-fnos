'use strict';

// MOBI/AZW3 reading is always on. The fnOS app-settings switch was removed: every settings
// save used to write this feature's JSON file (usually {"enabled":false}), so
// that file is ignored rather than hiding the feature with no switch left to
// turn it back on. ZHENSHU_MOBI_ENABLED=0/false/no/off remains an operator kill switch,
// read on every request so it needs no restart.
const DISABLED_VALUES = ['0', 'false', 'no', 'off'];

function getMobiReaderEnabled(_configRoot, envValue) {
  return !DISABLED_VALUES.includes(String(envValue ?? '').trim().toLowerCase());
}

module.exports = { getMobiReaderEnabled };
