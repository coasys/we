/**
 * HostingStore — the hosting index from both sides: the list a person reads to find a host, and, for
 * a device's operator, whether that device is listed ("Earn with it").
 *
 * **The list** is a public read of the platform API the deployment names (`platformApiUrl` in the
 * seed). It needs no backend. Coasys cloud comes first, then the hosts the index lists, then an
 * address typed in: the index is a convenience, never the only way to a host, so the address works
 * with the index down. Choosing an entry ({@link HostingStore.choose}) records it in `chosen` and
 * starts "Add a cloud device" with that host, in the one call `deviceStore.addCloudDevice(address)`.
 * This store does not join: the device store and the custody service do.
 *
 * **The listing** is the backend's `hosting` port. The operator types a name, a place, a description
 * and an address; the backend adds the AI models and rates from its own state and signs in to the
 * index itself. The listing's state follows the backend's `index-listing-changed` event, so a host
 * that stopped answering, or that the index took down, shows its state and the reason without a
 * reload. Withdrawing takes effect at once.
 *
 * Chrome tier only (`hosting` in `templateSurface.ts`): a space template never sees any of it.
 */
import { type HostEntry, hostIndexUrl, normaliseHostAddress, readHostIndex } from '@shared/hostIndex';
import {
  type HostRow,
  hostRow,
  listingLabel,
  listingLine,
  listingProblem,
  listingTone,
  rateLines,
  trimmedListing,
} from '@shared/hostingRows';
import { getSeed } from '@shared/seedRegistry';
import type { HostingStatusView, ListingText, OwnListingView } from '@we/backend-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';

import { useDeviceStore } from './DeviceStore';
import { useSessionStore } from './SessionStore';

/** What a person chose to join: a host of the list, or an address typed in. */
export type HostChoice = { kind: 'listed'; host: HostEntry } | { kind: 'address'; url: string };

/** Where the host list stands. */
export type HostListState = 'idle' | 'loading' | 'ready' | 'down' | 'unconfigured';

/** The listing, worded, for the operator's page. */
export interface ListingCard {
  name: string;
  address: string;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  line: string;
  /** What the host runs, as the index shows it. */
  models: string;
  rates: string[];
  /** The index answered; what shows is what the device remembers when it did not. */
  confirmed: boolean;
}

export interface HostingStore {
  // ── The host list ──────────────────────────────────────────────────────────
  hosts: Accessor<HostRow[]>;
  hostListState: Accessor<HostListState>;
  /** The line to show when the index did not answer; empty otherwise. */
  hostListError: Accessor<string>;
  loadHosts: () => Promise<void>;
  /** The address typed under "Add by its address". */
  address: Accessor<string>;
  setAddress: (value: string) => void;
  /** Why the typed address cannot be used; empty before anything is typed and when it can. */
  addressProblem: Accessor<string>;
  chosen: Accessor<HostChoice | null>;
  /**
   * Chooses a listed host by its id, and starts "Add a cloud device" with it (`deviceStore.addCloudDevice`:
   * Coasys cloud for the host Coasys runs, else the host's address) where this computer can add one.
   */
  choose: (id: string) => Promise<void>;
  /** Chooses the address typed, and starts "Add a cloud device" with it, as `choose` does. */
  chooseAddress: () => Promise<void>;
  clearChoice: () => void;

  // ── Earn with it ───────────────────────────────────────────────────────────
  /** This backend can list its device. */
  available: Accessor<boolean>;
  loaded: Accessor<boolean>;
  error: Accessor<string>;
  /** The device has an operator, and the index admits it: listing can be offered. */
  canOffer: Accessor<boolean>;
  /** The index does not admit this operator. */
  notAllowed: Accessor<boolean>;
  /** The device has no operator identity to list for. */
  noOperator: Accessor<boolean>;
  /** The index did not answer; empty when it did. */
  indexError: Accessor<string>;
  listing: Accessor<ListingCard | null>;
  /** The listing is up: listed, or can't be reached for now. */
  isListed: Accessor<boolean>;
  draft: Accessor<ListingText>;
  setDraftField: (field: keyof ListingText, value: string) => void;
  problem: Accessor<string>;
  publishing: Accessor<boolean>;
  withdrawing: Accessor<boolean>;
  refresh: () => Promise<void>;
  publish: () => Promise<boolean>;
  withdraw: () => Promise<boolean>;
}

const HostingStoreContext = createContext<HostingStore>();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EMPTY_DRAFT: ListingText = { name: '', description: '', location: '', url: '' };

