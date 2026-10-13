/**
 * The models a backend runs — which there are, which is the default for each kind, and adding,
 * changing and removing them.
 *
 * Split out of runtime administration because it is the neutral half: every backend that answers
 * prompts or transcribes has models, a default per kind, and somebody who may change them, where
 * trust, peer networking and app credentials are one backend's mechanism.
 *
 * Every member is optional and callers feature-detect, the way runtime administration does: a
 * connection that may read the models but not change them — a guest on a shared node — offers
 * `list` and not `add`, and the settings page shows the list without the controls.
 */

/** What a model is for. The backend picks a default per kind, and apps ask by kind. */
export type AiModelKind = 'llm' | 'embedding' | 'transcription';

/**
 * Where a model's weights come from — the one thing that genuinely differs between models.
 *
 * A tagged union rather than the backend's shape (an optional `api` object beside an optional
 * `local` one, where `local` means three different things depending on which of its fields are
 * set). Which fields a form must show follows from `kind` here; with the original shape it follows
 * from inspecting which fields happen to be populated, which is how the launcher's edit form ends
 * up guessing.
 */
export type AiModelSource =
  /**
   * A remote endpoint, spoken to in the wire format `protocol` names.
   *
   * `maxContext` is a ceiling on the context window the backend asks the provider for, in tokens —
   * an upper bound, never a request. It matters where the provider sizes memory from the window at
   * load: a local model advertising a long window otherwise reserves all of it for a short prompt.
   */
  | { kind: 'api'; protocol: AiApiProtocol; baseUrl: string; apiKey: string; model: string; maxContext?: number }
  /** A build the backend knows by name and fetches itself — see `aiModelPresets`. */
  | { kind: 'preset'; name: string }
  | { kind: 'huggingface'; repo: string; revision: string; fileName: string; tokenizer?: TokenizerSource }
  /** A file already on the machine running the backend. */
  | { kind: 'file'; fileName: string; tokenizer?: TokenizerSource };

/**
 * The wire format a remote model is reached through.
 *
 * Not the vendor: OpenRouter, Groq, Gemini's compatibility surface and a local vLLM all speak
 * `openai`. `anthropic` exists because Claude's own format carries things the OpenAI one cannot —
 * prompt-cache breakpoints and native tool calls among them. `ollama` is Ollama's own API rather
 * than its OpenAI-compatible surface, which is the one through which the window it loads a model
 * with can be chosen at all — see `maxContext`.
 */
export type AiApiProtocol = 'openai' | 'anthropic' | 'ollama';

/** The endpoint details a model list is asked for, before any model exists to hold them. */
export interface AiModelDiscoveryQuery {
  protocol: AiApiProtocol;
  baseUrl: string;
  apiKey: string;
}

/** An explicit tokenizer, for the local sources whose weights do not carry one. */
export interface TokenizerSource {
  repo: string;
  revision: string;
  fileName: string;
}

export interface AiModel {
  id: string;
  name: string;
  kind: AiModelKind;
  source: AiModelSource;
  /** True for the model the backend uses when an app asks for this kind without naming one. */
  isDefault: boolean;
}

/** What `AiModel` needs to be created or edited — everything but the identity the backend assigns. */
export type AiModelDraft = Omit<AiModel, 'id' | 'isDefault'>;

/** Progress for a model the backend has to fetch before it can answer anything. */
export interface AiModelStatus {
  downloaded: boolean;
  loaded: boolean;
  /** Percentage, 0–100. */
  progress: number;
  /** The backend's own wording, displayed verbatim. */
  status: string;
}

/** A named prompt an app registered against a model. */
export interface AiTask {
  id: string;
  name: string;
  modelId: string;
  systemPrompt: string;
}

export interface ModelAdminPort {
  list?(): Promise<AiModel[]>;
  /** Model names this backend can fetch on its own, for the kind asked about. */
  presets?(kind: AiModelKind): Promise<string[]>;
  /**
   * The models a remote endpoint serves, asked of the endpoint itself. Rejects when it cannot be
   * reached or refuses the key, with the endpoint's own reason — which makes this the credential
   * check too. Omitted where the backend cannot ask.
   */
  discover?(query: AiModelDiscoveryQuery): Promise<string[]>;
  add?(draft: AiModelDraft): Promise<void>;
  update?(id: string, draft: AiModelDraft): Promise<void>;
  remove?(id: string): Promise<void>;
  /** Make this the model apps get when they ask for its kind. */
  setDefault?(id: string): Promise<void>;
  /** Download/load progress. Only meaningful for models the backend hosts itself. */
  status?(id: string): Promise<AiModelStatus>;
  /** Named prompts apps registered against a model. */
  tasks?(): Promise<AiTask[]>;
  removeTask?(id: string): Promise<void>;
}
