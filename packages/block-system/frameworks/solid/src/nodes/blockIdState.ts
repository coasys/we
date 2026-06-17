import type { SerializedBlockNode } from '@we/block-shared';
import type { LexicalNode } from 'lexical';
import { $isElementNode, $setState, createState, NODE_STATE_KEY } from 'lexical';

/**
 * Carries a block's AD4M id through Lexical's built-in node types
 * (ParagraphNode, HeadingNode, QuoteNode, ListItemNode) — unlike our own
 * factory-created block nodes (createBlockNodeClass.tsx, CollectionBlockNode.tsx),
 * which generically preserve any extra JSON field via __props, these
 * built-ins only serialize the fields they explicitly declare.
 *
 * Lexical's NodeState mechanism (createState/$setState, and NODE_STATE_KEY
 * on the JSON side) is the supported way to attach arbitrary serialized data
 * to *any* node — built-in or custom — without subclassing. Its encode/decode
 * lives in the base LexicalNode/ElementNode exportJSON/importJSON, so once a
 * value is set via $setState, it round-trips automatically through every
 * subsequent load/save without further plumbing.
 */
export const blockIdState = createState('blockId', {
  parse: (value: unknown): string | null => (typeof value === 'string' ? value : null),
});

/**
 * Stamps each node's AD4M id (read from the original JSON tree just loaded)
 * onto its live Lexical counterpart via $setState, walking the live tree and
 * the JSON tree in lockstep — they're structurally identical right after
 * editor.setEditorState() materializes jsonNode. Must run inside an
 * editor.update() callback, immediately after setEditorState.
 */
export function stampBlockIdState(liveNode: LexicalNode, jsonNode: SerializedBlockNode): void {
  if (typeof jsonNode.id === 'string') {
    $setState(liveNode, blockIdState, jsonNode.id);
  }
  if ($isElementNode(liveNode) && Array.isArray(jsonNode.children)) {
    const liveChildren = liveNode.getChildren();
    const jsonChildren = jsonNode.children as SerializedBlockNode[];
    jsonChildren.forEach((childJson: SerializedBlockNode, i: number) => {
      const liveChild = liveChildren[i];
      if (liveChild) stampBlockIdState(liveChild, childJson);
    });
  }
}

/**
 * Promotes each node's NodeState-carried blockId (set via stampBlockIdState
 * at load time) into a plain top-level `id` field, matching the shape our
 * custom block nodes already produce — so reconcileBlocks can read `node.id`
 * uniformly regardless of which kind of node it came from. Pure JSON
 * transform — call on the output of editorState.toJSON(), not on live nodes.
 */
export function promoteBlockIdState(node: SerializedBlockNode): SerializedBlockNode {
  const state = (node as Record<string, unknown>)[NODE_STATE_KEY] as { blockId?: unknown } | undefined;

  const promoted: SerializedBlockNode = { ...node };
  delete (promoted as Record<string, unknown>)[NODE_STATE_KEY];
  if (typeof state?.blockId === 'string') {
    promoted.id = state.blockId;
  }
  if (Array.isArray(node.children)) {
    const children = node.children as SerializedBlockNode[];
    promoted.children = children.map((child: SerializedBlockNode) => promoteBlockIdState(child));
  }

  return promoted;
}
