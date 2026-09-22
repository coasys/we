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
import { dragSession } from '@we/drag';
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

/**
 * A selection of several wears one frame, not one set of furniture per card.
 *
 * The rule the whole chrome layer turns on, and the reason multi-select needed design rather than
 * just a bigger Set: handles, connect dots and an action bar are each a statement about *this
 * record*, and twelve copies of them is ninety-six grab targets over the content they exist to
 * reveal. Worth a test because nothing about it fails loudly — the wrong version renders, it is
 * simply unusable.
 */
describe('the chrome over a selection of several', () => {
  const task = (id: string, x: number, y: number) => ({
    id: entityAddress('ds', 'TaskBlock', id),
    kind: 'entity' as const,
    type: 'TaskBlock',
    label: id,
    data: { x, y },
  });

  const literal = { literal: true as const, nodes: [task('t1', 0, 0), task('t2', 200, 0)], edges: [] };

  async function until(check: () => boolean, tries = 50): Promise<void> {
    for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, ...extra });

  /** Mount a canvas of two cards and sweep a rectangle over however many `to` reaches. */
  async function swept(to: number, props: Parameters<typeof GraphView>[0] = {}) {
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      nodeStyle: [{ style: { shape: 'card', width: 60, height: 40 } }],
      behaviours: [{ type: 'marquee-select', options: { armed: true } }, 'select', 'pan-zoom'],
      onNodeResize: () => undefined,
      onEdgeCreate: () => undefined,
      ...props,
    });
    await until(() => host.querySelectorAll('.we-graph__node').length > 1);
    const surface = host.querySelector('.we-graph__surface') as HTMLElement;
    surface.dispatchEvent(pointer('pointerdown', -80, -60));
    surface.dispatchEvent(pointer('pointermove', to, 60));
    surface.dispatchEvent(pointer('pointerup', to, 60, { buttons: 0 }));
    await until(() => host.querySelectorAll('.we-graph__node--selected').length > 0);
    return host;
  }

  it('draws one frame and no per-card furniture', async () => {
    const host = await swept(260);

    expect(host.querySelectorAll('.we-graph__node--selected')).toHaveLength(2);
    expect(host.querySelector('.we-graph__selection')).not.toBeNull();
    expect(host.querySelectorAll('.we-graph__resize')).toHaveLength(0);
    expect(host.querySelectorAll('.we-graph__connect')).toHaveLength(0);
  });

  it('keeps the per-card furniture when the sweep caught only one', async () => {
    const host = await swept(60);

    expect(host.querySelectorAll('.we-graph__node--selected')).toHaveLength(1);
    expect(host.querySelector('.we-graph__selection')).toBeNull();
    expect(host.querySelectorAll('.we-graph__resize')).toHaveLength(8);
  });

  it('says how many are caught, which the outline cannot', async () => {
    const host = await swept(260);

    expect(host.querySelector('.we-graph__actions')?.textContent).toContain('2 selected');
  });

  it('reports a selection action once, with every record in it', async () => {
    const seen: unknown[] = [];
    const host = await swept(260, {
      selectionActions: [{ id: 'remove', icon: 'trash', title: 'Remove' }],
      onSelectionAction: (payload) => seen.push(payload),
    });

    (host.querySelector('.we-graph__actions we-button') as HTMLElement)?.click();

    expect(seen).toEqual([
      {
        action: 'remove',
        count: 2,
        records: [
          { recordId: 't1', recordType: 'TaskBlock' },
          { recordId: 't2', recordType: 'TaskBlock' },
        ],
      },
    ]);
  });

  it('offers only what holds for every card in the selection', async () => {
    // `when` over a set has to mean "all of them". A control that acted on a fifth of what is
    // highlighted is the kind of mistake nobody notices until afterwards.
    const host = await swept(260, {
      selectionActions: [
        { id: 'both', icon: 'check', title: 'Both', when: { type: 'TaskBlock' } },
        { id: 'neither', icon: 'x', title: 'Neither', when: { label: 't1' } },
      ],
    });

    // Read as a property rather than an attribute: the renderer assigns to custom elements as DOM
    // properties, which is how a `we-*` primitive takes anything that is not a string.
    const labels = [...host.querySelectorAll('.we-graph__actions we-button')].map(
      (el) => (el as HTMLElement & { label?: string }).label,
    );
    expect(labels).toEqual(['Both']);
  });

  it('reports every selected record on a delete press', async () => {
    const seen: { count: number; records?: unknown[] }[] = [];
    const host = await swept(260, { onDeleteSelection: (payload) => seen.push(payload) });
    const surface = host.querySelector('.we-graph__surface') as HTMLElement;

    surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0].count).toBe(2);
    expect(seen[0].records).toEqual([
      { recordId: 't1', recordType: 'TaskBlock' },
      { recordId: 't2', recordType: 'TaskBlock' },
    ]);
  });
});

