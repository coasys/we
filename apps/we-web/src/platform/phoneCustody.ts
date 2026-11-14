/**
 * The phone's custody service, as WE's Settings reaches it: the `DeviceKey` plugin, which keeps the
 * master key behind the biometric (`crates/phone-custody`).
 *
 * The reads are the plugin's, from the store: who this phone is, the devices and who keeps the
 * master key, the requests it can answer, and whether a master key waits for it. A change runs on
 * the phone's identity page (`apps/we-mobile/src/identity`, the same identity window the desktop
 * opens), so `open` leaves for that page with the change and where to come back to; WE boots again
 * when it returns, and Settings reads the state afresh.
 *
 * The phone takes the 12 words as a computer does: making an identity, restoring one and replacing
 * the master key run on the identity page too. An identity made here whose publish did not go through
 * is published again each time the state is read (`finishPending`), as the desktop's custody service
 * does; until it is, the state names it as `pending`.
 */
import type { Ad4mCustodyHost, Ad4mCustodyState } from '@we/backend-ad4m';

import type { DeviceKeyError, DeviceKeyPlugin } from './deviceKey';

/** A change Settings asks for, as the backend's identity port hands it on. */
export type IdentityChange = Parameters<Ad4mCustodyHost['open']>[0];

/** The phone's identity page, as `apps/we-mobile` builds it. */
export const IDENTITY_PAGE = '/mobile/identity.html';

/** Where the page is, and how to leave for another; the tests pass their own. */
export interface PageNav {
  /** This page's path, search and hash: where the identity page comes back to. */
  here(): string;
  assign(url: string): void;
}

/** The WebView's own page. */
export const browserNav: PageNav = {
  here: () => {
    const l = globalThis.location;
    return l ? `${l.pathname}${l.search}${l.hash}` : '/';
  },
  assign: (url) => globalThis.location?.assign(url),
};

/** The identity page's address for `change`, coming back to `back`. */
export function identityPageUrl(change: IdentityChange | 'join', back: string): string {
  const params = new URLSearchParams();
  if (change === 'join') params.set('join', '');
  else params.set('change', JSON.stringify(change));
  params.set('back', back);
  return `${IDENTITY_PAGE}?${params.toString()}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' ? error : 'no details';
}

/** The kind the private record gives a phone (`crates/phone-custody`). */
export const PHONE_KIND = 'phone-app';

/** The custody service over the phone's plugin. */
export function phoneCustodyHost(plugin: DeviceKeyPlugin, nav: PageNav = browserNav): Ad4mCustodyHost {
  /**
   * An identity made here and not published yet is published now: `published` when it went through
   * (the store lists the phone now, so the state is read again), its DID when it is still pending,
   * `null` when there is none.
   */
  async function finishMade(): Promise<'published' | string | null> {
    // A plugin that cannot say has nothing to publish this read: the phone is in no identity.
    const { did } = await plugin.pendingIdentity().catch(() => ({ did: null }));
    if (did === null) return null;
    try {
      return (await plugin.finishPending()).did === null ? null : 'published';
    } catch {
      // The store did not answer: it stays pending, and is published again at the next read.
      return did;
    }
  }

  // Read again once a made identity is published: the store lists the phone now. A second read finds
  // nothing pending, so this runs once.
  const publishedState = () => host.publicState();

  const host: Ad4mCustodyHost = {
    open(change) {
      nav.assign(identityPageUrl(change, nav.here()));
      // The page is left: WE boots again when the identity page sends the person back.
      return new Promise(() => {});
    },

    async publicState(): Promise<Ad4mCustodyState> {
      // This device is the phone, whatever the executor it reaches calls its own key: Settings
      // marks the phone's key "This phone", and the executor's computer is one more device.
      let status;
      try {
        status = await plugin.identityStatus();
      } catch (error) {
        const thisDevice = { keyId: null, kind: PHONE_KIND };
        const code = (error as DeviceKeyError).code;
        const made = code === 'NoIdentity' ? await finishMade() : null;
        if (made === 'published') return publishedState();
        if (made !== null) return { did: null, pending: made, holdsMaster: null, unlock: null, thisDevice };
        if (code === 'NoIdentity' || code === 'NoKeys') {
          return { did: null, holdsMaster: null, unlock: null, thisDevice };
        }
        return {
          did: null,
          holdsMaster: null,
          unlock: null,
          blocked: `Can’t load your devices. Try again later. (${messageOf(error)})`,
          thisDevice,
        };
      }
      const holds = status.masterIndex !== null;
      const base: Ad4mCustodyState = {
        did: status.did,
        holdsMaster: holds ? { index: status.masterIndex } : null,
        unlock: holds ? 'os' : null,
        thisDevice: { keyId: status.keyId, kind: PHONE_KIND },
      };
      if (status.revoked !== null) {
        return { ...base, blocked: 'This phone was removed. It can’t make changes to your identity.' };
      }
      const [devices, requests, waiting] = await Promise.all([
        plugin.devices().then((r) => r.devices),
        plugin.requests().then((r) => r.requests),
        // Asked where the key is kept too: a newer master key can wait, and a mark the record is
        // still owed for the kept one (a take whose record write was cancelled or failed) is made
        // by the same "Take the master key". A question that cannot be answered offers nothing.
        plugin.masterWaiting().then(
          (r) => r.waiting,
          () => false,
        ),
      ]);
      return {
        ...base,
        devices: devices
          .filter((d) => d.revokedSeq === null)
          .map((d) => ({
            keyId: d.keyId,
            name: d.name,
            kind: d.kind ?? '',
            holdsMaster: d.holdsMaster === 'yes' ? true : d.holdsMaster === 'offered' ? 'offered' : false,
          })),
        // One the phone cannot answer (its `problem`) is left for a device that can.
        requests: requests
          .filter((r) => r.problem === null)
          .map((r) => ({ id: r.id, kind: r.kind, by: r.by, keyIds: r.targetKeys, expires: r.expires })),
        revokedHolders: devices.filter((d) => d.revokedSeq !== null && d.mayKeepMaster).map((d) => d.keyId),
        masterWaiting: waiting,
      };
    },
  };
  return host;
}
