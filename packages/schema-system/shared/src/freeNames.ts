/**
 * What a subtree reads that nothing inside it binds — the names it needs from wherever it is placed.
 *
 * A fragment written for one place can lean on that place without saying so: a row read as `tile`
 * because the `$each` above it binds that name, a `local.selected` declared by the panel around it.
 * In its home it works. Placed anywhere else it renders, empty, and nothing reports why — the same
 * silent failure every check in this package exists to turn into a sentence.
 *
 * This answers the question those checks need: given a subtree, which context names and which locals
 * does it read that no node inside it declares. A module's part that declares those as its inputs is
 * honest about its needs; one that does not is a part that only works where it was written.
 *
 * Read as data, the way `lintModule` reads a contribution, rather than along the renderer's edges: an
 * expression in a `$queries` where-clause or a `DropdownMenu`'s items is as much a read as one in
 * `children`, and a structural walk would step over it.
 */
import { parseCached, referencedPaths, referencedRoots } from './expressions';

export interface FreeNames {
  /** Context names read and never bound inside — `tile`, `block`, `item`. */
  names: string[];
  /** `local.*` fields read or written and never declared inside — `selected`, `draft`. */
  locals: string[];
}

/**
 * Names that are never a dependency on a parent: the host binds them wherever a schema is mounted,
 * or they exist only inside a handler as it fires. A store is recognised by its name, since this
 * package does not know the host's list — `spaceStore`, `editorStore` — and the two stores without
 * the suffix are named.
 */
const ALWAYS_BOUND = new Set([
  'me',
  'currentDataset',
  'surface',
  'modules',
  'event',
  'arg',
  'result',
  'record',
  'clipboard',
]);
const isGlobal = (name: string) => ALWAYS_BOUND.has(name) || /Store$/.test(name);

/** What a binding node calls the name it binds, when it is not told. */
const DEFAULT_AS: Record<string, string> = { $each: 'item', $single: 'item', $agent: 'agent', $surface: 'surface' };

/** Handler tokens whose value is the name of a local. */
const LOCAL_HANDLERS = ['$setLocal', '$toggleLocal', '$toggleLocalIn', '$callLocal'];

type Scope = { names: ReadonlySet<string>; locals: ReadonlySet<string> };

export function freeNames(subtree: unknown): FreeNames {
  const names = new Set<string>();
  const locals = new Set<string>();

  const readExpression = (source: string, scope: Scope) => {
    let parsed;
    try {
      parsed = parseCached(source);
    } catch {
      return; // A syntax error is the validator's to report, not a dependency.
    }
    for (const root of referencedRoots(parsed)) {
      if (root === 'local' || isGlobal(root) || scope.names.has(root)) continue;
      names.add(root);
    }
    for (const { root, path } of referencedPaths(parsed)) {
      if (root === 'local' && path[0] && !scope.locals.has(path[0])) locals.add(path[0]);
    }
  };

  const visit = (value: unknown, scope: Scope): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, scope);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;

    if (typeof record.$ === 'string') readExpression(record.$, scope);
    for (const key of LOCAL_HANDLERS) {
      const name = record[key];
      if (typeof name === 'string' && !scope.locals.has(name)) locals.add(name);
    }
    if (typeof record.$touch === 'string' && record.$touch !== '$all' && !scope.locals.has(record.$touch)) {
      locals.add(record.$touch);
    }

    // A node's own `$localState` and `$queries` are in scope for the node itself, its props included.
    let here = scope;
    const declared = [
      ...Object.keys((record.$localState as object | undefined) ?? {}),
      ...Object.keys((record.$queries as object | undefined) ?? {}).flatMap((q) => [q, `${q}Loaded`]),
    ];
    if (declared.length) here = { names: scope.names, locals: new Set([...scope.locals, ...declared]) };

    /*
      A binding node binds for what it renders, never for the props that say what to bind: `$each`'s
      `items` is read outside the row, so an `item` inside it is the parent's.
    */
    const type = typeof record.type === 'string' ? record.type : '';
    const binds = DEFAULT_AS[type];
    const props = (record.props as Record<string, unknown> | undefined) ?? {};
    let inside = here;
    if (binds) {
      const as = typeof props.as === 'string' && props.as ? props.as : binds;
      const bound = type === '$each' ? [as, 'index', 'prev'] : [as];
      inside = { names: new Set([...here.names, ...bound]), locals: here.locals };
    }

    for (const [key, entry] of Object.entries(record)) {
      if (key === '$' || LOCAL_HANDLERS.includes(key) || key === '$touch') continue;
      if (key === 'props' && binds) {
        // What the binding is fed is the parent's; a `then`/`else` branch or anything else is inside.
        for (const [prop, propValue] of Object.entries(props)) {
          visit(propValue, prop === 'items' || prop === 'item' || prop === 'did' ? here : inside);
        }
        continue;
      }
      visit(entry, key === 'children' || key === 'slots' ? inside : here);
    }
  };

  visit(subtree, { names: new Set(), locals: new Set() });
  return { names: [...names].sort(), locals: [...locals].sort() };
}