/**
 * Carrying cards off the canvas.
 *
 * The canvas has always registered a drop *zone* and was never a drag *source*, so nothing on it
 * could be taken to a Pocket, a folder or another space — not even one card. The gesture is the
 * ordinary card drag: over nothing it is a move, over a drop zone the cards go back where they
 * started and the zone gets them. What is tested here is that decision, because everything
 * downstream of it belongs to `@we/drag` and is tested there.
 */
describe('carrying a card off the canvas', () => {
  const task = (id: string, x: number, y: number) => ({
    id: entityAddress('ds', 'TaskBlock', id),
    kind: 'entity' as const,
    type: 'TaskBlock',
    label: id,
    data: { x, y },
  });

  const literal = { literal: true as const, nodes: [task('t1', 0, 0), task('t2', 200, 0)], edges: [] };

  async function until(check: () => boolean, tries = 50): Promise<void> {
    for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, ...extra });

  /** A canvas of two cards, with a drop zone registered away to one side. */
  async function canvas(props: Parameters<typeof GraphView>[0] = {}) {
    const dropped: unknown[] = [];
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      nodeStyle: [{ style: { shape: 'card', width: 60, height: 40 } }],
      behaviours: [
        { type: 'marquee-select', options: { armed: true } },
        'select',
        { type: 'drag-node', options: { pin: true } },
        'pan-zoom',
      ],
      carry: true,
      onNodeDragEnd: (payload) => dropped.push(payload),
      ...props,
    });
    await until(() => host.querySelectorAll('.we-graph__node').length > 1);

    const pocket = document.createElement('div');
    document.body.append(pocket);
    pocket.getBoundingClientRect = () =>
      ({ left: 500, top: 500, right: 700, bottom: 700, width: 200, height: 200 }) as DOMRect;
    const gathered: unknown[] = [];
    const unregister = dragSession.registerZone({ el: pocket, onDrop: ({ payload }) => gathered.push(payload) });

    return {
      host,
      surface: host.querySelector('.we-graph__surface') as HTMLElement,
      gathered,
      dropped,
      cleanup: () => {
        unregister();
        pocket.remove();
      },
    };
  }

  /** Press on the card at the origin, move to `(x, y)`, release. */
  function drag(surface: HTMLElement, x: number, y: number) {
    surface.setPointerCapture = () => undefined;
    surface.dispatchEvent(pointer('pointerdown', 0, 0));
    surface.dispatchEvent(pointer('pointermove', x, y));
    surface.dispatchEvent(pointer('pointermove', x, y));
    surface.dispatchEvent(pointer('pointerup', x, y, { buttons: 0 }));
  }

  it('is an ordinary move when the release lands on the canvas', async () => {
    const { surface, gathered, dropped, cleanup } = await canvas();

    drag(surface, 120, 90);

    expect(gathered).toEqual([]);
    expect(dropped).toHaveLength(1);
    cleanup();
  });

  it('hands the cards to a zone the release lands in, and reports no move', async () => {
    const { surface, gathered, dropped, cleanup } = await canvas();

    drag(surface, 600, 600);

    expect((gathered[0] as { items: { ref: unknown }[] })?.items.map((item) => item.ref)).toEqual([
      { entity: 'TaskBlock', id: 't1' },
    ]);
    // The position it was dropped *over* is inside a panel — the one place on the canvas nobody can
    // see — so writing it would be worse than writing nothing.
    expect(dropped).toEqual([]);
    cleanup();
  });

  it('puts the card back where it started', async () => {
    const { host, surface, cleanup } = await canvas();
    const before = host.querySelector('.we-graph__node')?.getAttribute('style');

    drag(surface, 600, 600);

    expect(host.querySelector('.we-graph__node')?.getAttribute('style')).toBe(before);
    cleanup();
  });

  it('carries the whole selection when the press is inside one', async () => {
    const { host, surface, gathered, cleanup } = await canvas();
    // Sweep both cards, then drag one of them into the zone.
    surface.setPointerCapture = () => undefined;
    surface.dispatchEvent(pointer('pointerdown', -80, -60));
    surface.dispatchEvent(pointer('pointermove', 260, 60));
    surface.dispatchEvent(pointer('pointerup', 260, 60, { buttons: 0 }));
    await until(() => host.querySelectorAll('.we-graph__node--selected').length === 2);

    drag(surface, 600, 600);

    expect((gathered[0] as { items: unknown[] })?.items).toHaveLength(2);
    cleanup();
  });

  it('carries the document and the picture together, not one instead of the other', async () => {
    // A composed card with an image has both, and two spreads keyed `preview` would have dropped the
    // document on exactly the cards with most to draw.
    const { surface, gathered, cleanup } = await canvas({
      seeds: {
        literal: true as const,
        nodes: [
          {
            id: entityAddress('ds', 'CollectionBlock', 'c1'),
            kind: 'entity' as const,
            type: 'CollectionBlock',
            label: 'c1',
            data: { x: 0, y: 0, editorState: '{"root":{}}', src: 'expression://pic' },
          },
        ],
        edges: [],
      },
    });

    drag(surface, 600, 600);

    expect((gathered[0] as { items: { preview: unknown }[] })?.items[0]?.preview).toEqual({
      content: '{"root":{}}',
      thumbnail: 'expression://pic',
    });
    cleanup();
  });

  it('does nothing at all unless the graph opts in', async () => {
    const { surface, gathered, dropped, cleanup } = await canvas({ carry: false });

    drag(surface, 600, 600);

    expect(gathered).toEqual([]);
    // Still an ordinary move, which is what a canvas without `carry` has always done.
    expect(dropped).toHaveLength(1);
    cleanup();
  });

  it('refuses the graph’s own drop zone, so a card cannot be brought into the canvas it is on', async () => {
    /*
      The canvas registers itself as a target for things dragged in from elsewhere. Without `from`
      naming the graph, a card dropped back on the canvas would land in that handler and be brought
      in a second time.
    */
    const brought: unknown[] = [];
    const { surface, cleanup } = await canvas({ onDrop: (payload) => brought.push(payload) });

    drag(surface, 120, 90);

    expect(brought).toEqual([]);
    cleanup();
  });
});

