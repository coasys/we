/**
 * The desktop's host: the custody service as the identity, this computer and the account's servers
 * as places, and the shell's executor as the base app reads it.
 */
import type { BackendConnector, BaseExecutorState } from '@we/app-shell/shared';
import type { Ad4mCustodyHost } from '@we/backend-ad4m';
import { describe, expect, it, vi } from 'vitest';

import {
  bridgedExecutor,
  custodyIdentitySource,
  desktopBaseHost,
  type DesktopServers,
  type ExecutorBridge,
  ServerNotConnectable,
  serverUnreachable,
  shellRefusal,
  THIS_COMPUTER_CONNECTION,
  WORDS_AGENT_LOCKED,
  WORDS_AGENT_NEEDS_PASSWORD,
  WORDS_EXECUTOR_NOT_UP,
  WORDS_HERE_OFF,
} from './desktop';

const DID = 'did:scid:coasys:1:QmTestIdentity';
const local = { initialize: async () => ({}) } as unknown as BackendConnector;

function custody(over: Partial<Ad4mCustodyHost> = {}): Ad4mCustodyHost {
  return {
    open: vi.fn(async () => 'done' as const),
    publicState: async () => ({
      did: DID,
      holdsMaster: { index: 0 },
      unlock: 'os',
      devices: [{ keyId: 'k1', name: 'Test computer', kind: 'desktop-app', holdsMaster: true }],
    }),
    ...over,
  } as Ad4mCustodyHost;
}

function servers(list: { address: string; name: string }[]): DesktopServers & { chosen: (string | null)[] } {
  const chosen: (string | null)[] = [];
  return {
    chosen,
    list: async () => ({ servers: list, serving: null }),
    choose: async (address) => void chosen.push(address),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the custody identity source', () => {
  it("reads the custody service's state", async () => {
    const view = await custodyIdentitySource(custody()).state();
    expect(view.did).toBe(DID);
    expect(view.holdsMaster).toBe(true);
    expect(view.devices).toEqual([{ keyId: 'k1', name: 'Test computer', kind: 'desktop-app', holdsMaster: 'yes' }]);
  });

  it("opens each door on the custody service's own step", () => {
    const { doors } = custodyIdentitySource(custody());
    expect(doors.make).toEqual({ step: { kind: 'create' } });
    expect(doors.link).toEqual({ step: { kind: 'show-code' } });
    expect(doors.words).toEqual({ step: { kind: 'restore' } });
  });

  it('closes the 12 words door where the service takes no words, and says why', () => {
    expect(custodyIdentitySource(custody({ takesWords: false })).doors.words).toEqual({
      step: null,
      note: WORDS_HERE_OFF,
    });
  });

  /*
    #438: the identity window's steps run against the executor's main agent, which the supervisor
    makes and unlocks (apps/we-electron/electron/mainAgent.js). Until it reports one ready and
    unlocked, every door is closed and says why; an executor that does not say how its agent is
    (one this app does not make it for) leaves them as they were.
  */
  it('opens the doors once the executor reports a ready, unlocked agent', () => {
    let state: BaseExecutorState = { phase: 'starting' };
    const executor = { state: () => state, subscribe: () => () => {}, start: async () => {} };
    const source = custodyIdentitySource(custody(), executor);
    const closed = (note: string) => ({
      make: { step: null, note },
      link: { step: null, note },
      words: { step: null, note },
    });

    expect(source.doors).toEqual(closed(WORDS_EXECUTOR_NOT_UP));
    state = { phase: 'failed', reason: 'x' };
    expect(source.doors).toEqual(closed(WORDS_EXECUTOR_NOT_UP));
    state = { phase: 'ready', agent: 'locked' };
    expect(source.doors).toEqual(closed(WORDS_AGENT_LOCKED));
    // No keyring: the WE password is asked for first, and the doors wait on it.
    state = { phase: 'ready', agent: 'needs-password' };
    expect(source.doors).toEqual(closed(WORDS_AGENT_NEEDS_PASSWORD));
    state = { phase: 'ready', agent: 'needs-new-password' };
    expect(source.doors).toEqual(closed(WORDS_AGENT_NEEDS_PASSWORD));
    state = { phase: 'ready', agent: 'unlocked' };
    expect(source.doors.make).toEqual({ step: { kind: 'create' } });
    expect(source.doors.link).toEqual({ step: { kind: 'show-code' } });
    expect(source.doors.words).toEqual({ step: { kind: 'restore' } });
    state = { phase: 'ready' };
    expect(source.doors.make).toEqual({ step: { kind: 'create' } });
  });

  it("runs a step in the service's window, and refuses a phone's join", async () => {
    const service = custody();
    const source = custodyIdentitySource(service);
    expect(await source.open({ kind: 'create' })).toBe('done');
    expect(service.open).toHaveBeenCalledWith({ kind: 'create' });
    expect(await source.open({ kind: 'join' })).toBe('failed');
    expect(service.open).toHaveBeenCalledTimes(1);
  });

  it("says why the service could not be read, without the shell's wrapping", async () => {
    const refused = custody({
      publicState: async () => {
        throw new Error(
          "Error invoking remote method 'identity-public-state': Error: the custody service is not running",
        );
      },
    });
    await expect(custodyIdentitySource(refused).state()).rejects.toThrow(/^the custody service is not running$/);
  });
});

