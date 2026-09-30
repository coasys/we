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
import type { ExecutorSettings } from '@shared/platform/types';
import { copyText } from '@shared/utils';
import { usePlatform } from '@solid/providers/PlatformProvider';
import {
  AI_API_PRESETS,
  type AiModelForm,
  type AiModelView,
  CUSTOM_SERVICE,
  describeModel,
  draftFrom,
  EMPTY_FORM,
  formComplete,
  toDraft,
} from '@solid/stores/aiModelDraft';
import { useSessionStore } from '@solid/stores/SessionStore';
import { useShellStore } from '@solid/stores/ShellStore';
import type {
  AiModelKind,
  AiModelStatus,
  AiTask,
  AuthorizedApp,
  ConsentRequest,
  InstalledLanguage,
  UnsupportedCapability,
} from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import {
  type Accessor,
  batch,
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
  /**
   * The networking layer can be restarted from here. Separate from `canManageNetwork` because a
   * backend can offer the diagnostics without a restart that actually does anything.
   */
  canRestartNetwork: Accessor<boolean>;
  canManageApps: Accessor<boolean>;
  canManageLanguages: Accessor<boolean>;
  canManageAi: Accessor<boolean>;
  /** The AI models can be changed, not just listed. False for a guest on somebody else's node. */
  canConfigureAi: Accessor<boolean>;
  /**
   * This host starts the backend, so how it starts it can be changed. False on web, where the app
   * connects to an executor someone else started.
   */
  canConfigureExecutor: Accessor<boolean>;

  // ── State ────────────────────────────────────────────────────────────────────
  /**
   * Capabilities this backend was asked for and does not have, each as `{ name, firstSeen }`.
   *
   * What a stale node looks like from inside the app. The adapter degrades rather than failing when
   * the backend predates a feature, so the symptom reaches a person as a part of the app quietly
   * doing less — a review list with no model names, a card with no icon — with nothing connecting
   * it to the node. This is the connection, and `name` is the backend's own word for the capability
   * so it can be searched for in that backend's source.
   *
   * **Empty means nothing has been refused yet, not that the backend is current.** Nothing is
   * recorded until something asks, so a screen showing this should say so rather than reporting
   * silence as health.
   */
  unsupportedCapabilities: Accessor<UnsupportedCapability[]>;
  /** Installed models, each carrying the strings its row displays. Empty until loadAiModels(). */
  aiModels: Accessor<AiModelView[]>;
  /** Named prompts apps registered against a model. */
  aiTasks: Accessor<AiTask[]>;
  /** The model form, or null when it is closed. Schemas render the modal on this. */
  aiForm: Accessor<AiModelForm | null>;
  /** Model names the backend can fetch itself, for the kind the open form is on. */
  aiPresetOptions: Accessor<{ label: string; value: string }[]>;
  /** True when the open form has every field its chosen source needs. */
  aiFormComplete: Accessor<boolean>;
  /**
   * The remote services a model can be reached through, plus "Custom endpoint", for a we-select on
   * `aiForm.apiService`. A named service sets the protocol and base URL itself.
   */
  aiServiceOptions: Accessor<{ label: string; value: string }[]>;
  /** The backend can ask a remote endpoint which models it serves. */
  canDiscoverAiModels: Accessor<boolean>;
  /**
   * The models the open form's endpoint said it serves, for a we-select — empty until asked, and
   * empty again once the protocol, URL or key changes, since the list answered for those.
   */
  aiDiscoveredModelOptions: Accessor<{ label: string; value: string }[]>;
  /**
   * The open model form has been edited since it opened — what a discard guard reads.
   *
   * Compared against a snapshot taken when the form opened, so opening a model to look at its
   * settings and closing again asks nothing, while a pasted API key is not thrown away by a click
   * on the backdrop.
   */
  aiFormDirty: Accessor<boolean>;
  languages: Accessor<InstalledLanguage[]>;
  trustedAgents: Accessor<string[]>;
  authorizedApps: Accessor<AuthorizedApp[]>;
  /** Backend diagnostic blob, displayed verbatim. Empty until requested. */
  networkMetrics: Accessor<string>;
  /** The peer records this node holds, exactly as the backend gave them — what gets copied. */
  peerInfos: Accessor<string[]>;
  /** The same records decoded for reading, as JSON. Display only; empty until loadPeerInfos(). */
  peerInfosReadable: Accessor<string>;
  /**
   * The actions with a runtime call in flight, by name — `'loadNetworkMetrics' in runtimeStore.pending`.
   * What a control's spinner should read, so it spins for its own call and not for everyone's.
   */
  pending: Accessor<string[]>;
  /** True while any runtime call is in flight. Prefer `pending`: a spinner on this lies about which. */
  loading: Accessor<boolean>;
  /** Last runtime error, for display. Cleared at the start of each call. */
  error: Accessor<string>;
  /** True when a database export/import can be offered: the backend does it, the host names the file. */
  canBackUp: Accessor<boolean>;
  /** Per-crate log levels the user has set, as rows. Empty means the backend's own defaults. */
  logLevels: Accessor<{ crate: string; level: string }[]>;
  /** What the last export or import did, for display. Empty until one runs. */
  backupStatus: Accessor<string>;
  /** Whether the backend serves MCP on its next start, and on which port. */
  mcpEnabled: Accessor<boolean>;
  mcpPort: Accessor<number>;
  /** Settings have been changed that the running backend has not picked up. */
  executorRestartPending: Accessor<boolean>;
  /** The consent request awaiting a decision, if any. Schemas render a modal on this. */
  pendingConsent: Accessor<ConsentRequest | null>;
  /** A secret returned by an approval that must be relayed to the asker by hand. */
  consentSecret: Accessor<string>;

  // ── Actions ──────────────────────────────────────────────────────────────────
  loadAiModels: () => Promise<void>;
  loadAiTasks: () => Promise<void>;
  /** Open the form empty, for a new model. */
  newAiModel: () => void;
  /** Open the form on an existing model. */
  editAiModel: (id: string) => void;
  /** Set one form field. Takes the field name so one action serves every input. */
  setAiFormField: (field: string, value: string | boolean) => void;
  /** Choose the open form's service — a preset, which sets protocol and base URL, or `custom`. */
  setAiService: (id: string) => void;
  /** Ask the open form's endpoint which models it serves. Doubles as the check that the key works. */
  discoverAiModels: () => Promise<void>;
  closeAiForm: () => void;
  saveAiModel: () => Promise<void>;
  removeAiModel: (id: string) => Promise<void>;
  setDefaultAiModel: (id: string) => Promise<void>;
  removeAiTask: (id: string) => Promise<void>;
  loadLanguages: () => Promise<void>;
  installLanguage: (address: string) => Promise<void>;
  removeLanguage: (address: string) => Promise<void>;
  loadTrustedAgents: () => Promise<void>;
  trustAgent: (id: string) => Promise<void>;
  untrustAgent: (id: string) => Promise<void>;
  loadAuthorizedApps: () => Promise<void>;
  revokeApp: (id: string) => Promise<void>;
  removeApp: (id: string) => Promise<void>;
  /** Fetch the metrics. Clears what was there first, so a stale snapshot never stands in for this one. */
  loadNetworkMetrics: () => Promise<void>;
  /** Copy the metrics currently loaded to the clipboard, with a toast either way. */
  copyNetworkMetrics: () => Promise<void>;
  restartNetwork: () => Promise<void>;
  loadPeerInfos: () => Promise<void>;
  /** Copy the peer records currently loaded, as a JSON array `addPeerInfos` accepts. */
  copyPeerInfos: () => Promise<void>;
  /** Add pasted peer records. Resolves whether they were added — clear the paste box on `result`. */
  addPeerInfos: (infos: string) => Promise<boolean>;
  setMcpEnabled: (enabled: boolean) => Promise<void>;
  /** Set one crate's level. Adds it when it is not already set — one action for both. */
  setLogLevel: (crate: string, level: string) => Promise<void>;
  /** Drop an override, returning that crate to the backend's default. */
  removeLogLevel: (crate: string) => Promise<void>;
  /** Ask for a file, then have the backend write everything to it. */
  exportDatabase: () => Promise<void>;
  /** Ask for a file, then have the backend read it back in. */
  importDatabase: () => Promise<void>;
  setMcpPort: (port: number) => Promise<void>;
  /** Start the backend over so the written settings take effect. Does not return. */
  restartExecutor: () => Promise<void>;
  approveConsent: () => Promise<void>;
  denyConsent: () => Promise<void>;
  dismissConsentSecret: () => void;
}

