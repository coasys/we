/**
 * The graph as a surface something else can draw on, and as a view somebody else can be shown.
 *
 * Two seams, each with a failure that is invisible rather than loud. A decoration drawn outside the
 * camera's layer looks right until somebody pans. And a mark that is not keyed by its id remounts on
 * every move, which leaves nothing for a transition to interpolate — the cursor simply jumps, and the
 * CSS that was supposed to smooth it is still there, looking correct.
 *
 * Framing a region is tested in `@we/graph-core` instead: it needs a measured surface, which jsdom does
 * not give one, so asserting it here would be asserting that nothing happened.
 */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GraphView } from './GraphView.solid';
import type { GraphDecoration, GraphHostBindings, GraphViewProps } from './GraphView.types';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function mount(props: GraphViewProps = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <GraphView {...props} />, host);
  return host;
}

/**
 * Just the one binding under test.
 *
 * `GraphHostBindings` requires the data-layer trio a real host supplies (`query`, `defaultDataset`,
 * `models`); none of them is on the path a decoration takes, and standing them up here would be three
 * fakes whose only purpose is to satisfy a type.
 */
const drawing = (decorations: () => GraphDecoration[]) => ({ decorations }) as unknown as GraphHostBindings;

const mark = (id: string, x: number, y: number, ease = false): GraphDecoration => ({
  id,
  x,
  y,
  ease,
  render: () => <span data-mark={id} />,
});

describe('decorations', () => {
  it('draws nothing, and adds no layer, for a host that supplies none', () => {
    const host = mount();
    expect(host.querySelector('.we-graph__decorations')).toBeNull();
  });

  it('draws each mark inside the camera’s own transformed layer', () => {
    const host = mount({ host: drawing(() => [mark('did:ana', 40, 90)]) });

    const layer = host.querySelector('.we-graph__layer');
    const marks = host.querySelector('.we-graph__decorations');
    expect(marks).not.toBeNull();
    /*
      The containment is the assertion. Inside the layer, a mark pans and zooms with the drawing for
      nothing; drawn as a sibling it would be correct at the camera's resting position and wrong the
      moment anybody moved, which is not something a snapshot of the markup would show.
    */
    expect(layer!.contains(marks!)).toBe(true);
    expect(host.querySelector('[data-mark="did:ana"]')).not.toBeNull();
  });

  it('positions by world coordinates, and counter-scales in a separate element', () => {
    const host = mount({ host: drawing(() => [mark('did:ana', 40, 90)]) });

    const positioned = host.querySelector('.we-graph__decoration') as HTMLElement;
    expect(positioned.style.transform).toBe('translate(40px, 90px)');
    // Two elements, not one: the outer may be transitioned, and a zoom folded into a transitioned
    // transform would animate every cursor on every wheel click.
    expect(positioned.querySelector('.we-graph__decoration-scale')).not.toBeNull();
  });

  it('marks only the ones that asked to be eased', () => {
    const host = mount({ host: drawing(() => [mark('a', 0, 0, true), mark('b', 0, 0, false)]) });
    const [first, second] = [...host.querySelectorAll('.we-graph__decoration')];
    expect(first.classList.contains('we-graph__decoration--eased')).toBe(true);
    expect(second.classList.contains('we-graph__decoration--eased')).toBe(false);
  });

  it('moves a mark without remounting it, so there is something to interpolate', () => {
    const [marks, setMarks] = createSignal<GraphDecoration[]>([mark('did:ana', 10, 10, true)]);
    const host = mount({ host: drawing(marks) });

    const before = host.querySelector('.we-graph__decoration') as HTMLElement;
    setMarks([mark('did:ana', 60, 20, true)]);
    const after = host.querySelector('.we-graph__decoration') as HTMLElement;

    // The same element, moved. A remount would reset the transition and the cursor would jump.
    expect(after).toBe(before);
    expect(after.style.transform).toBe('translate(60px, 20px)');
  });
});

describe('reporting the pointer', () => {
  it('reports in world coordinates, once per frame, with the latest position', async () => {
    const onPointerAt = vi.fn();
    const host = mount({ onPointerAt });
    const surface = host.querySelector('.we-graph__surface')!;

    // Several moves inside one frame: a high-rate mouse fires more often than the screen changes, and
    // a consumer should not have to sample it.
    for (const x of [10, 20, 30]) {
      surface.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: 5, bubbles: true }));
    }
    expect(onPointerAt).not.toHaveBeenCalled();

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(onPointerAt).toHaveBeenCalledTimes(1);
    // The last one, not an average and not the first: nothing is smoothed here.
    expect(onPointerAt.mock.calls[0][0]).toEqual({ x: 30, y: 5 });
  });

  it('reports nothing once the pointer leaves the graph', async () => {
    const onPointerAt = vi.fn();
    const host = mount({ onPointerAt });

    host.querySelector('.we-graph')!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(onPointerAt).toHaveBeenLastCalledWith(null);
  });
});
