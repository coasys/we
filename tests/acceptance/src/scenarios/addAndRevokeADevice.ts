/**
 * The person adds a server they run to their identity, by an offer link from the desktop, and then
 * revokes it.
 */
import { createAccount, identityScreen, makeIdentity, openSettings, settingsPage } from '../flows/desktop.ts';
import { check, defineScenario } from '../scenario.ts';
import type { Proc } from '../world/proc.ts';

interface Status {
  did?: string;
  keyId?: string;
  revoked?: boolean;
}

interface KeyLog {
  events: { op: string }[];
}

export default defineScenario({
  meta: {
    id: 'add-and-revoke-a-device',
    title: 'Desktop: add a server the person runs by an offer link, then revoke it',
    proves: [
      'A server started for the person’s identity joins it by the offer link the desktop shows, after both show the same match code and the person confirms.',
      'The device list and the key log show the new device, and then its revocation.',
      'The master key is unlocked with the passphrase for each change; a wrong one changes nothing.',
      'The offer link, the passphrase and the words appear in no log and no stored file.',
    ],
    platforms: ['desktop-linux'],
    worlds: ['local'],
    cadence: ['nightly'],
  },
  state: { state: 'on' },
  pendingSteps: [
    {
      step: 'A first link to that server from another identity is refused',
      reason: 'needs a second identity in the world, which the scenarios with two people bring',
    },
    {
      step: 'A server with no address shows its device string and QR code, and a phone scans it',
      reason: 'needs the phone app and the pre-join inbox, which come with a later change',
    },
    {
      step: 'The link runs over HTTPS to the server’s own address',
      reason: 'needs the local edge with its test certificate authority',
    },
  ],
  async run(ctx) {
    const app = await ctx.launchDesktop({ name: 'a' });
    ctx.worldBuilt();

    await ctx.step(
      'A fresh app: an account on this computer',
      ['a first run starts with an empty data folder'],
      async () => {
        await createAccount(app, ctx, 'Ada Acceptance');
      },
    );
    const { did, passphrase } = await makeIdentity(app, ctx, ctx.step);

    // The person starts a server of their own, named as theirs: `ad4m-executor init --operator`.
    const server = await ctx.world.startExecutor({ name: 'server', operator: did });

    let link = '';
    await ctx.step(
      'Settings → Devices → Add a device: a wrong passphrase is refused, the right one shows an offer link',
      ['the master key unlocks with the passphrase only', 'the offer is a link the person copies to the device'],
      async () => {
        await openSettings(app, 'Devices');
        await settingsPage(app, 'Devices', 'Add a device');
        await app.press('main', 'Add a device');
        await app.waitForWindow('identity', true);
        await identityScreen(app, 'Unlock your master key');
        await app.type('identity', 'Passphrase', 'not the passphrase at all');
        await app.press('identity', 'Unlock');
        await app.waitFor(
          'identity',
          `return document.querySelector('.error')?.textContent || '';`,
          60_000,
          'the refusal of a wrong passphrase',
        );
        await app.type('identity', 'Passphrase', passphrase);
        await app.press('identity', 'Unlock');
        await identityScreen(app, 'Send this link to your device');
        link = await app.eval<string>('identity', `return document.querySelector('.link')?.textContent ?? '';`);
        check(link.startsWith('https://coasys.id/o#coasys:offer:1:'), `the offer link is ${link.slice(0, 40)}…`);
        ctx.secrets.add('offer-secret', 'the offer link', link);
        ctx.secrets.add('offer-secret', 'the offer', link.slice(link.indexOf('#') + 1));
      },
      { shows: 'the offer link' },
    );

    let code = '';
    let claim: Proc | undefined;
    await ctx.step(
      'The server claims the offer; the server and the desktop show the same match code',
      ['both sides show the same match code before anything is added'],
      async () => {
        // On the server, the person gives the link to `ad4m-executor claim`.
        claim = ctx.world.spawn(
          'claim',
          ctx.world.checkout.executor,
          ['--executor-url', server.url, 'claim', link, '--hint', 'server b'],
          {
            cwd: ctx.world.checkout.testsJs,
          },
        );
        const line = await claim.waitFor((l) => l.startsWith('Match code: '), 120_000, 'the match code');
        code = line.slice('Match code: '.length).trim();
        const screen = await identityScreen(app, 'Add server b?');
        const shown = await app.eval<string>('identity', `return document.querySelector('.code')?.textContent ?? '';`);
        check(shown === code, `the desktop shows ${shown}, the server ${code}`);
        check(
          screen.includes('Check that server b shows the same code.'),
          'the match screen does not ask the person to compare the codes',
        );
      },
    );

    await ctx.step(
      'The person confirms: the server is d2 of the identity',
      ['the device joins only after the person confirms'],
      async () => {
        await app.press('identity', 'Add it');
        await identityScreen(app, 'Device added');
        await app.press('identity', 'Done');
        await app.waitForWindow('identity', false);
        await claim!.waitFor((l) => l.startsWith(`Joined ${did} as d2`), 120_000, 'the server joining the identity');
        const status = await server.call<Status>('identity.status');
        check(status.did === did && status.keyId === 'd2', `the server says ${JSON.stringify(status)}`);
      },
    );

    await ctx.step(
      'Settings → Devices lists the server as d2, valid, and offers to revoke it',
      ['the person sees the new device'],
      async () => {
        await openSettings(app, 'Devices');
        const page = await settingsPage(app, 'Devices', 'd2');
        check(/Device d2\nd2 · added at #1\nValid/.test(page), `the device list says:\n${page}`);
      },
    );

    await ctx.step(
      'Revoke d2: a wrong passphrase is refused, the right one revokes it',
      ['the master key unlocks with the passphrase only', 'a revoked key stops speaking for the person'],
      async () => {
        await app.press('main', 'Revoke');
        await app.waitForWindow('identity', true);
        await identityScreen(app, 'Revoke the key d2?');
        await app.type('identity', 'Passphrase', 'not the passphrase at all');
        await app.press('identity', 'Revoke');
        await app.waitFor(
          'identity',
          `return document.querySelector('.error')?.textContent || '';`,
          60_000,
          'the refusal of a wrong passphrase',
        );
        await app.type('identity', 'Passphrase', passphrase);
        await app.press('identity', 'Revoke');
        await identityScreen(app, 'd2 revoked');
        await app.press('identity', 'Done');
        await app.waitForWindow('identity', false);
      },
    );

    await ctx.step(
      'The device list shows d2 revoked; the key log has the add and the revoke',
      ['the person sees the revocation', 'the key log records the add and the revoke'],
      async () => {
        const page = await settingsPage(app, 'Devices', 'Revoked');
        check(/Device d2\n[^\n]*\nRevoked at #2/.test(page), `the device list says:\n${page}`);
        const log = await server.call<KeyLog>('identity.log', { did, from: 0, fresh: true });
        const ops = log.events.map((e) => e.op);
        check(ops.join() === 'incept,add,revoke', `the key log holds ${ops.join(', ')}`);
      },
    );
  },
});
