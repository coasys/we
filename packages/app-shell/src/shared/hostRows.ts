/**
 * What the host screens say, worded once: a tenant's usage, the people on a host the person runs, and
 * the invites they sent. The views read these rows rather than the host's raw answers, so a state the
 * host adds later is shown as "Unknown" instead of as nothing.
 *
 * Times from the host are Unix seconds, as every other time the executor serves.
 */
import type { HostInviteView, HostSignup, HostTenantView, TenantUsageView } from '@we/backend-shared';

export interface UsageLines {
  host: string;
  /** "Free during the closed beta", or what the host charges. */
  spend: string;
  storage: string;
  aiRuns: string;
  /** What spaces and private perspectives the host keeps for this person. */
  spaces: { name: string; shared: string }[];
  privateSpaces: string;
}

export interface PersonRow {
  id: string;
  label: string;
  state: string;
  /** "Remove" is offered: a person who left and kept their data on this host leaves it there until removed. */
  canRemove: boolean;
  since: string;
}

export interface InviteRow {
  id: string;
  note: string;
  status: string;
  expires: string;
  canRevoke: boolean;
}

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];

/** 1536 as "1.5 KB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const shown = unit === 0 || value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${shown} ${UNITS[unit]}`;
}

/** The day a Unix time falls on, in the reader's locale. */
export function formatDay(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function usageLines(usage: TenantUsageView): UsageLines {
  const { spend } = usage;
  return {
    host: usage.host.name,
    spend: spend.freeAccess
      ? 'Free during the closed beta'
      : spend.credits !== null
        ? `${plural(spend.credits, 'credit', 'credits')} left`
        : `${spend.chargedSoFar} charged so far`,
    storage: `${formatBytes(usage.storage.usedBytes)} stored`,
    aiRuns: `${plural(usage.aiRuns.count, 'AI run', 'AI runs')} today`,
    spaces: usage.spaces.map((space) => ({
      name: space.name ?? 'Untitled space',
      shared: space.sharedWithOtherTenants ? 'Shared with other people on this host' : 'Only you',
    })),
    privateSpaces: plural(usage.privatePerspectives, 'private space', 'private spaces'),
  };
}

/** The host holds this tenant: it may read, export, see usage and leave, and nothing else. */
export const isHeld = (usage: TenantUsageView | null): boolean => usage?.state === 'held';

const TENANT_STATES: Record<string, string> = {
  pending: 'Joining',
  active: 'Active',
  held: 'On hold',
  detached: 'Left',
  deleted: 'Deleted',
};

export function personRows(tenants: HostTenantView[]): PersonRow[] {
  return tenants.map((tenant) => ({
    id: tenant.tenantId,
    // The host names a tenant by its identity only; the last characters tell two apart.
    label: `Person ${tenant.didScid.slice(-6)}`,
    state: TENANT_STATES[tenant.state] ?? 'Unknown',
    canRemove: tenant.state === 'detached',
    since: formatDay(tenant.activatedAt ?? tenant.createdAt),
  }));
}

export function inviteRows(invites: HostInviteView[], nowSeconds: number): InviteRow[] {
  return invites.map((invite) => {
    const status = invite.revoked
      ? 'Revoked'
      : invite.usedBy
        ? 'Used'
        : invite.expiresAt <= nowSeconds
          ? 'Expired'
          : 'Open';
    return {
      id: invite.id,
      note: invite.note ?? 'No note',
      status,
      expires: formatDay(invite.expiresAt),
      canRevoke: status === 'Open',
    };
  });
}

export const SIGNUP_OPTIONS: { value: HostSignup; label: string }[] = [
  { value: 'no_one', label: 'No one' },
  { value: 'by_invite', label: 'People with an invite' },
  { value: 'anyone', label: 'Anyone' },
];

/** Shown while the person who runs the host has never chosen who may join (`HostPolicyView.choiceNeeded`). */
export const CHOICE_NEEDED = 'Choose who may join this device.';
