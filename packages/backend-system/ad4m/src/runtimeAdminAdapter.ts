/**
 * The AD4M implementation of {@link RuntimeAdminPort} — the settings the ADAM launcher owns.
 *
 * Every method here is a thin wrapper over `client.runtime.*` or `client.agent.*`. That thinness
 * is the point: the launcher's equivalent screens are React components with the same calls buried
 * inside them, which is why none of it was reachable from a host that bundles the executor instead
 * of shelling out to the launcher. Reaching the same GraphQL from the shell needs no new
 * privileges — only a place to put it.
 *
 * Not covered, and not by oversight: multi-agent switching, log levels, data paths, MCP and proxy
 * configuration. Those are Tauri commands in the launcher because they manipulate the host's
 * filesystem and process, and no amount of GraphQL reaches them — they need a host capability
 * (see `RuntimeHost` in the follow-up), not a port over the client.
 *
 * Publishing a language is left out for a nearer reason: `languages.publish` takes a path to a
 * bundle *on the executor's filesystem*, and a file picker in a browser context yields a File with
 * no path to give it. The launcher's own publish form asks the user to type the path, and its
 * buttons are wired to the install handler, so it has never published anything.
 */
import {
  type Ad4mClient,
  type AIModel,
  type Apps,
  capSentence,
  ExceptionType,
  type ModelInput,
  type ModelType,
} from '@coasys/ad4m';
import type {
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelSource,
  AuthorizedApp,
  RuntimeAdminPort,
} from '@we/backend-shared';

/**
 * The languages the executor installs for itself and cannot run without.
 *
 * Hardcoded because AD4M does not report it: `languages.all()` returns the infrastructure and the
 * user's installs in one undifferentiated list. The launcher carried the same five names for the
 * same reason. The cost of it drifting is a removable badge on a language that should not be
 * removable, so `removeLanguage` refuses on this list rather than trusting the UI to hide a button.
 */
const SYSTEM_LANGUAGES = [
  'languages',
  'agent-expression-store',
  'neighbourhood-store',
  'perspective-language',
  'direct-message-language',
];

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
    return { kind: 'api', baseUrl: model.api.baseUrl, apiKey: model.api.apiKey, model: model.api.model };
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
    input.api = { baseUrl: source.baseUrl, apiKey: source.apiKey, model: source.model, apiType: 'OPEN_AI' };
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

/** AD4M's `Apps` record, flattened into the contract's shape with capabilities pre-rendered. */
function toAuthorizedApp(app: Apps): AuthorizedApp {
  return {
    id: app.requestId,
    name: app.auth.appName,
    description: app.auth.appDesc,
    url: app.auth.appUrl,
    iconUrl: app.auth.appIconPath,
    // capSentence turns a capability object into the sentence the launcher's consent dialog shows.
    // Rendering here rather than in the shell keeps AD4M's capability vocabulary out of templates.
    capabilities: (app.auth.capabilities ?? []).map((cap) => capSentence(cap)),
    revoked: !!app.revoked,
  };
}

export interface Ad4mRuntimeOptions {
  /**
   * Whether this connection operates the node it reached. Defaults to true.
   *
   * False for a guest on somebody else's executor — a hosted node, or any multi-user one, which is
   * the normal web case. Almost everything here is then not merely likely to fail but wrong to
   * offer: trust, peer networking and installed languages are the *node's*, and "restart
   * networking" on a machine shared with other people is the clearest example of a button that
   * should not exist rather than one that returns an error.
   *
   * Declared by the connector, which is what knows how the connection was obtained, rather than
   * discovered by probing each call — a capability error is what a wrongly-offered control returns,
   * not a good way to find out whether to offer it.
   */
  administersNode?: boolean;
}

