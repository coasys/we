/**
 * `$part` — a module's named fragment, placed by an interface.
 *
 * The middle rung of the content chain, and the last one to be built. A module's presentation is a
 * default rather than a monopoly: its panel is several surfaces in one, and an interface that wants
 * them arranged differently could only hand-write copies of them. `contributes.parts` is where a
 * module publishes them, and this is what reads it.
 *
 * ## Resolved here rather than in the renderer
 *
 * Exactly as `$slot` is, in `slotRegistry`, and for the same reason: the host already composes
 * schemas out of registries, so this is one more step of a composition it was doing anyway rather
 * than a capability every renderer would have to learn.
 *
 * ## The subject
 *
 * A part written against its own module's state — a feed over `modules.transcribe.collectionId` — is
 * valid on its own and useless to anybody else, because the one thing a placer wants to change is
 * *what it is about*. So a part may name the expression that is its subject, and a placer may give
 * another: the token is substituted wherever it appears.
 *
 * Substitution rather than a bound name, because a bound name would make the part invalid in
 * isolation — `{ $: 'part.id' }` names nothing the validator can resolve, so the module's own
 * fragment would stop being checkable. This way the part stays the module's working node.
 */
import {
  derivedNodeId,
  deriveNodeIds,
  findNodeById,
  forEachNode,
  partForkPrint,
  type SchemaNode,
  type SchemaProp,
} from '@we/schema-shared';

import { moduleRegistry } from './moduleRegistry';

/**
 * A deep copy of template data, which is JSON by definition.
 *
 * Not `structuredClone`: a placement the editor hands over is the template's own node, held in a
 * Solid store, so its props are a proxy, and `structuredClone` refuses a proxy outright. Selecting a
 * placed part crashed the app that way.
 */
const copyOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Names already reported, so a template re-rendering does not repeat itself every frame. */
const reported = new Set<string>();

function warnUnknown(id: string): void {
  if (reported.has(id)) return;
  reported.add(id);
  const known = Object.keys(moduleRegistry.parts());
  console.warn(
    `[parts] no module publishes "${id}", so it renders nothing.` +
      (known.length ? ` Available: ${known.join(', ')}.` : ' No module publishes any part.'),
  );
}

/**
 * Replace one expression token with another, everywhere in a tree.
 *
 * Whole-token equality rather than string surgery: `{ $: 'x' }` becomes `{ $: 'y' }`, and an
 * expression that merely *mentions* the subject inside a larger sentence is left alone. A partial
 * rewrite of somebody else's expression is how a substitution mechanism starts producing sentences
 * nobody wrote.
 */
function substitute<T>(value: T, from: string, to: string): T {
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, from, to)) as unknown as T;
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (typeof record.$ === 'string' && record.$ === from) return { ...record, $: to } as T;

  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [key, entry] of Object.entries(record)) {
    const resolved = substitute(entry, from, to);
    if (resolved !== entry) changed = true;
    next[key] = resolved;
  }
  return (changed ? next : value) as T;
}

/** The expression a `subject` prop carries, however it was written. */
function subjectExpression(prop: unknown): string | undefined {
  if (typeof prop === 'string') return prop;
  if (prop && typeof prop === 'object' && typeof (prop as { $?: unknown }).$ === 'string') {
    return (prop as { $: string }).$;
  }
  return undefined;
}

/**
 * Bind the names a placement provides around a part — `inputs: { tile: { $: 'participant' } }`.
 *
 * A part that reads a name its parents bind declares it (`ModulePart.inputs`). Placed where nothing
 * binds it, the placement says what it is, and this binds it: a one-row `$each` over the value, the
 * only node that binds an arbitrary value to a name. One wrapper per input, so each is the name the
 * part's own expressions already use.
 */
function bindInputs(node: SchemaNode, inputs: unknown): SchemaNode {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return node;
  let bound = node;
  for (const [name, value] of Object.entries(inputs as Record<string, unknown>)) {
    const expression = subjectExpression(value);
    const items = (
      expression !== undefined && typeof value === 'object' ? { $: `[${expression}]` } : [value]
    ) as SchemaProp;
    bound = { type: '$each', props: { items, as: name }, children: [bound] };
  }
  return bound;
}

/**
 * A placement's part as a tree: pointed at the placement's subject, bound to its inputs, and — when
 * the placement has an id — every node given an id worked out from it.
 *
 * The ids are what let the editor reach inside a part. A module's nodes carry none, so the renderer
 * had nothing to stamp on them and a press anywhere inside a part could only select the part. Worked
 * out the way a built-in's are (`deriveNodeIds`), seeded by the placement, so the same node of the
 * same placement has the same id when it is drawn and when the editor opens it to copy — which is
 * how a node somebody pressed is found again in the copy. A part placed twice has two seeds, and a
 * part placed inside another is seeded by its own derived id, so nothing collides.
 *
 * Cached, since a template re-resolves on every change and a part can be large. What comes out is
 * shared, so callers that write it into a template clone it first.
 */
const instances = new WeakMap<object, Map<string, SchemaNode>>();

