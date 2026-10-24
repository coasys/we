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
   * `hasApiKey` says whether the backend holds a key for it — never the key. A key goes in and
   * stays with the backend, which sends it to the provider and to nobody else, so a settings page
   * can say "a key is set" and offer to replace or remove it, and cannot show it or reuse it.
   *
   * `maxContext` is a ceiling on the context window the backend asks the provider for, in tokens —
   * an upper bound, never a request. It matters where the provider sizes memory from the window at
   * load: a local model advertising a long window otherwise reserves all of it for a short prompt.
   */
  | { kind: 'api'; protocol: AiApiProtocol; baseUrl: string; hasApiKey: boolean; model: string; maxContext?: number }
  | AiLocalModelSource;

/** The sources whose weights the backend runs itself. Read and written alike: nothing in them is secret. */
export type AiLocalModelSource =
  /** A build the backend knows by name and fetches itself — see `aiModelPresets`. */
  | { kind: 'preset'; name: string }
  | { kind: 'huggingface'; repo: string; revision: string; fileName: string; tokenizer?: TokenizerSource }
  /** A file already on the machine running the backend. */
  | { kind: 'file'; fileName: string; tokenizer?: TokenizerSource };

/**
 * A source as it is written: the same as `AiModelSource`, except that a remote endpoint carries the
 * key being sent rather than whether one is held.
 *
 * `apiKey` absent keeps the key the backend holds, `''` removes it, and a value replaces it. A key
 * goes only to the address it was set for, so an update that moves `baseUrl` while a key is held and
 * sends none is refused: a form asks for the key again before it saves such a change.
 */
export type AiModelSourceDraft =
  | { kind: 'api'; protocol: AiApiProtocol; baseUrl: string; apiKey?: string; model: string; maxContext?: number }
  | AiLocalModelSource;

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

/**
 * The endpoint details a model list is asked for, before any model exists to hold them.
 *
 * `apiKey` is the key as typed. A key the backend already holds for a model cannot stand in: the
 * backend never hands one back, and asks the endpoint with exactly what it is given.
 */
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

/**
 * What `AiModel` needs to be created or edited — everything but the identity the backend assigns,
 * with the source as it is written (see `AiModelSourceDraft`).
 */
export type AiModelDraft = Omit<AiModel, 'id' | 'isDefault' | 'source'> & { source: AiModelSourceDraft };

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
