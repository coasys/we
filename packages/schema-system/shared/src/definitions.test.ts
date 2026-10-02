/**
 * Compaction is lossless, and sharing never leaks.
 *
 * Two properties carry the whole design. **Round trip**: expanding a compacted template gives back
 * exactly the tree that went in, so the pass can run, re-run and be undone without anybody having
 * to reason about it. **Identity only**: shapes are shared when they are byte-identical and never
 * when they merely look alike, because an edit to a shared shape reaches every use of it and a
 * near-match would carry that edit somewhere nobody asked for.
 *
 * The round trip is asserted over the real templates as well as over fixtures. A hand-written
 * fixture tests the cases I thought of; `WorkshopTemplate` tests the ones I did not, and it is the
 * tree that actually has to survive this.
 */
import { describe, expect, it } from 'vitest';

import { compactDefinitions, definitionsOf, expandDefinitions, REF_TYPE } from './definitions';
import type { SchemaNode } from './types';

/*
  A threshold of its own, well under the shipped default.

  These assert the MECHANISM — what gets hoisted, what does not, what comes back — and the default
  is a separate judgement about how many definitions a reader should have to hold, measured over
  the real templates. Tying the two together would make a tuning change look like a broken pass.
  The default has a test of its own at the bottom.
*/
const compact = (node: SchemaNode, minChars = 50) => compactDefinitions(node, { minChars });

/** A shape big enough to be worth hoisting, parameterised so near-misses are easy to build. */
const body = (text: string): SchemaNode => ({
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface', r: 'surface', width: '100%' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm' }, children: [text] },
    // Distinct per body, so two bodies share NOTHING. Otherwise the near-miss test is satisfied
    // by the line they have in common, which is a real shared shape and correctly hoisted —
    // proving the opposite of what the test means to ask.
    { type: 'we-text', props: { color: 'text-muted' }, children: [`A second line, for size: ${text}.`] },
  ],
});

const root = (children: SchemaNode[]): SchemaNode =>
  ({
    type: 'Column',
    meta: { name: 'Fixture', description: '', icon: 'x' },
    children,
  }) as SchemaNode;

describe('compacting a template', () => {
  it('hoists a shape that occurs twice and leaves a reference at each', () => {
    const { schema, hoisted, saved } = compact(root([body('Same'), body('Same')]));

    expect(hoisted).toBe(1);
    expect(saved).toBeGreaterThan(0);
    const defs = definitionsOf(schema);
    expect(Object.keys(defs)).toHaveLength(1);
    for (const child of schema.children as SchemaNode[]) expect(child.type).toBe(REF_TYPE);
  });

  it('leaves a shape that occurs once alone', () => {
    const once = root([body('Only'), { type: 'we-text', children: ['short'] }]);
    expect(compact(once)).toMatchObject({ hoisted: 0, saved: 0, schema: once });
  });

  it('does not share shapes that merely look alike', () => {
    // One word different. Sharing these would carry an edit to the first into the second.
    expect(compact(root([body('One'), body('Two')])).hoisted).toBe(0);
  });

  it('leaves small repeats alone, which cost more as a reference than they save', () => {
    const tiny: SchemaNode = { type: 'we-icon', props: { name: 'x' } };
    expect(compact(root([tiny, tiny, tiny]), 200).hoisted).toBe(0);
  });

  it('hoists the outermost shape, not the repeats inside it', () => {
    // `body` appears twice, and so does every node within it. Hoisting both would store the
    // inner shapes once in `$defs` and again inside the definition that already contains them.
    const { schema } = compact(root([body('Same'), body('Same')]));
    expect(Object.keys(definitionsOf(schema))).toHaveLength(1);
  });

  it('reaches a shape shared between two definitions', () => {
    /*
      The board's case: one shape inside two larger ones that are themselves repeated. The pass
      runs again inside the definitions it makes, so the inner shape is stored once rather than
      once per definition.
    */
    const inner = body('Shared inner');
    const left = (): SchemaNode => ({ type: 'Row', props: { gap: '400', ay: 'start' }, children: [inner, inner] });
    const right = (): SchemaNode => ({ type: 'Grid', props: { gap: '400', columns: 2 }, children: [inner, inner] });
    const { schema } = compact(root([left(), left(), right(), right()]));

    const defs = definitionsOf(schema);
    // Two arrangements plus the shape they share.
    expect(Object.keys(defs)).toHaveLength(3);

    // And the shared one is referenced from both arrangements rather than copied into each.
    const refsIn = (node: SchemaNode): string[] =>
      [...JSON.stringify(node).matchAll(/"def":"(d\d+)"/g)].map((m) => m[1]);
    const [, ...arrangements] = Object.values(defs).sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
    const shared = Object.entries(defs).find(([, d]) => JSON.stringify(d).includes('Shared inner'))?.[0];
    expect(shared).toBeDefined();
    for (const arrangement of arrangements) expect(refsIn(arrangement)).toContain(shared);
  });

  it('reaches into meta.panels, where a shell keeps its bulk', () => {
    const panelled = {
      ...root([]),
      meta: {
        name: 'Fixture',
        description: '',
        icon: 'x',
        panels: [
          { id: 'a', node: body('Panel'), title: 'A' },
          { id: 'b', node: body('Panel'), title: 'B' },
        ],
      },
    } as SchemaNode;
    expect(compact(panelled).hoisted).toBe(1);
  });

  it('never makes the root a reference to itself', () => {
    const self = body('Root');
    expect(compact({ ...self, children: [...(self.children ?? [])] } as SchemaNode).hoisted).toBe(0);
  });
});

