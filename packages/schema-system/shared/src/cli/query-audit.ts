#!/usr/bin/env node
/**
 * Which queries in the composed templates read everything there is?
 *
 * A `$query` with no `limit` asks the backend for every row of that entity in scope, and keeps
 * asking: a subscription re-runs the whole query on every change to the class, parses every result,
 * and fingerprints the lot to decide whether anything moved. So the cost of one change is
 * proportional to everything that has ever accumulated, and the cost of N changes is N² — which is
 * why a call whose transcript is growing gets slower the longer it runs rather than staying level.
 *
 * Worse, the cost is invisible while a space is young. Every unbounded query in this repo was
 * written against a handful of rows and behaved perfectly; the transcript that started this audit
 * was fine for twenty minutes and unusable at forty.
 *
 * ## Why a script rather than the validator
 *
 * A query with no bound is *valid*, and must stay valid — a vocabulary is read whole on purpose.
 * The mistake is a judgement about what grows, which is exactly the shape `role-audit` handles one
 * concept along, and for the same reason it walks the composed tree rather than grepping source: a
 * `cardList()` from the kit contributes a query that no grep over the route's file will attribute
 * to it.
 *
 * ## What is a finding and what is not
 *
 * A finding is a query with no `limit` that nothing else bounds. Four things bound a query without
 * a `limit`, and each is checked rather than listed:
 *
 * - **`where.id`** names a known set — the rows are as many as the ids given.
 * - **`scope.levels` / `scope.limitPerAnchor`** bound a walk at each depth, which is the whole
 *   point of writing one.
 * - **A vocabulary entity** is a set a community curates by hand: task states, signal types, the
 *   kinds of involvement. It grows when somebody names something, never with use, and reading half
 *   of one is wrong rather than merely shorter.
 * - **A file that says so**, in `DELIBERATE` below, with the reason written down.
 *
 * Everything else is reported. That does not make it a defect — a list nobody scrolls is not a
 * problem however long it is — but it makes it a decision somebody took rather than one that got
 * taken by default, which is the difference this script exists for.
 */
