/**
 * The graph mounts.
 *
 * The one test in this package that renders the component, and it exists because everything else
 * here is a pure function — `pathFrom`, `resize`, `pending` — so a fourteen-hundred-line renderer
 * had no coverage of the only thing it does.
 *
 * What it catches is the class of failure that takes the *whole app* down rather than the graph:
 * anything thrown while the component body runs. The one that prompted it was a `createMemo`
 * declared beside the signals it resembled, reaching the engine `const` below it — `createMemo` runs
 * its body eagerly, so that is a `ReferenceError` before a single element exists, and the app failed
 * to start with a message naming a line nobody would look at twice. Typecheck passes it, every unit
 * test passes it, and the build passes it.
 *
 * Deliberately shallow. It asserts that mounting produces a canvas and does not throw, not what the
 * canvas contains — the geometry, the routing and the parsing are all tested where they live, and a
 * mount test that started asserting on markup would be a second, worse copy of those.
 */
import { entityAddress } from '@we/graph-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { GraphView } from './GraphView.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

/** Mount into a detached host and hand back what it drew. */
function mount(props: Parameters<typeof GraphView>[0] = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <GraphView {...props} />, host);
  return host;
}

describe('GraphView mounts', () => {
  it('renders its canvas with no props at all', () => {
    const host = mount();

    expect(host.querySelector('.we-graph')).not.toBeNull();
    expect(host.querySelector('.we-graph__surface')).not.toBeNull();
  });

  it('renders with the canvas’s own wiring bound', () => {
    /*
      The props a canvas passes, which is what the route-editing handles are gated on: binding
      `onEdgeAnchor` and `onEdgeReroute` is what makes the grips exist at all, so a mount without
      them would not exercise the branches those live in.
    */
    const host = mount({
      layout: { type: 'manual' },
      edgeStyle: [{ style: { curve: 'smooth' } }],
      onEdgeAnchor: () => undefined,
      onEdgeReroute: () => undefined,
      onEdgeCreate: () => undefined,
      onNodeDragEnd: () => undefined,
      onNodeResize: () => undefined,
    });

    expect(host.querySelector('.we-graph__layer')).not.toBeNull();
    expect(host.querySelector('.we-graph__edges')).not.toBeNull();
  });

  it('renders with re-attachment bound as well', () => {
    // The third route-editing handler, and the one that writes the claim rather than the view.
    // Bound, its branch in the anchor gesture exists; unbound the drag falls back to anchoring.
    const host = mount({ onEdgeAnchor: () => undefined, onEdgeRetarget: () => undefined });

    expect(host.querySelector('.we-graph__edges')).not.toBeNull();
  });

  it('unmounts without throwing', () => {
    mount();

    expect(() => dispose?.()).not.toThrow();
    dispose = undefined;
  });
});

/**
 * `focus` — the graph picking what something beside it picked.
 *
 * Mounted against a literal graph so there is a real node to find, since everything that matters
 * here is in the resolution: a record id matched against an address, the selection that follows,
 * and the silence that has to go with it.
 */
