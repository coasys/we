/**
 * The phone app's `DeviceKey` plugin, as WE's web build reaches it.
 *
 * The plugin is native code in `apps/we-mobile` (Kotlin, over the Rust crate
 * `crates/phone-custody`): it makes and keeps the phone's device key and enc key, their seeds sealed
 * by the Android Keystore, and signs with the device key. Nothing it returns is secret: public keys,
 * the identity it joined, and signed statements. This module is only its typed surface and the
 * bridge to it; it imports nothing, so WE's web build carries no Capacitor dependency, and in a
 * browser (no native bridge, no plugin) {@link deviceKeyPlugin} answers `null`.
 */

/** The phone's two public keys. */
export interface DevicePublic {
  /** The Ed25519 device key, `z6Mk…`: what signs. */
  sign: string;
  /** The X25519 enc key, `z6LS…`: what a holder seals to. */
  enc: string;
  /** `did:key:` of the device key. */
  didKey: string;
}

/** Where the Keystore keeps the key that seals the seeds. `none` until it has been made. */
export type KeyProtection = 'strongbox' | 'tee' | 'software' | 'unknown' | 'none';

/** The identity whose log lists this phone's device key. */
export interface DeviceIdentity {
  /** The bare scid. */
  scid: string;
  /** `did:scid:coasys:1:<scid>`. */
  did: string;
  /** The log entry that added this phone, when the store said. */
  seq: number | null;
}

/** A claim sent and not answered yet. */
export interface PendingClaim {
  did: string;
  offerId: string;
  store: string;
  /** The code the holder shows too: the person checks the two match. */
  matchCode: string;
}

export interface DeviceKeyStatus {
  keys: DevicePublic | null;
  identity: DeviceIdentity | null;
  pending: PendingClaim | null;
  protection: KeyProtection;
}

/** How a claim stands. */
export type ClaimProgress =
  | { state: 'waiting'; detail: string }
  | { state: 'joined'; did: string; scid: string; seq: number | null }
  | { state: 'ended'; reason: string };

/** What a signed session request asks of the executor. */
export interface SessionSignRequest {
  purpose: 'login' | 'renew';
  /** The executor's DID, from `user.sessionChallenge`. */
  executor: string;
  /** The URL this app dials: the statement's audience is its origin. */
  url: string;
  /** From `user.sessionChallenge`. */
  challenge: string;
  /** The grant a `renew` renews; a `login` names none. */
  grant?: string;
}

/** A `coasys:session` key statement and the device key's signature: `SignedKeyStatement`. */
export interface SignedSessionStatement {
  statement: {
    v: 1;
    purpose: 'login' | 'renew';
    scid: string;
    key: string;
    executor: string;
    audience: string;
    challenge: string;
    client: { kind: 'native' };
    grant?: string;
    issuedAt: number;
  };
  sig: string;
}

/**
 * Why a call was refused: the Rust error's variant (or the plugin's own), as `code`. The ones a
 * caller acts on: `NoKeys`, `KeysExist`, `NoIdentity`, `AlreadyJoined`, `NoClaim`, `Sealer`
 * (the Keystore refused), `Invalid`.
 */
export interface DeviceKeyError extends Error {
  code?: string;
}

/** The plugin's methods. Every one runs off the phone's main thread. */
export interface DeviceKeyPlugin {
  status(): Promise<DeviceKeyStatus>;
  /** Makes the two keys. Refuses (`KeysExist`) when the phone has them already. */
  create(): Promise<DevicePublic & { protection: KeyProtection }>;
  /**
   * Claims the offer in `link` (an offer link a custody holder showed, or the `coasys:offer:1:`
   * string) with this phone's keys, and posts the claim to the offer's store. `hint` is the name
   * the phone suggests for itself.
   */
  join(options: { link: string; hint?: string }): Promise<{
    did: string;
    matchCode: string;
    progress: ClaimProgress;
  }>;
  /** Asks the store how the pending claim stands, for up to `seconds` (60 by default). */
  waitJoined(options?: { seconds?: number }): Promise<{ progress: ClaimProgress }>;
  /** A key statement for one executor, signed by the device key. */
  signSession(request: SessionSignRequest): Promise<SignedSessionStatement>;
}

/** The part of Capacitor's native bridge this uses: present only inside the phone app. */
interface NativeBridge {
  isPluginAvailable?(name: string): boolean;
  nativePromise?(plugin: string, method: string, options?: unknown): Promise<unknown>;
}

const PLUGIN = 'DeviceKey';

/**
 * The plugin, when this page runs in the phone app; `null` in a browser or a desktop shell.
 * `bridge` is for the tests; the app passes nothing and the global is read.
 */
export function deviceKeyPlugin(
  bridge: NativeBridge | undefined = (globalThis as { Capacitor?: NativeBridge }).Capacitor,
): DeviceKeyPlugin | null {
  if (!bridge?.nativePromise || !bridge.isPluginAvailable?.(PLUGIN)) return null;
  const call = <T>(method: string, options?: unknown): Promise<T> =>
    bridge.nativePromise!(PLUGIN, method, options ?? {}) as Promise<T>;
  return {
    status: () => call('status'),
    create: () => call('create'),
    join: (options) => call('join', options),
    waitJoined: (options) => call('waitJoined', options),
    signSession: (request) => call('signSession', request),
  };
}
