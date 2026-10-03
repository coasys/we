/**
 * Giving one use of a shared shape a copy of its own.
 *
 * A template says a repeated shape once, which is what makes it small enough to edit — and means
 * a patch to that shape reaches every use at once. Usually right: a card template inside an
 * `$each` is one definition already, and "make the cards wider" is one shape and every card.
 * Sometimes emphatically wrong, and the editor cannot tell which from the patch alone.
 *
 * So the writer asks. `split` replaces one `$ref` with a copy of the shape it names; the other
 * uses carry on sharing. The two properties below are the ones that make that safe: the split use
 * can then be edited **without touching anybody else**, and the copy records where it came from,
 * so "put these back the way they were" is still answerable afterwards.
 */
import { applySchemaPatches } from '@shared/ai/schemaPatches';
import type { SchemaNode } from '@we/schema-shared';
import { compactDefinitions, definitionsOf, ensureNodeIds, expandDefinitions, findNodeById } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const card = (): SchemaNode => ({
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface', r: 'surface', width: '100%' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm' }, children: ['A card'] },
    { type: 'we-text', props: { color: 'text-muted' }, children: ['With a second line for size.'] },
  ],
});

/** Three identical cards, compacted into one definition and numbered as the editor sends them. */
function threeCards() {
  const plain: SchemaNode = {
    type: 'Column',
    meta: { name: 'Fixture', description: '', icon: 'x' },
    children: [card(), card(), card()],
  } as SchemaNode;
  const { schema, hoisted } = compactDefinitions(plain);
  expect(hoisted).toBe(1);
  return ensureNodeIds(schema);
}

const refs = (schema: SchemaNode) => (schema.children ?? []).filter((c) => (c as SchemaNode).type === '$ref');

describe('splitting one use out of a shared shape', () => {
  it('replaces that use with a copy and leaves the others sharing', () => {
    const schema = threeCards();
    const target = (refs(schema)[0] as SchemaNode).id!;

    const { schema: out, error } = applySchemaPatches(schema, [{ targetId: target, split: true }]);
    expect(error).toBeUndefined();

    // One fewer reference, and the shape still defined for the two that kept it.
    expect(refs(out)).toHaveLength(2);
    expect(Object.keys(definitionsOf(out))).toHaveLength(1);

    // Nothing moved on screen: the tree still renders as three identical cards.
    expect(expandDefinitions(out)).toEqual(expandDefinitions(schema));
  });

  it('records where the copy came from', () => {
    const schema = threeCards();
    const name = (refs(schema)[0] as SchemaNode).props?.def;
    const { schema: out } = applySchemaPatches(schema, [
      { targetId: (refs(schema)[0] as SchemaNode).id!, split: true },
    ]);

    const copy = (out.children as SchemaNode[])[0];
    expect(copy.type).not.toBe('$ref');
    expect((copy as { forkedFrom?: string }).forkedFrom).toBe(name);
  });

  it('lets the split use be edited without touching the others', () => {
    const schema = threeCards();
    const first = (refs(schema)[0] as SchemaNode).id!;

    const split = applySchemaPatches(schema, [{ targetId: first, split: true }]).schema;
    const copy = ensureNodeIds(split).children![0] as SchemaNode;
    const heading = (copy.children as SchemaNode[])[0];

    const { schema: out, error } = applySchemaPatches(split, [
      { targetId: heading.id!, node: { children: ['Only this one'] } },
    ]);
    expect(error).toBeUndefined();

    const rendered = JSON.stringify(expandDefinitions(out));
    expect(rendered.split('Only this one')).toHaveLength(2); // once
    expect(rendered.split('A card')).toHaveLength(3); // the two that kept sharing
  });

  /*
    The one that makes `split` usable rather than merely correct.

    A copy carries no ids of its own, and the template only reaches the model in the user's turn —
    so without the copy coming back named, a model that split a use out could not patch the thing
    it had just made until the next message, which is the whole reason it split.
  */
  it('hands back the copy, so the caller can name it once the tree is numbered', () => {
    const schema = threeCards();
    const { schema: out, splits } = applySchemaPatches(schema, [
      { targetId: (refs(schema)[0] as SchemaNode).id!, split: true },
    ]);

    expect(splits).toHaveLength(1);
    expect(splits[0].id).toBeUndefined(); // not numbered yet — that is the caller's next step

    ensureNodeIds(out);
    expect(splits[0].id).toBeTruthy();
    expect(findNodeById(out, splits[0].id!)?.node).toBe(splits[0]);
  });

  it('refuses a node that is not shared, and says why', () => {
    const schema = threeCards();
    const { error } = applySchemaPatches(schema, [{ targetId: schema.id!, split: true }]);
    expect(error).toContain('not a $ref');
  });

  it('refuses an id that is not there', () => {
    const { error } = applySchemaPatches(threeCards(), [{ targetId: 'nope', split: true }]);
    expect(error).toContain('No node with id');
  });
});
