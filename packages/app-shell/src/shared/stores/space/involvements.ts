/**
 * Who is on what in a space, and what each person gave: the kinds of involvement the community names,
 * putting somebody on a record or taking them off, answering one, joining a record's roster, and
 * reactions. Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * The vocabulary is held here, for the reason task states are: a template can filter a list it was
 * handed and cannot substitute one it was not. The involvements and reactions themselves are not —
 * they change with every click anybody makes, so a template holds them in a live query and reads them
 * through the `involvement` and `reactions` host functions. What an involvement write *means* lives in
 * `involvements.ts`; a reaction's in `core.upsertSignal`.
 *
 * Every write here is drawn before it lands — see `@we/optimism` — and the holds are promises about
 * the space on screen, so all of them are dropped when it changes.
 */
import { CollectionBlock, type InvolvementSemantic, InvolvementType, runOperation, SignalType } from '@we/entities';

import { distinctSignal } from '../../distinctSignal';
import { isoOf } from '../../interpretation/callExport';
import type { InvolvementOptimism } from '../../involvementOptimism';
import {
  createInvolvementActions,
  INVOLVEMENT_SEMANTICS,
  type InvolvementTypeView,
  parseAppliesTo,
  resolveInvolvementTypes,
} from '../../involvements';
import { oneAtATime } from '../../oneAtATime';
import type { SignalOptimism } from '../../signalOptimism';
import type { signalOrder } from '../../signalOrder';
import { deriveSlug } from '../../utils';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';

export interface SpaceInvolvementsDeps extends SpaceContext {
  /** People put on or taken off a record, ahead of the data — the app's one. */
  involvementOptimism: InvolvementOptimism;
  /** Reactions drawn ahead of the data — the app's one. */
  signalOptimism: SignalOptimism;
  /** The order each record's reactions settled into — the app's one, forgotten with the space. */
  signalOrder: Pick<typeof signalOrder, 'reset'>;
}

