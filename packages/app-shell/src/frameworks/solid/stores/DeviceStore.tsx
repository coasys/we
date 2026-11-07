/**
 * DeviceStore — the device keys that speak for the person, and adding or revoking one.
 *
 * Reads `IdentityPort.devices` (the device keys the key log lists). Adding and revoking are changes
 * like any other (`IdentityPort.change`): the backend asks the person wherever it keeps the master
 * key, and signs the change there. The device list is read again when either ends.
 *
 * And which device serves this session (`IdentityPort.serving`): this computer, or a server the
 * person added by its address and logs in to with this computer's device key. Choosing one starts
 * the app over against it; a server that ends the session (the person removed this device) is said
 * in `sessionEnded`, with the way back to this computer.
 *
 * Chrome tier only (`devices` in `templateSurface.ts`): a space template never sees a person's
 * devices.
 */
import { type DeviceRow, deviceRows } from '@shared/identityRows';
import {
  type AddServerOutcome,
  type DeviceKeyView,
  type IdentityChangeOutcome,
  type ServingSessionEnded,
  type ServingView,
  THIS_COMPUTER_ID,
} from '@we/backend-shared';
import { toastService } from '@we/components/solid';
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

import { useIdentityStore } from './IdentityStore';
import { useSessionStore } from './SessionStore';

/** A device that can serve this session, worded for its row. */
export interface ServingRow {
  /** `this-computer`, or the server's address. */
  id: string;
  name: string;
  /** The server's address, or "Runs here" for this computer. */
  subtitle: string;
  icon: 'desktop' | 'cloud';
  /** It serves this session now. */
  current: boolean;
  /** Not the one serving now, and a server: it can be forgotten. */
  canRemove: boolean;
}

/** How a server ended this session, with what to say about it. */
export interface SessionEndedView extends ServingSessionEnded {
  message: string;
}

export function servingRows(view: ServingView | null): ServingRow[] {
  return (view?.devices ?? []).map((device) => ({
    id: device.id,
    name: device.name,
    subtitle: device.address ?? 'Runs here',
    icon: device.id === THIS_COMPUTER_ID ? 'desktop' : 'cloud',
    current: device.current,
    canRemove: device.id !== THIS_COMPUTER_ID && !device.current,
  }));
}

export function sessionEndedMessage(ended: ServingSessionEnded): string {
  return ended.reason === 'revoked'
    ? `This device was removed from your identity, so ${ended.name} no longer lets it in.`
    : `Your session on ${ended.name} ended.`;
}

export interface DeviceStore {
  /** The device keys, valid first, this computer at the top. */
  devices: Accessor<DeviceRow[]>;
  devicesLoaded: Accessor<boolean>;
  /** How many keys are valid. */
  validCount: Accessor<number>;
  /** Add and revoke can be offered: this computer keeps the master key of the identity. */
  canManage: Accessor<boolean>;
  /** Why the last read failed, or empty. */
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Adds a device to the identity. */
  addDevice: () => Promise<IdentityChangeOutcome>;
  /** Revokes the device key `keyId`. */
  revoke: (keyId: string) => Promise<IdentityChangeOutcome>;

  // ── Which device serves this session ──
  /** A server can be added and chosen: the backend logs in to one with this computer's device key. */
  canSwitch: Accessor<boolean>;
  /** This computer and the servers added, the one serving now marked `current`. */
  servers: Accessor<ServingRow[]>;
  /** `operator` on a server this person runs, `agent` on one that serves them; empty on this computer. */
  servingRole: Accessor<string>;
  /** Why the chosen server is not serving this session (this computer serves instead), or empty. */
  servingProblem: Accessor<string>;
  /** The server ended this session, and why; null otherwise. Offer `serveFrom('this-computer')`. */
  sessionEnded: Accessor<SessionEndedView | null>;
  /** The address typed into "Add a server". */
  serverAddress: Accessor<string>;
  /** Why adding or choosing a server did not work, in words a person reads, or empty. */
  serverError: Accessor<string>;
  /** A server is being added, or a device chosen. */
  serverBusy: Accessor<boolean>;

  setServerAddress: (address: string) => void;
  refreshServers: () => Promise<void>;
  /** Logs in to the server at `serverAddress` with this computer's key, and lists it if it lets it in. */
  addServer: () => Promise<AddServerOutcome | null>;
  /** Serves this session from the device `id` from now on; the app starts over against it. */
  serveFrom: (id: string) => Promise<void>;
  /** Forgets the server `id`. Not the one serving now. */
  removeServer: (id: string) => Promise<void>;
}

const DeviceStoreContext = createContext<DeviceStore>();

