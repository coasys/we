#!/usr/bin/env node
/**
 * Which `filter()` and `find()` calls in the composed templates count on an absent value matching?
 *
 * A record with no value for a field — never written, or cleared — matches no comparison, `exists`
 * aside, and `''` is no value. A `$query` has always answered that way. `filter()` and `find()` did
 * not: they compared in plain JavaScript, so `{ assignee: { not: 'Ann' } }` kept every task nobody
 * was on, `{ title: '' }` found the untitled ones, and `{ name: { contains: local.search } }` with
 * the search box empty kept rows that had no name. They now give the `$query` answer, and a where
 * written against the old one quietly loses rows. This finds the wheres that could.
 *
 * ## What is a finding
 *
 * Inside the where-object of a `filter()` or `find()` call:
 *
 * - **`not`** — `{ field: { not: x } }`, scalar or list. It used to keep rows without the field.
 * - **`''`** — `{ field: '' }`. It used to find rows whose field was empty; nothing is, now.
 * - **a text match on a computed operand** — `contains`, `startsWith` or `endsWith` against an
 *   expression rather than a literal. With the operand empty, it used to keep every row, the ones
 *   without the field included; it now keeps the ones that have one.
 *
 * A `not` beside an `exists: false` on the same field, in an `OR`, is the fix and not a finding:
 * `{ OR: [{ field: { not: x } }, { field: { exists: false } }] }`. So is a where the list below
 * names, with the reason — usually that every row the list can hold carries the field.
 *
 * ## Why it walks the composed tree
 *
 * For the reason `query-audit` does: a kit fragment contributes expressions that no grep over the
 * route rendering it will attribute to it. Bundles checked in as JSON are read as they are.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Expr, ObjectExpr } from '@we/expressions';
import { parseExpression, printExpression } from '@we/expressions';

register('./assetHooks.mjs', import.meta.url);

type Kind = 'not' | 'empty' | 'text';

/**
 * Wheres that are right as they are, with the reason. Matched on whichever of `file` and `field` an
 * entry gives, all of which must agree. An entry that has stopped matching is an exemption that has
 * quietly stopped exempting, so the summary prints how many matched.
 */
const DELIBERATE: { file?: RegExp; field?: string; kind?: Kind; why: string }[] = [
  {
    field: 'author',
    kind: 'not',
    why: 'leaving out what muted members wrote — every record carries its author, stamped when it is written',
  },
  {
    field: 'retired',
    kind: 'not',
    why: 'the signal types still offered — retired is declared with a default of false, written when a type is made',
  },
  {
    field: 'startDate',
    kind: 'text',
    why: 'the events of a calendar day — the operand is a day of the grid, never empty',
  },
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

interface Finding {
  file: string;
  field: string;
  kind: Kind;
  source: string;
  held?: string;
}

const findings: Finding[] = [];

/** The where argument of a `filter`/`find` call: the first after the list, which a method call has as its receiver. */
function whereOf(call: Expr): Expr | undefined {
  if (call.kind !== 'call' || (call.callee !== 'filter' && call.callee !== 'find')) return undefined;
  return call.receiver ? call.args[0] : call.args[1];
}

/** Every sub-expression, so a call nested in a ternary or another call is reached. */
function children(e: Expr): Expr[] {
  switch (e.kind) {
    case 'template':
      return e.parts.filter((p): p is Expr => typeof p !== 'string');
    case 'member':
      return [e.object];
    case 'index':
      return [e.object, e.index];
    case 'unary':
      return [e.operand];
    case 'binary':
    case 'logical':
      return [e.left, e.right];
    case 'conditional':
      return [e.test, e.consequent, e.alternate];
    case 'call':
      return [...(e.receiver ? [e.receiver] : []), ...e.args];
    case 'macro':
      return [e.receiver, e.body];
    case 'list':
      return e.elements;
    case 'object':
      return e.entries.map((entry) => entry.value);
    default:
      return [];
  }
}

const entry = (o: ObjectExpr, key: string) => o.entries.find((e) => e.key === key)?.value;

/** The fields an `OR`'s branches ask to be absent — `{ field: { exists: false } }` on its own. */
function absentBranches(branches: Expr[]): Set<string> {
  const out = new Set<string>();
  for (const branch of branches) {
    if (branch.kind !== 'object' || branch.entries.length !== 1) continue;
    const [{ key, value }] = branch.entries;
    if (value.kind !== 'object') continue;
    const exists = entry(value, 'exists');
    if (exists?.kind === 'literal' && exists.value === false) out.add(key);
  }
  return out;
}

/**
 * What a condition guarantees is non-empty where it holds: `local.search ? … : …` and
 * `trim(local.search) ? … : …` both say the consequent runs only with something typed.
 */
function guardOf(test: Expr): string | undefined {
  if (test.kind === 'ident' || test.kind === 'member') return printExpression(test);
  if (test.kind === 'call' && test.callee === 'trim' && !test.receiver && test.args.length === 1) {
    return printExpression(test.args[0]);
  }
  return undefined;
}

const guarded = (guards: Set<string>, test: Expr) => {
  const guard = guardOf(test);
  return guard ? new Set([...guards, guard]) : guards;
};

type Report = (field: string, kind: Kind) => void;

/**
 * One where-object, or a condition choosing between two. `covered` holds the fields an enclosing
 * `OR` already admits when absent; `guards` the operands an enclosing condition holds non-empty.
 */
function auditWhere(where: Expr, covered: Set<string>, guards: Set<string>, report: Report): void {
  if (where.kind === 'conditional') {
    auditWhere(where.consequent, covered, guarded(guards, where.test), report);
    auditWhere(where.alternate, covered, guards, report);
    return;
  }
  if (where.kind !== 'object') return;
  for (const { key, value } of where.entries) {
    if (key === 'OR' || key === 'AND') {
      if (value.kind !== 'list') continue;
      const inner = key === 'OR' ? new Set([...covered, ...absentBranches(value.elements)]) : covered;
      for (const branch of value.elements) auditWhere(branch, inner, guards, report);
      continue;
    }
    if (key === 'NOT') {
      auditWhere(value, covered, guards, report);
      continue;
    }
    if (value.kind === 'literal' && value.value === '') report(key, 'empty');
    if (value.kind !== 'object') continue;
    if (entry(value, 'not') && !covered.has(key)) report(key, 'not');
    for (const op of ['contains', 'startsWith', 'endsWith']) {
      const operand = entry(value, op);
      if (operand && operand.kind !== 'literal' && !guards.has(printExpression(operand))) report(key, 'text');
    }
  }
}

/** Every `filter`/`find` where in an expression, under the guards of the conditions it sits in. */
function visit(e: Expr, guards: Set<string>, report: Report): void {
  const where = whereOf(e);
  if (where) auditWhere(where, new Set(), guards, report);
  if (e.kind === 'conditional') {
    visit(e.test, guards, report);
    visit(e.consequent, guarded(guards, e.test), report);
    visit(e.alternate, guards, report);
    return;
  }
  for (const child of children(e)) visit(child, guards, report);
}

/** Findings already reported, by what they say: a fragment composed into ten templates is one finding. */
const reported = new Set<string>();

function auditExpression(source: string, file: string): void {
  let ast: Expr;
  try {
    ast = parseExpression(source);
  } catch {
    return; // The validator reports a syntax error; this only reads what parses.
  }
  visit(ast, new Set(), (field, kind) => {
    const key = `${field}\u0000${kind}\u0000${source}`;
    if (reported.has(key)) return;
    reported.add(key);
    const held = DELIBERATE.find(
      (d) => (!d.file || d.file.test(file)) && (!d.field || d.field === field) && (!d.kind || d.kind === kind),
    )?.why;
    findings.push({ file, field, kind, source, held });
  });
}

/** Expression tokens already read, by identity: a fragment re-exported through a barrel is one fragment. */
const seen = new Set<object>();

function walk(value: unknown, file: string): void {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, file);
    return;
  }
  if (!isObj(value) || seen.has(value)) return;
  seen.add(value);
  if (typeof value.$ === 'string') auditExpression(value.$, file);
  for (const v of Object.values(value)) walk(v, file);
}

