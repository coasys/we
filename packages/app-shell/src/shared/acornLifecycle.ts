/**
 * The Acorn project lifecycle — the sequence that turns a mounted Acorn language
 * into a WE space, as one framework-neutral unit the store wires into itself
 * (design §L.2–L.4).
 *
 * Everything here is an *open* sequence: `applyTemplateLocal` (create, or join
 * without an address) → perspective create → `mount` → the mount's foreign SDNA
 * visible → `initializeAsWeSpace` → `defaultTemplateId: 'acorn'` → the language's
 * `whoami`/`announceJoin` interactions. The order is the contract: mounting before
 * the language exists, or initializing before the mount's shapes landed, are the
 * ways this produces a space without a project — the offline test pins the order
 * against a recording port rather than hoping it holds.
 *
 * Every member degrades where the backend cannot mount: `port` absent means the
 * in-memory host the module registers on by contract, and a module `$invoke` that
 * reached one of these through a schema must no-op rather than throw — the same
 * rule every optional {@link AcornLifecyclePort} call site keeps.
 */
import type { AcornLifecyclePort, DatasetLifecyclePort, DatasetRef, SchemaPort } from '@we/backend-shared';
import { ACORN_VIEWS } from '@we/template-acorn';

/**
 * The Acorn base language bundle's address — its content hash, as the executor's
 * `language.publish`/`publishLocal` computes it (CIDv1 codec 0x00, sha2-256 of
 * the bundle).
 *
 * The hash names a build, not a thing: this is `acorn-ad4m` `language/build/bundle.js`
 * as built 2026-11-20 (production build of `b11-own-update-signal` head `f3200b4`:
 * `b10-snapshot-deadline` plus the own-update signal fix) — on the mount-aware zomes
 * the S2-0 instance-write path requires, with the 15 s snapshot deadline the mount
 * retry below is classified for. A rebuilt bundle is a new hash, so the constant
 * goes where the sequence that needs it lives rather than where a caller might
 * guess it — `createAcornProject` takes a `sourceLanguageHash` override for a host
 * holding a different build.
 */
export const ACORN_BASE_LANGUAGE = 'QmzSYwdjznoG7hYCeCENt1LRzssrvV6AqiED2dcSCYWFZ5Ncfhx';

/** The template an opened Acorn project renders through — the space's `defaultTemplateId`. */
export const ACORN_TEMPLATE_ID = 'acorn';

/**
 * The sections an Acorn space's nav carries, in order — the template package's own
 * catalogue, so first in the object is where a member lands: the outcomes list. Written
 * onto `Space.enabledViews` at open, because a space that names no sections falls back to
 * the deployment's bundled order — which puts `about` first, not Acorn.
 */
export const ACORN_SECTION_IDS = Object.keys(ACORN_VIEWS);

/**
 * The mount-recovery bounds: five attempts, backoffs 2·4·8·16 s, one 180 s
 * wall-clock budget for the whole phase — connects, RPC waits and sleeps all
 * count, and each wait clamps to what remains. Five B10 deadline failures cost
 * ~105 s; the bound is what keeps "the peer never answers" a bounded failure
 * instead of a call held open.
 */
const MOUNT_MAX_ATTEMPTS = 5;
const MOUNT_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000];
const MOUNT_BUDGET_MS = 180_000;

/**
 * The only failures a same-target retry answers — the fresh cell's first network
 * read stalling past either of the two clocks that time it out: Holochain's
 * 30 s init mutex, and the B10 language's 15 s snapshot deadline, which fires
 * first. Anything else the mount returns is a refusal or an unknown, and neither
 * is fixed by running the same call again on schedule.
 */
const MOUNT_INIT_FAILURES = ['CellError(InitTimeout)', 'acorn snapshot: reads missed the 15000 ms deadline'];

/** The mount slot is already held — an outcome to wait for, not an error to retry. */
const MOUNT_IN_FLIGHT = 'is already being mounted';

/**
 * One language's operation — the unit concurrent same-seed asks share and a
 * resume re-runs. The session's live half of the pending target; `setupIntent`'s
 * `phase`/`languageAddress` fields are the durable half a restart reads.
 */
interface PendingAcornOp {
  /** The resolved language — the operation's identity: same seed, same project. */
  lang: string;
  /** The name the meta write or space setup uses — the newest ask's, on resubmit. */
  name: string;
  /**
   * The owed work this ask adds — banked into the target's ledger the first time
   * the run retains it, then cleared on the op: the ledger, not the ask, is the
   * record a resume or a queued setup consults.
   */
  writeMeta: boolean;
  announce: boolean;
  /** The target once allocated or retained — the thing a failed mount cannot lose. */
  ref?: DatasetRef;
  /** The state last reported for this op — what `pendingAcornOperation` hands the chrome. */
  state?: AcornOperationState;
  /**
   * The run whose report `state` carries. A run standing down may park the state
   * only while it is still this one's: a resubmit reporting through the same op
   * owns the dialog's read now, and the old run's standdown must not overwrite it.
   */
  stateOwner?: number;
}

/** What `prepareAndMount` hands `openMounted`: the mounted target plus the name the newest ask gave it. */
interface PreparedMount {
  ref: DatasetRef;
  name: string;
}

/** One mounted Acorn project, as `listAcornProjects` reports it. */
export interface AcornProjectRef {
  /** The perspective's uuid — the dataset id everywhere else in the shell. */
  datasetId: string;
  /** The perspective's own name, not the project meta's. */
  name: string;
  /** The mounted Acorn language — its `info`/`whoami`/`class/*` interactions live under it. */
  languageAddress: string;
}

/**
 * Which of a target's space-setup invariants already hold — read, never assumed.
 * Each flag answers its own question because any one write can have failed before
 * the next: a Space record exists means neither that its root relation landed nor
 * that the section recipe and template writes after it did.
 */
export interface AcornSpaceSetup {
  /** A `Space` record for this dataset exists. */
  spaceRecord: boolean;
  /** The record's `root` relation — the space collection — exists. */
  root: boolean;
  /**
   * The section list was *decided* — the completion marker a finished setup leaves, or, for a
   * space set up before the marker existed, a list still holding an Acorn section. Membership
   * in the recipe is the fallback evidence, not the test: a members' list that removed every
   * Acorn section was still decided, and an open that cannot tell the difference rewrites it.
   */
  enabledViews: boolean;
  /** `Space.defaultTemplateId` names the Acorn template. */
  defaultTemplate: boolean;
  /**
   * The explicit end-of-setup marker — written by the lifecycle once the structure, recipe and
   * template writes all landed. What `enabledViews` reads before it trusts a member-edited list.
   */
  setupDone: boolean;
}

/**
 * Remote work this agent still owes a project — the writes the mounted language
 * cannot answer "done?" for, so the ask itself is the record. Retained across
 * calls (and restarts, where the host persists it): a create that died before its
 * meta write, or a join before its announce, is resumed by the next open rather
 * than skipped or duplicated.
 */
export interface AcornSetupIntent {
  /** The project's name — the meta write needs it when it was never made. */
  name: string;
  /** The `AcornProjectMeta` create has not landed. */
  writeMeta: boolean;
  /** The join's `announceJoin` has not landed. */
  announce: boolean;
  /**
   * The language this intent's target mounts, written *before* the mount attempt:
   * a failed mount leaves no link a mounts scan could find the project by, so the
   * address in the intent is the only record of which mount was owed. Absent on
   * intents written before it was recorded — reads treat that as unknown.
   */
  languageAddress?: string;
  /**
   * Where the operation stood when the intent was written: `mount` while the
   * mount itself was still unacknowledged — the mark a failed mount leaves —
   * `open` once the mount answered and only the owed setup tail remained.
   */
  phase?: 'mount' | 'open';
}