describe('shellRefusal', () => {
  it("drops Electron's wrapping and keeps any other message as it is", () => {
    expect(shellRefusal(new Error("Error invoking remote method 'executor-start': Error: it stopped"))).toBe(
      'it stopped',
    );
    expect(shellRefusal(new Error("Error invoking remote method 'x': TypeError: bad"))).toBe('TypeError: bad');
    expect(shellRefusal('the identity store is locked')).toBe('the identity store is locked');
  });
});

describe('the desktop host', () => {
  it("closes the identity's doors on the shell's executor until its agent is unlocked", () => {
    let state: BaseExecutorState = { phase: 'ready', agent: 'locked' };
    const executor = { state: () => state, subscribe: () => () => {}, start: async () => {} };
    const host = desktopBaseHost({ local, custody: custody(), executor });
    expect(host.identity?.doors.make).toEqual({ step: null, note: WORDS_AGENT_LOCKED });
    state = { phase: 'ready', agent: 'unlocked' };
    expect(host.identity?.doors.make).toEqual({ step: { kind: 'create' } });
  });

  /*
    Lal's review of #438: a locked agent with nothing kept for it is either one made with a WE
    password or one whose kept passphrase this computer lost, and the app cannot tell which. The
    words cover both, and say what to do in each.
  */
  it('says, for a locked agent, to sign in, or else to restore with the recovery phrase', () => {
    const executor = {
      state: () => ({ phase: 'ready', agent: 'locked' }) as const,
      subscribe: () => () => {},
      start: async () => {},
    };
    const doors = desktopBaseHost({ local, custody: custody(), executor }).identity?.doors;
    for (const door of [doors?.make, doors?.link, doors?.words]) {
      expect(door).toEqual({ step: null, note: WORDS_AGENT_LOCKED });
    }
    expect(WORDS_AGENT_LOCKED).toMatch(/sign in/);
    expect(WORDS_AGENT_LOCKED).toMatch(/never set a password/);
    expect(WORDS_AGENT_LOCKED).toMatch(/recovery phrase/);
  });

  it('has an identity only with a custody service, and an executor only where the shell reports one', () => {
    const bare = desktopBaseHost({ local });
    expect(bare.kind).toBe('computer');
    expect(bare.identity).toBeUndefined();
    expect(bare.executor).toBeUndefined();
    const full = desktopBaseHost({
      local,
      custody: custody(),
      executor: { state: () => ({ phase: 'ready' }), subscribe: () => () => {}, start: async () => {} },
    });
    expect(full.identity).toBeDefined();
    expect(full.executor?.state()).toEqual({ phase: 'ready' });
  });

  it("offers this computer, then the account's servers by name", async () => {
    expect(await desktopBaseHost({ local }).connections()).toEqual([THIS_COMPUTER_CONNECTION]);
    const host = desktopBaseHost({
      local,
      servers: servers([
        { address: 'https://one.example', name: 'Test server' },
        { address: 'https://two.example', name: '' },
      ]),
    });
    expect(await host.connections()).toEqual([
      THIS_COMPUTER_CONNECTION,
      { id: 'server:https://one.example', kind: 'server', label: 'Test server', detail: 'https://one.example' },
      { id: 'server:https://two.example', kind: 'server', label: 'https://two.example', detail: 'https://two.example' },
    ]);
  });

  it('connects this computer through the local connector, and records it with the shell', async () => {
    const kept = servers([{ address: 'https://one.example', name: 'Test server' }]);
    const host = desktopBaseHost({ local, servers: kept });
    const [here] = await host.connections();
    expect(await host.connector(here)).toBe(local);
    expect(kept.chosen).toEqual([null]);
  });

  /*
    Lal's review of coasys/we#438: the local connector always builds `http://localhost:<port>` with
    this computer's own credential, so handing it over for a server would at best connect here under
    the server's name, and at worst take the local admin credential somewhere it does not belong.
    Until a server has its own connector (coasys/we#428) the choice refuses, in words, and changes
    nothing the shell keeps.
  */
  it("refuses a server, in words, rather than reaching it with this computer's connector", async () => {
    const kept = servers([{ address: 'https://one.example', name: 'Test server' }]);
    const host = desktopBaseHost({ local, servers: kept });
    const [, server] = await host.connections();
    const refused = await host.connector(server).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ServerNotConnectable);
    expect((refused as Error).message).toBe("Can't open Test server from this app yet. Choose This computer.");
    // A refusal, not a place out of reach: the connection choice says it, not the offline state.
    expect(host.isUnreachable?.(refused)).toBe(false);
    expect(kept.chosen).toEqual([]);
  });
});

