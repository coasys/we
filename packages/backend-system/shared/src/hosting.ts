/**
 * The hosting index, as a device's operator sees it: whether this device is listed there, and the
 * listing's state.
 *
 * The index is a directory of hosts that people read to find one to join. A device's operator lists
 * it ("Earn with it") with a name, a place and a description; what the host runs — its AI models and
 * their rates — the backend adds from its own state, so the operator never types them. The backend
 * signs in to the index on the operator's behalf; this port never sees a credential.
 *
 * Reading the directory is not here. It is a public read of the platform API by the app, and needs
 * no backend: see `hostIndex` in `@we/app-shell`.
 */

/** Where a listing stands. `delisted` carries a {@link DelistReason}. */
export type ListingState = 'listed' | 'unreachable' | 'delisted' | 'withdrawn';

/** Why the index took a listing down, as it names it. A reason this build does not know stays text. */
export type DelistReason =
  'unreachable-7-days' | 'executor-mismatch' | 'operator-mismatch' | 'key-refused' | 'charging' | 'not-allowed';

/** What the operator types. */
export interface ListingText {
  name: string;
  description: string;
  location: string;
  /** Where the index reaches this device: an `https` address on the public internet. */
  url: string;
}

/** One thing the host charges for. Free during the closed beta; the rate is still listed. */
export interface ListedRate {
  /** What it is for: "link write", or an AI model's name. */
  description: string;
  credits: number;
}

export interface ListedModel {
  name: string;
  kind: 'llm' | 'embedding' | 'transcription';
}

/** The listing as the index shows it. */
export interface OwnListingView extends ListingText {
  listingId: string;
  state: ListingState;
  /** Set while `state` is `delisted`. */
  reason: string | null;
  aiModels: ListedModel[];
  rates: ListedRate[];
}

/** Where the index is and whether this device may call it. Off until the operator sets one. */
export interface HostingIndexConfig {
  url: string;
  enabled: boolean;
}

export interface HostingStatusView {
  config: HostingIndexConfig;
  /** The operator identity this device lists for; `false` without an operator record. */
  hasOperator: boolean;
  /** Whether the index admits the operator; `null` while the index is off or did not answer. */
  allowed: boolean | null;
  /** The listing as the index shows it; `null` when there is none or the index did not answer. */
  listing: OwnListingView | null;
  /** What the device remembers of its listing, for when the index is down; `null` before the first. */
  remembered: OwnListingView | null;
  /** Why the index could not be asked; `null` when it answered or is off. */
  indexError: string | null;
}

export interface HostingPort {
  status(): Promise<HostingStatusView>;
  /** Sets the index and turns it on or off. Returns the config as kept. */
  configure(config: HostingIndexConfig): Promise<HostingIndexConfig>;
  /** Lists this device, or updates its listing. */
  publish(text: ListingText): Promise<OwnListingView>;
  /** Takes the listing down at once. */
  withdraw(): Promise<void>;
  /** Called each time the listing's state changes. Returns the way to stop. */
  onListingChanged(handler: (listing: OwnListingView) => void): () => void;
}
