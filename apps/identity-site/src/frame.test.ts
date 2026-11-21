import { statementBytes } from '@coasys/identity-wasm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserSignature, FakeExecutor, fakeRegistry, FakeStore, fixtureKey, world } from '../tests/fakes.ts';
import { type BrowserKey, KEY_MAX_AGE_MS, type KeyVault } from './browserKey.ts';
import { startFrame } from './frame.ts';
import { platformRegistry } from './registry.ts';
import { StoreClient } from './store.ts';
import { Screen, TOO_OLD } from './ui.ts';

const APP = 'https://app.test';
const EXEC = world.executorAddress;
const EXEC_ORIGIN = 'http://127.0.0.1:4403';
const request = (over: Record<string, unknown> = {}) => ({
  type: 'connect',
  app: { appId: 'app1', name: 'Notes', description: 'Notes' },
  origin: APP,
  capabilities: [],
  state: 'state-1',
  codeChallenge: 'pkce-challenge',
  ...over,
});

const until = async (check: () => boolean, what: string) => {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
};

let stops: (() => void)[] = [];
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
});

const NOW = world.now * 1000;

async function setup(
  options: {
    supported?: boolean;
    executorRefuses?: boolean;
    linked?: boolean;
    storeFor?: (store: FakeStore) => typeof fetch;
  } = {},
) {
  const store = new FakeStore('https://store.test');
  const executor = new FakeExecutor(EXEC_ORIGIN, { app1: [APP] });
  const linked = options.linked
    ? { ...(await fixtureKey(NOW)), scid: world.scid, keyId: world.browser.keyId }
    : undefined;
  if (linked) store.claimed = { offerId: world.browser.offerId };
  let saved: BrowserKey | undefined = linked ?? (await fixtureKey(NOW));
  const vault: KeyVault = {
    load: async () => saved,
    save: async (k) => void (saved = k),
    clear: async () => void (saved = undefined),
  };
  const clock = { now: NOW };
  const host = { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
  const root = document.createElement('div');
  document.body.append(root);
  stops.push(
    startFrame({
      self: window,
      host,
      screen: new Screen(root),
      registry: platformRegistry(
        'https://platform.test',
        fakeRegistry({ app1: { name: 'Notes', origins: [APP], firstParty: false } }) as typeof fetch,
      ),
      store: new StoreClient(
        store.base,
        store.storeKey,
        options.storeFor?.(store) ?? (store.fetch as typeof fetch),
        () => clock.now,
      ),
      hint: 'Browser',
      vault,
      supported: async () => options.supported ?? true,
      now: () => clock.now,
      executor: () => ({
        sessionChallenge: async () => executor.sessionChallenge(),
        loginWithKeyForWeb: async (proof, req) => {
          const answer = options.executorRefuses ? 'origin' : executor.login(proof as never, req.app.appId);
          if (typeof answer === 'string') throw new Error(answer);
          return answer;
        },
        close() {},
      }),
    }),
  );
  const send = (data: unknown, origin = APP, source: unknown = host) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as MessageEventSource }));
  const posted = () => host.postMessage.mock.calls.filter(([m]) => (m as { type: string }).type !== 'ready');
  const text = () => root.textContent ?? '';
  const picker = () => !!root.querySelector('.devices');
  /** Runs a whole connect: link the browser (when it has no scid), pick the executor, wait for the answer. */
  async function connect(state = 'state-1') {
    send(request({ state }));
    await until(() => picker() || /coasys:device:1:/.test(root.innerHTML), 'the link or the picker');
    if (!picker()) {
      store.offer();
      await until(picker, 'the picker');
    }
    root.querySelector<HTMLButtonElement>('.devices button')!.click();
    await until(() => posted().length > 0, 'the answer');
  }
  return { store, executor, host, root, send, posted, text, picker, connect, clock, vault: () => saved };
}

