/**
 * The one-line composer: Enter sends, Shift+Enter breaks the line inside the same block, and it
 * empties itself once it has sent.
 *
 * Keys can only be checked by pressing them in a real editor — jsdom has no ProseMirror view to type
 * into — and the failure is quiet either way: an Enter that splits a block sends nothing, and a
 * Shift+Enter that sends puts half a sentence into the transcript.
 */
export const name = 'a one-line composer sends on Enter and keeps Shift+Enter in the line';
export const scenario = 'composer:compact';
export const widths = [420];

export async function check({ clickAt, key, prop }) {
  const problems = [];
  await clickAt('.we-block-composer-mount .ProseMirror');
  for (const k of ['h', 'i']) await key(k);
  await key('Shift+Enter');
  for (const k of ['y', 'o']) await key(k);

  if ((await prop('#sends', 'textContent')) !== '0') problems.push('Shift+Enter sent the line');

  await key('Enter');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const sent = await prop('#sent', 'textContent');
  if ((await prop('#sends', 'textContent')) !== '1') problems.push('Enter did not send the line, or sent it twice');
  if (sent !== 'hi\nyo') problems.push(`sent ${JSON.stringify(sent)} rather than one line holding a break`);

  const left = await prop('.we-block-composer-mount .ProseMirror', 'textContent');
  if (left) problems.push(`the composer still holds ${JSON.stringify(left)} after sending`);

  // An empty line is not a message.
  await key('Enter');
  if ((await prop('#sends', 'textContent')) !== '1') problems.push('Enter in an empty composer sent something');
  return problems;
}