const RuntimeContext = createContext<RuntimeStore>();

export function RuntimeStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const shell = useShellStore();
  const platform = usePlatform();

  const [aiModels, setAiModels] = createSignal<AiModelView[]>([]);
  const [aiTasks, setAiTasks] = createSignal<AiTask[]>([]);
  const [aiForm, setAiForm] = createSignal<AiModelForm | null>(null);
  const [aiPresets, setAiPresets] = createSignal<Record<string, string[]>>({});
  const [languages, setLanguages] = createSignal<InstalledLanguage[]>([]);
  const [trustedAgents, setTrustedAgents] = createSignal<string[]>([]);
  const [authorizedApps, setAuthorizedApps] = createSignal<AuthorizedApp[]>([]);
  const [networkMetrics, setNetworkMetrics] = createSignal('');
  const [peerInfos, setPeerInfos] = createSignal<string[]>([]);
  const [peerInfosReadable, setPeerInfosReadable] = createSignal('');
  const [pending, setPending] = createSignal<string[]>([]);
  const loading = createMemo(() => pending().length > 0);
  const [error, setError] = createSignal('');
  const [consentSecret, setConsentSecret] = createSignal('');
  const [mcpEnabled, setMcpEnabledSignal] = createSignal(false);
  const [mcpPort, setMcpPortSignal] = createSignal(3001);
  const [executorRestartPending, setExecutorRestartPending] = createSignal(false);
  const [logLevelMap, setLogLevelMap] = createSignal<Record<string, string>>({});
  const [backupStatus, setBackupStatus] = createSignal('');

  // A queue, not a single slot: two apps can ask at once, and dropping the second would leave it
  // hanging exactly the way having no listener at all does. The template renders the head.
  const [consentQueue, setConsentQueue] = createSignal<ConsentRequest[]>([]);
  const pendingConsent = createMemo(() => consentQueue()[0] ?? null);

  const runtime = () => session.backendPorts()?.runtime;

  const canAdminister = createMemo(() => !!runtime());
  const canManageTrust = createMemo(() => !!runtime()?.trustedAgents);
  const canManageNetwork = createMemo(() => !!runtime()?.networkMetrics);
  const canRestartNetwork = createMemo(() => !!runtime()?.restartNetwork);
  const canManageApps = createMemo(() => !!runtime()?.authorizedApps);
  const canManageLanguages = createMemo(() => !!runtime()?.languages);
  const canManageAi = createMemo(() => !!runtime()?.aiModels);
  /**
   * Whether the models can be *changed*, not merely listed.
   *
   * Split from `canManageAi` because a guest on a hosted node is granted `AI READ` and refused
   * `UPDATE`/`DELETE` — AD4M's own boundary, not ours. Read and write used to be one flag, so the
   * whole section vanished on a node that was perfectly happy to answer what models it runs.
   */
  const canConfigureAi = createMemo(() => !!runtime()?.addAiModel);
  const canDiscoverAiModels = createMemo(() => !!runtime()?.discoverAiModels);

  const executorHost = () => platform.executor;
  const canConfigureExecutor = createMemo(() => !!executorHost());
  // Both halves are needed: the backend writes the file, the host is what can name one. Neither is
  // any use alone, which is why this is one flag rather than two.
  const canBackUp = createMemo(() => !!runtime()?.exportDatabase && !!executorHost()?.chooseFile);

  /**
   * What the backend turned out not to support, kept current as more of it is discovered.
   *
   * A signal fed by the port's own subscription rather than a memo over `runtime()`: the list grows
   * when some unrelated call is refused, which changes nothing a memo could be tracking. Without
   * the subscription a settings page would render whatever was known when it mounted — and for the
   * first gap of a session that is an empty list, which is exactly the reader who went looking.
   *
   * Re-read wholesale on each notification rather than appended to, so the port stays the one
   * answer to what is missing and the handler carries no payload to get out of step with it.
   */
  const [unsupportedCapabilities, setUnsupportedCapabilities] = createSignal<UnsupportedCapability[]>([]);
  createEffect(() => {
    const port = runtime();
    setUnsupportedCapabilities(port?.unsupported?.() ?? []);
    // A backend that reports gaps but cannot say when a new one appears is still worth showing;
    // it is simply a snapshot, which is what an absent subscription honestly is.
    const stop = port?.onUnsupported?.(() => setUnsupportedCapabilities(port.unsupported?.() ?? []));
    if (stop) onCleanup(stop);
  });

  // Sorted, so adding an override does not reorder the rows under the cursor.
  const logLevels = createMemo(() =>
    Object.entries(logLevelMap())
      .map(([crate, level]) => ({ crate, level }))
      .sort((a, b) => a.crate.localeCompare(b.crate)),
  );

  const aiPresetOptions = createMemo(() => {
    const kind = aiForm()?.kind;
    if (!kind) return [];
    return (aiPresets()[kind] ?? []).map((name) => ({ label: name, value: name }));
  });

  const aiFormComplete = createMemo(() => {
    const form = aiForm();
    return !!form && formComplete(form);
  });

  const aiServiceOptions = () => [
    ...AI_API_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })),
    { label: 'Custom endpoint', value: CUSTOM_SERVICE },
  ];

  /**
   * A discovered list, with the endpoint it was asked of.
   *
   * Keyed rather than cleared by each field setter, so the list cannot outlive the endpoint it
   * describes whichever way the form changes — a preset, a pasted URL, a new key.
   */
  const [aiDiscovered, setAiDiscovered] = createSignal<{ endpoint: string; models: string[] } | null>(null);
  const endpointOf = (form: AiModelForm) => JSON.stringify([form.apiProtocol, form.apiBaseUrl.trim(), form.apiKey]);
  const aiDiscoveredModelOptions = createMemo(() => {
    const form = aiForm();
    const found = aiDiscovered();
    if (!form || !found || found.endpoint !== endpointOf(form)) return [];
    return found.models.map((model) => ({ label: model, value: model }));
  });

  /**
   * What the form held when it opened, so "has this been edited" can be answered by comparison.
   *
   * A snapshot rather than the "an edit always counts as dirty" rule `shapeStore.draftHasWork` uses.
   * That rule is right for the model wizard, where opening an existing model reconstructs a draft
   * from the space and there is nothing to compare against — here the form is a flat object with a
   * known shape, so the accurate answer is cheap, and it means opening a model to look at its
   * settings and closing again asks nothing.
   */
  const [aiFormOpenedAs, setAiFormOpenedAs] = createSignal('');

  function openAiForm(form: AiModelForm): void {
    batch(() => {
      setAiForm(form);
      setAiFormOpenedAs(JSON.stringify(form));
    });
  }

  const aiFormDirty = createMemo(() => {
    const form = aiForm();
    return !!form && JSON.stringify(form) !== aiFormOpenedAs();
  });

  /**
   * Every action runs through here: one error slot, a record of what is in flight, and a guarantee
   * that a rejected runtime call surfaces as text on the settings page rather than an unhandled
   * rejection in a console nobody has open.
   *
   * `key` names the action the call belongs to, so a control can spin for its own call and nothing
   * else. There used to be a single `loading` flag instead, and every spinner on the settings pages
   * read it: fetching peer records put a spinner on "Restart networking", which looked for all the
   * world like a restart that then failed with somebody else's timeout. It was also wrong on its
   * own terms — two overlapping calls cleared the flag when the first one finished.
   *
   * Reports success separately from the value, rather than folding failure into `undefined`. Half
   * the port's members return void, so `undefined` cannot distinguish "it worked" from "it threw" —
   * and the mutations below reload their list afterwards, which starts a second `run` and clears
   * the error slot. Read that way, a failed mutation always erased its own message before anyone
   * could see it: the user got a control that silently did nothing.
   */
  type RunResult<T> = { ok: true; value: T | undefined } | { ok: false };

  async function run<T>(key: string, fn: () => Promise<T> | undefined): Promise<RunResult<T>> {
    setPending((keys) => [...keys, key]);
    setError('');
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      console.error('RuntimeStore: runtime call failed', err);
      /*
        The executor's own words, deliberately — this is the one surface where they are the useful
        thing rather than the leak.

        Everywhere else a raw `error.message` went through `explain` (see `shared/userMessage.ts`),
        because a GraphQL failure from three layers down tells a member nothing they can act on.
        Here the reader is administering the node, and the messages *are* the answer: "Choose a port
        between 1024 and 65535", "languages is part of the running node and cannot be removed". A
        generic sentence would replace a fix with a shrug.
      */
      setError(err instanceof Error ? err.message : String(err));
      return { ok: false };
    } finally {
      // One occurrence, not every one: the same action can overlap itself (a double-clicked refresh),
      // and the second call is still running when the first returns.
      setPending((keys) => {
        const at = keys.indexOf(key);
        return at === -1 ? keys : [...keys.slice(0, at), ...keys.slice(at + 1)];
      });
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
    if (canManageLanguages()) void loadLanguages();
    if (canManageAi()) {
      void loadAiModels();
      void loadAiTasks();
    }
    if (canConfigureExecutor()) void loadExecutorSettings();
  });

  // Presets are per kind and the form's kind can change while it is open, so this follows the form
  // rather than being fetched once. Each kind is fetched at most once and cached.
  createEffect(() => {
    const kind = aiForm()?.kind;
    if (kind) void loadAiPresets(kind);
  });

  // A model the backend hosts has to be downloaded before it answers anything, and that takes long
  // enough that a static "Checking…" would be the whole experience. The interval exists only while
  // something is actually pending and the page showing it is open.
  createEffect(() => {
    if (shell.activeShellView() !== 'settings') return;
    if (!canManageAi()) return;
    if (aiModels().every((model) => model.ready || model.source.kind === 'api')) return;

    const timer = setInterval(() => void refreshAiStatuses(), 2000);
    onCleanup(() => clearInterval(timer));
  });

  function dropHead() {
    setConsentQueue((queue) => queue.slice(1));
  }

  async function approveConsent(): Promise<void> {
    const request = pendingConsent();
    const port = runtime();
    if (!request || !port?.approve) return;

    const approval = await run('approveConsent', () => port.approve?.(request));
    const secret = approval.ok ? approval.value : undefined;
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
    if (port?.deny) await run('denyConsent', () => port.deny?.(request));
    dropHead();
  }

  // ── How the backend is started ───────────────────────────────────────────────
  // Not a runtime call: these are arguments the executor read once, at startup, so changing one is
  // always "write it down, then start over". `executorRestartPending` is what turns that from a
  // setting that silently does nothing into one that says what it is waiting for.

  async function loadExecutorSettings(): Promise<void> {
    const host = executorHost();
    if (!host) return;
    try {
      const settings = await host.getSettings();
      setMcpEnabledSignal(settings.mcpEnabled);
      setMcpPortSignal(settings.mcpPort);
      setLogLevelMap(settings.logLevels ?? {});
    } catch (err) {
      console.error('RuntimeStore: could not read the executor settings', err);
    }
  }

  async function writeExecutorSettings(update: Partial<ExecutorSettings>): Promise<void> {
    const host = executorHost();
    if (!host) return;
    const applied = await run('writeExecutorSettings', () => host.setSettings(update));
    if (!applied.ok || !applied.value) return;
    setMcpEnabledSignal(applied.value.mcpEnabled);
    setMcpPortSignal(applied.value.mcpPort);
    setLogLevelMap(applied.value.logLevels ?? {});
    setExecutorRestartPending(true);
  }

  async function setLogLevel(crate: string, level: string): Promise<void> {
    const trimmed = crate.trim();
    if (!trimmed) return;
    await writeExecutorSettings({ logLevels: { ...logLevelMap(), [trimmed]: level } });
  }

  async function removeLogLevel(crate: string): Promise<void> {
    const next = { ...logLevelMap() };
    delete next[crate];
    await writeExecutorSettings({ logLevels: next });
  }

  /**
   * Export and import both come down to naming a file and handing the path over.
   *
   * The status line is the whole feedback: an export writes somewhere the app cannot then read, and
   * an import's effect is spread across data the user has to go and look at, so neither has a
   * visible result of its own.
   */
  async function exportDatabase(): Promise<void> {
    const path = await run('exportDatabase', () =>
      executorHost()?.chooseFile?.({ save: true, defaultName: 'we-backup.json' }),
    );
    if (!path.ok || !path.value) return;
    setBackupStatus('Exporting…');
    const done = await run('exportDatabase', () => runtime()?.exportDatabase?.(path.value as string));
    setBackupStatus(done.ok ? `Exported to ${path.value}` : '');
  }

  async function importDatabase(): Promise<void> {
    const path = await run('importDatabase', () => executorHost()?.chooseFile?.({ save: false }));
    if (!path.ok || !path.value) return;
    setBackupStatus('Importing…');
    const done = await run('importDatabase', () => runtime()?.importDatabase?.(path.value as string));
    // Restart rather than reload: what was imported reaches the app through the backend, and the
    // backend read it into a process that has been running since before the file existed.
    setBackupStatus(done.ok ? 'Imported. Restart the data layer to see it.' : '');
    if (done.ok) setExecutorRestartPending(true);
  }

  async function setMcpEnabled(enabled: boolean): Promise<void> {
    await writeExecutorSettings({ mcpEnabled: enabled });
  }

  async function setMcpPort(port: number): Promise<void> {
    // The field reports whatever was typed, including nothing at all; the host is the one that
    // decides what is a usable port, and its refusal lands in the shared error slot.
    await writeExecutorSettings({ mcpPort: Number(port) });
  }

  async function restartExecutor(): Promise<void> {
    const host = executorHost();
    if (!host) return;
    setExecutorRestartPending(false);
    await host.restart();
  }

  // ── AI models ────────────────────────────────────────────────────────────────

  async function loadAiModels(): Promise<void> {
    const models = await run('loadAiModels', () => runtime()?.aiModels?.());
    if (!models.ok || !models.value) return;
    // Statuses arrive separately and asynchronously; describe with what is known now, and let the
    // poll below fill them in. Rendering the list only once every status has landed would hide the
    // download progress that is the whole reason a status exists.
    setAiModels(models.value.map((model) => describeModel(model)));
    void refreshAiStatuses();
  }

  /**
   * Re-reads download/load progress for the models that are still working on it.
   *
   * Deliberately outside `run`: this fires on a timer, and routing it through the shared loading
   * flag would strobe every spinner on the page and wipe any error the user is reading. A failed
   * status read is also not worth reporting — the model row already says what it knows.
   */
  async function refreshAiStatuses(): Promise<void> {
    const port = runtime();
    if (!port?.aiModelStatus) return;

    const pending = aiModels().filter((model) => model.source.kind !== 'api' && !model.ready);
    if (!pending.length) return;

    const statuses = await Promise.all(
      pending.map(async (model) => {
        try {
          return [model.id, await port.aiModelStatus?.(model.id)] as const;
        } catch {
          // A model the backend does not recognise yet — it stays on 'Checking…'.
          return [model.id, undefined] as const;
        }
      }),
    );
    const byId = new Map(statuses);
    setAiModels((models) =>
      models.map((model) => {
        const status = byId.get(model.id) as AiModelStatus | undefined;
        return status ? describeModel(model, status) : model;
      }),
    );
  }

  async function loadAiTasks(): Promise<void> {
    const tasks = await run('loadAiTasks', () => runtime()?.aiTasks?.());
    if (tasks.ok && tasks.value) setAiTasks(tasks.value);
  }

  async function loadAiPresets(kind: AiModelKind): Promise<void> {
    if (aiPresets()[kind]) return;
    const names = await run('loadAiPresets', () => runtime()?.aiModelPresets?.(kind));
    if (names.ok && names.value) setAiPresets((cache) => ({ ...cache, [kind]: names.value as string[] }));
  }

  function newAiModel(): void {
    openAiForm({ ...EMPTY_FORM });
  }

  function editAiModel(id: string): void {
    const model = aiModels().find((candidate) => candidate.id === id);
    if (model) openAiForm(draftFrom(model));
  }

  function setAiFormField(field: string, value: string | boolean): void {
    setAiForm((form) => (form ? { ...form, [field]: value } : form));
  }

  function setAiService(id: string): void {
    const preset = AI_API_PRESETS.find((candidate) => candidate.id === id);
    setAiForm((form) => {
      if (!form) return form;
      // Custom keeps whatever protocol and URL the form holds, as a starting point to edit.
      if (!preset) return { ...form, apiService: CUSTOM_SERVICE };
      return { ...form, apiService: preset.id, apiProtocol: preset.protocol, apiBaseUrl: preset.baseUrl };
    });
  }

  async function discoverAiModels(): Promise<void> {
    const form = aiForm();
    if (!form?.apiBaseUrl.trim()) return;
    const endpoint = endpointOf(form);
    const found = await run('discoverAiModels', () =>
      runtime()?.discoverAiModels?.({
        protocol: form.apiProtocol,
        baseUrl: form.apiBaseUrl.trim(),
        apiKey: form.apiKey,
      }),
    );
    if (!found.ok) {
      setAiDiscovered(null);
      return;
    }
    const models = [...(found.value ?? [])].sort((a, b) => a.localeCompare(b));
    setAiDiscovered({ endpoint, models });
    // An empty model field takes the first answer, so a working endpoint is one click from saveable.
    if (models.length && !aiForm()?.apiModel.trim()) setAiFormField('apiModel', models[0]);
  }

  function closeAiForm(): void {
    setAiForm(null);
    setAiDiscovered(null);
  }

  async function saveAiModel(): Promise<void> {
    const form = aiForm();
    if (!form || !formComplete(form)) return;
    const draft = toDraft(form);
    const saved = await run('saveAiModel', () =>
      form.id ? runtime()?.updateAiModel?.(form.id, draft) : runtime()?.addAiModel?.(draft),
    );
    // The form stays open on failure, holding what was typed — the error slot above it says why.
    if (!saved.ok) return;
    setAiForm(null);
    await loadAiModels();
  }

  async function removeAiModel(id: string): Promise<void> {
    if ((await run('removeAiModel', () => runtime()?.removeAiModel?.(id))).ok) await loadAiModels();
  }

  async function setDefaultAiModel(id: string): Promise<void> {
    if ((await run('setDefaultAiModel', () => runtime()?.setDefaultAiModel?.(id))).ok) await loadAiModels();
  }

  async function removeAiTask(id: string): Promise<void> {
    if ((await run('removeAiTask', () => runtime()?.removeAiTask?.(id))).ok) await loadAiTasks();
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async function loadLanguages(): Promise<void> {
    const installed = await run('loadLanguages', () => runtime()?.languages?.());
    if (installed.ok && installed.value) setLanguages(installed.value);
  }

  async function installLanguage(address: string): Promise<void> {
    const trimmed = address.trim();
    if (!trimmed) return;
    if ((await run('installLanguage', () => runtime()?.installLanguage?.(trimmed))).ok) await loadLanguages();
  }

  async function removeLanguage(address: string): Promise<void> {
    if ((await run('removeLanguage', () => runtime()?.removeLanguage?.(address))).ok) await loadLanguages();
  }

  async function loadTrustedAgents(): Promise<void> {
    const agents = await run('loadTrustedAgents', () => runtime()?.trustedAgents?.());
    if (agents.ok && agents.value) setTrustedAgents(agents.value);
  }

  async function trustAgent(id: string): Promise<void> {
    const trimmed = id.trim();
    if (!trimmed) return;
    if ((await run('trustAgent', () => runtime()?.trustAgent?.(trimmed))).ok) await loadTrustedAgents();
  }

  async function untrustAgent(id: string): Promise<void> {
    if ((await run('untrustAgent', () => runtime()?.untrustAgent?.(id))).ok) await loadTrustedAgents();
  }

  async function loadAuthorizedApps(): Promise<void> {
    const apps = await run('loadAuthorizedApps', () => runtime()?.authorizedApps?.());
    if (apps.ok && apps.value) setAuthorizedApps(apps.value);
  }

  async function revokeApp(id: string): Promise<void> {
    if ((await run('revokeApp', () => runtime()?.revokeApp?.(id))).ok) await loadAuthorizedApps();
  }

  async function removeApp(id: string): Promise<void> {
    if ((await run('removeApp', () => runtime()?.removeApp?.(id))).ok) await loadAuthorizedApps();
  }

  /**
   * Cleared before the fetch rather than replaced after it. The metrics are a snapshot somebody asked
   * for in order to see *now*, and the conductor can take seconds to dump them — showing the previous
   * snapshot meanwhile presents old numbers as the answer to a new question.
   */
  async function loadNetworkMetrics(): Promise<void> {
    setNetworkMetrics('');
    const metrics = await run('loadNetworkMetrics', () => runtime()?.networkMetrics?.());
    if (metrics.ok && metrics.value !== undefined) setNetworkMetrics(metrics.value);
  }

  /**
   * Copies the metrics on screen, for pasting into an issue or a chat.
   *
   * Takes no text on purpose. A template-reachable "copy this string" would let any template put
   * words of its choosing on somebody's clipboard behind an innocent-looking button — the address
   * swap is the classic use — so each copy the app offers names what it copies, as `copyShareLink`
   * does.
   */
  async function copyNetworkMetrics(): Promise<void> {
    const metrics = networkMetrics();
    if (!metrics) return;
    if (await copyText(metrics)) toastService.success('Network metrics copied');
    else toastService.error('Could not copy the network metrics');
  }

  async function restartNetwork(): Promise<void> {
    await run('restartNetwork', () => runtime()?.restartNetwork?.());
  }

  async function loadPeerInfos(): Promise<void> {
    const infos = await run('loadPeerInfos', () => runtime()?.peerInfos?.());
    if (!infos.ok || !infos.value) return;
    const { records, readable } = infos.value;
    batch(() => {
      setPeerInfos(records);
      setPeerInfosReadable(readable);
    });
  }

  /**
   * Copies the records `loadPeerInfos` fetched, as the JSON array `addPeerInfos` reads back — so
   * what one machine copies is exactly what the other pastes. Takes no text, for the reason
   * `copyNetworkMetrics` gives.
   */
  async function copyPeerInfos(): Promise<void> {
    const infos = peerInfos();
    if (!infos.length) return;
    if (await copyText(JSON.stringify(infos))) toastService.success('Peer records copied');
    else toastService.error('Could not copy the peer records');
  }

  /**
   * Takes the pasted blob as one string. Peer infos are exchanged by copy-paste when discovery
   * fails, and what gets pasted is whatever the other machine printed — a JSON array, or one
   * record per line. Accepting both here means the user is not asked to reformat it first.
   *
   * Resolves whether the records were added. An `$action`'s `onSuccess` fires whenever the call
   * settles, and this one never rejects — `run` catches — so a template that cleared the paste box
   * in `onSuccess` threw away somebody's pasted records on exactly the attempt that failed and they
   * would want to retry. It reads `result` instead.
   */
  async function addPeerInfos(infos: string): Promise<boolean> {
    const parsed = parsePeerInfos(infos);
    if (!parsed.length) {
      setError('Could not read any peer info from that text');
      return false;
    }
    if (!(await run('addPeerInfos', () => runtime()?.addPeerInfos?.(parsed))).ok) return false;
    toastService.success(`Added ${parsed.length} peer ${parsed.length === 1 ? 'record' : 'records'}`);
    await loadPeerInfos();
    return true;
  }

  const store: RuntimeStore = {
    canAdminister,
    canManageTrust,
    canManageNetwork,
    canRestartNetwork,
    canManageApps,
    canManageLanguages,
    canManageAi,
    canConfigureAi,
    canConfigureExecutor,

    unsupportedCapabilities,
    canBackUp,
    logLevels,
    backupStatus,
    mcpEnabled,
    mcpPort,
    executorRestartPending,
    aiModels,
    aiTasks,
    aiForm,
    aiPresetOptions,
    aiFormComplete,
    aiFormDirty,
    aiServiceOptions,
    canDiscoverAiModels,
    aiDiscoveredModelOptions,
    languages,
    trustedAgents,
    authorizedApps,
    networkMetrics,
    peerInfos,
    peerInfosReadable,
    pending,
    loading,
    error,
    pendingConsent,
    consentSecret,

    loadAiModels,
    loadAiTasks,
    newAiModel,
    editAiModel,
    setAiFormField,
    setAiService,
    discoverAiModels,
    closeAiForm,
    saveAiModel,
    removeAiModel,
    setDefaultAiModel,
    removeAiTask,
    loadLanguages,
    installLanguage,
    removeLanguage,
    loadTrustedAgents,
    trustAgent,
    untrustAgent,
    loadAuthorizedApps,
    revokeApp,
    removeApp,
    loadNetworkMetrics,
    copyNetworkMetrics,
    restartNetwork,
    loadPeerInfos,
    copyPeerInfos,
    addPeerInfos,
    setMcpEnabled,
    setMcpPort,
    setLogLevel,
    removeLogLevel,
    exportDatabase,
    importDatabase,
    restartExecutor,
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
