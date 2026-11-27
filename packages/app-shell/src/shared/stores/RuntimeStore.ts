/**
 * RuntimeStore — the backend process's own settings, and the consent prompts it raises.
 *
 * The store over `RuntimeAdminPort` and `ModelAdminPort`. Two jobs that look unrelated but share a
 * reason to exist: both are things the launcher used to do on WE's behalf, and both stopped
 * happening when the desktop hosts started bundling the backend instead of shelling out to it.
 *
 * **Settings** — trust, peer network, authorized apps, how the backend is started, and AI (models,
 * the servers they run on, AI on the node's own machine; written apart in `runtimeAi.ts` and spread
 * in here). Loaded when the settings overlay opens rather than at boot: a user who never opens
 * settings should not pay round trips for them, and the data is stale the moment it lands anyway.
 * Network metrics stay strictly manual — it is a diagnostic, and fetching one nobody asked for is
 * the same mistake one level down.
 *
 * **Consent** — capability and trust requests, raised by the backend while the app runs. Unlike
 * the settings these are *not* optional to handle. An embedded app (Flux in a `we-iframe`) asking
 * for credentials on a bundled-backend host has nobody listening: the launcher window that would
 * have prompted does not exist. The request waits until the app times out, and the user sees a
 * blank iframe with no indication that anything asked them a question.
 *
 * Every capability is feature-detected against the port, so a backend supplying none of it leaves
 * `canManageTrust` and friends false and the settings template renders nothing for that section.
 * The in-memory backend supplies no runtime port at all, which is the case that keeps this honest.
 *
 * Written against the reactivity port.
 */
import type {
  AiServerInstallLink,
  AiTask,
  AuthorizedApp,
  ConsentRequest,
  ExecutorConfig,
  InstalledLanguage,
  UnsupportedCapability,
} from '@we/backend-shared';
import type { Accessor, ReactivityPort } from '@we/reactivity';

import type { AiSetupOption } from '../aiSetupStep';
import { distinctSignal } from '../distinctSignal';
import type { ExecutorSettings, PlatformAdapter } from '../platform/types';
import type { Toasts } from '../toasts';
import { copyText } from '../utils';
import type { AiDetectedView, AiEndpointForm, AiEndpointView, AiModelForm, AiModelView } from './aiModelDraft';
import type { LocalAiView } from './localAiView';
import { createRuntimeAi } from './runtimeAi';
import type { SessionStore } from './SessionStore';

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
  /** Why the discovered list is empty when the server answered with models of other kinds, or empty. */
  aiDiscoveredModelHint: Accessor<string>;
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
  /**
   * The backend can install and run models on its own machine (local AI): it shows this connection
   * the machine and what an install would do. Gate the "This device" section on it.
   */
  canUseLocalAi: Accessor<boolean>;
  /**
   * Local AI can be installed, started, stopped and removed from here: the connection holds the
   * node's operator credential. A grant never does, whatever its capabilities.
   */
  canConfigureLocalAi: Accessor<boolean>;
  /** The "This device" section: the machine, the plan, an install's progress and the running state. */
  localAi: Accessor<LocalAiView>;
  /**
   * The ways to get AI this connection can choose between, in order: 'local' (install on the node's
   * machine), 'server' (add a model server), and always 'skip'. What the "Set up AI" choice offers,
   * in Settings and on a first run's AI step.
   */
  aiSetupOptions: Accessor<AiSetupOption[]>;
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
  /**
   * The backend's config file, where it keeps one this app may write (the desktop app's own
   * executor): its path, empty otherwise. Gate the config rows on it.
   */
  executorConfigFile: Accessor<string>;
  /**
   * Every key of that file, as rows: `value` ready to show, `kind` the control it takes
   * (`boolean`, `number`, `text`, or `fixed` for one only shown), `editable`, and `note` saying
   * why one is not (a flag of this start sets it).
   */
  executorConfigRows: Accessor<ExecutorConfigRow[]>;
  /** The newest lines of this run's backend log, oldest first, one string. Empty until loaded. */
  executorLogTail: Accessor<string>;
  /** Restart can be offered: the host starts the backend. */
  canRestartExecutor: Accessor<boolean>;
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
  /** Read the machine, the plan and how local AI runs. Done when the settings open. */
  loadLocalAi: () => Promise<void>;
  /** Download, check, start and register what the plan says. Resolves when it is done; `localAi.progress` meanwhile. */
  installLocalAi: () => Promise<void>;
  startLocalAi: () => Promise<void>;
  stopLocalAi: () => Promise<void>;
  /** Unregister and stop local AI; `deleteFiles` deletes the downloaded models and programs as well. */
  removeLocalAi: (deleteFiles: boolean) => Promise<void>;
  /**
   * On a first run, once the profile is published: hold the sign-in screen on the AI step when there
   * is something to ask. Resolves true when it did; false leaves setting up to finish as before.
   */
  openAiStep: () => Promise<boolean>;
  /** Leave the AI step with nothing set up, and keep that answer so it is not asked again. */
  skipAiSetup: () => void;
  /** Leave the AI step with what was set up on it, and keep that answer. */
  finishAiSetup: () => void;
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
  /** Write one key of the config file. Takes the row's key and the control's value; empty clears it. */
  setExecutorConfigValue: (key: string, value: unknown) => Promise<void>;
  /** Read the newest lines of the backend's log. */
  loadExecutorLogTail: () => Promise<void>;
  approveConsent: () => Promise<void>;
  denyConsent: () => Promise<void>;
  dismissConsentSecret: () => void;
}

