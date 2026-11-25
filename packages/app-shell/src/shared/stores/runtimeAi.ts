/**
 * The runtime store's AI half: the models the backend runs, the servers they run on, AI installed on
 * the node's own machine, and a first run's AI step.
 *
 * One of the runtime store's jobs, written apart because it is most of the store and shares only two
 * things with the rest: the call runner (one error slot, one record of what is in flight, for every
 * control on the settings pages) and the settings page being open. Both are handed in. What it
 * builds is spread into the runtime store, so templates reach it as `runtimeStore.*` as before.
 *
 * The rules — what a row says, which models fill which role, how progress folds — are plain
 * functions in `aiModelDraft.ts` and `localAiView.ts`; this file decides when they are asked.
 */
import type {
  AiDetectedEndpoint,
  AiDiscoveredModel,
  AiEndpoint,
  AiModel,
  AiModelKind,
  AiTask,
  LocalAiHardware,
  LocalAiPlan,
  LocalAiProgress,
  LocalAiStatus,
} from '@we/backend-shared';
import type { ReactivityPort } from '@we/reactivity';

import {
  type AiSetupAnswer,
  aiSetupOptions as aiSetupOptionsFor,
  offersAiStep,
  readAiSetupAnswer,
  recordAiSetupAnswer,
} from '../aiSetupStep';
import { distinctSignal } from '../distinctSignal';
import {
  AI_SERVICES,
  type AiEndpointForm,
  type AiModelForm,
  apiKeyProblem,
  canServe,
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
  KIND_NOUN,
  maxContextProblem,
  modelFormComplete,
  modelFormFrom,
  modelsForRoles,
  sameFields,
  sameServer,
  serves,
  toEndpointDraft,
  toModelDraft,
  withService,
} from './aiModelDraft';
import { describeLocalAi, isManaged, type LocalAiView, reduceProgress } from './localAiView';
import type { RuntimeCalls, RuntimeSession, RuntimeShell, RuntimeStore } from './RuntimeStore';

/**
 * How long a first run waits to hear what AI the node has before deciding whether to ask about it.
 * Two local reads; a node slower than this is not asked, rather than holding a new account's screen.
 */
const AI_STEP_READ_MS = 5000;

/** The runtime store's members this half provides. */
export type RuntimeAi = Pick<
  RuntimeStore,
  | 'canManageAi'
  | 'canConfigureAi'
  | 'aiModels'
  | 'aiTasks'
  | 'aiForm'
  | 'aiFormComplete'
  | 'aiFormDirty'
  | 'aiEndpointOptions'
  | 'canDiscoverAiModels'
  | 'aiDiscoveredModelOptions'
  | 'aiDiscoveredModelHint'
  | 'aiRecommendedModel'
  | 'aiCanPull'
  | 'aiPullText'
  | 'canManageAiEndpoints'
  | 'aiEndpoints'
  | 'aiDetectedEndpoints'
  | 'aiInstallLinks'
  | 'aiEndpointForm'
  | 'aiEndpointFormComplete'
  | 'aiEndpointFormDirty'
  | 'aiMaxContextError'
  | 'aiApiKeyError'
  | 'aiServiceOptions'
  | 'canUseLocalAi'
  | 'canConfigureLocalAi'
  | 'localAi'
  | 'aiSetupOptions'
  | 'loadAiModels'
  | 'loadAiTasks'
  | 'newAiModel'
  | 'editAiModel'
  | 'setAiFormField'
  | 'discoverAiModels'
  | 'pullAiModel'
  | 'closeAiForm'
  | 'saveAiModel'
  | 'removeAiModel'
  | 'setDefaultAiModel'
  | 'removeAiTask'
  | 'detectAiEndpoints'
  | 'addDetectedEndpoint'
  | 'newAiEndpoint'
  | 'editAiEndpoint'
  | 'setAiEndpointField'
  | 'setAiService'
  | 'closeAiEndpointForm'
  | 'saveAiEndpoint'
  | 'removeAiEndpoint'
  | 'loadLocalAi'
  | 'installLocalAi'
  | 'startLocalAi'
  | 'stopLocalAi'
  | 'removeLocalAi'
  | 'openAiStep'
  | 'skipAiSetup'
  | 'finishAiSetup'
