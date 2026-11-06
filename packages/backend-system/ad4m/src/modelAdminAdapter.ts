/**
 * The models an AD4M executor uses, as the neutral `ModelAdminPort`.
 *
 * The executor runs no model itself: every model is a reference to one an **endpoint** serves (an
 * Ollama, a llama-server, vLLM, a speech server, OpenAI, Anthropic), and the endpoint holds the
 * address, the key and the health. So this adapter administers both, and translates AD4M's
 * `SCREAMING_CASE` vocabulary into the port's.
 *
 * Gated by the same two questions as runtime administration (see `Ad4mRuntimeOptions`): reading
 * wherever the token's grant allows, changing only where the grant allows it *and* the node is
 * ours. The store reads capability off the port's shape, so a member left off is a control that
 * does not appear.
 */
import {
  type Ad4mClient,
  AI_RECOMMENDED_MODELS,
  AI_SERVER_INSTALL_LINKS,
  type AiCapability as Ad4mCapability,
  type AiEndpoint as Ad4mEndpoint,
  type AIModel,
  type EndpointHealth,
  type EndpointKind,
  type LocalAiHardware as Ad4mLocalHardware,
  type LocalAiPlan as Ad4mLocalPlan,
  type LocalAiProgress as Ad4mLocalProgress,
  type LocalAiService,
  type LocalAiStatus as Ad4mLocalStatus,
  type ModelInput,
  type ModelStatus,
  type ModelType,
} from '@coasys/ad4m';
import type {
  AiCapability,
  AiEndpoint,
  AiEndpointDraft,
  AiEndpointHealth,
  AiEndpointKind,
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelStatus,
  AiRecommendedModel,
  LocalAiHardware,
  LocalAiPlan,
  LocalAiPort,
  LocalAiProgress,
  LocalAiStatus,
  ModelAdminPort,
} from '@we/backend-shared';

import { CAP_DOMAIN, CAP_VERB, createCapabilityCheck } from './capabilities';
import type { Ad4mRuntimeOptions } from './runtimeAdminAdapter';

const KIND_TO_AD4M: Record<AiModelKind, ModelType> = {
  llm: 'LLM',
  embedding: 'EMBEDDING',
  transcription: 'TRANSCRIPTION',
  speech: 'SPEECH',
};

const KIND_FROM_AD4M: Record<ModelType, AiModelKind> = {
  LLM: 'llm',
  EMBEDDING: 'embedding',
  TRANSCRIPTION: 'transcription',
  SPEECH: 'speech',
};

const ENDPOINT_KIND_TO_AD4M: Record<AiEndpointKind, EndpointKind> = {
  ollama: 'OLLAMA',
  'llama-server': 'LLAMA_SERVER',
  vllm: 'VLLM',
  openai: 'OPEN_AI',
  anthropic: 'ANTHROPIC',
  'openai-audio': 'OPEN_AI_AUDIO',
  'openai-compatible': 'OPEN_AI_COMPATIBLE',
};

const ENDPOINT_KIND_FROM_AD4M = Object.fromEntries(
  Object.entries(ENDPOINT_KIND_TO_AD4M).map(([ours, theirs]) => [theirs, ours]),
) as Record<EndpointKind, AiEndpointKind>;

/** The model type each capability serves, so a capability list can be read as kinds. */
const CAPABILITY_FROM_AD4M: Record<Ad4mCapability, AiCapability> = {
  chat: 'chat',
  embeddings: 'embeddings',
  transcription: 'transcription',
  speech: 'speech',
};

export function toModelStatus(status: ModelStatus | null | undefined): AiModelStatus {
  const detail = status?.detail ? { detail: status.detail } : {};
  switch (status?.state) {
    case 'READY':
      return { state: 'ready' };
    case 'MISSING':
      return { state: 'missing', ...detail };
    case 'ENDPOINT_DOWN':
      return { state: 'endpoint-down', ...detail };
    case 'PULLING':
      return { state: 'pulling', progress: Math.max(0, Math.min(100, Math.round(status.progress ?? 0))) };
    default:
      return { state: 'unknown', ...detail };
  }
}

