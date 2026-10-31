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
  AI_SERVICES,
  type AiDetectedView,
  type AiEndpointForm,
  type AiEndpointView,
  type AiModelForm,
  type AiModelView,
  apiKeyProblem,
  CAPABILITY_OF,
  CUSTOM_SERVICE,
  describeDetected,
  describeEndpoint,
  describeModel,
  EMPTY_ENDPOINT_FORM,
  EMPTY_MODEL_FORM,
  endpointFormComplete,
  endpointFormFrom,
  endpointName,
  maxContextProblem,
  modelFormComplete,
  modelFormFrom,
  sameServer,
  serves,
  toEndpointDraft,
  toModelDraft,
  withService,
} from '@solid/stores/aiModelDraft';
import { useSessionStore } from '@solid/stores/SessionStore';
import { useShellStore } from '@solid/stores/ShellStore';
import type {
  AiDetectedEndpoint,
  AiDiscoveredModel,
  AiEndpoint,
  AiModel,
  AiModelKind,
  AiServerInstallLink,
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
  /** True when the open model form names an endpoint and a model on it. */
  aiFormComplete: Accessor<boolean>;
  /**
   * The open model form has been edited since it opened — what a discard guard reads.
   *
   * Compared against a snapshot taken when the form opened, so opening a model to look at its
   * settings and closing again asks nothing.
   */
  aiFormDirty: Accessor<boolean>;
  /** The endpoints that can serve the open model form's kind, for a we-select on `aiForm.endpointId`. */
  aiEndpointOptions: Accessor<{ label: string; value: string }[]>;
  /** The backend can ask an endpoint which models it serves. */
  canDiscoverAiModels: Accessor<boolean>;
  /**
   * The models the open form's endpoint said it serves, for its kind, for a we-select — empty until
   * asked, and for any endpoint other than the one asked.
   */
  aiDiscoveredModelOptions: Accessor<{ label: string; value: string }[]>;
  /** The model the backend recommends for the open form's kind on its endpoint's kind, or empty. */
  aiRecommendedModel: Accessor<string>;
  /** The open form's model can be downloaded onto its endpoint: an Ollama that does not have it. */
  aiCanPull: Accessor<boolean>;
  /** A download onto a server in progress, in words — "Downloading qwen3:8b — 45%" — or empty. */
  aiPullText: Accessor<string>;
  /** The backend shows its model servers to this connection. */
  canManageAiEndpoints: Accessor<boolean>;
  /** The model servers, each carrying the strings its row displays. */
  aiEndpoints: Accessor<AiEndpointView[]>;
  /** Model servers running on the node's machine that are not added yet. */
  aiDetectedEndpoints: Accessor<AiDetectedView[]>;
  /** Where to get a model server, for when none runs on the node's machine. */
  aiInstallLinks: Accessor<AiServerInstallLink[]>;
  /** The endpoint form, or null when it is closed. */
  aiEndpointForm: Accessor<AiEndpointForm | null>;
  /** True when the open endpoint form can be saved. */
  aiEndpointFormComplete: Accessor<boolean>;
  /** The open endpoint form has been edited since it opened, so a pasted key is not thrown away. */
  aiEndpointFormDirty: Accessor<boolean>;
  /** Why the open endpoint form's context limit cannot be saved, or empty — the words for a disabled Save. */
  aiMaxContextError: Accessor<string>;
  /**
   * Why the open endpoint form's key holds the save, or empty: the base URL moved away from the
   * address the stored key was set for, and no new key was typed. The backend sends a key only there.
   */
  aiApiKeyError: Accessor<string>;
  /** The kinds of server an endpoint can be, for a we-select on `aiEndpointForm.service`. */
  aiServiceOptions: Accessor<{ label: string; value: string }[]>;
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
  /** Fetch the models and the endpoints they run on. */
  loadAiModels: () => Promise<void>;
  loadAiTasks: () => Promise<void>;
  /** Open the model form empty, for a new model. */
  newAiModel: () => void;
  /** Open the model form on an existing model. */
  editAiModel: (id: string) => void;
  /** Set one model-form field. Choosing an endpoint asks it which models it serves. */
  setAiFormField: (field: string, value: string) => void;
  /** Ask the open form's endpoint which models it serves. */
  discoverAiModels: () => Promise<void>;
  /** Download the open form's model onto its endpoint. */
  pullAiModel: () => Promise<void>;
  closeAiForm: () => void;
  saveAiModel: () => Promise<void>;
  removeAiModel: (id: string) => Promise<void>;
  setDefaultAiModel: (id: string) => Promise<void>;
  removeAiTask: (id: string) => Promise<void>;
  /** Look for model servers on the node's machine. */
  detectAiEndpoints: () => Promise<void>;
  /** Add a server found on the node's machine, as it was found. */
  addDetectedEndpoint: (baseUrl: string) => Promise<void>;
  /** Open the endpoint form empty, for a new server. */
  newAiEndpoint: () => void;
  editAiEndpoint: (id: string) => void;
  /** Set one endpoint-form field. */
  setAiEndpointField: (field: string, value: string | boolean) => void;
  /** Choose the open endpoint form's service, which sets its kind and a starting address. */
  setAiService: (id: string) => void;
  closeAiEndpointForm: () => void;
  saveAiEndpoint: () => Promise<void>;
  /** Remove an endpoint. Refused while models run on it. */
  removeAiEndpoint: (id: string) => Promise<void>;
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

  // The port's records, kept raw: the views below are derived, so an event that changes one record
  // re-describes it without another round trip.
  const [aiModelRecords, setAiModelRecords] = createSignal<AiModel[]>([]);
  const [aiEndpointRecords, setAiEndpointRecords] = createSignal<AiEndpoint[]>([]);
  const [aiDetected, setAiDetected] = createSignal<AiDetectedEndpoint[]>([]);
  const [aiTasks, setAiTasks] = createSignal<AiTask[]>([]);
  const [aiForm, setAiForm] = createSignal<AiModelForm | null>(null);
  const [aiEndpointForm, setAiEndpointForm] = createSignal<AiEndpointForm | null>(null);
  /** A download onto a server, while one runs: which model on which endpoint, and how far. */
  const [aiPull, setAiPull] = createSignal<{ endpointId: string; model: string; progress: number } | null>(null);
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
  const modelAdmin = () => session.backendPorts()?.models;

  const canAdminister = createMemo(() => !!runtime());
  const canManageTrust = createMemo(() => !!runtime()?.trustedAgents);
  const canManageNetwork = createMemo(() => !!runtime()?.networkMetrics);
  const canRestartNetwork = createMemo(() => !!runtime()?.restartNetwork);
  const canManageApps = createMemo(() => !!runtime()?.authorizedApps);
  const canManageLanguages = createMemo(() => !!runtime()?.languages);
  const canManageAi = createMemo(() => !!modelAdmin()?.list);
  /**
   * Whether the models can be *changed*, not merely listed.
   *
   * Split from `canManageAi` because a guest on a hosted node is granted `AI READ` and refused
   * `UPDATE`/`DELETE` — AD4M's own boundary, not ours. Read and write used to be one flag, so the
   * whole section vanished on a node that was perfectly happy to answer what models it runs.
   */
  const canConfigureAi = createMemo(() => !!modelAdmin()?.add);
  const canDiscoverAiModels = createMemo(() => !!modelAdmin()?.discover);
  const canManageAiEndpoints = createMemo(() => !!modelAdmin()?.endpoints);

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

  const aiModels = createMemo(() => aiModelRecords().map((model) => describeModel(model, aiEndpointRecords())));
  const aiEndpoints = createMemo(() =>
    aiEndpointRecords().map((endpoint) => describeEndpoint(endpoint, aiModelRecords())),
  );
  // A server already added is not offered again, whichever address spelling found it.
  const aiDetectedEndpoints = createMemo(() =>
    aiDetected()
      .filter((found) => !aiEndpointRecords().some((e) => sameServer(e.baseUrl, found.baseUrl)))
      .map(describeDetected),
  );
  const recommendations = () => modelAdmin()?.recommended?.() ?? { models: [], installLinks: [] };
  const aiInstallLinks = () => recommendations().installLinks;

  const formEndpoint = () => aiEndpointRecords().find((e) => e.id === aiForm()?.endpointId);

  const aiEndpointOptions = createMemo(() => {
    const form = aiForm();
    if (!form) return [];
    const needs = CAPABILITY_OF[form.kind];
    // The endpoint the form already names stays listed, so editing a model never hides its own server.
    return aiEndpointRecords()
      .filter((e) => e.capabilities.includes(needs) || e.id === form.endpointId)
      .map((e) => ({ label: e.name, value: e.id }));
  });

  const aiRecommendedModel = createMemo(() => {
    const form = aiForm();
    const kind = formEndpoint()?.kind;
    if (!form || !kind) return '';
    return recommendations().models.find((m) => m.kind === form.kind && m.endpointKind === kind)?.model ?? '';
  });

  /**
   * A discovered list, with the endpoint it was asked of.
   *
   * Keyed rather than cleared by each field setter, so the list cannot outlive the endpoint it
   * describes whichever way the form changes.
   */
  const [aiDiscovered, setAiDiscovered] = createSignal<{ endpointId: string; models: AiDiscoveredModel[] } | null>(
    null,
  );
  const discoveredForForm = createMemo(() => {
    const form = aiForm();
    const found = aiDiscovered();
    return form && found && found.endpointId === form.endpointId ? found.models : null;
  });
  const aiDiscoveredModelOptions = createMemo(() => {
    const form = aiForm();
    const models = discoveredForForm();
    if (!form || !models) return [];
    // A server's capabilities are partly a guess from the model's id: where the guess finds none of
    // the kind asked for, every model is listed rather than none.
    const fitting = models.filter((m) => m.capabilities.includes(CAPABILITY_OF[form.kind]));
    return (fitting.length ? fitting : models).map((m) => ({ label: m.id, value: m.id }));
  });

  const aiCanPull = createMemo(() => {
    const form = aiForm();
    const endpoint = formEndpoint();
    const model = form?.remoteModel.trim() ?? '';
    if (!model || endpoint?.kind !== 'ollama' || !modelAdmin()?.pullModel || aiPull()) return false;
    const served = discoveredForForm()?.map((m) => m.id) ?? endpoint.health.models;
    return !serves(served, model);
  });

  const aiPullText = createMemo(() => {
    const pull = aiPull();
    return pull ? `Downloading ${pull.model} — ${pull.progress}%` : '';
  });

  const aiFormComplete = createMemo(() => {
    const form = aiForm();
    return !!form && modelFormComplete(form);
  });

  const aiEndpointFormComplete = createMemo(() => {
    const form = aiEndpointForm();
    return !!form && endpointFormComplete(form);
  });

  const aiMaxContextError = createMemo(() => {
    const form = aiEndpointForm();
    return form ? maxContextProblem(form) : '';
  });

  const aiApiKeyError = createMemo(() => {
    const form = aiEndpointForm();
    return form ? apiKeyProblem(form) : '';
  });

  const aiServiceOptions = () => [
    ...AI_SERVICES.map((service) => ({ label: service.label, value: service.id })),
    { label: 'Another OpenAI-compatible server', value: CUSTOM_SERVICE },
  ];

  /**
   * What each form held when it opened, so "has this been edited" can be answered by comparison —
   * opening a model or a server to look at its settings and closing again asks nothing.
   */
  const [aiFormOpenedAs, setAiFormOpenedAs] = createSignal('');
  const [aiEndpointFormOpenedAs, setAiEndpointFormOpenedAs] = createSignal('');

  function openAiForm(form: AiModelForm): void {
    batch(() => {
      setAiForm(form);
      setAiFormOpenedAs(JSON.stringify(form));
    });
  }

  function openAiEndpointForm(form: AiEndpointForm): void {
    batch(() => {
      setAiEndpointForm(form);
      setAiEndpointFormOpenedAs(JSON.stringify(form));
    });
  }

  const aiFormDirty = createMemo(() => {
    const form = aiForm();
    return !!form && JSON.stringify(form) !== aiFormOpenedAs();
  });

  const aiEndpointFormDirty = createMemo(() => {
    const form = aiEndpointForm();
    return !!form && JSON.stringify(form) !== aiEndpointFormOpenedAs();
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
    if (canManageAiEndpoints()) void detectAiEndpoints();
    if (canConfigureExecutor()) void loadExecutorSettings();
  });

  /*
    Where a model stands is its server's answer, and the backend says when it changes: a pull's
    progress, a server going down or coming back. Listened to while the page that shows it is open,
    which replaces polling every model's status on a timer.
  */
  createEffect(() => {
    if (shell.activeShellView() !== 'settings') return;
    const port = modelAdmin();
    const stopModels = port?.onModelStatus?.((event) => {
      const pull = aiPull();
      if (pull && pull.endpointId === event.endpointId && serves([event.remoteModel], pull.model)) {
        setAiPull({ ...pull, progress: event.status.progress ?? pull.progress });
      }
      setAiModelRecords((models) =>
        models.map((model) =>
          model.endpointId === event.endpointId && serves([event.remoteModel], model.remoteModel)
            ? { ...model, status: event.status }
            : model,
        ),
      );
    });
    // A server's health decides its models' statuses, so a change re-reads them rather than guessing.
    const stopHealth = port?.onEndpointHealth?.((endpointId, health) => {
      setAiEndpointRecords((endpoints) => endpoints.map((e) => (e.id === endpointId ? { ...e, health } : e)));
      void refreshAiModels();
    });
    onCleanup(() => {
      stopModels?.();
      stopHealth?.();
    });
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

  /** The models and the endpoints they run on, read together so a row never names an endpoint the list lacks. */
  async function loadAiModels(): Promise<void> {
    const port = modelAdmin();
    const loaded = await run('loadAiModels', () =>
      Promise.all([port?.list?.(), port?.endpoints?.() ?? Promise.resolve(undefined)]),
    );
    if (!loaded.ok || !loaded.value) return;
    const [models, endpoints] = loaded.value;
    batch(() => {
      if (models) setAiModelRecords(models);
      if (endpoints) setAiEndpointRecords(endpoints);
    });
  }

  /**
   * Re-reads the models' statuses after a server's health changed.
   *
   * Deliberately outside `run`: it follows an event rather than a press, and routing it through the
   * shared flags would strobe every spinner on the page and wipe any error the user is reading.
   */
  async function refreshAiModels(): Promise<void> {
    try {
      const models = await modelAdmin()?.list?.();
      if (models) setAiModelRecords(models);
    } catch {
      // The rows keep what they last said; the next event or reload tries again.
    }
  }

  async function loadAiTasks(): Promise<void> {
    const tasks = await run('loadAiTasks', () => modelAdmin()?.tasks?.());
    if (tasks.ok && tasks.value) setAiTasks(tasks.value);
  }

  /** The first endpoint that can serve `kind`, so a new model's form starts on one that fits. */
  function endpointFor(kind: AiModelKind): string {
    return aiEndpointRecords().find((e) => e.capabilities.includes(CAPABILITY_OF[kind]))?.id ?? '';
  }

  function newAiModel(): void {
    openAiForm({ ...EMPTY_MODEL_FORM, endpointId: endpointFor(EMPTY_MODEL_FORM.kind) });
    void discoverAiModels();
  }

  function editAiModel(id: string): void {
    const model = aiModelRecords().find((candidate) => candidate.id === id);
    if (!model) return;
    openAiForm(modelFormFrom(model));
    void discoverAiModels();
  }

  /**
   * Choosing what a model is for moves the form to an endpoint that can serve it, and choosing an
   * endpoint asks it what it has — so the model list beside it is never one for somewhere else.
   *
   * Either change also lets go of a model that no longer fits: a model of another server, or a
   * language model left in the field once the form is for embeddings. Kept, it saved an embedding
   * model pointed at a chat model.
   */
  function setAiFormField(field: string, value: string): void {
    const before = aiForm();
    if (!before) return;
    const form = { ...before, [field]: value } as AiModelForm;
    if (field === 'kind') {
      const fits = aiEndpointRecords()
        .find((e) => e.id === form.endpointId)
        ?.capabilities.includes(CAPABILITY_OF[form.kind]);
      if (!fits) form.endpointId = endpointFor(form.kind);
    }
    if (form.endpointId !== before.endpointId) {
      setAiForm({ ...form, remoteModel: '' });
      void discoverAiModels();
      return;
    }
    setAiForm(form);
    if (field === 'kind' && form.kind !== before.kind) {
      const model = form.remoteModel.trim();
      const listed = aiDiscoveredModelOptions().map((option) => option.value);
      if (model && discoveredForForm() && !serves(listed, model)) setAiForm({ ...form, remoteModel: '' });
      fillModel();
    }
  }

  /** Asks the open form's endpoint which models it serves, then fills an empty model field. */
  async function discoverAiModels(): Promise<void> {
    const endpointId = aiForm()?.endpointId;
    const port = modelAdmin();
    if (!endpointId || !port?.discover) return;
    const found = await run('discoverAiModels', () => port.discover?.({ endpointId }));
    if (!found.ok || !found.value) return;
    const models = [...found.value].sort((a, b) => a.id.localeCompare(b.id));
    setAiDiscovered({ endpointId, models });
    fillModel();
  }

  /**
   * An empty model field takes the one the backend recommends where the server has it — or can
   * fetch it, an Ollama — else the first that fits, so a working server is one click from saveable.
   */
  function fillModel(): void {
    const form = aiForm();
    if (!form || form.remoteModel.trim() || !discoveredForForm()) return;
    const recommended = aiRecommendedModel();
    const ids = aiDiscoveredModelOptions().map((option) => option.value);
    const pick = recommended && (serves(ids, recommended) || formEndpoint()?.kind === 'ollama') ? recommended : ids[0];
    if (pick) setAiForm({ ...form, remoteModel: pick });
  }

  /**
   * Downloads the open form's model onto its Ollama. Resolves when the server has all of it, which
   * for gigabytes is minutes; `onModelStatus` moves the percentage meanwhile.
   */
  async function pullAiModel(): Promise<void> {
    const form = aiForm();
    const port = modelAdmin();
    const model = form?.remoteModel.trim();
    if (!form?.endpointId || !model || !port?.pullModel || aiPull()) return;
    setAiPull({ endpointId: form.endpointId, model, progress: 0 });
    const pulled = await run('pullAiModel', () => port.pullModel?.(form.endpointId, model));
    setAiPull(null);
    if (!pulled.ok) return;
    await Promise.all([discoverAiModels(), loadAiModels()]);
  }

  function closeAiForm(): void {
    setAiForm(null);
    setAiDiscovered(null);
  }

  async function saveAiModel(): Promise<void> {
    const form = aiForm();
    if (!form || !modelFormComplete(form)) return;
    const draft = toModelDraft(form);
    const saved = await run('saveAiModel', () =>
      form.id ? modelAdmin()?.update?.(form.id, draft) : modelAdmin()?.add?.(draft),
    );
    // The form stays open on failure, holding what was typed — the error slot above it says why.
    if (!saved.ok) return;
    closeAiForm();
    await loadAiModels();
  }

  async function removeAiModel(id: string): Promise<void> {
    if ((await run('removeAiModel', () => modelAdmin()?.remove?.(id))).ok) await loadAiModels();
  }

  async function setDefaultAiModel(id: string): Promise<void> {
    if ((await run('setDefaultAiModel', () => modelAdmin()?.setDefault?.(id))).ok) await loadAiModels();
  }

  async function removeAiTask(id: string): Promise<void> {
    if ((await run('removeAiTask', () => modelAdmin()?.removeTask?.(id))).ok) await loadAiTasks();
  }

  // ── AI endpoints ───────────────────────────────────────────────────────────────

  async function detectAiEndpoints(): Promise<void> {
    const found = await run('detectAiEndpoints', () => modelAdmin()?.detectEndpoints?.());
    if (found.ok && found.value) setAiDetected(found.value);
  }

  async function addDetectedEndpoint(baseUrl: string): Promise<void> {
    const found = aiDetected().find((candidate) => sameServer(candidate.baseUrl, baseUrl));
    if (!found) return;
    const name = endpointName(
      { name: '', kind: found.kind, baseUrl: found.baseUrl },
      aiEndpointRecords().map((e) => e.name),
    );
    const added = await run('addDetectedEndpoint', () =>
      modelAdmin()?.addEndpoint?.({ name, kind: found.kind, baseUrl: found.baseUrl }),
    );
    if (added.ok) await loadAiModels();
  }

  function newAiEndpoint(): void {
    openAiEndpointForm({ ...EMPTY_ENDPOINT_FORM });
  }

  function editAiEndpoint(id: string): void {
    const endpoint = aiEndpointRecords().find((candidate) => candidate.id === id);
    if (endpoint) openAiEndpointForm(endpointFormFrom(endpoint));
  }

  function setAiEndpointField(field: string, value: string | boolean): void {
    setAiEndpointForm((form) => (form ? { ...form, [field]: value } : form));
  }

  function setAiService(id: string): void {
    setAiEndpointForm((form) => (form ? withService(form, id) : form));
  }

  function closeAiEndpointForm(): void {
    setAiEndpointForm(null);
  }

  async function saveAiEndpoint(): Promise<void> {
    const form = aiEndpointForm();
    if (!form || !endpointFormComplete(form)) return;
    const others = aiEndpointRecords()
      .filter((e) => e.id !== form.id)
      .map((e) => e.name);
    const draft = toEndpointDraft(form, endpointName(form, others));
    const saved = await run('saveAiEndpoint', () =>
      form.id ? modelAdmin()?.updateEndpoint?.(form.id, draft) : modelAdmin()?.addEndpoint?.(draft),
    );
    if (!saved.ok) return;
    setAiEndpointForm(null);
    await loadAiModels();
  }

  async function removeAiEndpoint(id: string): Promise<void> {
    if ((await run('removeAiEndpoint', () => modelAdmin()?.removeEndpoint?.(id))).ok) await loadAiModels();
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
   * Resolves whether the records were added. An `$invoke`'s `onSuccess` fires whenever the call
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
    aiFormComplete,
    aiFormDirty,
    aiEndpointOptions,
    canDiscoverAiModels,
    aiDiscoveredModelOptions,
    aiRecommendedModel,
    aiCanPull,
    aiPullText,
    canManageAiEndpoints,
    aiEndpoints,
    aiDetectedEndpoints,
    aiInstallLinks,
    aiEndpointForm,
    aiEndpointFormComplete,
    aiEndpointFormDirty,
    aiMaxContextError,
    aiApiKeyError,
    aiServiceOptions,
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
    discoverAiModels,
    pullAiModel,
    closeAiForm,
    saveAiModel,
    removeAiModel,
    setDefaultAiModel,
    removeAiTask,
    detectAiEndpoints,
    addDetectedEndpoint,
    newAiEndpoint,
    editAiEndpoint,
    setAiEndpointField,
    setAiService,
    closeAiEndpointForm,
    saveAiEndpoint,
    removeAiEndpoint,
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
