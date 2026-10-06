/**
 * nodeAliases — what a language model calls a template's nodes, and the way back.
 *
 * A node's id is permanent: ten characters, minted at random or derived from a built-in's path (see
 * `nodeIdentity.ts` in schema-shared). A model is shown `n1`, `n2`… in their place, for two reasons.
 * They are a third the size, on a tree of a few thousand nodes that is sent every turn. And they are
 * easy to copy exactly, where a random string invites a model to write something that looks like
 * one: a typo in an alias names nothing and the patch is refused, while a typo in a permanent id
 * could be kept as one.
 *
 * So the editor prepares a template once per request — compacted, then every id renamed to an
 * alias — and `restore` maps what the session accepted back onto permanent ids. A node the model
 * made has an alias nothing maps back from, and gets a new permanent id; every other node keeps the
 * id it came in with, which is the whole point of ids being permanent.
 *
 * The ids a compacted tree hides in its table (`DefinitionUses` — which real node each use of a
 * shared shape stands for) are aliased with the rest. A split copies a use out of a shape and gives
 * the copy that use's ids, from the table, and the model has to be able to name them straight away.
 */
import {
  compactDefinitions,
  type DefinitionUses,
  ensureNodeIds,
  expandDefinitions,
  forEachNode,
  type SchemaNode,
} from '@we/schema-shared';

export interface ModelTree {
  /** The template as the model sees it: compacted, and every id an alias. */
  schema: SchemaNode;
  /** The table compaction made, in aliases. A split rewrites it, so the session is given this one. */
  uses: DefinitionUses;
  /** An alias for a node the session makes — numbered on from the last one handed out. */
  mint: () => string;
  /** What the session accepted, as a template with permanent ids and no `$defs`. */
  restore: (accepted: SchemaNode) => SchemaNode;
}

/**
 * Compact a template and give every node an alias, ready to send.
 *
 * The template is cloned, never mutated — through JSON, because an authored template reuses
 * objects (a fragment called twice with the same arguments returns the same one) and a structured
 * clone would keep them shared, so one node object would stand in two places and could hold only
 * one id. A node that arrives without an id — anything stored before ids were permanent — is given
 * a permanent one first, so it has one to come back to.
 */
export function prepareForModel(template: SchemaNode): ModelTree {
  const whole = ensureNodeIds(JSON.parse(JSON.stringify(template)) as SchemaNode);
  const { schema, uses: realUses } = compactDefinitions(whole);

  let next = 0;
  const mint = () => `n${++next}`;
  const toAlias = new Map<string, string>();
  const toReal = new Map<string, string>();
  const aliasOf = (real: string): string => {
    let alias = toAlias.get(real);
    if (!alias) {
      alias = mint();
      toAlias.set(real, alias);
      toReal.set(alias, real);
    }
    return alias;
  };

  forEachNode(schema, (node) => {
    if (node.id) node.id = aliasOf(node.id);
  });
  const uses: DefinitionUses = {};
  for (const [ref, table] of Object.entries(realUses)) {
    uses[aliasOf(ref)] = Object.fromEntries(
      Object.entries(table).map(([key, real]) => [key.split('/').map(aliasOf).join('/'), aliasOf(real)]),
    );
  }

  const restore = (accepted: SchemaNode): SchemaNode => {
    const expanded = expandDefinitions(structuredClone(accepted), { uses });
    forEachNode(expanded, (node) => {
      const real = node.id ? toReal.get(node.id) : undefined;
      if (real) node.id = real;
      else delete node.id;
    });
    // Against the template as it came in, so a node the model wrote with an existing node's alias
    // is the one renewed rather than the node it named.
    return ensureNodeIds(expanded, undefined, whole);
  };

  return { schema, uses, mint, restore };
}