function toHealth(health: EndpointHealth): AiEndpointHealth {
  const state = health.state === 'UNKNOWN' ? 'unknown' : (health.state.toLowerCase() as AiEndpointHealth['state']);
  return { state, detail: health.detail ?? '', models: health.servedModels ?? [] };
}

function toCapabilities(capabilities: Ad4mCapability[] | undefined): AiCapability[] {
  return (capabilities ?? []).map((capability) => CAPABILITY_FROM_AD4M[capability]).filter(Boolean);
}

function toEndpoint(endpoint: Ad4mEndpoint): AiEndpoint {
  return {
    id: endpoint.id,
    name: endpoint.name,
    kind: ENDPOINT_KIND_FROM_AD4M[endpoint.kind] ?? 'openai-compatible',
    baseUrl: endpoint.baseUrl,
    hasApiKey: endpoint.hasApiKey,
    capabilities: toCapabilities(endpoint.capabilities),
    ...(endpoint.maxNumCtx ? { maxContext: endpoint.maxNumCtx } : {}),
    ...(endpoint.requestTimeoutSecs ? { requestTimeoutSecs: endpoint.requestTimeoutSecs } : {}),
    ...(endpoint.maxConcurrent ? { maxConcurrent: endpoint.maxConcurrent } : {}),
    health: toHealth(endpoint.health),
    managed: endpoint.managed === true,
  };
}

// ── Local AI ──────────────────────────────────────────────────────────────────

/** AD4M names what a local runtime serves by service; the port by the kind of model. */
const SERVICE_TO_KIND: Record<LocalAiService, AiModelKind> = {
  llm: 'llm',
  embeddings: 'embedding',
  stt: 'transcription',
  tts: 'speech',
};

const KIND_TO_SERVICE = Object.fromEntries(
  Object.entries(SERVICE_TO_KIND).map(([service, kind]) => [kind, service]),
) as Record<AiModelKind, LocalAiService>;

const toKinds = (services: LocalAiService[]): AiModelKind[] => services.map((service) => SERVICE_TO_KIND[service]);

/** `null` and `undefined` both read as absent, so an optional field is never present and empty. */
function optional<K extends string>(key: K, value: number | null | undefined): Partial<Record<K, number>> {
  return typeof value === 'number' ? ({ [key]: value } as Record<K, number>) : {};
}

export function toLocalHardware(hardware: Ad4mLocalHardware): LocalAiHardware {
  return {
    os: hardware.os,
    arch: hardware.arch,
    cpu: hardware.cpu.brand,
    ramBytes: hardware.ramBytes,
    gpus: hardware.gpus.map((gpu) => ({
      vendor: gpu.vendor,
      type: gpu.type,
      name: gpu.name,
      ...optional('vramBytes', gpu.vramBytes),
      ...optional('sharedBytes', gpu.sharedBytes),
    })),
    backends: [...hardware.backends],
    memoryBudgetBytes: hardware.memoryBudgetBytes,
    ...optional('diskFreeBytes', hardware.diskFreeBytes),
    hardwareClass: hardware.hardwareClass,
    notes: [...hardware.notes],
  };
}

export function toLocalPlan(plan: Ad4mLocalPlan): LocalAiPlan {
  return {
    hardwareClass: plan.hardwareClass,
    runtimes: plan.runtimes.map((runtime) => ({
      id: runtime.runtimeId,
      version: runtime.version,
      build: runtime.build,
      backend: runtime.backend,
      sizeBytes: runtime.sizeBytes,
      installed: runtime.installed,
      kinds: toKinds(runtime.services),
    })),
    models: plan.models.map((model) => ({
      kind: SERVICE_TO_KIND[model.service],
      model: model.modelId,
      sizeBytes: model.sizeBytes,
      memoryBytes: model.memoryBytes,
      license: model.license,
      installed: model.installed,
      basis: model.basis,
      fromClass: model.fromClass,
    })),
    unavailable: plan.unavailable.map(({ service, reason }) => ({ kind: SERVICE_TO_KIND[service], reason })),
    downloadBytes: plan.downloadBytes,
    totalBytes: plan.totalBytes,
    memoryBytes: plan.memoryBytes,
    memoryBudgetBytes: plan.memoryBudgetBytes,
    ...optional('diskFreeBytes', plan.diskFreeBytes),
    fits: plan.fits,
    reasons: [...plan.reasons],
    ...(plan.device ? { device: plan.device } : {}),
  };
}

