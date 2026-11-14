/**
 * An agent's identity, beyond the session it is signed in with: the ways in (a password, a passkey),
 * the key that is them (a master key, recovery words, the log of every key change), the devices that
 * act as them, the bots that act for them, and what their plan allows.
 *
 * ## Why a port with little in it yet
 *
 * Settings shows all of this — the person's account is part of the app, not a site beside it — and the
 * backend that holds it is being built. So the screens come first, against this contract, and say
 * "coming soon" for whatever the backend in use cannot do. Hooking a backend up is then writing an
 * adapter, not reworking the screens, and a backend that never gains these keeps working with them
 * greyed out.
 *
 * Optional, like every port a backend may not have: absent, every capability is off.
 *
 * ## Capabilities first, then the calls a backend answers
 *
 * What a screen needs to decide is whether to offer a control, so the contract starts there. The
 * calls behind each control are added with the backend that answers them — a method nothing implements
 * is a guess at a shape, and the shape is the backend's to settle.
 *
 * ## Reads, and changes the port never sees the inside of
 *
 * `status`, `log` and `devices` are reads. A change — making the identity, adding a device, revoking
 * one — is signed by the master key, and where that key is kept is the backend's business: one
 * backend keeps it in a custody service its desktop host runs, another might keep it in a hardware
 * key or behind a provider's own sign-in. So the port asks for a change by kind (`change`) and learns
 * how it ended; the words, the passphrase and the key never pass through it, and nothing above the
 * port knows what holds them. `custody` says whether this computer can sign changes at all, and why
 * not when it cannot.
 */

import type { BotPort } from './bots';

/** What the identity backend can do, one switch per part of Settings. */
export interface IdentityCapabilities {
  /** Change the password the account is unlocked with. */
  password: boolean;
  /** Sign in with a passkey. */
  passkey: boolean;
  /** A master key the person holds, which can be added to another device or replaced. */
  masterKey: boolean;
  /** Twelve recovery words, shown once and asked for to recover. */
  recoveryWords: boolean;
  /** The log of every key change, readable and exportable. */
  keyLog: boolean;
  /** Take everything to another provider: the key log and private spaces, as a file. */
  export: boolean;
  /** Sign every device out at once. */
  logOutEverywhere: boolean;
  /** Close the account. */
  deleteAccount: boolean;
  /** List the devices that act as the person, and remove one. */
  devices: boolean;
  /** Link another device by a code or a scan. */
  linkDevice: boolean;
  /** Choose which device serves this session. */
  switchDevice: boolean;
  /** Bots with keys of their own, acting for the person within what they were granted. */
  bots: boolean;
  /** What the person's plan includes and how much of it is used. */
  plan: boolean;
  /** Paying for a plan. */
  billing: boolean;
}

export const NO_IDENTITY_CAPABILITIES: IdentityCapabilities = {
  password: false,
  passkey: false,
  masterKey: false,
  recoveryWords: false,
  keyLog: false,
  export: false,
  logOutEverywhere: false,
  deleteAccount: false,
  devices: false,
  linkDevice: false,
  switchDevice: false,
  bots: false,
  plan: false,
  billing: false,
};

export interface IdentityPort {
  /** What this backend can do. Asked once a session is usable; a backend may answer asynchronously. */
  capabilities(): IdentityCapabilities | Promise<IdentityCapabilities>;
  /**
   * What this session's device key speaks for: the person's `did:scid`, or `null` while it speaks
   * for nobody yet. Absent on a backend with no key log.
   */
  status?(): Promise<IdentityStatusView>;
  /** The person's key log, oldest first, every event already checked by the backend. */
  log?(did: string): Promise<KeyLogView>;
  /** The device keys the log lists, revoked ones included. */
  devices?(): Promise<DeviceKeyView[]>;
  /**
   * Called when the backend finds two different logs for one identity (a fork). Returns its
   * unsubscribe.
   */
  onFork?(listener: (fork: KeyLogFork) => void): () => void;
  /**
   * Whether this computer can sign changes to the identity, as public facts. Absent on a backend
   * that cannot change an identity from here; the screens then offer no change.
   */
  custody?(): Promise<IdentityCustodyView>;
  /**
   * Runs a change wherever the master key is kept, and resolves with how it ended. The person is
   * asked there, not here: whatever the backend shows them (its own window, a device prompt) is its
   * own confirmation. Rejects only when the change could not be started at all.
   */
  change?(change: IdentityChange): Promise<IdentityChangeOutcome>;
  /**
   * The person's bots and their grants. Absent on a backend that runs no bots; a bot's key is added
   * with `change({ kind: 'add-bot' })`, where the master key is kept.
   */
  bots?: BotPort;
}

/**
 * A change to the identity, or a step toward one, run where the master key is kept.
 *
 * - `create`: make the identity.
 * - `add-device`: give a server an offer link.
 * - `scan-device`: add a device by the code it shows.
 * - `show-code`: on a computer of no identity yet, show its code for a device of the identity to add.
 * - `take-master`: keep the master key another device sent here.
 * - `ask-master`: ask a device that keeps the master key to send it here.
 * - `answer-request`: answer what another device asked (send the master key, revoke devices).
 * - `rename`: name a device, in the private record only its devices read.
 * - `revoke`: revoke a device, and replace the master key in the same step where the person chooses.
 * - `replace-master`: replace the master key from the 12 words, so every copy kept until now stops.
 * - `restore`: on a computer of no identity yet, bring the identity back from the 12 words, locking
 *   out the devices the person picks.
 * - `remove-master`: stop keeping the master key on this computer; refused for the only copy.
 * - `add-bot`: open a bot offer of the scope the person picks there, and add the bot's key once it
 *   claims; the bot is made with `bots.create` from the offer.
 */
