/**
 * A node drawn many times is selected where it was pressed, and its other instances are shown.
 *
 * Every comment's avatar is one node, and every instance carries its id. Asking for "the element with
 * this id" answered with the last one drawn, so selecting the third comment's avatar ringed the last
 * comment's. And a selection made for somebody — copying a node inside a part selects the copy —
 * had no press at all to go by.
 */
export const name = 'a node drawn many times is ringed where it was pressed';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, measure, count }) {
  await call('editorProbe');
  try {
    const problems = [];
    const ringAt = async (sel) => {
      const ring = await measure('[data-we-ring="selected"]');
      const target = await measure(sel);
      return ring && target && Math.abs(ring.x - target.x) < 3 && Math.abs(ring.y - target.y) < 3;
    };

    // A list's first press selects the list; the second, the pressed row's node.
    await clickAt('#probe-n-item-1');
    await clickAt('#probe-n-item-1');
    if (!(await ringAt('#probe-n-item-1'))) problems.push('the pressed instance is not the one ringed');
    const siblings = await count('[data-we-ring="instance"]');
    if (siblings !== 2) problems.push(`the other instances are not outlined (${siblings} of 2)`);

    // Straight in with the modifier, to another row.
    await clickAt('#probe-n-item-0', { hold: 'Control' });
    if (!(await ringAt('#probe-n-item-0'))) problems.push('a press with the modifier ringed another instance');

    // Selected for somebody — a copy drawing the same rows — keeps the row that was pressed.
    await call('editorProbeSelect', 'n-copy');
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!(await ringAt('#probe-n-copy-0'))) problems.push('a selection made for somebody did not keep the pressed row');
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