export function createAd4mRuntimeAdmin(backendClient: unknown, options: Ad4mRuntimeOptions = {}): RuntimeAdminPort {
  const client = backendClient as Ad4mClient;
  const administersNode = options.administersNode ?? true;

  /**
   * What belongs to the agent rather than to the node, and so survives being a guest.
   *
   * Authorized apps are this agent's own grants — `agent.getApps()` answers for whoever is
   * authenticated — and consent requests are raised at this session. Both are as meaningful on a
   * node run by somebody else as on one of your own.
   */
  const agentScoped: RuntimeAdminPort = {
    // ── External apps ─────────────────────────────────────────────────────────
    /**
     * AD4M returns one record per issued token, so an app that reconnected several times appears
     * several times. Collapsing by URL matches how a user thinks about it — "Flux has access", not
     * "Flux has four tokens" — and `revoke`/`remove` below re-expand it, acting on every token the
     * app holds rather than one arbitrary grant.
     */
    async authorizedApps() {
      const apps = await client.agent.getApps();
      const byUrl = new Map<string, AuthorizedApp>();
      for (const app of apps) {
        const mapped = toAuthorizedApp(app);
        const existing = byUrl.get(mapped.url);
        // A grant counts as live if any of its tokens is unrevoked.
        if (existing) existing.revoked = existing.revoked && mapped.revoked;
        else byUrl.set(mapped.url, mapped);
      }
      return [...byUrl.values()];
    },

    async revokeApp(id) {
      for (const requestId of await tokensSharingApp(client, id)) {
        await client.agent.revokeToken(requestId);
      }
    },

    async removeApp(id) {
      for (const requestId of await tokensSharingApp(client, id)) {
        await client.agent.removeApp(requestId);
      }
    },

    // ── Consent ───────────────────────────────────────────────────────────────
    /**
     * One executor subscription, demultiplexed into the contract's two request kinds. AD4M raises
     * these as `exception` events carrying the request in `addon` — a JSON blob for capability
     * requests, a bare DID for trust — which the shell relays back untouched on approve/deny.
     *
     * `addExceptionCallback` has no documented unsubscribe, so the returned function flips a local
     * flag instead: after it runs, later events are dropped rather than delivered to a handler the
     * caller has discarded.
     */
    onConsentRequest(handler) {
      let live = true;

      client.runtime.addExceptionCallback((info) => {
        if (!live) return null;

        if (info.type === ExceptionType.CapabilityRequested && info.addon) {
          try {
            const auth = JSON.parse(info.addon).auth;
            handler({
              kind: 'capability',
              title: info.title,
              message: info.message,
              app: {
                name: auth.appName,
                description: auth.appDesc,
                url: auth.appUrl,
                iconUrl: auth.appIconPath,
                capabilities: (auth.capabilities ?? []).map((cap: unknown) =>
                  capSentence(cap as Parameters<typeof capSentence>[0]),
                ),
              },
              payload: info.addon,
            });
          } catch (err) {
            // A malformed request must not take down the subscription — every later consent
            // prompt would be lost with it, silently.
            console.error('ad4m runtime: could not read a capability request', err);
          }
        }

        if (info.type === ExceptionType.AgentIsUntrusted && info.addon) {
          handler({
            kind: 'trust',
            title: info.title,
            message: info.message,
            peerId: info.addon,
            payload: info.addon,
          });
        }

        return null;
      });

      return () => {
        live = false;
      };
    },

    async approve(request) {
      if (request.kind === 'capability') return client.agent.permitCapability(request.payload);
      await client.runtime.addTrustedAgents([request.payload]);
    },

    async deny(request) {
      // Capability requests need no negative acknowledgement — the asker times out, which is the
      // same outcome as the launcher's dialog being dismissed. Declining to trust a peer is
      // likewise the absence of an entry, not an entry saying "no".
      if (request.kind === 'trust') await client.runtime.deleteTrustedAgents([request.payload]);
    },
  };

  if (!administersNode) return agentScoped;

  /** Everything that administers the node itself, and so is only offered to whoever operates it. */
  const nodeScoped: RuntimeAdminPort = {
    // ── AI models ─────────────────────────────────────────────────────────────
    /**
     * Defaults are read per kind rather than carried on the record. AD4M keeps one default per
     * model type and `getModels` does not say which, so the launcher asked for the LLM default only
     * and no other kind could ever show as default. Three calls answer it for all of them.
     */
    async aiModels() {
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

    async aiModelPresets(kind) {
      return PRESETS[kind] ?? [];
    },

    /**
     * A first model of its kind becomes that kind's default. Otherwise it is added and does
     * nothing, which reads to the user as the button having failed — the launcher does the same for
     * LLMs and leaves the other kinds unset.
     */
    async addAiModel(draft) {
      const id = await client.ai.addModel(toModelInput(draft));
      const type = KIND_TO_AD4M[draft.kind];
      const existing = await client.ai.getDefaultModel(type).catch(() => undefined);
      if (!existing) await client.ai.setDefaultModel(type, id);
    },

    async updateAiModel(id, draft) {
      await client.ai.updateModel(id, toModelInput(draft));
    },

    async removeAiModel(id) {
      await client.ai.removeModel(id);
    },

    /** Takes only an id: the model already knows its kind, so asking the caller to repeat it
     * invites the two disagreeing. */
    async setDefaultAiModel(id) {
      const model = (await client.ai.getModels()).find((m) => m.id === id);
      if (!model) throw new Error('That model is no longer installed');
      await client.ai.setDefaultModel(model.modelType, id);
    },

    async aiModelStatus(id) {
      const status = await client.ai.modelLoadingStatus(id);
      return {
        downloaded: status.downloaded,
        loaded: status.loaded,
        progress: status.progress ?? 0,
        status: status.status ?? '',
      };
    },

    async aiTasks() {
      const tasks = await client.ai.tasks();
      return tasks.map((task) => ({
        id: task.taskId,
        name: task.name,
        modelId: task.modelId,
        systemPrompt: task.systemPrompt,
      }));
    },

    async removeAiTask(id) {
      await client.ai.removeTask(id);
    },

    // ── Languages ─────────────────────────────────────────────────────────────
    async languages() {
      const handles = await client.languages.all();
      return handles.map((handle) => ({
        address: handle.address,
        name: handle.name,
        system: SYSTEM_LANGUAGES.includes(handle.name),
      }));
    },

    /**
     * `byAddress` is the install: asking for a language the node does not have makes it fetch and
     * install the bundle, and the handle it returns is the installed one. It reads like a getter,
     * which is exactly why it is wrapped here rather than called from the store.
     */
    async installLanguage(address) {
      await client.languages.byAddress(address);
    },

    async removeLanguage(address) {
      const handle = (await client.languages.all()).find((l) => l.address === address);
      if (handle && SYSTEM_LANGUAGES.includes(handle.name)) {
        throw new Error(`${handle.name} is part of the running node and cannot be removed`);
      }
      await client.languages.remove(address);
    },

    // ── Trust ─────────────────────────────────────────────────────────────────
    async trustedAgents() {
      return client.runtime.getTrustedAgents();
    },

    async trustAgent(id) {
      await client.runtime.addTrustedAgents([id]);
    },

    async untrustAgent(id) {
      await client.runtime.deleteTrustedAgents([id]);
    },

    // ── Peer network ──────────────────────────────────────────────────────────
    async networkMetrics() {
      return client.runtime.getNetworkMetrics();
    },

    async restartNetwork() {
      await client.runtime.restartHolochain();
    },

    async peerInfos() {
      return client.runtime.hcAgentInfos();
    },

    async addPeerInfos(infos) {
      await client.runtime.hcAddAgentInfos(infos);
    },
  };

  return { ...agentScoped, ...nodeScoped };
}

/** Every token id belonging to the same app URL as `id`. See `authorizedApps` for why. */
async function tokensSharingApp(client: Ad4mClient, id: string): Promise<string[]> {
  const apps = await client.agent.getApps();
  const target = apps.find((a) => a.requestId === id);
  if (!target) return [id];
  return apps.filter((a) => a.auth.appUrl === target.auth.appUrl).map((a) => a.requestId);
}
