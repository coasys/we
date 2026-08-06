/**
 * Runtime administration — the settings that belong to the *backend process*, not to any dataset.
 *
 * Trust, peer networking, and which external apps hold credentials against this agent. On AD4M
 * these are what the launcher owns; a host that bundles the executor has no launcher to open, so
 * without this port those settings are unreachable rather than merely inconvenient.
 *
 * Deliberately not neutral, and deliberately shaped like {@link BackendInterop}: the whole port is
 * optional, every member on it is optional, and callers feature-detect. A backend with no notion
 * of peer trust omits `trustedAgents` and the settings UI drops that section — the same
 * degradation presence and `publish`/`join` already use. The alternative, a neutral abstraction
 * over "administer a backend", would have exactly one implementation and would have to invent
 * vocabulary for concepts only one backend has.
 *
 * What is NOT here, on purpose: anything requiring privileged access to the host machine —
 * switching agents between config directories, log levels, data paths. Those are properties of how
 * a *host* launched the backend, not of the backend connection, and a port over a GraphQL client
 * cannot honestly answer them.
 */

/** An external app holding a credential against this agent. */
export interface AuthorizedApp {
  /** Stable id for this grant — what revoke/remove take. */
  id: string;
  name: string;
  description: string;
  url: string;
  iconUrl?: string;
  /** Human-readable capability lines, already rendered by the adapter. */
  capabilities: string[];
  revoked: boolean;
}

/**
 * A request awaiting the user's decision, raised by the backend while the app is running.
 *
 * `kind` distinguishes what is being asked: an app wants credentials (`capability`), or an unknown
 * peer wants to be trusted (`trust`). `payload` is the adapter's own token for the request — the
 * shell hands it straight back to `approve`/`deny` without inspecting it.
 */
export interface ConsentRequest {
  kind: 'capability' | 'trust';
  title: string;
  message: string;
  /** Present for `capability`: who is asking and for what. */
  app?: Omit<AuthorizedApp, 'id' | 'revoked'>;
  /** Present for `trust`: the peer's id. */
  peerId?: string;
  payload: string;
}

/**
 * A language plugin installed in this backend.
 *
 * "Language" is AD4M's word for the adapter that stores and retrieves a kind of expression — what
 * makes an image URL resolvable, or a neighbourhood's links syncable. They are addressed by content
 * hash, which is why installing one is a matter of pasting an address rather than picking a package.
 */
export interface InstalledLanguage {
  /** Content address — the identifier install and remove take. */
  address: string;
  name: string;
  /** Part of the backend's own machinery. Removing one breaks the running node, so the UI won't. */
  system: boolean;
}

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
  /** An OpenAI-compatible endpoint. */
  | { kind: 'api'; baseUrl: string; apiKey: string; model: string }
  /** A build the backend knows by name and fetches itself — see `aiModelPresets`. */
  | { kind: 'preset'; name: string }
  | { kind: 'huggingface'; repo: string; revision: string; fileName: string; tokenizer?: TokenizerSource }
  /** A file already on the machine running the backend. */
  | { kind: 'file'; fileName: string; tokenizer?: TokenizerSource };

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

export interface RuntimeAdminPort {
  // ── AI models ───────────────────────────────────────────────────────────────
  aiModels?(): Promise<AiModel[]>;
  /** Model names this backend can fetch on its own, for the kind asked about. */
  aiModelPresets?(kind: AiModelKind): Promise<string[]>;
  addAiModel?(draft: AiModelDraft): Promise<void>;
  updateAiModel?(id: string, draft: AiModelDraft): Promise<void>;
  removeAiModel?(id: string): Promise<void>;
  /** Make this the model apps get when they ask for its kind. */
  setDefaultAiModel?(id: string): Promise<void>;
  /** Download/load progress. Only meaningful for models the backend hosts itself. */
  aiModelStatus?(id: string): Promise<AiModelStatus>;
  aiTasks?(): Promise<AiTask[]>;
  removeAiTask?(id: string): Promise<void>;

  // ── Languages ───────────────────────────────────────────────────────────────
  languages?(): Promise<InstalledLanguage[]>;
  /** Install by content address. The backend fetches the bundle itself. */
  installLanguage?(address: string): Promise<void>;
  removeLanguage?(address: string): Promise<void>;

  // ── Trust ───────────────────────────────────────────────────────────────────
  trustedAgents?(): Promise<string[]>;
  trustAgent?(id: string): Promise<void>;
  untrustAgent?(id: string): Promise<void>;

  // ── Peer network ────────────────────────────────────────────────────────────
  /** A backend-formatted diagnostic blob. Opaque to the shell — displayed, never parsed. */
  networkMetrics?(): Promise<string>;
  /** Restart the peer-networking layer without restarting the app. */
  restartNetwork?(): Promise<void>;
  /** This node's peer-discovery records, for out-of-band exchange when discovery fails. */
  peerInfos?(): Promise<string[]>;
  addPeerInfos?(infos: string[]): Promise<void>;

  // ── External apps holding credentials ───────────────────────────────────────
  authorizedApps?(): Promise<AuthorizedApp[]>;
  /** Invalidate an app's token but keep the grant listed, so the user can see what was revoked. */
  revokeApp?(id: string): Promise<void>;
  /** Forget the grant entirely. */
  removeApp?(id: string): Promise<void>;

  // ── Consent ─────────────────────────────────────────────────────────────────
  /**
   * Subscribe to requests raised while the app runs. Returns an unsubscribe function.
   *
   * Without a subscriber these requests are simply never answered: on a host that bundles the
   * backend there is no launcher listening, so an embedded app asking for credentials waits until
   * it times out. That is the failure this member exists to prevent.
   */
  onConsentRequest?(handler: (request: ConsentRequest) => void): () => void;
  /** Grant a pending request. Returns a secret to relay back to the asker, when there is one. */
  approve?(request: ConsentRequest): Promise<string | void>;
  deny?(request: ConsentRequest): Promise<void>;
}
