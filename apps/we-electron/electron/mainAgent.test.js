/**
 * The supervisor's main agent (`mainAgent.js`): made on a first start with a passphrase the keyring
 * keeps, unlocked with it on every start after, and a keyring that refuses said in words for the
 * window, with no path and no secret in them.
 */
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureMainAgent,
  executorRpc,
  giveAgentPassword,
  keptMarker,
  KEYRING_WORDS,
  walletKeyring,
} from './mainAgent.js';

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
        // The executor's own refusal, as `executorRpc` marks it.
        if (refuseUnlock || params.passphrase !== agent.passphrase)
          throw Object.assign(new Error('Failed to decrypt agent keys'), { refused: true });
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

/** The note that the agent's passphrase is kept in the keyring (`keptMarker`), held in memory. */
function fakeMarker(kept = false) {
  const marker = {
    kept,
    has: () => marker.kept,
    note: () => void (marker.kept = true),
    forget: () => void (marker.kept = false),
  };
  return marker;
}

describe('ensureMainAgent', () => {
  it('on a first start keeps a new passphrase, then makes the agent with it', async () => {
    const executor = fakeExecutor();
    const keyring = fakeKeyring();
    expect(await ensureMainAgent({ call: executor.call, keyring })).toBe('unlocked');
    expect(keyring.asked).toEqual(['make']);
    // Read again after the keyring answered, which may have waited on a prompt.
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status', 'agent.status', 'agent.generate']);
    expect(executor.calls[2].params).toEqual({ passphrase: SECRET });
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

  /*
    Lal's review of #438: the keyring's `make` can wait on a prompt, and the executor's
    `agent.generate` overwrites an agent that is already made. One made while the supervisor waited
    (WE's own "Create account", say) is not made over: the status is read again before generating.
  */
  describe('an agent made while the keyring was asked', () => {
    function madeDuringTheWait(passphrase) {
      const executor = fakeExecutor();
      const keyring = fakeKeyring();
      const make = keyring.make;
      keyring.make = async () => {
        const answer = await make();
        Object.assign(executor.agent, { initialized: true, passphrase });
        return answer;
      };
      return { executor, keyring };
    }

    it('is not made over, and is unlocked with the kept passphrase where that is its own', async () => {
      const { executor, keyring } = madeDuringTheWait(SECRET);
      expect(await ensureMainAgent({ call: executor.call, keyring, log: () => {} })).toBe('unlocked');
      const methods = executor.calls.map((c) => c.method);
      expect(methods).not.toContain('agent.generate');
      expect(methods).toEqual(['agent.status', 'agent.status', 'agent.unlock']);
      expect(executor.agent.passphrase).toBe(SECRET);
    });

    it('is not made over, and is left locked for sign-in where it was made with another', async () => {
      const { executor, keyring } = madeDuringTheWait('the person’s own');
      expect(await ensureMainAgent({ call: executor.call, keyring, log: () => {} })).toBe('locked');
      expect(executor.calls.map((c) => c.method)).not.toContain('agent.generate');
      expect(executor.agent.passphrase).toBe('the person’s own');
    });

    it('is left alone where it was unlocked by then', async () => {
      const { executor, keyring } = madeDuringTheWait('the person’s own');
      const make = keyring.make;
      keyring.make = async () => {
        const answer = await make();
        executor.agent.unlocked = true;
        return answer;
      };
      expect(await ensureMainAgent({ call: executor.call, keyring, log: () => {} })).toBe('unlocked');
      expect(executor.calls.map((c) => c.method)).toEqual(['agent.status', 'agent.status']);
    });
  });

  it('notes that the passphrase is kept once the agent is made or unlocked with it, and not otherwise', async () => {
    const made = fakeMarker();
    await ensureMainAgent({ call: fakeExecutor().call, keyring: fakeKeyring(), marker: made, log: () => {} });
    expect(made.kept).toBe(true);

    const unlocked = fakeMarker();
    const executor = fakeExecutor({ initialized: true, passphrase: SECRET });
    await ensureMainAgent({ call: executor.call, keyring: fakeKeyring({ kept: SECRET }), marker: unlocked });
    expect(unlocked.kept).toBe(true);

    // A WE password's agent, and one the kept passphrase does not open: nothing is kept for them.
    for (const agent of [
      { initialized: true, passphrase: 'the person’s own' },
      { initialized: true, passphrase: SECRET, refuseUnlock: true },
    ]) {
      const marker = fakeMarker();
      const keyring = fakeKeyring(agent.refuseUnlock ? { kept: SECRET } : {});
      await ensureMainAgent({ call: fakeExecutor(agent).call, keyring, marker, log: () => {} });
      expect(marker.kept).toBe(false);
    }
  });

  /*
    A keyring that refuses (none on this desktop, or one still locked past custody's 90 s) can still
    fail the start, but only where the agent's passphrase is kept in it: that agent opens with nothing
    else, and the person does not know its passphrase. Everywhere else the WE password is asked for.
  */
  for (const refused of ['locked', 'unavailable']) {
    it(`fails the start when the keyring is ${refused} and keeps the agent's passphrase, in words with no path and no secret`, async () => {
      const executor = fakeExecutor({ initialized: true, passphrase: SECRET });
      const failure = await ensureMainAgent({
        call: executor.call,
        keyring: fakeKeyring({ refused }),
        marker: fakeMarker(true),
        log: () => {},
      }).catch((err) => err);
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toBe(KEYRING_WORDS[refused]);
      expect(failure.message).toMatch(/keyring/);
      expect(failure.message).not.toMatch(/\/run\/|unix:|\//);
      expect(failure.message).not.toContain(SECRET);
      // Nothing was made or unlocked.
      expect(executor.calls.map((c) => c.method)).toEqual(['agent.status']);
    });

    it(`asks for a new WE password on a first start when the keyring is ${refused}, and makes nothing`, async () => {
      const executor = fakeExecutor();
      const marker = fakeMarker();
      const keyring = fakeKeyring({ refused });
      expect(await ensureMainAgent({ call: executor.call, keyring, marker, log: () => {} })).toBe('needs-new-password');
      expect(executor.calls.map((c) => c.method)).toEqual(['agent.status']);
      expect(marker.kept).toBe(false);
    });

    it(`asks for the WE password of an agent with nothing kept for it when the keyring is ${refused}`, async () => {
      const executor = fakeExecutor({ initialized: true, passphrase: 'the person’s own' });
      expect(
        await ensureMainAgent({
          call: executor.call,
          keyring: fakeKeyring({ refused }),
          marker: fakeMarker(),
          log: () => {},
        }),
      ).toBe('needs-password');
      expect(executor.calls.map((c) => c.method)).toEqual(['agent.status']);
      expect(executor.agent.unlocked).toBe(false);
    });
  }
});

/*
  The WE password, where the keyring could not be used: the base app's password step sends it, and the
  supervisor makes the agent with it on a first start or unlocks the agent with it after.
*/
describe('giveAgentPassword', () => {
  const PASSWORD = 'test-password-for-the-agent';
  const quiet = () => {};

  it('makes the agent with the password on a first start, and forgets any note of a kept passphrase', async () => {
    const executor = fakeExecutor();
    const marker = fakeMarker(true);
    const answer = await giveAgentPassword({
      call: executor.call,
      need: 'needs-new-password',
      password: PASSWORD,
      marker,
      log: quiet,
    });
    expect(answer).toBe('unlocked');
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status', 'agent.generate']);
    expect(executor.calls[1].params).toEqual({ passphrase: PASSWORD });
    expect(marker.kept).toBe(false);
  });

  it('unlocks an agent made with a WE password', async () => {
    const executor = fakeExecutor({ initialized: true, passphrase: PASSWORD });
    const answer = await giveAgentPassword({
      call: executor.call,
      need: 'needs-password',
      password: PASSWORD,
      marker: fakeMarker(),
      log: quiet,
    });
    expect(answer).toBe('unlocked');
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.unlock']);
    expect(executor.calls[0].params).toEqual({ passphrase: PASSWORD, holochain: true });
    expect(executor.agent.unlocked).toBe(true);
  });

  it('answers a wrong password as wrong, leaves the agent locked, and logs no password', async () => {
    const executor = fakeExecutor({ initialized: true, passphrase: PASSWORD });
    const logged = [];
    const answer = await giveAgentPassword({
      call: executor.call,
      need: 'needs-password',
      password: 'not-it',
      marker: fakeMarker(),
      log: (...args) => logged.push(args.join(' ')),
    });
    expect(answer).toBe('wrong');
    expect(executor.agent.unlocked).toBe(false);
    expect(logged.join('\n')).not.toContain('not-it');
  });

  it('does not make over an agent made since the start asked: it unlocks it instead', async () => {
    const executor = fakeExecutor({ initialized: true, passphrase: PASSWORD });
    const answer = await giveAgentPassword({
      call: executor.call,
      need: 'needs-new-password',
      password: PASSWORD,
      marker: fakeMarker(),
      log: quiet,
    });
    expect(answer).toBe('unlocked');
    expect(executor.calls.map((c) => c.method)).toEqual(['agent.status', 'agent.unlock']);
  });

  it('rejects where the executor could not be asked, rather than calling the password wrong', async () => {
    const call = async () => {
      throw new Error('the executor’s WebSocket closed');
    };
    await expect(
      giveAgentPassword({ call, need: 'needs-password', password: PASSWORD, marker: fakeMarker(), log: quiet }),
    ).rejects.toThrow('closed');
  });
});

describe('keptMarker', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('is a file in the data folder that says only that a passphrase is kept', () => {
    dir = mkdtempSync(join(tmpdir(), 'we-kept-'));
    const marker = keptMarker(dir);
    expect(marker.has()).toBe(false);
    marker.note();
    expect(marker.has()).toBe(true);
    expect(keptMarker(dir).has()).toBe(true);
    expect(
      readdirSync(dir)
        .map((name) => readFileSync(join(dir, name), 'utf8'))
        .join(''),
    ).not.toMatch(/\w{20}/);
    marker.forget();
    expect(keptMarker(dir).has()).toBe(false);
    // Forgetting what is not noted is nothing.
    marker.forget();
  });
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
      // The executor's own refusal is marked as one: an answer, not a socket that failed.
      const refusal = await rpc.call('agent.unlock', { passphrase: 'p' }).catch((err) => err);
      expect(refusal.message).toBe('Agent not initialized');
      expect(refusal.refused).toBe(true);
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