import { readdir, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

register('./assetHooks.mjs', import.meta.url);

interface Node {
  type?: string;
  props?: Record<string, unknown>;
  children?: unknown;
  routes?: unknown;
  slots?: Record<string, unknown>;
  $queries?: Record<string, unknown>;
  [k: string]: unknown;
}

const isNode = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Entities whose every row is the answer — a set a community curates by hand.
 *
 * These grow when somebody *names* something and never with use, so they are read whole on purpose
 * and a page of one would be wrong rather than shorter: a status picker showing the first twenty of
 * a community's states is a picker that cannot reach the twenty-first, and a card resolving a
 * signal by slug against half the list draws the wrong glyph.
 *
 * Named rather than inferred, because nothing in a query distinguishes "this set is curated" from
 * "this list has not grown yet". The test for adding one is whether its size is bounded by a
 * decision somebody made rather than by how much the space has been used.
 */
const VOCABULARY = new Set([
  'SignalType',
  'TaskState',
  'InvolvementType',
  'RelationshipType',
  'Topic',
  'TypeStyle',
  'Shape',
  'Template',
  'Theme',
]);

/**
 * Queries that are unbounded on purpose, with the reason.
 *
 * Matched on whichever of `file`, `name` and `entity` an entry gives, all of which must agree —
 * because the judgement is per query rather than per file: the Pocket's folder list is navigation
 * and its item list is not, and they sit in the same `$queries` block.
 *
 * Several here name no file, and that is a compromise worth stating. A query written inside a
 * *fragment* — `taskBoard`, `channelRail` — is reported against every template that composes it,
 * because a fragment is a function and each call builds a fresh object, so there is no one file to
 * point at. Keying those on the query's own name is looser than a path: any query called `pool`
 * anywhere is exempt. The names are distinctive and the reasons are written at the query itself as
 * well as here, which is the mitigation; a tighter rule would need the fragment to be able to say
 * so in the query, which is a schema key nothing else wants yet.
 *
 * A path in a regex is a reference nothing typechecks — the same hazard `role-audit` records — so
 * an entry that has stopped matching is an exemption that has quietly stopped exempting. The
 * summary prints how many matched, which is how that shows up.
 */
const DELIBERATE: { file?: RegExp; name?: string | RegExp; entity?: string; why: string }[] = [
  {
    file: /schemas\/shell\/(SchemaTests|tests\/)/,
    why: 'the schema-test page, whose rows are fixtures it writes itself rather than a space’s content',
  },
  {
    file: /module-system\/pocket\//,
    name: 'folders',
    why: 'a folder list is navigation — a page of it would hide somewhere a person had put something',
  },
  {
    name: 'pool',
    why: 'a board places cards by state; a card outside the page would vanish rather than land in Unplaced',
  },
  {
    name: 'columns',
    why: 'a board’s columns are its whole structure — a page of them would hide a state, not shorten a list',
  },
  {
    name: 'involvements',
    why: 'who is on each card; a partial read draws somebody’s work as nobody’s, which is worse than slow',
  },
  {
    name: /^(categoryRows|channelRows|catChannelRows)$/,
    why: 'a channel rail is navigation — an unreachable channel is a channel nobody can post in',
  },
  { entity: 'Channel', why: 'as above: the rail lists where a community talks, and lists all of it' },
  {
    entity: 'ConversationSubgroup',
    why: 'a foreign app’s conversation opened out — bounded by the conversation somebody expanded',
  },
  {
    file: /module-system\/polls\//,
    name: 'votes',
    why: 'a tally that counted some of the votes would be a wrong number rather than a short list',
  },
  {
    file: /module-system\/notes\//,
    name: 'shares',
    why: '“also posted in …” names every space a note went to; one left out is a claim about where it is',
  },
  {
    file: /GlobeView\//,
    name: 'spaceRows',
    why: 'pins on a map — a page of a map is a blank region. Bound it by the viewport when that exists',
  },
  {
    file: /GraphView\//,
    name: 'canvases',
    why: 'the canvas picker — a canvas it cannot list is a canvas with no way back to it',
  },
];

/** Whether a query is one the list above declares deliberate, and why. */
const declared = (file: string, name: string, entity: string): string | undefined =>
  DELIBERATE.find(
    (d) =>
      (!d.file || d.file.test(file)) &&
      (!d.name || (typeof d.name === 'string' ? d.name === name : d.name.test(name))) &&
      (!d.entity || d.entity === entity),
  )?.why;

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

/** What the query asks for, for the report — a literal name, a list of them, or the expression. */
function entityOf(query: Record<string, unknown>): string {
  const e = query.entity;
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map((x) => (typeof x === 'string' ? x : '…')).join('|');
  if (isObj(e) && typeof e.$ === 'string') return `{ ${e.$} }`;
  return '?';
}

/** Whether something other than `limit` already says how many rows this can be. */
function boundedWithoutLimit(query: Record<string, unknown>): string | undefined {
  const where = query.where;
  if (isObj(where) && where.id !== undefined) return 'where.id';
  const scope = query.scope;
  if (isObj(scope) && (scope.levels !== undefined || scope.limitPerAnchor !== undefined)) return 'scope bound';
  const entity = query.entity;
  if (typeof entity === 'string' && VOCABULARY.has(entity)) return 'vocabulary';
  if (Array.isArray(entity) && entity.every((e) => typeof e === 'string' && VOCABULARY.has(e))) return 'vocabulary';
  return undefined;
}

interface Finding {
  file: string;
  path: string;
  name: string;
  entity: string;
  where: string;
  held?: string;
}

const findings: Finding[] = [];

/**
 * Query objects already reported, by identity.
 *
 * A fragment is re-exported through barrels — `views/src/index.ts` re-exports `Views.schema.ts`,
 * which composes the same route files — so walking every module reaches the *same* query object
 * several times over. Without this the count is a count of import paths rather than of queries, and
 * a file gets a score for re-exporting somebody else's work. Identity rather than a serialisation,
 * because two queries that happen to look alike are two queries.
 */
const seen = new Set<object>();

/** A query as it appears anywhere one can — `$queries`, `$each`'s items, `$single`'s item. */
function record(query: unknown, name: string, file: string, path: string[]) {
  if (!isObj(query) || query.entity === undefined) return;
  if (query.limit !== undefined) return;
  if (seen.has(query)) return;
  seen.add(query);
  const entity = entityOf(query);
  const held = boundedWithoutLimit(query) ?? declared(file, name, entity);
  findings.push({
    file,
    path: path.slice(-3).join(' > '),
    name,
    entity,
    where: query.scope !== undefined ? 'scoped' : query.where !== undefined ? 'filtered' : 'space-wide',
    held,
  });
}

function walk(node: Node, file: string, path: string[]) {
  const here = [...path, node.type ?? '?'];
  if (isObj(node.$queries)) {
    for (const [name, query] of Object.entries(node.$queries)) record(query, name, file, here);
  }
  for (const key of ['items', 'item']) {
    const value = node.props?.[key];
    if (isObj(value) && value.$query !== undefined) record(value.$query, `${node.type}.${key}`, file, here);
  }
  for (const child of descend(node)) walk(child, file, here);
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

/**
 * Deepest path first, so a query is attributed to the file that *wrote* it.
 *
 * Every query here is reported once, at whichever file reached it first — and a barrel reaches
 * everything its package exports. Sorted alphabetically, `views/Views.schema.ts` is walked before
 * `views/views/CardsView/TaskBoard.ts` and collects the board's queries along with everybody
 * else's, which makes the report a list of index files. Depth is a good enough proxy for "this is
 * where it is written", and the path column says which node it hangs off either way. A barrel sits
 * at the same depth as what it re-exports, so `index.ts` goes last among its own siblings too.
 */
const isBarrel = (f: string) => f.endsWith('/index.ts');
const byDepth = files.sort(
  (a, b) =>
    b.split('/').length - a.split('/').length || Number(isBarrel(a)) - Number(isBarrel(b)) || a.localeCompare(b),
);

for (const file of byDepth) {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch {
    continue; // Not every file in a template package is a schema.
  }
  for (const value of Object.values(mod)) if (isNode(value)) walk(value, file, []);
}

const open = findings.filter((f) => !f.held);
const held = findings.filter((f) => f.held);

const byFile = new Map<string, Finding[]>();
for (const f of open) {
  const key = relative(process.cwd(), f.file);
  if (!byFile.has(key)) byFile.set(key, []);
  byFile.get(key)!.push(f);
}

for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${file}  (${list.length})`);
  for (const f of list) console.log(`   ${f.name}: ${f.entity}  (${f.where})  ${f.path}`);
}

/*
  The exemptions are printed, not merely counted.

  An exemption nobody reads is an exemption that stops being true: a list declared "navigation, read
  it all" is right at thirty channels and wrong at three thousand, and the only way that gets
  revisited is if the reason is in front of whoever runs this. Grouped by reason rather than listed
  per query, because the reason is the thing being reviewed.
*/
const reasons = new Map<string, number>();
for (const f of held) reasons.set(f.held!, (reasons.get(f.held!) ?? 0) + 1);

console.log(`\nRead whole on purpose (${held.length}):`);
for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${why}`);
}

if (open.length) {
  console.log(`\n${open.length} queries with no bound.`);
  console.log(`\nGive one a limit — a literal, or a { $: 'local.<field>' } page with loadMore() under it.`);
  console.log(`If it is meant to read everything, say so in DELIBERATE in this file, with the reason.`);
} else {
  console.log(`\nNo query reads a growing list whole.`);
}
process.exit(open.length ? 1 : 0);