export type IdentityChange =
  | { kind: 'create' }
  | { kind: 'add-device' }
  | { kind: 'scan-device' }
  | { kind: 'show-code' }
  | { kind: 'take-master' }
  | { kind: 'ask-master' }
  | { kind: 'answer-request'; id: string }
  | { kind: 'rename'; keyId: string }
  | { kind: 'revoke'; keyId: string }
  | { kind: 'replace-master' }
  | { kind: 'restore' }
  | { kind: 'remove-master' }
  | { kind: 'add-bot' };

/** How a change ended: made, abandoned by the person, or refused along the way. */
export type IdentityChangeOutcome = 'done' | 'cancelled' | 'failed';

/** Whether this computer can sign changes to the identity: public facts, never a secret. */
export interface IdentityCustodyView {
  /** The identity whose master key this computer keeps, or `null`. */
  did: string | null;
  /** This computer keeps a master key of `did`. */
  holdsMaster: boolean;
  /** How the key is unlocked here: the operating system's own prompt, or a passphrase. */
  unlock: 'os' | 'passphrase' | null;
  /** Why no change can be made here, in words a person reads; `null` when one can. */
  blocked: string | null;
  /**
   * The devices the identity's private record names, which only its devices can read. Empty before
   * the first one is named, and where the record cannot be read now.
   */
  devices: DeviceNameView[];
  /**
   * The revoked keys that may still hold a valid master key, as the key log says: it let them keep
   * the master key, and none has replaced it since. A revoke leaves a copy of the master key valid,
   * and the private record drops a revoked key's entry, so only the log keeps this.
   */
  revokedHolders: string[];
  /** What other devices asked and is waiting for an answer from a device that keeps the master key. */
  requests: DeviceRequestView[];
  /** A master key another device sent waits for this computer to take it. */
  masterWaiting: boolean;
}

/** A device as the private record names it. */
export interface DeviceNameView {
  keyId: string;
  name: string;
  /** `desktop-app`, `server`, … as the record says. */
  kind: string;
  /** Whether it keeps the master key: yes, no, or sent and not yet taken. */
  holdsMaster: 'yes' | 'no' | 'offered';
}

/** A request of another device, waiting for an answer. */
export interface DeviceRequestView {
  id: string;
  kind: 'send-master' | 'confirm-revoke';
  /** The key id of the device that asked. */
  by: string;
  /** For `confirm-revoke`: the keys it asks to revoke. */
  keyIds: string[];
  /** Unix seconds. */
  expires: number;
}

/** Two different events at one place in a log, as the backend recorded them. */
export interface KeyLogFork {
  seq: number;
  ours: string;
  theirs: string;
}

/** The head of a log, as the shared store signed it. */
export interface KeyLogHead {
  seq: number;
  hash: string;
  /** Unix seconds. */
  time: number;
  /** The store that signed it, as a `did:key`. */
  store: string;
}

/** What this session's device key speaks for. */
export interface IdentityStatusView {
  /** The person's `did:scid`, or `null` while this device speaks for nobody. */
  did: string | null;
  /** This device's key, a multikey. */
  deviceKey: string;
  /** This device's id in the log (`d1`), once the log lists it. */
  keyId: string | null;
  /** The seq of the event that revoked this device, if one did. */
  revoked: number | null;
  head: KeyLogHead | null;
  fork: KeyLogFork | null;
  /**
   * Set while the shared store answers this log behind what the backend has already checked (a
   * store restored from a backup, or not caught up): the backend answers from what it holds
   * meanwhile. `null` once the store catches up, and on a backend that does not say.
   */
  storeBehind: KeyLogStoreBehind | null;
}

/** The shared store answering a log behind the backend's own copy. */
export interface KeyLogStoreBehind {
  /** When the backend first saw it behind, in unix seconds. */
  since: number;
  /** The seq of the store's head at its last answer; `null` when it answered no log. */
  seq: number | null;
}

/** One device key a log event names. */
export interface KeyLogDevice {
  id: string;
  sign: string;
}

/** One event of a key log, in the words a screen needs. */
export interface KeyLogEvent {
  seq: number;
  /** `incept`, `add`, `revoke`, `rotate`, or whatever a later format adds. */
  op: string;
  /** The event's hash in the log, the next event's `prev`, where the backend reports one. */
  hash: string | null;
  /** The device keys this event adds. */
  added: KeyLogDevice[];
  /** The device key ids this event revokes. */
  revoked: string[];
}

export interface KeyLogView {
  did: string;
  events: KeyLogEvent[];
  head: KeyLogHead | null;
  fork: KeyLogFork | null;
}

/** One key of the person's key log: a device's, or a bot's (`bot` set). */
export interface DeviceKeyView {
  keyId: string;
  /** The key, a multikey. */
  sign: string;
  /** Whether it is this session's own device key. */
  thisDevice: boolean;
  /** The seq of the event that added it. */
  addedSeq: number;
  /** The seq of the event that revoked it, or `null` while it is valid. */
  revokedSeq: number | null;
  /**
   * The key log's bot mark and the scope it gives the key: the key is a bot's, not a device's. This
   * is the one trusted source for that; the private record's `kind` is the person's own label and
   * never decides it. `null` or absent for a device key.
   */
  bot?: { can: string[]; expires: number | null } | null;
  /** When the key ends, unix seconds, as the key log says; `null` or absent for no end. */
  expires?: number | null;
}
