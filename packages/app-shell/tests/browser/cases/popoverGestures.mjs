/**
 * A compact mark's popover outlasts the gesture, and goes when the write lands.
 *
 * Every mode but the toggle opens its real control in a popover — a rating is five glyphs, a vote
 * has two ends, a slider is a track, and none of those survives being collapsed to one press. So
 * the panel has to stay through a DRAG, which is the whole reason it exists; and once the value is
 * written there is nothing left for it to be open for, and a panel still sitting over the row is
 * something the reader has to dismiss before carrying on.
 *
 * Two claims, and the gesture has to be stopped halfway to tell them apart. It used to close on the
 * PRESS: `we-tooltip` dispatches a bubbling, composed `toggle` CustomEvent, the panel's own `toggle`
 * listener caught it, and `newState` on a CustomEvent is undefined — so the value bubble opening
 * over a rating or a slider read as the panel being told it had closed.
 *
 * Only a browser can show either half. The event crossed a shadow boundary to reach a listener
 * bound in another component's template, and the dismissal crosses the same boundary back.
 */
export const name = 'a popover outlasts a drag';
export const scenario = 'signals:vocabulary';
export const widths = [420];

/** The compact row's popovers, in the order it draws them: a rating, a vote, then a slider. */
const TRIGGER = (nth) => `we-popover >> nth=${nth} >> we-button >> nth=0`;

export async function check({ click, count, grab, release }) {
  const problems = [];

  const cases = [
    { name: 'rating', trigger: 0, control: 'we-popover [role="slider"]:visible' },
    { name: 'slider', trigger: 2, control: 'we-popover we-slider:visible' },
  ];

  for (const { name, trigger, control } of cases) {
    await click(TRIGGER(trigger));
    if (!(await count(control))) {
      problems.push(`the ${name} popover did not open`);
      continue;
    }

    await grab(control, 0.2, 0.7);
    const held = await count(control);
    await release();
    const dropped = await count(control);

    if (!held) problems.push(`the ${name} popover closed on the press, before the drag`);
    if (held && dropped) problems.push(`the ${name} popover stayed open after the value was written`);
    // Closed either way by now; anything still open would seat the next case badly.
    if (dropped) await click(TRIGGER(trigger));
  }

  return problems;
}
