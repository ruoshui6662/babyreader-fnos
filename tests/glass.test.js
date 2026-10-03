'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { glassDominantColours, glassFitColour } = require('../app/ui/core/glass');

// width × height pixels from a painter (x, y) => [r, g, b].
function pixels(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return data;
}

test('the main colours of a cover, ignoring its white title and grey badge', () => {
  const cover = pixels(40, 60, (x, y) => {
    if (y < 8 && x < 30) return [255, 255, 255];        // title
    if (y > 54 && x < 12) return [128, 128, 128];       // format badge
    return y < 40 ? [192, 57, 43] : [27, 79, 140];      // red top, blue bottom
  });
  const colours = glassDominantColours(cover);
  assert.equal(colours.length, 3);
  const [first, second] = colours;
  assert.ok(first[0] < 12 || first[0] > 348, `red first, got hue ${first[0]}`);
  assert.ok(second[0] > 200 && second[0] < 225, `blue second, got hue ${second[0]}`);
});

test('a one-colour cover is filled in with the same hue, never an invented one', () => {
  const colours = glassDominantColours(pixels(40, 60, () => [46, 107, 79]));
  assert.equal(colours.length, 3);
  assert.ok(colours.every(([hue]) => hue === colours[0][0]));
  assert.ok(colours[1][1] < colours[0][1], 'the fill-ins are softer');
});

test('an all-grey cover gives no colours (the caller falls back to pale blue)', () => {
  assert.deepEqual(glassDominantColours(pixels(40, 60, (x) => [x * 6, x * 6, x * 6])), []);
});

test('colours fit the theme: pale on light, deep on dark', () => {
  assert.equal(glassFitColour([5, 0.65, 0.46], 'light'), 'hsl(5 65% 80% / .6)');
  assert.equal(glassFitColour([5, 0.65, 0.46], 'dark'), 'hsl(5 60% 30% / .9)');
  assert.equal(glassFitColour([211, 0.9, 0.1], 'dark'), 'hsl(211 60% 20% / .9)');
});