/** Where a lifecycle operation stopped — the stage a resume picks up at. */
export type AcornLifecycleStage = 'prepare' | 'mount' | 'setup';

/** The mount a failed operation retained — the target an explicit Retry resumes. */
export interface AcornRetryTarget {
  datasetId: string;
  languageAddress: string;
}

/**
 * A lifecycle call's failure, typed — the one boundary where the executor's
 * error strings are read. `stage` says where the run stopped; `cause` carries
 * the underlying error untouched. `retryTarget` is the mount the run kept and
 * an explicit Retry can resume: set when the answer was the known fresh-cell
 * stall past the budget, an in-flight mount it could not outwait, or a
 * transport that went quiet with the outcome unknown — and null for a refusal
 * the executor actually answered, which a same-target Retry would only read
 * a second time.
 */
export class AcornLifecycleError extends Error {
  readonly stage: AcornLifecycleStage;
  readonly retryTarget: AcornRetryTarget | null;
  // Assigned in the constructor, not through `ErrorOptions` — the ES2022
  // overload is not in every lib this file is typechecked under.
  readonly cause: unknown;

  constructor(init: { stage: AcornLifecycleStage; retryTarget: AcornRetryTarget | null; cause: unknown }) {
    super(init.cause instanceof Error ? init.cause.message : String(init.cause));
    this.name = 'AcornLifecycleError';
    this.stage = init.stage;
    this.retryTarget = init.retryTarget;
    this.cause = init.cause;
  }
}

/** The phases the projects dialog watches — the operation's own telling of where it is. */
export type AcornOperationPhase = 'preparing' | 'mounting' | 'setting-up' | 'failed';

/** Where the in-flight or retained Acorn operation stands. */
export interface AcornOperationState {
  phase: AcornOperationPhase;
  /** The name the operation's meta write or space setup would give the project. */
  name: string;
  datasetId?: string;
  languageAddress?: string;
  /** The mount attempt in flight, while `phase` is `mounting`. */
  attempt?: number;
  /**
   * Present only in `failed`: where it stopped, why, and whether a Retry resumes
   * it. `cause` is the diagnostic — the executor's own text, kept for the details
   * line and the log; `display` is the plain sentence the card leads with — a
   * classified, bounded message that never carries wire text (or anything a
   * wire text could smuggle, like a passphrase-derived seed).
   */
  failure?: { stage: AcornLifecycleStage; cause: string; display: string; retryable: boolean };
}

/** What the lifecycle needs from the app around it — the same shape `BoardDeps` takes. */
export interface AcornLifecycleDeps {
  /**
   * The backend's mount/template/interact port — {@link BackendPorts.acornLifecycle}.
   * Absent on a backend that cannot mount (the in-memory host), and every member
   * degrades rather than being refused: the module registers on both. An accessor,
   * like the rest: the session's ports appear on connect, after the store is built.
   */
  port: () => AcornLifecyclePort | undefined;
  /** Dataset lifecycle — the perspective create/list half of the sequence. */
  lifecycle: () => DatasetLifecyclePort | null;
  /** The mount's shapes arriving is the "dataset appears" of §L.4 — read through the schema port. */
  schemas: () => SchemaPort | null;
  /**
   * Which of the target's space-setup invariants already hold — {@link AcornSpaceSetup}.
   * Reopen is repair, not a skip-list: "a Space record exists" never meant "the setup
   * finished", and checking each piece on its own is what lets an open finish the one
   * write that failed without re-writing the ones that did not. Throws when the read
   * cannot be made — the sequence treats that as "unknown" and repairs structurally.
   */
  spaceSetup: (target: DatasetRef) => Promise<AcornSpaceSetup>;
  /**
   * The current dataset's id *now* — read when an open starts and once more before
   * it lands: if the answer moved, somebody navigated while the open ran, and the
   * open does not get the last word on where the person stands. Setup itself never
   * consults this — its writes name their target.
   */
  currentDatasetId: () => string | undefined;
  /**
   * Land on the space, last — after the mount, the init and the template write, so the
   * route effect never sees the dataset half-built and a list row's "open" is one call.
   * It re-switches only when the dataset changed, so calling it on the current one is free.
   *
   * `stillWanted` is the open's ownership, carried through the navigation's own awaits:
   * between the caller's check and the landing there are still round trips (template
   * preload, the dataset switch), and a selection that moved during them is not this
   * open's to take back. It is asked again after each — and inside the switch itself.
   */
  navigateToSpace: (id: string, stillWanted: () => boolean) => Promise<void>;
  /**
   * Finish the structural setup on `target` — WE's space schemas, the Space record,
   * its root collection and starter structure — writing only what is absent: a
   * target whose record exists keeps it (no second Space), one whose root never
   * landed gets the structure, one with neither gets both. On the dataset named,
   * never on whatever is current: the open that asked may be superseded while any
   * of it is in flight, and setup's writes belong to the project that was opened.
   */
  ensureSpaceStructure: (name: string, description: string, target: DatasetRef) => Promise<void>;
  /**
   * The remote setup work this agent still owes `id`, or null when nothing is owed —
   * the durable form of "this create's meta" / "this join's announce" for opens that
   * run after the ask that produced them. Set at mount time, cleared as the owed
   * writes land. Optional: without it, owed remote work is still done in the run
   * that asked for it, but cannot be resumed by a later open.
   */
  setupIntent?: {
    get: (id: string) => AcornSetupIntent | null;
    set: (id: string, intent: AcornSetupIntent) => void;
    clear: (id: string) => void;
  };
  /** The space's default template — written after init, per Q7. */
  setSpaceDefaultTemplate: (templateId: string, spaceUuid?: string) => Promise<void>;
  /**
   * The end-of-setup marker, recorded on the space record once the structure, section and
   * template writes all landed. It is what lets a later open tell "the recipe was written
   * and members edited it since" from "setup never finished" — a distinction membership in
   * today's recipe cannot make, since a community may remove every Acorn section.
   */
  markSpaceSetupDone: (spaceUuid: string) => Promise<void>;
  /**
   * The space's section list — `Space.enabledViews`. Written beside the template for the
   * same reason: without it a fresh Acorn space inherits the deployment's default sections
   * (about/cards/…) instead of its own, and the outcomes list is not where a member lands.
   */
  setSpaceViews: (viewIds: string[], spaceUuid?: string) => Promise<void>;
  /**
   * This agent's per-space template — `SpacePreference.templateId`. Needed beside the
   * community default: an app whose bundle says "every space ours" (the Coasys app's
   * `spaces: 'ours'` → `coasys--space`) outranks `Space.defaultTemplateId` for a member who
   * follows the space, so the record alone never shows Acorn. The per-space override is
   * the one thing that beats the app's policy, and it is what the same UI writes.
   */
  setSpaceTemplateOverride: (templateId: string, spaceUuid?: string) => Promise<void>;
  /**
   * Whether this build can render an Acorn space — the `acorn` template compiled in.
   * `defaultTemplateId: 'acorn'` is the write every mutating member ends in; a deployment
   * whose seed left the template out resolves it to nothing, so a member must not be
   * callable there at all — an offer that cannot draw its result is worse than none.
   */
  hasAcornTemplate: () => boolean;
  /** The agent's display name, for the Acorn member profile the first open creates. */
  agentName?: () => string | undefined;
  /**
   * Where the current operation stands, as it moves — the projects dialog's
   * progress and resumable-failure read. Called with `null` when nothing is
   * running or retained. Ownership-guarded inside: only the newest ask's
   * reports surface; a superseded run parks its state without surfacing it.
   */
  progress?: (state: AcornOperationState | null) => void;
  /** Poll cadence and bound for the two waits (shapes landing, the cell answering). */
  pollMs?: number;
  timeoutMs?: number;
  /**
   * The wall-clock bound for one mount-recovery phase — connects, RPC waits and
   * backoff sleeps all count. Language install and the setup tail keep their own
   * bounds; this is the mount's alone.
   */
  mountBudgetMs?: number;
}

