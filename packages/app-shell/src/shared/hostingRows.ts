/**
 * The hosting pages' words: a listing's state as a sentence, why the index took one down, what a
 * host charges, who may join it, and what stops a listing from being sent. Pure, so the wording and
 * the rules are tested without a store.
 */
import type { ListedRate, ListingText, OwnListingView } from '@we/backend-shared';

import type { HostEntry } from './hostIndex';
import { normaliseHostAddress } from './hostIndex';

/** The longest each field may be; the index refuses more. */
export const LISTING_LIMITS = { name: 60, description: 500, location: 80 } as const;

/** Why the index took a listing down, and what to do about it. */
const DELIST_REASONS: Record<string, string> = {
  'unreachable-7-days':
    'The hosting index could not reach this device for 7 days. Check its address, then list it again.',
  'executor-mismatch': 'The address now answers as another device. Check the address, then list it again.',
  'operator-mismatch': 'The address now answers for another operator. Check the address, then list it again.',
  'key-refused': "This device's key was removed from your identity. Add the device again to list it.",
  charging: 'Charging is on. The closed beta is free, so turn it off to list this device.',
  'not-allowed': "Your identity is no longer on the hosting index's list.",
};

/** A listing's state as one sentence for its operator. */
export function listingLine(listing: Pick<OwnListingView, 'state' | 'reason' | 'url'>): string {
  switch (listing.state) {
    case 'listed':
      return 'Listed. People can find this device and join it.';
    case 'unreachable':
      return `The hosting index can't reach ${listing.url}. It lists the device again when it can.`;
    case 'delisted':
      return (listing.reason && DELIST_REASONS[listing.reason]) || 'The hosting index removed this listing.';
    case 'withdrawn':
      return 'Not listed.';
  }
}

/** The tone a state is drawn in. */
export function listingTone(state: OwnListingView['state']): 'success' | 'warning' | 'danger' | 'neutral' {
  return state === 'listed'
    ? 'success'
    : state === 'unreachable'
      ? 'warning'
      : state === 'delisted'
        ? 'danger'
        : 'neutral';
}

const STATE_LABELS: Record<OwnListingView['state'], string> = {
  listed: 'Listed',
  unreachable: "Can't be reached",
  delisted: 'Removed',
  withdrawn: 'Not listed',
};
export const listingLabel = (state: OwnListingView['state']): string => STATE_LABELS[state];

const credits = (n: number): string =>
  `${Number.isInteger(n) ? n : Number(n.toFixed(4))} ${n === 1 ? 'credit' : 'credits'}`;

/** One line per operation the host prices: "link write: 0.25 credits". */
export function rateLines(rates: ListedRate[]): string[] {
  return rates.map((r) => `${r.description}: ${credits(r.credits)}`);
}

/** What the host charges, for a row: the rates, and "Free during the closed beta" beside them. */
export function chargeLine(host: Pick<HostEntry, 'rates' | 'freeAccess'>): string {
  const lines = rateLines(host.rates).join(' · ');
  const free = host.freeAccess ? 'Free during the closed beta' : '';
  return [lines, free].filter(Boolean).join(' · ');
}

/** Who may join, as the host's settings say. */
export function signupLine(host: Pick<HostEntry, 'signup' | 'full'>): string {
  if (host.full) return 'Full';
  return host.signup === 'anyone'
    ? 'Anyone can join'
    : host.signup === 'by_invite'
      ? 'By invite'
      : 'Not taking new people';
}

/** Whether a person can be offered the join: the host takes people and has room. */
export const canJoin = (host: Pick<HostEntry, 'signup' | 'full'>): boolean => host.signup !== 'no_one' && !host.full;

/** A host as a row of the list. */
export interface HostRow {
  id: string;
  name: string;
  /** Where it is, and what it is for, as the operator wrote them. */
  details: string;
  address: string;
  runByCoasys: boolean;
  signup: string;
  charge: string;
  models: string;
  joinable: boolean;
}

export function hostRow(host: HostEntry): HostRow {
  return {
    id: host.id,
    name: host.name,
    details: [host.location, host.description].filter(Boolean).join(' · '),
    address: host.url,
    runByCoasys: host.runByCoasys,
    signup: signupLine(host),
    charge: chargeLine(host),
    models: host.aiModels.map((m) => m.name).join(', '),
    joinable: canJoin(host),
  };
}

/** The operator's text as typed, trimmed; the address as its `https` origin when it is one. */
export function trimmedListing(draft: ListingText): ListingText {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    location: draft.location.trim(),
    url: normaliseHostAddress(draft.url) ?? draft.url.trim(),
  };
}

/** Why the draft cannot be listed yet; empty when it can. The index checks the address again. */
export function listingProblem(draft: ListingText): string {
  const text = trimmedListing(draft);
  if (!text.name) return 'Give the device a name.';
  if (text.name.length > LISTING_LIMITS.name) return `The name can have up to ${LISTING_LIMITS.name} characters.`;
  if (!text.location) return 'Say where the device is.';
  if (text.location.length > LISTING_LIMITS.location)
    return `The place can have up to ${LISTING_LIMITS.location} characters.`;
  if (text.description.length > LISTING_LIMITS.description) {
    return `The description can have up to ${LISTING_LIMITS.description} characters.`;
  }
  if (!normaliseHostAddress(draft.url)) return 'Enter the address people reach this device at, starting with https://.';
  return '';
}
