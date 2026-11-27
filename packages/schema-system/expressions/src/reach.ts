/**
 * What a template may read off an object it holds, by a name it chose.
 *
 * ## The hole this closes
 *
 * A property read used to be `property in object`, which follows the prototype chain — right for
 * data, and exactly wrong for the page. A click handed a template the event, the event's target was
 * a DOM node, and the node's own getters led the rest of the way:
 * `event.target.ownerDocument.defaultView.localStorage[...]` read the session token, and a function
 * found on the way came back bound and callable. Nothing in the walk knew it had left the data.
 *
 * ## The rule
 *
 * An object is either **data** — an array, a plain object from any realm, or an instance of a class
 * somebody wrote in JavaScript, such as a record — or it belongs to the **host**: anything whose
 * prototype chain reaches a class the platform provides (`Node`, `Window`, `Storage`, `Event`,
 * `Map`, `Error`…). Data reads as it always did. A host object reads only the few fields named for
 * its kind below, and nothing else: no getter, no own property, no function.
 *
 * Holding a host object is not the problem. `{ $: 'event.target' }` still settles to the element,
 * and `tile.stream` is still a `MediaStream` a video can be given. Walking *into* one is what is
 * refused, wherever the walk started — an event, a local a template stored a node in, a store value,
 * a `pick()` — because every reader of a name comes here.
 *
 * An allowlist rather than a list of dangerous classes: the platform grows every year, and a
 * denylist is only as good as the day it was written. A class nobody anticipated reads as nothing.
 */
import { DENIED_PROPERTIES } from './ast';

/** What a host object of each kind may be asked, found by the first name on its chain that matches. */
const HOST_FIELDS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  [
    'Event',
    new Set([
      'type',
      'detail',
      'target',
      'currentTarget',
      'key',
      'code',
      'repeat',
      'altKey',
      'ctrlKey',
      'metaKey',
      'shiftKey',
      'button',
      'buttons',
      'clientX',
      'clientY',
      'deltaX',
      'deltaY',
      'data',
      'inputType',
      'isComposing',
    ]),
  ],
  // What a form control reports. Everything that leads elsewhere — the document, the parent, the
  // shadow root, the attributes — is absent.
  ['Element', new Set(['value', 'checked', 'id', 'name'])],
  ['File', new Set(['name', 'size', 'type', 'lastModified'])],
  ['Blob', new Set(['size', 'type'])],
  ['DOMException', new Set(['name', 'message', 'code'])],
  ['Error', new Set(['name', 'message', 'code'])],
];

type Reach = { kind: 'data' } | { kind: 'host'; fields: ReadonlySet<string>; ownData: boolean };

const DATA: Reach = { kind: 'data' };
const NOTHING: ReadonlySet<string> = new Set();

const NATIVE_SOURCE = /\{\s*\[native code\]\s*\}\s*$/;

/**
 * Whether a constructor is the platform's. Native source is the answer in a browser, and holds
 * across realms — an iframe's `Window` is native too. jsdom implements the DOM in JavaScript, so a
 * class this realm exposes as a global by its own name counts as well.
 */
function isPlatformClass(ctor: unknown): boolean {
  if (typeof ctor !== 'function') return false;
  try {
    if (NATIVE_SOURCE.test(Function.prototype.toString.call(ctor))) return true;
  } catch {
    return true;
  }
  const name = (ctor as { name?: unknown }).name;
  return typeof name === 'string' && name !== '' && (globalThis as Record<string, unknown>)[name] === ctor;
}

/** Keyed by the object's prototype, so a list of a thousand records classifies once. */
const byPrototype = new WeakMap<object, Reach>();

const UNREADABLE: Reach = { kind: 'host', fields: NOTHING, ownData: false };

function reachOf(object: object): Reach {
  if (Array.isArray(object)) return DATA;
  let first: object | null;
  try {
    first = Object.getPrototypeOf(object) as object | null;
  } catch {
    return UNREADABLE; // a revoked proxy, or a trap that throws
  }
  if (first === null) return DATA;
  const cached = byPrototype.get(first);
  if (cached) return cached;

  let reach: Reach = UNREADABLE;
  try {
    let platform = false;
    // Every class on the chain, nearest first: a button's is HTMLButtonElement, HTMLElement, Element…
    const names: string[] = [];
    for (let proto: object | null = first; proto; proto = Object.getPrototypeOf(proto) as object | null) {
      // A prototype whose own prototype is null is some realm's Object.prototype, where data ends.
      if (Object.getPrototypeOf(proto) === null) break;
      // The descriptor rather than `proto.constructor`, which could be a getter.
      const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value as { name?: unknown } | undefined;
      if (typeof ctor?.name === 'string') names.push(ctor.name);
      if (isPlatformClass(ctor)) platform = true;
    }
    if (!platform) {
      reach = DATA;
    } else {
      const match = HOST_FIELDS.find(([name]) => names.includes(name));
      // An error's own data is what it carries — a status, a reason — and an error is never a way
      // into the page, so its own fields read as well as the named ones.
      if (match)
        reach = { kind: 'host', fields: match[1], ownData: match[0] === 'Error' || match[0] === 'DOMException' };
    }
  } catch {
    // Unreadable as anything is unreadable as data.
  }
  byPrototype.set(first, reach);
  return reach;
}

/**
 * The value of `object[property]` as a template may see it, or `undefined` when the field is
 * absent or not the template's to read. The one place a name a template chose is read off an
 * object; a reader that does it any other way reopens the hole above.
 */
export function readField(object: object, property: string): unknown {
  if (DENIED_PROPERTIES.has(property)) return undefined;
  const reach = reachOf(object);
  try {
    if (reach.kind === 'data') {
      return property in object ? (object as Record<string, unknown>)[property] : undefined;
    }
    if (reach.fields.has(property)) {
      const value = (object as Record<string, unknown>)[property];
      return typeof value === 'function' ? undefined : value;
    }
    if (reach.ownData) {
      const own = Object.getOwnPropertyDescriptor(object, property);
      if (own && 'value' in own && typeof own.value !== 'function') return own.value;
    }
  } catch {
    // A getter that throws, or a proxy trap: nothing, as everywhere else in the evaluator.
  }
  return undefined;
}
