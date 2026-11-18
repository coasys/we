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
 * `language.publish`/`publishLocal` computes it (CIDv1, sha2-256 of the bundle).
 *
 * The hash names a build, not a thing: `acorn-ad4m/language/build/bundle.js` at
 * the rig's checkout. A rebuilt bundle is a new hash, so the constant goes where
 * the sequence that needs it lives rather than where a caller might guess it —
 * `createAcornProject` takes a `sourceLanguageHash` override for a host holding
 * a different build.
 */
export const ACORN_BASE_LANGUAGE = 'QmzSYwdfCQkVeBvQx1Ygx89h5L7P7ny5PTmj3J9VuwMPvfhb2B6';

/** The template an opened Acorn project renders through — the space's `defaultTemplateId`. */
export const ACORN_TEMPLATE_ID = 'acorn';

/**
 * The sections an Acorn space's nav carries, in order — the template package's own
 * catalogue, so first in the object is where a member lands: the outcomes list. Written
 * onto `Space.enabledViews` at open, because a space that names no sections falls back to
 * the deployment's bundled order — which puts `about` first, not Acorn.
 */
export const ACORN_SECTION_IDS = Object.keys(ACORN_VIEWS);

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
  /** Poll cadence and bound for the two waits (shapes landing, the cell answering). */
  pollMs?: number;
  timeoutMs?: number;
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

/** Poll `read` until it answers truthy — an rpc that throws counts as "not yet". */
async function waitFor<T>(read: () => Promise<T>, timeoutMs: number, pollMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read().catch(() => null);
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((done) => setTimeout(done, pollMs));
  }
}

/**
 * `call` retried while it throws — the mounted cell can still be coming up — but
 * a resolved value, `null` included, is the language's answer, not "not yet": a
 * `whoami` that resolves null means the member profile does not exist.
 */
async function answering<T>(call: () => Promise<T>, timeoutMs: number, pollMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await call();
    } catch {
      if (Date.now() >= deadline) return null;
      await new Promise((done) => setTimeout(done, pollMs));
    }
  }
}