/**
 * Undo, on the keyboard.
 *
 * The graph reports and never performs, exactly as it does for delete — so what is testable here is
 * which presses it claims, which it leaves alone, and that binding the keys is what makes the canvas
 * a tab stop at all.
 */
describe('the undo keys', () => {
  const surfaceOf = (host: HTMLElement) => host.querySelector('.we-graph__surface') as HTMLElement;

  const press = (el: HTMLElement, key: string, extra: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

  it('reports undo and both spellings of redo', () => {
    const seen: string[] = [];
    const surface = surfaceOf(mount({ onUndo: () => seen.push('undo'), onRedo: () => seen.push('redo') }));

    press(surface, 'z', { ctrlKey: true });
    press(surface, 'z', { metaKey: true });
    press(surface, 'z', { ctrlKey: true, shiftKey: true });
    // Windows' own redo, which a good many people will only ever try.
    press(surface, 'y', { ctrlKey: true });

    expect(seen).toEqual(['undo', 'undo', 'redo', 'redo']);
  });

  it('leaves an unmodified z alone, so typing near a focused canvas still works', () => {
    const seen: string[] = [];
    const surface = surfaceOf(mount({ onUndo: () => seen.push('undo') }));

    press(surface, 'z');
    press(surface, 'a', { ctrlKey: true });

    expect(seen).toEqual([]);
  });

  it('leaves the event alone when nothing is bound', () => {
    const surface = surfaceOf(mount({ onDeleteSelection: () => undefined }));
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });

    surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('makes the canvas a tab stop on its own', () => {
    // Binding a key is what earns the focus, and undo is a key — a canvas with undo and no delete
    // would otherwise be one the keyboard could never reach.
    expect(surfaceOf(mount({ onUndo: () => undefined })).getAttribute('tabindex')).toBe('0');
  });
});

/**
 * The two ways a selection used to be lost.
 *
 * Both were invisible from the code and obvious the moment somebody used it: shift-click built a
 * selection that collapsed a frame later, and the keyboard stopped working after any press on the
 * graph's own chrome. Neither is a rule about the engine — both are about how this adapter is wired
 * to the interface around it, which is why they live here.
 */
describe('holding on to a selection', () => {
  const task = (id: string, x: number, y: number) => ({
    id: entityAddress('ds', 'TaskBlock', id),
    kind: 'entity' as const,
    type: 'TaskBlock',
    label: id,
    data: { x, y },
  });

  const literal = { literal: true as const, nodes: [task('t1', 0, 0), task('t2', 200, 0)], edges: [] };

  async function until(check: () => boolean, tries = 50): Promise<void> {
    for (let i = 0; i < tries && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  }

  const selectedLabels = (host: HTMLElement) =>
    [...host.querySelectorAll('.we-graph__node--selected')].map((el) => el.textContent?.trim()).sort();

  it('keeps a multi-selection when the interface focuses one of the cards in it', async () => {
    /*
      The workshop's wiring, reproduced: it binds `focus` to a route parameter that `onNodeClick`
      writes, so every click round-trips through the address. Demanding a selection of exactly one
      here meant shift-clicking a second card toggled it in and the returning focus immediately
      replaced the pair with the one just clicked.
    */
    const [focus, setFocus] = createSignal('t1');
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(
      () => (
        <GraphView seeds={literal} layout={{ type: 'manual' }} behaviours={['select', 'pan-zoom']} focus={focus()} />
      ),
      host,
    );
    await until(() => selectedLabels(host).length > 0);

    // Shift-click the second card, then let the interface's own focus catch up to it.
    const surface = host.querySelector('.we-graph__surface') as HTMLElement;
    const at = (type: string, extra: PointerEventInit = {}) =>
      surface.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 200, clientY: 0, buttons: 1, ...extra }),
      );
    at('pointerdown', { shiftKey: true });
    at('pointerup', { shiftKey: true, buttons: 0 });
    await until(() => selectedLabels(host).length === 2);
    setFocus('t2');
    await until(() => false, 5);

    expect(selectedLabels(host)).toEqual(['t1', 't2']);
  });

  it('still replaces the selection when the interface focuses something outside it', async () => {
    const host = mount({ seeds: literal, layout: { type: 'manual' }, focus: 't1' });
    await until(() => selectedLabels(host).length > 0);

    expect(selectedLabels(host)).toEqual(['t1']);
  });

  it('answers the keyboard after a press on the graph’s own chrome', async () => {
    /*
      `.we-graph__surface` is self-closing — the chrome is a *sibling* of it — so focus landing on a
      card's bar used to leave the listener unreachable. Delete had this from the start.
    */
    const seen: string[] = [];
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      nodeStyle: [{ style: { shape: 'card', width: 60, height: 40 } }],
      focus: 't1',
      nodeActions: [{ id: 'bin', icon: 'trash', title: 'Delete' }],
      onNodeAction: () => undefined,
      onUndo: () => seen.push('undo'),
      onDeleteSelection: () => seen.push('delete'),
    });
    await until(() => host.querySelector('.we-graph__actions') !== null);

    const button = host.querySelector('.we-graph__actions we-button') as HTMLElement;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));

    expect(seen).toEqual(['undo', 'delete']);
  });

  it('leaves the keys alone while somebody is typing into the chrome', async () => {
    // A colour control's hex field is an input inside the selected card's bar. Backspacing a wrong
    // digit must not delete the card the colour is being chosen for.
    const seen: string[] = [];
    const host = mount({
      seeds: literal,
      layout: { type: 'manual' },
      focus: 't1',
      onUndo: () => seen.push('undo'),
      onDeleteSelection: () => seen.push('delete'),
    });
    await until(() => host.querySelector('.we-graph__surface') !== null);

    const field = document.createElement('input');
    host.querySelector('.we-graph')!.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));

    expect(seen).toEqual([]);
  });
});