async function walkDir(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name === 'dist' || item.name.startsWith('.')) continue;
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...(await walkDir(full)));
    else if (
      (item.name.endsWith('.ts') && !item.name.endsWith('.test.ts') && !item.name.endsWith('.d.ts')) ||
      item.name.endsWith('.bundle.json')
    )
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

// Deepest path first, so an expression is attributed to the file that wrote it rather than a barrel.
const isBarrel = (f: string) => f.endsWith('/index.ts');
files.sort(
  (a, b) =>
    b.split('/').length - a.split('/').length || Number(isBarrel(a)) - Number(isBarrel(b)) || a.localeCompare(b),
);

for (const file of files) {
  if (file.endsWith('.json')) {
    walk(JSON.parse(await readFile(file, 'utf8')) as unknown, file);
    continue;
  }
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch {
    continue; // Not every file in a template package is a schema.
  }
  for (const value of Object.values(mod)) walk(value, file);
}

const open = findings.filter((f) => !f.held);
const held = findings.filter((f) => f.held);

const KIND: Record<Kind, string> = {
  not: 'not — used to keep rows without the field',
  empty: "'' — nothing is empty now; ask exists: false",
  text: 'text match on a computed operand — used to keep rows without the field while it was empty',
};

const byFile = new Map<string, Finding[]>();
for (const f of open) {
  const key = relative(process.cwd(), f.file);
  if (!byFile.has(key)) byFile.set(key, []);
  byFile.get(key)!.push(f);
}
for (const [file, list] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${file}  (${list.length})`);
  for (const f of list) console.log(`   ${f.field}: ${KIND[f.kind]}\n      ${f.source}`);
}

console.log(`\nRight as they are (${held.length}):`);
const unused = DELIBERATE.filter((d) => !held.some((f) => f.held === d.why));
for (const d of unused) console.log(`   (matched nothing — delete it?)  ${d.why}`);
const reasons = new Map<string, number>();
for (const f of held) reasons.set(f.held!, (reasons.get(f.held!) ?? 0) + 1);
for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`   ${String(n).padStart(3)}  ${why}`);

if (open.length) {
  console.log(`\n${open.length} wheres that may count on an absent value matching.`);
  console.log(`Add { OR: [<the comparison>, { field: { exists: false } }] } where rows without the field belong,`);
  console.log(`or say in DELIBERATE in this file why every row carries it.`);
} else {
  console.log(`\nNo filter() or find() counts on an absent value matching.`);
}
process.exit(open.length ? 1 : 0);
