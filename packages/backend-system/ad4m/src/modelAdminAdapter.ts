/**
 * The models an AD4M executor runs, as the neutral `ModelAdminPort`.
 *
 * Gated by the same two questions as runtime administration (see `Ad4mRuntimeOptions`): reading
 * wherever the token's grant allows, changing only where the grant allows it *and* the node is
 * ours. The store reads capability off the port's shape, so a member left off is a control that
 * does not appear.
 */
import type { Ad4mClient, AIModel, ModelInput, ModelType } from '@coasys/ad4m';
import type {
  AiApiProtocol,
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelSource,
  ModelAdminPort,
} from '@we/backend-shared';

import { CAP_DOMAIN, CAP_VERB, createCapabilityCheck } from './capabilities';
import type { Ad4mRuntimeOptions } from './runtimeAdminAdapter';

/**
 * The model names AD4M's local runner knows how to fetch and run.
 *
 * Carried here rather than asked for, because the executor exposes no list of them: the launcher's
 * dropdowns are the only place they are written down. Nothing breaks if this drifts behind a new
 * executor build — a name AD4M added is simply missing from the picker, and the Hugging Face source
 * still reaches it — so it is a convenience list, not a contract.
 */
const PRESETS: Record<AiModelKind, string[]> = {
  llm: [
    'deephermes-3-llama-3-8b-Q4',
    'deephermes-3-llama-3-8b-Q6',
    'deephermes-3-llama-3-8b-Q8',
    'Qwen2.5.1-Coder-7B-Instruct',
    'deepseek_r1_distill_qwen_1_5b',
    'deepseek_r1_distill_qwen_7b',
    'deepseek_r1_distill_qwen_14b',
    'deepseek_r1_distill_llama_8b',
    'mistral_7b',
    'mistral_7b_instruct',
    'mistral_7b_instruct_2',
    'solar_10_7b',
    'solar_10_7b_instruct',
    'llama_7b',
    'llama_7b_chat',
    'llama_7b_code',
    'llama_8b',
    'llama_8b_chat',
    'llama_3_1_8b_chat',
    'llama_13b',
    'llama_13b_chat',
    'llama_13b_code',
    'llama_34b_code',
    'llama_70b',
  ],
  embedding: ['bert'],
  transcription: [
    'whisper_tiny',
    'whisper_tiny_quantized',
    'whisper_tiny_en',
    'whisper_tiny_en_quantized',
    'whisper_base',
    'whisper_base_en',
    'whisper_small',
    'whisper_small_en',
    'whisper_medium',
    'whisper_medium_en',
    'whisper_medium_en_quantized_distil',
    'whisper_large',
    'whisper_large_v2',
    'whisper_distil_medium_en',
    'whisper_distil_large_v2',
    'whisper_distil_large_v3',
    'whisper_distil_large_v3_quantized',
    'whisper_large_v3_turbo_quantized',
  ],
};

/**
 * The executor's name for each wire format. It accepts several spellings on the way in and answers
 * with these on the way out, so these are the ones worth writing.
 */
const PROTOCOL_TO_AD4M: Record<AiApiProtocol, string> = {
  openai: 'OPEN_AI',
  anthropic: 'ANTHROPIC',
  ollama: 'OLLAMA',
};

/**
 * An unrecognised API type reads as OpenAI, which is what every remote model was before there was a
 * choice — and what the executor itself assumes when none is given.
 *
 * Every type the executor answers with must be named here. One that was not read as OpenAI, and the
 * next save wrote it back as one: an Ollama model edited in settings lost its own provider.
 */
