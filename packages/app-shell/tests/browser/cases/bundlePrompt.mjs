/**
 * The host's prompt for an app installed from a file says everything a person is agreeing to, and its
 * two buttons do what they say.
 *
 * Each line is a separate consequence — provenance, what it adds, what it can do, modules, the
 * spaces it sets up, how it shows spaces, what will not work — and a prompt that dropped one would read as
 * complete. So each is looked for by its words. Not swept across widths: the harness sizes the box a
 * scenario mounts in, and a modal is sized against the window, so a sweep would measure nothing.
 */
export const name = 'the app install prompt says what it brings, and asks';
export const scenario = 'bundle:prompt';
export const widths = [420];

export async function check({ count, measurePart, click }) {
  const problems = [];
  const says = async (text, what) => {
    if (!(await count(`text=${text}`))) problems.push(`it does not say ${what}`);
  };

  await says('Install Field Guide?', 'what is being installed');
  await says('Nothing attests to who made a file', 'that nothing attests to a file');
  await says('it says it is by Levels Naturalists', 'who the file claims made it');
  await says('Its own app, “Field Guide”', 'what it adds');
  await says('Read and write the content of this space', 'what it will be able to do');
  await says('It turns on', 'which modules it turns on');
  await says('This deployment does not have globe', 'which modules this deployment lacks');
  await says('It adds Species, Sighting and its sections to each space you tick', 'what it adds to a space');
  await says('Somerset Levels', 'the spaces this agent runs');
  await says('This space', 'which space is on screen');
  await says('Already set up', 'which spaces are set up already');
  await says('every space opens in its own template', 'how it shows spaces');
  await says('runtimeStore.trustAgent', 'what will not work');

  const modal = await measurePart('we-modal', 'base');
  if (!modal) problems.push('no prompt was drawn');

  await click('text=Allotment');
  if (!(await count('body[data-bundle-toggled="allotment"]'))) problems.push('ticking a space did not choose it');

  await click('we-button:has-text("Cancel")');
  if (!(await count('body[data-bundle-cancelled]'))) problems.push('Cancel did not cancel');
  await click('we-button:has-text("Install")');
  if (!(await count('body[data-bundle-confirmed]'))) problems.push('Install did not confirm');
  return problems;
}
