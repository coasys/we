/**
 * The models an AD4M executor runs, as the neutral `ModelAdminPort`.
 *
 * Gated by the same two questions as runtime administration (see `Ad4mRuntimeOptions`): reading
 * wherever the token's grant allows, changing only where the grant allows it *and* the node is
 * ours. The store reads capability off the port's shape, so a member left off is a control that
 * does not appear.
 */
import type { Ad4mClient, AiEndpoint, AIModel, EndpointKind, ModelInput, ModelType } from '@coasys/ad4m';
import type {
  AiApiProtocol,
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelSource,
  AiModelSourceDraft,
  ModelAdminPort,
} from '@we/backend-shared';

import { CAP_DOMAIN, CAP_VERB, createCapabilityCheck } from './capabilities';
import { recordMissingMethod } from './missingMethods';
import type { Ad4mRuntimeOptions } from './runtimeAdminAdapter';

/**
 * The executor's name for each wire format — now the *endpoint's* kind: the endpoint owns the URL,
 * the key and the protocol; a model only names it.
 */
const PROTOCOL_TO_AD4M: Record<AiApiProtocol, EndpointKind> = {
  openai: 'OPEN_AI',
  anthropic: 'ANTHROPIC',
  ollama: 'OLLAMA',
};

/**
 * An unrecognised endpoint kind reads as OpenAI, which is what every remote endpoint was before
 * there was a choice — and what the executor itself assumes when none is given.
 *
 * Every kind the executor answers with must be named here. One that was not read as OpenAI, and the
 * next save wrote it back as one: an Ollama endpoint edited in settings lost its own provider.
 */
function toProtocol(kind: unknown): AiApiProtocol {
  const type = String(kind).toUpperCase();
  if (type === 'ANTHROPIC') return 'anthropic';
  if (type === 'OLLAMA') return 'ollama';
  return 'openai';
}

const KIND_TO_AD4M: Record<AiModelKind, ModelType> = {
  llm: 'LLM',
  embedding: 'EMBEDDING',
  transcription: 'TRANSCRIPTION',
};

function toKind(modelType: ModelType): AiModelKind {
  if (modelType === 'EMBEDDING') return 'embedding';
  if (modelType === 'TRANSCRIPTION') return 'transcription';
  return 'llm';
}

/**
 * AD4M's model record, read as a source.
 *
 * A model is now a row on an *endpoint*: the endpoint owns the URL, the key, the protocol and the
 * context ceiling; the model names the endpoint and the id the endpoint serves it under. An
 * endpoint the executor manages itself (`managed` — installed by `ai.localInstall`) is the
 * successor to the old `local` block: the executor picks and fetches its own models now, so it
 * reads as a preset nobody has to name.
 *
 * An endpoint the caller cannot see (the list is operator-only) is a source guessed as remote
 * with an empty URL — the honest shape for "a model somebody else's node runs". `predates` marks
 * the harder case: an executor that never had the endpoint API, where the blank reads as "executor
 * too old" rather than as an unset field.
 */
function toSource(model: AIModel, endpoints: ReadonlyMap<string, AiEndpoint>, predates: boolean): AiModelSource {
  const endpoint = endpoints.get(model.endpointId);
  if (!endpoint) {
    return {
      kind: 'api',
      protocol: 'openai',
      baseUrl: '',
      hasApiKey: false,
      model: model.remoteModel,
      ...(predates ? { endpointUnlisted: true } : {}),
    };
  }
  if (endpoint.managed) {
    return { kind: 'preset', name: model.remoteModel };
  }
  return {
    kind: 'api',
    protocol: toProtocol(endpoint.kind),
    baseUrl: endpoint.baseUrl,
    hasApiKey: endpoint.hasApiKey,
    model: model.remoteModel,
    ...(endpoint.maxNumCtx ? { maxContext: endpoint.maxNumCtx } : {}),
  };
}

