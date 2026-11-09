/**
 * The browser's base host: a browser keeps no identity and runs no backend, so the one thing it can
 * offer is AD4M Connect, which asks where the person's executor is (an address, a Coasys account) and
 * signs in there. The identity comes with that session; Devices and Security are Settings' once it
 * runs.
 */
import type { BackendConnector, BaseConnection, BaseHost } from '@we/app-shell/shared';

/** The browser's one place: AD4M Connect's own screen. */
export const CONNECT: BaseConnection = {
  id: 'connect',
  kind: 'connect',
  label: 'AD4M Connect',
  detail: 'Sign in to the executor that keeps your data: on your computer, a server, or a Coasys account',
};

export function webBaseHost(connector: BackendConnector): BaseHost {
  return {
    kind: 'browser',
    connections: async () => [CONNECT],
    connector: async () => connector,
    online: () => globalThis.navigator?.onLine ?? true,
  };
}
