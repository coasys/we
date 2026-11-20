/**
 * An executor as a host: a person joins it as a tenant with their identity, uses it, and leaves keeping
 * their data or deleting it; the person who runs it sets who may join.
 *
 * Two roles, two halves of the port. The **operator** half is the backend this app is signed in to,
 * run by the person at this computer (Sign-ups, People). The **tenant** half is a session on a host
 * the person joined, signed in with their own device key; it is opened on first use and ended with
 * `close`. A backend with no hosts passes neither.
 *
 * The shapes are the executor's own answers, named for the screens: the adapter hands them on without
 * rereading them.
 */

/** Who may join through `join`. */
export type HostSignup = 'anyone' | 'by_invite' | 'no_one';

/** What anyone may know of a host before joining. */
export interface HostInfoView {
  multiUser: boolean;
  signup: HostSignup;
  name: string;
  runByCoasys: boolean;
  /** The tenant cap is reached. */
  full: boolean;
}

export interface HostPolicyView {
  signup: HostSignup;
  /** The cap on tenants; `null` for none. */
  maxTenants: number | null;
  display: { name: string; run_by_coasys: boolean };
  /** True while the operator has never chosen: "No one — choose who may join this device". */
  choiceNeeded: boolean;
}

/** What a change of the policy sets; a field left out stays. */
export interface HostPolicyPatch {
  signup: HostSignup | null;
  /** 0 takes the cap away. */
  maxTenants: number | null;
  displayName: string | null;
}

export interface HostInviteView {
  id: string;
  createdAt: number;
  expiresAt: number;
  /** The tenant record the invite admitted. */
  usedBy: string | null;
  revoked: boolean;
  note: string | null;
}

export interface HostInviteCreated {
  inviteId: string;
  /** Base64url; shown once. The invite link carries it in its fragment. */
  secret: string;
  expiresAt: number;
}

/** A tenant as the operator lists it. `state` is `pending`, `active`, `held`, `detached` or `deleted`. */
export interface HostTenantView {
  tenantId: string;
  didScid: string;
  state: string;
  createdAt: number;
  activatedAt: number | null;
  detachedAt: number | null;
}

/** The host a tenant is on, and a tenant's own use of it. `state` is `active` or `held`. */
export interface TenantUsageView {
  tenantId: string;
  didScid: string;
  state: string;
  activatedAt: number | null;
  host: { name: string; runByCoasys: boolean; operatorDid: string };
  spaces: { perspectiveUuid: string; name: string | null; neighbourhoodUrl: string; sharedWithOtherTenants: boolean }[];
  /** Perspectives with no neighbourhood. */
  privatePerspectives: number;
  storage: { usedBytes: number; measuredAt: string };
  aiRuns: { day: string; count: number };
  spend: {
    freeAccess: boolean;
    credits: number | null;
    rates: { description: string; priceInHot: number }[] | null;
    chargedSoFar: number;
  };
}

/** What leaving did. */
export interface HostLeaveView {
  kept: boolean;
  removedPerspectives: number;
  leftSharedPerspectives: number;
  /** Delete only: when the tenant's data key was destroyed. */
  keyDestroyedAt: string | null;
}

/** What an import wrote. */
export interface HostImportView {
  linksWritten: number;
  /** Written with a failed signature check, and counted. */
  linksInvalid: number;
  /** The spaces of the file, for the app to join. */
  neighbourhoodUrls: string[];
}

/** The calls of the person who runs the host. */
export interface OperatorHostPort {
  info(): Promise<HostInfoView>;
  policy(): Promise<HostPolicyView>;
  setPolicy(patch: HostPolicyPatch): Promise<HostPolicyView>;
  createInvite(expiresInDays?: number, note?: string): Promise<HostInviteCreated>;
  listInvites(): Promise<HostInviteView[]>;
  revokeInvite(inviteId: string): Promise<boolean>;
  tenants(): Promise<HostTenantView[]>;
  /** Removes a detached tenant's record and its kept data; `false` when none was in a state to remove. */
  removeTenant(tenantId: string): Promise<boolean>;
}

/**
 * One host as its tenant. A host answers `not-admitted` to anything but reading, exporting, `usage`
 * and `leave` while the tenant is held; that refusal rejects with {@link isNotAdmitted} true.
 */
export interface TenantHostPort {
  usage(): Promise<TenantUsageView>;
  /** Leaves the host; `keepData` false destroys the tenant's data key there at once. */
  leave(keepData: boolean): Promise<HostLeaveView>;
  /** The gzip export file of the tenant's data, signatures kept. */
  exportFile(): Promise<Uint8Array>;
  /** Imports a file made by `exportFile` into new private perspectives. */
  importFile(file: Uint8Array): Promise<HostImportView>;
  /** Ends the session, and stops renewing it. */
  close(): void;
}

export interface HostPort {
  /** The host this app is signed in to, as its operator. */
  operator: OperatorHostPort;
  /** The host at `url`, as the person's own identity. Nothing is asked until the first call. */
  tenant(url: string): TenantHostPort;
}

/** The host refused a held tenant's call: the answer carries `not-admitted`. */
export function isNotAdmitted(error: unknown): boolean {
  return error instanceof Error && error.message.includes('not-admitted');
}