/**
 * Every endpoint, keyed by id — and whether the executor answered at all.
 *
 * The list is operator-only: a guest's read resolves to an empty map with `predates` unset, the
 * same guessable-remote shape as before. An executor without `ai.endpoints` gets `predates`: its
 * models' blank URLs are then told apart from an unseen list and can say "executor too old".
 */
async function endpointMap(client: Ad4mClient): Promise<{ endpoints: Map<string, AiEndpoint>; predates: boolean }> {
  try {
    return {
      endpoints: new Map((await client.ai.endpoints()).map((endpoint) => [endpoint.id, endpoint])),
      predates: false,
    };
  } catch (error) {
    return { endpoints: new Map(), predates: recordMissingMethod(error) };
  }
}

/**
 * The endpoint an `api` source describes, reused when one matches and registered when none does.
 * Endpoint identity is URL + kind: two models on the same service share the row, and a second
 * registration of the same URL would duplicate the server and its key.
 */
async function ensureEndpoint(
  client: Ad4mClient,
  source: Extract<AiModelSourceDraft, { kind: 'api' }>,
  name: string,
): Promise<string> {
  const kind = PROTOCOL_TO_AD4M[source.protocol];
  const existing = (await client.ai.endpoints()).find(
    (endpoint) => endpoint.baseUrl === source.baseUrl && endpoint.kind === kind,
  );
  if (existing) {
    /*
      Anything handed in for an endpoint the node already knows is a change to that row, not a
      duplicate add — and the update is the whole record. `updateEndpoint` clears every field left
      out, so timeout and concurrency go back with the change, and the context ceiling the form
      did not touch keeps what the endpoint already holds.
    */
    const contextChanged = source.maxContext !== undefined && source.maxContext !== existing.maxNumCtx;
    if (source.apiKey !== undefined || contextChanged) {
      const maxNumCtx = source.maxContext ?? existing.maxNumCtx;
      await client.ai.updateEndpoint(existing.id, {
        name: existing.name,
        kind: existing.kind,
        baseUrl: existing.baseUrl,
        ...(source.apiKey !== undefined ? { apiKey: source.apiKey } : {}),
        ...(maxNumCtx ? { maxNumCtx } : {}),
        ...(existing.requestTimeoutSecs ? { requestTimeoutSecs: existing.requestTimeoutSecs } : {}),
        ...(existing.maxConcurrent ? { maxConcurrent: existing.maxConcurrent } : {}),
      });
    }
    return existing.id;
  }
  const endpoint = await client.ai.addEndpoint({
    name,
    kind,
    baseUrl: source.baseUrl,
    ...(source.apiKey !== undefined ? { apiKey: source.apiKey } : {}),
    ...(source.maxContext ? { maxNumCtx: source.maxContext } : {}),
  });
  return endpoint.id;
}

