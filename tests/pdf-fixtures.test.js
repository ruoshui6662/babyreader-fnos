'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPdfFixture } = require('./fixtures/pdf-fixtures');

test('valid PDF fixture declares and selects its text font', () => {
  const pdf = createPdfFixture({ text: 'Parser smoke text' }).toString('latin1');

  assert.match(pdf, /\/Font\s*<<\s*\/F1\s+\d+\s+0\s+R\s*>>/);
  assert.match(pdf, /\/F1\s+12\s+Tf/);
});
