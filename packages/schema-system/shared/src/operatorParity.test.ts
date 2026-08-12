import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The prop dispatcher and the zod token union are **two hand-maintained lists of the same thing**,
 * and they drift silently in one direction: an operator added to the dispatcher works at runtime and
 * is rejected by the validator, so a schema that renders correctly fails to validate — or, worse,
 * is written to avoid a validation error that was never real.
 *
 * Both had happened by the time this was written. `$plural` was documented, resolvable, and missing
 * from the union, so any schema using a count-noun label was an error; the only fragment emitting
 * one had no validated caller, so nobody found out for months. Token-valued `limit` was the same
 * story — the renderer deep-resolves query params, but the schema said `number`, which made every
 * paginated list unvalidatable.
 *
 * Reading the source is deliberate. The drift is *textual* — two lists of names in two files — and
 * neither side exposes its set at runtime: the dispatcher is an if-chain and the union is a zod
 * type. Comparing behaviour instead would need a valid instance of every token, which is a third
 * hand-maintained list and the same problem again.
 */

const SRC = import.meta.dirname;

/**
 * Comments out, before anything is extracted.
 *
 * Not defensive tidying — it is load-bearing, and this test failed to catch its own motivating bug
 * without it. The doc comment above `zPluralToken` contains the literal text `{ $plural: … }` as an
 * example, so deleting `zPluralToken` from the union still left `$plural` in the extracted set and
 * the drift went unnoticed a second time. Prose about operators will always contain operators.
 *
 * Line comments are stripped only when they begin a line or follow a space, so the `//` in
 * `we://children` survives.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

const dispatcherSource = stripComments(readFileSync(resolve(SRC, 'propResolvers/dispatcher.ts'), 'utf-8'));
const zodSource = stripComments(readFileSync(resolve(SRC, 'zodSchemas.ts'), 'utf-8'));

/** Operator names the dispatcher branches on: `hasToken(value, '$store', …)`. */
function dispatcherOperators(): Set<string> {
  return new Set([...dispatcherSource.matchAll(/hasToken\(value, '(\$[a-zA-Z]+)'/g)].map((m) => m[1]));
}

/** Operator names the `zPropToken` union accepts, read off each member's declaration. */
function zodOperators(): { names: Set<string>; unresolved: string[] } {
  const union = /const zPropToken = z\.union\(\[([\s\S]*?)\]\);/.exec(zodSource);
  if (!union) throw new Error('could not find the zPropToken union — this test needs updating');

  const members = [...union[1].matchAll(/\bz([A-Z]\w*Token)\b/g)].map((m) => `z${m[1]}`);
  const names = new Set<string>();
  const unresolved: string[] = [];

  for (const member of members) {
    // The member's declaration, up to the next top-level `const`.
    const decl = new RegExp(`^const ${member} = [\\s\\S]*?(?=^const )`, 'm').exec(zodSource);
    if (!decl) {
      unresolved.push(member);
      continue;
    }
    for (const key of decl[0].matchAll(/(\$[a-zA-Z]+):/g)) names.add(key[1]);
  }
  return { names, unresolved };
}

/**
 * Accepted asymmetries, each with a reason. Anything else failing is a real gap.
 *
 * `$query` is the only one: a query is resolved by the *renderer* — which turns it into a
 * subscription with a lifecycle — rather than by `resolveProp`, which returns a value. The union
 * still has to accept it, because a template writes one in a prop.
 */
const ZOD_ONLY = new Set(['$query']);

describe('prop operators are declared in both the dispatcher and the zod union', () => {
  it('extracts a plausible set from each side', () => {
    // Guards against the real failure mode of a source-reading test: a regex that matches nothing
    // and therefore passes for the wrong reason.
    const dispatcher = dispatcherOperators();
    const { names: zod, unresolved } = zodOperators();

    expect(unresolved, 'union members whose declaration could not be found').toEqual([]);
    expect(dispatcher.size).toBeGreaterThan(20);
    expect(zod.size).toBeGreaterThan(20);
    expect(dispatcher).toContain('$store');
    expect(zod).toContain('$store');
  });

  it('every operator the dispatcher resolves is accepted by the validator', () => {
    const missing = [...dispatcherOperators()].filter((op) => !zodOperators().names.has(op)).sort();
    expect(
      missing,
      'these resolve at runtime but the validator rejects them — add a token schema to zodSchemas.ts ' +
        'and include it in the zPropToken union',
    ).toEqual([]);
  });

  it('every operator the validator accepts is either resolvable or a listed exception', () => {
    const dispatcher = dispatcherOperators();
    const extra = [...zodOperators().names].filter((op) => !dispatcher.has(op) && !ZOD_ONLY.has(op)).sort();
    expect(
      extra,
      'the validator accepts these but nothing resolves them, so a schema using one renders nothing — ' +
        'either implement it in the dispatcher or add it to ZOD_ONLY with a reason',
    ).toEqual([]);
  });

  it('every listed exception is still zod-only, so the list cannot rot', () => {
    // If an exception gains a dispatcher branch, the entry is stale and should go.
    const dispatcher = dispatcherOperators();
    const stale = [...ZOD_ONLY].filter((op) => dispatcher.has(op));
    expect(stale, 'these are now resolved by the dispatcher — remove them from ZOD_ONLY').toEqual([]);
  });
});
