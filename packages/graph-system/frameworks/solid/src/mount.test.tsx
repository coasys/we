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

  it('marks a press’s focus as the pointer’s, so the ring is kept for the keyboard', () => {
    /*
      The focus is scripted, and Chromium carries the last focus's modality over to a scripted one —
      so on a freshly loaded page the same press drew a ring round the whole canvas that it drew
      nowhere else. The class is what the stylesheet reads instead; blur clears it, so tabbing back
      in is keyboard focus again.
    */
    const surface = surfaceOf(mount({ onDeleteSelection: () => undefined }));
    const marked = () => surface.classList.contains('we-graph__surface--pointer-focus');

    surface.focus();
    expect(marked()).toBe(false);

    surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(marked()).toBe(true);

    surface.blur();
    expect(marked()).toBe(false);
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

/**
 * Folding — the part of it that is DOM rather than engine.
 *
 * What is hidden and what stands in for it is decided and tested in `graph-core`. What is here is
 * everything that could go wrong between that answer and the screen: whether a folded card says so
 * where anybody can see it, whether the control exists at all when nothing is listening for it, and
 * whether pressing it reports what it promised. None of those is visible to a typecheck, and the
 * first one is the difference between a fold and cards quietly going missing.
 */
describe('GraphView folding', () => {
  const card = (id: string, x: number, y: number) => ({
    id: entityAddress('ds', 'TaskBlock', id),
    kind: 'entity' as const,
    type: 'TaskBlock',
    label: id,
    data: { x, y },
  });

  /** `parent` → `child`, so there is something for a fold to take. */
  const literal = {
    literal: true as const,
    nodes: [card('parent', 0, 0), card('child', 200, 0)],
    edges: [
      {
        id: 'e1',
        source: entityAddress('ds', 'TaskBlock', 'parent'),
        target: entityAddress('ds', 'TaskBlock', 'child'),
        type: 'rel',
      },
    ],
  };

  async function until(check: () => boolean, tries = 50): Promise<void> {
    for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  const labels = (host: HTMLElement) =>
    [...host.querySelectorAll('.we-graph__node')].map((el) => el.textContent?.trim());

  /*
    The primitives are not registered in this environment, so a `we-button` here is an unupgraded
    unknown element: everything the renderer sets dynamically lands as a DOM property and reflects to
    no attribute. Read the property, which is what a real `we-button` reads too.
  */
  const propOf = (host: HTMLElement, selector: string, name: string) =>
    (host.querySelector(selector) as unknown as Record<string, unknown> | null)?.[name];

  it('hides what is under a fold and says how much, on the card', async () => {
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      folded: ['parent'],
      onNodeFold: () => undefined,
    });
    // Once the cards have finished travelling into the fold — they are drawn on their way there,
    // which is the whole point of the movement.
    await until(() => labels(host).length === 1);
    // The count, where the reader is looking — not in a legend somewhere else.
    expect(host.querySelector('.we-graph__fold')?.textContent).toContain('1');
  });

  it('draws every card when the fold names nothing it holds', async () => {
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      folded: ['nobody'],
      onNodeFold: () => undefined,
    });
    await until(() => labels(host).length === 2);

    expect(labels(host).sort()).toEqual(['child', 'parent']);
    expect(host.querySelector('.we-graph__fold')).toBeNull();
  });

  it('draws the line a fold leaves behind, and says how many it stands for', async () => {
    /*
      A fold that hid a card connected to something still on screen has to say so, or the canvas
      shows an isolated card where there were related ones. `shared` is what makes the boundary: it
      is held by `outside`, so the fold has to leave it, and `child`'s connection to it crosses.
    */
    const bundled = {
      literal: true as const,
      nodes: [card('parent', 0, 0), card('child', 200, 0), card('shared', 400, 0), card('outside', 600, 0)],
      edges: (
        [
          ['parent', 'child'],
          ['child', 'shared'],
          ['outside', 'shared'],
        ] as const
      ).map(([from, to]) => ({
        id: `${from}->${to}`,
        source: entityAddress('ds', 'TaskBlock', from),
        target: entityAddress('ds', 'TaskBlock', to),
        type: 'rel',
      })),
    };
    const host = mount({
      seeds: bundled,
      layout: { type: 'manual' },
      folded: ['parent'],
      edgeStyle: [{ when: { type: 'fold-bundle' }, style: { dashed: true, showLabel: true } }],
      onNodeFold: () => undefined,
    });
    await until(() => labels(host).length === 3);

    // `child` is gone, and its connection to `shared` has come back as one line from the fold.
    expect(labels(host).sort()).toEqual(['outside', 'parent', 'shared']);
    expect([...host.querySelectorAll('.we-graph__edge-label')].map((el) => el.textContent?.trim())).toContain('1');
  });

  it('opens the fold holding a card something else asked to show', async () => {
    /*
      The inspector case. A panel opens one end of a connection by writing the address, the canvas
      follows it through `focus` — and if a fold is holding that card, clearing the selection would
      leave the panel describing something nobody can see. So the fold is reported for opening, the
      way clicking a search result opens the sections above it in an outline.
    */
    const seen: { recordId?: string; folded: boolean }[] = [];
    mount({
      seeds: literal,
      layout: { type: 'manual' },
      folded: ['parent'],
      focus: 'child',
      onNodeFold: (payload) => seen.push(payload),
    });
    await until(() => seen.length > 0);

    // Once, not once per redraw: the fold set here is never actually changed, and a live graph
    // redraws whenever anybody writes anything.
    expect(seen).toEqual([
      {
        id: entityAddress('ds', 'TaskBlock', 'parent'),
        recordId: 'parent',
        recordType: 'TaskBlock',
        folded: false,
        count: 1,
      },
    ]);
  });

  it('offers no fold control when nothing is listening for one', async () => {
    // The bargain every other gesture here makes: an affordance that could not do anything is worse
    // than none, so binding the handler is what puts the control on the card.
    const host = mount({ seeds: literal, layout: { type: 'manual' }, focus: 'parent' });
    await until(() => host.querySelectorAll('.we-graph__node--selected').length > 0);

    expect(host.querySelector('.we-graph__actions')).toBeNull();
  });

  it('offers it on a selected card that has something to fold, and not on a leaf', async () => {
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      focus: 'parent',
      onNodeFold: () => undefined,
    });
    await until(() => host.querySelector('.we-graph__actions') !== null);

    expect(propOf(host, '.we-graph__actions we-button', 'label')).toBe('Fold');

    dispose?.();
    dispose = undefined;

    const leaf = mount({
      seeds: literal,
      layout: { type: 'manual' },
      focus: 'child',
      onNodeFold: () => undefined,
    });
    await until(() => leaf.querySelectorAll('.we-graph__node--selected').length > 0);

    expect(leaf.querySelector('.we-graph__actions')).toBeNull();
  });

  it('says what a fold will leave behind, rather than half working in silence', async () => {
    /*
      `shared` is held by `outside` as well, so folding `parent` may take `own` and may not take
      `shared`. Pressing it and watching one of two cards go is the shape of thing that reads as a
      bug, so the control says which it is.
    */
    const shared = {
      literal: true as const,
      nodes: [card('parent', 0, 0), card('own', 200, 0), card('shared', 400, 0), card('outside', 600, 0)],
      edges: (
        [
          ['parent', 'own'],
          ['parent', 'shared'],
          ['outside', 'shared'],
        ] as const
      ).map(([from, to]) => ({
        id: `${from}->${to}`,
        source: entityAddress('ds', 'TaskBlock', from),
        target: entityAddress('ds', 'TaskBlock', to),
        type: 'rel',
      })),
    };
    const host = mount({ seeds: shared, layout: { type: 'manual' }, focus: 'parent', onNodeFold: () => undefined });
    await until(() => host.querySelector('.we-graph__actions we-tooltip') !== null);

    expect(propOf(host, '.we-graph__actions we-tooltip', 'content')).toBe(
      'Fold 1 card into this one · 1 card stays, connected elsewhere',
    );
  });

  it('offers a refused fold, not no fold, where everything under a card is shared', async () => {
    /*
      The limit of the same case, and the one that reads worst: with nothing a fold may take, the
      control used to vanish — which says "this card cannot fold" instead of "there is nothing here
      a fold may take". Shown and refused, with the reason in the tooltip.
    */
    const allShared = {
      literal: true as const,
      nodes: [card('parent', 0, 0), card('shared', 200, 0), card('outside', 400, 0)],
      edges: (
        [
          ['parent', 'shared'],
          ['outside', 'shared'],
        ] as const
      ).map(([from, to]) => ({
        id: `${from}->${to}`,
        source: entityAddress('ds', 'TaskBlock', from),
        target: entityAddress('ds', 'TaskBlock', to),
        type: 'rel',
      })),
    };
    const host = mount({
      seeds: allShared,
      layout: { type: 'manual' },
      focus: 'parent',
      onNodeFold: () => undefined,
    });
    await until(() => host.querySelector('.we-graph__actions we-button') !== null);

    expect(propOf(host, '.we-graph__actions we-button', 'disabled')).toBe(true);
    expect(propOf(host, '.we-graph__actions we-tooltip', 'content')).toBe(
      'Nothing to fold — everything under this card is also connected elsewhere',
    );
  });

  it('reports the state being asked for, and how much it is about', async () => {
    const seen: { id: string; recordId?: string; folded: boolean; count: number }[] = [];
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      focus: 'parent',
      onNodeFold: (payload) => seen.push(payload),
    });
    await until(() => host.querySelector('.we-graph__actions we-button') !== null);

    (host.querySelector('.we-graph__actions we-button') as HTMLElement).click();

    // A record id, as every other payload here carries — and the state wanted, so a handler writes
    // what it is told rather than working out the opposite of what it was.
    expect(seen).toEqual([
      {
        id: entityAddress('ds', 'TaskBlock', 'parent'),
        recordId: 'parent',
        recordType: 'TaskBlock',
        folded: true,
        count: 1,
      },
    ]);
  });

  it('unfolds from the chip, with no selecting first', async () => {
    const seen: { id: string; folded: boolean; count: number }[] = [];
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      folded: ['parent'],
      onNodeFold: (payload) => seen.push(payload),
    });
    await until(() => host.querySelector('.we-graph__fold we-button') !== null);

    (host.querySelector('.we-graph__fold we-button') as HTMLElement).click();

    expect(seen).toEqual([
      {
        id: entityAddress('ds', 'TaskBlock', 'parent'),
        recordId: 'parent',
        recordType: 'TaskBlock',
        folded: false,
        count: 1,
      },
    ]);
  });
});

