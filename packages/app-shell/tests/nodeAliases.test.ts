/**
 * The round trip a template makes through the assistant: aliased for the model, patched, and
 * restored onto permanent ids.
 *
 * Ids are permanent, so the property that matters is that a node the model did not touch comes
 * back with the id it went in with — inside a shared shape, through a split, after a refused turn —
 * and a node the model made comes back with a new permanent id rather than an alias.
 */
import type { ConversationReply, ConversationTurn } from '@we/backend-shared';
import {
  buildValidationContext,
  contextData,
  ensureNodeIds,
  forEachNode,
  isNodeId,
  type SchemaNode,
  type TemplateSchema,
} from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { updateSchemaTool } from '../src/shared/ai/aiInfra';
import { runEditSession } from '../src/shared/ai/editSession';
import { prepareForModel } from '../src/shared/ai/nodeAliases';

const validationContext = buildValidationContext(contextData);

/** A card long enough to be hoisted, said three times — the kanban shape in miniature. */
const card = (): SchemaNode => ({
  type: 'Column',
  props: { bg: 'surface', p: '400', gap: '200', r: '300', border: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm' }, children: ['A card with a long enough title'] },
    { type: 'we-text', props: { color: 'text-muted' }, children: ['And a body that says something about it'] },
  ],
});

const template = (): SchemaNode =>
  ensureNodeIds({
    id: 'board',
    type: 'Column',
    meta: { name: 'Board', description: '', icon: 'kanban' },
    props: { bg: 'page' },
    children: [card(), card(), card(), { type: 'we-text', children: ['Footer'] }],
  } as unknown as SchemaNode);

const idsOf = (node: SchemaNode): string[] => {
  const out: string[] = [];
  forEachNode(node, (n) => n.id && out.push(n.id));
  return out;
};

function session(start: SchemaNode, replies: ConversationReply[]) {
  const tree = prepareForModel(start);
  let next = 0;
  const accepted: TemplateSchema[] = [];
  const turns: ConversationTurn[] = [{ role: 'user', text: 'do it' }];
  const run = runEditSession({
    converse: async () => {
      const reply = replies[next++];
      if (!reply) throw new Error('the script ran out');
      return reply;
    },
    system: 'system',
    turns,
    tools: [updateSchemaTool],
    schema: tree.schema,
    mint: tree.mint,
    uses: tree.uses,
    validationContext,
    accept: (merged) => {
      accepted.push(tree.restore(merged) as TemplateSchema);
      return 'Template updated successfully.';
    },
  });
  return { tree, run, accepted };
}

const call = (id: string, patches: unknown[]) => ({
  text: '',
  calls: [{ id, name: 'update_schema', arguments: { patches } }],
  finish: 'tool_calls' as const,
});
const done = { text: 'Done.', calls: [], finish: 'done' as const };

describe('what the model is shown', () => {
  it('is compacted, and every id in it is an alias', () => {
    const { schema } = prepareForModel(template());
    expect(JSON.stringify(schema)).toContain('"$ref"');
    expect(idsOf(schema).every((id) => /^n\d+$/.test(id))).toBe(true);
  });

  it('comes back as the template it was, ids and all', () => {
    const start = template();
    const { schema, restore } = prepareForModel(start);
    expect(restore(schema)).toEqual(start);
  });

  it('leaves the template it was given alone', () => {
    const start = template();
    const before = structuredClone(start);
    prepareForModel(start);
    expect(start).toEqual(before);
  });
});

describe('an accepted edit', () => {
  it('keeps every id it did not touch, inside a shared shape too', async () => {
    const start = template();
    // Aliases are handed out in walk order, so a second preparation names the nodes the same way.
    const def = Object.values((prepareForModel(start).schema as { $defs: Record<string, SchemaNode> }).$defs)[0];
    const heading = def.children![0] as SchemaNode;
    const { accepted, run } = session(start, [
      call('c1', [{ targetId: heading.id, node: { props: { variant: 'heading-md' } } }]),
      done,
    ]);
    await run;
    const [after] = accepted;
    expect(idsOf(after)).toEqual(idsOf(start));
    const headings = (after.children as SchemaNode[]).slice(0, 3).map((c) => c.children![0] as SchemaNode);
    expect(headings.map((h) => (h.props as { variant: string }).variant)).toEqual([
      'heading-md',
      'heading-md',
      'heading-md',
    ]);
  });

  it('gives a node the model made a new permanent id', async () => {
    const start = template();
    const { accepted, run } = session(start, [
      call('c1', [{ targetId: '', insert: { children: { node: { type: 'we-text', children: ['New'] } } } }]),
      done,
    ]);
    await run;
    const [after] = accepted;
    const added = (after.children as SchemaNode[]).at(-1)!;
    expect(added.children).toEqual(['New']);
    expect(isNodeId(added.id)).toBe(true);
    expect(idsOf(start)).not.toContain(added.id);
    expect(idsOf(after).filter((id) => id !== added.id)).toEqual(idsOf(start));
  });

  it('keeps the ids of a use split out of a shared shape, and of the uses still sharing it', async () => {
    const start = template();
    const tree = prepareForModel(start);
    const firstRef = (tree.schema.children as SchemaNode[])[0];
    const { accepted, run } = session(start, [call('c1', [{ targetId: firstRef.id, split: true }]), done]);
    await run;
    expect(idsOf(accepted[0])).toEqual(idsOf(start));
  });

  it('is not disturbed by a split in a turn that was refused', async () => {
    const start = template();
    const tree = prepareForModel(start);
    const [firstRef, secondRef] = tree.schema.children as SchemaNode[];
    const { accepted, run } = session(start, [
      // Split the first use, then break the template so the whole turn is refused.
      call('c1', [
        { targetId: firstRef.id, split: true },
        { targetId: '', node: { props: { bg: { $: 'nonsense..' } } } },
      ]),
      // Then an ordinary edit that is kept.
      call('c2', [{ targetId: secondRef.id, split: true }]),
      done,
    ]);
    await run;
    expect(accepted).toHaveLength(1);
    expect(idsOf(accepted[0])).toEqual(idsOf(start));
  });
});
