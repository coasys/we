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
 *    the reason and "Try again", not a dialog and a quit. Where it is up but its agent waits on the
 *    WE password (a desktop with no keyring it can use), that is asked for first, in the host's own
 *    field (`CredentialField`, read through `credential`), and given to the host, never to a template.
 * 2. **The first run.** A device whose custody speaks for nobody, keeps no master key, and where
 *    "Skip for now" was not chosen is asked how it comes in: make the identity here, link to one, or use
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
import { custodyDevice, DEVICE_ICONS, shortDid, THIS_COMPUTER, THIS_PHONE, UNNAMED_DEVICE } from '@shared/identityRows';
import type {
  BaseAgentPasswordAnswer,
  BaseConnection,
  BaseDoor,
  BaseExecutorState,
  BaseHandOff,
  BaseHost,
  BaseIdentityStep,
} from '@shared/platform/baseHost';
import type { IdentityChangeOutcome, IdentityCustodyView } from '@we/backend-shared';
import { type Accessor, batch, createMemo, createSignal, getOwner, onCleanup } from 'solid-js';

import { credential, NEW_PASSWORD_MIN_LENGTH } from '../credential';
import { START_NOW_HERE_KEY } from './IdentityStore';

export interface BaseStore {
  /**
   * Which screen is due: `loading` while the identity is read, `starting` / `failed` while this
   * device's backend starts or after it failed to, `password` while its agent waits on the WE
   * password (no keyring could be used), `first-run`, `connect` (the connection choice),
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
  /**
   * It was running and stopped (outside the app, from the tray, or it kept failing) rather than
   * failing to start: the failed screen says "stopped" and offers to start it again.
   */
  executorStopped: Accessor<boolean>;
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
  /** "On this computer, protected by your device login", or what this device keeps instead. */
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
  /** The password asked for makes this device's agent, so it is a new one: typed twice. */
  passwordIsNew: Accessor<boolean>;
  /** The password last given did not unlock the agent; cleared when the field is typed in again. */
  passwordWrong: Accessor<boolean>;
  /** Something is typed in the password field. Never what. */
  passwordEntered: Accessor<boolean>;
  /**
   * A new password is typed twice, the same both times, and is at least `NEW_PASSWORD_MIN_LENGTH`
   * characters. Typing it twice only catches a typo; it says nothing of how strong it is.
   */
  passwordConfirmed: Accessor<boolean>;

  /** Reads the identity and the connections again, and works out the stage afresh. */
  refresh: () => Promise<void>;
  /** "Create new identity": opens the identity window on making one. */
  makeIdentity: () => Promise<IdentityChangeOutcome>;
  /** "Link to another device": opens the identity window on joining one another device keeps. */
  linkIdentity: () => Promise<IdentityChangeOutcome>;
  /** "Restore with recovery phrase": opens the identity window on bringing the identity back from it. */
  useWords: () => Promise<IdentityChangeOutcome>;
  /** "Skip for now": no identity on this device for now; remembered here, and offered again in Settings. */
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
  /**
   * The host's own: a session the app had came back unreachable, and the offline state is due
   * (`offline`, the default); or the place refused this device's sign-in, and the connection choice is
   * due, with the reason as its error (`connect`).
   */
  handBack: (reason: string, to?: BaseHandBack) => void;
  /**
   * "Continue" on the password step: gives what the password field holds to this device's backend,
   * which makes or unlocks its agent with it, then clears the field. Takes no argument: the password
   * is read from the host's own field, never passed by a template.
   */
  submitPassword: () => Promise<void>;
  /** Takes back "that password was wrong", as the password field is typed in again. */
  clearPasswordWrong: () => void;
}

export type BaseStage =
  'loading' | 'starting' | 'failed' | 'password' | 'first-run' | 'connect' | 'offline' | 'handing-off' | 'session';

export type BasePage = '' | 'devices' | 'security';

/** Where a session handed back goes: the offline state, or the connection choice. */
export type BaseHandBack = 'offline' | 'connect';

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
  /** "Has master key", "Master key pending", or empty. */
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
  /** Where the choice and "Skip for now" are remembered. `localStorage` where there is one. */
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

