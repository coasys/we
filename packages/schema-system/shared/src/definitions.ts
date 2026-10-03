/**
 * Shared shapes in a template: hoisting them, and putting them back.
 *
 * ## Why a template says the same thing many times
 *
 * A fragment is an authoring-time helper — `signalDisplay(…)` is a function that stamps its whole
 * tree into the document at every call site. That is what makes a template SELF-CONTAINED: what
 * you read is what renders, which is the property that lets one be installed from a stranger and
 * inspected before it runs. It costs roughly 11–12× in size, and when a card composes five rich
 * capabilities across three display modes it compounds: `CardsView`'s card is 358,000 characters,
 * and 150,445 of those are its body written a second time for the grid modal.
 *
 * Everything downstream pays by the character — the editor sends the schema to a language model
 * every turn and gets one back, the undo history holds a copy per edit, a template crosses the
 * wire with all of it — and the binding constraint is a context window, where a shape written
 * twice halves what can be reasoned about.
 *
 * ## What this does about it
 *
 * `compactDefinitions` finds shapes that occur more than once, lifts each into `$defs` on the root,
 * and leaves a `$ref` node at every occurrence. `expandDefinitions` is the exact inverse. The
 * definitions travel INSIDE the template, so self-containment is untouched: everything that will
 * render is still in the document, just said once. That is the whole difference between this and
 * citing a shared fragment library, which was considered and rejected for exactly that reason.
 *
 * ## Why it is a pass rather than something fragments emit
 *
 * A fragment could return a definition and a reference itself, and then every fragment author
 * would have to remember to, forever, and the ones who forgot would be invisible. A pass needs
 * nothing from authors, applies to shapes nobody anticipated, and finds the duplication that
 * happens BETWEEN two different fragments as readily as within one.
 *
 * ## The rule that makes sharing safe
 *
 * Shapes are shared only when they are **byte-identical**, never merely similar. And sharing is an
 * OPTIMISATION, NOT A COMMITMENT: an edit that needs one use to differ splits it back out
 * (copy-on-write, in the editor). Given that, whether two identical shapes happen to be stored
 * shared or separately is invisible to anybody editing the template, which is what lets this pass
 * run, re-run, and re-merge freely. The one invariant that must hold is that an edit never leaks
 * from one use to another.
 */
import { isPropsSchemaNode, isSchemaChild } from './treeUtils';
import type { SchemaNode } from './types';

/** The node left behind at each occurrence. A node type, so every existing walk already sees it. */
export const REF_TYPE = '$ref';

/** Where a `$ref` names its definition: `{ type: '$ref', props: { def } }`. */
export interface RefProps {
  def: string;
}

export interface CompactOptions {
  /**
   * The smallest shape worth hoisting, in canonical characters.
   *
   * Break-even is around a hundred: a reference costs about forty characters and an entry costs
   * its name twice. The other cost is the NUMBER of definitions, since that is what a reader has
   * to hold — but once single-reference definitions are inlined back, that count stays small at
   * every threshold. Measured over the three largest templates:
   *
   * | min  | CardsView        | Workshop         | BoardsView      |
   * | ---- | ---------------- | ---------------- | --------------- |
   * | 200  | −50.0% / 39 defs | −32.3% / 58 defs | −48.7% / 12 defs |
   * | 500  | −46.9% / 20 defs | −30.8% / 33 defs | −47.9% /  8 defs |
   * | 1000 | −45.4% / 13 defs | −29.1% / 22 defs | −47.5% /  7 defs |
   * | 4000 | −40.2% /  4 defs | −21.4% /  6 defs | −41.2% /  3 defs |
   *
   * 200 it is: the best saving available, and a few dozen definitions is fewer than the number of
   * components a template of that size already names. A higher threshold was worth considering
   * when the pass emitted 585 of them for CardsView, which it did by hoisting shapes that stopped
   * repeating the moment their parent was hoisted.
   */
  minChars?: number;
}

export interface CompactResult {
  /** The root, with `$defs` and every repeat replaced by a `$ref`. */
  schema: SchemaNode;
  /** How many distinct shapes were lifted. */
  hoisted: number;
  /** Characters saved, serialised: the whole tree before minus the whole tree after. */
  saved: number;
}

const CANON = new WeakMap<object, string>();

/**
 * A node as one string, with keys in a fixed order and `id` left out.
 *
 * Sorted because two nodes differing only in the order their props were written are the same node
 * to everything that reads them. Without `id` because ids are assigned per POSITION — a shape used
 * three times has three sets of them — so comparing with ids in would find no repeats at all on
 * any tree the editor has touched.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const cached = CANON.get(value);
  if (cached !== undefined) return cached;
  const out = Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.entries(value as Record<string, unknown>)
        .filter(([k, v]) => v !== undefined && k !== 'id')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(',')}}`;
  CANON.set(value, out);
  return out;
}

/** A `meta.panels` entry: configuration that may carry a node, rather than a node itself. */
interface PanelEntry {
  node?: unknown;
  [k: string]: unknown;
}

