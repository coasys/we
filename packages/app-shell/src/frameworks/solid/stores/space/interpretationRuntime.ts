/**
 * The extraction runtime: what a pass over one conversation asks for, where it files what it finds,
 * how it is written down, and the standing watch that runs passes as a conversation grows.
 *
 * Owned by SpaceStore, because every answer it needs is the space's — what this space could extract
 * (ShapeStore, above it), what one collection extracts and whether it is extracted as it grows (the
 * collections' own settings, which SpaceStore reads). It reads them directly; nothing is lent.
 */
import { gatherTranscriptTurns, type TurnRecord } from '@shared/interpretation/transcriptTurns';
import type { ModuleHostServices } from '@shared/registries/moduleHostServices';
import { readSpaceRoot } from '@shared/spaceLandmarks';
import type { DatasetHandle, InterpretationPort, ParentRef } from '@we/backend-shared';
import { type DatasetProxy, getEntityForDataset, ModelRun } from '@we/entities';
import { untrack } from 'solid-js';

/*
  Where a pass files what it read, by the relations of `CollectionBlock` that hold each — named, not
  stored: how a relation is stored is the backend's business.

  - `runs` — a `ModelRun` for each pass, `kind: 'extraction'`, hung off the collection it read.
  - `extracted` — a record a model proposed from reading the collection. Written beside containment
    rather than instead of it: `children` is ownership, and the call's board gathers through it, so a
    record that stopped being a child would vanish from the board it exists to appear on. This is the
    other fact about the same record: a model proposed it from the conversation, rather than somebody
    typing it there.
  - `recognised` — a record a pass matched rather than made, so the conversation's own view can say
    "already in the space" rather than claiming it as made here.

  Named here because they are WE's vocabulary. The interpretation port takes them as arguments for the
  same reason it takes `parent` as one — a backend that hard-coded them would be deciding what a
  relation in somebody else's graph is called.
*/
const extractedFrom = (collectionId: string) => ({
  id: collectionId,
  relation: 'extracted',
  entity: 'CollectionBlock',
});
const recognisedBy = (collectionId: string) => ({
  id: collectionId,
  relation: 'recognised',
  entity: 'CollectionBlock',
});

/** What a pass is written down with — see {@link recordPass}. */
type PassRecord = {
  outcome: string;
  recordCount: number;
  targets: string[];
  error?: string;
  /** What started it. Defaults to a press. */
  trigger?: 'manual' | 'auto';
  prompt?: string;
  response?: string;
};

const passFields = (pass: PassRecord) => ({
  kind: 'extraction',
  outcome: pass.outcome,
  recordCount: pass.recordCount,
  detail: JSON.stringify({ targets: pass.targets }),
  error: pass.error ?? '',
  trigger: pass.trigger ?? 'manual',
  prompt: pass.prompt ?? '',
  output: pass.response ?? '',
});

/**
 * Write down that a pass happened, as a `ModelRun` of kind `extraction` — see {@link ModelRun}.
 *
 * Best effort, and deliberately so: the pass is the thing that mattered and it has already run,
 * so a failed *note* about it must not turn a successful extraction into a rejected one. Logged
 * rather than swallowed, because a note that never lands is a history that quietly stays empty.
 *
 * Written by the host rather than by the module for the same reason `interpretCollection` is: where
 * a pass is filed is the host's to say, and a module names a collection and nothing else.
 *
 * With `run`, the pass's run already exists — {@link openPass} made it so the pass could mark what
 * it wrote — and this completes it rather than writing a second.
 */
async function recordPass(handle: DatasetProxy, collectionId: string, pass: PassRecord, run?: string): Promise<void> {
  try {
    if (run) await ModelRun.update(handle, run, passFields(pass));
    else
      await ModelRun.create(handle, passFields(pass), {
        parent: { id: collectionId, relation: 'runs', entity: 'CollectionBlock' },
      });
  } catch (error) {
    console.warn('[interpretation] could not record that a pass ran', error);
  }
}

/**
 * The run a pass is about to be, written before it starts so the pass can mark what it makes with
 * it — `generatedBy`, in the same writes that make them. `running` until {@link recordPass}
 * completes it, which is also what a pass that never returns is left saying.
 *
 * `undefined` where the write fails: the pass still runs, unmarked, and is written down afterwards.
 * A history entry is not worth an extraction.
 */
