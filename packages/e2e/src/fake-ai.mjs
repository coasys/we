/**
 * A stand-in for the `ai` calls of an executor's admin client, for tests of model setup that must
 * not start an executor.
 *
 * It refuses a call the way ad4m's executor does since ad4m #1616, which made every model a model on
 * an endpoint (`core/src/ai/AIClient.ts` and `rust-executor/src/ai_service` on ad4m dev). The suites
 * run nightly against ad4m's newest executor. When the API changed, they still sent the old shape
 * and failed at setup, after a full executor and web build. A test on this fake catches that in a
 * second.
 *
 * Only the calls that model setup makes are here. There is no `modelLoadingStatus`: ad4m removed it
 * with the models that ran in the executor.
 */

const ENDPOINT_KINDS = [
  'OLLAMA',
  'LLAMA_SERVER',
  'VLLM',
  'OPEN_AI',
  'ANTHROPIC',
  'OPEN_AI_AUDIO',
  'OPEN_AI_COMPATIBLE',
];
const MODEL_TYPES = ['LLM', 'EMBEDDING', 'TRANSCRIPTION', 'SPEECH'];

/** What each kind serves when it is not told (`EndpointKind::default_capabilities`). */
const DEFAULT_CAPABILITIES = {
  OPEN_AI: ['chat', 'embeddings', 'transcription', 'speech'],
  OLLAMA: ['chat', 'embeddings'],
  OPEN_AI_AUDIO: ['transcription'],
  ANTHROPIC: ['chat'],
  LLAMA_SERVER: ['chat'],
  VLLM: ['chat'],
  OPEN_AI_COMPATIBLE: ['chat'],
};

/** Kinds whose wire protocol is OpenAI's (`EndpointKind::protocol`): the only ones with a speech route. */
const OPEN_AI_PROTOCOL = ['LLAMA_SERVER', 'VLLM', 'OPEN_AI', 'OPEN_AI_AUDIO', 'OPEN_AI_COMPATIBLE'];

/** The executor's refusal of a JSON-RPC call whose params do not deserialise (serde's words). */
function missing(method, field) {
  return new Error(`RpcError 400: Invalid params for ${method}: missing field \`${field}\``);
}

function requireFields(method, params, fields) {
  for (const field of fields) {
    if (params?.[field] === undefined || params[field] === null) throw missing(method, field);
  }
}

/** A key goes only over https or to loopback (`is_transport_safe`). */
function transportSafe(baseUrl) {
  const url = new URL(baseUrl);
  return url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}

/**
 * An admin client with the `ai` calls of model setup, which refuses them as ad4m dev does. A model
 * whose `remoteModel` is in `unlisted` is one that its server does not list: `modelStatus` says
 * `MISSING` for it.
 *
 * Besides `ai`, it gives `endpointOf(modelId)` (the endpoint a model runs on, with its key and
 * capabilities) and `defaults` (the default model id of each model type).
 */
export function fakeAiAdmin({ unlisted = [] } = {}) {
  const endpoints = new Map();
  const models = new Map();
  const defaults = new Map();
  let next = 0;
  const ai = {
    async addEndpoint(input) {
      requireFields('ai.addEndpoint', input, ['name', 'kind', 'baseUrl']);
      if (!ENDPOINT_KINDS.includes(input.kind)) {
        throw new Error(`Invalid params for ai.addEndpoint: unknown kind ${input.kind}`);
      }
      new URL(input.baseUrl);
      if (input.apiKey && !transportSafe(input.baseUrl)) throw new Error('Refusing to send a key over plain HTTP');
      const endpoint = {
        id: `endpoint-${++next}`,
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey ?? '',
        capabilities: input.capabilities ?? DEFAULT_CAPABILITIES[input.kind],
      };
      endpoints.set(endpoint.id, endpoint);
      return { ...endpoint, apiKey: undefined, hasApiKey: Boolean(endpoint.apiKey), managed: false };
    },
    async addModel(model) {
      requireFields('ai.addModel', model, ['name', 'modelType', 'endpointId', 'remoteModel']);
      if (!MODEL_TYPES.includes(model.modelType)) {
        throw new Error(`Invalid params for ai.addModel: unknown modelType ${model.modelType}`);
      }
      const endpoint = endpoints.get(model.endpointId);
      if (!endpoint) throw new Error(`No endpoint ${model.endpointId}`);
      // `check_endpoint_serves`: a transcription model needs an endpoint that speaks OpenAI.
      if (model.modelType === 'TRANSCRIPTION' && !OPEN_AI_PROTOCOL.includes(endpoint.kind)) {
        throw new Error(`Endpoint '${endpoint.name}' (${endpoint.kind}) serves no /v1/audio/transcriptions`);
      }
      const id = `model-${++next}`;
      models.set(id, { id, ...model });
      return id;
    },
    async setDefaultModel(modelType, id) {
      const model = models.get(id);
      if (!model) throw new Error(`No model ${id}`);
      if (model.modelType !== modelType) throw new Error(`Model ${id} is ${model.modelType}, not ${modelType}`);
      defaults.set(modelType, id);
      return true;
    },
    async modelStatus(id) {
      const model = models.get(id);
      if (!model) throw new Error(`No model ${id}`);
      return { state: unlisted.includes(model.remoteModel) ? 'MISSING' : 'READY' };
    },
    async getDefaultModel(modelType) {
      return models.get(defaults.get(modelType)) ?? null;
    },
    async getModels() {
      return [...models.values()];
    },
    async endpoints() {
      return [...endpoints.values()];
    },
  };
  return {
    ai,
    endpointOf(modelId) {
      return endpoints.get(models.get(modelId)?.endpointId);
    },
    defaults,
  };
}
