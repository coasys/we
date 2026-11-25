/**
 * A message sent with two files, in a call's chat — the same line as in the space's Feed.
 *
 * - The words of the message are drawn, and the line with no files beside it.
 * - Each file is named and sized under the words, with a button to save it.
 * - The line with no files offers no file to save.
 */
export const name = 'a message with files in the call chat';
export const scenario = 'feed:call-attachments';
export const widths = [420];

/** The checks both cases make, and the photograph each takes under its own label. */
export async function checkAttachments({ evaluate, measureText, screenshot }, label) {
  const problems = [];
  for (const words of ['The plan and the site map, for Friday.', 'Can somebody send the plan?'])
    if (!(await measureText(words))) problems.push(`no "${words}" line`);
  for (const [file, size] of [
    ['venue-plan.pdf', '2.4 MB'],
    ['site-map.png', '305 KB'],
  ]) {
    if (!(await measureText(file))) problems.push(`the file ${file} is not named`);
    if (!(await measureText(size))) problems.push(`the file ${file} has no size (${size})`);
  }
  // Properties, not attributes: the renderer sets a custom element's props as properties.
  const saves = await evaluate(
    () => [...document.querySelectorAll('we-button')].filter((b) => b.label === 'Save file').length,
  );
  if (saves !== 2) problems.push(`${saves} Save file buttons, where the message holds two stored files`);
  await screenshot?.(label);
  return problems;
}

export async function check(page) {
  return checkAttachments(page, 'call-chat-attachments');
}