describe('the shipped threshold', () => {
  it('leaves a repeat too small to pay for its own reference', () => {
    // Break-even is around a hundred characters; the default sits just above it. See the table in
    // `CompactOptions.minChars` for what each threshold is worth on the real templates.
    const small: SchemaNode = { type: 'we-text', props: { variant: 'label' }, children: ['short'] };
    expect(compactDefinitions(root([small, small, small])).hoisted).toBe(0);
  });

  it('hoists one that does pay for itself', () => {
    expect(JSON.stringify(body('Same')).length).toBeGreaterThan(200);
    expect(compactDefinitions(root([body('Same'), body('Same')])).hoisted).toBe(1);
  });
});

describe('expanding it again', () => {
  const trip = (node: SchemaNode) => expandDefinitions(compact(node).schema);

  it('gives back exactly what went in', () => {
    const before = root([body('Same'), body('Same'), { type: 'we-text', children: ['tail'] }]);
    expect(trip(before)).toEqual(before);
  });

  it('gives back a tree whose definitions referenced each other', () => {
    const inner = body('Shared inner');
    const outer = (): SchemaNode => ({ type: 'Row', props: { gap: '400' }, children: [inner, inner] });
    const before = root([outer(), outer()]);
    expect(trip(before)).toEqual(before);
  });

  it('is a no-op on a template with no definitions', () => {
    const plain = root([body('Only')]);
    expect(expandDefinitions(plain)).toBe(plain);
  });

  it('answers a reference cycle with a node rather than hanging', () => {
    /*
      `compactDefinitions` cannot produce one — it only ever points a reference at a shape that
      already existed — but a template arrives from a stranger, and a hostile one recursing for
      ever is a hung tab rather than a refused install.
    */
    const hostile = {
      type: 'Column',
      children: [{ type: REF_TYPE, props: { def: 'd1' } }],
      $defs: { d1: { type: 'Column', children: [{ type: REF_TYPE, props: { def: 'd1' } }] } },
    } as SchemaNode;
    expect(() => expandDefinitions(hostile)).not.toThrow();
  });

  it('answers a reference to a definition that is not there', () => {
    const missing = { type: 'Column', children: [{ type: REF_TYPE, props: { def: 'nope' } }] } as SchemaNode;
    expect(() => expandDefinitions(missing)).not.toThrow();
  });
});