export function createSpaceInvolvements(deps: SpaceInvolvementsDeps) {
  const {
    reactivity,
    toasts,
    sessionStore: session,
    datasetStore,
    runCore,
    reportOperation,
    involvementOptimism,
    signalOptimism,
    signalOrder,
  } = deps;
  const { memo, effect, untrack, batch } = reactivity;

  const [ownInvolvementTypes, setOwnInvolvementTypes] = reactivity.signal<InvolvementTypeView[]>([]);
  const [involvementTypesLoaded, setInvolvementTypesLoaded] = distinctSignal(reactivity, false);

  async function loadInvolvementTypes(): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const uuid = datasetStore.currentDataset()?.id;
    const ports = session.backendPorts()?.schemas;
    if (!dataset || !ports || !datasetStore.isWeSpace()) {
      batch(() => {
        setOwnInvolvementTypes([]);
        setInvolvementTypesLoaded(true);
      });
      return;
    }
    setInvolvementTypesLoaded(false);
    try {
      // Every space predates the entity; `ensure` is the diff-first install the task states use.
      await ports.ensure(dataset, InvolvementType);
      const records = (await InvolvementType.findAll(dataset)) as InvolvementType[];
      if (datasetStore.currentDataset()?.id !== uuid) return;
      const stamp = (r: InvolvementType) =>
        isoOf((r as unknown as { timestamp?: unknown; createdAt?: unknown }).timestamp ?? r.createdAt);
      setOwnInvolvementTypes(
        [...records]
          .sort((a, b) => stamp(a).localeCompare(stamp(b)))
          .map((r) => ({
            id: r.id,
            name: r.name || r.slug,
            slug: r.slug || deriveSlug(r.name || ''),
            semantic: INVOLVEMENT_SEMANTICS.includes(r.semantic) ? r.semantic : 'responsible',
            reflexive: Boolean(r.reflexive),
            appliesTo: parseAppliesTo(r.appliesTo),
            icon: r.icon || '',
            color: r.color || '',
            retired: Boolean(r.retired),
          })),
      );
    } catch (error) {
      console.warn('SpaceStore: could not read involvement types', error);
      if (datasetStore.currentDataset()?.id === uuid) setOwnInvolvementTypes([]);
    } finally {
      if (datasetStore.currentDataset()?.id === uuid) setInvolvementTypesLoaded(true);
    }
  }

  /*
    Per space on screen. Followed on what the read itself asks of — the dataset, whether it is one of
    WE's spaces, the backend — so a backend reached afresh reads the kinds again.
  */
  effect(() => {
    void datasetStore.currentDataset()?.id;
    void datasetStore.isWeSpace();
    void session.backendPorts();
    untrack(() => {
      // A hold is a promise about records on the screen being left; see `involvementOptimism.reset`.
      involvementOptimism.reset();
      signalOptimism.reset();
      // The order a record's reactions settled into is a promise about the same screen. See
      // `signalOrder`.
      signalOrder.reset();
      void loadInvolvementTypes();
    });
  });

  const involvementTypes = memo<InvolvementTypeView[]>(() => resolveInvolvementTypes(ownInvolvementTypes()));
  const offeredInvolvementTypes = memo<InvolvementTypeView[]>(() => involvementTypes().filter((kind) => !kind.retired));

  const involvements = createInvolvementActions({
    dataset: () => datasetStore.currentDataset()?.handle,
    me: () => session.me()?.did,
    types: () => involvementTypes(),
    notify: (message) => toasts.error(message),
    ...involvementOptimism.ports,
  });

  /**
   * A change to the space's kinds of involvement, then the one read the screen has of them — they
   * are read on entering a space rather than followed.
   */
  async function changeInvolvementType(operation: string, args: Record<string, unknown>, failure: string) {
    try {
      await runCore(operation, args);
    } catch (error) {
      reportOperation('change a kind of involvement', failure, error);
      return;
    }
    await loadInvolvementTypes();
  }

  /**
   * Name a kind of part — "Shepherd", "Second pair of eyes" — through `core.createInvolvementType`,
   * which refuses a slug the community already has. `reflexive` is fixed at creation and not offered
   * for editing: turning an assignment into an answer would leave every existing one claiming
   * somebody said something they never said.
   */
  async function createInvolvementType(config: {
    name: string;
    semantic?: InvolvementSemantic;
    reflexive?: boolean;
    appliesTo?: string;
    icon?: string;
    color?: string;
  }): Promise<void> {
    if (!config?.name?.trim()) return;
    await changeInvolvementType(
      'createInvolvementType',
      {
        name: config.name,
        semantic: config.semantic,
        reflexive: config.reflexive,
        appliesTo: parseAppliesTo(config.appliesTo ?? '').join(','),
        icon: config.icon,
        color: config.color,
      },
      'Could not add that kind',
    );
  }

  /** Change a kind — see `updateTaskState` for why the slug is absent and an empty string clears. */
  async function updateInvolvementType(
    slug: string,
    updates: { name?: string; icon?: string; color?: string; semantic?: InvolvementSemantic; appliesTo?: string },
  ): Promise<void> {
    if (!slug || !updates) return;
    await changeInvolvementType(
      'updateInvolvementType',
      {
        slug,
        name: updates.name,
        icon: updates.icon,
        color: updates.color,
        semantic: updates.semantic,
        appliesTo: updates.appliesTo === undefined ? undefined : parseAppliesTo(updates.appliesTo).join(','),
      },
      'Could not save that change',
    );
  }

  /** Withdraw a kind, or bring it back — `setTaskStateRetired`'s decision, one vocabulary along. */
  async function setInvolvementTypeRetired(slug: string, retired: boolean): Promise<void> {
    if (!slug) return;
    await changeInvolvementType('setInvolvementTypeRetired', { slug, retired }, 'Could not update that kind');
  }

  /**
   * Join or leave a node's participant roster — an event RSVP, a document's co-editor list.
   *
   * **Writes only this agent's own entry, ever.** That is not a convenience, it is what keeps
   * `participants` conflict-free: it is a relation with no way to refuse a duplicate, so it behaves
   * as a set exactly as long as each agent writes itself and nobody else. A caller that appended
   * every member it could see is what turned the transcribe module's roster into a multiset that
   * grew each session — see the note on `WeNode.participants`.
   *
   * No read-modify-write for the same reason: `addParticipants` and `removeParticipants` are single
   * relation writes, so two agents RSVPing at the same moment cannot drop each other.
   */
  async function setAttending(nodeId: string, attending: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const me = session.me()?.did;
    if (!p || !nodeId || !me) return;
    try {
      const node = await CollectionBlock.findOne(p, { where: { id: nodeId } });
      if (!node) return;
      if (attending) await node.addParticipants(me);
      else await node.removeParticipants(me);
    } catch (error) {
      console.error('SpaceStore: could not update attendance', error);
      toasts.error('Could not update your RSVP');
    }
  }

  /**
   * Withdraw a signal type from use, or bring it back — without touching what people gave.
   *
   * ## Why this is not a delete
   *
   * A `Signal` names its type by **record id** (`signalTypeId`), not by slug, while every template
   * resolves the type by slug at render time — `find(local.signalTypes, { slug: 'like' }).id`.
   * Three things follow, and they decide the whole design:
   *
   * - Deleting the type removes nothing. Every reaction ever given stays in the dataset, now
   *   naming an id nothing resolves, counted by no projection and rendered by nothing.
   * - Re-creating a type with the same slug does not bring them back either. The backend mints a
   *   fresh record id, so the old rows still name the dead one. "Delete it and add it back" loses the
   *   history permanently, which is exactly the thing a person would expect to be safe.
   * - Cascading the delete instead — sweeping up every `Signal` with that id — is worse than it
   *   looks. It is thousands of sequential removals in an established space; it destroys *other
   *   members'* reactions on one person's click, in a shared space every member can write to; it
   *   cannot be undone; and it cannot even be guaranteed, since a peer who was offline during the
   *   sweep, or who reacted concurrently, re-orphans immediately.
   *
   * So the reversible option is the right one, and it is the one this codebase already chose one
   * layer up: `shapeStore.deleteShape` removes a model definition and says plainly that "records
   * already created keep their data — only the definition goes". A signal type is the same kind of
   * thing, and deserves the same answer.
   *
   * Retired, the type stops being offered anywhere a reaction can be given. The signals stay,
   * `find()` by slug still resolves it so existing counts keep working, and un-retiring restores
   * every reaction exactly as it was — because nothing was ever removed.
   *
   * Positively phrased so a switch can pass `event.detail` bare, matching `setAgentMuted` and
   * `setViewVisible`.
   */
  async function setSignalTypeRetired(signalTypeId: string, retired: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;

    try {
      await SignalType.update(p, signalTypeId, { retired });
    } catch (error) {
      console.error('SpaceStore: could not change whether a signal type is retired', error);
      toasts.error(retired ? 'Could not retire that reaction' : 'Could not restore that reaction');
    }
  }

  /*
    One reaction write at a time, per record-and-type pair.

    `upsertSignal` reads before it writes, so two calls for the same pair both read first: both find
    the same stored record, both delete it, and both create a replacement. That is how one person
    came to be listed twice under one signal type with the same value — and it is not a bug in
    whatever called twice, because a read-then-write is racy against any second caller at all.

    Per pair rather than globally: reacting to one post has no reason to wait on a reaction to
    another. See `oneAtATime`.
  */
  const queueSignalWrite = oneAtATime();

  /**
   * Give a reaction, or change one — and `null` withdraws it.
   *
   * ## Why a withdrawal is its own value rather than a zero
   *
   * It was a zero, and that made **0 unstorable**. Every mode whose range includes it lost the
   * answer: a 0–100 mood slider dragged to the bottom was written as "did not answer", so the
   * strongest thing somebody could say was the one thing the average then ignored. Silent, and
   * invisible from the call site — `upsertSignal(node, type, 0)` reads like storing a nought.
   *
   * A toggle and a vote are unaffected, because there 0 genuinely IS absence. That is what let the
   * overload survive: it is correct for two of the four modes, and the two it is wrong for are the
   * two whose range a community chooses.
   */
  async function upsertSignal(nodeId: string, signalTypeId: string, value: number | null): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const myDid = session.me()?.did;
    if (!p || !myDid) return;

    /*
      Drawn on the press, before anything is read.

      A reaction is the worst case there is for the round trip: it is a press-and-see control, and
      the answer comes back through a subscription about a second later — with the backend's own
      debounce under that. Held here, the glyph fills and the count moves on the click; `reactions`
      is where the hold meets the list every surface draws from.
    */
    signalOptimism.hold(nodeId, signalTypeId, value);

    await queueSignalWrite(`${nodeId}|${signalTypeId}`, async () => {
      /*
        The writes are `core.upsertSignal` and `core.withdrawSignal`: every reaction of mine on this
        type is found, one is kept and edited in place, and the rest are removed, so a pair written
        twice heals on the next change. A withdrawal — `null` — removes the record rather than storing
        anything, which keeps a withdrawn reaction absent everywhere instead of being a row every count
        has to remember to exclude. A zero is an ordinary value and is stored like any other.
      */
      try {
        const args = { node: nodeId, signalType: signalTypeId };
        if (value === null) await runOperation('core.withdrawSignal', args, { dataset: p, invoker: myDid });
        else await runOperation('core.upsertSignal', { ...args, value }, { dataset: p, invoker: myDid });
        // The write is back. Not a release — what retires a hold is the data moving — but it ends
        // the hold's exemption from what the next draw says. See `@we/optimism`.
        signalOptimism.done(nodeId, signalTypeId);
      } catch (error) {
        // What is on screen is a lie the moment the write is refused.
        signalOptimism.release(nodeId, signalTypeId);
        console.error('SpaceStore: could not record that reaction', error);
        toasts.error('Could not record that reaction.');
      }
    });
  }

  /**
   * Take back this agent's reaction of one type on one record.
   *
   * Its own action rather than `upsertSignal(node, type, 0)`: on a mode whose range includes zero a
   * nought is a rating, so the two acts are spelled apart and a schema says which one it means.
   */
  async function withdrawSignal(nodeId: string, signalTypeId: string): Promise<void> {
    await upsertSignal(nodeId, signalTypeId, null);
  }

  const members: Pick<
    SpaceStore,
    | 'involvementTypes'
    | 'offeredInvolvementTypes'
    | 'involvementTypesLoaded'
    | 'setInvolvement'
    | 'respondTo'
    | 'createInvolvementType'
    | 'updateInvolvementType'
    | 'setInvolvementTypeRetired'
    | 'setAttending'
    | 'setSignalTypeRetired'
    | 'upsertSignal'
    | 'withdrawSignal'
  > = {
    involvementTypes,
    offeredInvolvementTypes,
    involvementTypesLoaded,
    setInvolvement: involvements.setInvolvement,
    respondTo: involvements.respond,
    createInvolvementType,
    updateInvolvementType,
    setInvolvementTypeRetired,
    setAttending,
    setSignalTypeRetired,
    upsertSignal,
    withdrawSignal,
  };

  return { members };
}

export type SpaceInvolvements = ReturnType<typeof createSpaceInvolvements>;
