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

  /*
    Which device serves this session: this computer, or a server the person reached by its address.
    A server lets this computer in with its device key, so a device the person revokes is let in
    nowhere any more. Present where the backend can sign that login (`switchDevice`).
  */
  /** The devices this account can be served by, and which one serves it now. */
  serving?(): Promise<ServingView>;
  /**
   * Logs in to the server at `address` with this computer's device key, and keeps it in the list
   * once it lets this computer in. Resolves with why not when it does not; never rejects.
   */
  addServer?(address: string): Promise<AddServerOutcome>;
  /** Forgets a server. Not the one serving this session. */
  removeServer?(id: string): Promise<void>;
  /**
   * Serves this account from the device `id` ({@link THIS_COMPUTER_ID}, or a server's id) from now
   * on, and starts the app over against it. Ends this session's login on a server it leaves.
   */
  serveFrom?(id: string): Promise<void>;
  /** Called when the server serving this session ends it. Returns its unsubscribe. */
  onSessionEnded?(listener: (ended: ServingSessionEnded) => void): () => void;
}

/** The id of this computer among the devices that can serve the account. */
export const THIS_COMPUTER_ID = 'this-computer';

/** A device that can serve this account. */
export interface ServingDeviceView {
  /** {@link THIS_COMPUTER_ID}, or the server's address. */
  id: string;
  /** "This computer", or the name the server was saved under (its host). */
  name: string;
  /** The server's address; `null` for this computer. */
  address: string | null;
  /** It serves this session now. */
  current: boolean;
}

export interface ServingView {
  devices: ServingDeviceView[];
  /**
   * What this session is on the server serving it: `operator` runs the server, `agent` is served by
   * it as one of its agents. `null` on this computer.
   */
  role: 'operator' | 'agent' | null;
  /**
   * Why the chosen server does not serve this session, in words a person reads: it was chosen, and
   * this start could not log in there, so this computer serves instead. `null` otherwise.
   */
  problem: string | null;
}

/** How adding a server ended. `reason` is the backend's word for a refusal; `message` says it. */
export type AddServerOutcome = { ok: true; id: string } | { ok: false; reason: string; message: string };

/**
 * How a server ended this session: `revoked` when this computer's device key is no longer one of the
 * person's (the person removed this device), `ended` for anything else (logged out from elsewhere,
 * expired while the app could not renew it).
 */
export interface ServingSessionEnded {
  reason: 'revoked' | 'ended';
  /** The server's id. */
  id: string;
  name: string;
}

/** A change to the identity, signed by the master key. */
export type IdentityChange = { kind: 'create' } | { kind: 'add-device' } | { kind: 'revoke'; keyId: string };

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

/** One device key of the person. */
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
}
