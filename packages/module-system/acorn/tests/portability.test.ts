/**
 * The S2-4 contract gate's portable-module half: `@we/module-acorn` is data plus pure functions,
 * and it stays that way. What a module may not do and still register on every host is reach a
 * backend — import `@coasys/*` or an adapter, or call a write that only one host answers. The
 * registration test checks the declaration (`requires.backends` absent); this checks that the
 * declaration is true, by reading the package and walking every part.
 *
 * The writes the parts may make are the generic record paths every host gives a space surface:
 * `record.*` and `recordStore.updateRecordField`. On the in-memory host they are row writes, on
 * the AD4M host they reach the mount's `create`/`update`/`delete` call actions — the same
 * invocation either way, which is what makes the module portable rather than merely lint-clean.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACORN_PARTS } from '../src/index.ts';

const ROOT = join(import.meta.dirname, '..');

/** Every `$invoke` target in a node tree, wherever it sits — props, handler arrays, `$if` branches. */
function invokes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) invokes(n, out);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (typeof record.$invoke === 'string') out.push(record.$invoke);
    for (const value of Object.values(record)) invokes(value, out);
  }
  return out;
}

/** Every `$part` id a node tree places. */
function placedParts(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const n of node) placedParts(n, out);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record.type === '$part') out.push(String((record.props as { id?: unknown } | undefined)?.id));
    for (const value of Object.values(record)) placedParts(value, out);
  }
  return out;
}

const GENERIC_WRITES = new Set(['record.create', 'record.update', 'record.delete', 'recordStore.updateRecordField']);

describe('@we/module-acorn — portable', () => {
  it('depends on no backend: no @coasys, no adapter, no app shell', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
    // Runtime deps only — the tests may stand the fixture on the in-memory backend.
    const runtime = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    expect(runtime.filter((d) => /^@coasys\/|^@we\/backend-|^@we\/app-shell$/.test(d))).toEqual([]);
  });

  it('its sources import nothing but the module contract and the schema types', () => {
    const files = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'));
    const specifiers = files.flatMap((f) =>
      [...readFileSync(join(ROOT, 'src', f), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]),
    );
    const external = specifiers.filter((s) => !s.startsWith('.'));
    expect(external.filter((s) => !['@we/module-shared', '@we/schema-shared'].includes(s))).toEqual([]);
  });

  it('every write a part makes is a generic record write both hosts answer', () => {
    const all = Object.entries(ACORN_PARTS).flatMap(([name, part]) =>
      invokes(part.node).map((target) => ({ name, target })),
    );
    // The expanded outcome and the list both write — the gate is not vacuous.
    expect(all.some((w) => w.name === 'expandedOutcome')).toBe(true);
    expect(all.filter((w) => !GENERIC_WRITES.has(w.target))).toEqual([]);
  });

  it('every part a part places is one of its own', () => {
    const placed = Object.values(ACORN_PARTS).flatMap((part) => placedParts(part.node));
    expect(placed).toContain('acorn.expandedOutcome');
    for (const id of placed) {
      expect(id.startsWith('acorn.'), `"${id}" is another module's part`).toBe(true);
      expect(ACORN_PARTS[id.slice('acorn.'.length)], `"${id}" names no acorn part`).toBeDefined();
    }
  });
});
