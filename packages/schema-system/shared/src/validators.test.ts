/**
 * Structural validation reaches the nodes a template actually holds.
 *
 * `props` is a record of `zSchemaProp`, a union whose last branch accepts any plain object. That
 * branch is right for a prop holding a shape nobody can enumerate — a graph's layout options, a
 * transition — and it was swallowing NODES: a `$if`'s `then` holds a whole interface, and when
 * anything inside one failed to parse, the union fell through and reported nothing.
 *
 * What it cost: a handler carrying a key no resolver reads, eighteen `props.then` hops down, in
 * two shipped templates. It surfaced only when compaction moved the shape into `$defs`, where
 * there is no fallback behind it.
 *
 * The two tests that matter are the pair: faults inside a prop-held node are reported, and the
 * specs that merely look like nodes are still accepted. The second is why the obvious fix — "an
 * object with a `type` must be a node" — is wrong, and it produced about 1,500 false positives.
 */
import { describe, expect, it } from 'vitest';

import type { SchemaNode } from './types';
import { validateStructure } from './validators';

const template = (children: unknown[], extra: Record<string, unknown> = {}): SchemaNode =>
  ({
    type: 'Column',
    meta: { name: 'T', description: '', icon: 'cube', ...(extra.meta ?? {}) },
    props: { bg: 'page' },
    children,
  }) as unknown as SchemaNode;

/** A handler with a key nothing reads — the fault that started this. */
const strayKey = { $if: { condition: { $: 'local.x' }, then: { $action: 'store.go' } }, onSuccess: [] };

describe('a node held in a prop', () => {
  it('is checked, so a fault inside a $if branch is reported', () => {
    const result = validateStructure(
      template([
        {
          type: '$if',
          props: {
            condition: { $: 'local.open' },
            then: { type: 'Column', children: [{ type: 'we-button', props: { onClick: strayKey } }] },
          },
        },
      ]),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes('props.then'))).toBe(true);
  });

  it('is checked inside a panel, which was not checked at all', () => {
    const result = validateStructure(
      template([], {
        meta: {
          panels: [
            { id: 'p1', node: { type: 'Column', children: [{ type: 'we-button', props: { onClick: strayKey } }] } },
          ],
        },
      }),
    );

    expect(result.valid).toBe(false);
  });

  it('is still fine when the branch is sound', () => {
    const result = validateStructure(
      template([
        {
          type: '$if',
          props: {
            condition: { $: 'local.open' },
            then: { type: 'Column', children: [{ type: 'we-text', children: ['Hello'] }] },
          },
        },
      ]),
    );
    expect(result.valid).toBe(true);
  });
});

describe('a prop that merely looks like a node', () => {
  /*
    Each of these names a KIND and is no part of the tree. Rejecting them is the trap: a `type`
    string alone does not make a node, and treating it as one fails every template that animates
    anything or draws a graph.
  */
  it.each([
    ['a transition effect', { enterTransition: { type: 'fade', duration: 400, easing: 'ease-in-out' } }],
    [
      'a list of effects',
      {
        enterTransition: [
          { type: 'reveal', duration: 300 },
          { type: 'fade', delay: 20 },
        ],
      },
    ],
    ['a graph layout', { layout: { type: 'force', options: { distance: 140 } } }],
    ['a graph behaviour', { behaviours: [{ type: 'drag-node', options: { pin: true } }] }],
  ])('is accepted: %s', (_name, props) => {
    const result = validateStructure(template([{ type: 'Column', props, children: ['x'] }]));
    expect(result.errors).toEqual([]);
  });
});
