/**
 * The transcript's and the Feed's input: a framed field with a send button beside it.
 *
 * The compact composer is an editor with no chrome of its own, so placed bare it was a line of
 * placeholder text floating in the panel with no edge and no way to send but Enter, and then, framed,
 * twice the height it should be. Compact mode draws a field of its own at the control height; this
 * checks the edge is drawn, one line is as tall as the button, and the button sends.
 */
export const name = 'a one-line composer is framed and sends from its button';
export const scenario = 'composer:line';
export const widths = [420];

export async function check({ call, clickAt, key, click, prop, count }) {
  const problems = [];

  const frame = await call('composerFrame');
  if (!frame) return ['no compact composer on the page'];
  if (frame.border !== '1px solid') problems.push(`the box's edge is ${frame.border}, not a field's 1px line`);
  // One line is one control tall: the box and the button beside it are the same height.
  if (frame.height !== frame.button)
    problems.push(`one line is ${frame.height}px tall beside a ${frame.button}px button`);

  if ((await count('button[aria-label="Send it"]')) !== 1) problems.push('no send button beside the composer');

  await clickAt('.we-block-composer-mount .ProseMirror');
  for (const k of ['h', 'i']) await key(k);
  await click('button[aria-label="Send it"]');
  await new Promise((resolve) => setTimeout(resolve, 100));
  if ((await prop('#sends', 'textContent')) !== '1') problems.push('the button did not send the line');
  if ((await prop('#sent', 'textContent')) !== 'hi') problems.push('the button sent something other than the line');
  return problems;
}