/**
 * The selection sweep — the part of it that is DOM rather than engine.
 *
 * The rectangle's arithmetic and its claiming rules are tested against the behaviour in
 * `@we/graph-core`. What only exists here is whether a sweep actually puts a rectangle on screen:
 * the behaviour reports through `drawMarquee`, the engine holds it, a signal carries it and an SVG
 * element draws it, and every one of those links is invisible if it breaks.
 */
describe('the selection marquee', () => {
  const surfaceOf = (host: HTMLElement) => host.querySelector('.we-graph__surface') as HTMLElement;
  const marqueeIn = (host: HTMLElement) => host.querySelector('.we-graph__marquee');

  /** A pointer event carrying the button state a live drag has. */
  const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, ...extra });

  function sweeping() {
    const host = mount({ behaviours: ['marquee-select', 'select', 'pan-zoom'] });
    const surface = surfaceOf(host);
    surface.dispatchEvent(pointer('pointerdown', 10, 10, { shiftKey: true }));
    surface.dispatchEvent(pointer('pointermove', 120, 90, { shiftKey: true }));
    return { host, surface };
  }

  it('draws a rectangle spanning the sweep', () => {
    const { host } = sweeping();

    const rect = marqueeIn(host);
    expect(rect).not.toBeNull();
    expect(rect!.getAttribute('width')).toBe('110');
    expect(rect!.getAttribute('height')).toBe('80');
  });

  it('takes it down on release', () => {
    const { host, surface } = sweeping();
    expect(marqueeIn(host)).not.toBeNull();

    surface.dispatchEvent(pointer('pointerup', 120, 90, { buttons: 0, shiftKey: true }));

    expect(marqueeIn(host)).toBeNull();
  });

  it('draws nothing for a plain drag, which still pans', () => {
    // The modifier is the whole gate when the tool is not armed: without it the press belongs to
    // `pan-zoom` and the canvas behaves exactly as it did before any of this existed.
    const host = mount({ behaviours: ['marquee-select', 'select', 'pan-zoom'] });
    const surface = surfaceOf(host);

    surface.dispatchEvent(pointer('pointerdown', 10, 10));
    surface.dispatchEvent(pointer('pointermove', 120, 90));

    expect(marqueeIn(host)).toBeNull();
  });

  it('draws one for a plain drag when the template arms it', () => {
    const host = mount({
      behaviours: [{ type: 'marquee-select', options: { armed: true } }, 'select', 'pan-zoom'],
    });
    const surface = surfaceOf(host);

    surface.dispatchEvent(pointer('pointerdown', 10, 10));
    surface.dispatchEvent(pointer('pointermove', 120, 90));

    expect(marqueeIn(host)).not.toBeNull();
  });
});
