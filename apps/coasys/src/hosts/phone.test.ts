/**
 * The phone's host: its identity read from the device key plugin, the one door it opens, and the
 * places it offers — the executor its key logs in to, and AD4M Connect.
 */
import type { BackendConnector } from '@we/app-shell/shared';
import type { DeviceKeyPlugin, PhoneIdentityView } from '@we/app-web/platform/deviceKey';
import type { DeviceKeyConnectorDeps } from '@we/app-web/platform/deviceKeyConnector';
import { KeyLoginUnreachable } from '@we/app-web/platform/deviceKeyConnector';
import type { PageNav } from '@we/app-web/platform/phoneCustody';
import { describe, expect, it, vi } from 'vitest';

import {
  keyHostConnection,
  MAKE_ON_A_COMPUTER,
  phoneBaseHost,
  phoneIdentitySource,
  WORDS_ON_A_COMPUTER,
} from './phone';
import { CONNECT, ConnectUnreachable } from './web';

const DID = 'did:scid:coasys:1:QmTestIdentity';
const KEY_HOST = 'https://executor.example:12000';

const status = (over: Partial<PhoneIdentityView> = {}): PhoneIdentityView => ({
  did: DID,
  keyId: 'p1',
  fingerprint: 'AbCd 1234',
  revoked: null,
  masterIndex: null,
  protection: 'tee',
  store: 'https://store.example',
  head: 3,
  biometrics: true,
  ...over,
});

const refusal = (code: string) => Object.assign(new Error(code), { code });

function plugin(answer: PhoneIdentityView | Error = status()): DeviceKeyPlugin {
  return {
    identityStatus: vi.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    }),
    devices: vi.fn(async () => ({ devices: [] })),
    requests: vi.fn(async () => ({ requests: [] })),
    masterWaiting: vi.fn(async () => ({ waiting: false })),
  } as unknown as DeviceKeyPlugin;
}

function nav(here = '/~/home'): PageNav & { went: string[] } {
  const went: string[] = [];
  return { went, here: () => here, assign: (url) => went.push(url) };
}

const fallback = { initialize: async () => ({}) } as unknown as BackendConnector;

describe('the phone identity source', () => {
  it('reads an identity the phone has joined', async () => {
    const source = phoneIdentitySource(plugin(), nav(), () => false);
    const view = await source.state();
    expect(view.did).toBe(DID);
    expect(view.thisDevice).toEqual({ keyId: 'p1', kind: 'phone-app' });
  });

  it('reads no identity as none, and a store it cannot reach as blocked', async () => {
    expect((await phoneIdentitySource(plugin(refusal('NoIdentity')), nav()).state()).did).toBeNull();
    const blocked = await phoneIdentitySource(plugin(refusal('StoreDown')), nav()).state();
    expect(blocked.did).toBeNull();
    expect(blocked.blocked).toMatch(/cannot reach your identity store/);
  });

  it("opens only the link door, and says why the other two are a computer's", () => {
    const { doors } = phoneIdentitySource(plugin(), nav());
    expect(doors.link).toEqual({ step: { kind: 'join' } });
    expect(doors.make).toEqual({ step: null, note: MAKE_ON_A_COMPUTER });
    expect(doors.words).toEqual({ step: null, note: WORDS_ON_A_COMPUTER });
  });

  it("joins on the phone's identity page, coming back to where the app was, and never settles here", async () => {
    const pages = nav('/~/space?x=1');
    const opened = phoneIdentitySource(plugin(), pages).open({ kind: 'join' });
    const settled = vi.fn();
    void opened.then(settled);
    await new Promise((r) => setTimeout(r, 10));
    expect(pages.went).toHaveLength(1);
    const url = new URL(pages.went[0], 'https://phone.invalid');
    expect(url.pathname).toBe('/mobile/identity.html');
    expect(url.searchParams.has('join')).toBe(true);
    expect(url.searchParams.get('back')).toBe('/~/space?x=1');
    expect(settled).not.toHaveBeenCalled();
  });

  it('takes "Not now" on the join page as having skipped the first run', () => {
    expect(phoneIdentitySource(plugin(), nav(), () => true).skipped?.()).toBe(true);
    expect(phoneIdentitySource(plugin(), nav(), () => false).skipped?.()).toBe(false);
  });
});

