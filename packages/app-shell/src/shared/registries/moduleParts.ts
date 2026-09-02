/**
 * `$part` — a module's named fragment, placed by an interface.
 *
 * The middle rung of the content chain, and the last one to be built. A module's presentation is a
 * default rather than a monopoly: its panel is several surfaces in one, and an interface that wants
 * them arranged differently could only hand-write copies of them. `ModuleDefinition.schemas` has
 * always said "named schema fragments a template can place", and nothing read it — so the promise
 * was there and the mechanism was not.
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
import type { SchemaNode } from '@we/schema-shared';

import { moduleRegistry } from './moduleRegistry';

/** Names already reported, so a template re-rendering does not repeat itself every frame. */
const reported = new Set<string>();

function warnUnknown(id: string): void {
  if (reported.has(id)) return;
  reported.add(id);
  const known = Object.keys(moduleRegistry.schemas());
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
 * Expand every `$part` in a tree.
 *
 * An unknown part renders nothing **and says so**. Silence is this codebase's recurring failure —
 * an unmatched read looks exactly like an empty one — and a part naming a module that is simply not
 * installed is the ordinary case, so the report is a console warning rather than a thrown error.
 */
export function resolveParts(node: SchemaNode): SchemaNode | SchemaNode[] {
  if (node.type === '$part') {
    const props = (node.props ?? {}) as { id?: unknown; subject?: unknown };
    const id = typeof props.id === 'string' ? props.id : '';
    if (!id) return [];

    const part = moduleRegistry.schemas()[id];
    if (!part) {
      warnUnknown(id);
      return [];
    }

    const wanted = subjectExpression(props.subject);
    const resolved = part.subject && wanted ? substitute(part.node, part.subject, wanted) : part.node;
    // Recursive: a part may itself be composed of parts, which is how a module's own panel is built.
    return resolveParts(resolved);
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