const PROGRESS_PHASES = new Set<LocalAiProgress['phase']>(['plan', 'download', 'start', 'register', 'done', 'failed']);

export function toLocalProgress(progress: Ad4mLocalProgress): LocalAiProgress {
  // The executor documents six phases as a string; one it adds later reads as the step before done.
  const phase = PROGRESS_PHASES.has(progress.phase as LocalAiProgress['phase'])
    ? (progress.phase as LocalAiProgress['phase'])
    : 'register';
  return {
    phase,
    item: progress.item ?? '',
    itemDoneBytes: progress.itemDoneBytes,
    itemTotalBytes: progress.itemTotalBytes,
    doneBytes: progress.doneBytes,
    totalBytes: progress.totalBytes,
    detail: progress.detail ?? '',
  };
}

export function toLocalStatus(status: Ad4mLocalStatus): LocalAiStatus {
  return {
    installed: status.installed,
    installing: status.installing,
    autostart: status.autostart,
    runtimes: status.runtimes.map((runtime) => ({
      id: runtime.runtimeId,
      version: runtime.version,
      build: runtime.build,
      kinds: toKinds(runtime.services),
      phase: runtime.phase,
      ...optional('port', runtime.port),
      restarts: runtime.restarts,
      detail: runtime.detail ?? '',
      ...(runtime.endpointId ? { endpointId: runtime.endpointId } : {}),
      onGpu: runtime.onGpu,
      ...optional('gpuBytes', runtime.gpuBytes),
    })),
    models: status.models.map((model) => ({
      kind: SERVICE_TO_KIND[model.service],
      model: model.modelId,
      ...(model.model ? { modelId: model.model } : {}),
    })),
  };
}

/**
 * An update replaces the endpoint's settings, so everything the draft carries goes, and a setting
 * left out is a setting removed — except the key, where absent keeps the stored one. Capabilities
 * are never sent: left out, the executor probes them from what the server lists.
 */
function toEndpointInput(draft: AiEndpointDraft) {
  return {
    name: draft.name,
    kind: ENDPOINT_KIND_TO_AD4M[draft.kind],
    baseUrl: draft.baseUrl,
    ...(draft.apiKey !== undefined ? { apiKey: draft.apiKey } : {}),
    ...(draft.maxContext ? { maxNumCtx: draft.maxContext } : {}),
    ...(draft.requestTimeoutSecs ? { requestTimeoutSecs: draft.requestTimeoutSecs } : {}),
    ...(draft.maxConcurrent ? { maxConcurrent: draft.maxConcurrent } : {}),
  };
}

function toModelInput(draft: AiModelDraft): ModelInput {
  return {
    name: draft.name,
    modelType: KIND_TO_AD4M[draft.kind],
    endpointId: draft.endpointId,
    remoteModel: draft.remoteModel,
    // An update replaces the record, so a choice made elsewhere must be sent back to survive.
    ...(draft.nativeTools !== undefined ? { nativeTools: draft.nativeTools } : {}),
  };
}

function toModel(model: AIModel, defaultIds: Set<string>): AiModel {
  return {
    id: model.id,
    name: model.name,
    kind: KIND_FROM_AD4M[model.modelType] ?? 'llm',
    endpointId: model.endpointId,
    remoteModel: model.remoteModel,
    ...(typeof model.nativeTools === 'boolean' ? { nativeTools: model.nativeTools } : {}),
    status: toModelStatus(model.status),
    isDefault: defaultIds.has(model.id),
  };
}

