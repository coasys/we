/**
 * A fresh desktop app makes the person's identity at first run, and the person sees its key log and
 * its devices. Twice: with the custody items in memory, and with the session's own Secret Service,
 * where a release build on Linux keeps them.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Vault } from '../drivers/desktop.ts';
import { createAccount, makeIdentity, openSettings, settingsPage } from '../flows/desktop.ts';
import { check, defineScenario } from '../scenario.ts';

const files = (dir: string) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

const scenario = (vault: Vault) =>
  defineScenario({
    meta: {
      id: vault === 'os' ? 'make-an-identity-os-vault' : 'make-an-identity',
      title:
        vault === 'os'
          ? 'Desktop first run with the session’s Secret Service as the vault'
          : 'Desktop first run: "Make my identity here", then the key log and the devices',
      proves: [
        'The first run of the desktop app offers to make an identity on this computer.',
        'The 12 words show in the identity window only; two of them are checked before the identity exists.',
        'The master key rests on this computer behind a passphrase; no secret reaches the main window.',
        'Settings shows the key log and this computer as the identity’s first device.',
        ...(vault === 'os' ? ['On Linux the custody item rests in the Secret Service, not in a file.'] : []),
      ],
      platforms: ['desktop-linux'],
      worlds: ['local'],
      cadence: ['nightly'],
    },
    state: { state: 'on' },
    pendingSteps: [
      {
        step: 'Three wrong answers in a row return to the words',
        reason: 'the identity window does not count wrong answers yet',
      },
      {
        step: 'The words screen turns screen capture off',
        reason: 'the desktop shell does not block screen capture yet',
      },
      {
        step: 'The device page shows the line on how its data rests on disk',
        reason: 'storage encryption and its device lines come with a later change',
      },
      {
        step: 'The first space, with the default choices, opens its template',
        reason: 'the new-space flow on an identity comes with a later change',
      },
      {
        step: 'A community host checks a link signed by this computer and maps it to the person',
        reason: 'needs community hosts in the local world, which come with the hosting scenarios',
      },
    ],
    async run(ctx) {
      const app = await ctx.launchDesktop({ name: 'a', vault });
      ctx.worldBuilt();

      await ctx.step(
        'A fresh app asks for an account on this computer',
        ['a first run starts with an empty data folder'],
        async () => {
          await createAccount(app, ctx, 'Ada Acceptance');
        },
      );

      const { did } = await makeIdentity(app, ctx, ctx.step);

      await ctx.step(
        'The app now speaks for the identity, and the first-run screen is gone',
        ['the identity is this computer’s after the identity window closes'],
        async () => {
          const { custody } = await app.state();
          check(custody.did === did, `the custody service says ${JSON.stringify(custody.did)}, not ${did}`);
          await app.waitFor(
            'main',
            `return !h.text().includes('Welcome to Coasys');`,
            60_000,
            'the first-run screen to go',
          );
        },
      );

      await ctx.step(
        'Settings → Devices lists this computer as d1, valid',
        ['the person sees this computer as the identity’s first device'],
        async () => {
          await openSettings(app, 'Devices');
          const page = await settingsPage(app, 'Devices', 'd1 · added at #0');
          check(/This computer\nd1 · added at #0\nValid/.test(page), `the device list says:\n${page}`);
          check(page.includes('Add a device'), 'this computer keeps the master key, so it offers "Add a device"');
        },
      );

      await ctx.step(
        'Settings → Security → Key log shows one event: the identity was made',
        ['the person sees the key log'],
        async () => {
          await app.press('main', 'Security');
          const security = await settingsPage(app, 'Security', 'Key log');
          check(security.includes('1 event'), `the Security page does not count one event:\n${security}`);
          await app.press('main', 'See the log');
          const log = await settingsPage(app, 'Key log', 'Created your identity');
          check(/#0\nCreated your identity\nwith d1 · This computer/.test(log), `the key log says:\n${log}`);
          check(
            log.includes('The shared store signed this log up to #0.'),
            'the key log does not say the store signed it',
          );
        },
      );

      await ctx.step(
        'Only the identity window ran the identity flow',
        ['no word, passphrase or key reaches the main window'],
        async () => {
          const calls = await app.ipcLog();
          const flow = calls.filter((c) => c.command.startsWith('identity_flow_'));
          check(flow.length > 0, 'the IPC log holds no identity flow call');
          const wrong = flow.filter((c) => c.window !== 'identity');
          check(!wrong.length, `the ${wrong[0]?.window} window called ${wrong[0]?.command}`);
          const main = calls.filter((c) => c.window === 'main').map((c) => c.command);
          check(main.includes('identity_open'), 'the main window did not open the identity window');
        },
      );

      if (vault === 'os') {
        await ctx.step(
          'The custody item rests in the Secret Service, not in a file',
          ['on Linux the master key rests in the Secret Service when there is one'],
          async () => {
            const custody = join(app.home, '.local/share/coasys/custody');
            const sealed = files(custody).filter((f) => f.endsWith('.bin'));
            check(!sealed.length, `the custody item rests in a file: ${sealed.join(', ')}`);
            const keyrings = files(join(app.home, '.local/share/keyrings')).filter((f) => f.endsWith('.keyring'));
            check(keyrings.length > 0, 'the session’s keyring holds no collection');
          },
        );
      }
    },
  });

export default scenario('memory');
export const withOsVault = scenario('os');
