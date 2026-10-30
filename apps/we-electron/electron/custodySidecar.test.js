/**
 * The custody sidecar as the main process runs it: the credential in its environment and never in
 * its arguments, answers matched to their requests, and a stop that ends it.
 */
import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { custodyClient, custodySpawn, startCustody } from './custodySidecar.js';

const here = dirname(fileURLToPath(import.meta.url));
const CREDENTIAL = 'the-admin-credential';

describe('custodySpawn', () => {
  it('passes the credential in the environment and never as an argument', () => {
    const { command, args, env } = custodySpawn({
      binary: '/opt/we/we-custody',
      executorPort: 12001,
      credential: CREDENTIAL,
      baseEnv: { HOME: '/home/someone' },
    });
    expect(command).toBe('/opt/we/we-custody');
    expect(args).toEqual(['--executor-port', '12001']);
    expect(args.join(' ')).not.toContain(CREDENTIAL);
    expect(env).toEqual({ HOME: '/home/someone', AD4M_ADMIN_CREDENTIAL: CREDENTIAL });
  });

  it('refuses to start without a credential', () => {
    expect(() => custodySpawn({ binary: 'b', executorPort: 1, credential: '', baseEnv: {} })).toThrow();
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
  it('runs the sidecar with the credential in its environment, and stop ends it', async () => {
    const custody = startCustody({
      binary: join(here, 'fixtures', 'custody-echo.mjs'),
      executorPort: 12001,
      credential: CREDENTIAL,
      baseEnv: { PATH: process.env.PATH },
      log: () => {},
    });
    const answer = await custody.call('publicState');
    expect(answer).toEqual({ method: 'publicState', argv: ['--executor-port', '12001'], credential: CREDENTIAL });
    await expect(custody.call('fail')).rejects.toThrow('it failed');
    await custody.stop();
    await expect(custody.call('publicState')).rejects.toThrow('the custody service stopped');
  });
});
