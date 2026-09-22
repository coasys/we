/**
 * A pinned list opens showing its newest line, not two lines short of it.
 *
 * The follow used to allow exactly one frame for the content to finish laying out. A page of rows
 * arriving at once — which is what a bounded window does on open — is a hundred-odd custom elements
 * rendering their own shadow content, and that does not reliably finish in a frame. So the view was
 * scrolled to a bottom measured mid-layout and the last lines stayed under the edge of the panel,
 * needing a manual scroll to reach.
 *
 * This is the one claim that has to be made in a real browser. jsdom reports every scroll metric as
 * zero and lays nothing out, so the unit tests drive the decision by stubbing heights — which pins
 * the branch taken and can say nothing about whether the real thing settles in time.
 *
 * Asserted as "the last line is inside the viewport" rather than as a scroll offset, because that
 * is the reported symptom and the offset is what looked plausible while the line was still hidden.
 *
 * ## What this length does and does not catch
 *
 * A list this long has an opening journey past `SMOOTH_MAX_PX`, so it is instant whatever the rule
 * underneath says — which is exactly why it went on passing while a short list was visibly sliding
 * into place. `pinnedShort` is the case that discriminates; this one guards the long list against
 * regressions of its own, and the two are the same scenario at two lengths for that reason.
 *
 * It also passes with the settle pass reverted to a single frame. Reading `scrollHeight` forces a
 * synchronous layout, so one rAF already measures a settled tree — the multi-frame pass is
 * insurance against content that keeps moving for longer than that, which is real but is not what
 * this builds. What pins the settle behaviour is the unit tests, which drive the frames by hand.
 */
export const name = 'a pinned list opens at its newest line';
export const scenario = 'ds:pinned-page';
export const widths = [420];

export async function check({ measure, measurePart }) {
  const problems = [];

  const view = await measurePart('#feed', 'base');
  const last = await measure('#last-line');
  if (!view || !last) return ['expected a scroll area and a findable last line'];

  if (last.h === 0) return ['the last line has no box, so it never rendered'];

  // There has to be something to scroll, or the case proves nothing about scrolling.
  if (view.scrollH <= view.h) {
    return [`the content is ${view.scrollH}px in a ${view.h}px box — nothing overflows, so nothing is pinned`];
  }

  const lastBottom = last.y + last.h;
  const viewBottom = view.y + view.h;
  if (lastBottom > viewBottom + 1) {
    problems.push(
      `the last line ends at ${Math.round(lastBottom)} and the panel ends at ${Math.round(viewBottom)} — ` +
        `it is ${Math.round(lastBottom - viewBottom)}px under the edge`,
    );
  }

  // And it is not merely on screen by accident of a short list: the newest line should be AT the
  // bottom, not floating in the middle of a view that scrolled too far.
  if (lastBottom < viewBottom - 48) {
    problems.push(`the last line ends ${Math.round(viewBottom - lastBottom)}px above the bottom of the panel`);
  }

  return problems;
}
