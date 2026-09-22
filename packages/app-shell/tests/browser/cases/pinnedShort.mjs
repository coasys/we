/**
 * A short pinned list opens at its end, immediately, and does not travel there afterwards.
 *
 * This is the case a long list hides. An opening jump longer than `SMOOTH_MAX_PX` is instant
 * whatever else is wrong, so a list of a few hundred rows looks fine while the rule underneath is
 * broken. A list only a little taller than its panel has a whole opening that fits under that cap —
 * and it used to animate, sliding up from the top over a few hundred milliseconds with its last
 * lines under the edge of the panel until it arrived.
 *
 * Two assertions, and the second is the one that names the fault. Where the list *ends up* was
 * always right; what was wrong is that it got there by moving, a moment after the panel appeared.
 * So the case measures twice and requires the position to be identical — an animation in flight
 * shows up as movement between the samples, and nothing else does.
 *
 * Deliberately NOT a check that the element never animates. A line arriving in a live call should
 * animate, and that is asserted in the unit tests where a follow can be triggered on demand; here
 * there is only an opening, and an opening must not move.
 */
export const name = 'a short pinned list opens at its end without travelling';
export const scenario = 'ds:pinned-short';
export const widths = [420];

export async function check({ measure, measurePart }) {
  const problems = [];

  const view = await measurePart('#feed', 'base');
  const last = await measure('#last-line');
  if (!view || !last) return ['expected a scroll area and a findable last line'];
  if (last.h === 0) return ['the last line has no box, so it never rendered'];

  // It has to overflow, or there is no opening scroll to judge.
  if (view.scrollH <= view.h) {
    return [`the content is ${view.scrollH}px in a ${view.h}px box — nothing overflows, so nothing is pinned`];
  }
  // And it has to be SHORT: the whole journey must fit under the smooth cap, or this is the case
  // that was already passing and the scenario has drifted into proving nothing.
  const journey = view.scrollH - view.h;
  if (journey > 1200) {
    problems.push(
      `the opening journey is ${journey}px, past the smooth cap — this scenario no longer tests the short case`,
    );
  }

  const viewBottom = view.y + view.h;
  if (last.y + last.h > viewBottom + 1) {
    problems.push(
      `the last line ends ${Math.round(last.y + last.h - viewBottom)}px under the edge of the panel on the first ` +
        `frame it could be measured on`,
    );
  }

  // Still there a beat later, and in the same place. Movement between these two readings is an
  // opening that animated rather than arrived.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const settled = await measure('#last-line');
  if (settled && Math.abs(settled.y - last.y) > 1) {
    problems.push(
      `the list moved ${Math.round(Math.abs(settled.y - last.y))}px after opening — it animated into position ` +
        `instead of starting there`,
    );
  }

  return problems;
}
