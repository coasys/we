/**
 * The phone's base host: the identity is the `DeviceKey` plugin's (its custody, `phoneCustody.ts`), and
 * a session is had with the device key from the executor the phone was told to use, or through AD4M
 * Connect like a browser.
 *
 * A phone joins an identity; it does not make one, and it takes no 12 words — the master key and its
 * words stay with a computer. So of the first run's three doors only "Link to my identity" opens here,
 * on the phone's join page, and the other two say why they are a computer's. Every step leaves for the
 * phone's identity page (`apps/we-mobile/src/identity`), the only place a secret is shown, and the app
 * boots again when that page sends the person back.
 */
import type { BackendConnector, BaseConnection, BaseHost, BaseIdentitySource } from '@we/app-shell/shared';
import type { DeviceKeyPlugin } from '@we/app-web/platform/deviceKey';
import {
  createDeviceKeyConnector,
  type DeviceKeyConnectorDeps,
  KeyLoginUnreachable,
} from '@we/app-web/platform/deviceKeyConnector';
import { joinDeclined, readKeyHost } from '@we/app-web/platform/keyHost';
import { browserNav, identityPageUrl, type PageNav, phoneCustodyHost } from '@we/app-web/platform/phoneCustody';
import { readCustody } from '@we/backend-ad4m';

import { CONNECT, type ReachDeps, reachRemembered, unreachable } from './web';

/** What the phone host is built from; the tests pass their own. */
export interface PhoneHostDeps extends Pick<ReachDeps, 'remembered' | 'reach'> {
  plugin: DeviceKeyPlugin;
  /** The connector AD4M Connect gives: the browser's. */
  fallback: BackendConnector;
  keyHost?: () => string | null;
  joinDeclined?: () => boolean;
  nav?: PageNav;
  online?: () => boolean;
  /** How the key login is made; `createDeviceKeyConnector` with the phone's own parts by default. */
  keyConnector?: (deps: DeviceKeyConnectorDeps) => BackendConnector;
}

export const MAKE_ON_A_COMPUTER =
  'A phone joins an identity rather than making one: make it on your computer, then link this phone to it.';
export const WORDS_ON_A_COMPUTER =
  'The 12 words bring an identity back on a computer, which keeps its master key. Then link this phone to it.';

/** The phone's identity, read from its plugin, with the join as the one door it opens. */
export function phoneIdentitySource(
  plugin: DeviceKeyPlugin,
  nav: PageNav = browserNav,
  declined: () => boolean = joinDeclined,
): BaseIdentitySource {
  const custody = phoneCustodyHost(plugin, nav);
  return {
    state: async () => readCustody(await custody.publicState()),
    doors: {
      make: { step: null, note: MAKE_ON_A_COMPUTER },
      link: { step: { kind: 'join' } },
      words: { step: null, note: WORDS_ON_A_COMPUTER },
    },
    open(step) {
      if (step.kind === 'join') {
        nav.assign(identityPageUrl('join', nav.here()));
        // The page is left; the app boots again when the identity page sends the person back.
        return new Promise(() => {});
      }
      return custody.open(step);
    },
    // "Not now" on the phone's own join page is the same answer as "Start now" here.
    skipped: declined,
  };
}

/** The executor a phone's key logs in to, as a connection: named by its host. */
export function keyHostConnection(url: string): BaseConnection {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // `readKeyHost` only hands out http(s) URLs; the whole of one is still a fair label.
  }
  return {
    id: 'key-host',
    kind: 'key-host',
    label: host,
    detail: "Signs in with this phone's device key, asking you for nothing",
  };
}

export function phoneBaseHost(deps: PhoneHostDeps): BaseHost {
  const keyHost = deps.keyHost ?? (() => readKeyHost());
  const declined = deps.joinDeclined ?? joinDeclined;
  const nav = deps.nav ?? browserNav;
  const online = deps.online ?? (() => globalThis.navigator?.onLine ?? true);
  const makeKeyConnector =
    deps.keyConnector ?? ((d: DeviceKeyConnectorDeps) => createDeviceKeyConnector(deps.fallback, d));
  return {
    kind: 'phone',
    identity: phoneIdentitySource(deps.plugin, nav, declined),
    connections: async () => {
      const url = keyHost();
      return url ? [keyHostConnection(url), CONNECT] : [CONNECT];
    },
    connector: async (connection) => {
      if (connection.kind !== 'key-host')
        return reachRemembered(deps.fallback, { remembered: deps.remembered, reach: deps.reach, online });
      return makeKeyConnector({
        plugin: () => deps.plugin,
        keyHost,
        nav,
        // The base app asks about joining itself, before a connection is chosen; the connector must
        // not send the person to the join page a second time.
        joinDeclined: () => true,
      });
    },
    isUnreachable: (error) => error instanceof KeyLoginUnreachable || unreachable(error, online),
    online,
  };
}