const panelsOf = (node: SchemaNode): PanelEntry[] | undefined => {
  const panels = (node as { meta?: { panels?: unknown } }).meta?.panels;
  return Array.isArray(panels) ? (panels as PanelEntry[]) : undefined;
};

/**
 * Every child position a node holds — the same edges the renderer walks.
 *
 * `meta.panels` is included because a shell keeps whole interfaces there, and in the workshop
 * template they are 44% of the document; a walk that missed them would leave the biggest shapes
 * un-hoisted. Each entry is CONFIGURATION — `{ id, snap, node }` — so what is walked is its
 * `node`, not the entry. An entry carries an `id`, which is enough for `isSchemaChild` to call it
 * a node, and treating it as one walks straight past the interface hanging off it.
 *
 * `styles` is skipped: a CSS object, not a subtree.
 */
function childPositions(node: SchemaNode): SchemaNode[] {
  const out: SchemaNode[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push);
    else if (isSchemaChild(v) || isPropsSchemaNode(v)) out.push(v as SchemaNode);
  };
  if (Array.isArray(node.children)) node.children.forEach(push);
  if (Array.isArray(node.routes)) node.routes.forEach(push);
  if (node.slots) Object.values(node.slots).forEach(push);
  if (node.props) for (const [key, value] of Object.entries(node.props)) if (key !== 'styles') push(value);
  for (const panel of panelsOf(node) ?? []) push(panel.node);
  return out;
}

/** Rebuild a node with each child position mapped, leaving everything else as it was. */
function mapChildren(node: SchemaNode, map: (child: SchemaNode) => SchemaNode): SchemaNode {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isSchemaChild(v) || isPropsSchemaNode(v)) return map(v as SchemaNode);
    return v;
  };
  const out: SchemaNode = { ...node };
  if (Array.isArray(node.children)) out.children = node.children.map(walk) as SchemaNode['children'];
  if (Array.isArray(node.routes)) out.routes = node.routes.map(walk) as SchemaNode['routes'];
  if (node.slots) {
    out.slots = Object.fromEntries(Object.entries(node.slots).map(([k, v]) => [k, walk(v)])) as SchemaNode['slots'];
  }
  if (node.props) {
    out.props = Object.fromEntries(
      Object.entries(node.props).map(([k, v]) => [k, k === 'styles' ? v : walk(v)]),
    ) as SchemaNode['props'];
  }
  const panels = panelsOf(node);
  if (panels) {
    const meta = (node as { meta: Record<string, unknown> }).meta;
    (out as { meta?: Record<string, unknown> }).meta = {
      ...meta,
      // The entry is kept as it is and only its `node` is mapped — see `childPositions`.
      panels: panels.map((panel) => ('node' in panel ? { ...panel, node: walk(panel.node) } : panel)),
    };
  }
  return out;
}

const isRef = (node: SchemaNode): boolean => node.type === REF_TYPE;

/** The definitions a root carries, or an empty object. */
export function definitionsOf(schema: SchemaNode): Record<string, SchemaNode> {
  const defs = (schema as { $defs?: unknown }).$defs;
  return defs && typeof defs === 'object' ? (defs as Record<string, SchemaNode>) : {};
}

/**
 * Lift every shape that occurs more than once into `$defs`, leaving a `$ref` at each occurrence.
 *
 * Maximal shapes first: a repeat inside a repeat is already carried by its parent's definition, so
 * hoisting both would store the same bytes twice over. The pass then runs again INSIDE the
 * definitions it just made, which is what catches a shape shared between two different
 * definitions — the board card, say, which appears inside the column arrangement and inside the
 * person-rows arrangement.
 */
