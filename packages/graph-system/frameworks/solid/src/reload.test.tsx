/**
 * A marker changing is not the graph becoming a different graph.
 *
 * The workshop's canvas hands its suggestion markers straight from the transcriber, so `pending` and
 * `changed` move every time an extraction pass stages a record or somebody keeps one. Those are seed
 * *options*, and the reload effect compared the whole seed by value — so with auto-extract on a call
 * the graph reloaded every couple of minutes: the store cleared, every query re-run, and the old
 * graph left on screen at 40% under a "Loading graph…" spinner, for a change that amounted to two
 * cards changing opacity.
 *
 * Asserted through the stale class rather than through the engine's status, because that class *is*
 * the symptom — it is what fades the canvas, and it is what somebody in a call actually sees.
 */
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

/** Let the effects and the load's microtasks settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Whether the graph is drawing itself as stale — the fade.
 *
 * `reloading` and nothing else drives this class, which is what makes it the honest probe. Its
 * sibling symptom, the centred `we-graph__loading` wheel, is `reloading || (loading && no nodes)` —
 * so on a graph with nothing in it yet *any* load shows the wheel, correctly, and a test asserting
 * on it would be asserting something that is true either way.
 */
const reloading = (host: HTMLElement) => !!host.querySelector('.we-graph__layer--stale');

describe('what makes the canvas reload', () => {
  /**
   * A host whose queries can be left hanging, so an in-flight load is observable.
   *
   * With every query resolving immediately the whole load is over within a microtask and `reloading`
   * is never true long enough to see — which would make this pass whether or not the fix were there.
   */
  function fakeHost() {
    let hang = false;
    return {
      host: {
        query: () => (hang ? new Promise<never[]>(() => {}) : Promise.resolve([])),
        /*
          The seed asks the dataset what it holds and reads nothing it has not been told about, so a
          host with no models issues no queries at all — and a load with no queries settles inside a
          microtask, which would make every assertion below pass for the wrong reason.
        */
        models: () => [{ name: 'Placement', properties: [], relations: [] }],
        // The seed reads it before anything else; without one it throws before a query is issued.
        defaultDataset: () => 'dataset',
      },
      hangNext: () => {
        hang = true;
      },
    };
  }

  it('reloads for a change to what the canvas is, and not for a change to how it is marked', async () => {
    const [pending, setPending] = createSignal<string[]>([]);
    const [canvas, setCanvas] = createSignal('canvas-1');
    const { host: graphHost, hangNext } = fakeHost();

    const el = document.createElement('div');
    document.body.append(el);
    dispose = render(
      () => (
        <GraphView
          host={graphHost as never}
          seeds={{ source: 'canvas', options: { canvas: canvas(), pending: pending() } }}
        />
      ),
      el,
    );
    await settle();

    // From here every load hangs, so anything that starts one leaves the graph visibly mid-load.
    hangNext();

    /*
      A marker moving. This is the case the fix exists for: `pending` is applied to rows already
      fetched, so a change to it has no query to re-run and nothing to throw away.
    */
    setPending(['record-a']);
    await settle();
    expect(reloading(el), 'marking a card as a suggestion reloaded the whole canvas').toBe(false);

    /*
      And the control: a different canvas genuinely is a different graph, so the old one going stale
      under a spinner is exactly right — without this, the test would also pass on a build that had
      simply stopped reloading for anything at all.
    */
    setCanvas('canvas-2');
    await settle();
    expect(reloading(el), 'switching canvases should reload, and say so').toBe(true);
  });
});