function instantiate(placement: SchemaNode, part: { node: SchemaNode; subject?: string }): SchemaNode {
  const props = (placement.props ?? {}) as { subject?: unknown; inputs?: unknown };
  const key = `${placement.id ?? ''}\u0000${JSON.stringify([props.subject ?? null, props.inputs ?? null])}`;
  let byKey = instances.get(part.node);
  if (!byKey) instances.set(part.node, (byKey = new Map()));
  const cached = byKey.get(key);
  if (cached) return cached;

  const wanted = subjectExpression(props.subject);
  const resolved = part.subject && wanted ? substitute(part.node, part.subject, wanted) : part.node;
  let tree = bindInputs(resolved, props.inputs);
  if (placement.id) {
    const seed = `part:${placement.id}`;
    tree = deriveNodeIds(copyOf(tree), seed);
    tree.id ??= derivedNodeId(`${seed}|`);
  }
  byKey.set(key, tree);
  return tree;
}

/**
 * Expand every `$part` in a tree.
 *
 * An unknown part renders nothing **and says so**. Silence is this codebase's recurring failure —
 * an unmatched read looks exactly like an empty one — and a part naming a module that is simply not
 * installed is the ordinary case, so the report is a console warning rather than a thrown error.
 */
export function resolveParts(node: SchemaNode): SchemaNode | SchemaNode[] {
  /*
    A `$panels` outlet becomes the host component that renders a home lane.

    Rewritten here rather than dispatched by the renderer, for the reason `$part` is: the outlet
    reads the shell's placements and renders sections with the template's own bag, which only a
    component in this package can do, and the renderer knows nothing about either. The props go
    through untouched — `lane`, `direction`, `accepts` — and the node is otherwise a leaf.
  */
  if (node.type === '$panels') return { ...node, type: 'PanelLane' };

  if (node.type === '$part') {
    const props = (node.props ?? {}) as { id?: unknown; subject?: unknown; inputs?: unknown };
    const id = typeof props.id === 'string' ? props.id : '';
    if (!id) return [];

    /*
      Every placement is framed, the part a template placed and the parts a module composes its own
      panel from alike. The frame carries where the part came from — so the editor selects the
      template's `$part` node rather than a node of the module's — and draws what is missing when the
      module is not here to draw it. Box-less, so a part lays out exactly as it did.
    */
    const frame = (children: SchemaNode[]): SchemaNode => ({
      type: 'PartFrame',
      ...(node.id ? { id: node.id } : {}),
      props: { part: id, ...(node.id ? { at: node.id } : {}) },
      children,
    });

    const part = moduleRegistry.parts()[id];
    if (!part) {
      warnUnknown(id);
      return frame([]);
    }

    // Recursive: a part may itself be composed of parts, which is how a module's own panel is built.
    const expanded = resolveParts(instantiate(node, part));
    return frame(Array.isArray(expanded) ? expanded : [expanded]);
  }

  const children = resolveList(node.children);
  const slots = resolveValue(node.slots);
  const props = resolveValue(node.props);
  /*
    `routes` as well, and it is a separate key rather than part of `props` or `children`.

    Missed while parts were only ever expanded inside a panel, where there are no routes. A template
    placing a module's fragment on one of its own pages puts it inside a route body, so without this
    the marker survives the walk untouched and reaches the renderer, which knows nothing about
    `$part` and mounts nothing — the same silent-empty failure the warning above exists to prevent.
  */
  const routes = resolveValue((node as { routes?: unknown }).routes);
  if (
    children === node.children &&
    slots === node.slots &&
    props === node.props &&
    routes === (node as { routes?: unknown }).routes
  ) {
    return node;
  }
  return { ...node, children, slots, props, routes } as SchemaNode;
}

/**
 * A placed part as nodes the template owns — what "open" and "fork" in the editor write in its place.
 *
 * `one` opens a single level: the part's own tree, pointed at the placement's subject and bound to
 * its inputs, with any `$part` inside it left as a reference. The arrangement becomes the template's
 * and every piece below it is still the module's, so a fix to one of those still lands. `all` follows
 * every reference down, which is a fork of the whole thing: nothing in it is the module's any more.
 *
 * No frames, unlike `resolveParts`: a frame is how the host draws a part, and what this returns is
 * written into a template. Null for a part nobody publishes — there is nothing to open.
 */
export function openPart(placement: SchemaNode, depth: 'one' | 'all'): SchemaNode | null {
  const opened = openRaw(placement, depth);
  return opened && printForks(opened);
}

/**
 * {@link openPart} without the fingerprints, for building a copy in steps: a level's fingerprint
 * reduces the copied levels inside it to which part each is, so it is only right once they are open.
 *
 * Every level opened records what it was — `forkedFrom` names the part, `forkedPart` keeps the
 * placement it replaces — which is what lets the editor give it back exactly as it was placed.
 */
