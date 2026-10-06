/**
 * The visual editor reaches what a template draws in a panel, and nothing of the app's.
 *
 * The overlay used to be one box over the content viewport, and panels paint above the content's
 * whole stacking context — so a press on a panel the template supplied went to the panel, and nothing
 * in it could be selected. The editor now asks where a press landed: inside a surface the host marked
 * as the template's, it selects and the template's own control never hears it; anywhere else, the
 * app's control works as it always did.
 *
 * Real Chrome, because the whole question is which element a press lands on, and jsdom does no
 * hit-testing at all.
 */
export const name = 'the editor selects in a panel, and leaves the app alone';
// Any scenario: the subject is mounted beside it by the probe, not by the schema.
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, moveTo, cursorAt, count, recorded }) {
  await call('editorProbe');
  try {
    return await probe({ clickAt, moveTo, cursorAt, count, recorded });
  } finally {
    await call('editorProbeDispose');
  }
}

async function probe({ clickAt, moveTo, cursorAt, count, recorded }) {
  const problems = [];

  /*
    A click selects and nothing more: a drag starts on a hold or a move, and `clickAt` waits past the
    hold, so a drag under way now is a press whose release the editor never heard. Checked straight
    after each click, since the next press elsewhere would end it and hide it.
  */
  const dragging = async (what) => {
    if (await count('body[style*="grabbing"]')) problems.push(`a click on ${what} picked it up to drag it`);
  };

  await clickAt('#probe-n-panel');
  await dragging("the panel's node");
  let selected = await recorded('__probeSelected');
  let pressed = await recorded('__probePressed');
  if (selected.at(-1) !== 'n-panel')
    problems.push(`a press on the panel's node selected ${selected.at(-1) ?? 'nothing'}`);
  if (pressed.includes('n-panel')) problems.push("the template's control in the panel fired while being selected");

  await clickAt('#probe-n-content');
  await dragging("the content's node");
  selected = await recorded('__probeSelected');
  pressed = await recorded('__probePressed');
  if (selected.at(-1) !== 'n-content')
    problems.push(`a press on the content's node selected ${selected.at(-1) ?? 'nothing'}`);
  if (pressed.includes('n-content')) problems.push("the template's control in the content fired while being selected");

  const before = selected.length;
  await clickAt('#probe-titlebar');
  selected = await recorded('__probeSelected');
  pressed = await recorded('__probePressed');
  if (!pressed.includes('titlebar')) problems.push("the panel's titlebar, which is the app's, did not hear its press");
  if (selected.length !== before) problems.push('a press on the titlebar changed the selection');

  // The template's contents take no pointer while edited: no hover reaches them, and one cursor.
  await moveTo('#probe-n-panel');
  await moveTo('#probe-n-content');
  const entered = await recorded('__probeEntered');
  if (entered.length) problems.push(`hovering reached the template's own controls: ${entered.join(', ')}`);
  for (const id of ['#probe-n-panel', '#probe-n-content']) {
    const cursor = await cursorAt(id);
    if (cursor !== 'default' && cursor !== 'auto') problems.push(`the cursor over ${id} is ${cursor}`);
  }

  return problems;
}