/** One key of the backend's config file, ready for a settings row. */
export interface ExecutorConfigRow {
  /** The key, so a row keeps its place while its value changes. */
  id: string;
  key: string;
  value: string;
  kind: 'boolean' | 'number' | 'text' | 'fixed';
  /** A true/false key's choice: `default` while the file leaves it to the executor. */
  choice: 'default' | 'on' | 'off';
  editable: boolean;
  note: string;
}

/**
 * What the config file holds, as the rows the settings page draws. A row's control comes from the
 * key's type, not its value, so a key the file leaves to its default — or one just cleared — keeps
 * its control, empty, and can be set.
 */
export function executorConfigRows(config: ExecutorConfig | null): ExecutorConfigRow[] {
  return (config?.entries ?? []).map((entry) => {
    const { value } = entry;
    const kind: ExecutorConfigRow['kind'] = entry.kind === 'object' ? 'fixed' : entry.kind;
    // Every field is optional in the executor's file, so `null` is unset too.
    const shown =
      value == null
        ? kind === 'fixed'
          ? 'Default'
          : ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? `${value}`
            : JSON.stringify(value);
    return {
      id: entry.key,
      key: entry.key,
      value: shown,
      kind,
      choice: value == null ? 'default' : value === true ? 'on' : 'off',
      editable: !entry.pinned && kind !== 'fixed',
      note: entry.pinned
        ? 'Set automatically'
        : entry.writableFrom === 'this-machine'
          ? "Can't be changed remotely"
          : '',
    };
  });
}

/**
 * A call's outcome, reported apart from its value. Half the port's members return void, so
 * `undefined` cannot tell "it worked" from "it threw" — and the mutations reload their list
 * afterwards, which starts a second call and clears the error slot. Read that way, a failed
 * mutation always erased its own message before anyone could see it: the user got a control that
 * silently did nothing.
 */
export type RunResult<T> = { ok: true; value: T | undefined } | { ok: false };

/**
 * Every action's call runner: one error slot, a record of what is in flight, and a guarantee that a
 * rejected runtime call surfaces as text on the settings page rather than an unhandled rejection in
 * a console nobody has open.
 *
 * `key` names the action the call belongs to, so a control can spin for its own call and nothing
 * else. There used to be a single `loading` flag instead, and every spinner on the settings pages
 * read it: fetching peer records put a spinner on "Restart networking", which looked for all the
 * world like a restart that then failed with somebody else's timeout. It was also wrong on its own
 * terms — two overlapping calls cleared the flag when the first one finished.
 */
export interface RuntimeCalls {
  run: <T>(key: string, fn: () => Promise<T> | undefined) => Promise<RunResult<T>>;
  pending: Accessor<string[]>;
  loading: Accessor<boolean>;
  error: Accessor<string>;
  setError: (message: string) => void;
}

/** What the runtime store reads of the session, and what the AI step asks of it. */
export type RuntimeSession = Pick<
  SessionStore,
  'backendPorts' | 'signInStep' | 'serverUrl' | 'holdForAiSetup' | 'finishSetup'
>;

