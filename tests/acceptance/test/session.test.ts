import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startAppBus } from '../src/session.ts';
import { groupAlive, Proc } from '../src/world/proc.ts';

const hasDbus = spawnSync('dbus-daemon', ['--version']).status === 0;

/** Asks a bus a question of the bus itself, and answers its reply, or null when it does not answer. */
function ask(address: string, method: string, ...args: string[]): string | null {
  const reply = spawnSync(
    'dbus-send',
    [
      `--bus=${address}`,
      '--print-reply',
      '--dest=org.freedesktop.DBus',
      '/org/freedesktop/DBus',
      `org.freedesktop.DBus.${method}`,
      ...args,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  return reply.status === 0 ? reply.stdout : null;
}

describe.skipIf(!hasDbus)('an app’s own session bus', () => {
  const dirs: string[] = [];
  const procs: Proc[] = [];
  afterEach(async () => {
    await Promise.all(procs.splice(0).map((p) => p.stop()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const start = (name: string) => {
    const runtime = mkdtempSync(join(tmpdir(), `we-acceptance-bus-${name}-`));
    dirs.push(runtime);
    return startAppBus(
      (label, command, args, options) => {
        const proc = new Proc(label, command, args, { ...options, log: join(runtime, `${label}.log`) });
        procs.push(proc);
        return proc;
      },
      `dbus-${name}`,
      runtime,
      { ...process.env, XDG_RUNTIME_DIR: runtime },
    );
  };

  it('listens in the app’s runtime folder, apart from every other app’s', async () => {
    const [a, b] = await Promise.all([start('a'), start('b')]);
    expect(a.address).toMatch(/^unix:path=.*we-acceptance-bus-a-[^/]+\/bus/);
    expect(a.address).not.toBe(b.address);
    const idA = ask(a.address, 'GetId');
    const idB = ask(b.address, 'GetId');
    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
    expect(idA).not.toBe(idB);
    // What one app's bus started is not on the next one's: nobody owns the Secret Service there.
    expect(ask(b.address, 'NameHasOwner', 'string:org.freedesktop.secrets')).toContain('boolean false');
  });

  it('is gone once it is stopped', async () => {
    const bus = await start('c');
    await bus.proc.stop();
    expect(groupAlive(bus.proc.pid!)).toBe(false);
    expect(ask(bus.address, 'GetId')).toBeNull();
  });
});
