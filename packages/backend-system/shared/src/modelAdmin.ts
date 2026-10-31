/**
 * The models a backend uses — which there are, which is the default for each kind, the servers they
 * run on, and adding, changing and removing both.
 *
 * Split out of runtime administration because it is the neutral half: every backend that answers
 * prompts or transcribes has models, a default per kind, and somebody who may change them, where
 * trust, peer networking and app credentials are one backend's mechanism.
 *
 * A model is a reference to a model an **endpoint** serves: an upstream server (Ollama, a
 * llama-server, vLLM, a speech server, OpenAI, Anthropic) with an address, a key and a health. The
 * endpoint owns the address and the key, so two models on one server share them, and a key is
 * never repeated per model.
 *
 * Every member is optional and callers feature-detect, the way runtime administration does: a
 * connection that may read the models but not change them — a guest on a shared node — offers
 * `list` and not `add`, and the settings page shows the list without the controls.
 */

/** What a model is for. The backend picks a default per kind, and apps ask by kind. */
export type AiModelKind = 'llm' | 'embedding' | 'transcription' | 'speech';

/** What an endpoint, or one model it lists, can do. */
export type AiCapability = 'chat' | 'embeddings' | 'transcription' | 'speech';

/**
 * What kind of server an endpoint is — which decides how its models are listed and which wire format
 * it speaks. `openai-audio` is an OpenAI-shaped speech server such as speaches; `openai-compatible`
 * is any other server speaking OpenAI's format (OpenRouter, Groq, a gateway).
 */
export type AiEndpointKind =
  'ollama' | 'llama-server' | 'vllm' | 'openai' | 'anthropic' | 'openai-audio' | 'openai-compatible';

/** An endpoint's last health check. */
export interface AiEndpointHealth {
  state: 'unknown' | 'reachable' | 'unauthorized' | 'unreachable';
  /** The server's reason when it is not reachable, in its own words. Empty otherwise. */
  detail: string;
  /** The model ids the last check listed. */
  models: string[];
}

export interface AiEndpoint {
  id: string;
  name: string;
  kind: AiEndpointKind;
  baseUrl: string;
  /**
   * Whether the backend holds a key for it — never the key. A key goes in and stays with the
   * backend, which sends it to the server and to nobody else, so a settings page can say "a key is
   * set" and offer to replace or remove it, and cannot show it or reuse it.
   */
  hasApiKey: boolean;
  capabilities: AiCapability[];
  /**
   * A ceiling on the context window the backend asks the server for, in tokens — an upper bound,
   * never a request. It matters where the server sizes memory from the window at load: a local
   * model advertising a long window otherwise reserves all of it for a short prompt.
   */
  maxContext?: number;
  /** How long one request may take, in seconds. Carried so an edit does not drop it. */
  requestTimeoutSecs?: number;
  /** At most this many requests at once. Carried so an edit does not drop it. */
  maxConcurrent?: number;
  health: AiEndpointHealth;
}

/**
 * An endpoint as it is written: the same as `AiEndpoint`, except that it carries the key being sent
 * rather than whether one is held, and no health — which is the backend's answer, not a setting.
 *
 * `apiKey` absent keeps the key the backend holds, `''` removes it, and a value replaces it. A key
 * goes only to the address it was set for, so an update that moves `baseUrl` while a key is held and
 * sends none is refused: a form asks for the key again before it saves such a change.
 */
export interface AiEndpointDraft {
  name: string;
  kind: AiEndpointKind;
  baseUrl: string;
  apiKey?: string;
  maxContext?: number;
  requestTimeoutSecs?: number;
  maxConcurrent?: number;
}

/** A model server running on the machine the backend runs on, found by looking. Nothing is saved. */
export interface AiDetectedEndpoint {
  kind: AiEndpointKind;
  baseUrl: string;
  capabilities: AiCapability[];
  /** The model ids it serves. */
  models: string[];
}

/** One model a server lists. */
export interface AiDiscoveredModel {
  id: string;
  /** What the server says the model does, or the backend's guess from its id. */
  capabilities: AiCapability[];
}

