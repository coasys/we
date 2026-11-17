#!/usr/bin/env node
// Generates `we-legacy/src/surface.rs` — the legacy member→tier table — from
// `packages/app-shell/src/shared/registries/templateSurface.ts` (E3c-8a r2, Lal:
// the 800 rows are generated, never hand-transcribed).
//
//   node crates/renderer/scripts/gen-legacy-surface.mjs           # write surface.rs
//   node crates/renderer/scripts/gen-legacy-surface.mjs --check   # fail if it differs
//
// The rule, read off the TS file itself:
// - every member of every store in `TEMPLATE_SURFACE`, in the file's order;
// - `WIRING` members are left out (never served, at any tier);
// - a member classified by a helper (`state`, `action`, `destructive`, `ambient`,
//   `hereOnly`) gets its group's tier: a group in `SPACE_TIER` is `Tier::Space`, a
//   group in `CHROME_TIER` but not `SPACE_TIER` is `Tier::App`, any other group is
//   left out (fail closed);
// - anything the parser does not recognise is an error, not a guess.
//
// The output goes through `rustfmt` so the committed file is exactly what
// `cargo fmt` leaves.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const renderer = join(here, '..');
const repo = join(renderer, '..', '..');
const tsPath = join(repo, 'packages/app-shell/src/shared/registries/templateSurface.ts');
const outPath = join(renderer, 'we-legacy/src/surface.rs');
const tsRel = relative(repo, tsPath);

/** The source with every comment blanked out, newlines kept so line numbers hold. */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/** The string entries of `export const NAME: … = [ … ];`, with `...OTHER` spreads expanded. */
function tierList(code, name, lists) {
  const m = code.match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`${name} not found in ${tsRel}`);
  const out = [];
  for (const raw of m[1].split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const spread = item.match(/^\.\.\.([A-Z_]+)$/);
    const quoted = item.match(/^'([a-z-]+)'$/);
    if (spread) {
      if (!lists[spread[1]]) throw new Error(`${name} spreads unknown ${spread[1]}`);
      out.push(...lists[spread[1]]);
    } else if (quoted) {
      out.push(quoted[1]);
    } else {
      throw new Error(`${name}: unrecognised entry ${JSON.stringify(item)}`);
    }
  }
  return out;
}

/** A member key, optionally quoted. */
const KEY = `['"]?([A-Za-z_$][\\w$]*)['"]?`;
/** A classification helper call: the helper, then its group. */
const HELPER = `(state|action|destructive|ambient|hereOnly)\\('([a-z-]+)'(?:, \\d+)?\\)`;

function parse(src) {
  const code = stripComments(src);
  const lists = {};
  lists.SPACE_TIER = tierList(code, 'SPACE_TIER', lists);
  lists.CHROME_TIER = tierList(code, 'CHROME_TIER', lists);
  const space = new Set(lists.SPACE_TIER);
  const chrome = new Set(lists.CHROME_TIER);

  const lines = code.split('\n');
  const start = lines.findIndex((l) => /^export const TEMPLATE_SURFACE\b/.test(l));
  if (start < 0) throw new Error(`TEMPLATE_SURFACE not found in ${tsRel}`);
  const stores = [];
  let store = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line === '};') return { stores, space, chrome };
    let m;
    if ((m = line.match(/^([A-Za-z_$][\w$]*): \{$/)) && !store) {
      store = { name: m[1], line: i + 1, members: [] };
      continue;
    }
    if ((line === '},' || line === '}') && store) {
      stores.push(store);
      store = null;
      continue;
    }
    if (!store) throw new Error(`${tsRel}:${i + 1}: unexpected ${JSON.stringify(line)}`);
    if ((m = line.match(/^['"]?([A-Za-z_$][\w$]*)['"]?: WIRING,$/))) continue;
    let member;
    let group;
    if ((m = line.match(new RegExp(`^${KEY}: ${HELPER},$`)))) {
      [, member, , group] = m;
    } else if ((m = line.match(new RegExp(`^${KEY}: \\{ \\.\\.\\.${HELPER}(?:, [^{}]*)? \\},$`)))) {
      // `key: { ...helper('group'), extra: … },` on one line.
      [, member, , group] = m;
    } else if ((m = line.match(new RegExp(`^${KEY}: \\{$`)))) {
      // A spec spread over lines: the helper first, then extra keys, then
      // the member's own closing brace.
      member = m[1];
      const first = (lines[++i] ?? '').trim();
      const spread = first.match(new RegExp(`^\\.\\.\\.${HELPER},$`));
      if (!spread) throw new Error(`${tsRel}:${i + 1}: ${member}'s spec does not start with a helper spread`);
      group = spread[2];
      let depth = 1;
      while (depth > 0) {
        const next = lines[++i];
        if (next === undefined) throw new Error(`${member}'s spec is not closed in ${tsRel}`);
        depth += (next.match(/\{/g) ?? []).length - (next.match(/\}/g) ?? []).length;
      }
    } else {
      throw new Error(`${tsRel}:${i + 1}: unrecognised member ${JSON.stringify(line)}`);
    }
    const tier = space.has(group) ? 'Space' : chrome.has(group) ? 'App' : null;
    if (tier) store.members.push([member, tier]);
  }
  throw new Error(`TEMPLATE_SURFACE is not closed in ${tsRel}`);
}

function render({ stores }) {
  const constName = (store) => `${store.toUpperCase()}_MEMBERS`;
  let out = `//! GENERATED from ${tsRel}
//! (\`TEMPLATE_SURFACE\`, SPACE_TIER/CHROME_TIER groups) — E3c-8a. Do not edit by
//! hand; regenerate with \`node crates/renderer/scripts/gen-legacy-surface.mjs\`
//! (\`--check\` fails when this file differs from a fresh generation). \`member\` ->
//! the lowest tier that may reach it; a member absent here is denied (wiring or
//! unclassified = never served). Groups in SPACE_TIER map to \`Tier::Space\`; the
//! remaining chrome-tier groups map to \`Tier::App\`.
use we_expr::Tier;

/// \`(member, minimum tier)\` rows for one legacy store, in the file's order.
pub type MemberRows = &'static [(&'static str, Tier)];
`;
  for (const store of stores) {
    out += `\n/// \`templateSurface.ts:${store.line}\` — \`${store.name}\` in \`TEMPLATE_SURFACE\`.\n`;
    out += `static ${constName(store.name)}: MemberRows = &[\n`;
    for (const [member, tier] of store.members) out += `    ("${member}", Tier::${tier}),\n`;
    out += '];\n';
  }
  out += `\n/// Every classified legacy store name → its member rows (the compat-root set).\n`;
  out += `pub static LEGACY_MEMBER_TIERS: &[(&str, MemberRows)] = &[\n`;
  for (const store of stores) out += `    ("${store.name}", ${constName(store.name)}),\n`;
  out += '];\n';
  return execFileSync('rustfmt', ['--edition', '2021', '--emit', 'stdout'], {
    input: out,
    encoding: 'utf8',
    cwd: renderer,
  });
}

const generated = render(parse(readFileSync(tsPath, 'utf8')));
if (process.argv.includes('--check')) {
  const committed = readFileSync(outPath, 'utf8');
  if (committed !== generated) {
    console.error(
      `${relative(repo, outPath)} differs from a fresh generation from ${tsRel}.\n` +
        `Regenerate: node crates/renderer/scripts/gen-legacy-surface.mjs`,
    );
    process.exit(1);
  }
  console.log(`${relative(repo, outPath)} matches ${tsRel}.`);
} else {
  writeFileSync(outPath, generated);
  console.log(`wrote ${relative(repo, outPath)}`);
}
