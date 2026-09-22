/**
 * What a module's store publishes, and how it says which members are public.
 *
 * ## Private by default
 *
 * A store used to be a flat record every template could reach in full: `modules.<id>.*` was the one
 * namespace the trust boundary handed over whole, because nothing distinguished a module's state from
 * its actions or its plumbing from its API. The pocket closed half of that hole with an opt-out list
 * (`chromeOnlyStoreMembers`), and the shape of that fix is what shows the default was wrong — a
 * module author who forgets the list exposes a private-data action to every synced template.
 *
 * So the default is inverted. A member a module has **not** marked is reachable only by the module's
 * own chrome, which renders against the chrome bag and sees everything. A member marked with
 * {@link markState} or {@link markAction} is the module's public API: what a space template may
 * read or call, and what the generated reference documents under `modules.<id>`.
 *
 * ## State and action are different words
 *
 * Every function on a store used to be tagged reactive, so `{ $: 'modules.call.leave' }` *called*
 * during paint. A marked state member is tagged reactive and read like any store value; a marked
 * action is callable only through `$action`, exactly as a host store's actions are. The module says
 * which is which, because nothing else can.
 *
 * ## The description is required
 *
 * The same rule host stores live under: a member a template can name with nothing saying what it
 * means fails the build of the generated reference. Here it is required at the marker, so the
 * catalogue reads it off the store rather than off a second list somebody maintains.
 */

const KIND = Symbol.for('we.module.member.kind');
const DOC = Symbol.for('we.module.member.doc');

export type ModuleMemberKind = 'state' | 'action';

/** What a module's `createStore` returns. Members are accessors, actions, or plain values. */
export type ModuleStore = Record<string, unknown>;

/** One public member, as the catalogue and the template bag both see it. */
export interface ModuleMemberSurface {
  kind: ModuleMemberKind;
  doc: string;
}

/** Every public member of a store, by name. Unmarked members are absent. */
export type ModuleStoreSurface = Record<string, ModuleMemberSurface>;

type Marked = { [KIND]?: ModuleMemberKind; [DOC]?: string };

function mark<T>(member: T, kind: ModuleMemberKind, doc: string): T {
  // A value that is not a function cannot carry a symbol, so it is wrapped in an accessor — which is
  // also the shape the template bag expects state to have.
  const target = (typeof member === 'function' ? member : () => member) as T & Marked;
  target[KIND] = kind;
  target[DOC] = doc;
  return target;
}

/**
 * Publish a state member. Templates read it in an expression; it is tagged reactive.
 *
 * Takes an accessor (a signal's read half, or a derived closure) and returns it marked. A plain value
 * is wrapped in an accessor so the bag has one shape to tag.
 */
export function markState<T>(accessor: T, doc: string): T extends (...args: never[]) => unknown ? T : () => T {
  return mark(accessor, 'state', doc) as never;
}

/** Publish an action. Templates call it through `$action`; an expression reading it gets nothing. */
export function markAction<T extends (...args: never[]) => unknown>(fn: T, doc: string): T {
  return mark(fn, 'action', doc);
}

/** Which kind a member was marked as, or `undefined` for one the module kept to itself. */
export function memberKind(member: unknown): ModuleMemberKind | undefined {
  if (typeof member !== 'function') return undefined;
  return (member as Marked)[KIND];
}

/** The sentence a member was marked with, or `undefined`. */
export function memberDoc(member: unknown): string | undefined {
  if (typeof member !== 'function') return undefined;
  return (member as Marked)[DOC];
}

/** The public surface of a store — its marked members and their descriptions. */
export function storeSurface(store: ModuleStore | undefined): ModuleStoreSurface {
  const out: ModuleStoreSurface = {};
  for (const [name, member] of Object.entries(store ?? {})) {
    const kind = memberKind(member);
    if (kind) out[name] = { kind, doc: memberDoc(member) ?? '' };
  }
  return out;
}
