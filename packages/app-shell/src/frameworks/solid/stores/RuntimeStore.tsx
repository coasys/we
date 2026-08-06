/**
 * RuntimeStore — the backend process's own settings, and the consent prompts it raises.
 *
 * The Solid binding over `RuntimeAdminPort`. Two jobs that look unrelated but share a reason to
 * exist: both are things the ADAM launcher used to do on WE's behalf, and both stopped happening
 * when the desktop hosts started bundling the executor instead of shelling out to it.
 *
 * **Settings** — trust, peer network, authorized apps. Loaded when the settings overlay opens
 * rather than at boot: a user who never opens settings should not pay round trips for them, and
 * the data is stale the moment it lands anyway. Network metrics stay strictly manual — it is a
 * diagnostic, and fetching one nobody asked for is the same mistake one level down.
 *
 * **Consent** — capability and trust requests, raised by the backend while the app runs. Unlike
 * the settings these are *not* optional to handle. An embedded app (Flux in a `we-iframe`) asking
 * for credentials on a bundled-executor host has nobody listening: the launcher window that would
 * have prompted does not exist. The request waits until the app times out, and the user sees a
 * blank iframe with no indication that anything asked them a question.
 *
 * Every capability is feature-detected against the port, so a backend supplying none of it leaves
 * `canManageTrust` and friends false and the settings template renders nothing for that section.
 * The in-memory backend supplies no runtime port at all, which is the case that keeps this honest.
 */
import { useSessionStore } from '@solid/stores/SessionStore';
import { useShellStore } from '@solid/stores/ShellStore';
import type { AuthorizedApp, ConsentRequest } from '@we/backend-shared';
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

export interface RuntimeStore {
  // ── Capability flags (schemas gate sections on these) ────────────────────────
  /** True when this backend exposes any runtime administration at all. */
  canAdminister: Accessor<boolean>;
  canManageTrust: Accessor<boolean>;
  canManageNetwork: Accessor<boolean>;
  canManageApps: Accessor<boolean>;

  // ── State ────────────────────────────────────────────────────────────────────
  trustedAgents: Accessor<string[]>;
  authorizedApps: Accessor<AuthorizedApp[]>;
  /** Backend diagnostic blob, displayed verbatim. Empty until requested. */
  networkMetrics: Accessor<string>;
  peerInfos: Accessor<string[]>;
  /** True while any runtime call is in flight — drives one shared spinner. */
  loading: Accessor<boolean>;
  /** Last runtime error, for display. Cleared at the start of each call. */
  error: Accessor<string>;
  /** The consent request awaiting a decision, if any. Schemas render a modal on this. */
  pendingConsent: Accessor<ConsentRequest | null>;
  /** A secret returned by an approval that must be relayed to the asker by hand. */
  consentSecret: Accessor<string>;

  // ── Actions ──────────────────────────────────────────────────────────────────
  loadTrustedAgents: () => Promise<void>;
  trustAgent: (id: string) => Promise<void>;
  untrustAgent: (id: string) => Promise<void>;
  loadAuthorizedApps: () => Promise<void>;
  revokeApp: (id: string) => Promise<void>;
  removeApp: (id: string) => Promise<void>;
  loadNetworkMetrics: () => Promise<void>;
  restartNetwork: () => Promise<void>;
  loadPeerInfos: () => Promise<void>;
  addPeerInfos: (infos: string) => Promise<void>;
  approveConsent: () => Promise<void>;
  denyConsent: () => Promise<void>;
  dismissConsentSecret: () => void;
}

const RuntimeContext = createContext<RuntimeStore>();

