/**
 * Whether a person asked for what is about to happen.
 *
 * ## The problem this exists for
 *
 * Event props bind by shape — any `on[A-Z]…` key holding a handler — so a template reaches every
 * event an element can fire, and several fire with nobody there: an image failing or finishing, a
 * `details` that starts open, an input that takes focus on mount. Each of those ran an `$action` on
 * render (the `security:self-firing-events` browser case measured it), so a template installed from
 * a stranger could write into a shared space the moment it painted, and nobody would be asked.
 *
 * The trust boundary decides WHICH actions a template may name; this decides WHEN one may run. A
 * write runs only when somebody did something to the part of the template asking — see
 * `buildTemplateBag`, which is where the answer is used.
 *
 * ## Why not the browser's own answers
 *
 * - `isTrusted` is true of `load`, `error`, `toggle` and `focus`. It says the browser made the event,
 *   not that a person did.
 * - `navigator.userActivation.isActive` stays true for seconds after a click ANYWHERE. A click on a
 *   link into a space, then an image loading half a second later, passes — the exact case this is for.
 *
 * ## Two ways to have asked
 *
 * **Live.** A trusted activation event — a press, a key, typing, a drop, a paste — is still being
 * dispatched. Exact rather than timed: once dispatch finishes the browser resets the event's
 * `eventPhase` to 0. It covers everything a component does synchronously in response, which is
 * nearly everything: a select's change, a sortable's reorder, a graph's drag-end, a composer's save.
 *
 * **Credit.** Some components answer a press later — after encoding a crop, after a geocoding
 * lookup, after the eyedropper closes — and the press has finished dispatching by then. Every
 * rendered node with a handler registers its element as an {@link GestureOwner}; a trusted activation
 * credits each owner on its composed path, and a handler of that node called afterwards may spend the
 * credit — once, within {@link CREDIT_MS}.
 *
 * Credit is what keeps this out of component code. The alternative is every component that awaits
 * before emitting carrying the gesture across by hand: a convention every contributor must know, and
 * one a foreign custom element bundled from a library cannot follow at all. Here the renderer owns
 * it, because the renderer already builds every handler a component is given.
 *
 * Credit adds no power a template did not have. It only reaches elements on the pressed event's
 * path, and any of those could have carried a handler for that very press and done its writes with
 * the gesture live. What the press could already have funded, credit lets happen a moment later.
 * Nothing pressed is nothing credited: render, sync, scrolling and hovering earn nothing.
 *
 * ## Carried, never timed
 *
 * - **An `$action`'s continuations.** `onSuccess`/`onError`/`onFinally` run after a promise settles;
 *   `captureGesture` takes whatever the call was running under and `runWithGesture` restores it.
 * - **A blur after typing.** Leaving a field somebody typed into is the end of that typing, whether
 *   they clicked elsewhere or switched windows — and an autosave on blur refused because the window
 *   lost focus would lose what they typed. So a blur is live when the element received trusted input
 *   since it was focused, and only then.
 *
 * Nothing a schema can express creates either. `$callLocal` passes a gesture through; it cannot start one.
 */

/**
 * How long a credit lasts. Long enough for a lookup on a slow connection or a person working the
 * eyedropper; short enough that a press is not still paying for something a minute later.
 */
export const CREDIT_MS = 30_000;

/** The element a rendered node draws inside, as far as gesture credit is concerned. */
export interface GestureOwner {
  /** When an activation last passed through it, or -Infinity. */
  creditAt: number;
  /** Whether that credit has paid for a call. */
  spent: boolean;
}

/** One call of one node's handler, made outside any live gesture. */
interface Invocation {
  owner: GestureOwner;
  /** Whether this call has already spent the owner's credit — so its continuations ride on it. */
  claimed: boolean;
}

/** Opaque proof of what a call was running under, to hand to a continuation. */
export type GestureToken = { readonly at: Event } | { readonly invocation: Invocation };

/**
 * Events that are somebody doing something.
 *
 * Deliberately not `focus`, `toggle`, `load`, `scroll` or anything pointer-over: each of those happens
 * to people as well as being done by them.
 */
const ACTIVATION_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'touchstart',
  'touchend',
  'keydown',
  'keyup',
  'beforeinput',
  'input',
  'change',
  'submit',
  'drop',
  'dragend',
  'paste',
  'cut',
  'copy',
] as const;

interface GestureState {
  /** Activation events in dispatch, innermost last. Pruned as their dispatch ends. */
  dispatching: Event[];
  /** A live gesture restored for a continuation, or null. */
  held: Event | null;
  /** The handler call in progress outside a live gesture, or null. */
  invocation: Invocation | null;
  /** Elements somebody typed into since they were last focused. */
  typedInto: WeakSet<EventTarget>;
  owners: WeakMap<EventTarget, GestureOwner>;
  installed: boolean;
}

/*
  Kept on `globalThis` rather than in module scope, because a stale `dist` beside fresh `src` is a
  known way for this package to be loaded twice — and two copies of this state would mean the tracker
  one copy installed is not the one the bag consults, and every write is refused.
*/
const KEY = Symbol.for('we.gesture.state');
function state(): GestureState {
  const g = globalThis as Record<symbol, GestureState | undefined>;
  return (g[KEY] ??= {
    dispatching: [],
    held: null,
    invocation: null,
    typedInto: new WeakSet(),
    owners: new WeakMap(),
    installed: false,
  });
}

/** The element an event actually began at, inside any shadow root. */
function origin(e: Event): EventTarget | null {
  return e.composedPath?.()[0] ?? e.target;
}

