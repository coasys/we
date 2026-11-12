/**
 * V1 — Space. Alice makes a shared space from the Coasys starter; Bob opens her invite link and joins.
 */
import assert from 'node:assert/strict';

import { createSpace } from '../space.mjs';
import { until, vertical, world } from './context.mjs';
import { shaclNames, spacePerspective } from './dna.mjs';
import { joinButton, openSpaceSettings, treeRow } from './steps.mjs';

const SPACE = 'Coasys team';

vertical('V1 space: create, invite, join', (v) => {
  let alice, bob, shared, perspective;

  v.step('Alice creates a shared space from the starter', async () => {
    alice = await v.person('Alice');
    shared = await createSpace(alice.page, alice.account, SPACE);
    assert.match(shared, /^neighbourhood:\/\//, 'the space is a neighbourhood');
    perspective = await spacePerspective(alice.client, shared);
  });

  v.step('the empty space shows its starting state and its tree', async () => {
    const { page } = alice;
    await page.getByText('Feed', { exact: true }).first().waitFor({ timeout: 120_000 });
    await page.getByText('A space starts with a conversation').first().waitFor();
    await page.getByText('Nothing said here yet.', { exact: false }).first().waitFor();
    for (const row of [/^Feed/, /^Calls/, /^Workflows/, /^People 1/, /^Social DNA \d+/]) {
      await treeRow(page, row).first().waitFor({ timeout: 30_000 });
    }
    await page.getByRole('button', { name: 'Send to the space' }).waitFor();
  });

  v.step('the starter records exist in the space', async () => {
    const names = await until(
      () => shaclNames(perspective),
      (n) => n.includes('TaskBlock'),
      {
        timeout: 120_000,
        what: 'the starter SHACL shapes',
      },
    );
    for (const shape of ['TaskBlock', 'CollectionBlock', 'TextBlock', 'EventBlock']) {
      assert.ok(names.includes(shape), `${shape} is a shape of the space (has: ${names.join(', ')})`);
    }
    await alice.page.goto(`${(await world()).app.url}/space/${shared.replace('neighbourhood://', '')}/dna`);
    for (const row of ['To do', 'Doing', 'Done']) {
      await alice.page.getByRole('button', { name: row, exact: true }).first().waitFor({ timeout: 60_000 });
    }
    await alice.page.getByRole('button', { name: /^Task Something to do/ }).waitFor();
  });

  v.step('Space settings show the invite link', async () => {
    const { page } = alice;
    await openSpaceSettings(page, 'About');
    await page.getByText('Anyone with this link can open the space and choose to join it.').waitFor();
    await page
      .getByText(`/space/${shared.replace('neighbourhood://', '')}`)
      .first()
      .waitFor();
  });

  v.step('Bob opens the invite link and joins', async () => {
    bob = await v.person('Bob');
    const { app } = await world();
    await bob.page.goto(`${app.url}/space/${shared.replace('neighbourhood://', '')}`);
    await joinButton(bob.page).click({ timeout: 120_000 });
    await spacePerspective(bob.client, shared);
    await bob.page.getByText('Feed', { exact: true }).first().waitFor({ timeout: 120_000 });
  });

  v.step('both see two members', async () => {
    for (const who of [alice, bob]) {
      const { app } = await world();
      await who.page.goto(`${app.url}/space/${shared.replace('neighbourhood://', '')}/people`);
      await treeRow(who.page, /^People 2/).waitFor({ timeout: 180_000 });
      for (const name of ['Alice', 'Bob']) {
        await who.page
          .getByRole('button', { name: new RegExp(`${name}$`) })
          .first()
          .waitFor({ timeout: 120_000 });
      }
    }
    const others = await until(
      () => alice.client.neighbourhood.otherAgents(perspective.uuid),
      (dids) => dids.includes(bob.did),
      { timeout: 120_000, what: "Bob among the space's other agents" },
    );
    assert.ok(others.includes(bob.did));
  });

  v.todo('"+ Invite" in the tree: invite people from the space tree');
  v.todo('the agent badge: an agent shows as a member of the space, marked as an agent');
});