/** The agent states that wait on the WE password, because no keyring could be used. */
const asksPassword = (state: BaseExecutorState | null): boolean =>
  state?.phase === 'ready' && (state.agent === 'needs-password' || state.agent === 'needs-new-password');
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
 * What the offline state says of a place that could not be reached, in words for the person: the host
 * an error names (`url`, as the connectors' unreachable errors carry it), else the place's own name.
 * This device's own backend is the app itself, so it is named by the app's name. The error's message
 * is left out: it is the network's ("Failed to fetch"), not something a person can act on.
 */
export function unreachableWords(connection: BaseConnection, error: unknown, appName: string): string {
  const url = (error as { url?: unknown } | null)?.url;
  if (typeof url === 'string' && url) {
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      // Not a URL: the whole of it is still a fair name.
    }
    return `Can't reach ${host}.`;
  }
  if (connection.kind === 'this-device') return `${appName} isn't responding.`;
  // The sign-in screen's row names a kind of place, not one: there is no host to name without a URL.
  if (connection.kind === 'connect') return "Can't reach the host.";
  return `Can't reach ${connection.label}.`;
}

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
  const [passwordWrong, setPasswordWrong] = createSignal(false);
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
    setError(`Couldn't read your identity: ${message(lastError)}`);
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
      setError(`Couldn't load the list: ${message(e)}`);
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
    /*
      The agent waits on the WE password. Asked here only where a base template draws the step (an
      identity to keep) and the host can take it; otherwise WE's own sign-in and create ask for it,
      as they did before there was a keyring.
    */
    if (asksPassword(own) && host.identity && host.executor?.givePassword) {
      setStage('password');
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
      setError(note || `Not available on this ${deviceNoun()}.`);
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

  /*
    Asks this device's backend again how it is (`BaseExecutor.refresh`): what it said at its start goes
    stale where a session changes it without a word (WE's sign-in unlocks a locked agent), and the
    doors follow it. Done when the base app is shown again and before a door is opened. A host that
    cannot answer leaves the state as it was.
  */
  async function lookAgain(): Promise<void> {
    try {
      await host.executor?.refresh?.();
    } catch {
      // As it was: this is a second look, not a start.
    }
  }

  async function openDoor(which: 'make' | 'link' | 'words'): Promise<IdentityChangeOutcome> {
    await lookAgain();
    const door = host.identity?.doors[which];
    return open(doorStep(door), doorNote(door));
  }

  async function choose(id: string, how: BaseHandOff = {}): Promise<void> {
    const connection = connections().find((c) => c.id === id);
    if (!connection) {
      setError("That option isn't available anymore.");
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
      setOfflineReason(`This ${deviceNoun()} is offline.`);
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
        setOfflineReason(unreachableWords(connection, e, options.brand.name));
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
      /*
        A session has its own way to follow its backend; and ready twice is nothing new, unless the
        agent came to wait on the password or stopped waiting on it.
      */
      const sameReady =
        next.phase === 'ready' && before?.phase === 'ready' && stage() !== 'password' && !asksPassword(next);
      /*
        Except one that has gone: the executor stopped under it (outside the app, from the tray, or
        it kept failing). The session has nothing left to follow, so the base takes the window back
        to say so, with the button that starts it again.
      */
      if (stage() === 'session' && next.phase === 'failed') {
        setStage('failed');
        return;
      }
      if (stage() === 'session' || sameReady) return;
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
          : d.name || UNNAMED_DEVICE,
        // What it is, never its key id: that is for the key log and the identity window's checks.
        subtitle: kind,
        icon: DEVICE_ICONS[d.kind] ?? 'key',
        thisDevice,
        master: d.holdsMaster === 'yes' ? 'Has master key' : d.holdsMaster === 'offered' ? 'Master key pending' : '',
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
    executorStopped: () => {
      const state = executor();
      return state?.phase === 'failed' && state.stopped === true;
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
      if (!state?.holdsMaster) return `Not on this ${noun}`;
      return state.unlock === 'os'
        ? `On this ${noun}, protected by your device login`
        : `On this ${noun}, protected by your passphrase`;
    },
    blocked: () => custody()?.blocked ?? '',
    devices,
    doors: createMemo<BaseDoors>(() => {
      // Tracked: a host's doors may follow its own backend (`BaseIdentitySource.doors`).
      executor();
      const source = host.identity;
      const none = `Not available on this ${deviceNoun()}.`;
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
    passwordIsNew: () => {
      const state = executor();
      return state?.phase === 'ready' && state.agent === 'needs-new-password';
    },
    passwordWrong,
    passwordEntered: credential.entered,
    passwordConfirmed: () => credential.confirmed() && credential.longEnough(NEW_PASSWORD_MIN_LENGTH),

    refresh: async () => {
      setCustody(null);
      await lookAgain();
      await evaluate();
    },
    makeIdentity: () => openDoor('make'),
    linkIdentity: () => openDoor('link'),
    useWords: () => openDoor('words'),
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
      const [list] = await Promise.all([loadConnections(() => asked === generation), lookAgain()]);
      if (list) setStage('connect');
    },
    openPage: (next) => setPage(next === 'devices' || next === 'security' ? next : ''),
    closePage: () => setPage(''),
    handBack: (reason, to = 'offline') => {
      generation++;
      if (to === 'connect') {
        // The choice is shown, not jumped past again to the place that refused.
        auto = false;
        batch(() => {
          setBusy(false);
          setError(reason);
          setStage('connect');
        });
        void lookAgain();
        return;
      }
      batch(() => {
        setBusy(false);
        setOfflineReason(reason);
        setStage('offline');
      });
      // The base app is shown again: the session may have unlocked the agent.
      void lookAgain();
    },
    submitPassword: async () => {
      const own = host.executor;
      const asked = executor();
      if (!own?.givePassword || !asksPassword(asked) || busy()) return;
      const password = credential.read();
      if (!password) return;
      // Past the ceiling every field stops at: not sent. The host refuses it too.
      if (!credential.withinMax()) return;
      // The floor is a new password's only: one an agent was made with opens it whatever its length.
      if (store.passwordIsNew() && !store.passwordConfirmed()) {
        // Typed once, twice and not the same, or under the floor: the field says which.
        credential.touch();
        return;
      }
      batch(() => {
        setBusy(true);
        setError('');
        setPasswordWrong(false);
      });
      let answer: BaseAgentPasswordAnswer | null = null;
      try {
        answer = await own.givePassword(password);
      } catch (e) {
        setError(message(e));
      } finally {
        credential.clear();
        setBusy(false);
      }
      if (answer === null) return;
      if (answer === 'wrong') {
        setPasswordWrong(true);
        return;
      }
      // Unlocked, refused (the host had moved on) or failed: the host's state says what follows.
      if (answer === 'unlocked' && executor() === asked) setExecutor({ phase: 'ready', agent: 'unlocked' });
      await lookAgain();
      await evaluate();
    },
    clearPasswordWrong: () => setPasswordWrong(false),
  };

  void evaluate();
  return store;
}
