#!/usr/bin/env node
'use strict';

// Survey how the books in a folder indent their paragraphs, to check the
// reader's first-line indent rules (app/ui/reader/paragraphs.js) against real
// books. Read-only; prints one line per book and a summary.
//
//   node scripts/survey-paragraph-indent.js <folder> [--json]
//
// Kinds: css (stylesheet text-indent), ideographic (leading U+3000 spaces),
// nbsp (leading &nbsp;), inline (style="text-indent"), none.

const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');

function walk(folder, found = []) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(epub|txt)$/i.test(entry.name)) found.push(full);
  }
  return found;
}

function surveyEpub(file) {
  const files = unzipSync(new Uint8Array(fs.readFileSync(file)));
  const result = { paragraphs: 0, ideographic: 0, nbsp: 0, inline: 0, brParagraphs: 0, cssIndent: [], cssExceptions: [] };
  for (const [name, bytes] of Object.entries(files)) {
    if (/\.css$/i.test(name)) {
      for (const match of strFromU8(bytes).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const indent = match[2].match(/text-indent\s*:\s*([^;}]+)/i)?.[1]?.trim();
        if (!indent) continue;
        const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
        const hanging = /^-/.test(indent) && /(padding|margin)-left/i.test(match[2]);
        (parseFloat(indent) > 0 ? result.cssIndent : result.cssExceptions)
          .push(`${selector} ${indent}${hanging ? ' (hanging)' : ''}`);
      }
    } else if (/\.x?html?$/i.test(name)) {
      for (const match of strFromU8(bytes).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
        result.paragraphs += 1;
        const text = match[2].replace(/<[^>]+>/g, '')
          .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
          .replace(/&#12288;|&#x3000;/gi, '　')
          .replace(/^[ \t\r\n]+/, '');
        if (/^　/.test(text)) result.ideographic += 1;
        else if (/^ /.test(text)) result.nbsp += 1;
        if (/style\s*=\s*["'][^"']*text-indent/i.test(match[1])) result.inline += 1;
        if (/<br\b/i.test(match[2])) result.brParagraphs += 1;
      }
    }
  }
  const share = (count) => (result.paragraphs ? count / result.paragraphs : 0);
  result.kind = share(result.ideographic) > 0.3 ? 'ideographic'
    : share(result.nbsp) > 0.3 ? 'nbsp'
      : share(result.inline) > 0.3 ? 'inline'
        : result.cssIndent.length ? 'css' : 'none';
  return result;
}

function surveyTxt(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  const ideographic = lines.filter((line) => /^　/.test(line)).length;
  const spaces = lines.filter((line) => /^[  ]/.test(line)).length;
  return {
    paragraphs: lines.length,
    ideographic,
    spaces,
    kind: ideographic > lines.length * 0.3 ? 'ideographic' : spaces > lines.length * 0.3 ? 'spaces' : 'none'
  };
}

function main() {
  const folder = process.argv[2];
  if (!folder || !fs.existsSync(folder)) {
    console.error('usage: node scripts/survey-paragraph-indent.js <folder> [--json]');
    process.exit(2);
  }
  const rows = [];
  for (const file of walk(folder)) {
    try {
      rows.push({ file: path.relative(folder, file), ...(/\.txt$/i.test(file) ? surveyTxt(file) : surveyEpub(file)) });
    } catch (error) {
      rows.push({ file: path.relative(folder, file), kind: 'error', error: error.message });
    }
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const kinds = {};
  for (const row of rows) {
    kinds[row.kind] = (kinds[row.kind] || 0) + 1;
    const exceptions = row.cssExceptions?.length ? `, ${row.cssExceptions.length} unindented/hanging rules` : '';
    console.log(`${row.kind.padEnd(12)} ${row.file} (${row.paragraphs ?? 0} paragraphs${exceptions}${row.brParagraphs ? `, ${row.brParagraphs} with <br>` : ''})`);
  }
  console.log('\nSummary:', JSON.stringify(kinds));
}

main();
