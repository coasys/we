#!/usr/bin/env node
/**
 * How big is each template, and how much of it is the same subtree written out again?
 *
 * A template is data, and everything downstream pays for its size by the character: the editor
 * sends the whole schema to a language model on every turn and gets a whole schema back, the undo
 * history holds a copy per edit, and a template crossing the wire to a peer carries all of it. So
 * a shape written twice is not merely untidy — it doubles a cost that is paid continuously, in the
 * one place where the budget is hard (a model's context window) rather than merely large.
 *
 * ## Why duplication rather than size
 *
 * Size alone is not a defect: a rich template is big, and a `$each` over a hundred rows is three
 * nodes. What this looks for is the same subtree serialised more than once — which is almost
 * always a `$if` whose branches differ in their wrapper and agree on their content, or a node
 * copied for a second display mode. Those are the ones where the fix costs nothing: one node with
 * the condition in its props renders the same DOM and is written once.
 *
 * ## Why a script rather than the validator
 *
 * Duplication is valid, and some of it is right. A modal showing the same body as the card behind
 * it genuinely needs the body twice, because a tree cannot reference itself. So this reports and
 * ranks rather than refusing, exactly as `query-audit` does one concept along — and like it, it
 * walks the COMPOSED tree, which is the only way to see a shape a fragment contributed from
 * another package.
 *
 * ## Reading the output
 *
 * `gzip` is the honest summary: a template with no repetition compresses about 4×, and anything
 * past about 8× is mostly saying the same thing over and over. The repeats listed under it are
 * where that compression is coming from, largest wasted bytes first — `wasted` being what the
 * copies past the first cost.
 *
 * Only MAXIMAL repeats are listed: a node inside a repeated subtree is repeated too, and listing
 * both would report the same bytes at every depth. A child is still listed when it repeats MORE
 * often than its parent, since that is a separate fact about a separate place.
 */
import { readdir, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

register('./assetHooks.mjs', import.meta.url);

interface Node {
  type?: string;
  meta?: unknown;
  props?: Record<string, unknown>;
  children?: unknown;
  routes?: unknown;
  slots?: Record<string, unknown>;
  [k: string]: unknown;
}

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);

/** Smallest repeat worth a line. Below this the copies cost less than the attention. */
const MIN_REPEAT_CHARS = 400;

/** Every child position a node can hold — children, routes, slots, and nodes hiding inside props. */
function descend(node: Node): Node[] {
  const out: Node[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (isNode(v)) out.push(v);
  };
  push(node.children);
  push(node.routes);
  if (node.slots) Object.values(node.slots).forEach(push);
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'styles') continue;
      push(v);
    }
  }
  return out;
}

/**
 * A node as one string, with object keys in a fixed order.
 *
 * Sorted, because two nodes that differ only in the order their props were written are the same
 * node to everything that reads them — and a comparison that said otherwise would miss exactly the
 * copies worth finding, since a copy made by hand rarely preserves the order.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

interface Repeat {
  key: string;
  count: number;
  size: number;
  where: string;
}

/** One `$if` whose two sides say some of the same thing. */
interface Overlap {
  shared: number;
  then: number;
  else: number;
  where: string;
}

interface Report {
  file: string;
  name: string;
  chars: number;
  gzipped: number;
  nodes: number;
  repeats: Repeat[];
  overlaps: Overlap[];
}

/** Where a node sits, for the report — the last few types down from the root. */
const trail = (path: string[]) => path.slice(-4).join(' > ');

/** The nodes of a subtree, as how many times each distinct shape occurs and how big it is. */
function shapesIn(node: Node, into = new Map<string, { n: number; size: number }>()) {
  const key = canonical(node);
  const seen = into.get(key);
  if (seen) seen.n += 1;
  else into.set(key, { n: 1, size: key.length });
  for (const child of descend(node)) shapesIn(child, into);
  return into;
}

