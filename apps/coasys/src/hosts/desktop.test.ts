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
    expect((refused as Error).message).toBe(
      'Test server cannot be opened from this app yet: only this computer can. Choose This computer.',
    );
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
    b.answer({ phase: 'failed', reason: 'The executor refused its settings.' });
    await tick();
    expect(executor.state()).toEqual({ phase: 'failed', reason: 'The executor refused its settings.' });
    expect(seen).toEqual([executor.state()]);
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
    expect(a.state()).toEqual({ phase: 'failed', reason: 'The app did not say how its executor is.' });

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