export function DeviceStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const identity = useIdentityStore();
  const port = () => session.backendPorts()?.identity ?? null;

  const [raw, setRaw] = createSignal<DeviceKeyView[]>([]);
  const [devicesLoaded, setDevicesLoaded] = createSignal(false);
  const [error, setError] = createSignal('');

  // As in the identity store: a reply belongs to the port it was asked of and to the latest read.
  let generation = 0;
  createEffect(
    on(port, () => {
      generation++;
      setRaw([]);
      setDevicesLoaded(false);
      setError('');
    }),
  );

  async function refresh(): Promise<void> {
    const p = port();
    if (!p?.devices) return;
    const asked = ++generation;
    const current = () => asked === generation && port() === p;
    try {
      // A device speaking for nobody has no log, so no devices; asking would only be refused.
      const next = identity.did() ? await p.devices() : [];
      if (!current()) return;
      setRaw(next);
      setDevicesLoaded(true);
      setError('');
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // The device list follows the key log: read it whenever the identity store has read the log again.
  createEffect(() => {
    if (identity.keyLogLoaded()) {
      identity.keyLog();
      void refresh();
    }
  });

  async function step(run: () => Promise<IdentityChangeOutcome>): Promise<IdentityChangeOutcome> {
    const outcome = await run();
    await refresh();
    return outcome;
  }

  // ── Which device serves this session ──
  const canSwitch = createMemo(() => session.identityCapabilities().switchDevice && !!port()?.serving);
  const [serving, setServing] = createSignal<ServingView | null>(null);
  const [sessionEnded, setSessionEnded] = createSignal<SessionEndedView | null>(null);
  const [serverAddress, setServerAddress] = createSignal('');
  const [serverError, setServerError] = createSignal('');
  const [serverBusy, setServerBusy] = createSignal(false);

  async function refreshServers(): Promise<void> {
    const p = port();
    if (!canSwitch() || !p?.serving) return;
    try {
      const next = await p.serving();
      if (port() === p) setServing(next);
    } catch (e) {
      if (port() === p) setServerError(e instanceof Error ? e.message : String(e));
    }
  }

  createEffect(
    on(port, (p) => {
      setServing(null);
      setSessionEnded(null);
      setServerError('');
      if (!p?.onSessionEnded) return;
      // The port keeps an end that came before anyone listened, so subscribing late still hears it.
      const off = p.onSessionEnded((ended) => {
        const message = sessionEndedMessage(ended);
        setSessionEnded({ ...ended, message });
        // Said wherever the person is, not only on the Devices page, and kept until they act on it:
        // nothing they do on that server works any more.
        toastService.add(message, 'danger', 0, {
          label: 'Back to this computer',
          run: () => void serveFrom(THIS_COMPUTER_ID),
        });
      });
      onCleanup(off);
    }),
  );
  createEffect(() => {
    if (canSwitch()) void refreshServers();
  });

  async function serverStep(run: () => Promise<void>): Promise<void> {
    setServerBusy(true);
    setServerError('');
    try {
      await run();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setServerBusy(false);
    }
  }

  async function addServer(): Promise<AddServerOutcome | null> {
    const p = port();
    const address = serverAddress().trim();
    if (!p?.addServer || !address) return null;
    let outcome: AddServerOutcome | null = null;
    await serverStep(async () => {
      outcome = await p.addServer!(address);
      if (outcome.ok) {
        setServerAddress('');
        await refreshServers();
      } else setServerError(outcome.message);
    });
    return outcome;
  }

  async function serveFrom(id: string): Promise<void> {
    const p = port();
    if (!p?.serveFrom) return;
    await serverStep(() => p.serveFrom!(id));
  }

  async function removeServer(id: string): Promise<void> {
    const p = port();
    if (!p?.removeServer) return;
    await serverStep(async () => {
      await p.removeServer!(id);
      await refreshServers();
    });
  }

  const servers = createMemo(() => servingRows(serving()));

  const rows = createMemo(() => deviceRows(raw()));
  const store: DeviceStore = {
    devices: rows,
    devicesLoaded,
    validCount: () => rows().filter((d) => !d.revoked).length,
    canManage: () =>
      session.identityCapabilities().linkDevice &&
      identity.canChange() &&
      !!identity.did() &&
      !!identity.custody()?.holdsMaster,
    error,
    refresh,
    addDevice: () => step(() => identity.open({ kind: 'add-device' })),
    revoke: (keyId: string) => step(() => identity.open({ kind: 'revoke', keyId })),
    canSwitch,
    servers,
    servingRole: () => serving()?.role ?? '',
    servingProblem: () => serving()?.problem ?? '',
    sessionEnded,
    serverAddress,
    serverError,
    serverBusy,
    setServerAddress: (address: string) => setServerAddress(typeof address === 'string' ? address : ''),
    refreshServers,
    addServer,
    serveFrom,
    removeServer,
  };

  return <DeviceStoreContext.Provider value={store}>{props.children}</DeviceStoreContext.Provider>;
}

export function useDeviceStore(): DeviceStore {
  const store = useContext(DeviceStoreContext);
  if (!store) throw new Error('useDeviceStore must be used within DeviceStoreProvider');
  return store;
}