/**
 * How much one `$if`'s two sides say the same thing.
 *
 * This is the measurement worth acting on, and it is per BRANCH PAIR rather than per shape. A
 * `$if` whose sides differ in their wrapper and agree on their content writes that content out
 * twice, and the fix is usually one node with the condition in its props — the same DOM, half the
 * bytes, no new machinery. `buildCard` in `@we/schema-kit` was exactly that, at 150,445 chars a
 * copy.
 *
 * Shared bytes, not a verdict. A shape can sit on both sides at different depths inside genuinely
 * different structures — a board card drawn inside columns on one side and inside person rows on
 * the other — and that one is not liftable by moving a node. What the number says is how much of
 * this branch pair is the same, which is where to look, not what to do.
 *
 * Maximal shapes only, so a shared subtree is counted once rather than once per node inside it.
 */
function overlapOf(node: Node, path: string[]): Overlap | undefined {
  const sides = (['then', 'else'] as const).map((slot) => [node.props?.[slot]].flat().filter(isNode) as Node[]);
  if (!sides[0].length || !sides[1].length) return undefined;

  const [a, b] = sides.map((roots) => {
    const into = new Map<string, { n: number; size: number }>();
    for (const r of roots) shapesIn(r, into);
    return into;
  });

  let shared = 0;
  /*
    Each distinct shape is credited once, for as many copies as the thinner side has of it.

    Crediting per ENCOUNTER double-counts a shape that occurs twice on the side being walked: the
    `min` has already said how many copies both sides hold, so adding it again at the second
    occurrence reported more shared bytes than the smaller side contains at all.
  */
  const credited = new Set<string>();
  const walkShared = (n: Node, covered: boolean) => {
    const key = canonical(n);
    const left = a.get(key);
    const right = b.get(key);
    const both = !!left && !!right;
    if (both && !covered && !credited.has(key)) {
      credited.add(key);
      shared += Math.min(left.n, right.n) * left.size;
    }
    for (const child of descend(n)) walkShared(child, covered || both);
  };
  for (const r of sides[0]) walkShared(r, false);

  if (!shared) return undefined;
  const bytes = (roots: Node[]) => roots.reduce((t, r) => t + canonical(r).length, 0);
  return { shared, then: bytes(sides[0]), else: bytes(sides[1]), where: trail(path) };
}

function measure(root: Node, file: string, name: string): Report {
  const counts = new Map<string, { count: number; size: number; where: string }>();
  const overlaps: Overlap[] = [];
  let nodes = 0;

  /*
    `reported` suppresses the `$if`s inside one that has already been reported.

    An inner `$if` sits on one side of the outer one, so everything it shares is already inside
    what the outer one shares: listing both counts the same bytes twice and sends a reader to two
    places for one edit. The outermost is also usually where the edit belongs.
  */
  const collect = (node: Node, path: string[], reported: boolean) => {
    nodes += 1;
    const here = [...path, node.type ?? '?'];
    const key = canonical(node);
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { count: 1, size: key.length, where: trail(here) });
    let found = false;
    if (node.type === '$if' && !reported) {
      const overlap = overlapOf(node, here);
      if (overlap) {
        overlaps.push(overlap);
        found = true;
      }
    }
    for (const child of descend(node)) collect(child, here, reported || found);
  };
  collect(root, [], false);

  /*
    Keep a repeat only where no ancestor repeats at least as often.

    Walking again rather than filtering the map, because "is this inside a repeat" is a fact about
    a position in the tree and not about the subtree itself: the same shape can be a maximal repeat
    in one place and sit inside a bigger one somewhere else.
  */
  const kept = new Map<string, Repeat>();
  const prune = (node: Node, coveredAt: number) => {
    const key = canonical(node);
    const entry = counts.get(key)!;
    const inside = entry.count <= coveredAt;
    if (!inside && entry.count > 1 && entry.size >= MIN_REPEAT_CHARS) {
      kept.set(key, { key, ...entry });
    }
    const covers = inside ? coveredAt : Math.max(coveredAt, entry.count);
    for (const child of descend(node)) prune(child, covers);
  };
  prune(root, 1);

  const json = JSON.stringify(root);
  return {
    file,
    name,
    chars: json.length,
    gzipped: gzipSync(json).length,
    nodes,
    repeats: [...kept.values()].sort((a, b) => b.size * (b.count - 1) - a.size * (a.count - 1)),
    overlaps: overlaps.sort((a, b) => b.shared - a.shared),
  };
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkDir(full)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts'))
      out.push(full);
  }
  return out;
}

