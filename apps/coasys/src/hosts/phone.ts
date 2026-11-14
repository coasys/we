/**
 * The phone's base host: the identity is the `DeviceKey` plugin's (its custody, `phoneCustody.ts`), and
 * a session is had with the device key from the executor the phone was told to use, or through AD4M
 * Connect like a browser.
 *
 * A phone joins an identity; it does not make one, and it takes no 12 words — the master key and its
 * words stay with a computer. So of the first run's three doors only "Link to another device" opens here,
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

import { CONNECT, connectFor, type ReachDeps, unreachable } from './web';

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

export const MAKE_ON_A_COMPUTER = 'Create it on a computer, then link this phone.';
export const WORDS_ON_A_COMPUTER = 'Restore on a computer, then link this phone.';

/** The phone's identity, read from its plugin, with the join as the one door it opens. */
export function phoneIdentitySource(
  plugin: DeviceKeyPlugin,
  nav: PageNav = browserNav,
  declined: () => boolean = joinDeclined,
): BaseIdentitySource {
  const custody = phoneCustodyHost(plugin, nav);
  return {
    state: async () => {
      const state = await custody.publicState();
      // A store it could not read says nothing of whether there is an identity: a read that failed,
      // which the base app says and reads again, not "none" and the first run.
      if (state.did === null && state.blocked) throw new Error(state.blocked);
      return readCustody(state);
    },
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
    // "Not now" on the phone's own join page is the same answer as "Skip for now" here.
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
    detail: 'Signs in automatically',
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
    connections: () => {
      const url = keyHost();
      return Promise.resolve(url ? [keyHostConnection(url), CONNECT] : [CONNECT]);
    },
    connector: (connection, how) => {
      if (connection.kind !== 'key-host')
        return Promise.resolve(
          connectFor(deps.fallback, how, { remembered: deps.remembered, reach: deps.reach, online }),
        );
      return Promise.resolve(
        makeKeyConnector({
          plugin: () => deps.plugin,
          keyHost,
          nav,
          // The base app asks about joining itself, before a connection is chosen; the connector must
          // not send the person to the join page a second time.
          joinDeclined: () => true,
        }),
      );
    },
    isUnreachable: (error) => error instanceof KeyLoginUnreachable || unreachable(error, online),
    online,
  };
}