describe('keyHostConnection', () => {
  it('names the executor by its host', () => {
    expect(keyHostConnection(KEY_HOST)).toMatchObject({
      id: 'key-host',
      kind: 'key-host',
      label: 'executor.example:12000',
    });
  });

  it('keeps the whole address as the label when it is not a URL', () => {
    expect(keyHostConnection('not a url').label).toBe('not a url');
  });
});

describe('the phone host', () => {
  it('offers the key host first when the phone was told one, and AD4M Connect always', async () => {
    const told = phoneBaseHost({ plugin: plugin(), fallback, keyHost: () => KEY_HOST, nav: nav() });
    expect((await told.connections()).map((c) => c.kind)).toEqual(['key-host', 'connect']);
    const none = phoneBaseHost({ plugin: plugin(), fallback, keyHost: () => null, nav: nav() });
    expect(await none.connections()).toEqual([CONNECT]);
  });

  it('logs in with the device key on the key host, without sending the person to join a second time', async () => {
    const made = { initialize: async () => ({}) } as unknown as BackendConnector;
    const keyConnector = vi.fn((_deps: DeviceKeyConnectorDeps) => made);
    const p = plugin();
    const host = phoneBaseHost({ plugin: p, fallback, keyHost: () => KEY_HOST, nav: nav(), keyConnector });
    expect(await host.connector(keyHostConnection(KEY_HOST))).toBe(made);
    const deps = keyConnector.mock.calls[0][0];
    expect(deps.plugin?.()).toBe(p);
    expect(deps.keyHost?.()).toBe(KEY_HOST);
    expect(deps.joinDeclined?.()).toBe(true);
  });

  it('hands AD4M Connect the browser connector', async () => {
    const keyConnector = vi.fn();
    const initialize = vi.fn(async () => ({}));
    const host = phoneBaseHost({
      plugin: plugin(),
      fallback: { initialize } as unknown as BackendConnector,
      nav: nav(),
      keyConnector,
      remembered: () => null,
    });
    await (await host.connector(CONNECT)).initialize({} as never);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(keyConnector).not.toHaveBeenCalled();
  });

  /*
    Found on a real phone: relaunched with the executor AD4M Connect signed in to last switched off,
    the app drew AD4M Connect's own connect screen rather than the base's offline state.
  */
  it("hands back as unreachable when AD4M Connect's last executor does not answer", async () => {
    const initialize = vi.fn(async () => ({}));
    const host = phoneBaseHost({
      plugin: plugin(),
      fallback: { initialize } as unknown as BackendConnector,
      nav: nav(),
      online: () => true,
      remembered: () => 'http://10.0.2.2:12000',
      reach: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const failed = await (await host.connector(CONNECT)).initialize({} as never).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ConnectUnreachable);
    expect(host.isUnreachable?.(failed)).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('tells a place it could not reach from one that refused', () => {
    const online = phoneBaseHost({ plugin: plugin(), fallback, nav: nav(), online: () => true });
    expect(online.isUnreachable?.(new KeyLoginUnreachable(KEY_HOST, null))).toBe(true);
    expect(online.isUnreachable?.(new TypeError('Failed to fetch'))).toBe(true);
    expect(online.isUnreachable?.(new Error('The key was refused'))).toBe(false);
    const offline = phoneBaseHost({ plugin: plugin(), fallback, nav: nav(), online: () => false });
    expect(offline.isUnreachable?.(new Error('The key was refused'))).toBe(true);
    expect(offline.online?.()).toBe(false);
  });
});