describe('GraphView focus', () => {
  const task = (id: string, x: number, y: number) => ({
    id: entityAddress('ds', 'TaskBlock', id),
    kind: 'entity' as const,
    type: 'TaskBlock',
    label: id,
    data: { x, y },
  });

  const literal = {
    literal: true as const,
    nodes: [task('t1', 0, 0), task('t2', 200, 0)],
    edges: [],
  };

  /** The graph loads asynchronously; poll the DOM until it has drawn, or give up. */
  async function until(check: () => boolean, tries = 50): Promise<void> {
    for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  const selectedLabels = (host: HTMLElement) =>
    [...host.querySelectorAll('.we-graph__node--selected')].map((el) => el.textContent?.trim());

  it('selects the node standing for a record id, by the id alone', async () => {
    // A record id rather than an address, because the id is what a template holds — nothing in the
    // expression language could build `we-graph://entity/<dataset>/<type>/<id>`.
    const host = mount({ seeds: literal, layout: { type: 'manual' }, focus: 't2' });
    await until(() => selectedLabels(host).length > 0);

    expect(selectedLabels(host)).toEqual(['t2']);
  });

  it('does not report the selection it made back to the interface', async () => {
    /*
      The interface asked for this selection, so hearing it back is an echo — and the harmful kind:
      choosing a line clears the node selection, which reports an empty list, which the workshop
      reads as "nothing selected, close the inspector". The loop would close the panel that asked.
    */
    const reported: string[][] = [];
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      focus: 't1',
      onSelectionChange: (ids) => reported.push(ids),
    });
    await until(() => selectedLabels(host).length > 0);

    expect(selectedLabels(host)).toEqual(['t1']);
    expect(reported).toEqual([]);
  });

  it('follows a change of focus, and clears a selection that is no longer what is being shown', async () => {
    /*
      The inspector case end to end: a card is focused, then the panel opens a connection's far end
      that lives on another canvas. Leaving `t1` ringed would have the canvas and the panel make two
      claims about what is selected, one of them false.
    */
    const [focus, setFocus] = createSignal('t1');
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <GraphView seeds={literal} layout={{ type: 'manual' }} focus={focus()} />, host);
    await until(() => selectedLabels(host).length > 0);
    expect(selectedLabels(host)).toEqual(['t1']);

    setFocus('t2');
    await until(() => selectedLabels(host)[0] === 't2');
    expect(selectedLabels(host)).toEqual(['t2']);

    setFocus('elsewhere');
    await until(() => selectedLabels(host).length === 0);
    expect(selectedLabels(host)).toEqual([]);
  });

  it('waits for a record the graph does not hold yet, and does nothing for one it never will', async () => {
    // Patient, not wrong: a focus naming nothing selects nothing, rather than something nearby.
    const host = mount({ seeds: literal, layout: { type: 'manual' }, focus: 'nowhere' });
    await until(() => host.querySelectorAll('.we-graph__node').length === 2);

    expect(host.querySelectorAll('.we-graph__node')).toHaveLength(2);
    expect(selectedLabels(host)).toEqual([]);
  });
});

/**
 * The delete key — the graph's only keyboard, and the only place it takes focus.
 *
 * Asserted here rather than in `graph-core` because none of it is engine behaviour: the engine
 * already answers "what is selected", and what is new is a DOM listener, a tab stop and the decision
 * about which of those exist. All three are invisible to a typecheck and to every pure-function test
 * in this package.
 */
describe('GraphView delete key', () => {
  const surfaceOf = (host: HTMLElement) => host.querySelector('.we-graph__surface') as HTMLElement;

  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  it('is not a tab stop unless the key is bound', () => {
    /*
      A graph with no answer for the key has no business being focusable: every page holding a map
      would gain a tab stop whose focus does nothing. So the attribute is the binding, made visible.
    */
    expect(surfaceOf(mount()).hasAttribute('tabindex')).toBe(false);

    dispose?.();
    dispose = undefined;

    expect(surfaceOf(mount({ onDeleteSelection: () => undefined })).getAttribute('tabindex')).toBe('0');
  });

  it('takes focus on a press, because pointing at the canvas is aiming the keyboard at it', () => {
    /*
      The whole reason the listener is on the surface rather than on `window`: focus is what
      separates "delete the selected card" from "delete the character before the cursor" in the
      inspector's label field, and nothing else can.
    */
    const surface = surfaceOf(mount({ onDeleteSelection: () => undefined }));

    surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(document.activeElement).toBe(surface);
  });

  it('says nothing when nothing is selected, and nothing about any other key', () => {
    /*
      Two silences worth pinning. A press with an empty selection has nothing to report — firing with
      a count of zero would make every consumer write the same guard. And the listener claims exactly
      two keys, so a graph that has focus does not start swallowing typing near it.
    */
    const seen: unknown[] = [];
    const surface = surfaceOf(mount({ onDeleteSelection: (payload) => seen.push(payload) }));

    press(surface, 'Delete');
    press(surface, 'Backspace');
    press(surface, 'a');
    press(surface, 'Enter');

    expect(seen).toEqual([]);
  });

  it('leaves the event alone when it does not act on it', () => {
    /*
      `preventDefault` only where the press meant something. Backspace with nothing selected is
      somebody's browser shortcut, or nothing at all, and a canvas that swallowed it either way would
      be a canvas that had silently taken over a key it does not use.
    */
    const surface = surfaceOf(mount({ onDeleteSelection: () => undefined }));
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });

    surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
