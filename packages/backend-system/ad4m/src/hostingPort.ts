/**
 * The hosting port over AD4M's `index.*` calls (`ad4m.hostingIndex`).
 *
 * The executor, not this port, signs in to the index with its device key and makes the HTTP calls;
 * these calls only start them, and each needs the operator. The executor adds the AI models and the
 * rates to a listing from its own tables.
 *
 * The SDK types `state` and a model's `kind` as `string`; the neutral types name the values, so those
 * two are narrowed here and an answer with a value this build does not know is not a listing. The
 * rest is a rename (`priceInHOT` is `credits`) or a drop. `ListingText` and `IndexConfig` are the
 * neutral `ListingText` and `HostingIndexConfig` as they are, and go through untouched.
 *
 * An executor that predates the calls answers `Unknown type`: the refusal is recorded like any other
 * missing method and reaches the caller as an error it can show.
 */
import type { Ad4mClient, HostingIndexClient } from '@coasys/ad4m';
import type { HostingPort, HostingStatusView, ListedModel, ListingState, OwnListingView } from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

const STATES: readonly ListingState[] = ['listed', 'unreachable', 'delisted', 'withdrawn'];
const MODEL_KINDS: readonly ListedModel['kind'][] = ['llm', 'embedding', 'transcription'];

// The SDK's barrel does not export these answer types, so they are read off the client's own methods.
type IndexStatus = Awaited<ReturnType<HostingIndexClient['status']>>;
type OwnListing = Awaited<ReturnType<HostingIndexClient['publish']>>;
type Remembered = NonNullable<IndexStatus['local']>;

/** A listing as the executor serves it, or `null` for a state this build does not know. */
export function readListing(
  listing: Pick<
    OwnListing,
    'name' | 'description' | 'location' | 'url' | 'listingId' | 'state' | 'reason' | 'aiModels' | 'rates'
  >,
): OwnListingView | null {
  const state = STATES.find((s) => s === listing.state);
  if (!state) return null;
  return {
    name: listing.name,
    description: listing.description,
    location: listing.location,
    url: listing.url,
    listingId: listing.listingId,
    state,
    reason: listing.reason || null,
    aiModels: listing.aiModels.flatMap(({ name, kind }): ListedModel[] => {
      const known = MODEL_KINDS.find((k) => k === kind);
      return known ? [{ name, kind: known }] : [];
    }),
    rates: listing.rates.map((rate) => ({ description: rate.description, credits: rate.priceInHOT })),
  };
}

/** What the executor remembers of its listing: the operator's text and the last state, no models or rates. */
function readRemembered({ draft, listingId, state, reason }: Remembered): OwnListingView | null {
  return readListing({ ...draft, listingId, state, reason, aiModels: [], rates: [] });
}

export function readHostingStatus(status: IndexStatus): HostingStatusView {
  return {
    config: status.config,
    hasOperator: !!status.scid,
    allowed: status.allowed,
    listing: status.listing && readListing(status.listing),
    remembered: status.local && readRemembered(status.local),
    indexError: status.indexError || null,
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

export function createAd4mHostingPort(backendClient: unknown): HostingPort {
  const client = (backendClient as Ad4mClient).hostingIndex;
  return {
    async status() {
      return readHostingStatus(await asked(client.status()));
    },
    configure: (config) => asked(client.configure(config)),
    async publish(text) {
      const published = readListing(await asked(client.publish(text)));
      if (!published) throw new Error('The hosting index answered with a listing this app cannot read.');
      return published;
    },
    async withdraw() {
      await asked(client.withdraw());
    },
    onListingChanged(handler) {
      return client.onListingChanged((listing) => {
        const view = readListing(listing);
        if (view) handler(view);
      });
    },
  };
}
