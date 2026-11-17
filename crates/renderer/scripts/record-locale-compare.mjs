#!/usr/bin/env node
/**
 * Record `String.prototype.localeCompare` from a real browser, for we-data's interim Latin-name
 * collation policy (`locale_cmp` in `we-data/src/natives.rs`).
 *
 * The TS side sorts names with an unqualified `a.localeCompare(b)` (reactors, involvementMenu), so
 * the expected answers come from Chrome — never written by hand. Chrome runs with `--lang=en-US`
 * and the page records `Intl.Collator().resolvedOptions()` beside the answers, so the locale the
 * vectors were taken under is part of the file.
 *
 * Output: `we-data/tests/vectors/locale_compare.json` —
 *   `{ meta, pairs: [{ a, b, cmp }], sorts: [{ input, sorted }] }`, `cmp` being the sign (-1/0/1)
 *   and `sorted` the result of a stable `Array.prototype.sort` with that comparator.
 *
 * The inputs are the names the Coasys snapshot carries, plus the cases the policy claims:
 * case-insensitive base letters first, then accents, then lowercase-before-uppercase, and
 * canonically equivalent spellings (precomposed and decomposed) comparing equal.
 *
 * Environment: `WE_RECORD_CHROME` — a Chrome/Chromium binary (default: playwright's `chrome`
 * channel). playwright-core resolves from `apps/we-preview`, as `record-coasys.mjs` does.
 *
 * Usage: node record-locale-compare.mjs
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const require = createRequire(resolve(repoRoot, 'apps/we-preview/package.json'));
const { chromium } = require('playwright-core');

const out = resolve(here, '../we-data/tests/vectors/locale_compare.json');

// Names the recorded Coasys space holds.
const coasys = [
  'Devon Ashworth',
  'Juni Okafor',
  'Mara Ellison',
  'Priya Nair',
  'Sana Vega',
  'Theo Brandt',
  'Preview User',
  'Devon',
  'Juni',
  'Mara',
  'Priya',
  'Sana',
  'Theo',
  'devon',
];
// What the policy claims, one concern per group.
const cases = [
  // case-insensitive primary, lowercase first on a tie
  'alice',
  'Alice',
  'ALICE',
  'Bob',
  'bob',
  'Zoe',
  'zoe',
  // accents after base letters, before case
  'éric',
  'Éric',
  'eric',
  'Eric',
  'èric',
  'êric',
  'ëric',
  'Erich',
  // precomposed vs decomposed (canonically equivalent)
  'José',
  'José',
  'Zoë',
  'Zoë',
  'Renée',
  'Renée',
  // a standalone combining mark is an accent on the preceding base, not a letter
  'éz',
  'éa',
  'ea',
  'ez',
  // multi-word and length
  'Ann',
  'Anna',
  'Ann Lee',
  'Anne',
  'Ana',
  'Ña',
  'Nana',
  'Çelik',
  'Celik',
  'Cem',
];

const pairsOf = (names) => {
  const pairs = [];
  for (const a of names) for (const b of names) if (a !== b) pairs.push([a, b]);
  return pairs;
};

const sortInputs = [
  coasys,
  [...coasys].reverse(),
  ['Zoe', 'alice', 'Bob', 'éric'],
  ['éz', 'éa'],
  // canonically equivalent pairs, in both orders: a stable sort keeps the input order
  ['José', 'José'],
  ['José', 'José'],
  ['Zoë', 'Zoë', 'Zoe'],
  ['Zoë', 'Zoë', 'Zoe'],
  cases,
  [...cases].reverse(),
];

const browser = await chromium.launch({
  ...(process.env.WE_RECORD_CHROME ? { executablePath: process.env.WE_RECORD_CHROME } : { channel: 'chrome' }),
  args: ['--lang=en-US'],
});
try {
  const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
  const result = await page.evaluate(
    ({ pairs, sortInputs }) => ({
      meta: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        collator: Intl.Collator().resolvedOptions(),
      },
      pairs: pairs.map(([a, b]) => ({ a, b, cmp: Math.sign(a.localeCompare(b)) })),
      sorts: sortInputs.map((input) => ({
        input,
        sorted: [...input].sort((x, y) => x.localeCompare(y)),
      })),
    }),
    { pairs: pairsOf([...new Set([...coasys, ...cases])]), sortInputs },
  );
  result.meta.recordedBy = 'crates/renderer/scripts/record-locale-compare.mjs';
  await writeFile(out, JSON.stringify(result, null, 1) + '\n');
  console.log(`wrote ${result.pairs.length} pairs, ${result.sorts.length} sorts → ${out}`);
} finally {
  await browser.close();
}