/** What it reads of the shell store: whether the settings overlay is open. */
export interface RuntimeShell {
  activeShellView: Accessor<string | null>;
}

export interface RuntimeStoreDeps {
  reactivity: ReactivityPort;
  toasts: Pick<Toasts, 'success' | 'error'>;
  /** Only `executor` is read: the host's hold on the backend it starts, where it starts one. */
  platform: Pick<PlatformAdapter, 'executor'>;
  sessionStore: RuntimeSession;
  shellStore: RuntimeShell;
}

function createRuntimeCalls(reactivity: ReactivityPort): RuntimeCalls {
  const { memo, untrack } = reactivity;
  const [pending, setPending] = reactivity.signal<string[]>([]);
  const [error, setError] = distinctSignal(reactivity, '');
  const loading = memo(() => pending().length > 0);

  async function run<T>(key: string, fn: () => Promise<T> | undefined): Promise<RunResult<T>> {
    setPending([...untrack(pending), key]);
    setError('');
    try {
      return { ok: true, value: await fn() };
    } catch (err) {
      console.error('RuntimeStore: runtime call failed', err);
      /*
        The backend's own words, deliberately — this is the one surface where they are the useful
        thing rather than the leak.

        Everywhere else a raw `error.message` went through `explain` (see `shared/userMessage.ts`),
        because an RPC failure from three layers down tells a member nothing they can act on.
        Here the reader is administering the node, and the messages *are* the answer: "Choose a port
        between 1024 and 65535", "languages is part of the running node and cannot be removed". A
        generic sentence would replace a fix with a shrug.
      */
      setError(err instanceof Error ? err.message : String(err));
      return { ok: false };
    } finally {
      // One occurrence, not every one: the same action can overlap itself (a double-clicked refresh),
      // and the second call is still running when the first returns.
      const keys = untrack(pending);
      const at = keys.indexOf(key);
      if (at !== -1) setPending([...keys.slice(0, at), ...keys.slice(at + 1)]);
    }
  }

  return { run, pending, loading, error, setError };
}

