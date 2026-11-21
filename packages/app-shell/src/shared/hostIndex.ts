/**
 * Reading the hosting index's list of hosts, and the address of one a person types.
 *
 * The list is a public read of the platform API (`GET /v1/index/hosts`), which answers only to the
 * Coasys app origins. It needs no backend and no identity, so a person with nothing connected yet can
 * read it. The platform sends Coasys cloud first, then the rest by name; this keeps that order and
 * does not trust it, because a host that moved Coasys cloud down the list would be a quiet way to
 * change what a person picks.
 */
import type { ListedModel, ListedRate } from '@we/backend-shared';

/** Who may join a host, as the host's own settings say. */
export type HostSignup = 'anyone' | 'by_invite' | 'no_one';

/** One listed host. */
export interface HostEntry {
  id: string;
  name: string;
  description: string;
  location: string;
  /** The host's address, an `https` origin. */
  url: string;
  runByCoasys: boolean;
  signup: HostSignup;
  full: boolean;
  freeAccess: boolean;
  aiModels: ListedModel[];
  rates: ListedRate[];
}

/** Where the host list reads. `null` when the deployment names no platform API. */
export function hostIndexUrl(platformApiUrl: string | undefined): string | null {
  return platformApiUrl ? `${platformApiUrl.replace(/\/+$/, '')}/v1/index` : null;
}

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const SIGNUPS: readonly HostSignup[] = ['anyone', 'by_invite', 'no_one'];
const MODEL_KINDS: readonly ListedModel['kind'][] = ['llm', 'embedding', 'transcription'];

/** One entry of `GET /v1/index/hosts`; `null` for one with no id or no address a person could join. */
export function readHostEntry(value: unknown): HostEntry | null {
  const raw = record(value);
  const url = normaliseHostAddress(text(raw.url));
  const id = text(raw.listingId);
  // A signup setting this build does not know is read as the closed one: never offer a join it cannot describe.
  const signup = SIGNUPS.find((s) => s === raw.signup) ?? 'no_one';
  if (!id || !url) return null;
  return {
    id,
    name: text(raw.name) || url,
    description: text(raw.description),
    location: text(raw.location),
    url,
    runByCoasys: raw.runByCoasys === true,
    signup,
    full: raw.full === true,
    freeAccess: raw.freeAccess === true,
    aiModels: (Array.isArray(raw.aiModels) ? raw.aiModels : []).flatMap((item): ListedModel[] => {
      const model = record(item);
      const kind = MODEL_KINDS.find((k) => k === model.kind);
      return kind ? [{ name: text(model.name), kind }] : [];
    }),
    rates: (Array.isArray(raw.rates) ? raw.rates : []).map((item) => {
      const rate = record(item);
      return {
        description: text(rate.description),
        credits: typeof rate.priceInHOT === 'number' ? rate.priceInHOT : 0,
      };
    }),
  };
}

/** Coasys cloud first, then by name; the order the platform sends, restored if it was not kept. */
export function orderHosts(hosts: HostEntry[]): HostEntry[] {
  return [...hosts].sort(
    (a, b) =>
      Number(b.runByCoasys) - Number(a.runByCoasys) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/**
 * Reads the list. Throws when the index does not answer or answers something that is not a list; the
 * caller says so and keeps "Add by its address".
 */
export async function readHostIndex(indexUrl: string, fetchFn: typeof fetch = fetch): Promise<HostEntry[]> {
  const response = await fetchFn(`${indexUrl}/hosts`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The hosting index answered ${response.status}.`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('The hosting index answered something that is not a list of hosts.');
  return orderHosts(body.flatMap((item) => readHostEntry(item) ?? []));
}

/**
 * The `https` origin of an address a person typed, or `null`. "riverbank.example" and
 * "https://riverbank.example/some/page" are both "https://riverbank.example". A plain `http` address
 * is refused: a host is joined over a connection no one on the way can read.
 */
export function normaliseHostAddress(input: string): string | null {
  const typed = input.trim();
  if (!typed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
  return url.origin;
}
