/**
 * What an interaction cost, measured in the page.
 *
 * ## Why counts and not only milliseconds
 *
 * A millisecond figure from this machine says nothing about anybody else's, and a performance
 * threshold that fails on a busy CI runner gets raised until it never fails, at which point the
 * suite is decoration. So the number this exists to produce is a **count**, and the question it
 * answers is not "is this fast" but **"does this get worse as there is more of it"**.
 *
 * That framing is what makes the metric robust. An interaction whose cost is flat from ten rows to
 * a thousand is an interaction that scales, whatever it happens to cost on any one machine; one that
 * grows with the row count is a bug, and the growth shows up identically everywhere. Milliseconds
 * are still collected and still printed, because a shape with no magnitude is hard to prioritise —
 * but they are a report, never an assertion.
 *
 * ## What `layoutReads` is, exactly
 *
 * Every read below is a property the browser can only answer by laying the page out. Reading one
 * while the DOM is dirty forces a synchronous layout; reading one when it is clean is nearly free.
 * This counts the **reads**, not the layouts, so it is an upper bound: reads ≥ forced layouts.
 *
 * That imprecision is affordable because of what the number is used for. Nobody should read "212
 * layout reads" as a cost; the finding is "212 at a thousand rows and 14 at ten", which says the
 * work is proportional to the content and points straight at the code doing it. A metric that is
 * exact but machine-dependent would be worse at that job, not better.
 *
 * The honest failure mode is the reverse: an interaction that reads layout a constant number of
 * times while the browser reflows a growing tree underneath it looks flat here and is not. That is
 * what `ms` is printed for, and why neither number is trusted alone.
 */

/** Everything a browser can only answer by laying out first. */
const ELEMENT_READS = [
  'clientWidth',
  'clientHeight',
  'clientTop',
  'clientLeft',
  'scrollWidth',
  'scrollHeight',
  'scrollTop',
  'scrollLeft',
] as const;

const HTML_READS = ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent'] as const;

let armed = false;
let reads = 0;
/** Which properties were read, and how often — what turns a count into a lead worth following. */
let byProperty: Record<string, number> = {};

function note(name: string): void {
  if (!armed) return;
  reads += 1;
  byProperty[name] = (byProperty[name] ?? 0) + 1;
}

/**
 * Wrap the getters once, at load.
 *
 * Installed permanently and gated by `armed` rather than patched around each measurement: patching
 * and unpatching would itself be observable, and a getter swapped out mid-interaction is a source of
 * exactly the kind of heisenbug a measuring tool must not have.
 */
export function installLayoutCounter(): void {
  const patch = (proto: object, names: readonly string[]) => {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const get = descriptor?.get;
      if (!get) continue;
      Object.defineProperty(proto, name, {
        ...descriptor,
        get(this: unknown) {
          note(name);
          return get.call(this);
        },
      });
    }
  };

  patch(Element.prototype, ELEMENT_READS);
  patch(HTMLElement.prototype, HTML_READS);

  for (const name of ['getBoundingClientRect', 'getClientRects'] as const) {
    const original = Element.prototype[name] as (this: Element) => unknown;
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      writable: true,
      value(this: Element) {
        note(name);
        return original.call(this);
      },
    });
  }

  const computed = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    note('getComputedStyle');
    return computed(el, pseudo);
  }) as typeof window.getComputedStyle;
}

export interface Profile {
  /** Layout-forcing property reads during the interaction — see the note above on what this is. */
  layoutReads: number;
  /** The same, broken down, so a count has somewhere to point. */
  byProperty: Record<string, number>;
  /** Wall-clock, including a forced flush at the end so reflow is inside the window, not after it. */
  ms: number;
  /** Elements under the mount when the interaction finished. */
  nodes: number;
}

/**
 * Run an interaction with the counter armed, and say what it cost.
 *
 * The flush at the end is load-bearing. Layout is lazy: without reading something that forces it,
 * the measurement stops before the browser has done the work the interaction caused, and an
 * expensive reflow lands *after* the timer and is never seen. Reading `offsetHeight` on the mount
 * makes the cost fall inside the window — and it is read through the unpatched path so the flush
 * does not count itself.
 */
export async function profile(run: () => void | Promise<void>): Promise<Profile> {
  const host = document.getElementById('mount') as HTMLElement;

  // Settle anything already pending, so the measurement is about this interaction and not the last.
  host.getBoundingClientRect();
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  reads = 0;
  byProperty = {};
  armed = true;
  const started = performance.now();
  try {
    await run();
    // Let the frame the interaction scheduled actually run — a Solid effect, a Lit update and a
    // `requestAnimationFrame` follow-up all land after the call returns, and all of them are cost.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    armed = false;
    // Outside the arming, so forcing the flush is not itself counted as a read.
    void host.offsetHeight;
  } finally {
    armed = false;
  }

  return {
    layoutReads: reads,
    byProperty: { ...byProperty },
    ms: Math.round((performance.now() - started) * 10) / 10,
    nodes: host.querySelectorAll('*').length,
  };
}