/**
 * Acorn's project uid — the language template seed — from a passphrase, exactly
 * `acorn-ad4m-ui/web/src/secrets.ts`'s `passphraseToUid`. The seed is the join
 * secret: the language derives the project meta's passphrase from it
 * (`mapping.ts` `seedToPassphrase`), so the convention is load-bearing, not
 * cosmetic.
 */
export function acornSeed(passphrase: string): string {
  return `uid-${passphrase.split(' ').join('-')}`;
}

/**
 * The seed-bearing boundary: `applyTemplateLocal` is the one call whose error
 * could echo `templateData` — and `seed` is the passphrase it was derived from.
 * A message that carries it back out is redacted before it can reach a state, a
 * details line or a log; one that does not passes through untouched.
 */
const redactSeed = (error: unknown, seed: string): unknown => {
  if (!(error instanceof Error) || !error.message.includes(seed)) return error;
  return new Error(error.message.split(seed).join('…'));
};

/** The outcome `withinBudget` hands back when the phase's own clock, not the call, answered first. */
const BUDGET_OUT = Symbol('acorn-budget-out');

/**
 * `work` given only what is left of the phase deadline. The deadline winning is
 * not a failure of the call: its late answer is the server's to keep — a mount
 * that lands afterward is still landed — and the next explicit Retry's mounts
 * read is what reconciles it, never the run that stopped waiting.
 */
function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | typeof BUDGET_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = new Promise<typeof BUDGET_OUT>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_OUT), Math.max(0, ms));
  });
  return Promise.race([work, out]).finally(() => clearTimeout(timer));
}

/**
 * Poll `read` until it answers truthy — an rpc that throws counts as "not yet".
 * `owns` is the caller's ownership: once it is gone the loop asks nothing more
 * and answers null, the same as running out of time.
 */
async function waitFor<T>(
  read: () => Promise<T>,
  timeoutMs: number,
  pollMs: number,
  owns: () => boolean = () => true,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => null);
    if (!owns()) return null;
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((done) => setTimeout(done, pollMs));
    if (!owns()) return null;
  }
}

/**
 * `call` retried while it throws — the mounted cell can still be coming up — but
 * a resolved value, `null` included, is the language's answer, not "not yet": a
 * `whoami` that resolves null means the member profile does not exist.
 */
async function answering<T>(
  call: () => Promise<T>,
  timeoutMs: number,
  pollMs: number,
  owns: () => boolean = () => true,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await call();
    } catch {
      if (!owns() || Date.now() >= deadline) return null;
      await new Promise((done) => setTimeout(done, pollMs));
      if (!owns()) return null;
    }
  }
}

