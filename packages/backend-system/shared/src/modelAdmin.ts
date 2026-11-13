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
  /**
   * The backend runs this server itself — local AI on this device (see `LocalAiPort`). A managed
   * server cannot be edited or removed as a server: it goes with `LocalAiPort.remove`, and its address
   * and health are the backend's to keep.
   */
  managed: boolean;
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
  /** The backend's reason, in its own words, where it gave one — "connection refused". */
  detail?: string;
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
  /**
   * Hear an endpoint's health change. Returns the unsubscribe. `capabilities` is what the server can
   * do now — it changes as models are pulled — and absent where the backend does not say.
   */
  onEndpointHealth?(
    listener: (endpointId: string, health: AiEndpointHealth, capabilities?: AiCapability[]) => void,
  ): () => void;
  /** The models the backend recommends, and where to get a server for them. */
  recommended?(): { models: AiRecommendedModel[]; installLinks: AiServerInstallLink[] };
  /**
   * Local AI: model servers the backend installs and runs itself, on the machine it runs on. Absent
   * where the backend cannot, or where this connection may not see the node's machine.
   */
  local?: LocalAiPort;
}

// ── Local AI ──────────────────────────────────────────────────────────────────

/** A graphics processor the backend found. */
export interface LocalAiGpu {
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';
  /** `unified`: one memory for the CPU and the GPU (Apple, AMD Strix Halo). */
  type: 'discrete' | 'integrated' | 'unified';
  name: string;
  /** Dedicated memory, or an integrated GPU's carve-out. Absent where it could not be read. */
  vramBytes?: number;
  /** System memory the GPU may map besides. Absent where it could not be read. */
  sharedBytes?: number;
}

/** The machine the backend runs on, as far as running models on it goes. */
export interface LocalAiHardware {
  /** `linux`, `macos` or `windows`. */
  os: string;
  /** `x64` or `arm64`. */
  arch: string;
  /** The CPU's name, empty where it could not be read. */
  cpu: string;
  ramBytes: number;
  gpus: LocalAiGpu[];
  /** What a runtime may compute with here: `cpu`, `metal`, `vulkan`, `cuda`, `rocm`. */
  backends: string[];
  /** What the models may take together. */
  memoryBudgetBytes: number;
  /** Free space where the models are kept. Absent where it could not be read. */
  diskFreeBytes?: number;
  /** The backend's name for this class of machine — what its recommendations are keyed by. */
  hardwareClass: string;
  /** What detection could not read, and what it estimated. */
  notes: string[];
}

/** A server program the plan installs. */
export interface LocalAiPlannedRuntime {
  /** The program: `llama-server`. */
  id: string;
  version: string;
  /** Its build for this machine: `linux-x64-vulkan`. */
  build: string;
  backend: string;
  sizeBytes: number;
  /** Already on disk. */
  installed: boolean;
  kinds: AiModelKind[];
}

/** A model the plan installs. */
export interface LocalAiPlannedModel {
  kind: AiModelKind;
  /** Its id, which is also the id its server serves it by. */
  model: string;
  sizeBytes: number;
  memoryBytes: number;
  license: string;
  installed: boolean;
  /**
   * `measured`: what the backend measured for this class of machine (or the nearest smaller one).
   * `default`: nothing was measured for this kind here, so the plan takes the smallest model it has.
   */
  basis: 'measured' | 'default';
  /** The class of machine the choice comes from — for a default, this machine's own. */
  fromClass: string;
}

/** What an install would do on this machine. */
export interface LocalAiPlan {
  hardwareClass: string;
  runtimes: LocalAiPlannedRuntime[];
  models: LocalAiPlannedModel[];
  /** A kind of model the plan leaves out, and why. */
  unavailable: { kind: AiModelKind; reason: string }[];
  /** What is not downloaded yet. */
  downloadBytes: number;
  /** Everything the plan installs, downloaded or not. */
  totalBytes: number;
  /** The planned models' memory, together. */
  memoryBytes: number;
  memoryBudgetBytes: number;
  diskFreeBytes?: number;
  /** The models fit the memory budget and the download fits the disk. */
  fits: boolean;
  /** Why it does not fit, and what was stepped down or runs on the CPU. */
  reasons: string[];
  /**
   * The backend the node's settings hold the plan to (`cpu`, `metal`, `vulkan`, `cuda`, `rocm`), or
   * absent when it plans for the best one detection found.
   */
  device?: string;
}

/** Where an install is, as the backend reports it while one runs. */
export interface LocalAiProgress {
  phase: 'plan' | 'download' | 'start' | 'register' | 'done' | 'failed';
  /** The program or model being downloaded. Empty outside a download. */
  item: string;
  itemDoneBytes: number;
  itemTotalBytes: number;
  doneBytes: number;
  totalBytes: number;
  /** Why it failed, or what it is doing. Empty otherwise. */
  detail: string;
}

/** One server program the backend runs. */
export interface LocalAiRuntimeStatus {
  id: string;
  version: string;
  build: string;
  kinds: AiModelKind[];
  /** `null`: not running — not started since the backend started, or stopped. */
  phase: 'starting' | 'running' | 'restarting' | 'stopped' | 'failed' | null;
  port?: number;
  /** How often the backend has restarted it since it last started. */
  restarts: number;
  /** Why it failed or restarted. Empty otherwise. */
  detail: string;
  /** The model server it is registered as, once it is. */
  endpointId?: string;
  /**
   * After a start on a GPU build: whether the model is in GPU memory. `null`: not checked (a CPU
   * build, or a GPU whose memory the backend cannot see).
   */
  onGpu: boolean | null;
  gpuBytes?: number;
}

/** What local AI has set up on this machine, and how it runs. */
export interface LocalAiStatus {
  /** An install finished. */
  installed: boolean;
  installing: boolean;
  /** The installed servers start with the backend. It never installs one: only an install does. */
  autostart: boolean;
  runtimes: LocalAiRuntimeStatus[];
  /** The models installed, with the backend's model each is registered as, once it is. */
  models: { kind: AiModelKind; model: string; modelId?: string }[];
}

/**
 * Local AI — the backend installs model servers and models fitted to the machine it runs on, runs
 * them, and registers them as managed servers, models and defaults. Nothing leaves the machine.
 *
 * Every member is optional, read separately from changed: a connection may be shown what an install
 * would do without being allowed to start one.
 */
export interface LocalAiPort {
  hardware?(): Promise<LocalAiHardware>;
  plan?(): Promise<LocalAiPlan>;
  status?(): Promise<LocalAiStatus>;
  /**
   * Download, check, start and register. Resolves when it is done, which for gigabytes is minutes;
   * `onProgress` hears where it is meanwhile. `kinds` limits it to some of the plan; absent, all of it.
   */
  install?(options?: { kinds?: AiModelKind[] }): Promise<LocalAiStatus>;
  start?(): Promise<LocalAiStatus>;
  stop?(): Promise<LocalAiStatus>;
  /** Unregister and stop the servers; `deleteFiles` deletes what was downloaded as well. */
  remove?(deleteFiles: boolean): Promise<void>;
  /** Hear an install's progress — one started here or anywhere else. Returns the unsubscribe. */
  onProgress?(listener: (progress: LocalAiProgress) => void): () => void;
}
