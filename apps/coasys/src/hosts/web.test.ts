/**
 * The browser's host and the choice between it and the phone's.
 */
import type { BackendConnector } from '@we/app-shell/shared';
import type { DeviceKeyPlugin } from '@we/app-web/platform/deviceKey';
import { describe, expect, it } from 'vitest';

import { chooseHost } from './choose';
import { CONNECT, webBaseHost } from './web';

const connector = { initialize: async () => ({}) } as unknown as BackendConnector;

describe('the browser host', () => {
  it('offers Coasys Connect as its one place, and keeps no identity and runs no executor', async () => {
    const host = webBaseHost(connector);
    expect(host.kind).toBe('browser');
    expect(host.identity).toBeUndefined();
    expect(host.executor).toBeUndefined();
    expect(await host.connections()).toEqual([CONNECT]);
    expect(CONNECT.label).toBe('Link this browser');
  });

  it('hands the Connect connector over as it is: there is no remembered executor to ask first', async () => {
    const host = webBaseHost(connector);
    expect(await host.connector(CONNECT)).toBe(connector);
    expect(await host.connector(CONNECT, { chosen: true })).toBe(connector);
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