/** The SDK's recommendations, in the port's words. Data, not a contract: a name AD4M changes simply follows. */
function recommended(): ReturnType<NonNullable<ModelAdminPort['recommended']>> {
  return {
    models: AI_RECOMMENDED_MODELS.flatMap((model): AiRecommendedModel[] => {
      const kind = KIND_FROM_AD4M[model.modelType];
      const { description } = model;
      if (model.ollama) return [{ kind, endpointKind: 'ollama', model: model.ollama, description }];
      if (model.openAiAudio) return [{ kind, endpointKind: 'openai-audio', model: model.openAiAudio, description }];
      return [];
    }),
    installLinks: [
      { label: 'Ollama', url: AI_SERVER_INSTALL_LINKS.ollama },
      { label: 'speaches', url: AI_SERVER_INSTALL_LINKS.speaches },
    ],
  };
}

export function createAd4mModelAdmin(backendClient: unknown, options: Ad4mRuntimeOptions = {}): ModelAdminPort {
  const client = backendClient as Ad4mClient;
  const administersNode = options.administersNode ?? true;
  const granted = createCapabilityCheck(options.capabilities ?? null);
  /*
    Changing a model takes the grant *and* the node being ours. Without the grant we offer controls
    the executor refuses; without `administersNode` we offer node-wide changes on a machine shared
    with other people, which AD4M's default guest grant permits and good sense does not.
  */

  /**
   * Reading what AI the node can do, which a guest is granted and a guest wants.
   *
   * Split out of the node-scoped block because it is the case that proved the old single boolean
   * wrong: AD4M hands a hosted guest `AI READ`, WE hid the whole section anyway, and a transcription
   * model the node was happily running looked to the user like no model at all.
   */
  const read: ModelAdminPort = {
    /**
     * Defaults are read per kind rather than carried on the record. AD4M keeps one default per
     * model type and `ai.models` does not say which, so one call per kind answers it.
     */
    async list() {
      const models = await client.ai.getModels();
      const defaults = await Promise.all(
        Object.values<ModelType>(KIND_TO_AD4M).map((type) =>
          // A kind with no default answers null, and an older refusal is no default either.
          client.ai.getDefaultModel(type).catch(() => null),
        ),
      );
      const defaultIds = new Set(defaults.flatMap((model) => (model ? [model.id] : [])));
      return models.map((model) => toModel(model, defaultIds));
    },

    async status(id) {
      return toModelStatus(await client.ai.modelStatus(id));
    },

    async tasks() {
      const tasks = await client.ai.tasks();
      return tasks.map((task) => ({
        id: task.taskId,
        name: task.name,
        modelId: task.modelId,
        systemPrompt: task.systemPrompt,
      }));
    },

    onModelStatus(listener) {
      return client.on('model-status', ({ endpointId, remoteModel, status }) =>
        listener({ endpointId, remoteModel, status: toModelStatus(status) }),
      );
    },

    recommended,
  };

  /**
   * The endpoints themselves, which the executor shows only to its operator: a managed user's
   * session is refused `ai.endpoints`, and the health events go to the main agent alone. So they are
   * the node's, like changing anything is.
   */
  const endpoints: ModelAdminPort = {
    async endpoints() {
      return (await client.ai.endpoints()).map(toEndpoint);
    },

    async detectEndpoints() {
      return (await client.ai.detectEndpoints()).map((found) => ({
        kind: ENDPOINT_KIND_FROM_AD4M[found.kind] ?? 'openai-compatible',
        baseUrl: found.baseUrl,
        capabilities: toCapabilities(found.capabilities),
        models: found.servedModels,
      }));
    },

    onEndpointHealth(listener) {
      return client.on('ai-endpoint-status', ({ endpointId, health }) => listener(endpointId, toHealth(health)));
    },
  };

  /**
   * Changing which models the node uses — administration, and refused to a guest.
   *
   * AD4M is explicit about the boundary: `get_user_default_capabilities` grants a hosted user
   * `AI READ/CREATE/PROMPT/TRANSCRIBE` and pointedly excludes `UPDATE` and `DELETE` as "admin
   * operations for managing AI models". `CREATE` is granted, but adding a model to a machine other
   * people share is still the operator's call, so it sits here with the rest.
   */
  const write: ModelAdminPort = {
    /**
     * A first model of its kind becomes that kind's default. Otherwise it is added and does
     * nothing, which reads to the user as the button having failed.
     */
    async add(draft) {
      const id = await client.ai.addModel(toModelInput(draft));
      const type = KIND_TO_AD4M[draft.kind];
      const existing = await client.ai.getDefaultModel(type).catch(() => null);
      if (!existing) await client.ai.setDefaultModel(type, id);
    },

    async update(id, draft) {
      await client.ai.updateModel(id, toModelInput(draft));
    },

    async remove(id) {
      await client.ai.removeModel(id);
    },

    /** Takes only an id: the model already knows its kind, so asking the caller to repeat it
     * invites the two disagreeing. */
    async setDefault(id) {
      const model = (await client.ai.getModels()).find((m) => m.id === id);
      if (!model) throw new Error('That model is no longer installed');
      await client.ai.setDefaultModel(model.modelType, id);
    },

    async removeTask(id) {
      await client.ai.removeTask(id);
    },

    // Discovery needs `AI CREATE` on the executor, the same grant as adding the model it is for.
    async discover(query) {
      const params =
        'endpointId' in query
          ? { endpointId: query.endpointId }
          : {
              kind: ENDPOINT_KIND_TO_AD4M[query.kind],
              baseUrl: query.baseUrl,
              ...(query.apiKey ? { apiKey: query.apiKey } : {}),
            };
      return (await client.ai.discoverModels(params)).map((model) => ({
        id: model.id,
        capabilities: toCapabilities(model.capabilities),
      }));
    },

    async addEndpoint(draft) {
      return toEndpoint(await client.ai.addEndpoint(toEndpointInput(draft)));
    },

    async updateEndpoint(id, draft) {
      return toEndpoint(await client.ai.updateEndpoint(id, toEndpointInput(draft)));
    },

    async removeEndpoint(id) {
      await client.ai.removeEndpoint(id);
    },

    /**
     * Resolves when the server has the whole model, which for gigabytes is minutes: the call is the
     * executor's long kind, and progress arrives through `onModelStatus` meanwhile.
     */
    async pullModel(endpointId, remoteModel) {
      await client.ai.pullModel(endpointId, remoteModel);
    },
  };

  /**
   * Local AI reads the node's own machine — its processor, its memory, its disk — so it is the
   * operator's, like the endpoints: a guest on somebody else's node has no use for that machine's
   * hardware and should not be shown it. The progress events go to the operator alone as well.
   */
  const localRead: LocalAiPort = {
    async hardware() {
      return toLocalHardware(await client.ai.localHardware());
    },
    async plan() {
      return toLocalPlan(await client.ai.localPlan());
    },
    async status() {
      return toLocalStatus(await client.ai.localStatus());
    },
    onProgress(listener) {
      return client.on('ai-local-progress', (progress) => listener(toLocalProgress(progress)));
    },
  };

  /** Installing, starting, stopping and removing are the executor's operator-only calls. */
  const localWrite: LocalAiPort = {
    /**
     * Gigabytes: the SDK waits hours by default rather than the usual request timeout. Progress is
     * heard through `onProgress`, so an install started from the launcher shows here too.
     */
    async install(options) {
      const services = options?.kinds?.map((kind) => KIND_TO_SERVICE[kind]);
      return toLocalStatus(await client.ai.localInstall(services ? { services } : {}));
    },
    async start() {
      return toLocalStatus(await client.ai.localStart());
    },
    async stop() {
      return toLocalStatus(await client.ai.localStop());
    },
    async remove(deleteFiles) {
      await client.ai.localRemove(deleteFiles);
    },
  };

  const operates = administersNode && granted(CAP_DOMAIN.ai, CAP_VERB.read);
  const configures = administersNode && granted(CAP_DOMAIN.ai, CAP_VERB.create);
  return {
    ...(granted(CAP_DOMAIN.ai, CAP_VERB.read) ? read : {}),
    ...(operates ? endpoints : {}),
    ...(configures ? write : {}),
    ...(operates ? { local: { ...localRead, ...(configures ? localWrite : {}) } } : {}),
  };
}
