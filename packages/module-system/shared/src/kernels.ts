/**
 * Kernels — the host capabilities a module asks for by name.
 *
 * ## Why a name, and not a field
 *
 * `ModuleStoreDeps` used to be a bag that grew a lobe every time a module needed something the host
 * had: presence for the call, a fourteen-member interpretation object for transcription, a private
 * `createPeerConnection` extension the call store added to the bag's type because there was nowhere
 * else to put it. Each was a real need met by a field, and by the third the bag described the shape
 * of two modules rather than a contract.
 *
 * A kernel is the same capability, declared. A module lists what it needs in
 * `manifest.requires.kernels`; the registry refuses it with a sentence if this host does not implement
 * one; the deps bag carries exactly the kernels it asked for under `deps.kernels`; and an install
 * screen can list them, since a kernel name is also a statement about what the module can reach. The
 * next capability with this shape is a file here, not a field there.
 *
 * ## Present is not the same as able
 *
 * Whether a host *implements* a kernel is known at boot and is what registration checks. Whether the
 * backend behind it can do the work — has a transcription model, has a language model — is known only
 * after the backend connects, so the kernels that depend on one carry an `available()` a module reads
 * at the moment it matters. A module must degrade rather than throw on a kernel that answers no.
 *
 * ## Every kernel is a neutral type
 *
 * Nothing here is a host store or a backend class. That is the line that keeps the bag from becoming a
 * back door: a module receiving a {@link RecordsKernel} can read and write records on any backend that
 * implements one, where a module receiving a store would be a host-coupled module wearing a neutral
 * type.
 */
import type { Activity, EphemeralPort, Peer, TranscriptionPort } from '@we/backend-shared';

import type { InterpretationKernel } from './interpretation';
import type { CreateEntityOptions, DatasetTarget } from './module';

/** Every kernel a host may implement, by the name a manifest asks for it under. */
export interface ModuleKernels {
  records: RecordsKernel;
  agentData: AgentDataKernel;
  presence: PresenceKernel;
  ephemeral: EphemeralPort;
  media: MediaKernel;
  peerConnection: PeerConnectionKernel;
  transcription: TranscriptionKernel;
  languageModel: LanguageModelKernel;
  interpretation: InterpretationKernel;
  secrets: SecretsKernel;
}

export type KernelName = keyof ModuleKernels;

/** The names, as a list, for a host to declare what it implements and a validator to check against. */
export const KERNEL_NAMES: readonly KernelName[] = [
  'records',
  'agentData',
  'presence',
  'ephemeral',
  'media',
  'peerConnection',
  'transcription',
  'languageModel',
  'interpretation',
  'secrets',
];

/**
 * The `where` / `order` / `limit` / `offset` / `include` a `$query` takes, and nothing a schema
 * cannot already ask. Kept to the renderer's vocabulary on purpose — see {@link RecordsKernel.find}.
 */
export interface RecordQuery {
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
}

/**
 * A composition — what `BlockComposer` hands its `onSave`, and what a post is written from.
 *
 * Opaque to a module on purpose. Its shape (blocks, marks, the base keys an edit reconciles against)
 * belongs to the block system and is changing — the content-layer work moves it to one document
 * with standoff marks — and a module that looked inside would break with it. A module carries one
 * from the composer to a kernel, or from one kernel to another, and that is all it needs to do.
 */
export type ComposedDocument = unknown;

/** What a written document is called afterwards. */
export interface WrittenDocument {
  /** The collection's id, in the dataset it was written to. */
  id: string;
  /**
   * The same record as a reference — `we:<datasetKey>/CollectionBlock/<id>` — for somewhere that is
   * not that dataset to hold. See `formatRef` in `@we/backend-shared`.
   */
  ref: string;
}

/**
 * Composed documents in one dataset: posts, notes, anything the composer writes.
 *
 * ## Why this is not `create` with a different entity
 *
 * A document is not a record. It is a collection, a record per block under it, a stored copy of the
 * whole composition for cheap rendering, its text for search, the mentions it makes, and its files —
 * uploaded to the dataset's own storage first, so every record and the stored copy agree about
 * every address. Only the host can write all of that in one transaction, and a module assembling it
 * from `create` calls would be a second, drifting copy of the block system's persistence.
 *
 * ## `read` resolves files, so a document can move
 *
 * A file inside a document is stored as an address in *that* dataset's file storage, which nobody
 * outside it can fetch. `read` hands back the payloads instead, so writing the result somewhere else
 * uploads them again there. That is what makes "share this note into a space" a copy that works
 * for everyone who opens it, rather than a post with broken pictures for everybody but its author.
 */