describe('a compacted template is still validated as what it will be', () => {
  it('reports a problem inside a shared shape, once per use', async () => {
    const { buildValidationContext, validateSchema } = await import('./semanticValidation');
    const { contextData } = await import('./generated/contextData');

    // An offset in a tier bag: accepted by every other check and read by nothing, so the
    // validator refuses it. Big enough to be hoisted, and used twice.
    const broken = (): SchemaNode => ({
      type: 'Column',
      props: { gap: '300', p: '400', bg: 'surface', r: 'surface', width: '100%', mdUpProps: { left: '300px' } },
      children: [{ type: 'we-text', children: ['A line long enough to clear the threshold.'] }],
    });
    const plain = root([broken(), broken()]);
    const { schema, hoisted } = compactDefinitions(plain);
    expect(hoisted).toBe(1);

    const context = buildValidationContext(contextData);
    const before = validateSchema(plain, context);
    const after = validateSchema(schema, context);

    // The same verdict and the same number of findings, because the same tree is checked.
    expect(after.valid).toBe(before.valid);
    expect(after.errors.map((e) => e.message)).toEqual(before.errors.map((e) => e.message));
    expect(before.errors.length).toBeGreaterThan(0);
  });
});

describe('finding and patching a shared shape', () => {
  it('finds a node inside a definition, and says it is one', async () => {
    const { ensureNodeIds, findNodeById } = await import('./indexer');
    const { schema } = compactDefinitions(root([body('Same'), body('Same')]));
    const withIds = ensureNodeIds(schema);

    const defs = definitionsOf(withIds);
    const inner = (Object.values(defs)[0].children as SchemaNode[])[0];
    expect(inner.id).toBeDefined();

    const found = findNodeById(withIds, inner.id!);
    expect(found?.node).toBe(inner);
  });

  it('says how many places a patch would change', async () => {
    const { ensureNodeIds, findNodeById } = await import('./indexer');
    const { useCountOf } = await import('./definitions');
    const withIds = ensureNodeIds(compactDefinitions(root([body('Same'), body('Same'), body('Same')])).schema);

    const inner = (Object.values(definitionsOf(withIds))[0].children as SchemaNode[])[0];
    expect(useCountOf(withIds, inner.id!)).toBe(3);

    // An ordinary node renders in one place, definitions or no definitions.
    const plain = findNodeById(withIds, withIds.id!);
    expect(useCountOf(withIds, plain!.node.id!)).toBe(1);
  });

  it('counts a shape used inside a shape that is itself used', async () => {
    const { ensureNodeIds } = await import('./indexer');
    const { useCountOf } = await import('./definitions');
    // Two of the inner shape inside an arrangement, and three of the arrangement: six on screen.
    const inner = body('Shared');
    const group = (): SchemaNode => ({ type: 'Row', props: { gap: '400', ay: 'start' }, children: [inner, inner] });
    const withIds = ensureNodeIds(compactDefinitions(root([group(), group(), group()])).schema);

    const defs = definitionsOf(withIds);
    const innerDef = Object.values(defs).find((d) => JSON.stringify(d).includes('Shared'))!;
    const leaf = (innerDef.children as SchemaNode[])[0];
    expect(useCountOf(withIds, leaf.id!)).toBe(6);
  });

  it("gives every definition's nodes an id, and takes them all away again", async () => {
    const { ensureNodeIds, stripNodeIds } = await import('./indexer');
    const { schema } = compactDefinitions(root([body('Same'), body('Same')]));

    const withIds = ensureNodeIds(structuredClone(schema));
    const ids = (node: SchemaNode): (string | undefined)[] => [
      node.id,
      ...((node.children ?? []).filter((c) => typeof c === 'object') as SchemaNode[]).flatMap(ids),
    ];
    for (const def of Object.values(definitionsOf(withIds))) {
      expect(ids(def).every(Boolean)).toBe(true);
    }

    const stripped = stripNodeIds(withIds);
    for (const def of Object.values(definitionsOf(stripped))) {
      expect(ids(def).some(Boolean)).toBe(false);
    }
  });

  it('is unchanged by a round trip through ids', async () => {
    const { ensureNodeIds, stripNodeIds } = await import('./indexer');
    const { schema } = compactDefinitions(root([body('Same'), body('Same')]));
    expect(stripNodeIds(ensureNodeIds(structuredClone(schema)))).toEqual(schema);
  });
});