export function RuntimeStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const shell = useShellStore();

  const [trustedAgents, setTrustedAgents] = createSignal<string[]>([]);
  const [authorizedApps, setAuthorizedApps] = createSignal<AuthorizedApp[]>([]);
  const [networkMetrics, setNetworkMetrics] = createSignal('');
  const [peerInfos, setPeerInfos] = createSignal<string[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [consentSecret, setConsentSecret] = createSignal('');

  // A queue, not a single slot: two apps can ask at once, and dropping the second would leave it
  // hanging exactly the way having no listener at all does. The template renders the head.
  const [consentQueue, setConsentQueue] = createSignal<ConsentRequest[]>([]);
  const pendingConsent = createMemo(() => consentQueue()[0] ?? null);

  const runtime = () => session.backendPorts()?.runtime;

  const canAdminister = createMemo(() => !!runtime());
  const canManageTrust = createMemo(() => !!runtime()?.trustedAgents);
  const canManageNetwork = createMemo(() => !!runtime()?.networkMetrics);
  const canManageApps = createMemo(() => !!runtime()?.authorizedApps);

  /**
   * Every action runs through here: one loading flag, one error slot, and a guarantee that a
   * rejected runtime call surfaces as text on the settings page rather than an unhandled rejection
   * in a console nobody has open.
   */
  async function run<T>(fn: () => Promise<T> | undefined): Promise<T | undefined> {
    setLoading(true);
    setError('');
    try {
      return await fn();
    } catch (err) {
      console.error('RuntimeStore: runtime call failed', err);
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    } finally {
      setLoading(false);
    }
  }

  // ── Consent subscription ─────────────────────────────────────────────────────
  // Subscribes as soon as the port exists — deliberately not gated on boot completing. A capability
  // request can arrive while the user is still on the boot screen (an embedded app mounted by the
  // previous session's route restores before onboarding finishes), and the queue holds it.
  createEffect(() => {
    const port = runtime();
    if (!port?.onConsentRequest) return;

    const unsubscribe = port.onConsentRequest((request) => {
      setConsentQueue((queue) => [...queue, request]);
    });
    onCleanup(unsubscribe);
  });

  // ── On-demand loading ────────────────────────────────────────────────────────
  // The schema language has no mount hook, and the alternatives are both worse than this: loading
  // at boot spends round trips on data most sessions never look at, while a "Load" button in each
  // section makes the page start empty and asks the user to do the app's job. Opening the settings
  // overlay is the actual demand signal, and it is already reactive state.
  createEffect(() => {
    if (shell.activeShellView() !== 'settings') return;
    if (canManageTrust()) void loadTrustedAgents();
    if (canManageApps()) void loadAuthorizedApps();
  });

  function dropHead() {
    setConsentQueue((queue) => queue.slice(1));
  }

  async function approveConsent(): Promise<void> {
    const request = pendingConsent();
    const port = runtime();
    if (!request || !port?.approve) return;

    const secret = await run(() => port.approve?.(request));
    dropHead();
    // Capability approvals return a code the user reads out to the asking app. Trust approvals
    // return nothing, and must not leave a stale code on screen from a previous approval.
    setConsentSecret(typeof secret === 'string' ? secret : '');
    if (request.kind === 'capability') void loadAuthorizedApps();
  }

  async function denyConsent(): Promise<void> {
    const request = pendingConsent();
    const port = runtime();
    if (!request) return;
    // Drop it either way: a backend with no `deny` still means the user declined, and leaving the
    // prompt up because the backend has no way to say "no" would trap them on the modal.
    if (port?.deny) await run(() => port.deny?.(request));
    dropHead();
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async function loadTrustedAgents(): Promise<void> {
    const agents = await run(() => runtime()?.trustedAgents?.());
    if (agents) setTrustedAgents(agents);
  }

  async function trustAgent(id: string): Promise<void> {
    const trimmed = id.trim();
    if (!trimmed) return;
    await run(() => runtime()?.trustAgent?.(trimmed));
    await loadTrustedAgents();
  }

  async function untrustAgent(id: string): Promise<void> {
    await run(() => runtime()?.untrustAgent?.(id));
    await loadTrustedAgents();
  }

  async function loadAuthorizedApps(): Promise<void> {
    const apps = await run(() => runtime()?.authorizedApps?.());
    if (apps) setAuthorizedApps(apps);
  }

  async function revokeApp(id: string): Promise<void> {
    await run(() => runtime()?.revokeApp?.(id));
    await loadAuthorizedApps();
  }

  async function removeApp(id: string): Promise<void> {
    await run(() => runtime()?.removeApp?.(id));
    await loadAuthorizedApps();
  }

  async function loadNetworkMetrics(): Promise<void> {
    const metrics = await run(() => runtime()?.networkMetrics?.());
    if (metrics !== undefined) setNetworkMetrics(metrics);
  }

  async function restartNetwork(): Promise<void> {
    await run(() => runtime()?.restartNetwork?.());
  }

  async function loadPeerInfos(): Promise<void> {
    const infos = await run(() => runtime()?.peerInfos?.());
    if (infos) setPeerInfos(infos);
  }

  /**
   * Takes the pasted blob as one string. Peer infos are exchanged by copy-paste when discovery
   * fails, and what gets pasted is whatever the other machine printed — a JSON array, or one
   * record per line. Accepting both here means the user is not asked to reformat it first.
   */
  async function addPeerInfos(infos: string): Promise<void> {
    const parsed = parsePeerInfos(infos);
    if (!parsed.length) {
      setError('Could not read any peer info from that text');
      return;
    }
    await run(() => runtime()?.addPeerInfos?.(parsed));
    await loadPeerInfos();
  }

  const store: RuntimeStore = {
    canAdminister,
    canManageTrust,
    canManageNetwork,
    canManageApps,

    trustedAgents,
    authorizedApps,
    networkMetrics,
    peerInfos,
    loading,
    error,
    pendingConsent,
    consentSecret,

    loadTrustedAgents,
    trustAgent,
    untrustAgent,
    loadAuthorizedApps,
    revokeApp,
    removeApp,
    loadNetworkMetrics,
    restartNetwork,
    loadPeerInfos,
    addPeerInfos,
    approveConsent,
    denyConsent,
    dismissConsentSecret: () => setConsentSecret(''),
  };

  return <RuntimeContext.Provider value={store}>{props.children}</RuntimeContext.Provider>;
}

/** JSON array first, then one-per-line. Exported for the test that pins both shapes. */
export function parsePeerInfos(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Not JSON — fall through to the line-separated reading.
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function useRuntimeStore(): RuntimeStore {
  const context = useContext(RuntimeContext);
  if (!context) throw new Error('useRuntimeStore must be used within the RuntimeStoreProvider');
  return context;
}
