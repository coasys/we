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
import type {
  AcornLifecyclePort,
  DatasetHandle,
  DatasetLifecyclePort,
  DatasetRef,
  SchemaPort,
} from '@we/backend-shared';
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
   * Whether the dataset already holds a WE Space *record* — the "is this dataset
   * initialized" check. `hasCoreSchema` cannot answer it: the schema installs in the
   * same `initializeAsWeSpace` that writes the record, so a run that died between the
   * two leaves the class registered with the space never made — and being able to see
   * the class then skips the very init that would fix it.
   */
  hasSpaceRecord: (handle: DatasetHandle) => Promise<boolean>;
  /** Make a dataset the current one — `initializeAsWeSpace` reads the current dataset. */
  switchDataset: (id: string) => Promise<void>;
  /**
   * Land on the space, last — after the mount, the init and the template write, so the
   * route effect never sees the dataset half-built and a list row's "open" is one call.
   * It re-switches only when the dataset changed, so calling it on the current one is free.
   */
  navigateToSpace: (id: string) => Promise<void>;
  /** Install WE's space schemas on the foreign dataset and write its Space record. */
  initializeAsWeSpace: (name: string, description: string) => Promise<unknown>;
  /** The space's default template — written after init, per Q7. */
  setSpaceDefaultTemplate: (templateId: string, spaceUuid?: string) => Promise<void>;
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

  /**
   * The shared tail of create/join/open once a mount exists — §L.4 steps 3–6:
   * the mount's SDNA visible → the dataset current → a WE space on it → the acorn
   * template → the member interactions.
   */
  const openMounted = async (
    ref: DatasetRef,
    lang: string,
    opts: { name: string; writeMeta: boolean; announce: boolean },
  ): Promise<string> => {
    // "Dataset appears" — the mount installed Acorn's shapes. Bounded, then on
    // anyway: a switch into a still-shapeless dataset installs WE's schemas, which
    // is what `initializeAsWeSpace` is about to do itself — the order that matters
    // (mount before init) is already kept.
    await waitFor(() => deps.schemas()?.hasAnySchema(ref.handle) ?? Promise.resolve(true), timeoutMs, pollMs);
    await deps.switchDataset(ref.id);
    if (!(await deps.hasSpaceRecord(ref.handle).catch(() => false))) {
      await deps.initializeAsWeSpace(opts.name, '');
    }
    await deps.setSpaceDefaultTemplate(ACORN_TEMPLATE_ID, ref.id);
    await deps.setSpaceViews(ACORN_SECTION_IDS, ref.id);
    await deps.setSpaceTemplateOverride(ACORN_TEMPLATE_ID, ref.id);

    if (opts.writeMeta) {
      // The project's meta — name + layering + priority list. The passphrase is
      // not a parameter: the language derives it from the seed (mapping.ts), which
      // is why the joiner's passphrase convention holds at all.
      await interact(`${lang}://class/AcornProjectMeta`, 'create', {
        name: opts.name,
        layeringAlgorithm: 'LongestPath',
        topPriorityOutcomes: [],
      });
    }
    await ensureProfile(lang);
    if (opts.announce) await interact(`${lang}://project`, 'announceJoin');
    // Land only once the space is whole: navigating earlier would put a route at a
    // dataset that is still a mount rather than a space, and the join gate reads that.
    await deps.navigateToSpace(ref.id);
    return ref.id;
  };

  return {
    /**
     * The agent's mounted Acorn projects: every dataset the executor reports a
     * mount on. `lifecycle.list` already excludes backend bookkeeping
     * perspectives; a mount the executor knows is the Acorn truth — no second
     * registry of projects is kept anywhere.
     */
    async listAcornProjects(): Promise<AcornProjectRef[]> {
      const port = deps.port();
      const lifecycle = deps.lifecycle();
      if (!port || !lifecycle) return [];
      const datasets = await lifecycle.list();
      const entries = await Promise.all(
        datasets.map(async (ref) => {
          const mounted = await port.mounts(ref.id).catch(() => [] as string[]);
          const languageAddress = mounted[0];
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
      const seed = acornSeed(passphrase);
      const { address: lang } = await port.applyTemplateLocal(sourceLanguageHash, { seed });
      const ref = await lifecycle.create(name);
      await port.mount(ref.id, lang);
      return openMounted(ref, lang, { name, writeMeta: true, announce: false });
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
      const lang =
        languageAddress || (await port.applyTemplateLocal(sourceLanguageHash, { seed: acornSeed(passphrase) })).address;
      const ref = await lifecycle.create('Acorn project');
      await port.mount(ref.id, lang);
      return openMounted(ref, lang, { name: ref.name, writeMeta: false, announce: true });
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
      const ref = await lifecycle.get(datasetId);
      if (!ref) return null;
      const [lang] = await port.mounts(ref.id);
      if (!lang) return null;
      return openMounted(ref, lang, { name: ref.name, writeMeta: false, announce: false });
    },
  };
}
