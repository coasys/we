#!/usr/bin/env node
// Does every computed camelCase prop on a `we-*` element carry the `prop:` prefix?
//
// Solid compiles a prop with a COMPUTED value on a custom element to a lowercased property
// assignment: `fontSize={x}` becomes `el.fontsize = x`. Lit's reactive property is `fontSize`, so
// the value lands on an expando nobody reads and the element silently keeps whatever it inherited.
// A LITERAL compiles to an attribute instead (`fontsize="400"`, exactly the attribute Lit registers
// with `reflect: true`), so the same prop works written out and fails worked out.
//
// Nothing else catches it. The generated Solid types accept both spellings, so `tsc` is green; the
// markup carries no trace, so a DOM inspection shows nothing; and the symptom is a value that is
// quietly wrong rather than absent. `SignalControl` asked for a smaller reaction count for months
// and drew it at the inherited size the whole time, through several rounds of somebody reporting it.
//
// `tsc --noEmit` DOES catch a `prop:` that should not be there — a Solid component, or `styles` —
// so the two together cover both directions.
//
// Run: pnpm check:we-props

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** A prefix that already says how the value is delivered, or a handler. */
const EXEMPT = /^(prop:|attr:|bool:|class:|style:|use:|on[A-Z:])/;

/**
 * The opening tags of `we-*` elements, as [start, end] offsets.
 *
 * Hand-walked rather than matched with one regular expression, because a tag's attributes contain
 * braces, quotes, template literals and block comments — and a pattern loose enough to cross them
 * runs past the tag's own `>` and attributes a NEIGHBOUR's props to it. That is not hypothetical:
 * it is how a first pass at this claimed three `Column` props, which take camelCase correctly.
 */
function weTags(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || !/^<we-[a-z][a-z-]*[\s/>]/.test(src.slice(i, i + 40))) continue;
    let depth = 0;
    let quote = null;
    let j = i + 1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '/' && (src[j + 1] === '*' || src[j + 1] === '/')) {
        // A comment's prose is not code, and it contains apostrophes: `a drag's worth` read as an
        // opening quote is what made a first pass swallow the rest of the tag and attribute a
        // neighbour's props to it.
        j = src[j + 1] === '*' ? src.indexOf('*/', j + 2) + 1 : src.indexOf('\n', j + 2) - 1;
        if (j < 1) return out;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push([i, j]);
    i = j;
  }
  return out;
}

/** The props declared directly on one tag — name, and whether its value is computed. */
function propsOf(src, [start, end]) {
  const found = [];
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < end; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && (src[i + 1] === '*' || src[i + 1] === '/')) {
      i = src[i + 1] === '*' ? src.indexOf('*/', i + 2) + 1 : src.indexOf('\n', i + 2) - 1;
      if (i < 1) break;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    // A prop name only counts at the tag's own level: anything inside `{…}` is an expression.
    else if (depth === 0 && /[A-Za-z]/.test(c) && !/[\w:$.-]/.test(src[i - 1])) {
      const m = /^[\w:$-]+/.exec(src.slice(i));
      const rest = src.slice(i + m[0].length);
      const eq = /^\s*=\s*(\{)?/.exec(rest);
      if (eq) found.push({ name: m[0], computed: Boolean(eq[1]), at: i });
      i += m[0].length - 1;
    }
  }
  return found;
}

const files = execSync(`find packages apps -name '*.tsx' -not -path '*/node_modules/*' -not -path '*/dist/*'`, {
  cwd: ROOT,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);

const failures = [];
let scanned = 0;
for (const rel of files) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  for (const tag of weTags(src)) {
    scanned++;
    const name = /^<(we-[a-z-]+)/.exec(src.slice(tag[0]))[1];
    for (const prop of propsOf(src, tag)) {
      if (!prop.computed || EXEMPT.test(prop.name) || !/[a-z][A-Z]/.test(prop.name)) continue;
      failures.push({ rel, line: src.slice(0, prop.at).split('\n').length, tag: name, prop: prop.name });
    }
  }
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} computed camelCase prop(s) on we-* elements without \`prop:\`:\n`);
  for (const f of failures) console.error(`  ${f.rel}:${f.line}  <${f.tag} ${f.prop}={…}`);
  console.error('\nSolid assigns these as a LOWERCASED property (`el.fontsize`), which Lit never reads,');
  console.error('so the value is silently dropped. Write the prefix:\n');
  console.error(`      prop:${failures[0].prop}={…}\n`);
  console.error('(A literal value — fontSize="400" — compiles to an attribute and is fine as it is.)\n');
  process.exit(1);
}

console.log(
  `✓ ${scanned} we-* element(s) across ${files.length} .tsx files; every computed camelCase prop is prefixed`,
);