>;

export interface RuntimeAiDeps {
  reactivity: ReactivityPort;
  /** The runtime store's call runner, shared so one error slot and one in-flight list serve the page. */
  calls: RuntimeCalls;
  sessionStore: RuntimeSession;
  shellStore: RuntimeShell;
}

export function createRuntimeAi(deps: RuntimeAiDeps): RuntimeAi {
  const { reactivity } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const { run, pending, error } = deps.calls;
  const session = deps.sessionStore;
  const shell = deps.shellStore;
  // Every write skips a value the signal already holds, so a reader wakes only for a change.
  const signal = <T>(initial: T) => distinctSignal(reactivity, initial);
  const modelAdmin = () => session.backendPorts()?.models;

  // The port's records, kept raw: the views below are derived, so an event that changes one record
  // re-describes it without another round trip.
  const [aiModelRecords, setAiModelRecords] = signal<AiModel[]>([]);
  const [aiEndpointRecords, setAiEndpointRecords] = signal<AiEndpoint[]>([]);
  const [aiDetected, setAiDetected] = signal<AiDetectedEndpoint[]>([]);
  const [aiTasks, setAiTasks] = signal<AiTask[]>([]);
  const [aiForm, setAiForm] = signal<AiModelForm | null>(null);
  const [aiEndpointForm, setAiEndpointForm] = signal<AiEndpointForm | null>(null);
  /** A download onto a server, while one runs: which model on which endpoint, and how far. */
  const [aiPull, setAiPull] = signal<{ endpointId: string; model: string; progress: number } | null>(null);
  /**
   * The downloads the servers say are running, saved model or not.
   *
   * A pull call can time out while the server goes on downloading. A saved model's status says so;
   * a model still in the Add form has no row to say it, so the server's own events are kept here.
   * The server ends each download with a `ready` or `missing` event, which takes it off.
   */
  const [serverPulls, setServerPulls] = signal<{ endpointId: string; model: string }[]>([]);

  const canManageAi = memo(() => !!modelAdmin()?.list);
  /**
   * Whether the models can be *changed*, not merely listed.
   *
   * Split from `canManageAi` because a guest on a hosted node is granted `AI READ` and refused
   * `UPDATE`/`DELETE` — AD4M's own boundary, not ours. Read and write used to be one flag, so the
   * whole section vanished on a node that was perfectly happy to answer what models it runs.
   */
  const canConfigureAi = memo(() => !!modelAdmin()?.add);
  const canDiscoverAiModels = memo(() => !!modelAdmin()?.discover);
  const canManageAiEndpoints = memo(() => !!modelAdmin()?.endpoints);

  const aiModels = memo(() => aiModelRecords().map((model) => describeModel(model, aiEndpointRecords())));
  const aiEndpoints = memo(() => aiEndpointRecords().map((endpoint) => describeEndpoint(endpoint, aiModelRecords())));
  // A server already added is not offered again, whichever address spelling found it.
  const aiDetectedEndpoints = memo(() =>
    aiDetected()
      .filter((found) => !aiEndpointRecords().some((e) => sameServer(e.baseUrl, found.baseUrl)))
      .map(describeDetected),
  );
  const recommendations = () => modelAdmin()?.recommended?.() ?? { models: [], installLinks: [] };
  const aiInstallLinks = () => recommendations().installLinks;

  const formEndpoint = () => aiEndpointRecords().find((e) => e.id === aiForm()?.endpointId);

  const aiEndpointOptions = memo(() => {
    const form = aiForm();
    if (!form) return [];
    // The endpoint the form already names stays listed, so editing a model never hides its own server.
    return aiEndpointRecords()
      .filter((e) => canServe(e, form.kind) || e.id === form.endpointId)
      .map((e) => ({ label: e.name, value: e.id }));
  });

  const aiRecommendedModel = memo(() => {
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
  const [aiDiscovered, setAiDiscovered] = signal<{ endpointId: string; models: AiDiscoveredModel[] } | null>(null);
  const discoveredForForm = memo(() => {
    const form = aiForm();
    const found = aiDiscovered();
    return form && found && found.endpointId === form.endpointId ? found.models : null;
  });
  const aiDiscoveredModelOptions = memo(() => {
    const form = aiForm();
    const models = discoveredForForm();
    if (!form || !models) return [];
    // Only models of the kind asked for: a chat model offered as an embedding model saves one that
    // cannot work. Where none fits, aiDiscoveredModelHint says so, and a model can still be typed.
    return models
      .filter((m) => m.capabilities.includes(CAPABILITY_OF[form.kind]))
      .map((m) => ({ label: m.id, value: m.id }));
  });
  const aiDiscoveredModelHint = memo(() => {
    const form = aiForm();
    const models = discoveredForForm();
    if (!form || !models?.length || aiDiscoveredModelOptions().length) return '';
    return `None of this server’s models are ${KIND_NOUN[form.kind]} models`;
  });

  const aiCanPull = memo(() => {
    const form = aiForm();
    const endpoint = formEndpoint();
    const model = form?.remoteModel.trim() ?? '';
    if (!model || endpoint?.kind !== 'ollama' || !modelAdmin()?.pullModel || aiPull()) return false;
    // A pull the server is still running — one whose call timed out here — is not started twice.
    const downloading =
      aiModelRecords().some(
        (m) => m.endpointId === endpoint.id && m.status.state === 'pulling' && serves([m.remoteModel], model),
      ) || serverPulls().some((p) => p.endpointId === endpoint.id && serves([p.model], model));
    if (downloading) return false;
    const served = discoveredForForm()?.map((m) => m.id) ?? endpoint.health.models;
    return !serves(served, model);
  });

  const aiPullText = memo(() => {
    const pull = aiPull();
    return pull ? `Downloading ${pull.model} — ${pull.progress}%` : '';
  });

  const aiFormComplete = memo(() => {
    const form = aiForm();
    return !!form && modelFormComplete(form);
  });

  const aiEndpointFormComplete = memo(() => {
    const form = aiEndpointForm();
    return !!form && endpointFormComplete(form);
  });

  const aiMaxContextError = memo(() => {
    const form = aiEndpointForm();
    return form ? maxContextProblem(form) : '';
  });

  const aiApiKeyError = memo(() => {
    const form = aiEndpointForm();
    return form ? apiKeyProblem(form) : '';
  });

  // ── Local AI ──────────────────────────────────────────────────────────────────
  const localPort = () => modelAdmin()?.local;
  const canUseLocalAi = memo(() => !!localPort()?.plan);
  // The operator's flag: the adapter offers `install` only to a connection holding the node's
  // operator credential, which the executor requires for all four local AI writes. A grant is never
  // offered them, whatever its capabilities.
  const canConfigureLocalAi = memo(() => !!localPort()?.install);
  const [localHardware, setLocalHardware] = signal<LocalAiHardware | null>(null);
  const [localPlan, setLocalPlan] = signal<LocalAiPlan | null>(null);
  const [localStatus, setLocalStatus] = signal<LocalAiStatus | null>(null);
  const [localProgress, setLocalProgress] = signal<LocalAiProgress | null>(null);
  /*
    A plain view, derived afresh on every event. An install's progress arrives many times a second,
    and the page under it stays put through the renderer: the plan's rows and the servers' rows carry
    an `id`, which is what a list's rows are kept by, so an event changes the progress fields and
    draws nothing again — under a reader who has scrolled down to watch the bar.
  */
  const localAi = memo<LocalAiView>(() =>
    describeLocalAi({
      hardware: localHardware(),
      plan: localPlan(),
      status: localStatus(),
      progress: localProgress(),
      installingHere: pending().includes('installLocalAi'),
      operator: canConfigureLocalAi(),
    }),
  );

  const aiSetupOptions = memo(() =>
    aiSetupOptionsFor({
      canConfigureLocalAi: canConfigureLocalAi(),
      canConfigureAi: canConfigureAi(),
      canManageAiEndpoints: canManageAiEndpoints(),
    }),
  );

  /**
   * A page showing the AI settings is up: the settings overlay, or a first run's AI step. What the
   * AI reads and the listeners below wait for, so neither runs for a session nobody is looking at.
   */
  const aiShown = () => shell.activeShellView() === 'settings' || session.signInStep() === 'setUpAi';

  const aiServiceOptions = () => [
    ...AI_SERVICES.map((service) => ({ label: service.label, value: service.id })),
    { label: 'Another OpenAI-compatible server', value: CUSTOM_SERVICE },
  ];

  /**
   * What each form held when it opened, so "has this been edited" can be answered by comparison —
   * opening a model or a server to look at its settings and closing again asks nothing.
   */
  const [aiFormOpenedAs, setAiFormOpenedAs] = signal<AiModelForm | null>(null);
  const [aiEndpointFormOpenedAs, setAiEndpointFormOpenedAs] = signal<AiEndpointForm | null>(null);
  /**
   * Which opening of each form is on screen, so a save closes the form it was pressed in and not one
   * opened after it: a form can be closed while its save waits on the server.
   */
  let aiFormOpening = 0;
  let aiEndpointFormOpening = 0;

  function openAiForm(form: AiModelForm): void {
    aiFormOpening += 1;
    batch(() => {
      setAiForm(form);
      setAiFormOpenedAs(form);
    });
  }

  function openAiEndpointForm(form: AiEndpointForm): void {
    aiEndpointFormOpening += 1;
    batch(() => {
      setAiEndpointForm(form);
      setAiEndpointFormOpenedAs(form);
    });
  }

  const aiFormDirty = memo(() => {
    const form = aiForm();
    return !!form && !sameFields(form, aiFormOpenedAs());
  });

  const aiEndpointFormDirty = memo(() => {
    const form = aiEndpointForm();
    return !!form && !sameFields(form, aiEndpointFormOpenedAs());
  });

  // The AI sections are on the settings page and on a first run's AI step, which share them.
  effect(() => {
    if (!aiShown()) return;
    // A new backend is read afresh; the reads themselves are not what the effect follows.
    void session.backendPorts();
    const [models, endpoints, local] = [canManageAi(), canManageAiEndpoints(), canUseLocalAi()];
    untrack(() => {
      if (models) void loadAiModels();
      if (endpoints) void detectAiEndpoints();
      if (local) void loadLocalAi();
    });
  });

  /*
    An install's progress, heard while the settings are open — whether the install was started here
    or from the launcher. The end of one re-reads what it changed: the running state, and the
    managed servers and models it registered.

    What was heard before is dropped when listening starts: the events between were missed, and a
    retry of the same install has the same total, so an old count would hold the bar where it was.
    A failure is kept: it is why the last install did not finish, which somebody who left during it
    has not read yet, and the next install's first event replaces it.
  */
  effect(() => {
    if (!aiShown()) return;
    const kept = untrack(localProgress);
    setLocalProgress(kept?.phase === 'failed' ? kept : null);
    const stop = localPort()?.onProgress?.((event) =>
      untrack(() => {
        setLocalProgress(reduceProgress(localProgress(), event));
        if (event.phase === 'done' || event.phase === 'failed') void refreshLocalAi();
      }),
    );
    if (stop) onCleanup(stop);
  });

  /*
    Where a model stands is its server's answer, and the backend says when it changes: a pull's
    progress, a server going down or coming back. Listened to while the page that shows it is open,
    which replaces polling every model's status on a timer.
  */
  effect(() => {
    if (!aiShown()) return;
    const port = modelAdmin();
    const stopModels = port?.onModelStatus?.((event) =>
      untrack(() => {
        const pull = aiPull();
        if (pull && pull.endpointId === event.endpointId && serves([event.remoteModel], pull.model)) {
          setAiPull({ ...pull, progress: event.status.progress ?? pull.progress });
        }
        const same = (p: { endpointId: string; model: string }) =>
          p.endpointId === event.endpointId && p.model === event.remoteModel;
        const running = event.status.state === 'pulling';
        const pulls = serverPulls();
        if (running !== pulls.some(same)) {
          setServerPulls(
            running
              ? [...pulls, { endpointId: event.endpointId, model: event.remoteModel }]
              : pulls.filter((p) => !same(p)),
          );
        }
        setAiModelRecords(
          aiModelRecords().map((model) =>
            model.endpointId === event.endpointId && serves([event.remoteModel], model.remoteModel)
              ? { ...model, status: event.status }
              : model,
          ),
        );
      }),
    );
    // A server's health decides its models' statuses, so a change re-reads them rather than guessing.
    // Capabilities ride along, so a server that gains a kind of model is offered for it at once.
    const stopHealth = port?.onEndpointHealth?.((endpointId, health, capabilities) =>
      untrack(() => {
        setAiEndpointRecords(
          aiEndpointRecords().map((e) =>
            e.id === endpointId ? { ...e, health, ...(capabilities ? { capabilities } : {}) } : e,
          ),
        );
        void refreshAiModels();
      }),
    );
    onCleanup(() => {
      stopModels?.();
      stopHealth?.();
      // Nobody hears how a download ends while the page is shut, so what was running is let go of
      // rather than kept for ever; one the server is still running says so again with its next event.
      setServerPulls([]);
    });
  });

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
    return aiEndpointRecords().find((e) => canServe(e, kind))?.id ?? '';
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
    const form = { ...before, [field]: value };
    if (field === 'kind') {
      const endpoint = aiEndpointRecords().find((e) => e.id === form.endpointId);
      if (!endpoint || !canServe(endpoint, form.kind)) form.endpointId = endpointFor(form.kind);
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
      // Kept only where the server has said it serves the new kind: with discovery still out, the
      // model is of the kind the form was for, and discovery's fill keeps a field it finds full.
      if (model && !(discoveredForForm() && serves(listed, model))) setAiForm({ ...form, remoteModel: '' });
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
    // A failed or timed-out pull still re-reads where the models stand, so no row stays on its last
    // percentage. Outside `run`, which would clear the error that says why.
    if (!pulled.ok) return refreshAiModels();
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
    const opening = aiFormOpening;
    const saved = await run('saveAiModel', () =>
      form.id ? modelAdmin()?.update?.(form.id, draft) : modelAdmin()?.add?.(draft),
    );
    // The form stays open on failure, holding what was typed — the error slot above it says why.
    if (!saved.ok) return;
    if (opening === aiFormOpening) closeAiForm();
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
    if (!added.ok) return;
    if (added.value) await fillRoles(added.value);
    await loadAiModels();
  }

  /**
   * Give a server found on the node's machine the models it serves for each role nothing fills yet,
   * so one press leaves something answering — see `modelsForRoles`. A server on this machine only:
   * an API somewhere else bills for what it answers, and which of its models to pay for is the
   * person's to choose in the model form.
   */
  async function fillRoles(endpoint: AiEndpoint): Promise<void> {
    const port = modelAdmin();
    if (!port?.discover || !port.add) return;
    const listed = await run('addDetectedEndpoint', async () => {
      const [served, existing] = await Promise.all([port.discover?.({ endpointId: endpoint.id }), port.list?.()]);
      return { served: served ?? [], existing: existing ?? aiModelRecords() };
    });
    if (!listed.ok || !listed.value) return;
    const drafts = modelsForRoles({
      endpoint,
      served: listed.value.served,
      recommended: recommendations().models,
      existing: listed.value.existing,
    });
    for (const draft of drafts) await run('addDetectedEndpoint', () => port.add?.(draft));
  }

  function newAiEndpoint(): void {
    openAiEndpointForm({ ...EMPTY_ENDPOINT_FORM });
  }

  function editAiEndpoint(id: string): void {
    const endpoint = aiEndpointRecords().find((candidate) => candidate.id === id);
    // A managed server's address and settings are the backend's: there is nothing here to edit.
    if (endpoint && !endpoint.managed) openAiEndpointForm(endpointFormFrom(endpoint));
  }

  function setAiEndpointField(field: string, value: string | boolean): void {
    const form = untrack(aiEndpointForm);
    if (form) setAiEndpointForm({ ...form, [field]: value });
  }

  function setAiService(id: string): void {
    const form = untrack(aiEndpointForm);
    if (form) setAiEndpointForm(withService(form, id));
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
    const opening = aiEndpointFormOpening;
    const saved = await run('saveAiEndpoint', () =>
      form.id ? modelAdmin()?.updateEndpoint?.(form.id, draft) : modelAdmin()?.addEndpoint?.(draft),
    );
    if (!saved.ok) return;
    if (opening === aiEndpointFormOpening) setAiEndpointForm(null);
    await loadAiModels();
  }

  /** A managed server goes with local AI (`removeLocalAi`); the backend refuses it here anyway. */
  async function removeAiEndpoint(id: string): Promise<void> {
    if (isManaged(aiEndpointRecords(), id)) return;
    if ((await run('removeAiEndpoint', () => modelAdmin()?.removeEndpoint?.(id))).ok) await loadAiModels();
  }

  // ── Local AI ───────────────────────────────────────────────────────────────────

  /** The machine, the plan and the running state, read together so the section renders once. */
  async function loadLocalAi(): Promise<void> {
    const port = localPort();
    if (!port?.plan) return;
    const loaded = await run('loadLocalAi', () =>
      Promise.all([
        port.hardware?.() ?? Promise.resolve(null),
        port.plan?.(),
        port.status?.() ?? Promise.resolve(null),
      ]),
    );
    if (!loaded.ok || !loaded.value) return;
    const [hardware, plan, status] = loaded.value;
    batch(() => {
      setLocalHardware(hardware ?? null);
      setLocalPlan(plan ?? null);
      setLocalStatus(status ?? null);
      // A bar left under way when the settings closed mid-install is over if the backend says no
      // install runs: the events that ended it were not heard.
      if (status && !status.installing && !pending().includes('installLocalAi')) {
        const prev = untrack(localProgress);
        if (prev && prev.phase !== 'done' && prev.phase !== 'failed') setLocalProgress(null);
      }
    });
  }

  /**
   * After an install, a start or a stop: the plan (what is downloaded now), the running state, and
   * the servers and models local AI registered. Outside `run`, like `refreshAiModels`: it follows the
   * action rather than being one, and must not wipe the error the action may have left.
   */
  async function refreshLocalAi(): Promise<void> {
    const port = localPort();
    try {
      const [plan, status] = await Promise.all([port?.plan?.(), port?.status?.()]);
      batch(() => {
        if (plan) setLocalPlan(plan);
        if (status) setLocalStatus(status);
      });
    } catch {
      // The section keeps what it last said; reopening the settings reads it again.
    }
    await refreshAiEndpointsAndModels();
  }

  async function refreshAiEndpointsAndModels(): Promise<void> {
    try {
      const port = modelAdmin();
      const [models, endpoints] = await Promise.all([port?.list?.(), port?.endpoints?.()]);
      batch(() => {
        if (models) setAiModelRecords(models);
        if (endpoints) setAiEndpointRecords(endpoints);
      });
    } catch {
      // As refreshAiModels: the rows keep what they last said.
    }
  }

  async function installLocalAi(): Promise<void> {
    const port = localPort();
    if (!port?.install || localAi().installing) return;
    setLocalProgress(null);
    const installed = await run('installLocalAi', () => port.install?.());
    if (installed.ok && installed.value) setLocalStatus(installed.value);
    // The call has returned, so the install is over, whether or not its last event was heard.
    if (installed.ok) setLocalProgress(null);
    // Kept with the install, not only in the shared error: the person may have left the settings, and
    // the next read clears that error as it starts.
    if (!installed.ok) {
      const why = untrack(error);
      const prev = untrack(localProgress);
      if (prev?.phase !== 'failed')
        setLocalProgress({
          phase: 'failed',
          item: '',
          itemDoneBytes: 0,
          itemTotalBytes: 0,
          doneBytes: prev?.doneBytes ?? 0,
          totalBytes: prev?.totalBytes ?? 0,
          detail: why,
        });
    }
    await refreshLocalAi();
  }

  async function startLocalAi(): Promise<void> {
    const started = await run('startLocalAi', () => localPort()?.start?.());
    if (started.ok && started.value) setLocalStatus(started.value);
    await refreshLocalAi();
  }

  async function stopLocalAi(): Promise<void> {
    const stopped = await run('stopLocalAi', () => localPort()?.stop?.());
    if (stopped.ok && stopped.value) setLocalStatus(stopped.value);
    await refreshLocalAi();
  }

  // ── A first run's AI step ───────────────────────────────────────────────────────────────────────

  /*
    The node the answer is kept for, by its address. The step runs only for an agent just made, so
    an answer kept per agent would never be read again; per node, a second account made against a
    node whose first chose Skip is not asked again. A node reached with no address (the desktop's
    own executor) keeps no answer, and every new account on it is asked, as before.
  */
  const nodeKey = () => session.serverUrl() ?? '';

  /**
   * Ask, or not. Reads what the node already has first, bounded, since a first run is waiting on the
   * answer: a node that does not say within the bound is not asked about, and Settings is where AI is
   * set up afterwards.
   */
  async function openAiStep(): Promise<boolean> {
    const abilities = {
      canConfigureLocalAi: canConfigureLocalAi(),
      canConfigureAi: canConfigureAi(),
      canManageAiEndpoints: canManageAiEndpoints(),
    };
    const answered = readAiSetupAnswer(nodeKey()) !== null;
    if (!offersAiStep({ ...abilities, models: 0, localInstalled: false, answered })) return false;
    const port = modelAdmin();
    const read = Promise.all([port?.list?.() ?? Promise.resolve([]), localPort()?.status?.() ?? Promise.resolve(null)]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const known = await Promise.race([
      read.catch(() => null),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), AI_STEP_READ_MS))),
    ]).finally(() => clearTimeout(timer));
    if (!known) return false;
    const [models, status] = known;
    if (!offersAiStep({ ...abilities, models: models.length, localInstalled: !!status?.installed, answered })) {
      return false;
    }
    setAiModelRecords(models);
    if (status) setLocalStatus(status);
    session.holdForAiSetup();
    return true;
  }

  function leaveAiStep(answer: AiSetupAnswer): void {
    recordAiSetupAnswer(nodeKey(), answer);
    // A form left open on the step would come back over the app's settings page later.
    batch(() => {
      setAiForm(null);
      setAiEndpointForm(null);
    });
    session.finishSetup();
  }

  async function removeLocalAi(deleteFiles: boolean): Promise<void> {
    const removed = await run('removeLocalAi', () => localPort()?.remove?.(deleteFiles === true));
    if (!removed.ok) return;
    setLocalProgress(null);
    await refreshLocalAi();
  }

  return {
    canManageAi,
    canConfigureAi,
    aiModels,
    aiTasks,
    aiForm,
    aiFormComplete,
    aiFormDirty,
    aiEndpointOptions,
    canDiscoverAiModels,
    aiDiscoveredModelOptions,
    aiDiscoveredModelHint,
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
    canUseLocalAi,
    canConfigureLocalAi,
    localAi,
    aiSetupOptions,
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
    loadLocalAi,
    installLocalAi,
    startLocalAi,
    stopLocalAi,
    removeLocalAi,
    openAiStep,
    skipAiSetup: () => leaveAiStep('skipped'),
    finishAiSetup: () => leaveAiStep('set-up'),
  };
}
