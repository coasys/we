/**
 * The supervisor's main agent (`mainAgent.js`): made on a first start with a passphrase the keyring
 * keeps, unlocked with it on every start after, and a keyring that refuses said in words for the
 * window, with no path and no secret in them.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureMainAgent, executorRpc, KEYRING_WORDS, walletKeyring } from './mainAgent.js';

const SECRET = 'kept-passphrase-0123456789abcdefghijklmnopqrstuvwxyz';

/** An executor's agent as `agent.status` answers it, and the calls made to it. */
function fakeExecutor({ initialized = false, unlocked = false, passphrase = null, refuseUnlock = false } = {}) {
  const agent = { initialized, unlocked, passphrase };
  const calls = [];
  const status = () => ({
    did: agent.initialized ? 'did:key:z6Mk-test' : null,
    isInitialized: agent.initialized,
    isUnlocked: agent.unlocked,
    error: null,
  });
  return {
    agent,
    calls,
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method === 'agent.status') return status();
      if (method === 'agent.generate') {
        Object.assign(agent, { initialized: true, unlocked: true, passphrase: params.passphrase });
        return status();
      }
      if (method === 'agent.unlock') {
        if (refuseUnlock || params.passphrase !== agent.passphrase) throw new Error('Failed to decrypt agent keys');
        agent.unlocked = true;
        return status();
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

/** A keyring as `walletKeyring` answers: `{passphrase}`, `{none}` or `{refused, reason}`. */
function fakeKeyring({ kept = null, refused = null } = {}) {
  const asked = [];
  const answer = (mode) => {
    asked.push(mode);
    if (refused) return { refused, reason: 'org.freedesktop.secrets at unix:path=/run/user/1000/bus' };
    if (kept) return { passphrase: kept };
    if (mode === 'read') return { none: true };
    kept = SECRET;
    return { passphrase: kept };
  };
  return { asked, read: async () => answer('read'), make: async () => answer('make') };
}

describe('ensureMainAgent', () => {
  it('on a first start keeps a new passphrase, then makes the agent with it', async () => {
    const executor = fakeExecutor();
    const keyring = fakeKeyring();
    expect(await ensureMainAgent({ call: executor.call, keyring })).toBe('unlocked');
    expect(keyring.asked).toEqual(['make']);
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status', 'agent.generate']);
    expect(executor.calls[1].params).toEqual({ passphrase: SECRET });
  });

  it('on a later start reads the kept passphrase and unlocks the agent with it', async () => {
    const executor = fakeExecutor({ initialized: true, passphrase: SECRET });
    const keyring = fakeKeyring({ kept: SECRET });
    expect(await ensureMainAgent({ call: executor.call, keyring })).toBe('unlocked');
    expect(keyring.asked).toEqual(['read']);
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status', 'agent.unlock']);
    expect(executor.calls[1].params).toEqual({ passphrase: SECRET, holochain: true });
    expect(executor.agent.unlocked).toBe(true);
  });

  it('leaves an agent that is already unlocked alone, and asks the keyring nothing', async () => {
    const executor = fakeExecutor({ initialized: true, unlocked: true, passphrase: 'x' });
    const keyring = fakeKeyring();
    expect(await ensureMainAgent({ call: executor.call, keyring })).toBe('unlocked');
    expect(keyring.asked).toEqual([]);
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status']);
  });

  it('leaves an agent made with a WE password (nothing kept) locked, for sign-in', async () => {
    const executor = fakeExecutor({ initialized: true, passphrase: 'the person’s own' });
    const keyring = fakeKeyring();
    expect(await ensureMainAgent({ call: executor.call, keyring })).toBe('locked');
    expect(keyring.asked).toEqual(['read']);
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status']);
  });

  it('leaves the agent locked, for sign-in, when the kept passphrase does not unlock it', async () => {
    const executor = fakeExecutor({ initialized: true, passphrase: SECRET, refuseUnlock: true });
    const logged = [];
    const log = (...args) => logged.push(args.join(' '));
    expect(await ensureMainAgent({ call: executor.call, keyring: fakeKeyring({ kept: SECRET }), log })).toBe('locked');
    expect(logged.join('\n')).not.toContain(SECRET);
  });

  for (const refused of ['locked', 'unavailable']) {
    it(`fails the start when the keyring is ${refused}, in words with no path and no secret`, async () => {
      for (const agent of [{}, { initialized: true, passphrase: SECRET }]) {
        const executor = fakeExecutor(agent);
        const logged = [];
        const failure = await ensureMainAgent({
          call: executor.call,
          keyring: fakeKeyring({ refused }),
          log: (...args) => logged.push(args.join(' ')),
        }).catch((err) => err);
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe(KEYRING_WORDS[refused]);
        expect(failure.message).not.toMatch(/\/run\/|unix:|\//);
        expect(failure.message).not.toContain(SECRET);
        // Nothing was made or unlocked.
        expect(executor.calls.map((c) => c.method)).toEqual(['agent.status']);
      }
    });
  }
});

describe('walletKeyring', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  /** A `we-custody` that answers `wallet-passphrase` with `line`, and writes what it was asked. */
  function helper(script) {
    dir = mkdtempSync(join(tmpdir(), 'we-wallet-'));
    const binary = join(dir, 'we-custody');
    writeFileSync(
      binary,
      `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(join(dir, 'asked.json'))}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));\n${script}\n`,
    );
    chmodSync(binary, 0o755);
    return binary;
  }
  const asked = () => JSON.parse(readFileSync(join(dir, 'asked.json'), 'utf8'));

  it('asks `we-custody wallet-passphrase <mode> --data-folder <dir>` and reads its line', async () => {
    const binary = helper(`console.log(JSON.stringify({ passphrase: ${JSON.stringify(SECRET)} }))`);
    const keyring = walletKeyring({
      binary,
      dataFolder: '/data/folder',
      baseEnv: { PATH: process.env.PATH, AD4M_ADMIN_CREDENTIAL: 'admin', AD4M_CUSTODY_CREDENTIAL: 'c' },
    });
    expect(await keyring.make()).toEqual({ passphrase: SECRET });
    expect(asked().argv).toEqual(['wallet-passphrase', 'make', '--data-folder', '/data/folder']);
    // Neither credential reaches it.
    expect(asked().env.AD4M_ADMIN_CREDENTIAL).toBeUndefined();
    expect(asked().env.AD4M_CUSTODY_CREDENTIAL).toBeUndefined();
    expect(await keyring.read()).toEqual({ passphrase: SECRET });
    expect(asked().argv[1]).toBe('read');
  });

  it('answers a helper that fails or says nothing readable as an unavailable keyring', async () => {
    const binary = helper(`process.stdout.write('not json'); process.exit(3)`);
    const answer = await walletKeyring({ binary, dataFolder: '/d', baseEnv: {} }).read();
    expect(answer.refused).toBe('unavailable');
  });

  it('answers a helper that never answers as a locked keyring, and stops it', async () => {
    const binary = helper(`setInterval(() => {}, 1000)`);
    const answer = await walletKeyring({ binary, dataFolder: '/d', baseEnv: {}, timeoutMs: 500 }).read();
    expect(answer).toEqual({ refused: 'locked' });
  });
});

describe('executorRpc', () => {
  let server;
  afterEach(() => server?.close());

  it('calls a method over the executor’s WebSocket with the admin credential, and rejects on its error', async () => {
    const seen = [];
    ({ server } = await wsServer((frame, send, url) => {
      seen.push({ frame, url });
      if (frame.type === 'agent.status') send({ id: frame.id, result: { isUnlocked: false } });
      else send({ id: frame.id, error: { code: 500, message: 'Agent not initialized' } });
    }));
    const port = server.address().port;
    const rpc = executorRpc({ port, token: 'admin-token' });
    try {
      // An event first, with no id: not an answer to anything.
      expect(await rpc.call('agent.status')).toEqual({ isUnlocked: false });
      await expect(rpc.call('agent.unlock', { passphrase: 'p' })).rejects.toThrow('Agent not initialized');
    } finally {
      rpc.close();
    }
    expect(seen[0].url).toBe('/api/v1/ws?token=admin-token');
    expect(seen[1].frame.params).toEqual({ passphrase: 'p' });
  });
});

/**
 * A minimal WebSocket server: text frames only, enough for one RPC client. `onFrame(frame, send, url)`
 * is called with each parsed request.
 */
async function wsServer(onFrame) {
  const { wsAccept, readFrames, textFrame } = await import('./fixtures/ws-lite.cjs');
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(req.headers['sec-websocket-key'])}\r\n\r\n`,
    );
    const send = (value) => socket.write(textFrame(JSON.stringify(value)));
    send({ type: 'event', payload: {} });
    readFrames(socket, (text) => onFrame(JSON.parse(text), send, req.url));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server };
}