async function openPass(handle: DatasetProxy, collectionId: string, targets: string[]): Promise<string | undefined> {
  try {
    const run = await ModelRun.create(handle, passFields({ outcome: 'running', recordCount: 0, targets }), {
      parent: { id: collectionId, relation: 'runs', entity: 'CollectionBlock' },
    });
    return run.id;
  } catch (error) {
    console.warn('[interpretation] could not open a run for this pass', error);
    return undefined;
  }
}

/*
  Where a pass files what it finds: the space collection, whatever conversation it read.

  Extracted items are the space's top-level content, so they live where everything top-level does
  — in the collection the space's feed, canvas and boards all read — and a call is only where they
  came from (the provenance link, written beside this one). Filed under the call, every
  space-wide view would have had to gather from every call; filed here, deleting a call leaves
  what it found in place.

  A dataset with no space collection files under the conversation itself. Read once per dataset and
  kept, by `readSpaceRoot`: the collection is written at creation and never changes.
*/
async function filedUnder(handle: unknown, conversation: string): Promise<ParentRef> {
  let root = '';
  try {
    root = (await readSpaceRoot(handle))?.root ?? '';
  } catch {
    // Filed under the conversation, and asked again next pass.
  }
  return { id: root || conversation, relation: 'children', entity: 'CollectionBlock' };
}

/*
  One collection, one watch.

  Derived rather than stored so that any peer computing it lands on the same string: the engine
  keys its processors by this id inside the shared perspective, so two members starting the same
  call must agree on it or they register two watches over one transcript and every utterance is
  interpreted twice.

  Reduced to letters, digits and dashes because the id becomes part of a URI — the engine mints its
  processor node at `ad4m://autoprocessor/<id>`, and a record id is itself a URL. What an id looks
  like is AD4M's business, so nothing here assumes its form.
*/
const watchIdFor = (collectionId: string) => `we-call-${collectionId.replace(/[^a-zA-Z0-9]+/g, '-')}`;

export interface InterpretationRuntimeDeps {
  /**
   * The backend's interpretation port, read on every call: the backend connects after the stores
   * are built, and a backend that cannot interpret never sets it.
   */
  port: () => InterpretationPort | undefined;
  /** The dataset on screen. */
  dataset: () => DatasetProxy | null;
  /** What could be extracted here — core vocabulary marked extractable, plus this space's models. */
  candidates: () => string[];
  /** Whether `candidates` is the whole list yet. */
  candidatesLoaded: () => boolean;
  /** What one collection extracts: its own list, else the space's default. */
  targetsFor: (collectionId: string) => string[];
  setTargetFor: (collectionId: string, entity: string, on: boolean) => Promise<void>;
  /** Whether this collection is extracted as it grows — its own answer. */
  autoFor: (collectionId: string) => boolean;
  setAutoFor: (collectionId: string, on: boolean) => Promise<void>;
}

export interface InterpretationRuntime {
  /**
   * Keep a standing extraction watch on one conversation, filing what it finds into the space
   * collection. What a module's `watchCollection` reaches; also the space's own, for its loose
   * messages. Rejects where the watch cannot be registered, with the reason.
   */
  watchConversation: (collectionId: string, dataset?: DatasetHandle) => Promise<void>;
  /** Stop it. Safe when none was registered. */
  unwatchConversation: (collectionId: string, dataset?: DatasetHandle) => Promise<void>;
  /** The extraction slice of the module host services — publish with `provideModuleHostServices`. */
  services: ModuleHostServices;
}

