import { evaluateExpression, getFunction, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { panel } from './Panel.schema';

/**
 * What the panel's expressions actually evaluate to.
 *
 * The validator checks that a name exists, a function is real and its arity is right. It does not
 * evaluate, so it had nothing to say about the bug this file exists for: **WE's `||` answers with a
 * boolean, never with an operand.** Every fallback in the panel was written `a || b`, which meant
 * the folder anchor resolved to `true` — reaching the executor as "data did not match any variant
 * of untagged enum Scope" and, on a write, as "Link source must not be empty". Two rounds of
 * testing, and nothing in the toolchain could have said so.
 *
 * So these evaluate the real expressions out of the real schema against a stand-in environment.
 * Cheap, and it fails on the spelling that looks right in every other language.
 */

/** A tiny environment: named roots resolve to the given values, functions come from the library. */
function env(roots: Record<string, unknown>) {
  return {
    root: (name: string) => (name in roots ? { bound: true, value: roots[name] } : { bound: false, value: undefined }),
    call: (name: string, args: unknown[]) => getFunction(name)?.impl(args, {} as never),
  };
}

const run = (source: string, roots: Record<string, unknown>) => evaluateExpression(parseExpression(source), env(roots));

/**
 * Every `{ $: … }` in the tree with the key it sits under, so a fallback added later is covered
 * without editing this — and so a *condition* can be told from a *value*, which is the whole
 * distinction the rule below turns on.
 */
interface FoundExpression {
  source: string;
  /** The prop name it was found under; `condition` is the one place a boolean is the point. */
  key: string;
}

function expressionsIn(node: unknown, key = '', found: FoundExpression[] = []): FoundExpression[] {
  if (Array.isArray(node)) {
    for (const child of node) expressionsIn(child, key, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (typeof record.$ === 'string') found.push({ source: record.$, key });
  for (const [name, value] of Object.entries(record)) expressionsIn(value, name === 'props' ? key : name, found);
  return found;
}

/** Just the sources, for a test that does not care where one sits. */
const sourcesIn = (node: unknown): string[] => expressionsIn(node).map((e) => e.source);

describe('the folder anchor', () => {
  // Lifted from the schema itself rather than restated, so it cannot drift from what ships.
  const anchor = sourcesIn(panel).find((source) => source.includes('first(local.rootFolder)'))!;

  it('is the folder somebody navigated into, when there is one', () => {
    expect(run(anchor, { modules: { pocket: { folderId: 'PocketFolder-9' } }, local: { rootFolder: [] } })).toBe(
      'PocketFolder-9',
    );
  });

  it('falls back to the root folder — as an id, not as a boolean', () => {
    // The whole bug: `||` would answer `true` here, and `true` is what reached the executor.
    const value = run(anchor, {
      modules: { pocket: { folderId: '' } },
      local: { rootFolder: [{ id: 'PocketFolder-1' }] },
    });

    expect(value).toBe('PocketFolder-1');
    expect(typeof value).toBe('string');
  });

  it('is falsy while no folder exists, so the gate above it holds', () => {
    const value = run(anchor, { modules: { pocket: { folderId: '' } }, local: { rootFolder: [] } });
    expect(value).toBeFalsy();
    // Not `false` from a boolean operator — absent, which is what "no anchor yet" means.
    expect(value).not.toBe(false);
  });
});

describe('every fallback the panel draws with', () => {
  /**
   * No expression may use `||` or `&&` **outside a condition**.
   *
   * In a condition a boolean is exactly the point, and the panel has two that rightly use `&&`.
   * Anywhere else a logical operator is somebody reaching for JavaScript's fallback idiom and
   * getting `true` — which is the bug this file exists for. The ternary is the operator that
   * answers with an operand.
   */
  it('uses a ternary rather than a logical operator, outside a condition', () => {
    const offenders = expressionsIn(panel)
      .filter((found) => found.key !== 'condition')
      .filter((found) => found.source.includes('||') || found.source.includes('&&'))
      .map((found) => `${found.key}: ${found.source}`);

    expect(offenders).toEqual([]);
  });

  it('renders a label rather than a boolean when a row has none', () => {
    const label = sourcesIn(panel).find((source) => source.includes("'Untitled'"))!;
    expect(run(label, { item: { label: '', entity: 'CollectionBlock' } })).toBe('CollectionBlock');
    expect(run(label, { item: { label: '', entity: '' } })).toBe('Untitled');
    expect(run(label, { item: { label: 'A post', entity: 'CollectionBlock' } })).toBe('A post');
  });

  it('renders an icon name rather than a boolean when a row has none', () => {
    const icon = sourcesIn(panel).find((source) => source.includes("'bookmark-simple'"))!;
    expect(run(icon, { item: { icon: '' } })).toBe('bookmark-simple');
    expect(run(icon, { item: { icon: 'newspaper' } })).toBe('newspaper');
  });
});

/** A guard on the shape the gate depends on, so the two cannot be separated by accident. */
describe('the contents gate', () => {
  it('keeps both drill-downs behind it, not merely their rows', () => {
    // `$queries` run whether or not anything reads them, so hiding the rows would still fire two
    // scoped queries with no anchor — which is a malformed query, not an empty one.
    const scoped = JSON.stringify(panel).match(/"scope":/g) ?? [];
    const gated = sourcesIn(panel).some((source) => source.includes('first(local.rootFolder)'));

    expect(scoped).toHaveLength(2);
    expect(gated).toBe(true);
  });
});
