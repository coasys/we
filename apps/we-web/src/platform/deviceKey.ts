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
 * (the Keystore refused), `Invalid`, `NoBiometrics`, `WeakProtection`, `Ended` (a link is over),
 * `CameraDenied`, `NoCamera`, `Cancelled`.
 */
export interface DeviceKeyError extends Error {
  code?: string;
}

/** The identity as this phone sees it, from the store. */
export interface PhoneIdentityView {
  did: string;
  /** This phone's id in the log (`d3`); `null` before the store lists it. */
  keyId: string | null;
  fingerprint: string;
  /** The log entry that revoked this phone, when one did. */
  revoked: number | null;
  /** The index of the master key this phone keeps, when it keeps one. */
  masterIndex: number | null;
  /** Where the master-key sealer's key is: `strongbox`, `tee`, `software` or `unknown`. */
  protection: string;
  store: string;
  /** The log's head seq. */
  head: number | null;
  /** The phone has a strong biometric enrolled: without one it cannot keep the master key. */
  biometrics: boolean;
}

/** A master key taken from the inbox. `note`: kept, but the record does not say so yet. */
export interface MasterTaken {
  did: string;
  index: number;
  note: string | null;
}

/** A request this phone posted for the master key. */
export interface MasterAsked {
  requestId: string;
  keyId: string;
  fingerprint: string;
  /** The code the answering device shows beside the request. */
  code: string;
}

/** Another device's request, as the holder sees it. */
export interface DeviceRequestView {
  id: string;
  kind: 'send-master' | 'confirm-revoke';
  /** The posting device's key id. */
  by: string;
  /** The posting device's name. */
  device: string;
  fingerprint: string;
  /** The code the posting device shows. */
  code: string;
  /** For `confirm-revoke`: the names of the devices to revoke. */
  targets: string[];
  /** For `confirm-revoke`: their key ids, in the order of `targets`. */
  targetKeys: string[];
  rotate: boolean;
  /** Unix seconds. */
  expires: number;
  /** Why it cannot be answered here; `null` when it can. */
  problem: string | null;
}

/** A request answered. `note`: a later step (the record write) that did not pass. */
export interface RequestAnswered {
  kind: string;
  device: string;
  note: string | null;
}

/** One device of the identity: the log's key with the record's details. */
export interface PhoneDeviceView {
  keyId: string;
  fingerprint: string;
  name: string;
  /** `phone-app`, `desktop-app`, …; `null` when the record does not say. */
  kind: string | null;
  addedSeq: number;
  revokedSeq: number | null;
  thisDevice: boolean;
  holdsMaster: 'yes' | 'offered' | 'no';
  masterIndex: number | null;
  /** The log lets it keep the master key. */
  mayKeepMaster: boolean;
  bot: boolean;
}

/** How a link this phone runs as the holder stands. */
export type LinkStep =
  | { step: 'ticket-sent'; expires: number }
  | { step: 'claimed'; code: string; hint: string | null; canKeepMaster: boolean }
  | { step: 'linked'; keyId: string; seq: number; masterSent: boolean; note: string | null };

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
  /** The identity as the store has it now. */
  identityStatus(): Promise<PhoneIdentityView>;
  /**
   * Takes the master key waiting in this phone's inbox and seals it behind the biometric; `null`
   * when none is waiting. Refused with `NoBiometrics` on a phone without one, and with
   * `WeakProtection` when the Keystore is not secure hardware and the person declined.
   */
  takeMaster(): Promise<{ taken: MasterTaken | null }>;
  /** Asks the devices that hold the master key to send it here. */
  askForMaster(): Promise<MasterAsked>;
  /** Whether a master key another device sent waits here, without taking it (no prompt). */
  masterWaiting(): Promise<{ waiting: boolean }>;
  /** Requests of other devices this phone can answer. */
  requests(): Promise<{ requests: DeviceRequestView[] }>;
  /** Answers a request; asks for the biometric to use the master key. */
  answer(options: { id: string }): Promise<RequestAnswered>;
  devices(): Promise<{ devices: PhoneDeviceView[] }>;
  rename(options: { keyId: string; name: string }): Promise<Record<string, never>>;
  revoke(options: { keyIds: string[] }): Promise<{ note: string | null }>;
  /** Starts linking the device whose `coasys:device:1:` code this is; the link's id. */
  scanDevice(options: { code: string }): Promise<{ link: string }>;
  /** Waits for the link's next step. */
  linkNext(options: { link: string }): Promise<LinkStep>;
  /** The codes matched: add the device, with its name, and send it the master key or not. */
  linkConfirm(options: { link: string; name?: string; keepMaster?: boolean }): Promise<Record<string, never>>;
  linkCancel(options: { link: string }): Promise<Record<string, never>>;
  /**
   * Opens the camera on a QR code whose text starts with `prefix`. Refused with `CameraDenied`,
   * `NoCamera` or `Cancelled`.
   */
  scanCode(options: { prefix: string; title?: string }): Promise<{ text: string }>;
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
    identityStatus: () => call('identityStatus'),
    takeMaster: () => call('takeMaster'),
    askForMaster: () => call('askForMaster'),
    masterWaiting: () => call('masterWaiting'),
    requests: () => call('requests'),
    answer: (options) => call('answer', options),
    devices: () => call('devices'),
    rename: (options) => call('rename', options),
    revoke: (options) => call('revoke', options),
    scanDevice: (options) => call('scanDevice', options),
    linkNext: (options) => call('linkNext', options),
    linkConfirm: (options) => call('linkConfirm', options),
    linkCancel: (options) => call('linkCancel', options),
    scanCode: (options) => call('scanCode', options),
  };
}
