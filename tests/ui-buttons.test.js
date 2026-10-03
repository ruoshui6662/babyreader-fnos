'use strict';

// One button language on the shelf pages (书库 / 阅读统计 / 笔记 / 卡片面板):
// buttons take the shared zs-btn classes, and button rules never hardcode a
// colour. See the 按钮 block in app/ui/styles.css.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'app/ui/styles.css'), 'utf8');
const SHELF_SCRIPTS = fs.readdirSync(path.join(ROOT, 'app/ui/library'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, source: fs.readFileSync(path.join(ROOT, 'app/ui/library', name), 'utf8') }));

/** Innermost CSS rules as { selector, body, line }; comments blanked, lines kept. */
function cssRules(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const rules = [];
  const stack = [];
  let from = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '{') {
      stack.push({ selector: clean.slice(from, index).trim(), start: index + 1 });
      from = index + 1;
    } else if (char === '}') {
      const open = stack.pop();
      if (open && !clean.slice(open.start, index).includes('{')) {
        rules.push({
          selector: open.selector.replace(/\s+/g, ' '),
          body: clean.slice(open.start, index),
          line: clean.slice(0, open.start).split('\n').length
        });
      }
      from = index + 1;
    } else if (char === ';' && !stack.length) {
      from = index + 1;
    }
  }
  return { rules, balanced: stack.length === 0 };
}

// Drops var(...) (and anything nested in it): a literal there is only a fallback.
function withoutVars(value) {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.startsWith('var(', index)) {
      let depth = 0;
      let end = index;
      for (; end < value.length; end += 1) {
        if (value[end] === '(') depth += 1;
        else if (value[end] === ')' && --depth === 0) break;
      }
      out += 'VAR';
      index = end;
    } else {
      out += value[index];
    }
  }
  return out;
}

const BUTTON_SELECTOR = /\.zs-btn|\.(?:library|notes|stats|note-card|shelf)-[\w-]*(?:button|btn|action|primary|secondary|link|back|done)\b|\.is-primary\b/;
const COLOUR_PROPERTY = /^\s*(color|background|background-color|border|border-color|outline|outline-color|fill|stroke)\s*:\s*(.+)$/i;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black|red|blue|green|gray|grey)\b/i;

test('styles.css parses: every brace is closed', () => {
  assert.equal(cssRules(css).balanced, true);
  const opens = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/{/g) || []).length;
  const closes = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/}/g) || []).length;
  assert.equal(opens, closes, 'a stray brace makes the browser drop the next rule');
});

test('button rules take colours from variables, never hardcoded', () => {
  const offenders = [];
  for (const rule of cssRules(css).rules) {
    if (!BUTTON_SELECTOR.test(rule.selector)) continue;
    for (const declaration of rule.body.split(';')) {
      const match = declaration.match(COLOUR_PROPERTY);
      if (match && LITERAL_COLOUR.test(withoutVars(match[2]))) {
        offenders.push(`styles.css:${rule.line} ${rule.selector} { ${match[1]}: ${match[2].trim()} }`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'use var(--library-…) / the zs-btn classes instead');
});

test('the three button roles are defined once each', () => {
  const { rules } = cssRules(css);
  for (const role of ['.zs-btn', '.zs-btn-primary', '.zs-btn-secondary', '.zs-btn-plain', '.zs-btn-quiet']) {
    const definitions = rules.filter((rule) => rule.selector === role);
    assert.equal(definitions.length, 1, `${role} should be defined exactly once`);
  }
});

test('shelf pages use the shared button classes', () => {
  const offenders = [];
  for (const { name, source } of SHELF_SCRIPTS) {
    // The reader toolbar's class does not belong on the shelf.
    if (/['"`][^'"`]*\bmode-btn\b/.test(source)) offenders.push(`${name}: uses mode-btn`);
    // Any class list naming a primary/secondary role must carry a zs-btn role.
    for (const match of source.matchAll(/['"`]([^'"`\n]*\b(?:[\w-]+-(?:primary|secondary)|is-primary)\b[^'"`\n]*)['"`]/g)) {
      const classes = match[1];
      if (/^[\w\s-]+$/.test(classes) && !/\bzs-btn-(?:primary|secondary|plain)\b/.test(classes) && /\b[a-z][\w-]*\b/.test(classes)
        && !/^(?:zs-btn-primary|zs-btn-secondary|zs-btn-plain)$/.test(classes)) {
        offenders.push(`${name}: '${classes}'`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