export function createRuntimeStore(deps: RuntimeStoreDeps): RuntimeStore {
  const { reactivity, toasts } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const session = deps.sessionStore;
  const shell = deps.shellStore;
  const platform = deps.platform;
  // Every write skips a value the signal already holds, so a reader wakes only for a change.
  const signal = <T>(initial: T) => distinctSignal(reactivity, initial);
  const calls = createRuntimeCalls(reactivity);
  const { run, pending, loading, error, setError } = calls;
  const ai = createRuntimeAi({ reactivity, calls, sessionStore: session, shellStore: shell });

  const [languages, setLanguages] = signal<InstalledLanguage[]>([]);
  const [trustedAgents, setTrustedAgents] = signal<string[]>([]);
  const [authorizedApps, setAuthorizedApps] = signal<AuthorizedApp[]>([]);
  const [networkMetrics, setNetworkMetrics] = signal('');
  const [peerInfos, setPeerInfos] = signal<string[]>([]);
  const [peerInfosReadable, setPeerInfosReadable] = signal('');
  const [consentSecret, setConsentSecret] = signal('');
  const [mcpEnabled, setMcpEnabledSignal] = signal(false);
  const [mcpPort, setMcpPortSignal] = signal(3001);
  const [executorRestartPending, setExecutorRestartPending] = signal(false);
  const [logLevelMap, setLogLevelMap] = signal<Record<string, string>>({});
  const [backupStatus, setBackupStatus] = signal('');
  const [executorConfig, setExecutorConfig] = signal<ExecutorConfig | null>(null);
  const [executorLogTail, setExecutorLogTail] = signal('');
  const configRows = memo(() => executorConfigRows(executorConfig()));
  const executorConfigFile = memo(() => executorConfig()?.file ?? '');

  // A queue, not a single slot: two apps can ask at once, and dropping the second would leave it
  // hanging exactly the way having no listener at all does. The template renders the head.
  const [consentQueue, setConsentQueue] = signal<ConsentRequest[]>([]);
  const pendingConsent = memo(() => consentQueue()[0] ?? null);

  const runtime = () => session.backendPorts()?.runtime;

  const canAdminister = memo(() => !!runtime());
  const canManageTrust = memo(() => !!runtime()?.trustedAgents);
  const canManageNetwork = memo(() => !!runtime()?.networkMetrics);
  const canRestartNetwork = memo(() => !!runtime()?.restartNetwork);
  const canManageApps = memo(() => !!runtime()?.authorizedApps);
  const canManageLanguages = memo(() => !!runtime()?.languages);

  const executorHost = () => platform.executor;
  const canConfigureExecutor = memo(() => !!executorHost());
  /**
   * Whether the backend keeps its settings in its own config file, written through the port. Where
   * it does, MCP and log levels are that file's keys; where the host keeps them instead (Tauri), they
   * go through the host.
   */
  const configInFile = () => !executorHost()?.setSettings && !!runtime()?.setExecutorConfig;
  const canRestartExecutor = memo(() => !!executorHost());
  // Both halves are needed: the backend writes the file, the host is what can name one. Neither is
  // any use alone, which is why this is one flag rather than two.
  const canBackUp = memo(() => !!runtime()?.exportDatabase && !!executorHost()?.chooseFile);

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
  const [unsupportedCapabilities, setUnsupportedCapabilities] = signal<UnsupportedCapability[]>([]);
  effect(() => {
    const port = runtime();
    setUnsupportedCapabilities(port?.unsupported?.() ?? []);
    // A backend that reports gaps but cannot say when a new one appears is still worth showing;
    // it is simply a snapshot, which is what an absent subscription honestly is.
    const stop = port?.onUnsupported?.(() => setUnsupportedCapabilities(port.unsupported?.() ?? []));
    if (stop) onCleanup(stop);
  });

  // Sorted, so adding an override does not reorder the rows under the cursor.
  const logLevels = memo(() =>
    Object.entries(logLevelMap())
      .map(([crate, level]) => ({ crate, level }))
      .sort((a, b) => a.crate.localeCompare(b.crate)),
  );

  // ── Consent subscription ─────────────────────────────────────────────────────
  // Subscribes as soon as the port exists — deliberately not gated on boot completing. A capability
  // request can arrive while the user is still on the boot screen (an embedded app mounted by the
  // previous session's route restores before onboarding finishes), and the queue holds it.
  effect(() => {
    const port = runtime();
    if (!port?.onConsentRequest) return;

    const unsubscribe = port.onConsentRequest((request) => {
      setConsentQueue([...untrack(consentQueue), request]);
    });
    onCleanup(unsubscribe);
  });

  // ── On-demand loading ────────────────────────────────────────────────────────
  // The schema language has no mount hook, and the alternatives are both worse than this: loading
  // at boot spends round trips on data most sessions never look at, while a "Load" button in each
  // section makes the page start empty and asks the user to do the app's job. Opening the settings
  // overlay is the actual demand signal, and it is already reactive state.
  effect(() => {
    if (shell.activeShellView() !== 'settings') return;
    // A new backend is read afresh; the reads themselves are not what the effect follows.
    void session.backendPorts();
    const wanted = {
      trust: canManageTrust(),
      apps: canManageApps(),
      languages: canManageLanguages(),
      aiTasks: ai.canManageAi(),
      executor: canConfigureExecutor(),
    };
    untrack(() => {
      if (wanted.trust) void loadTrustedAgents();
      if (wanted.apps) void loadAuthorizedApps();
      if (wanted.languages) void loadLanguages();
      if (wanted.aiTasks) void ai.loadAiTasks();
      if (wanted.executor) void loadExecutorSettings();
    });
  });

  function dropHead() {
    setConsentQueue(untrack(consentQueue).slice(1));
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

  /** Read the config file, and MCP and log levels out of it. */
  async function loadExecutorConfig(): Promise<void> {
    const loaded = await run('loadExecutorConfig', () => runtime()?.executorConfig?.());
    if (!loaded.ok || !loaded.value) return;
    const config = loaded.value;
    const value = (key: string) => config.entries.find((entry) => entry.key === key)?.value;
    batch(() => {
      setExecutorConfig(config);
      setMcpEnabledSignal(value('mcp_enabled') === true);
      setMcpPortSignal(typeof value('mcp_port') === 'number' ? (value('mcp_port') as number) : 3001);
      const levels = value('log_config');
      setLogLevelMap(levels && typeof levels === 'object' ? { ...(levels as Record<string, string>) } : {});
      setExecutorRestartPending(config.restartPending);
    });
  }

  /**
   * Write keys to the config file, then read it back. A key the backend will not write is said in
   * the error slot, in its own words, with the key it is about.
   */
  async function writeExecutorConfig(set: Record<string, unknown>, unset: string[] = []): Promise<void> {
    const written = await run('writeExecutorSettings', () => runtime()?.setExecutorConfig?.(set, unset));
    if (!written.ok || !written.value) return;
    const { refused } = written.value;
    await loadExecutorConfig();
    if (refused.length) {
      setError(refused.map(({ key, reason, detail }) => `${key}: ${reason}${detail ? ` (${detail})` : ''}`).join('; '));
    }
  }

  async function setExecutorConfigValue(key: string, value: unknown): Promise<void> {
    const row = configRows().find((r) => r.key === key);
    if (!row?.editable) return;
    const raw: unknown = value && typeof value === 'object' && 'detail' in value ? value.detail : value;
    // Empty, or a true/false key back on Default: the file leaves it to the executor.
    if (raw === '' || raw == null || raw === 'default') return writeExecutorConfig({}, [key]);
    const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? `${raw}` : '';
    const coerced = row.kind === 'boolean' ? raw === true || raw === 'on' : row.kind === 'number' ? Number(raw) : text;
    if (row.kind === 'number' && !Number.isFinite(coerced)) {
      setError(`Enter a number for ${key}.`);
      return;
    }
    await writeExecutorConfig({ [key]: coerced });
  }

  async function loadExecutorLogTail(): Promise<void> {
    const tail = await run('loadExecutorLogTail', () => runtime()?.executorLogTail?.(200));
    if (tail.ok) setExecutorLogTail((tail.value ?? []).join('\n'));
  }

  async function loadExecutorSettings(): Promise<void> {
    const host = executorHost();
    if (!host) return;
    if (configInFile()) return loadExecutorConfig();
    if (!host.getSettings) return;
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
    if (configInFile()) {
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      if (update.mcpEnabled !== undefined) set.mcp_enabled = update.mcpEnabled;
      if (update.mcpPort !== undefined) set.mcp_port = update.mcpPort;
      if (update.logLevels !== undefined) {
        if (Object.keys(update.logLevels).length) set.log_config = update.logLevels;
        else unset.push('log_config');
      }
      return writeExecutorConfig(set, unset);
    }
    if (!host.setSettings) return;
    const setSettings = host.setSettings.bind(host);
    const applied = await run('writeExecutorSettings', () => setSettings(update));
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

  /**
   * Where the backend keeps a config file, ask it to restart (`restartExecutor`: it stops, and the
   * host starts it again with the same arguments and reloads the window). Otherwise the host starts
   * it over itself.
   */
  async function restartExecutor(): Promise<void> {
    const host = executorHost();
    if (!host) return;
    setExecutorRestartPending(false);
    const port = runtime();
    if (configInFile() && port?.restartExecutor) {
      const restarted = await run('restartExecutor', () => port.restartExecutor?.());
      // Refused: the settings have still not taken effect, so "Restart now" stays.
      if (!restarted.ok) setExecutorRestartPending(true);
      return;
    }
    await host.restart();
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
    if (await copyText(metrics)) toasts.success('Network metrics copied');
    else toasts.error('Could not copy the network metrics');
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
    if (await copyText(JSON.stringify(infos))) toasts.success('Peer records copied');
    else toasts.error('Could not copy the peer records');
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
    toasts.success(`Added ${parsed.length} peer ${parsed.length === 1 ? 'record' : 'records'}`);
    await loadPeerInfos();
    return true;
  }

  const store: RuntimeStore = {
    ...ai,
    canAdminister,
    canManageTrust,
    canManageNetwork,
    canRestartNetwork,
    canManageApps,
    canManageLanguages,
    canConfigureExecutor,

    unsupportedCapabilities,
    canBackUp,
    logLevels,
    backupStatus,
    mcpEnabled,
    mcpPort,
    executorRestartPending,
    executorConfigFile,
    executorConfigRows: configRows,
    executorLogTail,
    canRestartExecutor,
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
    setExecutorConfigValue,
    loadExecutorLogTail,
    approveConsent,
    denyConsent,
    dismissConsentSecret: () => setConsentSecret(''),
  };

  return store;
}

/** JSON array first, then one-per-line. Exported for the test that pins both shapes. */
export function parsePeerInfos(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Not JSON — fall through to the line-separated reading.
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