export function HostingStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const devices = useDeviceStore();
  const port = () => session.backendPorts()?.hosting ?? null;
  const indexUrl = hostIndexUrl(getSeed().platformApiUrl);

  // ── The host list ──────────────────────────────────────────────────────────
  const [entries, setEntries] = createSignal<HostEntry[]>([]);
  const [hostListState, setHostListState] = createSignal<HostListState>(indexUrl ? 'idle' : 'unconfigured');
  const [hostListError, setHostListError] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [chosen, setChosen] = createSignal<HostChoice | null>(null);

  async function loadHosts(): Promise<void> {
    if (!indexUrl) return;
    setHostListState('loading');
    try {
      setEntries(await readHostIndex(indexUrl));
      setHostListError('');
      setHostListState('ready');
    } catch (e) {
      setEntries([]);
      setHostListError(`The hosting index does not answer. ${message(e)}`);
      setHostListState('down');
    }
  }

  // ── Earn with it ───────────────────────────────────────────────────────────
  const [status, setStatus] = createSignal<HostingStatusView | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [unsupported, setUnsupported] = createSignal(false);
  const [error, setError] = createSignal('');
  const [draft, setDraft] = createSignal<ListingText>(EMPTY_DRAFT);
  const [edited, setEdited] = createSignal(false);
  const [publishing, setPublishing] = createSignal(false);
  const [withdrawing, setWithdrawing] = createSignal(false);

  // A reply belongs to the port it was asked of and to the latest read.
  let generation = 0;
  const available = () => !!port() && !unsupported();

  /** Starts the draft from the listing the device already has, until the operator types. */
  function seedDraft(from: OwnListingView | null): void {
    if (from && !edited())
      setDraft({ name: from.name, description: from.description, location: from.location, url: from.url });
  }

  async function refresh(): Promise<void> {
    const p = port();
    if (!p) return;
    const asked = ++generation;
    try {
      const next = await p.status();
      if (asked !== generation || port() !== p) return;
      setStatus(next);
      seedDraft(next.listing ?? next.remembered);
      setLoaded(true);
      setError('');
    } catch (e) {
      if (asked !== generation || port() !== p) return;
      // An executor that predates the index answers `Unknown type`; there is nothing to offer then.
      if (/unknown type/i.test(message(e))) setUnsupported(true);
      else setError(message(e));
    }
  }

  createEffect(
    on(port, (p) => {
      generation++;
      setStatus(null);
      setLoaded(false);
      setUnsupported(false);
      setError('');
      setDraft(EMPTY_DRAFT);
      setEdited(false);
      if (!p) return;
      void refresh();
      // The listing's state moves without anyone asking: the index answers another state.
      const stop = p.onListingChanged((listing) => {
        setStatus((s) => (s ? { ...s, listing, indexError: null } : s));
        seedDraft(listing);
      });
      onCleanup(stop);
    }),
  );

  const card = createMemo<ListingCard | null>(() => {
    const s = status();
    const shown = s?.listing ?? s?.remembered ?? null;
    if (!shown) return null;
    return {
      name: shown.name,
      address: shown.url,
      label: listingLabel(shown.state),
      tone: listingTone(shown.state),
      line: listingLine(shown),
      models: shown.aiModels.map((m) => m.name).join(', '),
      rates: rateLines(shown.rates),
      confirmed: !!s?.listing,
    };
  });

  /** Makes sure the device calls the index this deployment names, then runs `then`. */
  async function onIndex<T>(p: NonNullable<ReturnType<typeof port>>, then: () => Promise<T>): Promise<T> {
    const config = status()?.config;
    if (indexUrl && (!config || !config.enabled || config.url !== indexUrl)) {
      await p.configure({ url: indexUrl, enabled: true });
    }
    return then();
  }

  const store: HostingStore = {
    hosts: createMemo(() => entries().map(hostRow)),
    hostListState,
    hostListError,
    loadHosts,
    address,
    setAddress: (value) => setAddress(String(value ?? '')),
    addressProblem: createMemo(() =>
      address().trim() && !normaliseHostAddress(address())
        ? 'Enter the address of the host, like riverbank.example.'
        : '',
    ),
    chosen,
    choose: async (id) => {
      const host = entries().find((h) => h.id === id);
      if (!host) return;
      setChosen({ kind: 'listed', host });
      // The host Coasys runs is "Coasys cloud", which the join names with no address.
      if (devices.canAddCloudDevice()) await devices.addCloudDevice(host.runByCoasys ? '' : host.url);
    },
    chooseAddress: async () => {
      const url = normaliseHostAddress(address());
      if (!url) return;
      setChosen({ kind: 'address', url });
      if (devices.canAddCloudDevice()) await devices.addCloudDevice(url);
    },
    clearChoice: () => setChosen(null),

    available,
    loaded,
    error,
    notAllowed: () => status()?.allowed === false,
    noOperator: () => !!status() && !status()!.hasOperator,
    canOffer: () => available() && !!status()?.hasOperator && status()?.allowed !== false,
    indexError: () => status()?.indexError ?? '',
    listing: card,
    isListed: () => {
      const state = (status()?.listing ?? status()?.remembered)?.state;
      return state === 'listed' || state === 'unreachable';
    },
    draft,
    setDraftField: (field, value) => {
      setEdited(true);
      setDraft((d) => ({ ...d, [field]: String(value ?? '') }));
    },
    problem: createMemo(() => listingProblem(draft())),
    publishing,
    withdrawing,
    refresh,
    publish: async () => {
      const p = port();
      if (!p || publishing() || listingProblem(draft())) return false;
      setPublishing(true);
      try {
        const listing = await onIndex(p, () => p.publish(trimmedListing(draft())));
        setStatus((s) => (s ? { ...s, listing, indexError: null, allowed: true } : s));
        setError('');
        await refresh();
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      } finally {
        setPublishing(false);
      }
    },
    withdraw: async () => {
      const p = port();
      if (!p || withdrawing()) return false;
      setWithdrawing(true);
      try {
        await p.withdraw();
        setError('');
        await refresh();
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      } finally {
        setWithdrawing(false);
      }
    },
  };

  return <HostingStoreContext.Provider value={store}>{props.children}</HostingStoreContext.Provider>;
}

export function useHostingStore(): HostingStore {
  const store = useContext(HostingStoreContext);
  if (!store) throw new Error('useHostingStore must be used within a HostingStoreProvider');
  return store;
}