describe('the Connect frame', () => {
  it('announces itself to its host', async () => {
    const t = await setup();
    expect(t.host.postMessage).toHaveBeenCalledWith({ type: 'ready' }, '*');
  });

  it('refuses an origin the registry does not list, and answers nothing', async () => {
    const t = await setup();
    t.send(request({ origin: 'https://evil.test' }), 'https://evil.test');
    await until(() => t.text().includes('Request refused'), 'the refusal');
    expect(t.posted()).toEqual([]);
  });

  it('refuses a request whose origin field differs from the browser-reported origin', async () => {
    const t = await setup();
    t.send(request({ origin: APP }), 'https://evil.test');
    await until(() => t.text().includes('Request refused'), 'the refusal');
    expect(t.posted()).toEqual([]);
  });

  it('refuses an app the registry does not know', async () => {
    const t = await setup();
    t.send(request({ app: { appId: 'nobody', name: 'X', description: 'X' } }));
    await until(() => t.text().includes('Request refused'), 'the refusal');
    expect(t.posted()).toEqual([]);
  });

  it('ignores a message that does not come from its host window', async () => {
    const t = await setup();
    t.send(request(), APP, {});
    await new Promise((r) => setTimeout(r, 50));
    expect(t.text()).toBe('');
    expect(t.posted()).toEqual([]);
  });

  it('ignores a request without a state', async () => {
    const t = await setup();
    t.send(request({ state: '' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(t.text()).toBe('');
  });

  it('shows "too old" and does not touch the key when the browser lacks Ed25519', async () => {
    const t = await setup({ supported: false });
    t.send(request());
    await until(() => t.text().includes(TOO_OLD), 'the too-old screen');
    expect(t.text()).toContain('https://app.test');
    expect(t.posted()).toEqual([]);
  });

  it("links the browser, lists only the person's executors, and answers the exact origin", async () => {
    const t = await setup();
    await t.connect();
    expect(t.root.querySelector('input[type=password]')).toBeNull();
    expect(t.executor.logins).toHaveLength(1);
    expect(t.executor.logins[0].proof.statement).toMatchObject({
      v: 1,
      purpose: 'login',
      key: world.browser.signMultikey,
      scid: world.scid,
      audience: EXEC_ORIGIN,
      executor: t.executor.did,
      codeChallenge: 'pkce-challenge',
      client: { kind: 'web', origin: APP },
    });
    expect(t.posted()).toEqual([
      [
        { type: 'connected', state: 'state-1', executor: EXEC, code: 'code-1', did: `did:scid:coasys:1:${world.scid}` },
        APP,
      ],
    ]);
    expect(t.vault()).toMatchObject({ scid: world.scid, keyId: world.browser.keyId });
    expect(t.store.refused).toEqual([]);
  });

  it('shows the device link of the browser key, and lists only the device that runs an executor', async () => {
    const t = await setup();
    t.send(request());
    await until(() => /coasys:device:1:/.test(t.root.innerHTML), 'the link');
    expect(t.text()).toContain('Notes at https://app.test wants to connect');
    t.store.offer();
    await until(t.picker, 'the picker');
    expect([...t.root.querySelectorAll('.devices button')].map((b) => b.textContent)).toEqual([
      'MacBook Pro · desktop-app',
    ]);
  });

  it('shows the match code the holder shows', async () => {
    const t = await setup();
    t.send(request());
    await until(() => /coasys:device:1:/.test(t.root.innerHTML), 'the link');
    t.store.offer();
    await until(() => t.text().includes('Compare this code') || t.picker(), 'the match code');
    expect(t.store.claimed).toBeDefined();
    expect(t.store.match()).toMatch(/^[A-Z2-7]{3} [A-Z2-7]{3}$/);
  });

  it('drops a message that is not a ticket from the inbox and keeps waiting', async () => {
    const t = await setup();
    t.send(request());
    await until(() => /coasys:device:1:/.test(t.root.innerHTML), 'the link');
    t.store.offer('not-a-sealed-message');
    await new Promise((r) => setTimeout(r, 300));
    expect(t.store.claimed).toBeUndefined();
    expect(t.picker()).toBe(false);
    t.store.offer();
    await until(t.picker, 'the picker');
  });

  it('goes straight to the picker when the browser key is linked', async () => {
    const t = await setup({ linked: true });
    t.send(request({ state: 's2' }));
    await until(t.picker, 'the picker');
    expect(t.text()).not.toContain('Link this browser');
  });

  it('drops a key older than 30 days and makes a new one to link', async () => {
    const t = await setup({ linked: true });
    t.clock.now += KEY_MAX_AGE_MS + 1000;
    t.send(request({ state: 's2' }));
    // The fake store knows only the fixture key, so it refuses the new key's inbox read: what counts is the new key.
    await until(() => t.vault()?.signMultikey !== world.browser.signMultikey, 'a new key');
    expect(t.vault()?.scid).toBeUndefined();
  });

  it('keeps a key just inside 30 days', async () => {
    const t = await setup({ linked: true });
    t.clock.now += KEY_MAX_AGE_MS - 1000;
    t.send(request({ state: 's2' }));
    await until(t.picker, 'the picker');
  });

  it('answers "denied" and lists nothing when the record is not the one the store signed for', async () => {
    const t = await setup({
      linked: true,
      storeFor: (store) => async (input, init) => {
        const response = await store.fetch(input, init);
        if (!new URL(new Request(input).url).pathname.startsWith('/v1/private/')) return response;
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, record: { ...body.record, version: body.record.version + 1 } }), {
          status: 200,
        });
      },
    });
    t.send(request());
    await until(() => t.posted().length > 0, 'the denial');
    expect(t.posted()).toEqual([[{ type: 'denied', state: 'state-1', reason: expect.any(String) }, APP]]);
    expect(t.picker()).toBe(false);
    expect(t.executor.logins).toEqual([]);
  });

  it('answers "denied" at the exact origin when the executor refuses', async () => {
    const t = await setup({ executorRefuses: true, linked: true });
    await t.connect();
    expect(t.posted()).toEqual([[{ type: 'denied', state: 'state-1', reason: 'origin' }, APP]]);
  });

  describe('renew and sign-out', () => {
    const renew = (t: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) => ({
      type: 'renew',
      state: 'state-1',
      executor: EXEC,
      challenge: t.executor.sessionChallenge(),
      grantId: 'grant-9',
      ...over,
    });

    it('signs a renew statement for the grant and answers the exact origin', async () => {
      const t = await setup({ linked: true });
      await t.connect();
      t.host.postMessage.mockClear();
      const message = renew(t);
      t.send(message);
      await until(() => t.posted().length > 0, 'the renewed message');
      const [[answer, target]] = t.posted() as [
        [{ type: string; state: string; proof: { statement: Record<string, unknown>; sig: string } }, string],
      ];
      expect(target).toBe(APP);
      expect(answer).toMatchObject({ type: 'renewed', state: 'state-1' });
      expect(answer.proof.statement).toMatchObject({
        purpose: 'renew',
        grant: 'grant-9',
        audience: EXEC_ORIGIN,
        client: { kind: 'web', origin: APP },
        challenge: message.challenge.challenge,
      });
      expect(answer.proof.statement.codeChallenge).toBeUndefined();
      expect(answer.proof.sig).toBe(browserSignature(statementBytes(answer.proof.statement)));
    });

    it('ignores a renew for a state it never opened', async () => {
      const t = await setup({ linked: true });
      await t.connect();
      t.host.postMessage.mockClear();
      t.send(renew(t, { state: 'other' }));
      await new Promise((r) => setTimeout(r, 80));
      expect(t.posted()).toEqual([]);
    });

    it('ignores a renew from an origin other than the one that connected', async () => {
      const t = await setup({ linked: true });
      await t.connect();
      t.host.postMessage.mockClear();
      t.send(renew(t), 'https://evil.test');
      await new Promise((r) => setTimeout(r, 80));
      expect(t.posted()).toEqual([]);
    });

    it('forgets the session on sign-out, and only for the origin that owns it', async () => {
      const t = await setup({ linked: true });
      await t.connect();
      t.host.postMessage.mockClear();
      t.send({ type: 'sign-out', state: 'state-1' }, 'https://evil.test');
      t.send(renew(t));
      await until(() => t.posted().length > 0, 'a renewal after a foreign sign-out');
      t.host.postMessage.mockClear();
      t.send({ type: 'sign-out', state: 'state-1' });
      t.send(renew(t));
      await new Promise((r) => setTimeout(r, 80));
      expect(t.posted()).toEqual([]);
    });
  });
});