export function createAcornLifecycle(deps: AcornLifecycleDeps) {
  const pollMs = deps.pollMs ?? 2_000;
  // A mount's cell install + first sync routinely takes a minute on a cold rig;
  // the waits below bound themselves rather than trusting mount() to have meant "done".
  const timeoutMs = deps.timeoutMs ?? 180_000;

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
   * Identify this agent to the project: `whoami` first (the mount answers null
   * until the member profile exists), the profile `create` when it does not.
   * The AcornProfile fields are the zome's `create_whoami` shape — the agent's
   * WE display name mapped onto them, since Acorn splits a name WE keeps whole.
   */
  const ensureProfile = async (lang: string): Promise<void> => {
    const who = (await answering(() => interact(`${lang}://project`, 'whoami'), timeoutMs, pollMs)) as {
      address?: string;
    } | null;
    if (who?.address) return;
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
    The newest ask owns the landing. Earlier opens still finish what they were
    doing — their writes name a target and are worth completing — but a superseded
    open does not navigate: it would land the person on a space they have since
    asked to leave.
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

  /**
   * The dataset that already carries `lang` mounted, or null — how a retried create
   * or join finds the perspective its first attempt made instead of minting another.
   * The language address is the project's identity: the same seed templates to the
   * same address, so the dataset mounting it *is* the project being asked for.
   */
  const datasetMounting = async (lang: string): Promise<DatasetRef | null> => {
    const port = deps.port();
    const lifecycle = deps.lifecycle();
    if (!port || !lifecycle) return null;
    for (const ref of await lifecycle.list()) {
      const mounted = await port.mounts(ref.id).catch(() => [] as string[]);
      if (mounted.includes(lang)) return ref;
    }
    return null;
  };

  /**
   * The shared tail of create/join/open once a mount exists — §L.4 steps 3–6:
   * the mount's SDNA visible → a WE space on the target → the acorn template →
   * the member interactions → the landing, if this open still owns it.
   */
  const openMounted = async (
    ref: DatasetRef,
    lang: string,
    opts: { name: string; writeMeta: boolean; announce: boolean },
    nav: { generation: number; selection: string | undefined },
  ): Promise<string | null> => {
    // "Dataset appears" — the mount installed Acorn's shapes. Bounded, then on
    // anyway: a still-shapeless dataset gets WE's schemas installed next, which
    // is what `ensureSpaceStructure` is about to do itself — the order that matters
    // (mount before init) is already kept.
    await waitFor(() => deps.schemas()?.hasAnySchema(ref.handle) ?? Promise.resolve(true), timeoutMs, pollMs);
    /*
      Setup names its target everywhere — nothing below reads the current dataset.
      A navigation during any of these awaits no longer retargets the writes: they
      belong to `ref`, and every writer is handed it rather than asking what is
      current when it runs.
    */
    await serializeSetup(ref.id, async () => {
      /*
        The owed remote work is read inside the queue, not before it: an open
        serialized ahead of this one may already have landed the writes and
        cleared the debt, and a capture taken while this run was still waiting
        would replay what is already done.
      */
      const owed = deps.setupIntent?.get(ref.id) ?? null;
      /*
        Reopen is repair: each invariant is read on its own and only the missing
        pieces are finished. A Space record existing never meant the setup
        finished — the run that died between the record and its root, or before
        the section recipe, left a project the old all-or-nothing check called
        done. And the repair must not write the pieces that held: a second Space
        record over the first would split the space's identity.
      */
      let setup = await deps.spaceSetup(ref).catch(() => null);
      if (!setup || !setup.spaceRecord || !setup.root) {
        await deps.ensureSpaceStructure(owed?.name ?? opts.name, '', ref);
        setup = await deps.spaceSetup(ref).catch(() => setup);
      }
      if (setup && !setup.enabledViews) {
        // The section recipe is a setup write: `Space.enabledViews` is the
        // members' own list once the space has one, and an open is not entitled
        // to reset it — the flag says only whether the recipe was ever written.
        await deps.setSpaceViews(ACORN_SECTION_IDS, ref.id);
      }
      if (setup && !setup.defaultTemplate) await deps.setSpaceDefaultTemplate(ACORN_TEMPLATE_ID, ref.id);
      /*
        Completion is a write, not a reading: the marker says the setup above finished, so a
        members' list holding none of the recipe stays edited rather than being reset on every
        open. Written whenever setup ran and the marker is absent — which also migrates the
        spaces set up before there was a marker: they report `enabledViews` from membership
        and get the marker here, after which the marker alone says it.
      */
      if (setup && !setup.setupDone) await deps.markSpaceSetupDone(ref.id);

      /*
        A create's meta and a join's announce are writes the mount cannot answer
        "done?" for, so the retained intent is the record — cleared piece by
        piece as the writes land.
      */
      const markDone = (bit: 'writeMeta' | 'announce') => {
        const current = deps.setupIntent?.get(ref.id);
        if (!current) return;
        const next = { ...current, [bit]: false };
        if (!next.writeMeta && !next.announce) deps.setupIntent!.clear(ref.id);
        else deps.setupIntent!.set(ref.id, next);
      };
      if (Boolean(owed?.writeMeta) || opts.writeMeta) {
        // The project's meta — name + layering + priority list. The passphrase is
        // not a parameter: the language derives it from the seed (mapping.ts), which
        // is why the joiner's passphrase convention holds at all. A meta that
        // already exists is refused by the zome — the write having already landed
        // is exactly the owed state, so the refusal reads as done.
        try {
          await interact(`${lang}://class/AcornProjectMeta`, 'create', {
            name: owed?.name ?? opts.name,
            layeringAlgorithm: 'LongestPath',
            topPriorityOutcomes: [],
          });
        } catch (error) {
          if (!String(error).includes('OnlyOneOfEntryType')) throw error;
        }
        markDone('writeMeta');
      }
      await ensureProfile(lang);
      if (Boolean(owed?.announce) || opts.announce) {
        await interact(`${lang}://project`, 'announceJoin');
        markDone('announce');
      }
    });
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

  return {
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
      const nav = { generation: ++openGeneration, selection: deps.currentDatasetId() };
      const seed = acornSeed(passphrase);
      const { address: lang } = await port.applyTemplateLocal(sourceLanguageHash, { seed });
      /*
        A retried create lands here too — the same seed templates to the same
        address, so the dataset already mounting this language *is* the project.
        Resume it rather than minting a second perspective over one mount.
      */
      const existing = await datasetMounting(lang);
      const ref = existing ?? (await lifecycle.create(name));
      if (!existing) await port.mount(ref.id, lang);
      // The meta write this run owes, remembered before it is attempted: the
      // language cannot answer "done?" later, so the intent is the record an
      // interrupted create leaves the next open.
      deps.setupIntent?.set(ref.id, { name, writeMeta: true, announce: false });
      return openMounted(ref, lang, { name, writeMeta: true, announce: false }, nav);
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
      const lang =
        languageAddress || (await port.applyTemplateLocal(sourceLanguageHash, { seed: acornSeed(passphrase) })).address;
      /*
        A supplied address is verified before a dataset is made for it — joining an
        address that is not an Acorn cell would otherwise create the dataset, mount
        the language and announce into whatever it actually is. `answering` gives a
        cold cell the same grace `whoami` gets; a templated language needs no check —
        it is Acorn by construction.
      */
      if (languageAddress && !(await answering(() => acornInfo(lang), timeoutMs, pollMs))) return null;
      // Same reuse as create: a retried join resumes the dataset it already made.
      const existing = await datasetMounting(lang);
      const ref = existing ?? (await lifecycle.create('Acorn project'));
      if (!existing) await port.mount(ref.id, lang);
      deps.setupIntent?.set(ref.id, { name: ref.name, writeMeta: false, announce: true });
      return openMounted(ref, lang, { name: ref.name, writeMeta: false, announce: true }, nav);
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
      const ref = await lifecycle.get(datasetId);
      if (!ref) return null;
      const lang = await firstAcornMount(await port.mounts(ref.id));
      if (!lang) return null;
      return openMounted(ref, lang, { name: ref.name, writeMeta: false, announce: false }, nav);
    },
  };
}
