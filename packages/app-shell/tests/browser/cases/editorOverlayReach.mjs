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

export async function check({ call, click, recorded }) {
  await call('editorProbe');
  try {
    return await probe({ click, recorded });
  } finally {
    await call('editorProbeDispose');
  }
}

async function probe({ click, recorded }) {
  const problems = [];

  await click('#probe-n-panel');
  let selected = await recorded('__probeSelected');
  let pressed = await recorded('__probePressed');
  if (selected.at(-1) !== 'n-panel')
    problems.push(`a press on the panel's node selected ${selected.at(-1) ?? 'nothing'}`);
  if (pressed.includes('n-panel')) problems.push("the template's control in the panel fired while being selected");

  await click('#probe-n-content');
  selected = await recorded('__probeSelected');
  pressed = await recorded('__probePressed');
  if (selected.at(-1) !== 'n-content')
    problems.push(`a press on the content's node selected ${selected.at(-1) ?? 'nothing'}`);
  if (pressed.includes('n-content')) problems.push("the template's control in the content fired while being selected");

  const before = selected.length;
  await click('#probe-titlebar');
  selected = await recorded('__probeSelected');
  pressed = await recorded('__probePressed');
  if (!pressed.includes('titlebar')) problems.push("the panel's titlebar, which is the app's, did not hear its press");
  if (selected.length !== before) problems.push('a press on the titlebar changed the selection');

  return problems;
}
