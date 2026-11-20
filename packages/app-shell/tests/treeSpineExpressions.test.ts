/**
 * The tree's spine, its faint lines and the seed's switch, evaluated against the real host function
 * rather than read as text. The kit's expressions read the spine through `treeSpine` and nothing
 * else, so the spellings `treeSpines` offers (`rel:*`, `rel:Class.prop`, a bare kind id) each have to
 * pick the same lines in the layout and leave those same lines at full strength.
 */
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { TREE_EDGE_RULES, treeLayout } from '@we/template-kit';
import * as showcase from '@we/template-showcase';
import { describe, expect, it } from 'vitest';

import { hostSources } from '../src/shared/sources';

describe('the tree’s spine over model relations', () => {
  const run = (source: string, local: Record<string, unknown>) =>
    evaluateExpression(parseExpression(source), {
      root: (name: string) => (name === 'local' ? { bound: true, value: local } : { bound: false }),
      call: (name: string, args: unknown[]) => {
        const host = hostSources.find((source) => source.name === name);
        if (host) return (host.fn as (...a: unknown[]) => unknown)(...args);
        return listFunctions()
          .find((f) => f.name === name)
          ?.impl(args, {} as never);
      },
    } as never);
  /** The graph's own reading of a `when` clause: dotted `data.` keys, `not` as exclusion. */
  const field = (edge: Record<string, unknown>, key: string) =>
    key.startsWith('data.') ? (edge.data as Record<string, unknown>)[key.slice(5)] : edge[key];
  const dims = (when: Record<string, unknown>, edge: Record<string, unknown>) =>
    Object.entries(when).every(([key, expected]) => {
      const excluded = (expected as { not?: unknown }).not;
      return excluded === undefined ? field(edge, key) === expected : field(edge, key) !== excluded;
    });
  const relation = { type: 'relation', data: { relation: 'Note.about' } };
  const other = { type: 'relation', data: { relation: 'Note.replyTo' } };
  const connection = { type: 'relates', data: { relationshipTypeId: 'k-blocks' } };
  const dimRule = (spine: string) =>
    (run((TREE_EDGE_RULES as { $: string }).$, { treeMode: true, spine }) as { when?: Record<string, unknown> }[])[1]
      .when!;

  it('keeps every model relation at full strength under "All model relations"', () => {
    const when = dimRule('rel:*');
    expect(dims(when, relation)).toBe(false);
    expect(dims(when, other)).toBe(false);
    expect(dims(when, connection)).toBe(true);
  });

  it('keeps only the named relation at full strength under one relation', () => {
    const when = dimRule('rel:Note.about');
    expect(dims(when, relation)).toBe(false);
    expect(dims(when, other)).toBe(true);
    expect(dims(when, connection)).toBe(true);
  });

  it('still means a connection kind by a bare id', () => {
    const when = dimRule('k-blocks');
    expect(dims(when, connection)).toBe(false);
    expect(dims(when, relation)).toBe(true);
  });

  it('dims nothing under "Any connection", where every line is the spine', () => {
    // The string spelling compared each line's kind with '' and so drew every kinded connection and
    // every model relation faint under "Any connection" — the one reading where all of them are the tree.
    const rules = run((TREE_EDGE_RULES as { $: string }).$, { treeMode: true, spine: '' }) as { when?: unknown }[];
    expect(rules.filter((rule) => rule.when)).toEqual([]);
  });

  it('selects in the layout the same lines it keeps strong', () => {
    const spine = (value: string) =>
      (run((treeLayout() as { $: string }).$, { treeMode: true, spine: value }) as { options: { spine: unknown } })
        .options.spine;
    expect(spine('rel:*')).toEqual({ field: 'type', value: 'relation' });
    expect(spine('rel:Note.about')).toEqual({ field: 'data.relation', value: 'Note.about' });
    expect(spine('k-blocks')).toEqual({ field: 'data.relationshipTypeId', value: 'k-blocks' });
  });

  it('follows model relations only in a tree whose spine can show them', () => {
    // The canvas seed's `relations` option — off on the freeform canvas, and off while the spine is
    // one connection kind, so a `Relationship` tree reads exactly as it did before relations existed.
    const workshop = showcase.workshopTemplate as unknown as { routes?: { path?: string }[] };
    const route = (workshop.routes ?? []).find((entry) => entry.path === '/canvas');
    let source = '';
    const find = (node: unknown): void => {
      if (typeof node !== 'object' || node === null || source) return;
      const relations = (node as { relations?: { $?: unknown } }).relations;
      if (typeof relations?.$ === 'string') source = relations.$;
      else Object.values(node).forEach(find);
    };
    find(route);
    expect(source).not.toBe('');
    expect(run(source, { treeMode: false, spine: '' })).toBe(false);
    expect(run(source, { treeMode: true, spine: 'k-blocks' })).toBe(false);
    expect(run(source, { treeMode: true, spine: '' })).toEqual({ children: true });
    expect(run(source, { treeMode: true, spine: 'rel:*' })).toEqual({ children: true });
    expect(run(source, { treeMode: true, spine: 'rel:Note.about' })).toEqual({ children: true });
  });
});
