/**
 * A node's identity: what it is called for good.
 *
 * ## Why ids are permanent
 *
 * Ids used to be transient — `n1`, `n2`… handed out by a walk when a template went live and stripped
 * again on save. That made every edit an edit to a POSITION, and positions do not survive a change
 * upstream: "I changed node 47" cannot be replayed onto a tree its author has since restructured. So
 * nothing could be overridden in place, a fork could never be compared with its original, two people
 * could not edit one template, and a selection or a comment could not outlive a reload.
 *
 * A permanent id per node is what Figma, Notion, Webflow and Framer converged on, and what every tree
 * CRDT is built on. WE already made the same call for shapes (`shapeId`, `forkedFrom`). See
 * `notes/we/October-2026/node-identity-decision.md` for the decision and what it buys.
 *
 * ## Two kinds of id, one format
 *
 * - **Minted** — random, for a node somebody makes: a node added in the editor, by the assistant, in
 *   the code panel. Random rather than counted, since a counter restarts per template and per person,
 *   and two people adding a node each would both make `n12`.
 * - **Derived** — for a template written in code. A built-in is TypeScript run at load, so there is
 *   nowhere to keep an id between runs; it is worked out instead, from the template's id and the
 *   node's path, so the same build gives the same ids and a release that changes one part leaves the
 *   rest of the tree's identity alone.
 *
 * Both are ten characters, a letter and then letters or digits, so either can be told from the short
 * aliases (`n1`…) a language model is shown in their place — see `ai/nodeAliases.ts` in the app shell.
 *
 * ## `key`
 *
 * A node may carry an author-set `key`. It names the node within its siblings, so a derived id
 * follows the node through a reordering rather than following its position. Fragments set it from
 * whatever identifies their output — `field({ name })` keys its field by the name.
 */
import { isPropsSchemaNode, isSchemaChild, panelsOf } from './treeUtils';
import type { SchemaNode } from './types';

/** How long an id is. Ten base-36 characters is about 3.6 × 10^15 values, after the leading letter. */
export const NODE_ID_LENGTH = 10;

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Whether a string has the shape of a permanent id — as opposed to an alias, or a template's id. */
export function isNodeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9]{9}$/.test(value);
}

/** A fresh id for a node somebody has just made. */
export function newNodeId(): string {
  const bytes = new Uint8Array(NODE_ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let out = LETTERS[bytes[0] % LETTERS.length];
  for (let i = 1; i < NODE_ID_LENGTH; i++) out += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
  return out;
}

/**
 * Two 32-bit hashes of a string, independent of each other. cyrb53's mixing, kept to integers a
 * 32-bit multiply can hold, so the result is the same on every engine.
 */
function hashPair(text: string): [number, number] {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}

/** An id worked out from a string, in the same format as a minted one. */
export function derivedNodeId(source: string): string {
  const [a, b] = hashPair(source);
  const [c] = hashPair(`${source}\u0000`);
  let out = LETTERS[a % LETTERS.length];
  // 9 more characters from 96 bits of hash — far more than the 46 bits they can hold.
  let pool = BigInt(b) * 2n ** 32n + BigInt(c);
  for (let i = 1; i < NODE_ID_LENGTH; i++) {
    out += ALPHANUMERIC[Number(pool % 36n)];
    pool /= 36n;
  }
  return out;
}

/**
 * Every position a node holds a child at, with the name that position goes by in a path.
 *
 * The same edges every other walk here follows — children, routes, slots, nodes inside props, the
 * nodes `meta.panels` entries carry, and `$defs` — each named so that a path through them reads as
 * where a node is rather than as a list of indices.
 */
function namedPositions(node: SchemaNode): { group: string; nodes: SchemaNode[] }[] {
  const out: { group: string; nodes: SchemaNode[] }[] = [];
  const nodesIn = (value: unknown): SchemaNode[] => {
    if (Array.isArray(value)) return value.filter((v) => isSchemaChild(v) || isPropsSchemaNode(v)) as SchemaNode[];
    return isSchemaChild(value) || isPropsSchemaNode(value) ? [value as SchemaNode] : [];
  };
  if (Array.isArray(node.children)) out.push({ group: 'c', nodes: nodesIn(node.children) });
  if (Array.isArray(node.routes)) out.push({ group: 'r', nodes: nodesIn(node.routes) });
  for (const [name, slot] of Object.entries(node.slots ?? {})) out.push({ group: `s:${name}`, nodes: nodesIn(slot) });
  for (const [name, value] of Object.entries(node.props ?? {})) {
    if (name === 'styles') continue;
    const nodes = nodesIn(value);
    if (nodes.length) out.push({ group: `p:${name}`, nodes });
  }
  for (const panel of panelsOf(node) ?? []) {
    if (isSchemaChild(panel.node)) out.push({ group: `panel:${panel.id}`, nodes: [panel.node as SchemaNode] });
  }
  for (const [name, def] of Object.entries(node.$defs ?? {})) out.push({ group: `d:${name}`, nodes: [def] });
  return out;
}

/**
 * Give every node of a template written in code an id worked out from where it is.
 *
 * `seed` is what makes the ids this template's — its id, for a built-in. A node's path is the chain
 * of positions from the root: each step is its `key` when it has one, and otherwise its type and how
 * many earlier siblings in the same position share that type. Type-and-count rather than a bare
 * index, so a node added at the front of a list renumbers only the nodes of its own kind after it,
 * not everything that follows.
 *
 * A node that already has an id keeps it, and the root is left alone — a template's root carries the
 * template's own id. Mutates in place and returns the schema.
 */
export function deriveNodeIds<T extends SchemaNode>(schema: T, seed: string): T {
  const visit = (node: SchemaNode, path: string) => {
    for (const { group, nodes } of namedPositions(node)) {
      const seen = new Map<string, number>();
      for (const child of nodes) {
        // A key used twice among siblings counts like a type does, so the two still differ.
        const name =
          typeof child.key === 'string' && child.key
            ? `#${child.key}`
            : typeof child.type === 'string'
              ? child.type
              : '';
        const nth = seen.get(name) ?? 0;
        seen.set(name, nth + 1);
        const step = name.startsWith('#') && nth === 0 ? name : `${name}${nth}`;
        const childPath = `${path}/${group}/${step}`;
        if (!child.id) child.id = derivedNodeId(`${seed}|${childPath}`);
        visit(child, childPath);
      }
    }
  };
  visit(schema, '');
  return schema;
}
