/**
 * BaseStore — the app before a session: who this device is, whether its own backend is up, and where
 * to get a session from.
 *
 * The store the base app's template (a bundle's `base`, drawn by `BaseApp`) reads, over a
 * {@link BaseHost}. It runs with no backend connected, which is the whole point of it: WE's other
 * stores wait for a session, so a person whose executor will not start, whose phone is offline or who
 * has not made an identity yet used to see a spinner or an error box and nothing else.
 *
 * What it decides, in order:
 *
 * 1. **The device's own backend.** Where the host runs one (`executor`), nothing else is asked until
 *    it is up — the identity lives behind it on the desktop — and a failure to start is a screen with
 *    the reason and "Try again", not a dialog and a quit.
 * 2. **The first run.** A device whose custody speaks for nobody, keeps no master key, and where
 *    "Start now" was not chosen is asked how it comes in: make the identity here, link to one, or use
 *    the 12 words. Each door opens the host's own identity window, the only place a secret is shown or
 *    typed; this store learns how the step ended and reads the identity again.
 * 3. **The connection.** The places a session can be had from here (`connections`). A choice is
 *    remembered, and the next boot with nothing to ask goes straight to it.
 * 4. **The hand-off.** The chosen connection is given to the host (`onHandOff`), which mounts WE's
 *    `App` against it. A connection that cannot be reached comes back here as the offline state.
 *
 * Chrome tier only (`keys`, `devices` and `session` in `templateSurface.ts`): a space template never
 * learns what this device is, which identity it keeps or where it connects.
 */
import { custodyDevice, DEVICE_ICONS, shortDid, THIS_COMPUTER, THIS_PHONE } from '@shared/identityRows';
import type {
  BaseConnection,
  BaseDoor,
  BaseExecutorState,
  BaseHandOff,
  BaseHost,
  BaseIdentityStep,
} from '@shared/platform/baseHost';
import type { IdentityChangeOutcome, IdentityCustodyView } from '@we/backend-shared';
import { type Accessor, batch, createMemo, createSignal, getOwner, onCleanup } from 'solid-js';

import { START_NOW_HERE_KEY } from './IdentityStore';

export interface BaseStore {
  /**
   * Which screen is due: `loading` while the identity is read, `starting` / `failed` while this
   * device's backend starts or after it failed to, `first-run`, `connect` (the connection choice),
   * `offline`, `handing-off` while the chosen connection is reached, `session` once WE's app has it.
   */
  stage: Accessor<BaseStage>;
  /** A page open over the stage: `devices` or `security`, read-only; empty for none. */
  page: Accessor<BasePage>;
  /** What this device is: `computer`, `phone` or `browser`. */
  hostKind: Accessor<BaseHost['kind']>;
  /** The word for this device in a sentence: "computer", "phone", "browser". */
  deviceNoun: Accessor<string>;
  /** The deployment's name and mark, for the header. */
  brand: Accessor<BaseBrand>;
  /** This device's own backend: `none` where it runs none, else `starting`, `ready` or `failed`. */
  executorPhase: Accessor<'none' | BaseExecutorState['phase']>;
  /** Why it failed to start, in words a person reads; empty otherwise. */
  executorReason: Accessor<string>;
  /** This device keeps an identity source (the desktop's custody service, the phone's device key). */
  hasIdentity: Accessor<boolean>;
  /** The source answered: what follows about the identity is known, not assumed. */
  identityKnown: Accessor<boolean>;
  /** The identity this device speaks for, or empty. */
  did: Accessor<string>;
  /** The same, shortened for the eye. */
  didShort: Accessor<string>;
  /**
   * An identity a step made on this device and could not publish yet, by its DID; empty when none.
   * Its master key is kept here and it is published again on the next attempt, so a failed step
   * that left one changed something.
   */
  unpublished: Accessor<string>;
  /** This device keeps a master key of it. */
  holdsMaster: Accessor<boolean>;
  /** "This computer keeps your master key behind its own sign-in", or what this device keeps instead. */
  keepsLine: Accessor<string>;
  /** Why no identity change can be made here, in words a person reads; empty when one can. */
  blocked: Accessor<string>;
  /** The devices the identity's private record names, worded for Devices. Read-only. */
  devices: Accessor<BaseDeviceRow[]>;
  /** The three ways in, as this host offers each: whether it opens, and why not where it does not. */
  doors: Accessor<BaseDoors>;
  /** The places a session can be had from here, for the connection choice. */
  connections: Accessor<BaseConnectionRow[]>;
  /** The id of the connection chosen, this boot or remembered from the last; empty for none. */
  chosen: Accessor<string>;
  /** A step or a connection is under way. */
  busy: Accessor<boolean>;
  /** How the last identity step ended, or empty. */
  lastOutcome: Accessor<IdentityChangeOutcome | ''>;
  /** Why the last step, read or connection failed, in words a person reads; empty when none did. */
  error: Accessor<string>;
  /** Why the offline state is up: no network, or the place chosen could not be reached. */
  offlineReason: Accessor<string>;

