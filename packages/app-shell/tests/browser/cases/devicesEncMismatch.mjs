/**
 * Settings → Devices on a computer that lost the key that opens what is sent to it (`encMismatch`).
 *
 * The custody service knows, and before this the page did not: it offered "Accept master key" or "Ask
 * for master key", which then failed in the identity window, and Rename, which writes a record this
 * computer cannot open. The page now says what happened and what to do, and offers none of those.
 */
export const name = 'Devices warns a computer that lost its enc key, and offers no step that would fail';
export const scenario = 'settings:devices-enc-mismatch';
export const widths = [420, 1024];

export async function check({ count, screenshot }) {
  const problems = [];
  const warning =
    'This computer has lost the key that opens your master key and your device list, so it can no longer receive either.';
  if (!(await count(`we-alert:has-text("${warning}")`))) problems.push('the warning is not drawn');
  if (!(await count('text=revoke this computer, then link it again')))
    problems.push('the warning does not say what to do');
  for (const step of ['Accept master key', 'Ask for master key', 'Rename']) {
    if (await count(`we-button:has-text("${step}")`)) problems.push(`it offers "${step}", which cannot work here`);
  }
  if (!(await count('text=Unnamed device'))) problems.push('the key log’s devices are not listed');
  if (await count('text=Has master key')) problems.push('it claims a device has the master key, which it cannot know');
  await screenshot?.('devices-enc-mismatch');
  return problems;
}
