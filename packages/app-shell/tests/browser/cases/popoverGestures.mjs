/**
 * A compact mark's popover survives the gesture it was opened for.
 *
 * Every mode but the toggle opens its real control in a popover — a rating is five glyphs, a vote
 * has two ends, a slider is a track, and none of those survives being collapsed to one press. So
 * the popover has to outlast a DRAG, which is the whole reason it exists.
 *
 * It did not. Pressing to drag a rating or a slider closed it before the gesture began, and so did
 * hovering the clear button beside them, while pressing a vote arrow or selecting the count was
 * fine. The common thread was a `we-tooltip` opening inside the popover: it dispatches a bubbling,
 * composed `toggle` CustomEvent, the panel's own `toggle` listener caught it, and `newState` on a
 * CustomEvent is undefined — which read as "not open".
 *
 * Only a browser can show this. The event crosses a shadow boundary to reach a listener bound in
 * another component's template, and no schema test sees either side of that.
 */
export const name = 'a popover outlasts a drag';
export const scenario = 'signals:vocabulary';
export const widths = [420];

/** The compact row's popovers, in the order it draws them: a rating, a vote, then a slider. */
const TRIGGER = (nth) => `we-popover >> nth=${nth} >> we-button >> nth=0`;

export async function check({ click, count, drag }) {
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

    await drag(control, 0.2, 0.7);
    if (!(await count(control))) {
      problems.push(`dragging the ${name} closed its popover`);
      // Nothing to close, and the next case needs a clean slate.
      continue;
    }

    /*
      And it is still usable afterwards.

      The failure was sticky: a drag that closed the popover left the control's draft value set,
      because the gesture never finished — so the tooltip stayed open, and from then on merely
      reopening and hovering closed it again. A reader who hit this once could not use that
      reaction again without a reload.
    */
    await drag(control, 0.3, 0.6);
    if (!(await count(control))) problems.push(`the ${name} popover closed on a second drag`);

    await click(TRIGGER(trigger));
  }

  return problems;
}