function stillDispatching(s: GestureState): Event[] {
  s.dispatching = s.dispatching.filter((e) => e.eventPhase !== 0);
  return s.dispatching;
}

function live(s: GestureState): Event | null {
  if (s.held) return s.held;
  const d = stillDispatching(s);
  return d.length ? d[d.length - 1] : null;
}

function creditValid(owner: GestureOwner): boolean {
  return !owner.spent && Date.now() - owner.creditAt <= CREDIT_MS;
}

/**
 * Start listening. Returns a function that stops.
 *
 * Capture phase on the window, so the gesture is live before any handler below it runs — including a
 * handler that stops propagation.
 *
 * `requireTrusted: false` is for jsdom, where every event is synthetic. Nothing in production should
 * pass it: an untrusted event is one code dispatched, and code dispatching a click is the thing this
 * is not supposed to believe.
 */
export function installGestureTracking(target: Window = window, opts: { requireTrusted?: boolean } = {}): () => void {
  const s = state();
  const requireTrusted = opts.requireTrusted ?? true;
  const trusted = (e: Event) => !requireTrusted || e.isTrusted;

  /** Every owner the event passed through gets a fresh credit — a new press, a new answer. */
  const credit = (e: Event) => {
    const now = Date.now();
    for (const el of e.composedPath?.() ?? []) {
      const owner = s.owners.get(el);
      if (owner) {
        owner.creditAt = now;
        owner.spent = false;
      }
    }
  };

  const onActivation = (e: Event) => {
    if (!trusted(e)) return;
    stillDispatching(s).push(e);
    credit(e);
    if (e.type === 'input' || e.type === 'beforeinput') {
      const at = origin(e);
      if (at) s.typedInto.add(at);
    }
  };
  const onFocusIn = (e: Event) => {
    const at = origin(e);
    if (at) s.typedInto.delete(at);
  };
  const onBlur = (e: Event) => {
    if (!trusted(e)) return;
    const at = origin(e);
    if (at && s.typedInto.has(at)) stillDispatching(s).push(e);
  };

  for (const type of ACTIVATION_EVENTS) target.addEventListener(type, onActivation, true);
  target.addEventListener('focusin', onFocusIn, true);
  // Both: `onBlur` fires on `blur`, which does not bubble, and `onFocusOut` on the event after it.
  target.addEventListener('blur', onBlur, true);
  target.addEventListener('focusout', onBlur, true);
  s.installed = true;

  return () => {
    for (const type of ACTIVATION_EVENTS) target.removeEventListener(type, onActivation, true);
    target.removeEventListener('focusin', onFocusIn, true);
    target.removeEventListener('blur', onBlur, true);
    target.removeEventListener('focusout', onBlur, true);
    s.installed = false;
    s.dispatching = [];
  };
}

/** Whether tracking is running. A gate consulted before it is would refuse everything. */
export function gestureTrackingInstalled(): boolean {
  return state().installed;
}

/**
 * An owner for one rendered node, credited whenever an activation passes through `element`.
 *
 * Held in a weak map, so an element that unmounts takes its owner with it and nothing needs undoing.
 */
export function registerGestureOwner(element: EventTarget, owner: GestureOwner = newGestureOwner()): GestureOwner {
  state().owners.set(element, owner);
  return owner;
}

/** An owner with no credit, for a node whose element is not mounted yet. */
export function newGestureOwner(): GestureOwner {
  return { creditAt: -Infinity, spent: false };
}

/**
 * Run a node's handler as that node. Inside a live gesture this adds nothing; outside one, it is what
 * lets a gated action find the node's credit.
 */
export function runAsOwner<T>(owner: GestureOwner, fn: () => T): T {
  const s = state();
  if (live(s)) return fn();
  const previous = s.invocation;
  s.invocation = { owner, claimed: false };
  try {
    return fn();
  } finally {
    s.invocation = previous;
  }
}

/**
 * Whether a person asked for what is about to happen — and if they asked by credit, spend it.
 *
 * What a gate calls. A call that spends a credit keeps it for the rest of that call and for its
 * continuations, so a handler holding several actions, or a save that navigates on success, is one
 * thing a person asked for rather than one action and then refusals.
 */
export function claimGesture(): boolean {
  const s = state();
  if (live(s)) return true;
  const inv = s.invocation;
  if (!inv) return false;
  if (inv.claimed) return true;
  if (!creditValid(inv.owner)) return false;
  inv.owner.spent = true;
  inv.claimed = true;
  return true;
}

/** Whether a person asked, without spending anything. For reporting, not for gating. */
export function hasGesture(): boolean {
  const s = state();
  if (live(s)) return true;
  const inv = s.invocation;
  return !!inv && (inv.claimed || creditValid(inv.owner));
}

/** What the current call is running under, to carry into a continuation — or null for nothing. */
export function captureGesture(): GestureToken | null {
  const s = state();
  const at = live(s);
  if (at) return { at };
  return s.invocation ? { invocation: s.invocation } : null;
}

/**
 * Run `fn` under what `token` was captured from. A null token runs it under whatever is current —
 * which is to say, adds nothing.
 */
export function runWithGesture<T>(token: GestureToken | null, fn: () => T): T {
  if (!token) return fn();
  const s = state();
  const previous = { held: s.held, invocation: s.invocation };
  if ('at' in token) s.held = token.at;
  else s.invocation = token.invocation;
  try {
    return fn();
  } finally {
    s.held = previous.held;
    s.invocation = previous.invocation;
  }
}