export interface DocumentAccess {
  /** Write a new document. `kind` defaults to `'post'`. `null` if there was nowhere to write it. */
  create: (document: ComposedDocument, options?: { kind?: string }) => Promise<WrittenDocument | null>;
  /**
   * Save an edit to one. Refused for a collection whose `mode` is not a single author's
   * (`document`) — reconciling a feed would delete every child the editor never loaded.
   */
  update: (id: string, document: ComposedDocument) => Promise<void>;
  /** Delete one and every block under it. Irreversible. */
  remove: (id: string) => Promise<void>;
  /** Read one back, file payloads resolved — ready to `create` somewhere else. `null` if it is not there. */
  read: (id: string) => Promise<ComposedDocument | null>;
}

/**
 * Records in the space — the write surface every module had, and the read surface none did.
 *
 * ## Why a module needs to read
 *
 * `createEntity` / `linkEntity` / `updateEntity` were the whole of a module's data surface, and it
 * was write-only by decision: a module that reads what it wrote could reach anything. The cost turned
 * out to be a whole family of modules that cannot exist. A processor "observes records and produces
 * records", and could not observe; a vote tally cannot count; a digest cannot gather. Their logic
 * ended up in a schema's `$query`, which is right for a panel and wrong for anything that has to run
 * with no panel open or be tested without a renderer.
 *
 * ## Bounded by what a template can ask
 *
 * `find` and `subscribe` take the same query a `$query` does — `where`, `order`, `limit`, `offset`,
 * `include` — and nothing the host's ORM happens to expose. A module can therefore read nothing a
 * template rendering the same space cannot already read, which is what makes widening the surface
 * safe. The restraint that kept `agentData` small still applies here.
 *
 * Every call takes a {@link DatasetTarget}. Absent means the space on screen; a named dataset the
 * host does not hold refuses rather than falling back, for the reason `DatasetTarget` gives.
 */
export interface RecordsKernel {
  /**
   * Write a record. The imperative twin of `record.create` — for data that arrives without a click.
   * Returns the new record's id, or `null` if there was nowhere to write it.
   */
  create: (entity: string, fields: Record<string, unknown>, options?: CreateEntityOptions) => Promise<string | null>;
  /**
   * Add one value to a to-many relation. Deliberately **add-one**, not update-the-array: appending by
   * writing the whole list back loses a concurrent writer's entry, and adding a single link is
   * conflict-free by construction.
   */
  link: (entity: string, id: string, relation: string, value: string, target?: DatasetTarget) => Promise<void>;
  /** Change the named scalar fields of a record, leaving the rest. Last-write-wins per field, as `record.update` is. */
  update: (entity: string, id: string, fields: Record<string, unknown>, target?: DatasetTarget) => Promise<void>;
  /** Delete one record. Irreversible. */
  remove: (entity: string, id: string, target?: DatasetTarget) => Promise<void>;
  /** Read records once. */
  find: (entity: string, query?: RecordQuery, target?: DatasetTarget) => Promise<Record<string, unknown>[]>;
  /**
   * Read records and keep reading. `cb` fires with the current rows and again whenever they change.
   * Returns the unsubscribe; a module must call it through `deps.onDispose` or when it no longer cares.
   *
   * This is the one trigger a module has — "records changed" — and it is what a processor watches.
   */
  subscribe: (
    entity: string,
    query: RecordQuery,
    cb: (rows: Record<string, unknown>[]) => void,
    target?: DatasetTarget,
  ) => () => void;
  /**
   * Hear about a post written into the space on screen from somewhere else — something dragged in
   * and copied or quoted. Returns the unsubscribe.
   *
   * The host does the writing, because every drop target does it the same way; a module that cares
   * where a thing went listens here rather than being named by the drop. The notes module is the
   * case: a note dragged into a space is shared as surely as one shared with its button, and only
   * the notes module knows to write that down.
   */
  onCopiedIn: (cb: (event: CopiedIn) => void) => () => void;
  /**
   * Composed documents in the space on screen — a post, written or read the way the composer's own
   * save writes one. Always the space on screen: a document is written because somebody composed
   * it here, and there is no module whose work outlives the view that also writes whole posts.
   */
  documents: DocumentAccess;
}

/** A post that arrived in a space from somewhere else. */
export interface CopiedIn {
  /** What it was made from — `we:<datasetKey>/CollectionBlock/<id>` for a post, or a block's post. */
  from: string;
  /** The new post. */
  to: string;
  /** A copy of the author's own thing, or a quote of somebody else's. */
  mode: 'copy' | 'quote';
  /** The space it arrived in, by name. */
  spaceName: string;
}

/**
 * This agent's **own** records, in their personal space — for a module that declared
 * `entities: { scope: 'agent' }`.
 *
 * Separate from {@link RecordsKernel} rather than a target on it, because the personal space holds
 * what a person made and kept, and a module that had it as one more dataset name could reach it by
 * accident — or write a space's record into it. Nothing here reaches a space. Absent where the host
 * has no agent dataset — a presentation-only host, or the frames before boot finishes; `ready()`
 * says.
 *
 * The personal space, not the root: the root is the app's configuration, and the host writes that
 * itself. What a module keeps for somebody is theirs, and belongs beside their notes.
 */
