/**
 * IdentityStore — who this computer speaks for, and the log of every change to their keys.
 *
 * The Solid binding over the backend's `IdentityPort`, which answers two kinds of question:
 *
 * - **Reads**: the identity this device's key speaks for, and the person's key log, which the
 *   backend checked event by event before answering.
 * - **Changes**: whether this computer can sign one (`custody`), and running one (`change`: make the
 *   identity, add a device, revoke one). Where the master key is kept, and what the person is shown
 *   while a change runs, is the backend's; words, passphrases and keys never reach this store, which
 *   learns only how a change ended and then reads everything again.
 *
 * Chrome tier only (`keys` in `templateSurface.ts`): a space template never sees who the person is
 * beyond their profile, or that a key log exists.
 *
 * The first run: on a computer whose shell keeps master keys, a
 * session whose device key speaks for nobody is asked to make an identity here — or to start
 * without one, which `startWithoutIdentity` remembers on this computer.
 */
import { type KeyLogRow, keyLogRows } from '@shared/identityRows';
import type {
  IdentityChange,
  IdentityChangeOutcome,
  IdentityCustodyView,
  IdentityStatusView,
  KeyLogEvent,
  KeyLogFork,
} from '@we/backend-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';

import { useSessionStore } from './SessionStore';

/** Where "Start now" is remembered: per computer, like the choice it records. */
export const START_NOW_KEY = 'coasys.identity.startNow';

export interface IdentityStore {
  /** The backend can say who this device speaks for (it has a key log). */
  available: Accessor<boolean>;
  /** This computer can sign changes to the identity, and nothing blocks them. */
  canChange: Accessor<boolean>;
  /**
   * Why the identity cannot be made or changed here although this computer could sign changes (the
   * backend has nowhere to publish them, say), in words a person reads; empty when it can.
   */
  changeBlocked: Accessor<string>;
  status: Accessor<IdentityStatusView | null>;
  /** The backend has answered `status` once. */
  statusLoaded: Accessor<boolean>;
  /** The person's identifier, or empty while this device speaks for nobody. */
  did: Accessor<string>;
  /** This device's id in the log (`d1`), or empty. */
  keyId: Accessor<string>;
  /** The log names this computer's key revoked. */
  thisDeviceRevoked: Accessor<boolean>;
  /** The key log, newest first, as Settings → Security → Key log draws it. */
  keyLog: Accessor<KeyLogRow[]>;
  keyLogLoaded: Accessor<boolean>;
  /** The backend found two logs for this identity. */
  forked: Accessor<boolean>;
  fork: Accessor<KeyLogFork | null>;
  /** Whether this computer can sign changes, public facts only; null where the backend says nothing. */
  custody: Accessor<IdentityCustodyView | null>;
  /**
   * The first-run question is due: a computer that can sign changes, a device speaking for nobody,
   * no "Start now". Asked even where `changeBlocked` says the identity cannot be made yet, so the
   * person learns why; the screen offers "Start now" then.
   */
  needsFirstRun: Accessor<boolean>;
  /** A change is running. */
  busy: Accessor<boolean>;
  /** How the last change ended, or empty. */
  lastOutcome: Accessor<IdentityChangeOutcome | ''>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  /** Reads the status, the log and the custody state again. */
  refresh: () => Promise<void>;
  /** Runs a change, waits for it to end, then reads everything again. */
  open: (change: IdentityChange) => Promise<IdentityChangeOutcome>;
  /** "Make my identity here". */
  makeIdentity: () => Promise<IdentityChangeOutcome>;
  /** "Start now": use the app without an identity on this computer; asked again from Settings. */
  startWithoutIdentity: () => void;
}

const IdentityStoreContext = createContext<IdentityStore>();

function readStartNow(): boolean {
  try {
    return localStorage.getItem(START_NOW_KEY) === '1';
  } catch {
    return false;
  }
}

export function IdentityStoreProvider(props: ParentProps) {
  const session = useSessionStore();

  const port = () => session.backendPorts()?.identity ?? null;
  const ready = () => session.bootState() === 'ready' || session.bootState() === 'finishing';

  const [status, setStatus] = createSignal<IdentityStatusView | null>(null);
  const [statusLoaded, setStatusLoaded] = createSignal(false);
  const [events, setEvents] = createSignal<KeyLogEvent[]>([]);
  const [keyLogLoaded, setKeyLogLoaded] = createSignal(false);
  const [fork, setFork] = createSignal<KeyLogFork | null>(null);
  const [custody, setCustody] = createSignal<IdentityCustodyView | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [lastOutcome, setLastOutcome] = createSignal<IdentityChangeOutcome | ''>('');
  const [error, setError] = createSignal('');
  const [startNow, setStartNow] = createSignal(readStartNow());

  const available = createMemo(() => !!port()?.status);
  const did = createMemo(() => status()?.did ?? '');
  const keyId = createMemo(() => status()?.keyId ?? '');
  const changeBlocked = createMemo(() => custody()?.blocked ?? '');

  async function refresh(): Promise<void> {
    const identity = port();
    if (identity?.custody) {
      try {
        setCustody(await identity.custody());
      } catch (e) {
        console.warn('IdentityStore: the backend did not say whether this computer can sign changes', e);
      }
    }
    if (!identity?.status) return;
    try {
      const next = await identity.status();
      setStatus(next);
      setStatusLoaded(true);
      if (next.fork) setFork(next.fork);
      if (next.did && identity.log) {
        const log = await identity.log(next.did);
        setEvents(log.events);
        if (log.fork) setFork(log.fork);
      } else {
        setEvents([]);
      }
      setKeyLogLoaded(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Read once the session can answer, and again whenever it reconnects to another backend.
  createEffect(() => {
    if (ready() && port()) void refresh();
  });

  createEffect(() => {
    const identity = port();
    if (!identity?.onFork) return;
    const off = identity.onFork((f) => setFork(f));
    onCleanup(off);
  });

  async function open(change: IdentityChange): Promise<IdentityChangeOutcome> {
    const identity = port();
    if (!identity?.change) throw new Error('This computer cannot change your identity.');
    // Refused here as well as by the backend, so nothing opens on a change that cannot run.
    if (changeBlocked()) throw new Error(changeBlocked());
    setBusy(true);
    try {
      const outcome = await identity.change(change);
      setLastOutcome(outcome);
      return outcome;
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const store: IdentityStore = {
    available,
    canChange: () => !!port()?.change && !changeBlocked(),
    changeBlocked,
    status,
    statusLoaded,
    did,
    keyId,
    thisDeviceRevoked: () => status()?.revoked != null,
    keyLog: createMemo(() => keyLogRows(events(), keyId() || null)),
    keyLogLoaded,
    forked: () => fork() !== null,
    fork,
    custody,
    needsFirstRun: createMemo(
      () =>
        !!port()?.change &&
        custody() !== null &&
        available() &&
        statusLoaded() &&
        !did() &&
        !startNow() &&
        !custody()?.holdsMaster,
    ),
    busy,
    lastOutcome,
    error,
    refresh,
    open,
    makeIdentity: () => open({ kind: 'create' }),
    startWithoutIdentity: () => {
      try {
        localStorage.setItem(START_NOW_KEY, '1');
      } catch {
        // Not remembered past this run; the question comes back next time, which is harmless.
      }
      setStartNow(true);
    },
  };

  return <IdentityStoreContext.Provider value={store}>{props.children}</IdentityStoreContext.Provider>;
}

export function useIdentityStore(): IdentityStore {
  const store = useContext(IdentityStoreContext);
  if (!store) throw new Error('useIdentityStore must be used within IdentityStoreProvider');
  return store;
}