const roots = process.argv.slice(2).map((a) => resolve(a));
const files: string[] = [];
for (const root of roots) {
  const s = await stat(root).catch(() => null);
  if (!s) continue;
  files.push(...(s.isDirectory() ? await walkDir(root) : [root]));
}

/*
  One report per root schema, attributed to the file that wrote it.

  `meta` is what makes a node a template or a view rather than a fragment — a whole thing somebody
  installs, renders and sends to a model, which is the unit whose size is a cost. Identity-deduped
  because a barrel re-exports the same object, and depth-first so the deeper file (the one that
  wrote it) is reached before the index that re-exports it.
*/
const isBarrel = (f: string) => f.endsWith('/index.ts');
const byDepth = files.sort(
  (a, b) =>
    b.split('/').length - a.split('/').length || Number(isBarrel(a)) - Number(isBarrel(b)) || a.localeCompare(b),
);

const seen = new Set<object>();
const reports: Report[] = [];

for (const file of byDepth) {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch {
    continue; // Not every file in a template package is a schema.
  }
  for (const [name, value] of Object.entries(mod)) {
    if (!isNode(value) || value.meta === undefined || seen.has(value)) continue;
    seen.add(value);
    reports.push(measure(value, relative(process.cwd(), file), name));
  }
}

const n = (v: number) => v.toLocaleString('en-GB');

/*
  `--show` prints the head of each repeated subtree.

  Off by default because it is long, and on hand because without it the report says a shape is
  written four times and gives no way to find out which shape — the path trail names the types
  around it, which is rarely enough to recognise a node among a thousand of the same type.
*/
const show = process.argv.includes('--show');

const waste = (rep: Repeat) => rep.size * (rep.count - 1);

for (const r of reports.sort((a, b) => b.chars - a.chars)) {
  const ratio = (r.chars / r.gzipped).toFixed(1);
  console.log(`\n${r.name}  ${r.file}`);
  console.log(`   ${n(r.chars)} chars   ${n(r.nodes)} nodes   gzip ${ratio}×`);

  /*
    Branch overlaps first, and all of them.

    They are the half of the report somebody can act on today, and they are usually the smaller
    half — ranking everything together by bytes buries them under repeats that need a reference
    mechanism before they can go anywhere.
  */
  for (const o of r.overlaps) {
    const of = Math.round((o.shared / Math.min(o.then, o.else)) * 100);
    console.log(`   $if sides share ${n(o.shared)} chars (${of}% of the smaller side)   ${o.where}`);
  }

  for (const rep of r.repeats.slice(0, 5)) {
    console.log(`   repeat ×${rep.count}  ${n(rep.size)} chars  wasted ${n(waste(rep))}   ${rep.where}`);
    if (show) console.log(`      ${rep.key.slice(0, 300)}…`);
  }
  if (r.repeats.length > 5) console.log(`   …and ${r.repeats.length - 5} more repeats`);
}

const total = reports.reduce((a, r) => a + r.chars, 0);
const repeated = reports.reduce((a, r) => a + r.repeats.reduce((b, p) => b + waste(p), 0), 0);
const overlapping = reports.reduce((a, r) => a + r.overlaps.reduce((b, o) => b + o.shared, 0), 0);

console.log(`\n${reports.length} schemas · ${n(total)} chars`);
console.log(`   ${n(repeated)} in repeated subtrees`);
console.log(`   ${n(overlapping)} shared between the two sides of a $if`);
