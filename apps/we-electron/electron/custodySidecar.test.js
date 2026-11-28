/**
 * The custody sidecar as the main process runs it: the credential as the first line of its stdin and
 * never in its arguments or environment, answers matched to their requests, and a stop that ends it.
 */
import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { custodyClient, custodySpawn, startCustody, superviseCustody } from './custodySidecar.js';

const here = dirname(fileURLToPath(import.meta.url));
const CREDENTIAL = 'the-custody-credential';

describe('custodySpawn', () => {
  it('passes the credential as the first line of stdin, never as an argument or in the environment', () => {
    const { command, args, env, stdin } = custodySpawn({
      binary: '/opt/we/we-custody',
      executorPort: 12001,
      credential: CREDENTIAL,
      baseEnv: {
        HOME: '/home/someone',
        AD4M_ADMIN_CREDENTIAL: 'the-admin-credential',
        AD4M_CUSTODY_CREDENTIAL: 'inherited',
        AD4M_CUSTODY_CREDENTIAL_FILE: '/tmp/custody',
        WE_EXTERNAL_AD4M_CUSTODY_CREDENTIAL: 'external',
      },
    });
    expect(command).toBe('/opt/we/we-custody');
    expect(args).toEqual(['--executor-port', '12001']);
    expect(args.join(' ')).not.toContain(CREDENTIAL);
    expect(stdin).toBe(`${CREDENTIAL}\n`);
    // Neither credential, and none inherited: an environment is a file the admin credential reads.
    expect(env).toEqual({ HOME: '/home/someone' });
  });

  it('refuses to start without a credential, or with one that is not one line', () => {
    for (const credential of ['', '  ', 'two\nlines']) {
      expect(() => custodySpawn({ binary: 'b', executorPort: 1, credential, baseEnv: {} })).toThrow();
    }
  });
});

/** A child process as far as the client reads one. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.written = [];
  child.stdin.on('data', (chunk) => child.written.push(...chunk.toString().trim().split('\n')));
  return child;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('custodyClient', () => {
  it('matches answers to requests by id, in whatever order they come', async () => {
    const child = fakeChild();
    const client = custodyClient(child);
    const first = client.call('step', { input: { kind: 'wait-claim' } });
    const second = client.call('publicState');
    await flush();
    const [a, b] = child.written.map((l) => JSON.parse(l));
    expect(a).toEqual({ id: 1, method: 'step', params: { input: { kind: 'wait-claim' } } });
    expect(b).toEqual({ id: 2, method: 'publicState', params: {} });
    child.stdout.write(`${JSON.stringify({ id: 2, result: { did: null } })}\n`);
    child.stdout.write(`${JSON.stringify({ id: 1, error: 'no step is open' })}\n`);
    await expect(second).resolves.toEqual({ did: null });
    await expect(first).rejects.toThrow('no step is open');
  });

  it('rejects what is outstanding when the sidecar stops, and every later call', async () => {
    const child = fakeChild();
    const client = custodyClient(child);
    const waiting = client.call('publicState');
    child.emit('exit', 1, null);
    await expect(waiting).rejects.toThrow('the custody service stopped');
    await expect(client.call('publicState')).rejects.toThrow('the custody service stopped');
  });
});

describe('startCustody', () => {
  it('runs the sidecar with the credential on its stdin before any request, and stop ends it', async () => {
    const custody = startCustody({
      binary: join(here, 'fixtures', 'custody-echo.mjs'),
      executorPort: 12001,
      credential: CREDENTIAL,
      baseEnv: { PATH: process.env.PATH, AD4M_CUSTODY_CREDENTIAL: 'inherited', AD4M_ADMIN_CREDENTIAL: 'admin' },
      log: () => {},
    });
    const answer = await custody.call('publicState');
    expect(answer).toEqual({
      method: 'publicState',
      argv: ['--executor-port', '12001'],
      credential: CREDENTIAL,
      envCredential: null,
      admin: null,
    });
    await expect(custody.call('fail')).rejects.toThrow('it failed');
    await custody.stop();
    await expect(custody.call('publicState')).rejects.toThrow('the custody service stopped');
  });
});

describe('superviseCustody', () => {
  /** Sidecars that stop when told to; `crash(i)` stops the i-th as if it had died. */
  function sidecars() {
    const started = [];
    const start = ({ onExit }) => {
      const one = {
        onExit,
        stopped: false,
        stop: async () => ((one.stopped = true), onExit({ code: 0, signal: null })),
      };
      started.push(one);
      return one;
    };
    return { started, start, crash: (i) => started[i].onExit({ code: 101, signal: null }) };
  }

  it('starts a sidecar that stopped on its own again', () => {
    const s = sidecars();
    const supervisor = superviseCustody({ start: s.start, log: () => {} });
    expect(supervisor.current()).toBe(s.started[0]);
    s.crash(0);
    expect(s.started).toHaveLength(2);
    expect(supervisor.current()).toBe(s.started[1]);
  });

  it('leaves it off after too many stops in the window, and counts afresh once the window passes', () => {
    let t = 0;
    const s = sidecars();
    const logged = [];
    const supervisor = superviseCustody({
      start: s.start,
      restarts: 2,
      windowMs: 1000,
      now: () => t,
      log: (m) => logged.push(m),
    });
    s.crash(0);
    s.crash(1);
    s.crash(2);
    expect(s.started).toHaveLength(3);
    expect(supervisor.current()).toBeNull();
    expect(logged.at(-1)).toContain('identity is off');

    const again = sidecars();
    const fresh = superviseCustody({ start: again.start, restarts: 1, windowMs: 1000, now: () => t, log: () => {} });
    again.crash(0);
    t = 5000;
    again.crash(1);
    expect(again.started).toHaveLength(3);
    expect(fresh.current()).toBe(again.started[2]);
  });

  it('starts nothing again once stopped on purpose', async () => {
    const s = sidecars();
    const supervisor = superviseCustody({ start: s.start, log: () => {} });
    await supervisor.stop();
    expect(s.started[0].stopped).toBe(true);
    expect(s.started).toHaveLength(1);
    expect(supervisor.current()).toBeNull();
  });
});