/** Where a model stands, by its server's last answer. */
export interface AiModelStatus {
  /**
   * `missing`: the server does not list it. `pulling`: the server is downloading it.
   * `endpoint-down`: the server does not answer. `unknown`: nothing has been checked yet.
   */
  state: 'unknown' | 'ready' | 'missing' | 'pulling' | 'endpoint-down';
  /** Percentage, 0–100, while `pulling`. */
  progress?: number;
}

export interface AiModel {
  id: string;
  name: string;
  kind: AiModelKind;
  /** The endpoint that serves it. */
  endpointId: string;
  /** The id the endpoint knows it by. */
  remoteModel: string;
  /**
   * Whether prompts with tools send them as tool definitions; absent leaves it to the backend.
   * Carried so an edit that does not show it does not reset it.
   */
  nativeTools?: boolean;
  status: AiModelStatus;
  /** True for the model the backend uses when an app asks for this kind without naming one. */
  isDefault: boolean;
}

/** What `AiModel` needs to be created or edited — everything but what the backend assigns or reports. */
export type AiModelDraft = Omit<AiModel, 'id' | 'isDefault' | 'status'>;

/** A model a server is downloading, as the backend reports it while a pull runs. */
export interface AiModelStatusEvent {
  endpointId: string;
  remoteModel: string;
  status: AiModelStatus;
}

/** A named prompt an app registered against a model. */
export interface AiTask {
  id: string;
  name: string;
  modelId: string;
  systemPrompt: string;
}

/** A model the backend recommends for a kind, by the id its kind of server knows it by. */
export interface AiRecommendedModel {
  kind: AiModelKind;
  /** The kind of server it is fetched onto or served by. */
  endpointKind: AiEndpointKind;
  model: string;
  description: string;
}

/** Where to get a model server, for when none runs on the backend's machine. */
export interface AiServerInstallLink {
  label: string;
  url: string;
}

export interface ModelAdminPort {
  list?(): Promise<AiModel[]>;
  /**
   * The models a server lists: a saved endpoint by its id, or one not saved yet by its kind, address
   * and key. Rejects when it cannot be reached or refuses the key, with the server's own reason —
   * which makes this the credential check too.
   */
  discover?(
    query: { endpointId: string } | { kind: AiEndpointKind; baseUrl: string; apiKey?: string },
  ): Promise<AiDiscoveredModel[]>;
  add?(draft: AiModelDraft): Promise<void>;
  update?(id: string, draft: AiModelDraft): Promise<void>;
  remove?(id: string): Promise<void>;
  /** Make this the model apps get when they ask for its kind. */
  setDefault?(id: string): Promise<void>;
  /** Where one model stands now. */
  status?(id: string): Promise<AiModelStatus>;
  /** Named prompts apps registered against a model. */
  tasks?(): Promise<AiTask[]>;
  removeTask?(id: string): Promise<void>;

  /** The servers the models run on, with their health. */
  endpoints?(): Promise<AiEndpoint[]>;
  /** Register a server. Saved whatever its health: one that does not answer yet is still kept. */
  addEndpoint?(draft: AiEndpointDraft): Promise<AiEndpoint>;
  updateEndpoint?(id: string, draft: AiEndpointDraft): Promise<AiEndpoint>;
  /** Refused while models run on it. */
  removeEndpoint?(id: string): Promise<void>;
  /** Model servers running on the backend's own machine. Nothing is saved. */
  detectEndpoints?(): Promise<AiDetectedEndpoint[]>;
  /**
   * Download a model onto a server that can fetch its own (Ollama). Resolves when it is done;
   * progress arrives through `onModelStatus`. Absent where the backend cannot ask.
   */
  pullModel?(endpointId: string, remoteModel: string): Promise<void>;
  /** Hear where a server's model stands while it changes — a pull's progress. Returns the unsubscribe. */
  onModelStatus?(listener: (event: AiModelStatusEvent) => void): () => void;
  /** Hear an endpoint's health change. Returns the unsubscribe. */
  onEndpointHealth?(listener: (endpointId: string, health: AiEndpointHealth) => void): () => void;
  /** The models the backend recommends, and where to get a server for them. */
  recommended?(): { models: AiRecommendedModel[]; installLinks: AiServerInstallLink[] };
}
