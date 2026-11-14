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
 * The first run: on a computer that can sign changes, a session whose device key speaks for nobody is
 * asked to make an identity here — or to start without one, which `startWithoutIdentity` remembers
 * for that account on this computer.
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
  on,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';

import { useSessionStore } from './SessionStore';

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
  /** Why the last read or change failed, in words a person reads, or empty. */
  error: Accessor<string>;

  /** Reads the status, the log and the custody state again. */
  refresh: () => Promise<void>;
  /**
   * Runs a change, waits for it to end, then reads everything again. Never rejects: a change that
   * cannot start or fails on the way resolves `'failed'`, with the reason in `error`.
   */
  open: (change: IdentityChange) => Promise<IdentityChangeOutcome>;
  /** "Make my identity here". */
  makeIdentity: () => Promise<IdentityChangeOutcome>;
  /**
   * "Start now": use this account without an identity on this computer; remembered for it, and asked
   * again from Settings.
   */
  startWithoutIdentity: () => void;
}

const IdentityStoreContext = createContext<IdentityStore>();

/**
 * Where "Start now" is remembered for one account on this computer. Keyed by the account's own
 * device key, so choosing it in one account does not put the question away in another.
 */
export const startNowKey = (deviceKey: string) => `we.identity.startNow:${deviceKey}`;

function readStartNow(deviceKey: string): boolean {
  if (!deviceKey) return false;
  try {
    return localStorage.getItem(startNowKey(deviceKey)) === '1';
  } catch {
    return false;
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  const [startNowChosen, setStartNowChosen] = createSignal(false);

  const deviceKey = createMemo(() => status()?.deviceKey ?? '');
  const startNow = createMemo(() => startNowChosen() || readStartNow(deviceKey()));
  // What the backend said it can do (`sessionStore.identityCapabilities`), not merely what methods exist.
  const available = createMemo(() => session.identityCapabilities().keyLog && !!port()?.status);
  const did = createMemo(() => status()?.did ?? '');
  const keyId = createMemo(() => status()?.keyId ?? '');
  const changeBlocked = createMemo(() => custody()?.blocked ?? '');
  // Not until the backend has said this computer can sign changes: a custody service that has not
  // answered is one nothing is known about, and a door offered then would only fail.
  const canChange = createMemo(() => !!port()?.change && custody() !== null && !changeBlocked());

  /*
    Every read belongs to the port it was asked of. A reply that comes back after the session moved to
    another backend (another account, a reconnect) is dropped rather than drawn as the new one's, and
    so is one overtaken by a later read of the same port.
  */
  let generation = 0;

  // Another backend is another person, or the same one reached afresh: nothing read before carries over.
  createEffect(
    on(port, () => {
      generation++;
      setStatus(null);
      setStatusLoaded(false);
      setEvents([]);
      setKeyLogLoaded(false);
      setFork(null);
      setCustody(null);
      setLastOutcome('');
      setError('');
      setStartNowChosen(false);
    }),
  );

  async function refresh(): Promise<void> {
    const identity = port();
    if (!identity) return;
    const asked = ++generation;
    const current = () => asked === generation && port() === identity;
    if (identity.custody) {
      try {
        const state = await identity.custody();
        if (!current()) return;
        setCustody(state);
      } catch (e) {
        if (!current()) return;
        // Unknown again, so nothing offers a change the backend has not said it can sign.
        setCustody(null);
        console.warn('IdentityStore: the backend did not say whether this computer can sign changes', e);
      }
    }
    if (!identity.status) return;
    try {
      const next = await identity.status();
      if (!current()) return;
      const log = next.did && identity.log ? await identity.log(next.did) : null;
      if (!current()) return;
      setStatus(next);
      setStatusLoaded(true);
      setEvents(log?.events ?? []);
      // The backend's own answer, a fork it no longer reports included: a banner stays only while true.
      setFork(log?.fork ?? next.fork ?? null);
      setKeyLogLoaded(true);
      setError('');
    } catch (e) {
      if (!current()) return;
      setError(message(e));
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

  /*
    A change never rejects. It is called from a press in a template, where a rejection reaches only the
    console; so whatever stops it — no way to sign here, a reason the backend gave, a failure on the
    way — becomes `lastOutcome: 'failed'` with the reason in `error`, which the screens draw.
  */
  async function open(change: IdentityChange): Promise<IdentityChangeOutcome> {
    const identity = port();
    const refused = !identity?.change
      ? "This computer can't change your identity."
      : // Refused here as well as by the backend, so nothing opens on a change that cannot run.
        changeBlocked();
    if (refused || !identity?.change) {
      setLastOutcome('failed');
      setError(refused);
      return 'failed';
    }
    setBusy(true);
    setError('');
    let outcome: IdentityChangeOutcome;
    let reason = '';
    try {
      outcome = await identity.change(change);
    } catch (e) {
      outcome = 'failed';
      reason = message(e);
    } finally {
      setBusy(false);
    }
    setLastOutcome(outcome);
    await refresh();
    // After the read, which clears `error` when it succeeds: why the change failed outlives it.
    if (reason) setError(reason);
    return outcome;
  }

  const store: IdentityStore = {
    available,
    canChange,
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
      const key = deviceKey();
      try {
        if (key) localStorage.setItem(startNowKey(key), '1');
      } catch {
        // Not remembered past this run; the question comes back next time, which is harmless.
      }
      setStartNowChosen(true);
    },
  };

  return <IdentityStoreContext.Provider value={store}>{props.children}</IdentityStoreContext.Provider>;
}

export function useIdentityStore(): IdentityStore {
  const store = useContext(IdentityStoreContext);
  if (!store) throw new Error('useIdentityStore must be used within IdentityStoreProvider');
  return store;
}