export interface AgentDataKernel {
  /** Whether the agent's dataset is reachable yet. False during boot. */
  ready: () => boolean;
  /**
   * How the personal space is named inside a reference (`p:<uuid>`), so a module can tell a
   * reference to one of its own records from anything else. Empty until `ready()`.
   */
  refKey: () => string;
  /** Create a record. Returns its id, or `null` if there was nowhere to write it. */
  create: (entity: string, fields: Record<string, unknown>, options?: CreateEntityOptions) => Promise<string | null>;
  /** Read records back. */
  find: (entity: string, query?: RecordQuery) => Promise<Record<string, unknown>[]>;
  /** Change the named fields of one record, leaving the rest. */
  update: (entity: string, id: string, fields: Record<string, unknown>) => Promise<void>;
  /** Delete one record. Irreversible, and only ever this agent's own. */
  remove: (entity: string, id: string) => Promise<void>;
  /**
   * Composed documents of this agent's own — a note is a post in the personal space. `ref` in what
   * `create` returns names the personal space, which means something only on this agent's machine:
   * fine to keep, never to hand to anybody else.
   */
  documents: DocumentAccess;
}

/**
 * The slice of presence a module may touch.
 *
 * Narrowed to activities on purpose. A module has a legitimate need to say "I am in this call" and to
 * read the roster; it has no business setting another agent's availability or driving the heartbeat.
 *
 * What a module publishes is checked, in development, against the shapes it declared in
 * `contributes.activities` — see `ActivityShape`. A shape nobody declared is how two modules come to
 * agree on a field by copying each other's guesses.
 */
export interface PresenceKernel {
  /** Peers in the current dataset, liveness-derived. */
  peers: () => Peer[];
  /** Publish an activity of this agent's own. */
  setActivity: (activity: Activity) => void;
  clearActivity: (type: string, id?: string) => void;
}

/**
 * Capturing and sharing media.
 *
 * `publish` / `input` replace what `audioSource` did by string key: the module that has a microphone
 * open says so, and a module that wants to hear it reads it, with neither naming the other. The
 * stream itself rather than a copy, so that muting the microphone mutes the transcript too.
 *
 * `getUserMedia` and `getDisplayMedia` are the browser's, forwarded, and are here so a module's use of
 * a camera goes through something the host can see and a manifest can declare (`permissions`). A
 * module may still reach `navigator` directly — code is code — but one that does has stepped outside
 * what its manifest says.
 */
export interface MediaKernel {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
  /** Say what this module is capturing, or `null` when it stops. One publisher at a time; a second replaces the first and says so. */
  publish: (stream: MediaStream | null) => void;
  /** What some module is capturing right now, or `null`. Reactive. */
  input: () => MediaStream | null;
}

/**
 * Peer connections, for a module that carries media or data between agents itself.
 *
 * The call store extended the deps bag privately for this — `CallStoreDeps extends ModuleStoreDeps`
 * with a `createPeerConnection` — which is the first sign a kernel was missing. Declared, it is
 * overridable in a test for the same reason it was there, and the second module wanting one does not
 * have to invent the same extension.
 */
export interface PeerConnectionKernel {
  create: (configuration?: RTCConfiguration) => RTCPeerConnection;
}

/**
 * Speech to text. The backend's port, plus the one question a module has to ask before offering
 * anything: `available()` answers for the backend actually connected, not for the wrapper existing.
 */
export type TranscriptionKernel = TranscriptionPort & { available: () => boolean };

/**
 * Text generation on the node's own language model.
 *
 * The port exists on the backend and was never handed to a module, so every module that wanted to
 * summarise, translate or tag had no path to a model. Deliberately minimal, as the port is: one system
 * prompt, one input, one text back. Conversation state and output schemas belong to the caller.
 */
export interface LanguageModelKernel {
  /** Whether this backend has a language model to prompt — what an AI affordance gates on. */
  available: () => Promise<boolean>;
  /** Send one prompt through the backend's default language model and return its text. */
  prompt: (system: string, input: string) => Promise<string>;
}

/**
 * Values a module needs and a template must never see.
 *
 * An integration holds an API key; a bridge holds a token. Declared as a setting of `type: 'secret'`
 * at the `agent` level, a screen renders it as a password field and stores it in the agent's own root
 * dataset — and it is *not* in `deps.settings()`, which reaches templates through the module's own
 * chrome. Read here instead, by key, and only here.
 */
export interface SecretsKernel {
  /** The agent's value for a secret setting of this module, or `undefined` when none is set. Reactive. */
  get: (key: string) => string | undefined;
}
