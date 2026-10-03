'use strict';

// All stylesheets of the reader UI, in the order index.html links them
// (styles.css, then app/ui/styles/*.css): later rules win, so tests that read
// the CSS see the same cascade the browser does.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const UI = path.resolve(__dirname, '../../app/ui');

function stylesheetPaths() {
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  return [...html.matchAll(/<link rel="stylesheet" href="([^"?]+\.css)(?:\?[^"]*)?">/g)]
    .map((match) => path.join(UI, match[1]));
}

function readAllStylesSync() {
  return stylesheetPaths().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

async function readAllStyles() {
  return (await Promise.all(stylesheetPaths().map((file) => fsp.readFile(file, 'utf8')))).join('\n');
}

module.exports = { stylesheetPaths, readAllStyles, readAllStylesSync };
