/**
 * `pnpm --filter @we/acceptance explore`: a local world with the desktop app in it, kept running,
 * for writing a scenario. Reads one command per line on standard input:
 *
 * - `main <script>` or `identity <script>`: runs a script body in that window, with the person
 *   helpers as `h` (`return h.inventory()`), and prints what it answers.
 * - `text main`, `text identity`: the text on screen.
 * - `state`: the open windows and the custody service's public state.
 * - `shot <file.png>`: a screenshot of the display.
 * - `quit`: stops the app and the world.
 *
 * It runs in a D-Bus session of its own, as the scenarios do.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { DesktopApp, type Vault, type WindowLabel } from './drivers/desktop.ts';
import { Display } from './drivers/display.ts';
import { inSession } from './session.ts';
import { resolveCheckout } from './world/checkout.ts';
import { LocalWorld } from './world/local.ts';

async function main() {
  if (!(await inSession())) return;
  const vault = (process.argv.includes('--os-vault') ? 'os' : 'memory') as Vault;
  const world = await LocalWorld.start(resolveCheckout());
  const display = await Display.start(join(world.dir, 'display'), world.logs);
  console.log(`world ${world.dir} · display ${display.name} · store ${world.storeUrl}`);
  try {
    const app = await DesktopApp.launch(world, display, { name: 'explore', vault });
    console.log('ready');
    await serve(app, display);
    await app.stop();
  } finally {
    await world.stop();
    await display.stop();
  }
}

async function serve(app: DesktopApp, display: Display) {
  for await (const line of createInterface({ input: process.stdin })) {
    const [command, ...rest] = line.trim().split(' ');
    const arg = rest.join(' ');
    try {
      if (command === 'quit') break;
      else if (command === 'main' || command === 'identity')
        console.log(JSON.stringify(await app.eval(command, arg), null, 2));
      else if (command === 'text') console.log(await app.text(arg as WindowLabel));
      else if (command === 'state') console.log(JSON.stringify(await app.state(), null, 2));
      else if (command === 'shot') writeFileSync(arg, display.screenshot());
      else if (command) console.log(`unknown command ${command}`);
    } catch (error) {
      console.log(`error: ${error instanceof Error ? error.message : error}`);
    }
    console.log('--');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