  /** Reads the identity and the connections again, and works out the stage afresh. */
  refresh: () => Promise<void>;
  /** "Make my identity here": opens the identity window on making one. */
  makeIdentity: () => Promise<IdentityChangeOutcome>;
  /** "Link to my identity": opens the identity window on joining one another device keeps. */
  linkIdentity: () => Promise<IdentityChangeOutcome>;
  /** "Use my 12 words": opens the identity window on bringing the identity back from them. */
  useWords: () => Promise<IdentityChangeOutcome>;
  /** "Start now": no identity on this device for now; remembered here, and offered again in Settings. */
  startNow: () => Promise<void>;
  /** Connects to one of `connections`, by its id, and hands the session to the app, as the person's choice. */
  choose: (id: string) => Promise<void>;
  /** "Try again": starts this device's backend again, or reaches the chosen place again. */
  retry: () => Promise<void>;
  /** Back to the connection choice, from the offline state or the first run's end. */
  showConnections: () => Promise<void>;
  /** Opens a read-only page over the stage: `devices` or `security`. */
  openPage: (page: BasePage) => void;
  closePage: () => void;
  /** The host's own: a session the app had came back unreachable, and the offline state is due. */
  handBack: (reason: string) => void;
}

export type BaseStage =
  'loading' | 'starting' | 'failed' | 'first-run' | 'connect' | 'offline' | 'handing-off' | 'session';

export type BasePage = '' | 'devices' | 'security';

export interface BaseBrand {
  name: string;
  /** An image URL: a `data:` SVG for the cartridges WE builds in. */
  mark: string;
}

export interface BaseDoorView {
  /** The door opens a step here. */
  open: boolean;
  /** Why it does not, where it does not; empty where it does. */
  note: string;
}

export interface BaseDoors {
  make: BaseDoorView;
  link: BaseDoorView;
  words: BaseDoorView;
}

export interface BaseDeviceRow {
  keyId: string;
  /** "This computer", the name the record gives it, or "Device d2". */
  label: string;
  /** "d2 · Phone" */
  subtitle: string;
  icon: string;
  thisDevice: boolean;
  /** "Holds the master key", "Master key offered, not yet taken", or empty. */
  master: string;
}

export interface BaseConnectionRow extends BaseConnection {
  icon: string;
  /** The one chosen last. */
  chosen: boolean;
}

/** The little of `Storage` the store uses, so a test or a host can give its own. */
export interface BaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BaseStoreOptions {
  brand: BaseBrand;
  /**
   * Mounts WE's app against the chosen connection. Resolves once it is handed over; rejects when the
   * host could not even make a connector for it, which comes back here as an error or, where the host
   * says the place is unreachable, the offline state.
   */
  onHandOff: (connection: BaseConnection, how: BaseHandOff) => Promise<void>;
  /** Where the choice and "Start now" are remembered. `localStorage` where there is one. */
  storage?: BaseStorage;
  /**
   * Go straight to a remembered connection when nothing else is due. On by default; the base app
   * turns it off while a person is looking at the choice on purpose.
   */
  autoHandOff?: boolean;
  /**
   * With nothing remembered, take the first connection offered rather than asking. For a deployment
   * that draws no connection choice of its own.
   */
  takeFirst?: boolean;
  /** How often, and how far apart, to ask an identity source that is still starting. */
  identityAttempts?: number;
  identityRetryMs?: number;
}