function openRaw(placement: SchemaNode, depth: 'one' | 'all'): SchemaNode | null {
  const props = (placement.props ?? {}) as { id?: unknown; subject?: unknown; inputs?: unknown };
  const part = typeof props.id === 'string' ? moduleRegistry.parts()[props.id] : undefined;
  if (!part) return null;

  const bound = copyOf(instantiate(placement, part));
  bound.forkedFrom = `part:${String(props.id)}`;
  bound.forkedPart = { placement: copyOf(placement.props ?? {}), print: '' };
  return depth === 'all' ? inlineParts(bound) : bound;
}

/** Fingerprint every copied level in a finished copy. Mutates and returns it. */
function printForks(root: SchemaNode): SchemaNode {
  forEachNode(root, (node) => {
    if (node.forkedPart) node.forkedPart.print = partForkPrint(node);
  });
  return root;
}

/**
 * A placed part opened only as far as one node inside it — what "make it your own" writes for a node
 * somebody selected deep inside a part.
 *
 * `chain` is the placements the node sits in, outermost first, as the editor read them off the page:
 * the template's own `$part`, then each part placed inside the one before. Every one of them is
 * opened a level, and nothing else — a part beside the path stays a reference, so it still receives
 * its module's changes. Opened in place, each keeps the ids it was drawn with, so `target` is found in
 * the result. When the target is itself a placement at the end of the chain, it is left a placement.
 *
 * Null when a step cannot be found or opened — a module changed its part since the page was drawn.
 */
export function openPartPath(
  placement: SchemaNode,
  chain: string[],
  target: string,
): { node: SchemaNode; target: SchemaNode; parts: string[] } | null {
  if (chain[0] !== placement.id) return null;
  const parts: string[] = [];
  let root: SchemaNode | null = null;
  for (let i = 0; i < chain.length; i++) {
    // The last placement on the chain is the target itself when a nested part was what was pressed.
    if (chain[i] === target && i > 0) break;
    const at = i === 0 ? placement : root && findNodeById(root, chain[i])?.node;
    if (!at || at.type !== '$part') return null;
    const opened = openRaw(at, 'one');
    if (!opened) return null;
    parts.push(String((at.props as { id?: unknown } | undefined)?.id ?? ''));
    if (i === 0) root = opened;
    else {
      for (const key of Object.keys(at)) delete (at as Record<string, unknown>)[key];
      Object.assign(at, opened);
    }
  }
  if (root) printForks(root);
  const found = root && (root.id === target ? root : findNodeById(root, target)?.node);
  return root && found ? { node: root, target: found, parts } : null;
}

/** Every `$part` below a node replaced by what it is, all the way down. One nobody publishes stays. */
function inlineParts<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => inlineParts(entry)) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === '$part') return (openRaw(record as SchemaNode, 'all') ?? record) as T;
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, inlineParts(entry)])) as T;
}

/**
 * Expand every `$part` in a route table.
 *
 * A route is not a node — it carries a `path` and may carry no `type` at all — so it needs its own
 * way in rather than being handed to {@link resolveParts}, which would refuse it. The walk beneath
 * is the same one.
 *
 * Returns the list unchanged, by identity, when it holds no parts — which is every template that
 * places none, so a memo built on this re-runs nothing downstream.
 */
export function resolvePartsInRoutes<T>(routes: T[]): T[] {
  const out = resolveList(routes);
  return (Array.isArray(out) ? out : routes) as T[];
}

const isNode = (value: unknown): value is SchemaNode =>
  !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';

function resolveList(children: unknown): unknown {
  if (!Array.isArray(children)) return children;

  let changed = false;
  const out: unknown[] = [];
  for (const child of children) {
    if (!isNode(child)) {
      /*
        Walked rather than passed over, because not everything in a list of "children" is a node.

        A **route** is the case that matters: `{ path, children, routes }` carries no `type`, so it
        failed `isNode` and its whole subtree went unexamined — which made a `$part` inside any
        route invisible while looking exactly like one that had been expanded to nothing. Strings
        and numbers still pass straight through, and an expression token is an object whose entries
        never change, so it comes back by identity and costs nothing.
      */
      const walked = child && typeof child === 'object' ? resolveValue(child) : child;
      if (walked !== child) changed = true;
      out.push(walked);
      continue;
    }
    const next = resolveParts(child);
    if (next !== child) changed = true;
    if (Array.isArray(next)) out.push(...next);
    else out.push(next);
  }
  return changed ? out : children;
}

/**
 * Walk anything that might hold a node — `props.then`, a slot's contents, a route's body.
 *
 * A `$part` inside an `$if`'s `then` is an ordinary thing to write, and it lives in props rather
 * than in children.
 */
function resolveValue(value: unknown): unknown {
  if (Array.isArray(value)) return resolveList(value);
  if (!value || typeof value !== 'object') return value;

  if (isNode(value)) {
    const next = resolveParts(value);
    // A part expanding to several nodes has nowhere to go in a single-node slot; the first is the
    // honest answer, and a part that expands to nothing leaves the key absent.
    return Array.isArray(next) ? next[0] : next;
  }

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [key, entry] of Object.entries(record)) {
    const resolved = resolveValue(entry);
    if (resolved !== entry) changed = true;
    if (resolved !== undefined) next[key] = resolved;
  }
  return changed ? next : value;
}
