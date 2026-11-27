/**
 * A document's block tree as the flat list `core.createPost` writes: each block once, in document order,
 * with the key it is planned under and the key of the collection it sits in.
 *
 * Data in, data out — no stores, no registry, no imports — so a second host flattens a document the same
 * way against the recorded vectors beside this file (`vectors/flattenBlocks.json`), or runs it as is. It
 * has to agree to the key: a block's id is derived from its key (`postBlockId`), so a host numbering the
 * tree any other way plans ids the operation never gives, and the root's stored document names blocks
 * that do not exist.
 *
 * What the caller works out first, because only it can: which entity each block is written as (the block
 * registry), and that entity's fields. A block the registry does not know is passed with no `entity`; it
 * is left out, with everything under it.
 */

/** One block of the tree, as the caller has resolved it. */
export interface BlockNode {
  /** The entity it is written as; absent for a block nothing can write, which is skipped with its subtree. */
  entity?: string;
  fields: Record<string, unknown>;
  /** The blocks inside it, for a collection. */
  content?: readonly BlockNode[];
}

/** One block as `core.createPost` takes it, before its key is turned into an id. */
export interface FlatBlock {
  /**
   * Where it sits: its position among its siblings, joined to its parent's key with a dot — `0`, `1`,
   * `1.0`. A skipped block still takes its position, so the keys of the blocks after it do not move
   * when the registry learns a type.
   */
  key: string;
  entity: string;
  fields: Record<string, unknown>;
  /** The key of the collection it sits in; absent at the top of the document. */
  parentKey?: string;
  /** The positions from the top of the document down to it — the key as numbers, for finding the block again. */
  path: number[];
}

export function flattenBlocks(tree: readonly BlockNode[]): FlatBlock[] {
  const out: FlatBlock[] = [];
  const walk = (nodes: readonly BlockNode[], parent: FlatBlock | undefined) => {
    nodes.forEach((node, index) => {
      if (!node.entity) return;
      const path = parent ? [...parent.path, index] : [index];
      const flat: FlatBlock = {
        key: path.join('.'),
        entity: node.entity,
        fields: node.fields,
        ...(parent ? { parentKey: parent.key } : {}),
        path,
      };
      out.push(flat);
      if (node.content) walk(node.content, flat);
    });
  };
  walk(tree, undefined);
  return out;
}