export function createAcornLifecycle(deps: AcornLifecycleDeps) {
  const pollMs = deps.pollMs ?? 2_000;
  // A mount's cell install + first sync routinely takes a minute on a cold rig;
  // the waits below bound themselves rather than trusting mount() to have meant "done".
  const timeoutMs = deps.timeoutMs ?? 180_000;
  const mountBudgetMs = deps.mountBudgetMs ?? MOUNT_BUDGET_MS;

  /** The port's `interact` — every member guards on the port before reaching this. */
  const interact = (url: string, name: string, parameters?: object) => deps.port()!.interact(url, { name, parameters });

  /**
   * What a mount's `info` call answers — the same interaction `whoami` and the class
   * writes already lean on. An Acorn project cell answers with `dnaHash`; a language
   * that answers anything else, or throws, is not one of ours. `null` is a definitive
   * answer; the throw is left for the caller to catch or retry through.
   */
  const acornInfo = async (lang: string): Promise<Record<string, unknown> | null> => {
    const raw = await interact(`${lang}://project`, 'info');
    const info = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : raw;
    return info && typeof info === 'object' && (info as Record<string, unknown>).dnaHash
      ? (info as Record<string, unknown>)
      : null;
  };

  /**
   * Whether a mounted language is an Acorn project — asked, never assumed. A mount is
   * just a language address on a dataset, and before this check every mounted language
   * listed as a project and "open" would have written a project meta into somebody
   * else's language. A mount that cannot answer is not ours; the single shot is honest
   * for a list row, and `answering` wraps it where a cold cell needs the beat.
   */
  const isAcornLanguage = (lang: string): Promise<boolean> =>
    acornInfo(lang)
      .then(Boolean)
      .catch(() => false);

  /** The first mount that answers as an Acorn project, or null when none does. */
  const firstAcornMount = async (mounted: string[]): Promise<string | null> => {
    for (const lang of mounted) {
      if (await isAcornLanguage(lang)) return lang;
    }
    return null;
  };

  /**
   * The Acorn mount among `mounted` for an Open — strict where the list row is
   * forgiving: a mount whose `info` rejects has not answered, which is not the
   * same as answering "not Acorn". An Acorn answer anywhere still wins; with
   * none, a rejection is rethrown rather than read as "nothing to open".
   */
  const acornMountOf = async (mounted: string[]): Promise<string | null> => {
    let unanswered: { error: unknown } | null = null;
    for (const lang of mounted) {
      try {
        if (await acornInfo(lang)) return lang;
      } catch (error) {
        unanswered ??= { error };
      }
    }
    if (unanswered) throw unanswered.error;
    return null;
  };

  /**
   * Identify this agent to the project: `whoami` first (the mount answers null
   * until the member profile exists), the profile `create` when it does not.
   * The AcornProfile fields are the zome's `create_whoami` shape — the agent's
   * WE display name mapped onto them, since Acorn splits a name WE keeps whole.
   * A run that lost ownership while `whoami` was out writes no profile: its null
   * answer is the newer owner's to act on, not this one's.
   */
  const ensureProfile = async (lang: string, owns: () => boolean): Promise<void> => {
    const who = (await answering(() => interact(`${lang}://project`, 'whoami'), timeoutMs, pollMs, owns)) as {
      address?: string;
    } | null;
    if (!owns() || who?.address) return;
    const name = deps.agentName?.() ?? 'Acorn member';
    await interact(`${lang}://class/AcornProfile`, 'create', {
      firstName: name,
      lastName: '',
      handle: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      status: 'Online',
      avatarUrl: '',
    });
  };

  /*
    The newest ask owns the whole operation, from the moment it is made — not
    from when its language answer or its place in a queue arrives. A Close or a
    newer ask invalidates every await still out for the old one: calls already
    issued settle (a landed write still pays its debt), but nothing further is
    issued, and the landing belongs to whoever asked last.
  */
  let openGeneration = 0;

  /*
    Setup for one target is serialized: two opens of the same project must not
    each read "no Space record" and write it twice. Queued work runs whether or
    not the run before it succeeded — a failed open does not bar the repair its
    successor owes.
  */
  const setupQueues = new Map<string, Promise<void>>();
  const serializeSetup = (id: string, work: () => Promise<void>): Promise<void> => {
    const run = (setupQueues.get(id) ?? Promise.resolve()).then(work, work);
    setupQueues.set(id, run);
    const settle = () => {
      if (setupQueues.get(id) === run) setupQueues.delete(id);
    };
    void run.then(settle, settle);
    return run;
  };

  /*
    Mount attempts are serialized per language, the way setup is per dataset: a
    create and a join sharing one seed — one language — queue rather than each
    minting a dataset and racing the same mount slot. Queued work runs whether
    the run ahead of it landed or failed.
  */
  const mountQueues = new Map<string, Promise<unknown>>();
  const serializeMount = <T>(lang: string, work: () => Promise<T>): Promise<T> => {
    const run = (mountQueues.get(lang) ?? Promise.resolve()).then(work, work);
    mountQueues.set(lang, run);
    const settle = () => {
      if (mountQueues.get(lang) === run) mountQueues.delete(lang);
    };
    void run.then(settle, settle);
    return run;
  };

  /*
    The session's operation ledger, keyed by resolved language: one op per
    project being created or joined. The pending *target* an entry retains is
    the record a failed mount needs — that mount writes no link, so neither a
    mounts scan nor a second create could find the dataset again. The durable
    half is `setupIntent`'s `phase`/`languageAddress`; this map is the live
    half: concurrent same-language asks share the entry, and the parked state
    is what `pendingAcornOperation` reports across a modal close.
  */
  const pendingOps = new Map<string, PendingAcornOp>();

  /*
    The owed-work ledger, keyed by target — the authoritative "still owed"
    record the resume path and a queued setup both consult. `setupIntent` is
    its durable shadow (and the only place the mount-phase target survives a
    restart); this is the live half: a write clears its bit the moment it
    lands, so a Retry — or a setup queued behind one that already paid — reads
    the debt as it stands, never as its ask was filed. With no `setupIntent`
    dep it is the only record.
  */
  const owedLedger = new Map<string, { name: string; writeMeta: boolean; announce: boolean }>();

  /*
    Open failures from before an operation exists — the dataset, its mounts or
    the language's `info` could not be read, so there is no language to key an
    op by. Keyed by dataset instead, parked the way a tail failure is, and
    resumed by running the Open again. A preflight that gets through clears its
    entry: from there on the op is the record.
  */
  const preflightFailures = new Map<string, AcornOperationState>();

  /** The debt a target still owes — the live ledger's answer, the durable intent's when the session has none. */
  const owedFor = (refId: string): { name: string; writeMeta: boolean; announce: boolean } | null => {
    const live = owedLedger.get(refId);
    if (live) return live;
    const intent = deps.setupIntent?.get(refId);
    if (!intent || (!intent.writeMeta && !intent.announce)) return null;
    return { name: intent.name, writeMeta: intent.writeMeta, announce: intent.announce };
  };

  /** One bit of debt paid — cleared from the live ledger and its durable shadow alike. */
  const markPaid = (refId: string, bit: 'writeMeta' | 'announce'): void => {
    const live = owedLedger.get(refId);
    if (live) {
      if (live[bit]) live[bit] = false;
      if (!live.writeMeta && !live.announce) owedLedger.delete(refId);
    }
    const current = deps.setupIntent?.get(refId);
    if (!current) return;
    const next = { ...current, [bit]: false };
    if (!next.writeMeta && !next.announce) deps.setupIntent!.clear(refId);
    else deps.setupIntent!.set(refId, next);
  };

  /**
   * What one mount call's rejection means for the budget that called it:
   *
   * - `init` — the fresh-cell signature, retried on the same target: a stalled
   *   first network read outliving Holochain's 30 s init mutex
   *   (`CellError(InitTimeout)`) or the B10 language's own 15 s snapshot deadline
   *   (`… missed the 15000 ms deadline`). Transient by construction.
   * - `busy` — the executor is mid-mount on this slot already: the same outcome
   *   this ask wants, so the budget waits and rechecks rather than starting a
   *   second mount beside it or unmounting to "clear" it.
   * - `unknown` — our own transport stopped listening (`heard nothing`, a closed
   *   socket, an unreachable executor): the call may still have landed. The
   *   automatic loop stops; the retained target is what an explicit Retry
   *   re-checks before mounting again.
   * - `permanent` — a refusal the executor answered: a bad address, an owned
   *   schema mirror, an authorization. Retried on the same target it would
   *   only read a second time, so it parks unretryable.
   */
  const mountFailureKind = (error: unknown): 'init' | 'busy' | 'unknown' | 'permanent' => {
    const text = error instanceof Error ? error.message : String(error);
    if (MOUNT_INIT_FAILURES.some((signature) => text.includes(signature))) return 'init';
    if (text.includes(MOUNT_IN_FLIGHT)) return 'busy';
    // The phase's own clock ran out — nothing answered, so nothing was refused.
    if (/did not answer inside the \d+(\.\d+)? s budget/.test(text)) return 'unknown';
    if (/heard nothing|timed?\s*out|socket|connect|unreachable|handed no url/i.test(text)) return 'unknown';
    return 'permanent';
  };

  /**
   * The plain sentence a failure card leads with — classified the same way the
   * retry decision is, never the executor's own words. The wire text stays in
   * `cause` for the details line and the log; what the card says out loud is
   * bounded, and can never echo something the backend put in a message.
   */
  const displayForFailure = (stage: AcornLifecycleStage, cause: string): string => {
    if (!cause) return 'It was closed before it finished.';
    if (MOUNT_INIT_FAILURES.some((signature) => cause.includes(signature))) {
      return 'The project’s cell did not start on the executor in time.';
    }
    if (cause.includes(MOUNT_IN_FLIGHT) || /did not answer inside the \d+(\.\d+)? s budget/.test(cause)) {
      return 'The mount did not finish inside its time budget.';
    }
    if (/heard nothing|timed?\s*out|socket|connect|unreachable|handed no url/i.test(cause)) {
      return 'The executor stopped answering partway through.';
    }
    if (stage === 'mount') return 'The executor refused the mount.';
    if (stage === 'setup') return 'The space’s setup could not finish.';
    return 'The project could not be prepared.';
  };

  /** One failure record — stage and raw cause for the details, the classified display for the card. */
  const makeFailure = (stage: AcornLifecycleStage, cause: string, retryable: boolean) => ({
    stage,
    cause,
    display: displayForFailure(stage, cause),
    retryable,
  });

  /**
   * Whether `ref` already mounts `lang` — the one read an explicit Retry does
   * first. A read that cannot answer is not "not mounted": it is the same
   * unknown the transport gave up on, and it stays retryable rather than being
   * taken as licence to mount again beside an answer already there.
   */
  const mountsInclude = async (refId: string, lang: string): Promise<boolean> => {
    const mounted = await deps
      .port()!
      .mounts(refId)
      .catch((error: unknown) => {
        throw new AcornLifecycleError({
          stage: 'mount',
          retryTarget: { datasetId: refId, languageAddress: lang },
          cause: error,
        });
      });
    return mounted.includes(lang);
  };

  /**
   * Write the pending-operation record for `ref` — the intent the next resume
   * reads to recover the target a failed mount leaves no link to. `phase` is
   * where the operation stood: `mount` until the mount is acknowledged, `open`
   * once only the owed setup tail remains.
   */
  const retain = (
    refId: string,
    lang: string,
    owed: { name: string; writeMeta: boolean; announce: boolean },
    phase: 'mount' | 'open',
  ): void => {
    /*
      A mounted target with nothing owed has no record to keep — the mount link
      itself says where the language lives, and an intent carrying no debt would
      only read as a pending mount it is not. The live ledger and the durable
      intent move together: whatever one records, the other records.
    */
    if (owed.writeMeta || owed.announce) {
      owedLedger.set(refId, { name: owed.name, writeMeta: owed.writeMeta, announce: owed.announce });
    } else {
      owedLedger.delete(refId);
    }
    if (phase === 'open' && !owed.writeMeta && !owed.announce) {
      deps.setupIntent?.clear(refId);
      return;
    }
    deps.setupIntent?.set(refId, {
      name: owed.name,
      writeMeta: owed.writeMeta,
      announce: owed.announce,
      languageAddress: lang,
      phase,
    });
  };

  /**
   * The dataset this language's operation should mount — in order:
   * the pending target an earlier attempt retained (a failed mount leaves no
   * link, so only the intent knows it), then the dataset already mounting the
   * language (a mount that landed, late or old), else null to allocate one.
   * `mounted` says which answered: a pending target still owes a mounts read
   * before anything calls mount again; an Active mount is reused as it stands.
   * A run that lost ownership stops reading and answers null — the caller asks
   * `owns` again before it takes that null as licence to allocate.
   */
  const targetFor = async (
    lang: string,
    owns: () => boolean,
  ): Promise<{ ref: DatasetRef; mounted: boolean } | null> => {
    const port = deps.port();
    const lifecycle = deps.lifecycle();
    if (!port || !lifecycle) return null;
    const refs = await lifecycle.list();
    if (!owns()) return null;
    if (deps.setupIntent) {
      for (const ref of refs) {
        const intent = deps.setupIntent.get(ref.id);
        if (intent?.phase === 'mount' && intent.languageAddress === lang) return { ref, mounted: false };
      }
    }
    for (const ref of refs) {
      /*
        A mounts read that cannot answer is not "not mounted": swallowed, it
        would resume nothing and let the retry mint a second dataset over the
        mount already there. Discovery failure fails the lookup — the caller
        retries when the executor answers again.
      */
      const mounted = await port.mounts(ref.id);
      if (!owns()) return null;
      if (mounted.includes(lang)) return { ref, mounted: true };
    }
    return null;
  };

  /**
   * Mount `lang` on `ref` before `deadline`, bounded: the fresh-cell stall is
   * retried while attempts and the wall-clock budget remain; an in-flight
   * mount on the slot is waited out inside the same budget; a transport that
   * stopped listening or a refusal the executor answered stops the loop here —
   * each with its target classification attached. Every wait — the mount call,
   * the mounts re-check, the sleeps — is given only what is left of the
   * deadline, so a call still out at expiry abandons its answer rather than
   * proceeding on it. Returns false only when the run lost ownership
   * mid-flight: the caller stands down silently and the retained target stays
   * for whoever asks next.
   */
  const mountSameTarget = async (
    ref: DatasetRef,
    lang: string,
    deadline: number,
    run: { owns: () => boolean; report: (attempt: number) => void },
  ): Promise<boolean> => {
    const port = deps.port()!;
    const retryTarget = { datasetId: ref.id, languageAddress: lang };
    const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MOUNT_MAX_ATTEMPTS; attempt += 1) {
      const remaining = deadline - Date.now();
      if (!run.owns() || remaining <= 0) break;
      run.report(attempt);
      try {
        const answer = await withinBudget(port.mount(ref.id, lang), remaining);
        // The clock answered first — stop waiting; the server's mount may still
        // land, and the explicit Retry's mounts read is what reconciles it.
        if (answer === BUDGET_OUT) break;
        // A newer ask owns it now: this late answer is stale, not a success to proceed on.
        if (!run.owns()) return false;
        return true;
      } catch (error) {
        lastError = error;
        const kind = mountFailureKind(error);
        if (kind === 'permanent') throw new AcornLifecycleError({ stage: 'mount', retryTarget: null, cause: error });
        if (kind === 'unknown') throw new AcornLifecycleError({ stage: 'mount', retryTarget, cause: error });
        if (kind === 'busy') {
          // The slot is held by a mount already in flight — the same outcome this
          // ask wants. Wait it out inside the budget rather than starting a
          // second mount beside it or unmounting to clear it — and bound each
          // re-check too: a read that never answers cannot outwait the clock.
          while (run.owns() && Date.now() < deadline) {
            const read = await withinBudget(mountsInclude(ref.id, lang), deadline - Date.now());
            if (read === BUDGET_OUT) break;
            if (read === true) return run.owns();
            await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
          }
          break;
        }
        // `init` — the known fresh-cell stall: retry the same target while the
        // attempt count and the budget both remain, each wait clamped to what is left.
        const left = deadline - Date.now();
        if (attempt < MOUNT_MAX_ATTEMPTS && left > 0) {
          await sleep(Math.min(MOUNT_BACKOFF_MS[attempt - 1] ?? 0, left));
        }
      }
    }
    if (!run.owns()) return false;
    // Attempts or budget spent: a bounded failure, parked with the target an
    // explicit Retry resumes — never a claim that the peer answered.
    throw new AcornLifecycleError({
      stage: 'mount',
      retryTarget,
      cause: lastError ?? new Error(`the mount did not answer inside the ${mountBudgetMs / 1000} s budget`),
    });
  };

  /**
   * The shared first half of create/join/resume: resolve the target — the
   * retained one, an already-mounted dataset, or a new allocation — retain it
   * *before* the first mount call, then mount it with the bounded helper. A
   * mount that landed late or was already Active is reused, never duplicated.
   * Returns null only when the run stood down mid-flight.
   */
  const prepareAndMount = async (
    op: PendingAcornOp,
    owns: () => boolean,
    report: (attempt: number) => void,
  ): Promise<PreparedMount | null> => {
    /*
      One clock for the whole mount phase — target discovery, the mounts
      re-check, every attempt and every wait all draw from it, so nothing the
      phase awaits can outlive the budget that bounds it.
    */
    const deadline = Date.now() + mountBudgetMs;
    /*
      Discovery and allocation spend the same budget as the mount: a series of
      mounts reads that outlives it is the phase timing out, and a target they
      find afterwards is not proceeded on — the next explicit Retry finds it.
    */
    const budgetSpent = () =>
      new AcornLifecycleError({
        stage: 'mount',
        retryTarget: null,
        cause: new Error(`the mount phase did not answer inside the ${mountBudgetMs / 1000} s budget`),
      });
    const found = op.ref
      ? { ref: op.ref, mounted: false }
      : await withinBudget(targetFor(op.lang, owns), deadline - Date.now());
    if (found === BUDGET_OUT) throw budgetSpent();
    // A Close or a newer ask during discovery: its "nothing found" allocates nothing.
    if (!owns()) return null;
    let ref = found?.ref;
    if (!ref) {
      const allocation = deps.lifecycle()!.create(op.name);
      const allocated = await withinBudget(allocation, deadline - Date.now());
      if (allocated === BUDGET_OUT) {
        /*
          The perspective may still arrive. It is this operation's target when
          it does, so the Retry mounts it rather than allocating a second beside
          it — unless a newer run already settled on one of its own.
        */
        void allocation.then(
          (late) => {
            op.ref ??= late;
          },
          () => {},
        );
        throw budgetSpent();
      }
      ref = allocated;
      /*
        Stood down while the perspective was being made: it is kept as the
        operation's target — the Retry mounts it rather than making another —
        and nothing is issued on it from this run.
      */
      if (!owns()) {
        op.ref ??= ref;
        return null;
      }
    }
    op.ref = ref;
    /*
      The record's owed work beats this ask's: a resume inherits the debt the
      interrupted run left. And the intent is written *before* the mount is
      attempted — a failed mount is exactly when the record matters, since it
      is the only place the target survives.
    */
    const current = owedFor(ref.id);
    /*
      The name is this ask's — a resubmit's newer name wins, and an op rebuilt
      from the intent already carries the intent's. The debt merges the other
      way: what an interrupted run still owes is owed whoever asks next. This
      ask's own flags are banked here — the ledger owns them from now on, so a
      write that lands cannot come back as this ask's debt on a later retry.
    */
    const owed = {
      name: op.name,
      writeMeta: Boolean(current?.writeMeta) || op.writeMeta,
      announce: Boolean(current?.announce) || op.announce,
    };
    op.writeMeta = false;
    op.announce = false;
    retain(ref.id, op.lang, owed, 'mount');
    /*
      The retained target's mount check draws from the same clock — a read that
      outlives it is not "unmounted", it is budget spent, and the mount phase's
      own failure path answers for it.
    */
    const mounted = found
      ? found.mounted || (await withinBudget(mountsInclude(ref.id, op.lang), deadline - Date.now())) === true
      : false;
    if (!mounted && !(await mountSameTarget(ref, op.lang, deadline, { owns, report }))) return null;
    if (!owns()) return null;
    /*
      The phase moves on the debt as it stands, not as it stood when this run
      banked its ask: the mounts read and the mount loop both ran under it, and
      a previous run's write landing inside that window already paid through
      the ledger. Re-read rather than restore the pre-await snapshot — a stale
      restore re-owes an acknowledged write, and the queued setup pays it twice.
    */
    retain(ref.id, op.lang, owedFor(ref.id) ?? { name: owed.name, writeMeta: false, announce: false }, 'open');
    return { ref, name: owed.name };
  };

  /**
   * One ask's run over `op` — preparing → mount → setting-up, or `failed` with
   * the target retained. The newest ask owns the reports *and* the mount loop's
   * lease: a superseded or dismissed run parks its state without surfacing it
   * and hands its promise back through `null` — stood down, not failed.
   */
  const runLifecycle = async (
    op: PendingAcornOp,
    nav: { generation: number; selection: string | undefined },
  ): Promise<string | null> => {
    const runId = nav.generation;
    const owns = () => runId === openGeneration;
    pendingOps.set(op.lang, op);
    /*
      Only the newest ask writes `op.state`: a run superseded on its own op —
      or dismissed — leaves the state alone, because the newer run's reports or
      the dismiss's parked failure are the truth now, and a late report landing
      over either would tell the dialog a story that is no longer running.
    */
    const report = (state: AcornOperationState) => {
      if (!owns()) return;
      op.state = state;
      op.stateOwner = runId;
      deps.progress?.(state);
    };
    /*
      The standdown's version of the same rule: this run parks the op only while
      the state the dialog shows is still its own report (or nobody's) — never
      over a newer run's, never over a parked failure a close or an earlier
      catch already wrote.
    */
    const parkIfMine = (failure: { stage: AcornLifecycleStage; cause: string; retryable: boolean }) => {
      if (op.state?.phase === 'failed') return;
      if (op.stateOwner !== undefined && op.stateOwner !== runId) return;
      op.state = {
        phase: 'failed',
        name: op.name,
        datasetId: op.ref?.id,
        languageAddress: op.lang,
        failure: makeFailure(failure.stage, failure.cause, failure.retryable),
      };
    };
    const park = (failure: { stage: AcornLifecycleStage; cause: string; retryable: boolean }) =>
      report({
        phase: 'failed',
        name: op.name,
        datasetId: op.ref?.id,
        languageAddress: op.lang,
        failure: makeFailure(failure.stage, failure.cause, failure.retryable),
      });
    try {
      report({ phase: 'preparing', name: op.name, datasetId: op.ref?.id, languageAddress: op.lang });
      const prepared = await serializeMount(op.lang, () =>
        prepareAndMount(op, owns, (attempt) =>
          report({ phase: 'mounting', attempt, name: op.name, datasetId: op.ref?.id, languageAddress: op.lang }),
        ),
      );
      if (!prepared || !owns()) {
        /*
          Stood down before the mount finished — a close already parked this op
          as resumable, or the newer ask's reports are the state. The parked
          offer to continue survives either way.
        */
        parkIfMine({ stage: 'mount', cause: '', retryable: true });
        return null;
      }
      report({
        phase: 'setting-up',
        name: prepared.name,
        datasetId: prepared.ref.id,
        languageAddress: op.lang,
      });
      const id = await openMounted(prepared.ref, op.lang, { name: prepared.name }, nav);
      if (!owns()) {
        /*
          Stood down inside the tail — the retained target and whatever debt
          remains are the record, and the state this run was reporting is parked
          so the dialog offers it rather than spinning on a run that is no
          longer running.
        */
        parkIfMine({ stage: 'setup', cause: '', retryable: true });
        return null;
      }
      /*
        Delete only on this run's own success: a superseded run that stood down
        inside `openMounted` must not remove the op its successor is still
        running on.
      */
      if (pendingOps.get(op.lang) === op) pendingOps.delete(op.lang);
      deps.progress?.(null);
      return id;
    } catch (error) {
      /*
        The typed failure carries its own classification; anything else reaching
        this boundary is read once here — an error after the target was retained
        is a setup failure resumable on it, an error before is a prepare failure
        that retrying can only help if the cause was transient.
      */
      const failure =
        error instanceof AcornLifecycleError
          ? error
          : new AcornLifecycleError({
              stage: op.ref ? 'setup' : 'prepare',
              retryTarget: op.ref ? { datasetId: op.ref.id, languageAddress: op.lang } : null,
              cause: error,
            });
      // A typed failure without a target is retryable only when its cause was
      // never an answer — the budget running out before a target was settled.
      const retryable = Boolean(failure.retryTarget) || mountFailureKind(failure.cause) !== 'permanent';
      park({ stage: failure.stage, cause: failure.message, retryable });
      /*
        The same failure parked when reporting is no longer ours: a run that
        threw after losing ownership cannot surface the error through `report`,
        but the op the dialog may still be showing must not spin on a dead run —
        park the real failure on it where the last report was ours to replace.
      */
      parkIfMine({ stage: failure.stage, cause: failure.message, retryable });
      throw failure;
    }
  };

  /**
   * The shared tail of create/join/open once a mount exists — §L.4 steps 3–6:
   * the mount's SDNA visible → a WE space on the target → the acorn template →
   * the member interactions → the landing, if this open still owns it.
   */
  const openMounted = async (
    ref: DatasetRef,
    lang: string,
    opts: { name: string },
    nav: { generation: number; selection: string | undefined },
  ): Promise<string | null> => {
    /*
      Ownership asked after every await: the newest ask holds the run, and a
      Close or a newer ask arriving while a call is out ends this one's right to
      issue anything further. Calls already issued settle — a landed write still
      pays its debt — but the tail does not continue past an owner that is gone.
    */
    const own = () => nav.generation === openGeneration;
    // "Dataset appears" — the mount installed Acorn's shapes. Bounded, then on
    // anyway: a still-shapeless dataset gets WE's schemas installed next, which
    // is what `ensureSpaceStructure` is about to do itself — the order that matters
    // (mount before init) is already kept.
    await waitFor(() => deps.schemas()?.hasAnySchema(ref.handle) ?? Promise.resolve(true), timeoutMs, pollMs, own);
    if (!own()) return null;
    /*
      Setup names its target everywhere — nothing below reads the current dataset.
      A navigation during any of these awaits no longer retargets the writes: they
      belong to `ref`, and every writer is handed it rather than asking what is
      current when it runs.
    */
    await serializeSetup(ref.id, async () => {
      /*
        The queue is where the check lands first: work queued while this run
        still owned may be running after it stopped. Then the owed remote work
        is read inside the queue, not before it: an open serialized ahead of
        this one may already have landed the writes and cleared the debt, and a
        capture taken while this run was still waiting would replay what is
        already done.
      */
      if (!own()) return;
      const owed = owedFor(ref.id);
      /*
        Reopen is repair: each invariant is read on its own and only the missing
        pieces are finished. A Space record existing never meant the setup
        finished — the run that died between the record and its root, or before
        the section recipe, left a project the old all-or-nothing check called
        done. And the repair must not write the pieces that held: a second Space
        record over the first would split the space's identity.
      */
      let setup = await deps.spaceSetup(ref).catch(() => null);
      if (!own()) return;
      if (!setup || !setup.spaceRecord || !setup.root) {
        await deps.ensureSpaceStructure(owed?.name ?? opts.name, '', ref);
        if (!own()) return;
        setup = await deps.spaceSetup(ref).catch(() => setup);
        if (!own()) return;
      }
      if (setup && !setup.enabledViews) {
        // The section recipe is a setup write: `Space.enabledViews` is the
        // members' own list once the space has one, and an open is not entitled
        // to reset it — the flag says only whether the recipe was ever written.
        await deps.setSpaceViews(ACORN_SECTION_IDS, ref.id);
        if (!own()) return;
      }
      if (setup && !setup.defaultTemplate) {
        await deps.setSpaceDefaultTemplate(ACORN_TEMPLATE_ID, ref.id);
        if (!own()) return;
      }
      /*
        Completion is a write, not a reading: the marker says the setup above finished, so a
        members' list holding none of the recipe stays edited rather than being reset on every
        open. Written whenever setup ran and the marker is absent — which also migrates the
        spaces set up before there was a marker: they report `enabledViews` from membership
        and get the marker here, after which the marker alone says it.
      */
      if (setup && !setup.setupDone) {
        await deps.markSpaceSetupDone(ref.id);
        if (!own()) return;
      }

      /*
        A create's meta and a join's announce are writes the mount cannot answer
        "done?" for, so the ledger is the record — read when this queued run
        starts, not when its ask was filed, and cleared piece by piece as the
        writes land.
      */
      if (owed?.writeMeta) {
        // The project's meta — name + layering + priority list. The passphrase is
        // not a parameter: the language derives it from the seed (mapping.ts), which
        // is why the joiner's passphrase convention holds at all. A meta that
        // already exists is refused by the zome — the write having already landed
        // is exactly the owed state, so the refusal reads as done.
        try {
          await interact(`${lang}://class/AcornProjectMeta`, 'create', {
            name: owed.name,
            layeringAlgorithm: 'LongestPath',
            topPriorityOutcomes: [],
          });
        } catch (error) {
          // The refusal surfaces two wire forms: the enum name (`OnlyOneOfEntryType`)
          // on some backends and the wasm guest text (`Only one of this entry type…`)
          // the a9 conductor forwards inside its CellError dump.
          if (!/OnlyOneOfEntryType|Only one of this entry type/.test(String(error))) throw error;
        }
        // The write was already issued when the close or the newer ask landed —
        // its answer still pays the debt it owed.
        markPaid(ref.id, 'writeMeta');
        if (!own()) return;
      }
      await ensureProfile(lang, own);
      if (!own()) return;
      if (owed?.announce) {
        await interact(`${lang}://project`, 'announceJoin');
        markPaid(ref.id, 'announce');
        if (!own()) return;
      }
    });
    if (!own()) return null;
    await deps.setSpaceTemplateOverride(ACORN_TEMPLATE_ID, ref.id);
    /*
      Land only once the space is whole — and only while this open is still the
      newest ask and the selection has not moved since it started. The generation
      covers opens racing each other; the selection read covers the person moving
      on without another lifecycle call (a sidebar click lands on the dataset, not
      on the counter). Either stale means the open stands down where it is: the
      work it did is finished and keeps.
    */
    if (nav.generation !== openGeneration || deps.currentDatasetId() !== nav.selection) return null;
    /*
      The same ownership, held through the navigation's awaits: a selection that moved
      during the preload or the switch means somebody else now owns where the person
      stands — this open's work keeps, but it does not get the landing. The id the
      dataset was asked for counts as the selection holding: reaching it is what the
      navigation is for.
    */
    const stillWanted = () =>
      nav.generation === openGeneration &&
      (deps.currentDatasetId() === nav.selection || deps.currentDatasetId() === ref.id);
    await deps.navigateToSpace(ref.id, stillWanted);
    return stillWanted() ? ref.id : null;
  };

  const api = {
    /**
     * The agent's mounted Acorn projects: every dataset carrying a mount whose language
     * answers as one. `lifecycle.list` already excludes backend bookkeeping
     * perspectives; a mount the executor knows is where to look, and the language's own
     * `info` is what says it is Acorn — no second registry of projects is kept anywhere.
     */
    async listAcornProjects(): Promise<AcornProjectRef[]> {
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle) return [];
      const datasets = await lifecycle.list();
      const entries = await Promise.all(
        datasets.map(async (ref) => {
          const mounted = await port.mounts(ref.id).catch(() => [] as string[]);
          const languageAddress = await firstAcornMount(mounted);
          return languageAddress ? { datasetId: ref.id, name: ref.name, languageAddress } : null;
        }),
      );
      return entries.filter((e): e is AcornProjectRef => e !== null);
    },

    /**
     * A new project: template the seed into a project language, make the
     * perspective, mount, and open it — the create half of §L.4.
     *
     * Returns the new dataset id, or null on a backend that cannot mount.
     */
    async createAcornProject(
      name: string,
      passphrase: string,
      sourceLanguageHash: string = ACORN_BASE_LANGUAGE,
    ): Promise<string | null> {
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle || !deps.hasAcornTemplate()) return null;
      /*
        Ownership is claimed at the ask, not at the language's answer: a Close
        while templating bumps the generation, and the call whose answer
        arrives afterward stands down instead of claiming a fresh one.
      */
      const nav = { generation: ++openGeneration, selection: deps.currentDatasetId() };
      const seed = acornSeed(passphrase);
      const { address: lang } = await port.applyTemplateLocal(sourceLanguageHash, { seed }).catch((error: unknown) => {
        throw redactSeed(error, seed);
      });
      if (nav.generation !== openGeneration) return null;
      /*
        One operation per language: a resubmit of the same seed — the same
        project — merges into the pending op rather than starting a parallel
        one beside it. The ask updates the name and adds the meta debt a create
        always owes; the intent's own record merges over both at retain time.
      */
      const op = pendingOps.get(lang) ?? { lang, name, writeMeta: false, announce: false };
      op.name = name;
      op.writeMeta = true;
      return runLifecycle(op, nav);
    },

    /**
     * An existing project by its language address and passphrase — or by
     * passphrase alone: the same `seed` templates to the same address as the
     * creator's, so the address is optional where the convention holds.
     */
    async joinAcornProject(
      languageAddress: string | undefined,
      passphrase: string,
      sourceLanguageHash: string = ACORN_BASE_LANGUAGE,
    ): Promise<string | null> {
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle || !deps.hasAcornTemplate()) return null;
      const nav = { generation: ++openGeneration, selection: deps.currentDatasetId() };
      const seed = acornSeed(passphrase);
      const lang =
        languageAddress ||
        (
          await port.applyTemplateLocal(sourceLanguageHash, { seed }).catch((error: unknown) => {
            throw redactSeed(error, seed);
          })
        ).address;
      if (nav.generation !== openGeneration) return null;
      /*
        A supplied address is verified before a dataset is made for it — joining an
        address that is not an Acorn cell would otherwise create the dataset, mount
        the language and announce into whatever it actually is. `answering` gives a
        cold cell the same grace `whoami` gets; a templated language needs no check —
        it is Acorn by construction.
      */
      const owns = () => nav.generation === openGeneration;
      if (languageAddress && !(await answering(() => acornInfo(lang), timeoutMs, pollMs, owns))) return null;
      if (nav.generation !== openGeneration) return null;
      /*
        Same sharing as create: a retried join merges into the pending op —
        the dataset it already made stays the target, and the announce the join
        owes is added to the debt rather than assumed absent.
      */
      const op = pendingOps.get(lang) ?? { lang, name: 'Acorn project', writeMeta: false, announce: false };
      op.announce = true;
      return runLifecycle(op, nav);
    },

    /**
     * A project the executor already has mounted — the list row's open. Runs the
     * same tail: a mounted dataset that was never initialized becomes a WE space
     * here; one that was gets its dataset switched to and its template confirmed.
     */
    async openAcornProject(datasetId: string): Promise<string | null> {
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle || !deps.hasAcornTemplate()) return null;
      const nav = { generation: ++openGeneration, selection: deps.currentDatasetId() };
      const owns = () => nav.generation === openGeneration;
      let ref: DatasetRef | null = null;
      let lang: string | null;
      try {
        ref = await lifecycle.get(datasetId);
        if (!owns()) return null;
        lang = ref ? await acornMountOf(await port.mounts(ref.id)) : null;
      } catch (error) {
        /*
          A preflight read that could not be made is a failure like the tail's:
          parked with the dataset named and resumable — never a silent null the
          dialog can only answer with "that did not work".
        */
        const failure = new AcornLifecycleError({ stage: 'prepare', retryTarget: null, cause: error });
        if (owns()) {
          const state: AcornOperationState = {
            phase: 'failed',
            name: ref?.name ?? owedFor(datasetId)?.name ?? 'Acorn project',
            datasetId,
            failure: makeFailure('prepare', failure.message, true),
          };
          preflightFailures.set(datasetId, state);
          deps.progress?.(state);
        }
        throw failure;
      }
      if (!owns()) return null;
      preflightFailures.delete(datasetId);
      if (!ref || !lang) {
        deps.progress?.(null);
        return null;
      }
      /*
        Open is the same operation without its mount half — the mount it just
        re-read is already there, so the run lands inside prepareAndMount's
        mounted check and goes straight to the tail. It rides the op keyed by
        the resolved language *when that op names this target*: a parked
        create's operation is this project's, and a finished open is what
        finally removes it — while a fresh op carries no debt of its own, and
        names itself the way the debt already does where a durable record
        survives (the intent's name is the one the owed meta write belongs to).
        Its failures park and resume the way create's and join's do, on the
        target it names.
      */
      let op = pendingOps.get(lang);
      if (op?.ref && op.ref.id !== datasetId) op = undefined;
      op ??= { lang, name: owedFor(datasetId)?.name ?? ref.name, writeMeta: false, announce: false };
      op.ref = ref;
      return runLifecycle(op, nav);
    },

    /**
     * The operation the projects dialog should offer — the one in flight, or the
     * parked one a failed mount left. Null when nothing is running and no mount
     * target was retained: a completed setup clears the record entirely.
     */
    async pendingAcornOperation(): Promise<AcornOperationState | null> {
      for (const op of pendingOps.values()) if (op.state) return op.state;
      for (const state of preflightFailures.values()) return state;
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle || !deps.setupIntent) return null;
      for (const ref of await lifecycle.list()) {
        const intent = deps.setupIntent.get(ref.id);
        if (intent?.phase === 'mount' && intent.languageAddress) {
          return {
            phase: 'failed',
            name: intent.name,
            datasetId: ref.id,
            languageAddress: intent.languageAddress,
            failure: makeFailure('mount', '', true),
          };
        }
      }
      return null;
    },

    /**
     * The dialog's Retry/Continue: re-run the retained operation — the parked op
     * while the session still holds it, else the pending target the intent names.
     * Resumes the same dataset and language; never allocates beside them.
     *
     * `datasetId`/`languageAddress` name the failure on display: several
     * operations can be parked at once and the Retry under a card must resume
     * that card's target, not whichever op happens to sit first in the map.
     * With no identity the first retained op answers, as before.
     */
    async resumeAcornOperation(datasetId?: string, languageAddress?: string): Promise<string | null> {
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle || !deps.hasAcornTemplate()) return null;
      const nav = { generation: ++openGeneration, selection: deps.currentDatasetId() };
      let op = languageAddress ? pendingOps.get(languageAddress) : undefined;
      if (!op && datasetId) op = [...pendingOps.values()].find((entry) => entry.ref?.id === datasetId);
      if (!op && !datasetId && !languageAddress) op = [...pendingOps.values()][0];
      /*
        An Open that failed before it had an operation is resumed by running
        the Open again — on the dataset its failure names.
      */
      const preflight =
        op || languageAddress
          ? undefined
          : datasetId
            ? preflightFailures.get(datasetId)
            : [...preflightFailures.values()][0];
      if (preflight?.datasetId) return api.openAcornProject(preflight.datasetId);
      if (!op && deps.setupIntent) {
        for (const ref of await lifecycle.list()) {
          const intent = deps.setupIntent.get(ref.id);
          if (!intent || intent.phase !== 'mount' || !intent.languageAddress) continue;
          if ((datasetId || languageAddress) && ref.id !== datasetId && intent.languageAddress !== languageAddress) {
            continue;
          }
          op = { lang: intent.languageAddress, name: intent.name, writeMeta: false, announce: false, ref };
          break;
        }
      }
      if (!op || nav.generation !== openGeneration) return null;
      /*
        The selected operation's own retryability rules: a refusal the executor
        answered parks unretryable — the card under it offers no Retry, and the
        resume refuses it too, even asked by name.
      */
      if (op.state?.phase === 'failed' && op.state.failure && !op.state.failure.retryable) return null;
      return runLifecycle(op, nav);
    },

    /**
     * The dialog's Close: UI ownership ends — an in-flight run stands down and
     * anything unfinished stays parked for the next open, rather than being
     * unmounted or forgotten. Retention is the point: the target survives, and
     * a late server-side mount is reconciled by the resume that asks after it.
     */
    dismissAcornOperation(): void {
      openGeneration += 1;
      for (const op of pendingOps.values()) {
        if (op.state && op.state.phase !== 'failed') {
          op.state = {
            ...op.state,
            phase: 'failed',
            failure: makeFailure(op.state.phase === 'setting-up' ? 'setup' : 'mount', '', true),
          };
        }
      }
      deps.progress?.(null);
    },
  };
  return api;
}
