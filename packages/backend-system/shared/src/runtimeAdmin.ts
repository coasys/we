/**
 * Runtime administration — the settings that belong to the *backend process*, not to any dataset.
 *
 * Trust, peer networking, and which external apps hold credentials against this agent. These are
 * what a backend's own launcher owns; a host that bundles the backend process has no launcher to
 * open, so without this port those settings are unreachable rather than merely inconvenient.
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
 * a *host* launched the backend, not of the backend connection, and a port over a client
 * connection cannot honestly answer them.
 */

/**
 * Peer-discovery records, in the two forms they are needed in.
 *
 * `records` are exactly what the backend handed out, and exactly what `addPeerInfos` on another
 * node takes back. Opaque, and never to be re-serialized: each one may carry a signature over its
 * own bytes, so a record reformatted on the way through is a record the receiver rejects.
 *
 * `readable` is the same records decoded for a person — indented, with whatever the backend packs
 * inside them unpacked. Display only; nothing reads it back. Separate from `records` rather than
 * derived in the shell because only the backend knows what a record contains.
 */
export interface PeerRecords {
  records: string[];
  readable: string;
}

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
 * "Language" is the backend's word for the plugin that stores and retrieves a kind of content — what
 * makes an image URL resolvable, or a shared dataset's links syncable. They are addressed by content
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
  /** A remote endpoint, spoken to in the wire format `protocol` names. */
  | { kind: 'api'; protocol: AiApiProtocol; baseUrl: string; apiKey: string; model: string }
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
 * prompt-cache breakpoints and native tool calls among them.
 */
export type AiApiProtocol = 'openai' | 'anthropic';

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

export interface RuntimeAdminPort {
  // ── AI models ───────────────────────────────────────────────────────────────
  aiModels?(): Promise<AiModel[]>;
  /** Model names this backend can fetch on its own, for the kind asked about. */
  aiModelPresets?(kind: AiModelKind): Promise<string[]>;
  /**
   * The models a remote endpoint serves, asked of the endpoint itself. Rejects when it cannot be
   * reached or refuses the key, with the endpoint's own reason — which makes this the credential
   * check too. Omitted where the backend cannot ask.
   */
  discoverAiModels?(query: AiModelDiscoveryQuery): Promise<string[]>;
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

  // ── The whole store ─────────────────────────────────────────────────────────
  /**
   * Write everything this agent holds to a file on the backend's filesystem, and read it back.
   *
   * Paths, not bytes: the backend does the writing, so what it needs is somewhere to write. Getting
   * one is the host's job (see `ExecutorHost.chooseFile`), which is why these are only reachable
   * where the backend runs on the same machine as the app.
   */
  exportDatabase?(path: string): Promise<void>;
  importDatabase?(path: string): Promise<void>;

  // ── Trust ───────────────────────────────────────────────────────────────────
  trustedAgents?(): Promise<string[]>;
  trustAgent?(id: string): Promise<void>;
  untrustAgent?(id: string): Promise<void>;

  // ── Peer network ────────────────────────────────────────────────────────────
  /**
   * A backend-formatted diagnostic blob. Opaque to the shell — displayed, never parsed.
   *
   * Formatted means readable as it stands: indented, with anything only the backend can decode (a
   * hash that arrived as bytes) already decoded. The shell shows it in a JSON viewer, so JSON is
   * what reads best, but text that is not JSON is shown as it is.
   */
  networkMetrics?(): Promise<string>;
  /** Restart the peer-networking layer without restarting the app. */
  restartNetwork?(): Promise<void>;
  /** The peer-discovery records this node holds, for out-of-band exchange when discovery fails. */
  peerInfos?(): Promise<PeerRecords>;
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

  // ── What this backend turned out not to have ────────────────────────────────
  /**
   * Capabilities WE asked this backend for and it does not have.
   *
   * ## Why the shell is told at all
   *
   * An adapter degrades rather than failing where a backend predates a feature — a review list
   * without model names beats no review list — and until this existed it degraded *silently*, so
   * the symptom reached a person as a cosmetic bug with nothing anywhere connecting it to a stale
   * node. Somebody has to be able to find out; this is how they do.
   *
   * ## Why it reports names rather than consequences
   *
   * An adapter knows exactly what it asked for and refuses to guess at what breaks. What a caller
   * does with the answer differs — a settings page lists it, a diagnostic bundle attaches it — and
   * a sentence written for one of those would be wrong in the other. Names also survive: a new gap
   * appears here with no change to this contract, which is the whole point of reporting the
   * question rather than an interpretation of it.
   *
   * ## Synchronous, and why
   *
   * Every other member here is a round trip; this one is a local reading of what earlier round
   * trips already discovered. Returning a Promise would say a call goes out, which would be a lie
   * about both the cost and the meaning — there is nothing to ask, and nothing to fail.
   *
   * **An empty list is not a clean bill of health.** Nothing is recorded until something asks for
   * it, so this says "nothing has been refused yet", never "this backend is current". A caller
   * rendering it should say as much.
   */
  unsupported?(): UnsupportedCapability[];
  /**
   * Be told when {@link unsupported} gains an entry. Returns an unsubscribe function.
   *
   * Needed because a gap is discovered by whichever call needed it, which is never the surface that
   * shows them. Without it a settings page renders whatever was known when it mounted, and for the
   * first gap of a session that is an empty list — the one case somebody is looking for.
   */
  onUnsupported?(handler: () => void): () => void;
}

/**
 * One capability a backend turned out not to have.
 *
 * `name` is the backend's own word for it, unmodified — its RPC method name — so it can be
 * searched for in that backend's source and matched against its history. Translating it into
 * something friendlier would take away the only part that is actionable.
 */
export interface UnsupportedCapability {
  name: string;
  /**
   * When it was first refused, ISO 8601 — the same shape as every other timestamp in the contract,
   * so a caller can render it without knowing where it came from. When, not how often: a capability
   * gap does not heal, so a second refusal says nothing a first did not.
   */
  firstSeen: string;
}
