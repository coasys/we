/**
 * The browser's base host: a browser keeps no identity and runs no backend, so the one thing it can
 * offer is Coasys Connect. The person links this browser (or signs in with the key it holds) in
 * the Connect frame on the auth domain and picks one of their own devices there; the session is
 * that device's, and its token stays in this page's memory. Devices and Security are Settings' once
 * it runs.
 */
import type { BackendConnector, BaseConnection, BaseHost } from '@we/app-shell/shared';
import { isUnreachable } from '@we/app-web/platform/deviceKeyConnector';

/** The browser's one place: Coasys Connect's frame. */
export const CONNECT: BaseConnection = {
  id: 'connect',
  kind: 'connect',
  label: 'Link this browser',
  detail: 'Always available. You sign in with one of your own devices.',
};

export function webBaseHost(connector: BackendConnector, deps: { online?: () => boolean } = {}): BaseHost {
  const online = deps.online ?? (() => globalThis.navigator?.onLine ?? true);
  return {
    kind: 'browser',
    connections: () => Promise.resolve([CONNECT]),
    connector: () => Promise.resolve(connector),
    isUnreachable: (error) => isUnreachable(error, online()),
    online,
  };
}