export function compactDefinitions(schema: SchemaNode, options: CompactOptions = {}): CompactResult {
  const minChars = options.minChars ?? 200;
  const before = JSON.stringify(schema).length;

  /* How often each shape occurs anywhere in the tree, definitions included as they are made. */
  const counts = new Map<string, number>();
  const tally = (node: SchemaNode) => {
    const key = canonical(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    childPositions(node).forEach(tally);
  };
  tally(schema);

  const defs: Record<string, SchemaNode> = {};
  const nameOf = new Map<string, string>();
  let next = 1;

  /*
    Replace a node with a reference when its shape repeats, and never descend into one that has
    been replaced.

    The root is exempt however often it repeats — a template whose root is its own definition would
    be a reference to itself.
  */
  const rewrite = (node: SchemaNode, isRoot: boolean): SchemaNode => {
    const key = canonical(node);
    const count = counts.get(key) ?? 1;
    const worth = !isRoot && !isRef(node) && count > 1 && key.length >= minChars;

    if (!worth) return mapChildren(node, (child) => rewrite(child, false));

    let name = nameOf.get(key);
    if (!name) {
      name = `d${next++}`;
      nameOf.set(key, name);
      // The definition is rewritten too, so a shape shared between definitions is stored once.
      defs[name] = mapChildren(node, (child) => rewrite(child, false));
    }
    return { type: REF_TYPE, props: { def: name } };
  };

  let rewritten = mapChildren(schema, (child) => rewrite(child, false));

  /*
    Put back any definition that ended up used only once.

    Occurrences are counted over the tree as it ARRIVES, and hoisting a shape removes every
    occurrence of everything inside it — so a shape that appeared twice because its parent did now
    appears once, inside that parent's definition, and a definition with one reference is pure
    overhead. Left in, this produced 585 definitions for `CardsView` where 252 carry the same
    saving.

    Iterated, because inlining one definition can leave another with a single reference: a shape
    used twice inside a definition that itself turns out to be used once collapses in two steps.
  */
  const references = (node: SchemaNode, into: Map<string, number>): Map<string, number> => {
    if (isRef(node)) {
      const name = (node.props as RefProps | undefined)?.def;
      if (name) into.set(name, (into.get(name) ?? 0) + 1);
    }
    childPositions(node).forEach((child) => references(child, into));
    return into;
  };

  for (;;) {
    const used = references(rewritten, new Map());
    for (const def of Object.values(defs)) references(def, used);
    const once = new Set([...Object.keys(defs)].filter((name) => (used.get(name) ?? 0) <= 1));
    if (!once.size) break;

    // Read from a snapshot: the loop below deletes as it goes, and a definition still being
    // inlined into another one must not vanish underneath it.
    const bodies = { ...defs };
    const inline = (node: SchemaNode): SchemaNode => {
      if (isRef(node)) {
        const name = (node.props as RefProps | undefined)?.def;
        if (name && once.has(name)) return inline(bodies[name]);
      }
      return mapChildren(node, inline);
    };
    rewritten = mapChildren(rewritten, inline);
    for (const name of Object.keys(bodies)) {
      if (once.has(name)) delete defs[name];
      else defs[name] = mapChildren(bodies[name], inline);
    }
  }

  if (!Object.keys(defs).length) return { schema, hoisted: 0, saved: 0 };

  const out: SchemaNode = { ...rewritten, $defs: { ...definitionsOf(schema), ...defs } } as SchemaNode;
  return { schema: out, hoisted: Object.keys(defs).length, saved: before - JSON.stringify(out).length };
}

/**
 * How many places a node renders in — 1 for an ordinary node, more for one inside a shared shape.
 *
 * This is what an editor tells somebody after a patch, and the reason it needs saying: a change
 * to a node inside a definition reaches every use of that shape at once. That is usually what was
 * wanted (a card template inside an `$each` is one definition already) and sometimes emphatically
 * not, so it has to be visible rather than inferred from the result.
 *
 * Counted rather than estimated, because a definition can be referenced from inside another one:
 * a shape used twice inside an arrangement that is itself used three times renders six times, and
 * "changed 2 places" would be wrong in the direction that matters.
 */
export function useCountOf(root: SchemaNode, targetId: string): number {
  const defs = definitionsOf(root);
  if (!Object.keys(defs).length || !targetId) return 1;

  const holds = (node: SchemaNode): boolean => node.id === targetId || childPositions(node).some(holds);
  const owner = Object.entries(defs).find(([, def]) => holds(def))?.[0];
  if (!owner) return 1;

  const refsTo = (node: SchemaNode, name: string): number =>
    (isRef(node) && (node.props as RefProps | undefined)?.def === name ? 1 : 0) +
    childPositions(node).reduce((total, child) => total + refsTo(child, name), 0);

  /*
    Uses of a definition: references from the tree itself, plus references from each OTHER
    definition multiplied by however many times that one is used. Memoised by name, and a name
    already being resolved counts as nothing — `compactDefinitions` cannot produce a cycle, and a
    template from a stranger must not be able to hang the editor by containing one.
  */
  const settled = new Map<string, number>();
  const uses = (name: string, open: ReadonlySet<string>): number => {
    const cached = settled.get(name);
    if (cached !== undefined) return cached;
    if (open.has(name)) return 0;
    const deeper = new Set([...open, name]);
    let total = refsTo({ ...root, $defs: undefined } as SchemaNode, name);
    for (const [other, def] of Object.entries(defs)) {
      if (other === name) continue;
      const within = refsTo(def, name);
      if (within) total += within * uses(other, deeper);
    }
    settled.set(name, total);
    return total;
  };

  return Math.max(1, uses(owner, new Set()));
}

/**
 * Put every `$ref` back, and drop `$defs` — the exact inverse of the pass above.
 *
 * The renderer needs this, and so does anything that wants to read a template as the tree it will
 * actually be: the schema validator, the acceptance check, an export. Keeping both directions in
 * one file is also what lets a test assert the round trip, which is the only real guarantee that
 * compaction is lossless.
 */
export function expandDefinitions(schema: SchemaNode): SchemaNode {
  const defs = definitionsOf(schema);
  if (!Object.keys(defs).length) return schema;

  /*
    A definition may itself hold references, so expansion recurses — and a reference cycle would
    recurse for ever. Cycles cannot be produced by `compactDefinitions`, which only ever points a
    reference at a shape that already existed, but a template arrives from a stranger and a hostile
    one could contain `d1 -> d2 -> d1`. The `open` set turns that into a missing node rather than a
    hung tab.
  */
  const expand = (node: SchemaNode, open: ReadonlySet<string>): SchemaNode => {
    if (isRef(node)) {
      const name = (node.props as RefProps | undefined)?.def;
      const target = typeof name === 'string' ? defs[name] : undefined;
      if (!target || !name || open.has(name)) return { type: 'Column' };
      return expand(target, new Set([...open, name]));
    }
    return mapChildren(node, (child) => expand(child, open));
  };

  const out = mapChildren(schema, (child) => expand(child, new Set()));
  delete (out as { $defs?: unknown }).$defs;
  return out;
}

/** One node of an outline: enough to patch it, and enough to tell it from its siblings. */
export interface OutlineEntry {
  id: string;
  type: string;
  /** Nesting depth below the node the outline was taken from, the root being 0. */
  depth: number;
  /** A few words identifying it — its own text, or a prop that names it. Empty when nothing does. */
  clue: string;
}

/**
 * Props worth quoting to tell two nodes of the same type apart, most identifying first.
 *
 * `variant` is last on purpose: it is a style, so a column's heading and its count are both
 * "footnote" and quoting it names neither. Anything carrying the node's own words comes first.
 */
const CLUE_PROPS = ['text', 'label', 'title', 'placeholder', 'name', 'icon', 'variant'] as const;

/**
 * A node's shape as ids and types — what something holding a subtree can say about it cheaply.
 *
 * The case it exists for is a split. The copy's descendants are numbered the moment the tree is,
 * but the model has not SEEN them: the schema reaches it in the user's turn and nowhere else. Told
 * only the copy's own id, it re-emits the whole shape by hand to change something inside — which
 * is thousands of tokens and a transcription to get wrong, and in the first real run it was both:
 * it dropped a `variant` while retyping and the heading came back the wrong size.
 *
 * So: the ids, the types, and a clue per node, which is the part that makes it usable. Four
 * `we-text` nodes are indistinguishable without one, and a model picking among them is guessing.
 *
 * Bounded, because a copy can be enormous. Past the limit the outline says how much it left out,
 * and the caller can say what to do about it — still far cheaper than the alternative it replaces.
 */
export function outlineOf(node: SchemaNode, limit = 80): { entries: OutlineEntry[]; omitted: number } {
  const entries: OutlineEntry[] = [];
  let omitted = 0;

  /*
    What a node SAYS, then what names it.

    The words are what differ between siblings — two headings in a card are both
    `variant: heading-sm` and only their text tells them apart, so leading with the prop would
    name every node and identify none of them.

    An expression is read from its END. A board's two labels are the same four-hundred-character
    `arrangedBoard({…})` call differing in the last word, `.label` against `.count`, so the head
    of one is the head of the other and the tail is the whole distinction.
  */
  const clueFrom = (value: unknown): string => {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 24);
    const expression = (value as { $?: unknown } | null)?.$;
    if (typeof expression === 'string' && expression.trim()) {
      const words = expression.trim();
      return words.length > 24 ? `…${words.slice(-24)}` : words;
    }
    return '';
  };

  const clueOf = (n: SchemaNode): string => {
    for (const child of n.children ?? []) {
      const clue = clueFrom(child);
      if (clue) return clue;
    }
    for (const key of CLUE_PROPS) {
      const clue = clueFrom((n.props as Record<string, unknown> | undefined)?.[key]);
      if (clue) return clue;
    }
    return '';
  };

  const walk = (n: SchemaNode, depth: number) => {
    if (!n?.type) return;
    if (entries.length >= limit) {
      omitted++;
    } else {
      entries.push({ id: n.id ?? '', type: n.type, depth, clue: clueOf(n) });
    }
    for (const child of childPositions(n)) walk(child, depth + 1);
  };
  walk(node, 0);

  return { entries, omitted };
}
