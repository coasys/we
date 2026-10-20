import { describe, expect, it } from 'vitest';

import type { SchemaNode } from '../src/types';

describe('ids reach every node the renderer does', () => {
  const panelled = (): SchemaNode =>
    ({
      type: 'Column',
      meta: {
        name: 'Shell',
        panels: [
          {
            id: 'inspector',
            snap: 'right',
            node: { type: 'Column', children: [{ type: 'we-text', children: ['Inside'] }] },
          },
          { id: 'from-a-module', module: 'transcribe' },
        ],
      },
      children: [{ type: 'we-text', children: ['Outside'] }],
    }) as unknown as SchemaNode;

  const panelNode = (schema: SchemaNode) =>
    (schema as unknown as { meta: { panels: { node?: SchemaNode }[] } }).meta.panels[0].node!;

  it('gives a node inside meta.panels an id, like any other', async () => {
    const { ensureNodeIds } = await import('../src/indexer');
    const panel = panelNode(ensureNodeIds(panelled()));

    expect(panel.id).toBeDefined();
    expect((panel.children as SchemaNode[])[0].id).toBeDefined();
  });

  it('finds that node by its id, so a patch can land on it', async () => {
    const { ensureNodeIds, findNodeById } = await import('../src/indexer');
    const schema = ensureNodeIds(panelled());
    const inner = (panelNode(schema).children as SchemaNode[])[0];

    expect(findNodeById(schema, inner.id!)?.node).toBe(inner);
  });

  /*
    The other half, and the one that would bite silently: ids are transient and `stripNodeIds`
    is what keeps them out of the stored template. Numbering panels without stripping them would
    write `n12` into every panel of every template anybody saved.
  */
  it('strips them again, panels included', async () => {
    const { ensureNodeIds, stripNodeIds } = await import('../src/indexer');
    const schema = stripNodeIds(ensureNodeIds(panelled()));
    const panel = panelNode(schema);

    expect(panel.id).toBeUndefined();
    expect((panel.children as SchemaNode[])[0].id).toBeUndefined();
    expect(JSON.stringify(schema)).not.toMatch(/"id":"n\d+"/);
  });

  it('leaves a panel entry that carries no node alone', async () => {
    const { ensureNodeIds } = await import('../src/indexer');
    const panels = (ensureNodeIds(panelled()) as unknown as { meta: { panels: Record<string, unknown>[] } }).meta
      .panels;

    expect(panels[1]).toEqual({ id: 'from-a-module', module: 'transcribe' });
  });
});

/*
  Numbering a panel's nodes without being able to replace them is worse than not numbering them.

  `node.id` is what the renderer stamps as `data-we-node-id`, so an unnumbered node cannot be
  clicked at all. Numbered, it selects and the inspector opens on it — and if `replaceNodeInTree`
  cannot reach it, the edit is accepted and silently dropped. These two go together or neither
  should ship.
*/
describe('replacing a node inside a panel', () => {
  const panelled = (): SchemaNode =>
    ({
      type: 'Column',
      meta: {
        name: 'Shell',
        panels: [
          { id: 'key', title: 'Key', node: { type: 'Column', children: [{ type: 'we-text', children: ['Key'] }] } },
        ],
      },
      children: [{ type: 'we-text', children: ['Outside'] }],
    }) as unknown as SchemaNode;

  const panelNode = (schema: SchemaNode) =>
    (schema as unknown as { meta: { panels: { node: SchemaNode }[] } }).meta.panels[0].node;

  it('puts the replacement in, and leaves the panel’s configuration alone', async () => {
    const { ensureNodeIds, findNodeById, mergeNode } = await import('../src/indexer');
    const { replaceNodeInTree } = await import('../src/treeUtils');
    const schema = ensureNodeIds(panelled());
    const target = (panelNode(schema).children as SchemaNode[])[0];

    const patched = mergeNode(findNodeById(schema, target.id!)!.node, { props: { color: 'danger-text' } });
    const updated = replaceNodeInTree(schema, target, patched);

    const after = (panelNode(updated).children as SchemaNode[])[0];
    expect(after.props?.color).toBe('danger-text');
    const panels = (updated as unknown as { meta: { panels: Record<string, unknown>[] } }).meta.panels;
    expect(panels[0].id).toBe('key');
    expect(panels[0].title).toBe('Key');
  });

  it('leaves the original tree untouched, as it does everywhere else', async () => {
    const { ensureNodeIds } = await import('../src/indexer');
    const { replaceNodeInTree } = await import('../src/treeUtils');
    const schema = ensureNodeIds(panelled());
    const target = (panelNode(schema).children as SchemaNode[])[0];

    replaceNodeInTree(schema, target, { type: 'we-badge' } as SchemaNode);

    expect((panelNode(schema).children as SchemaNode[])[0].type).toBe('we-text');
  });

  it('returns a template with no panels exactly as it was', async () => {
    const { replaceNodeInTree } = await import('../src/treeUtils');
    const plain = { type: 'Column', children: [{ type: 'we-text', children: ['Hi'] }] } as unknown as SchemaNode;
    const updated = replaceNodeInTree(plain, (plain.children as SchemaNode[])[0], { type: 'we-badge' } as SchemaNode);

    expect((updated as unknown as { meta?: unknown }).meta).toBeUndefined();
  });
});