export function createInterpretationRuntime(deps: InterpretationRuntimeDeps): InterpretationRuntime {
  /**
   * The class list one pass over this collection should ask for.
   *
   * Always intersected with the candidates, and that is not tidiness: a name the perspective has no
   * shape for fails `assertShapesInstalled` and takes the whole pass down, so a space default naming
   * a model since deleted, or a call list naming one whose `extractable` was withdrawn, has to
   * narrow the request rather than break it.
   */
  const targetsForCollection = (collectionId: string): string[] => {
    const chosen = deps.targetsFor(collectionId);
    return deps.candidates().filter((entity) => chosen.includes(entity));
  };

  /*
    A standing watch over one conversation — a call, or the space collection's loose messages.

    Named functions rather than members of the module services below, because the space itself
    registers one too: the watch over its loose messages belongs to the space, not to any module.
  */
  async function watchConversation(collectionId: string, target?: DatasetHandle): Promise<void> {
    const port = deps.port();
    if (!port?.watch) throw new Error('interpretation: this backend cannot run a standing watch');
    /*
      Asked about *this collection*, not about the space.

      A collection holds its own answer, and one that has been turned off has to stay off — a check
      that could only see the space would re-register the watch on the next tick. False until the
      collection's settings have been read, which is the right way round for something that spends
      somebody's LLM budget.
    */
    if (!deps.autoFor(collectionId))
      throw new Error('interpretation: automatic interpretation is off for this collection');
    /*
      The caller's dataset, not the one on screen: a call outlives the space on screen, and a watch
      registered wherever the reader had wandered to interprets the call into a perspective that
      does not hold it — and is then removed from the wrong one too, so it never stops.
    */
    const handle = target ?? deps.dataset();
    if (!handle) throw new Error('interpretation: no dataset to interpret into');

    const classes = targetsForCollection(collectionId);
    // Refused rather than registered empty: the executor rejects a processor with no classes, and
    // "this space has marked nothing for interpretation" is a sentence worth saying in its own words.
    if (!classes.length) throw new Error('interpretation: nothing in this space is marked for AI interpretation');

    await port.watch(handle, {
      watchId: watchIdFor(collectionId),
      classes,
      parent: await filedUnder(handle, collectionId),
      provenance: extractedFrom(collectionId),
      recognised: recognisedBy(collectionId),
    });
  }

  async function unwatchConversation(collectionId: string, target?: DatasetHandle): Promise<void> {
    const port = deps.port();
    // The caller's dataset, for the reason `watchConversation` gives.
    const handle = target ?? deps.dataset();
    // Silent rather than thrown: this runs while tearing a call down, and a host that never
    // registered anything is not a failure worth interrupting that with.
    if (!port?.unwatch || !handle) return;
    await port.unwatch(handle, watchIdFor(collectionId));
  }

  const services: ModuleHostServices = {
    /*
      What this collection extracts, and what else it could — for a module that offers the choice.

      One list of `{ entity, selected }` rather than two arrays, because the surface that renders it
      is a row of toggles and a schema cannot join two lists to decide which are ticked. The module
      never sees the resolution: candidacy, the space's default and the collection's own list are
      questions it has no business knowing about, and it is handed the answer.
    */
    interpretationTargets: (collectionId: string) => {
      const active = targetsForCollection(collectionId);
      return deps.candidates().map((entity) => ({
        entity,
        selected: active.includes(entity),
      }));
    },
    /*
      Whether that list is the whole of it yet. A space's own models and the classes it already had
      are read a few round trips after its core vocabulary is known, and a watch registered from the
      part that had arrived would be removed and registered again when the rest did. The list above
      does not wait for this; what registers from it does.
    */
    interpretationTargetsLoaded: () => deps.candidatesLoaded(),
    setAutoInterpret: (collectionId: string, on: boolean) => deps.setAutoFor(collectionId, on),
    setInterpretationTarget: (collectionId: string, entity: string, on: boolean) =>
      deps.setTargetFor(collectionId, entity, on),

    // Gathering the turns is the host's half of the job: the port takes turns, and a module has no
    // read with which to produce them. Parenting what comes back onto the same collection is not
    // optional dressing — an unparented TaskBlock is a real record that no route lists, so an
    // extraction that skipped it would look exactly like one that found nothing.
    interpretCollection: async (collectionId) => {
      const port = deps.port();
      if (!port) throw new Error('interpretation: this backend cannot interpret');
      // The dataset this pass was asked for: a space switched mid-pass must not redirect its writes.
      const handle = untrack(deps.dataset);
      if (!handle) throw new Error('interpretation: no dataset to interpret into');

      const modelFor = (entity: string) => getEntityForDataset(entity, handle);
      const turns = await gatherTranscriptTurns(
        { modelFor: (entity) => modelFor(entity) as TurnRecord | undefined, handle },
        collectionId,
      );

      // The host resolves the class list, because the three layers that decide it — candidacy, the
      // space's default, this call's own — are all host state. A module names a collection and
      // nothing else, exactly as it does for the watch id and where a pass is filed.
      const classes = targetsForCollection(collectionId);
      const run = await openPass(handle, collectionId, classes);
      try {
        const result = await port.interpret(handle, turns, {
          classes,
          parent: await filedUnder(handle, collectionId),
          provenance: extractedFrom(collectionId),
          recognised: recognisedBy(collectionId),
          ...(run ? { run } : {}),
        });
        await recordPass(
          handle,
          collectionId,
          {
            // Nothing to look for is not a failure and not a quiet meeting — it is a call whose
            // targets are all switched off, which reads as "0 records" and blames the conversation
            // unless it is said.
            outcome: classes.length === 0 ? 'skipped' : 'done',
            recordCount: result.ids.length,
            targets: classes,
            // Handed back by the run rather than found on the progress feed afterwards, so one
            // write holds the whole pass — see `prompt` on the result.
            prompt: result.prompt,
            response: result.response,
          },
          run,
        );
        return result;
      } catch (error) {
        /*
          Written before rethrowing, because a failure is the pass most worth having a record of.

          Live, a failure is reported by the readout and then lost with it: reload, and a call that
          could not be read is indistinguishable from one that was read and found nothing. That is
          the pair somebody reviewing a meeting most needs told apart, and it is the one the live
          feed cannot keep.
        */
        await recordPass(
          handle,
          collectionId,
          {
            outcome: 'failed',
            recordCount: 0,
            targets: classes,
            error: error instanceof Error ? error.message : String(error),
          },
          run,
        );
        throw error;
      }
    },

    /*
      The staged suggestions belonging to one call, rather than to the whole space.

      Here rather than on the port wrapper for the same reason `interpretCollection` is: where a
      call's passes were filed is the host's to say, and a module must never have to.

      A proposal outlives the pass that made it, so an unresolved one from this morning's call is
      still staged this afternoon. Scoped to the call, it does not arrive in the next call's review
      list looking like something that call had just found — where accepting it would commit a
      record parented to the earlier call, invisible on the board of the call the reviewer is in.

      The dataset is the *caller's*, not the one on screen: a call outlives the space on screen, and
      answering about wherever the reader wandered to is the bug `targeted` exists to prevent.
    */
    proposalsForCollection: async (dataset, collectionId) => {
      const port = deps.port();
      if (!port) return [];
      return port.proposals(dataset, {
        parent: await filedUnder(dataset, collectionId),
        // The conversation, which is what narrows once every call files into one collection.
        provenance: extractedFrom(collectionId),
      });
    },

    /*
      The standing version of the same thing, and the reason it lives here rather than on the module
      surface.

      A module names a collection worth watching; everything else is the host's — the watch id, the
      dataset, where the pass is filed, and the lifetime. That split is what keeps this from being
      "a module holding a watch", which the module contract refuses: a watch is a *dataset-level*
      registration shared with every peer, and a module store whose lifetime is a panel being open
      would leave one behind every time somebody closed it.

      Keyed on the collection id, so registering twice for one call is the same registration rather
      than two. The engine reads its processors out of the perspective graph, so this is idempotent
      in the place it matters: whichever peer registers first wins and the rest write the same row.
    */
    watchCollection: watchConversation,

    /*
      Repair anything a standing pass minted without an edge.

      Runs when a call is opened rather than on a timer, because that is the moment somebody is
      about to look: the records exist either way, and what is missing is only their place in the
      call. Returns the count so a caller can say nothing when there was nothing to do.
    */
    reconcileCollection: async (collectionId) => {
      const port = deps.port();
      const handle = deps.dataset();
      if (!port?.reconcile || !handle) return 0;

      return port.reconcile(handle, {
        classes: targetsForCollection(collectionId),
        parent: await filedUnder(handle, collectionId),
        provenance: extractedFrom(collectionId),
        recognised: recognisedBy(collectionId),
      });
    },

    unwatchCollection: unwatchConversation,
  };

  return { watchConversation, unwatchConversation, services };
}
