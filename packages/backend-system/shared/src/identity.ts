/**
 * An agent's identity, beyond the session it is signed in with: the ways in (a password, a passkey),
 * the key that is them (a master key, recovery words, the log of every key change), the devices that
 * act as them, the bots that act for them, and what their plan allows.
 *
 * ## Why a port with nothing in it yet
 *
 * Settings shows all of this — the person's account is part of the app, not a site beside it — and the
 * backend that holds it is being built. So the screens come first, against this contract, and say
 * "coming soon" for whatever the backend in use cannot do. Hooking a backend up is then writing an
 * adapter, not reworking the screens, and a backend that never gains these keeps working with them
 * greyed out.
 *
 * Optional, like every port a backend may not have: absent, every capability is off.
 *
 * ## Capabilities first, then the reads a backend answers
 *
 * What a screen needs to decide is whether to offer a control, so the contract starts there. The
 * calls behind each control are added with the backend that answers them — a method nothing implements
 * is a guess at a shape, and the shape is the backend's to settle. The key log and the device list
 * arrived with AD4M's `identity.*` calls: `status`, `log` and `devices` are reads.
 *
 * Nothing here changes the identity. Every change — making it, adding a device, revoking one — is
 * signed by the master key, which no backend and no web view holds: the desktop shell's custody
 * service does, behind its own window (`PlatformAdapter.identity`).
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

/**
 * A KEL event as the backend serves it (`did:scid:coasys:1`), read into {@link KeyLogEvent}.
 * Tolerant of fields it does not know, and of a malformed event, which becomes `op: 'unknown'`
 * rather than a thrown error: a key log screen that shows five events of six is still a key log.
 */
export function readKeyLogEvent(raw: unknown, hash: string | null = null): KeyLogEvent {
  const event = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const devices = Array.isArray(event.add) ? event.add : [];
  return {
    seq: typeof event.seq === 'number' ? event.seq : -1,
    op: typeof event.op === 'string' ? event.op : 'unknown',
    hash,
    added: devices
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({ id: String(d.id ?? ''), sign: String(d.sign ?? '') })),
    revoked: Array.isArray(event.revoke) ? event.revoke.map(String) : [],
  };
}
