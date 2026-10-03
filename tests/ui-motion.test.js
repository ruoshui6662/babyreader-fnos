'use strict';

// Motion rules (2026-10 commercial-grade UX plan, phase 3): transitions use
// only the three duration tokens and never animate `all`, and "reduce
// motion" switches movement off everywhere.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const css = require('./helpers/styles').readAllStylesSync();
const transitions = css.split(/\r?\n/).filter((line) => /\btransition(-duration)?\s*:/.test(line));

test('transitions use only the motion duration tokens', () => {
  // .01ms is the reduce-motion safety net itself.
  const literal = transitions.filter((line) => !/\bnone\b/.test(line) && !/\.01ms !important/.test(line)
    && /(?<![\w-])\d*\.?\d+m?s\b/.test(line));
  assert.deepEqual(literal, []);
});

test('no transition animates `all`', () => {
  assert.deepEqual(transitions.filter((line) => /transition\s*:\s*all\b/.test(line)), []);
});

test('reduce motion has a global safety net', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{[^}]*transition: none !important;/);
});