function toProtocol(apiType: unknown): AiApiProtocol {
  const type = String(apiType).toUpperCase();
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
 * The distinctions are implicit in the record: an `api` block means a remote endpoint, a `local`
 * block with a `huggingfaceRepo` means a repo to fetch, and a `local` block without one means
 * either a preset name or a path — which the executor itself tells apart the same way, by whether
 * the name matches a build it knows. Reading it once here is what lets the form ask a single
 * question instead of inferring the answer from which fields are populated.
 */
function toSource(model: AIModel): AiModelSource {
  if (model.api) {
    return {
      kind: 'api',
      protocol: toProtocol(model.api.apiType),
      baseUrl: model.api.baseUrl,
      hasApiKey: model.api.hasApiKey,
      model: model.api.model,
      ...(model.api.maxNumCtx ? { maxContext: model.api.maxNumCtx } : {}),
    };
  }
  const local = model.local;
  if (!local) return { kind: 'preset', name: '' };
  const tokenizer = local.tokenizerSource
    ? {
        repo: local.tokenizerSource.repo,
        revision: local.tokenizerSource.revision,
        fileName: local.tokenizerSource.fileName,
      }
    : undefined;
  if (local.huggingfaceRepo) {
    return {
      kind: 'huggingface',
      repo: local.huggingfaceRepo,
      revision: local.revision || 'main',
      fileName: local.fileName,
      tokenizer,
    };
  }
  const isPreset = Object.values(PRESETS).some((names) => names.includes(local.fileName));
  return isPreset ? { kind: 'preset', name: local.fileName } : { kind: 'file', fileName: local.fileName, tokenizer };
}

function toModelInput(draft: AiModelDraft): ModelInput {
  const input = { name: draft.name, modelType: KIND_TO_AD4M[draft.kind] } as ModelInput;
  const source = draft.source;
  if (source.kind === 'api') {
    // The protocol used to be dropped on read and written back as OpenAI, so saving any edit to an
    // Anthropic model silently turned it into an OpenAI one pointed at Anthropic's URL.
    input.api = {
      baseUrl: source.baseUrl,
      // Left out, the executor keeps the key it holds; `''` removes it. It never sends one back, so
      // there is nothing to echo here — an edit that does not touch the key must not send one.
      ...(source.apiKey !== undefined ? { apiKey: source.apiKey } : {}),
      model: source.model,
      apiType: PROTOCOL_TO_AD4M[source.protocol],
      // An update replaces the record, so a ceiling left out here is a ceiling removed.
      ...(source.maxContext ? { maxNumCtx: source.maxContext } : {}),
    };
  } else if (source.kind === 'huggingface') {
    input.local = {
      fileName: source.fileName,
      huggingfaceRepo: source.repo,
      revision: source.revision || 'main',
      tokenizerSource: source.tokenizer?.fileName ? source.tokenizer : undefined,
    };
  } else if (source.kind === 'file') {
    input.local = {
      fileName: source.fileName,
      tokenizerSource: source.tokenizer?.fileName ? source.tokenizer : undefined,
    };
  } else {
    input.local = { fileName: source.name };
  }
  return input;
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
      const models = await client.ai.getModels();
      const defaults = await Promise.all(
        (Object.values(KIND_TO_AD4M) as ModelType[]).map((type) =>
          // A kind with no default set is not an error — it resolves to no id.
          client.ai.getDefaultModel(type).catch(() => undefined),
        ),
      );
      const defaultIds = new Set(defaults.filter(Boolean).map((model) => model!.id));
      return models.map((model) => ({
        id: model.id,
        name: model.name,
        kind: toKind(model.modelType),
        source: toSource(model),
        isDefault: defaultIds.has(model.id),
      })) satisfies AiModel[];
    },

    async presets(kind) {
      return PRESETS[kind] ?? [];
    },

    async status(id) {
      const status = await client.ai.modelLoadingStatus(id);
      return {
        downloaded: status.downloaded,
        loaded: status.loaded,
        progress: status.progress ?? 0,
        status: status.status ?? '',
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
      const id = await client.ai.addModel(toModelInput(draft));
      const type = KIND_TO_AD4M[draft.kind];
      const existing = await client.ai.getDefaultModel(type).catch(() => undefined);
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
    ...discovery(client),
  };

  return {
    ...(granted(CAP_DOMAIN.ai, CAP_VERB.read) ? read : {}),
    ...(administersNode && granted(CAP_DOMAIN.ai, CAP_VERB.create) ? write : {}),
  };
}

/**
 * `discover`, where the client can ask for it.
 *
 * `AIClient.discoverModels` arrived with the executor's Anthropic provider, after the SDK this
 * package pins. Checked on the instance rather than assumed, so the settings page offers the model
 * list wherever it works and the typed field everywhere else, instead of a button that throws.
 */
function discovery(client: Ad4mClient): Pick<ModelAdminPort, 'discover'> {
  const ai = client.ai as unknown as
    { discoverModels?: (baseUrl: string, apiKey?: string, apiType?: string) => Promise<string[]> } | undefined;
  if (!ai || typeof ai.discoverModels !== 'function') return {};
  return {
    discover: ({ protocol, baseUrl, apiKey }) =>
      ai.discoverModels!(baseUrl, apiKey || undefined, PROTOCOL_TO_AD4M[protocol]),
  };
}
