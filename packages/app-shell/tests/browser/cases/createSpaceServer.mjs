/**
 * A shared space that syncs through a server asks which one — AD4M's, its staging server, or an
 * address typed in — and an address that is not an http(s) one is refused beside its field rather
 * than handed to `createSpace`.
 *
 * Not swept across widths: a modal is sized against the window, not against the box a scenario
 * mounts in. `WE_BROWSER_SHOTS` photographs each step.
 */
export const name = 'a server-synced space asks which link server, and refuses an address that is not one';
export const scenario = 'space:create-shared';
export const widths = [560];

export async function check({ click, count, type, hover, screenshot }) {
  // The sheet scrolls inside the window: hovering a line of text brings it into view for a shot
  // without putting a control into its hover state.
  const show = (text) => hover(`text=${text}`);
  const problems = [];

  await type('we-input input', 'Garden');
  await click('we-switch');
  await show('How this space syncs');
  await screenshot('create-space-shared');
  if (await count('text=Link server')) problems.push('a peer-to-peer space is asked for a link server');

  await click('we-select:has-text("Peer-to-peer")');
  await click('[role="option"]:has-text("Server")');
  if (!(await count('text=Link server'))) problems.push('a server-synced space is not asked which server');
  if (!(await count('we-select:has-text("link.ad4m.dev")')))
    problems.push('the link server picker does not show the default, link.ad4m.dev');
  await show('Not shown in global discovery');
  await screenshot('create-space-server-default');

  await click('we-select:has-text("link.ad4m.dev")');
  for (const choice of ['link.ad4m.dev', 'link-staging.ad4m.dev', 'Custom…']) {
    if (!(await count(`[role="option"]:has-text("${choice}")`)))
      problems.push(`the server picker does not offer ${choice}`);
  }
  await screenshot('create-space-server-choices');
  await click('[role="option"]:has-text("Custom…")');

  await type('we-input[type="url"] input', 'link.example.org');
  await click('we-button:has-text("Create Space")');
  if (await count('body[data-created]')) problems.push('an address without http(s):// reached createSpace');
  if (!(await count('text=Enter an address starting with https:// or http://')))
    problems.push('a refused address is not explained beside its field');
  await show('Enter an address starting with https:// or http://');
  await screenshot('create-space-server-custom-invalid');

  await type('we-input[type="url"] input', 'https://links.example.org');
  await click('we-button:has-text("Create Space")');
  if (!(await count(`body[data-created='["Qm-server","https://links.example.org"]']`)))
    problems.push('the typed server did not reach createSpace');
  await show('Server address');
  await screenshot('create-space-server-custom');
  return problems;
}
