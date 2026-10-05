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

/*
  The same hole, one layer along: a handler position that accepted anything.

  `onSuccess` and friends were `z.array(z.unknown())` and a `$if` branch was `z.unknown()`, so a
  misspelt token inside one was not a token and not an error either — it was simply kept. That is
  how `{ $if: …, onSuccess: [close] }` survived: the key was legal to write and read by nothing.
*/
describe('a handler held by another handler', () => {
  const button = (onClick: unknown) => template([{ type: 'we-button', props: { onClick }, children: ['Go'] }]);

  it('is checked in a lifecycle list', () => {
    const typo = { $action: 'store.save', onSuccess: [{ $setLokal: 'open', value: false }] };
    expect(validateStructure(button(typo)).valid).toBe(false);
  });

  it('is checked down a $if branch', () => {
    const bad = { $if: { condition: { $: 'local.x' }, then: { $setLokal: 'open', value: false } } };
    expect(validateStructure(button(bad)).valid).toBe(false);
  });

  it('accepts the shapes that are actually written', () => {
    const good = {
      $if: {
        condition: { $: 'local.existing' },
        then: { $action: 'store.move', args: [''], onSuccess: [{ $setLocal: 'open', value: false }] },
        else: [{ $touch: '$all' }, { $action: 'store.create' }],
      },
    };
    expect(validateStructure(button(good)).errors).toEqual([]);
  });
});

/*
  The property all of this adds up to, and the one worth keeping.

  Compacting a template moves shapes out of props and into `$defs`, where there has never been a
  fallback — so for as long as a prop was the looser position, hoisting alone could turn a valid
  template invalid. The editor hit that as every patch being refused for 91 faults the model had
  not caused. Now that a prop checks what looks like a node, the two positions ask the same
  question, and where a template sits in that spectrum stops being a thing anybody has to know.
*/
describe('where a node sits does not change the verdict', () => {
  const strayKey = { $if: { condition: { $: 'local.x' }, then: { $action: 'store.go' } }, onSuccess: [] };
  const held = (words: string) => ({
    type: 'Column',
    props: { gap: '300' },
    children: [{ type: 'we-button', props: { onClick: strayKey }, children: [words] }],
  });

  it.each([
    ['sound', { type: 'we-text', children: ['Fine'] }],
    ['faulty', held('Go')],
  ])('agrees compacted and expanded: %s', async (_name, body) => {
    const { compactDefinitions, expandDefinitions } = await import('./definitions');
    const wrapper = (which: string) => ({ type: '$if', props: { condition: { $: `local.${which}` }, then: body } });
    const { schema, hoisted } = compactDefinitions(template([wrapper('a'), wrapper('b')]), { minChars: 0 });

    expect(hoisted).toBeGreaterThan(0); // the body really did move into `$defs`
    expect(validateStructure(schema).valid).toBe(validateStructure(expandDefinitions(schema)).valid);
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

/*
  What a refusal says. A child is a node, a string or a token, and when a node fails zod reports
  every branch it tried, in the order they were declared — "expected string", then a line of
  "unrecognized keys" per token kind, then the node's own fault. A template refused from somebody's
  library printed its first five lines, which were all noise, so the reason never appeared.
*/
describe('a refused node is reported by its own fault', () => {
  const routed = (child: unknown) =>
    ({ ...template([]), routes: [{ path: '/', type: 'Column', children: [child] }] }) as unknown as SchemaNode;

  it.each([
    ['a style that is neither a string nor a number', { styles: { gap: true } }, 'children.0.styles.gap'],
    [
      'a local of a type that does not exist',
      { $localState: { open: { type: 'flag', initial: false } } },
      '$localState.open.type',
    ],
  ])('names the fault, not the branches it was never meant to be: %s', (_name, extra, where) => {
    const result = validateStructure(routed({ type: 'Row', id: 'n', props: {}, children: ['x'], ...extra }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toContain(where);
    expect(result.errors.some((e) => e.message.includes('Unrecognized keys'))).toBe(false);
    expect(result.errors.some((e) => e.message.includes('expected string, received object'))).toBe(false);
  });
});

/*
  The same, one position along: a node held in a prop. A prop may also be a number, a boolean or a
  plain object, and the plain-object fallback refuses anything shaped like a node, so two branches
  looked plausible and every branch was reported again. A `$if`'s `then` with a bad style printed
  "expected string", "expected number", "expected boolean" and a run of token noise first.
*/
describe('a refused node held in a prop is reported by its own fault', () => {
  const held = (then: unknown) => template([{ type: '$if', props: { condition: { $: 'local.open' }, then } }]);

  it.each([
    ['a style that is neither a string nor a number', { styles: { gap: true } }, 'props.then.styles.gap'],
    ['a query whose entity is a number', { $queries: { rows: { entity: 5 } } }, 'props.then.$queries.rows.entity'],
  ])('%s', (_name, extra, where) => {
    const result = validateStructure(held({ type: 'Column', id: 'n', props: {}, children: ['x'], ...extra }));
    expect(result.valid).toBe(false);
    expect(
      result.errors.every((e) => e.path.includes(where)),
      JSON.stringify(result.errors),
    ).toBe(true);
  });
});

/*
  A token with a stray key fails every branch at once — it is not a string, not a number, and
  every other token kind is missing its own key — so the furthest-got rule ties. The branch that
  found all it requires and objects only to the extra key is the one meant. This is the exact shape
  of a pre-October template's `{ $if: …, onSuccess: [close] }`, which refused a whole template from
  somebody's library while printing five lines that never said "onSuccess".
*/
describe('a token with a stray key is reported as that key', () => {
  it('names the key and nothing else', () => {
    const result = validateStructure(template([{ type: 'we-button', props: { onClick: strayKey }, children: ['Go'] }]));
    expect(result.errors.map((e) => e.message)).toEqual(['Unrecognized key: "onSuccess"']);
  });
});