/** Where the connection chosen last is remembered, by its id. */
export const BASE_CONNECTION_KEY = 'we.base.connection';

const CONNECTION_ICONS: Record<BaseConnection['kind'], string> = {
  'this-device': 'laptop',
  server: 'hard-drives',
  'key-host': 'device-mobile',
  connect: 'plugs-connected',
};

/** What a device is, as the private record's kinds go, in a word for its row. */
const KIND_WORDS: Record<string, string> = {
  'phone-app': 'Phone',
  'desktop-app': 'Computer',
  server: 'Server',
  'community-host': 'Server',
  browser: 'Browser',
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function defaultStorage(): BaseStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // A storage the browser refuses (a sandboxed frame): nothing is remembered, which is harmless.
  }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
    removeItem: (key) => void memory.delete(key),
  };
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

const doorView = (door: BaseDoor | undefined, absent: string): BaseDoorView =>
  !door ? { open: false, note: absent } : door.step ? { open: true, note: '' } : { open: false, note: door.note };

/**
 * Builds the store. Call it under a Solid owner (`createRoot`, a component): the subscriptions it
 * makes to the host end with that owner.
 */
export function createBaseStore(host: BaseHost, options: BaseStoreOptions): BaseStore {
  const storage = options.storage ?? defaultStorage();
  const attempts = Math.max(1, options.identityAttempts ?? 10);
  const retryMs = options.identityRetryMs ?? 500;
  const autoHandOff = options.autoHandOff ?? true;

  const [stage, setStage] = createSignal<BaseStage>('loading');
  const [page, setPage] = createSignal<BasePage>('');
  const [executor, setExecutor] = createSignal<BaseExecutorState | null>(host.executor?.state() ?? null);
  const [custody, setCustody] = createSignal<IdentityCustodyView | null>(null);
  const [connections, setConnections] = createSignal<BaseConnection[]>([]);
  const [chosen, setChosen] = createSignal(safely(() => storage.getItem(BASE_CONNECTION_KEY) ?? '', ''));
  const [busy, setBusy] = createSignal(false);
  const [lastOutcome, setLastOutcome] = createSignal<IdentityChangeOutcome | ''>('');
  const [error, setError] = createSignal('');
  const [offlineReason, setOfflineReason] = createSignal('');
  const [startNowChosen, setStartNowChosen] = createSignal(
    safely(() => storage.getItem(START_NOW_HERE_KEY) === '1', false),
  );

  const deviceNoun = () => (host.kind === 'phone' ? 'phone' : host.kind === 'browser' ? 'browser' : 'computer');

  /*
    Every pass of `evaluate` belongs to its generation: one overtaken by a later (a retry pressed
    while the first read still waits on a starting custody service) sets nothing.
  */
  let generation = 0;
  // Once the person has asked to see the choice, a remembered one no longer jumps past it.
  let auto = autoHandOff;

  async function readIdentity(current: () => boolean): Promise<void> {
    const source = host.identity;
    if (!source) return;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const state = await source.state();
        if (!current()) return;
        setCustody(state);
        return;
      } catch (e) {
        lastError = e;
        if (attempt + 1 < attempts) await wait(retryMs);
        if (!current()) return;
      }
    }
    setCustody(null);
    setError(`This ${deviceNoun()} could not read its identity: ${message(lastError)}`);
  }

  function firstRunDue(): boolean {
    const source = host.identity;
    const state = custody();
    if (!source || !state) return false;
    if (state.did || state.holdsMaster) return false;
    if (startNowChosen()) return false;
    if (safely(() => source.skipped?.() ?? false, false)) return false;
    return true;
  }

  async function loadConnections(current: () => boolean): Promise<BaseConnection[] | null> {
    try {
      const list = await host.connections();
      if (!current()) return null;
      setConnections(list);
      return list;
    } catch (e) {
      if (!current()) return null;
      setConnections([]);
      setError(`The places to connect to could not be read: ${message(e)}`);
      return [];
    }
  }

  async function evaluate(): Promise<void> {
    const asked = ++generation;
    const current = () => asked === generation && stage() !== 'session';
    const own = host.executor ? executor() : null;
    if (own && own.phase !== 'ready') {
      setStage(own.phase === 'failed' ? 'failed' : 'starting');
      return;
    }
    if (host.identity && !custody()) {
      setStage('loading');
      await readIdentity(current);
      if (!current()) return;
    }
    if (firstRunDue()) {
      setStage('first-run');
      return;
    }
    const list = await loadConnections(current);
    if (!list) return;
    const remembered = list.find((c) => c.id === chosen()) ?? (options.takeFirst ? list[0] : undefined);
    if (auto && remembered) {
      await choose(remembered.id);
      return;
    }
    setStage('connect');
  }

  async function open(step: BaseIdentityStep | null, note: string): Promise<IdentityChangeOutcome> {
    const source = host.identity;
    if (!source || !step) {
      setLastOutcome('failed');
      setError(note || `This ${deviceNoun()} cannot change your identity.`);
      return 'failed';
    }
    if (busy()) return 'failed';
    setBusy(true);
    setError('');
    let outcome: IdentityChangeOutcome;
    let reason = '';
    try {
      outcome = await source.open(step);
    } catch (e) {
      outcome = 'failed';
      reason = message(e);
    }
    batch(() => {
      setBusy(false);
      setLastOutcome(outcome);
    });
    // Read again whatever the outcome: a step can end "cancelled" after it changed something.
    setCustody(null);
    await evaluate();
    if (reason) setError(reason);
    return outcome;
  }

  const doorStep = (door: BaseDoor | undefined) => (door?.step ? door.step : null);
  const doorNote = (door: BaseDoor | undefined) => (door && !door.step ? door.note : '');

  async function choose(id: string, how: BaseHandOff = {}): Promise<void> {
    const connection = connections().find((c) => c.id === id);
    if (!connection) {
      setError('That place is no longer offered here.');
      setStage('connect');
      return;
    }
    if (busy() && stage() === 'handing-off') return;
    batch(() => {
      setChosen(id);
      setError('');
      setOfflineReason('');
      setPage('');
    });
    safely(() => storage.setItem(BASE_CONNECTION_KEY, id), undefined);
    if (connection.kind !== 'this-device' && host.online && !host.online()) {
      setOfflineReason(`This ${deviceNoun()} has no network. ${connection.label} cannot be reached until it has.`);
      setStage('offline');
      return;
    }
    setStage('handing-off');
    setBusy(true);
    try {
      await options.onHandOff(connection, how);
      setStage('session');
    } catch (e) {
      if (host.isUnreachable?.(e)) {
        setOfflineReason(`${connection.label} could not be reached: ${message(e)}`);
        setStage('offline');
      } else {
        setError(message(e));
        setStage('connect');
      }
    } finally {
      setBusy(false);
    }
  }

  if (host.executor) {
    const off = host.executor.subscribe((next) => {
      const before = executor();
      setExecutor(next);
      // A session has its own way to follow its backend; and ready twice is nothing new.
      if (stage() === 'session' || (next.phase === 'ready' && before?.phase === 'ready')) return;
      void evaluate();
    });
    if (getOwner()) onCleanup(off);
  }

  // Back online with the offline state up: try the place chosen again, as "Try again" would.
  if (typeof window !== 'undefined' && host.online) {
    const back = () => {
      if (stage() === 'offline' && chosen()) void choose(chosen());
    };
    window.addEventListener('online', back);
    if (getOwner()) onCleanup(() => window.removeEventListener('online', back));
  }

  const devices = createMemo<BaseDeviceRow[]>(() => {
    const state = custody();
    if (!state) return [];
    const here = custodyDevice(state);
    return state.devices.map((d) => {
      const thisDevice = here?.keyId === d.keyId;
      const kind = KIND_WORDS[d.kind] ?? '';
      return {
        keyId: d.keyId,
        label: thisDevice
          ? (here?.label ?? (host.kind === 'phone' ? THIS_PHONE : THIS_COMPUTER))
          : d.name || `Device ${d.keyId}`,
        subtitle: [d.keyId, kind].filter(Boolean).join(' · '),
        icon: DEVICE_ICONS[d.kind] ?? 'key',
        thisDevice,
        master:
          d.holdsMaster === 'yes'
            ? 'Holds the master key'
            : d.holdsMaster === 'offered'
              ? 'Master key offered, not yet taken'
              : '',
      };
    });
  });

  const store: BaseStore = {
    stage,
    page,
    hostKind: () => host.kind,
    deviceNoun,
    brand: () => options.brand,
    executorPhase: () => executor()?.phase ?? 'none',
    executorReason: () => {
      const state = executor();
      return state?.phase === 'failed' ? state.reason : '';
    },
    hasIdentity: () => !!host.identity,
    identityKnown: () => custody() !== null,
    did: () => custody()?.did ?? '',
    didShort: () => shortDid(custody()?.did ?? ''),
    unpublished: () => custody()?.pending ?? '',
    holdsMaster: () => custody()?.holdsMaster ?? false,
    keepsLine: () => {
      const state = custody();
      const noun = deviceNoun();
      if (!state?.holdsMaster) return `This ${noun} keeps no master key`;
      return state.unlock === 'os'
        ? `This ${noun} keeps your master key behind its own sign-in`
        : `This ${noun} keeps your master key behind your passphrase`;
    },
    blocked: () => custody()?.blocked ?? '',
    devices,
    doors: createMemo<BaseDoors>(() => {
      const source = host.identity;
      const none = `This ${deviceNoun()} keeps no identity of its own; connect to the place that does.`;
      const blocked = custody()?.blocked ?? '';
      const make = doorView(source?.doors.make, none);
      return {
        // What blocks every change blocks making one; linking and the words go elsewhere first.
        make: blocked && make.open ? { open: false, note: blocked } : make,
        link: doorView(source?.doors.link, none),
        words: doorView(source?.doors.words, none),
      };
    }),
    connections: createMemo(() =>
      connections().map((c) => ({ ...c, icon: CONNECTION_ICONS[c.kind], chosen: c.id === chosen() })),
    ),
    chosen,
    busy,
    lastOutcome,
    error,
    offlineReason,

    refresh: async () => {
      setCustody(null);
      await evaluate();
    },
    makeIdentity: () => open(doorStep(host.identity?.doors.make), doorNote(host.identity?.doors.make)),
    linkIdentity: () => open(doorStep(host.identity?.doors.link), doorNote(host.identity?.doors.link)),
    useWords: () => open(doorStep(host.identity?.doors.words), doorNote(host.identity?.doors.words)),
    startNow: async () => {
      safely(() => storage.setItem(START_NOW_HERE_KEY, '1'), undefined);
      setStartNowChosen(true);
      await evaluate();
    },
    // The list's rows: the person choosing, which the host is told (`BaseHandOff.chosen`).
    choose: (id) => choose(id, { chosen: true }),
    retry: async () => {
      setError('');
      const own = host.executor;
      if (own && executor()?.phase === 'failed') {
        setStage('starting');
        try {
          await own.start();
        } catch (e) {
          setExecutor({ phase: 'failed', reason: message(e) });
          setStage('failed');
        }
        return;
      }
      if (stage() === 'offline' && chosen()) {
        await choose(chosen());
        return;
      }
      await evaluate();
    },
    showConnections: async () => {
      auto = false;
      setPage('');
      const asked = ++generation;
      const list = await loadConnections(() => asked === generation);
      if (list) setStage('connect');
    },
    openPage: (next) => setPage(next === 'devices' || next === 'security' ? next : ''),
    closePage: () => setPage(''),
    handBack: (reason) => {
      generation++;
      batch(() => {
        setBusy(false);
        setOfflineReason(reason);
        setStage('offline');
      });
    },
  };

  void evaluate();
  return store;
}
