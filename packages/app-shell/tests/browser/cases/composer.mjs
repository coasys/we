/**
 * The reply composer at the foot of a thread, in a panel the width of a real inspector.
 *
 * It is inline rather than behind a modal, which buys the thing it costs: a modal resets by
 * unmounting and an inline editor does not, and a modal gets the whole window where this gets
 * whatever is left of a docked panel after the thread's own gutters. So the two questions worth
 * asking automatically are whether it fits and whether it can be posted empty.
 */
export const name = 'reply composer';
export const scenario = 'discussion:thread';
export const widths = [280, 420];

export async function check({ measure, measureAll, focused }, width) {
  const problems = [];

  const mount = await measure('.we-block-composer-mount');
  if (!mount) return ['no inline composer at the foot of the thread'];

  // Inside the panel. A composer that overflows takes the whole page sideways with it, and the
  // inspector is the narrowest surface the thread is ever drawn in.
  if (mount.x < 0 || mount.x + mount.w > width) {
    problems.push(`the composer spans ${mount.x}..${mount.x + mount.w} in a ${width}px panel`);
  }
  // Room to write in. Below this it is a box you cannot read your own sentence in.
  if (mount.w < 160) problems.push(`the composer is ${mount.w}px wide — too narrow to write in`);

  /*
    Nothing to post yet, so Reply refuses.

    Present and disabled rather than absent until you type: a button that appears on the first
    keystroke moves everything under it, in a panel that is usually already scrolled, and cannot be
    found by somebody looking for how to send.
  */
  const send = (await measureAll('we-button')).filter((b) => b.text === 'Reply').at(-1);
  if (!send) problems.push('no Reply button under the composer');
  else if (!send.disabled) problems.push('Reply is offered on an empty composer');

  /*
    No block gutter.

    `handles: false` is what makes this read as an input rather than an embedded editor: the strip
    is 50px, which in a 280px panel is most of what there is to see. The capability is not gone —
    `/` still reaches every block type — so this asserts the chrome is absent, not the feature.
  */
  const handles = await measureAll('.we-block-handle');
  if (handles.length) problems.push(`${handles.length} block handle(s) beside a reply composer`);

  /*
    And it has not taken the cursor.

    This composer mounts whenever the thread does — which on a canvas is whenever a card is
    selected — so autofocus put a blinking cursor in the reply box a beat after the click, while the
    conversation above it was still arriving. A modal keeps its autofocus: it is on screen because
    somebody asked for it. Asserted after the mount has settled, since the focus it used to take
    arrived a frame late, which is exactly what made it read as the app starting to type.
  */
  const holder = await focused();
  if (holder.includes('composer') || holder.includes('ProseMirror')) {
    problems.push(`the reply composer took the cursor on mount (${holder})`);
  }

  return problems;
}
