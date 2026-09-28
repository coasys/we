/**
 * What a transcript costs as it grows — the surface a long call is read through.
 *
 * Two interactions, because they fail for different reasons and only one of them is about data:
 *
 * - **Appending** is the live-call cost: one more utterance against everything already said. If the
 *   query is unbounded, every append re-reads, re-hydrates and re-renders the whole transcript, so
 *   the cost of speaking grows with the length of the conversation.
 * - **Resizing** costs nothing in data at all — nothing is added — and is still slow with a lot on
 *   screen, because `we-scroll-area` observes its own size and reads `scrollTop`/`scrollHeight` on
 *   every frame of the drag, against however much content is inside it.
 *
 * ## Reading the output
 *
 * The verdict is about **shape**, not speed. A number on this machine says nothing about anybody
 * else's, so the assertion is that the cost of one interaction does not grow in proportion to the
 * rows already there — which is true or false identically everywhere. Milliseconds are printed
 * beside it because a shape with no magnitude is hard to prioritise, and are never asserted on.
 *
 * The tolerance is deliberately loose. Some growth is honest: the browser has more boxes to lay out
 * whatever the app does, and a fixed window still pays for the rows inside it. What is being caught
 * is the difference between "a bit more" and "proportional to everything ever said".
 *
 * ## What the append figure leaves out
 *
 * The backend here is the in-memory one, which answers a query by filtering arrays. The AD4M client
 * answers the same query by parsing a JSON payload, constructing a model instance per row, and then
 * `JSON.stringify`-ing the result to fingerprint it — three passes over the whole result set, none
 * of which happens here. So `append` is a **floor**: whatever it reports, the real cost against a
 * node is higher and scales harder. Read it as "even with the cheapest possible backend, is the
 * renderer's own share of this flat?".
 *
 * `resize` has no such gap. Nothing is fetched, so what it measures is the whole of what happens.
 */
export const name = 'transcript cost by length';
export const scenario = 'perf:transcript';
export const widths = [420];
/**
 * A call that has just started, and two that are well past any sane window.
 *
 * The comparison that matters is between the **last two**, not between the first and the last, and
 * the difference is the whole point. A window caps what is drawn, so measuring 10 against 2000 sees
 * the climb from ten rows up to the cap and reads a bounded surface as a growing one. Measuring 500
 * against 2000 — both far above any window — asks the real question: past a certain amount of
 * content, does adding four times more add anything at all?
 *
 * 10 stays because it is the honest floor, and because a case that only ever mounts large is a case
 * nobody can read a small number out of.
 */
export const scales = [10, 500, 2000];

/** Per-row growth beyond this counts as "proportional to the content" rather than "a bit more". */
const GROWTH_TOLERANCE = 0.05;

/** Carried between runs of this case, since a ratio needs two points. */
const seen = new Map();

/** Frames the resize is dragged over — matched by its own baseline, so the waiting cancels out. */
const DRAG_FRAMES = 8;

export async function check(api, width, scale) {
  /*
    A baseline per interaction shape, not one for both.

    A drag spends a frame per step whatever the app does, and at ~16ms a frame that is most of its
    wall-clock. Subtracting an idle run of the SAME length leaves the work rather than the waiting;
    subtracting a one-frame idle from an eight-frame drag would report the frame budget as a cost.
  */
  const idle1 = await api.profile('idle', [1]);
  const idleDrag = await api.profile('idle', [DRAG_FRAMES]);

  const append = await api.profile('addRow', [
    'TextBlock',
    {
      id: `utterance-new-${scale}`,
      parentId: 'call-record-1',
      text: 'One more thing somebody said.',
      author: 'did:peer-a',
      createdAt: '2026-09-01T23:59:59',
    },
  ]);

  const resize = await api.profile('resize', [width, width - 120, DRAG_FRAMES]);

  const over = (run, base) => Math.round((run.ms - base.ms) * 10) / 10;
  /*
    Reported over the baseline rather than clamped at zero. A negative figure is noise, and saying
    so is more useful than rounding it up to "free" — a reader who sees `-0.4` knows the interaction
    is under the measurement floor, where `0` reads as a claim.
  */
  api.note(`append  reads=${append.layoutReads}  ms=${over(append, idle1)}  nodes=${append.nodes}`);
  api.note(`resize  reads=${resize.layoutReads}  ms=${over(resize, idleDrag)}`);

  seen.set(scale, { append, resize, nodes: append.nodes });

  const problems = [];
  // The two largest, both past any window — see `scales` for why not the first and the last.
  const prior = seen.get(scales[scales.length - 2]);
  if (prior && scale === scales[scales.length - 1]) {
    const from = scales[scales.length - 2];
    const span = scale - from;
    const small = prior;

    /*
      The DOM first, because it is the least ambiguous of the three.

      A bounded window renders a bounded number of rows however long the conversation is. If node
      count tracks the transcript, nothing is bounded and both timings below are explained.
    */
    const nodeGrowth = (append.nodes - small.nodes) / span;
    api.note(`nodes ${small.nodes} → ${append.nodes} (${nodeGrowth.toFixed(2)}/row)`);
    if (nodeGrowth > 1) {
      problems.push(
        `the transcript renders every row it has: ${small.nodes} nodes at ${from} rows and ` +
          `${append.nodes} at ${scale}. A window would hold this flat.`,
      );
    }

    for (const [what, a, b] of [
      ['appending one utterance', small.append, append],
      ['resizing the panel', small.resize, resize],
    ]) {
      const growth = (b.layoutReads - a.layoutReads) / span;
      if (growth > GROWTH_TOLERANCE) {
        const worst = Object.entries(b.byProperty)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 3)
          .map(([k, v]) => `${k}×${v}`)
          .join(', ');
        problems.push(
          `${what} forces more layout the more has been said: ${a.layoutReads} reads at ${from} ` +
            `rows, ${b.layoutReads} at ${scale} (${growth.toFixed(2)}/row). Mostly ${worst}.`,
        );
      }
    }
  }
  return problems;
}
