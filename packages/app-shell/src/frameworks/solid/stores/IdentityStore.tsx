/**
 * IdentityStore — who this computer speaks for, and the log of every change to their keys.
 *
 * The Solid binding over two halves that never meet in the main window:
 *
 * - **The public half**, from the backend's `IdentityPort`: the `did:scid` this device's key speaks
 *   for, and the person's key log, which the executor checked event by event before answering.
 * - **The custody half**, from the host's `PlatformAdapter.identity`: whether this computer keeps a
 *   master key, and opening the host's identity window on a step (make the identity, add a device,
 *   revoke one). Words, passphrases and keys stay in that window and the host's main process; this
 *   store learns only how a step ended, and then reads the public half again.
 *
 * Chrome tier only (`keys` in `templateSurface.ts`): a space template never sees who the person is
 * beyond their profile, or that a key log exists.
 *
 * The first run: on a computer whose shell keeps master keys, a
 * session whose device key speaks for nobody is asked to make an identity here — or to start
 * without one, which `startWithoutIdentity` remembers on this computer.
 */
import { type KeyLogRow, keyLogRows } from '@shared/identityRows';
import type { CustodyPublic, IdentityStep, IdentityStepOutcome } from '@shared/platform/types';
import { usePlatform } from '@solid/providers/PlatformProvider';
import type { IdentityStatusView, KeyLogEvent, KeyLogFork } from '@we/backend-shared';
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
  /** This computer's shell keeps master keys, so the identity can be changed from here. */
  canChange: Accessor<boolean>;
  /**
   * Why the identity cannot be made or changed here although the shell keeps master keys (a build
   * with no identity store key), in words a person reads; empty when it can.
   */
  changeBlocked: Accessor<string>;
  status: Accessor<IdentityStatusView | null>;
  /** The backend has answered `status` once. */
  statusLoaded: Accessor<boolean>;
  /** The person's `did:scid`, or empty while this device speaks for nobody. */
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
  /** What the custody service says, public facts only; null where the host has none. */
  custody: Accessor<CustodyPublic | null>;
  /**
   * The first-run question is due: a shell that keeps keys, a device speaking for nobody, no "Start
   * now". Asked even where `changeBlocked` says the identity cannot be made yet, so the person
   * learns why; the screen offers "Start now" then.
   */
  needsFirstRun: Accessor<boolean>;
  /** A step is open in the identity window. */
  busy: Accessor<boolean>;
  /** How the last step ended, or empty. */
  lastOutcome: Accessor<IdentityStepOutcome | ''>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  /** Reads the status, the log and the custody state again. */
  refresh: () => Promise<void>;
  /** Opens the identity window on a step, waits for it, then reads everything again. */
  open: (step: IdentityStep) => Promise<IdentityStepOutcome>;
  /** "Make my identity here". */
  makeIdentity: () => Promise<IdentityStepOutcome>;
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
  const platform = usePlatform();
  const session = useSessionStore();
  const host = platform.identity;

  const port = () => session.backendPorts()?.identity ?? null;
  const ready = () => session.bootState() === 'ready' || session.bootState() === 'finishing';

  const [status, setStatus] = createSignal<IdentityStatusView | null>(null);
  const [statusLoaded, setStatusLoaded] = createSignal(false);
  const [events, setEvents] = createSignal<KeyLogEvent[]>([]);
  const [keyLogLoaded, setKeyLogLoaded] = createSignal(false);
  const [fork, setFork] = createSignal<KeyLogFork | null>(null);
  const [custody, setCustody] = createSignal<CustodyPublic | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [lastOutcome, setLastOutcome] = createSignal<IdentityStepOutcome | ''>('');
  const [error, setError] = createSignal('');
  const [startNow, setStartNow] = createSignal(readStartNow());

  const available = createMemo(() => !!port()?.status);
  const did = createMemo(() => status()?.did ?? '');
  const keyId = createMemo(() => status()?.keyId ?? '');
  const changeBlocked = createMemo(() => custody()?.blocked ?? '');

  async function refresh(): Promise<void> {
    const identity = port();
    if (host) {
      try {
        setCustody(await host.publicState());
      } catch (e) {
        console.warn('IdentityStore: the custody service did not answer', e);
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

  if (host?.onCustodyChanged) {
    const off = host.onCustodyChanged((state) => {
      setCustody(state);
      void refresh();
    });
    onCleanup(off);
  }

  async function open(step: IdentityStep): Promise<IdentityStepOutcome> {
    if (!host) throw new Error('This app cannot change your identity: no app here keeps your master key.');
    // Refused here as well as in the custody service, so no window opens on a step that cannot run.
    if (changeBlocked()) throw new Error(changeBlocked());
    setBusy(true);
    try {
      const outcome = await host.open(step);
      setLastOutcome(outcome);
      return outcome;
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const store: IdentityStore = {
    available,
    canChange: () => !!host && !changeBlocked(),
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
        !!host &&
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
