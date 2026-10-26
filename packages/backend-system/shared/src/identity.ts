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
 * ## Capabilities, not methods, for now
 *
 * What a screen needs to decide is whether to offer a control, so the contract starts there. The
 * calls behind each control are added with the backend that answers them — a method nothing implements
 * is a guess at a shape, and the shape is the backend's to settle.
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
}