describe('serverUnreachable', () => {
  it('is a failure for want of a network', () => {
    expect(serverUnreachable(new TypeError('Failed to fetch'))).toBe(true);
    expect(serverUnreachable({ status: 503 })).toBe(true);
    expect(serverUnreachable(new Error('connect ECONNREFUSED'))).toBe(true);
    expect(serverUnreachable('WebSocket closed')).toBe(true);
  });

  it('is not an answer that refused', () => {
    expect(serverUnreachable(new Error('Invalid token'))).toBe(false);
    expect(serverUnreachable({ status: 401 })).toBe(false);
    expect(serverUnreachable(null)).toBe(false);
  });
});

describe('bridgedExecutor', () => {
  function bridge() {
    let listener: ((s: BaseExecutorState) => void) | null = null;
    let answer!: (s: unknown) => void;
    let refuse!: (e: unknown) => void;
    let started!: (s: unknown) => void;
    const b: ExecutorBridge & {
      push(s: BaseExecutorState): void;
      answer(s: unknown): void;
      refuse(e: unknown): void;
      started(s: unknown): void;
    } = {
      // The shell's answer is untyped on the wire; the bridge reads whatever arrives.
      state: () =>
        new Promise<unknown>((res, rej) => {
          answer = res;
          refuse = rej;
        }) as Promise<BaseExecutorState>,
      onState: (l) => ((listener = l), () => (listener = null)),
      start: vi.fn(() => new Promise((res) => (started = res))),
      push: (s) => listener?.(s),
      answer: (s) => answer(s),
      refuse: (e) => refuse(e),
      started: (s) => started(s),
    };
    return b;
  }

  it("is starting until the shell's first answer, then the answer", async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    const seen: BaseExecutorState[] = [];
    executor.subscribe((s) => seen.push(s));
    expect(executor.state()).toEqual({ phase: 'starting' });
    b.answer({ phase: 'failed', reason: "Couldn't read the startup settings." });
    await tick();
    expect(executor.state()).toEqual({ phase: 'failed', reason: "Couldn't read the startup settings." });
    expect(seen).toEqual([executor.state()]);
  });

  it('keeps that a failed executor ran and stopped, and only a true stopped', async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    b.push({ phase: 'failed', reason: 'It was stopped outside the app.', stopped: true });
    expect(executor.state()).toEqual({ phase: 'failed', reason: 'It was stopped outside the app.', stopped: true });
    b.push({ phase: 'failed', reason: 'x', stopped: 'yes' } as never);
    expect(executor.state()).toEqual({ phase: 'failed', reason: 'x' });
  });

  it('drops an answer that a change it heard first is newer than', async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    b.push({ phase: 'ready' });
    b.answer({ phase: 'starting' });
    await tick();
    expect(executor.state()).toEqual({ phase: 'ready' });
  });

  it('reads an answer it cannot make out, or a bridge that failed, as a failure', async () => {
    const odd = bridge();
    const a = bridgedExecutor(odd);
    odd.answer({ phase: 'sleeping' });
    await tick();
    expect(a.state()).toEqual({ phase: 'failed', reason: 'Something went wrong.' });

    const broken = bridge();
    const b = bridgedExecutor(broken);
    broken.refuse(new Error('No handler for executor-state'));
    await tick();
    expect(b.state()).toEqual({ phase: 'failed', reason: 'No handler for executor-state' });
  });

  it('starts again: starting at once, then what the start answered unless the shell has said since', async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    b.answer({ phase: 'failed', reason: 'x' });
    await tick();

    const first = executor.start();
    expect(executor.state()).toEqual({ phase: 'starting' });
    b.started({ phase: 'starting' });
    await first;
    expect(b.start).toHaveBeenCalledTimes(1);
    expect(executor.state()).toEqual({ phase: 'starting' });

    const second = executor.start();
    b.push({ phase: 'ready' });
    b.started({ phase: 'starting' });
    await second;
    expect(executor.state()).toEqual({ phase: 'ready' });
  });

  it('keeps what the shell says of its agent, and nothing it cannot make out', async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    b.answer({ phase: 'ready', agent: 'unlocked', passphrase: 'never kept' });
    await tick();
    expect(executor.state()).toEqual({ phase: 'ready', agent: 'unlocked' });
    b.push({ phase: 'ready', agent: 'locked' } as BaseExecutorState);
    expect(executor.state()).toEqual({ phase: 'ready', agent: 'locked' });
    b.push({ phase: 'ready', agent: 'sleepy' } as unknown as BaseExecutorState);
    expect(executor.state()).toEqual({ phase: 'ready' });
    // No keyring to use: the WE password is asked for, for a new agent or one made with it.
    for (const agent of ['needs-password', 'needs-new-password'] as const) {
      b.push({ phase: 'ready', agent });
      expect(executor.state()).toEqual({ phase: 'ready', agent });
    }
  });

  /*
    Where no keyring could be used, the base app's password step sends the WE password to the shell
    (Electron's `executor-agent-password`), once, and learns how it went: never the password back.
  */
  it('sends the WE password to the shell, and answers how it went', async () => {
    const b = bridge();
    const sent: unknown[] = [];
    const answers: unknown[] = ['unlocked', 'wrong', 'refused', 'failed', { password: 'x' }];
    const executor = bridgedExecutor({
      ...b,
      password: async (password: string) => (sent.push(password), answers.shift()),
    });
    expect(await executor.givePassword?.('test-password')).toBe('unlocked');
    expect(sent).toEqual(['test-password']);
    expect(await executor.givePassword?.('test-password')).toBe('wrong');
    expect(await executor.givePassword?.('test-password')).toBe('refused');
    expect(await executor.givePassword?.('test-password')).toBe('failed');
    // An answer it cannot make out is a failure.
    expect(await executor.givePassword?.('test-password')).toBe('failed');
  });

  it('says why the shell refused a password, without its wrapping, and has no way to send one where the shell takes none', async () => {
    const b = bridge();
    const executor = bridgedExecutor({
      ...b,
      password: async () => {
        throw new Error("Error invoking remote method 'executor-agent-password': Error: not from this window");
      },
    });
    await expect(executor.givePassword?.('test-password')).rejects.toThrow(/^not from this window$/);
    expect(bridgedExecutor(bridge()).givePassword).toBeUndefined();
  });

  /*
    Lal's review of #438: what the shell said of the agent at its start goes stale once WE's sign-in
    unlocks it. The base app asks again when it is shown (`BaseExecutor.refresh`), and the shell
    reads the agent again to answer (`executor-state` in main.js).
  */
  it('asks the shell again on refresh, and takes its answer unless the shell has said since', async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    b.answer({ phase: 'ready', agent: 'locked' });
    await tick();
    const seen: BaseExecutorState[] = [];
    executor.subscribe((s) => seen.push(s));

    const again = executor.refresh?.();
    b.answer({ phase: 'ready', agent: 'unlocked' });
    await again;
    expect(executor.state()).toEqual({ phase: 'ready', agent: 'unlocked' });
    expect(seen).toEqual([{ phase: 'ready', agent: 'unlocked' }]);

    const stale = executor.refresh?.();
    b.push({ phase: 'starting' });
    b.answer({ phase: 'ready', agent: 'locked' });
    await stale;
    expect(executor.state()).toEqual({ phase: 'starting' });

    // A shell that cannot answer leaves what it last said: this is a second look, not a start.
    const refused = executor.refresh?.();
    b.refuse(new Error('No handler for executor-state'));
    await refused;
    expect(executor.state()).toEqual({ phase: 'starting' });
  });

  it('stops telling a listener once it unsubscribes', async () => {
    const b = bridge();
    const executor = bridgedExecutor(b);
    const listener = vi.fn();
    const off = executor.subscribe(listener);
    off();
    b.push({ phase: 'ready' });
    expect(listener).not.toHaveBeenCalled();
  });
});