async function toModelInput(client: Ad4mClient, draft: AiModelDraft): Promise<ModelInput> {
  const source = draft.source;
  if (source.kind !== 'api' || !source.baseUrl) {
    // Per-model local installs are gone with the `local` block: the executor installs local AI
    // itself, whole, through `ai.localInstall`. Only a remote endpoint takes a model by hand now.
    throw new Error(
      'Local models are installed by the executor itself now — its local AI setup picks and ' +
        'fetches them. Only a model on a remote endpoint can be added here.',
    );
  }
  const endpointId = await ensureEndpoint(client, source, draft.name);
  return {
    name: draft.name,
    modelType: KIND_TO_AD4M[draft.kind],
    endpointId,
    remoteModel: source.model,
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
     * model type and `getEntities` does not say which, so the launcher asked for the LLM default only
     * and no other kind could ever show as default. Three calls answer it for all of them.
     */
    async list() {
      const [models, { endpoints, predates }] = await Promise.all([client.ai.getModels(), endpointMap(client)]);
      const defaults = await Promise.all(
        Object.values<ModelType>(KIND_TO_AD4M).map((type) =>
          // A kind with no default set is not an error — it resolves to no id.
          client.ai.getDefaultModel(type).catch(() => null),
        ),
      );
      const defaultIds = new Set(defaults.filter(Boolean).map((model) => model!.id));
      return models.map((model) => ({
        id: model.id,
        name: model.name,
        kind: toKind(model.modelType),
        source: toSource(model, endpoints, predates),
        isDefault: defaultIds.has(model.id),
      })) satisfies AiModel[];
    },

    presets() {
      /*
        The executor picks its own local models now (`ai.localInstall` carries the list), so there
        are no names left for the launcher to offer — a dropdown of presets nothing can install
        would promise an add that always refuses.
      */
      return Promise.resolve([]);
    },

    async status(id) {
      const status = await client.ai.modelStatus(id);
      return {
        downloaded: status.state === 'READY',
        loaded: status.state === 'READY',
        progress: status.progress ?? 0,
        status: status.detail ?? status.state ?? '',
      };
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
  };

  /**
   * Changing which models the node runs — administration, and refused to a guest.
   *
   * AD4M is explicit about the boundary: `get_user_default_capabilities` grants a hosted user
   * `AI READ/CREATE/PROMPT/TRANSCRIBE` and pointedly excludes `UPDATE` and `DELETE` as "admin
   * operations for managing AI models". `CREATE` is granted, but adding a model to a machine other
   * people share is still the operator's call, so it sits here with the rest.
   */
  const write: ModelAdminPort = {
    /**
     * A first model of its kind becomes that kind's default. Otherwise it is added and does
     * nothing, which reads to the user as the button having failed — the launcher does the same for
     * LLMs and leaves the other kinds unset.
     */
    async add(draft) {
      const id = await client.ai.addModel(await toModelInput(client, draft));
      const type = KIND_TO_AD4M[draft.kind];
      const existing = await client.ai.getDefaultModel(type).catch(() => null);
      if (!existing) await client.ai.setDefaultModel(type, id);
    },

    async update(id, draft) {
      const model = (await client.ai.getModels()).find((m) => m.id === id);
      if (!model) throw new Error('That model is no longer installed');
      const source = draft.source;
      /*
        A model is a name over an endpoint and a remote id. An `api` source that names a URL
        resolves the endpoint it describes — registering or updating it — and retargets the model;
        anything else (a rename, a source whose endpoint it cannot name, an executor-managed row)
        keeps the ones it already has rather than failing a save that never meant to move it.
      */
      let endpointId = model.endpointId;
      let remoteModel = model.remoteModel;
      if (source.kind === 'api' && source.baseUrl) {
        endpointId = await ensureEndpoint(client, source, draft.name);
        remoteModel = source.model;
      }
      await client.ai.updateModel(id, {
        name: draft.name,
        modelType: KIND_TO_AD4M[draft.kind],
        endpointId,
        remoteModel,
      });
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
    ...discovery(client),
  };

  return {
    ...(granted(CAP_DOMAIN.ai, CAP_VERB.read) ? read : {}),
    ...(administersNode && granted(CAP_DOMAIN.ai, CAP_VERB.create) ? write : {}),
  };
}

/**
 * `discover`: probe an unsaved endpoint for the models it lists, by kind, URL and key.
 * Answered as ids, which is what the port's picker shows.
 */
function discovery(client: Ad4mClient): Pick<ModelAdminPort, 'discover'> {
  // A client that predates the endpoint API has no `discoverModels` to call: offering the member
  // would put a "list the models" button in settings that throws when pressed.
  if (typeof client.ai?.discoverModels !== 'function') return {};
  return {
    discover: async ({ protocol, baseUrl, apiKey }) => {
      const found = await client.ai.discoverModels({
        kind: PROTOCOL_TO_AD4M[protocol],
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
      });
      return found.map((model) => model.id);
    },
  };
}
