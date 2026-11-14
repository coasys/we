/**
 * The browser's host and the choice between it and the phone's.
 */
import type { BackendConnector } from '@we/app-shell/shared';
import type { DeviceKeyPlugin } from '@we/app-web/platform/deviceKey';
import { describe, expect, it, vi } from 'vitest';

import { chooseHost } from './choose';
import { CONNECT, ConnectUnreachable, reachRemembered, webBaseHost } from './web';

const connector = { initialize: async () => ({}) } as unknown as BackendConnector;

describe('the browser host', () => {
  it('offers AD4M Connect as its one place, and keeps no identity and runs no executor', async () => {
    const host = webBaseHost(connector);
    expect(host.kind).toBe('browser');
    expect(host.identity).toBeUndefined();
    expect(host.executor).toBeUndefined();
    expect(await host.connections()).toEqual([CONNECT]);
  });

  it('hands AD4M Connect over once the executor it signed in to last answers', async () => {
    const initialize = vi.fn(async () => ({}));
    const reach = vi.fn(async () => {});
    const host = webBaseHost({ initialize } as unknown as BackendConnector, {
      remembered: () => 'http://10.0.2.2:12000',
      reach,
    });
    await (await host.connector(CONNECT)).initialize({} as never);
    expect(reach).toHaveBeenCalledWith('http://10.0.2.2:12000');
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  /*
    A relaunch whose remembered executor did not answer drew AD4M Connect's own "How would you like
    to connect?" over the app, as if the person had never chosen: the base app's offline state, with
    its reason and "Try again", is what such a relaunch is due.
  */
  it('hands back as unreachable, before AD4M Connect draws anything, when that executor does not answer', async () => {
    const initialize = vi.fn(async () => ({}));
    const host = webBaseHost({ initialize } as unknown as BackendConnector, {
      remembered: () => 'http://10.0.2.2:12000',
      reach: async () => {
        throw new TypeError('Failed to fetch');
      },
      online: () => true,
    });
    const failed = await (await host.connector(CONNECT)).initialize({} as never).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ConnectUnreachable);
    expect((failed as Error).message).toBe("Can't reach 10.0.2.2:12000.");
    expect(host.isUnreachable?.(failed)).toBe(true);
    expect(initialize).not.toHaveBeenCalled();
  });

  /*
    Lal's P2 on #438: "Choose another place", then AD4M Connect, asked the dead executor again and
    came back Offline, so AD4M Connect's own screen, where a new address is entered, never opened.
    Only a resume and "Try again" are asked first; a person choosing AD4M Connect gets its screen.
  */
  it('opens AD4M Connect when the person chooses it, without asking the executor that did not answer', async () => {
    const initialize = vi.fn(async () => ({}));
    const reach = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const host = webBaseHost({ initialize } as unknown as BackendConnector, {
      remembered: () => 'http://10.0.2.2:12000',
      reach,
      online: () => true,
    });
    await (await host.connector(CONNECT, { chosen: true })).initialize({} as never);
    expect(reach).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('leaves an answer that is not about reaching it to AD4M Connect, which has words for it', async () => {
    const initialize = vi.fn(async () => ({}));
    const wrapped = reachRemembered({ initialize } as unknown as BackendConnector, {
      remembered: () => 'http://10.0.2.2:12000',
      reach: async () => {
        throw new Error('Health check returned 404');
      },
      online: () => true,
    });
    await wrapped.initialize({} as never);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('asks nothing first with no session remembered: the first connect is AD4M Connect choosing', async () => {
    const initialize = vi.fn(async () => ({}));
    const reach = vi.fn(async () => {});
    const wrapped = reachRemembered({ initialize } as unknown as BackendConnector, { remembered: () => null, reach });
    await wrapped.initialize({} as never);
    expect(reach).not.toHaveBeenCalled();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('tells a place it could not reach from one that refused', () => {
    const host = webBaseHost(connector, { online: () => true });
    expect(host.isUnreachable?.(new TypeError('Failed to fetch'))).toBe(true);
    expect(host.isUnreachable?.(new Error('The token was refused'))).toBe(false);
    expect(webBaseHost(connector, { online: () => false }).isUnreachable?.(new Error('x'))).toBe(true);
  });
});

describe('chooseHost', () => {
  it("is the phone's where the device key plugin answers, and the browser's everywhere else", () => {
    expect(chooseHost({ plugin: null, fallback: connector }).kind).toBe('browser');
    expect(chooseHost({ plugin: {} as DeviceKeyPlugin, fallback: connector }).kind).toBe('phone');
  });
});
