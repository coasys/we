/**
 * The query vectors run from the file alone, the way an implementation that has never seen WE's
 * TypeScript would run them.
 *
 * The shared suite runs them on a backend that already holds WE's whole core manifest, with the
 * file's entities declared beside it. Here the backend is built from nothing but the file's
 * `entities`, so a case that leaned on WE's vocabulary would fail.
 */
import { readFileSync } from 'node:fs';

import {
  QUERY_LEVELS,
  type QueryVectorEnv,
  queryVectorTitle,
  readQueryVectors,
  runQueryVector,
  seedQueryDataset,
} from '@we/backend-conformance';
import { describe, expect, it } from 'vitest';

import { createInMemoryBackendPorts } from '../src/lifecycle';

const AGENT = 'did:test:somebody';
const file = readQueryVectors();

async function fresh(): Promise<QueryVectorEnv> {
  const ports = createInMemoryBackendPorts(
    { selfId: () => AGENT },
    {
      agent: { id: AGENT, unlocked: true },
      datasets: [{ id: 'ds-query-vectors', name: 'Query vectors' }],
      entities: { version: '1', entities: file.entities },
    },
  );
  const dataset = (await ports.lifecycle.get('ds-query-vectors'))!.handle;
  const bindings = ports.dataBindings({
    currentDataset: () => dataset,
    currentDatasetEntities: () => [],
    profiles: () => [],
    fetchProfile: () => {},
    ephemeral: ports.ephemeral,
  });
  await seedQueryDataset(dataset, file.dataset);
  return { bindings, dataset, agent: AGENT, settle: 200 };
}

describe('query vectors, from the file alone', () => {
  it('gives every case a level, a unique id and an expectation', () => {
    const ids = file.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of file.cases) {
      expect(c.id.startsWith(`query.${c.level}.`), c.id).toBe(true);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(0);
      if (c.level === 'live') expect(c.then, c.id).toBeDefined();
    }
  });

  for (const vector of file.cases) {
    it(queryVectorTitle(vector), async () => runQueryVector(await fresh(), file, vector));
  }
});

// ── Coverage of the spec ────────────────────────────────────────────────────

const SPEC = readFileSync(new URL('../../../../docs/spec/template/query.md', import.meta.url), 'utf8');

/** A `## ` section of the spec, up to the next one. */
function section(heading: string): string {
  const start = SPEC.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`query.md has no section "${heading}"`);
  const end = SPEC.indexOf('\n## ', start + 1);
  return SPEC.slice(start, end < 0 ? undefined : end);
}

/** The first cell of every row of the tables in a section, as written. */
function firstCells(text: string): string[] {
  return [...text.matchAll(/^\| (`[^|]+`) +\|/gm)].map((m) => m[1]).filter((cell) => !/^`-+`$/.test(cell));
}

const ticked = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/** Keys a template's host gives a meaning to that no file of records can exercise. */
const NOT_IN_A_VECTOR: Record<string, string> = {
  dataset: 'names one of the host’s datasets; every case reads the one dataset the file seeds',
};

interface Seen {
  query: Set<string>;
  scope: Set<string>;
  where: Set<string>;
  equality: boolean;
  list: boolean;
  include: Set<string>;
  projection: Set<string>;
}

function seen(): Seen {
  const out: Seen = {
    query: new Set(),
    scope: new Set(),
    where: new Set(),
    equality: false,
    list: false,
    include: new Set(),
    projection: new Set(),
  };
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const where = (w: unknown) => {
    if (!isObject(w)) return;
    for (const [key, value] of Object.entries(w)) {
      if (key === 'AND' || key === 'OR') {
        out.where.add(key);
        (value as unknown[]).forEach(where);
      } else if (key === 'NOT') {
        out.where.add(key);
        where(value);
      } else if (Array.isArray(value)) out.list = true;
      else if (isObject(value)) {
        for (const [op, operand] of Object.entries(value)) {
          out.where.add(op);
          if (op === 'some' || op === 'none') where(operand);
        }
      } else out.equality = true;
    }
  };
  const include = (map: unknown) => {
    if (!isObject(map)) return;
    for (const [key, spec] of Object.entries(map)) {
      if (key.startsWith('$')) {
        for (const k of Object.keys(spec as object)) out.projection.add(k);
        where((spec as { where?: unknown }).where);
      } else if (spec === true) out.include.add('true');
      else if (isObject(spec)) {
        for (const k of Object.keys(spec)) out.include.add(k);
        where(spec.where);
        include(spec.include);
      }
    }
  };
  for (const c of file.cases) {
    for (const key of Object.keys(c.query)) out.query.add(key);
    for (const key of Object.keys((c.query.scope as object | undefined) ?? {})) out.scope.add(key);
    where(c.query.where);
    include(c.query.include);
  }
  return out;
}

describe('query vectors cover query.md', () => {
  const used = seen();

  it('every key of the query object', () => {
    const keys = firstCells(section('The query object')).map((cell) => cell.slice(1, -1));
    expect(keys.length).toBeGreaterThan(8);
    expect(keys.filter((key) => !used.query.has(key) && !(key in NOT_IN_A_VECTOR))).toEqual([]);
  });

  it('every key of a scope', () => {
    const keys = firstCells(section('Scope')).map((cell) => cell.slice(1, -1));
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((key) => !used.scope.has(key))).toEqual([]);
  });

  it('every condition, quantifier and combinator', () => {
    // The grammar's list is the paragraph of "Where" that says what `where` is, naming each in backticks.
    const grammar = section('Where')
      .split('\n\n')
      .find((paragraph) => paragraph.startsWith('`where` is'))!;
    const operators = ticked(grammar).filter((t) => /^[A-Za-z]+$/.test(t) && t !== 'where');
    expect(operators.length).toBeGreaterThan(12);
    expect(operators.filter((op) => !used.where.has(op))).toEqual([]);
    expect({ equality: used.equality, list: used.list }).toEqual({ equality: true, list: true });
  });

  it('every form of include and of a projection', () => {
    const forms = [...firstCells(section('Include')), ...firstCells(section('Counts'))];
    const missing: string[] = [];
    for (const form of forms) {
      const projection = form.startsWith('`$');
      const keys = /\{([^}]*)\}/
        .exec(form)?.[1]
        .split(',')
        .map((k) => k.trim().replace(/[?:].*$/, '')) ?? ['true'];
      for (const key of keys)
        if (!(projection ? used.projection : used.include).has(key)) missing.push(`${form} ${key}`);
    }
    expect(forms.length).toBeGreaterThan(3);
    expect(missing).toEqual([]);
  });

  it('every level, and every open question', () => {
    expect(QUERY_LEVELS.filter((level) => !file.cases.some((c) => c.level === level))).toEqual([]);
    const pending = file.cases.map((c) => c.pending ?? '').join('\n');
    for (const question of ['clearing rule', 'union de-duplication', 'multi-valued scalars'])
      expect(pending, question).toContain(question);
  });
});
