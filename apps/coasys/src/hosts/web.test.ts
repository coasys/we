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
  it('offers AD4M Connect as its one place, and keeps no identity and runs no executor', async () => {
    const host = webBaseHost(connector);
    expect(host.kind).toBe('browser');
    expect(host.identity).toBeUndefined();
    expect(host.executor).toBeUndefined();
    expect(await host.connections()).toEqual([CONNECT]);
    expect(await host.connector(CONNECT)).toBe(connector);
  });
});

describe('chooseHost', () => {
  it("is the phone's where the device key plugin answers, and the browser's everywhere else", () => {
    expect(chooseHost({ plugin: null, fallback: connector }).kind).toBe('browser');
    expect(chooseHost({ plugin: {} as DeviceKeyPlugin, fallback: connector }).kind).toBe('phone');
  });
});
