/**
 * The hosting port over AD4M's `index.*` calls (`ad4m.hostingIndex`).
 *
 * The executor, not this port, signs in to the index with its device key and makes the HTTP calls;
 * these calls only start them, and each needs the operator. The executor adds the AI models and the
 * rates to a listing from its own tables.
 *
 * An SDK that predates the client has no `hostingIndex`, so there is no port and Settings offers no
 * listing. An executor that predates the calls answers `Unknown type`: the refusal is recorded like
 * any other missing method and reaches the caller as an error it can show.
 */
import type {
  HostingIndexConfig,
  HostingPort,
  HostingStatusView,
  ListedModel,
  ListingState,
  ListingText,
  OwnListingView,
} from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

/** The slice of the SDK's `HostingIndexClient` this port uses. */
export interface HostingClientLike {
  configure(config: HostingIndexConfig): Promise<unknown>;
  status(): Promise<unknown>;
  publish(listing: ListingText): Promise<unknown>;
  withdraw(): Promise<unknown>;
  onListingChanged(handler: (listing: unknown) => void): () => void;
}

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const STATES: readonly ListingState[] = ['listed', 'unreachable', 'delisted', 'withdrawn'];
const MODEL_KINDS: readonly ListedModel['kind'][] = ['llm', 'embedding', 'transcription'];

function listingText(value: unknown): ListingText {
  const raw = record(value);
  return { name: text(raw.name), description: text(raw.description), location: text(raw.location), url: text(raw.url) };
}

/** A listing as the executor serves it (`OwnListing`), or `null` for anything that is not one. */
export function readListing(value: unknown): OwnListingView | null {
  const raw = record(value);
  const state = STATES.find((s) => s === raw.state);
  if (!state) return null;
  return {
    ...listingText(raw),
    listingId: text(raw.listingId),
    state,
    reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : null,
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

/** What the executor remembers of its listing (`LocalListing`): the operator's text and the last state. */
function readRemembered(value: unknown): OwnListingView | null {
  const raw = record(value);
  const state = STATES.find((s) => s === raw.state);
  if (!state) return null;
  return {
    ...listingText(raw.draft),
    listingId: text(raw.listingId),
    state,
    reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : null,
    aiModels: [],
    rates: [],
  };
}

function readConfig(value: unknown): HostingIndexConfig {
  const raw = record(value);
  return { url: text(raw.url), enabled: raw.enabled === true };
}

export function readHostingStatus(value: unknown): HostingStatusView {
  const raw = record(value);
  return {
    config: readConfig(raw.config),
    hasOperator: typeof raw.scid === 'string' && raw.scid !== '',
    allowed: typeof raw.allowed === 'boolean' ? raw.allowed : null,
    listing: readListing(raw.listing),
    remembered: readRemembered(raw.local),
    indexError: typeof raw.indexError === 'string' && raw.indexError ? raw.indexError : null,
  };
}

/** A call that the executor refused for want of the method is recorded, then thrown as it came. */
async function asked<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    recordMissingMethod(error);
    throw error;
  }
}

export function createAd4mHostingPort(backendClient: unknown): HostingPort | undefined {
  const client = (backendClient as { hostingIndex?: HostingClientLike }).hostingIndex;
  if (!client) return undefined;
  return {
    async status() {
      return readHostingStatus(await asked(client.status()));
    },
    async configure(config) {
      return readConfig(await asked(client.configure(config)));
    },
    async publish(listing) {
      const published = readListing(await asked(client.publish(listing)));
      if (!published) throw new Error('The hosting index answered with a listing this app cannot read.');
      return published;
    },
    async withdraw() {
      await asked(client.withdraw());
    },
    onListingChanged(handler) {
      return client.onListingChanged((value) => {
        const listing = readListing(value);
        if (listing) handler(listing);
      });
    },
  };
}
