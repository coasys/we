/**
 * The operations suite covers the spec: every verb runs in some operations vector, every error code
 * an implementation raises is some vector's outcome, every static check has a vector it refuses, and
 * every core function and comprehension has a core-subset expression vector. A new verb, code, check
 * or function without a case fails here, by name.
 *
 * The lists are the reference's own (the error code types, `CORE_FUNCTIONS`, the format's verbs), so
 * adding one to the implementation without a vector is what this catches.
 */
import { readFileSync } from 'node:fs';

import type { PreconditionErrorCode, StaticErrorCode } from '@we/entities';
import { CORE_FUNCTIONS, type Expr, MACRO_NAMES, parseExpression, walkExpr } from '@we/expressions';
import { describe, expect, it } from 'vitest';

import { readOperationVectors } from '../src/operations';

const TEMPLATE_VECTORS = new URL('../../../schema-system/conformance/vectors/', import.meta.url);
const load = <T>(url: URL): T => JSON.parse(readFileSync(url, 'utf8')) as T;

/** Every code the runner raises, as its types list them: a record so a new code must be added here. */
const STATIC_CODES: Record<StaticErrorCode, true> = {
  malformed: true,
  unknownOperation: true,
  versionMismatch: true,
  badArgs: true,
  unboundName: true,
  unknownEntity: true,
  outsideOneOf: true,
  notGranted: true,
  protectedEntity: true,
  forEachKey: true,
  notAList: true,
  callDepth: true,
};
const PRECONDITION_CODES: Record<PreconditionErrorCode, true> = {
  notFound: true,
  ambiguous: true,
  alreadyLinked: true,
  notLinked: true,
  notOwn: true,
  recordExists: true,
  expectChanged: true,
  refused: true,
};
const VERBS = ['find', 'create', 'update', 'delete', 'link', 'unlink', 'setRelation', 'forEach', 'check', 'call'];

const vectors = readOperationVectors().cases;

describe('the operations vectors cover the spec', () => {
  it('run every verb', () => {
    const seen = new Set<string>();
    const walk = (steps: unknown[]) => {
      for (const step of steps)
        for (const [verb, body] of Object.entries(step as Record<string, { steps?: unknown[] }>)) {
          seen.add(verb);
          if (verb === 'forEach') walk(body.steps ?? []);
        }
    };
    for (const v of vectors)
      for (const op of [...Object.values(v.manifest.operations), ...Object.values(v.calls)]) walk(op.steps);
    expect(VERBS.filter((verb) => !seen.has(verb))).toEqual([]);
  });

  it('end in every error code, in its class', () => {
    const seen = new Set(
      vectors.map((v) => ('error' in v.outcome ? `${v.outcome.error.class}:${v.outcome.error.code}` : '')),
    );
    const missing = [
      ...Object.keys(STATIC_CODES).map((code) => `static:${code}`),
      ...Object.keys(PRECONDITION_CODES).map((code) => `precondition:${code}`),
    ].filter((code) => !seen.has(code));
    expect(missing).toEqual([]);
    // A check's own error is a precondition named by the operation.
    expect(
      vectors.some(
        (v) =>
          'error' in v.outcome &&
          !(v.outcome.error.code in PRECONDITION_CODES) &&
          v.outcome.error.class === 'precondition',
      ),
    ).toBe(true);
  });

  it('refuse every static check in static-checks.json', () => {
    const file = load<{ cases: { check: number; refused: boolean }[] }>(
      new URL('../vectors/operations/static-checks.json', import.meta.url),
    );
    const refused = new Set(file.cases.filter((c) => c.refused).map((c) => c.check));
    expect([...Array(15).keys()].map((i) => i + 1).filter((check) => !refused.has(check))).toEqual([]);
  });
});

describe('the core-subset expression vectors cover the core library', () => {
  const functions = load<{ cases: { fn: string; core: boolean }[] }>(new URL('functions.json', TEMPLATE_VECTORS));
  const expressions = load<{ cases: { source: string; core: boolean; error?: string }[] }>(
    new URL('expressions.json', TEMPLATE_VECTORS),
  );

  it('give every core function a case of its own', () => {
    const covered = new Set(functions.cases.filter((c) => c.core).map((c) => c.fn));
    expect([...CORE_FUNCTIONS].filter((name) => !covered.has(name))).toEqual([]);
  });

  it('mark as core only cases of core functions', () => {
    expect(functions.cases.filter((c) => c.core && !CORE_FUNCTIONS.has(c.fn)).map((c) => c.fn)).toEqual([]);
  });

  it('use every comprehension in some core expression', () => {
    const macros = new Set<string>();
    for (const c of expressions.cases) {
      if (!c.core || c.error) continue;
      walkExpr(parseExpression(c.source) as Expr, (node) => {
        if (node.kind === 'macro') macros.add(node.name);
      });
    }
    expect(MACRO_NAMES.filter((name) => !macros.has(name))).toEqual([]);
  });

  it('call no function outside the core library in a core expression', () => {
    const outside: string[] = [];
    for (const c of expressions.cases) {
      if (!c.core || c.error) continue;
      walkExpr(parseExpression(c.source) as Expr, (node) => {
        if (node.kind === 'call' && !CORE_FUNCTIONS.has(node.callee)) outside.push(`${c.source}: ${node.callee}`);
      });
    }
    expect(outside).toEqual([]);
  });
});
