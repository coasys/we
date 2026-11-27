/**
 * The kinds of involvement and reaction a space names, and joining a record's roster. Part of
 * `SpaceStore` — see `../SpaceStore.ts`.
 *
 * The vocabulary is held here, for the reason task states are: a template can filter a list it was
 * handed and cannot substitute one it was not. The involvements and reactions themselves are not —
 * they change with every click anybody makes, so a template holds them in a live query, reads them
 * through the `involvement` host function and the record's own `signals`, and writes them straight
 * through `core.respond`, `core.upsertSignal` and `core.withdrawSignal` (and `setInvolvement` here,
 * see there), which the host draws before they land. What is drawn is a promise about the space on screen, so it is
 * dropped when that changes.
 */
import { CollectionBlock, type InvolvementSemantic, InvolvementType, SignalType } from '@we/entities';

import { distinctSignal } from '../../distinctSignal';
import { isoOf } from '../../interpretation/callExport';
import {
  INVOLVEMENT_SEMANTICS,
  type InvolvementTypeView,
  parseAppliesTo,
  resolveInvolvementTypes,
} from '../../involvements';
import type { signalOrder } from '../../signalOrder';
import { deriveSlug } from '../../utils';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';

export interface SpaceInvolvementsDeps extends SpaceContext {
  /** The order each record's reactions settled into — the app's one, forgotten with the space. */
  signalOrder: Pick<typeof signalOrder, 'reset'>;
}

export function createSpaceInvolvements(deps: SpaceInvolvementsDeps) {
  const { reactivity, toasts, sessionStore: session, datasetStore, runCore, reportOperation, signalOrder } = deps;
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
      // A write drawn before it landed is a promise about the screen being left.
      deps.operations.predictions.clear();
      // The order a record's reactions settled into is a promise about the same screen. See
      // `signalOrder`.
      signalOrder.reset();
      void loadInvolvementTypes();
    });
  });

  const involvementTypes = memo<InvolvementTypeView[]>(() => resolveInvolvementTypes(ownInvolvementTypes()));
  const offeredInvolvementTypes = memo<InvolvementTypeView[]>(() => involvementTypes().filter((kind) => !kind.retired));

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
   * Put somebody on a record, or take them off — `core.setInvolvement`, invoked as every operation
   * is, so the tick is drawn before it lands and presses on one pair are written in order.
   *
   * A store action rather than a template's `ops.core.setInvolvement`, for one reason: taking
   * somebody off deletes an involvement another member may have made, so the operation is
   * destructive by its effect summary, and a template invoking it would be asked to confirm every
   * untick. Invoked from here it is not, as assigning never was.
   */
  async function setInvolvement(nodeId: string, agent: string, kind: string, on: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const me = session.me()?.did;
    if (!p || !me || !nodeId || !agent || !kind) return;
    await deps.operations
      .invoke(
        'core.setInvolvement',
        { node: nodeId, agent, kind, on },
        { dataset: p, invoker: me, notify: (message) => toasts.error(message), failure: 'Could not save that' },
      )
      .catch(() => undefined);
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
   * - Re-creating a type with the same slug brings the id back — a type's id derives from its slug —
   *   but not what it was: its mode, range and reading are whatever the new one is given, so the old
   *   rows are read by a type that may no longer mean what they were given as. "Delete it and add it
   *   back" is not the safe round trip a person would expect.
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

  const members: Pick<
    SpaceStore,
    | 'involvementTypes'
    | 'offeredInvolvementTypes'
    | 'involvementTypesLoaded'
    | 'setInvolvement'
    | 'createInvolvementType'
    | 'updateInvolvementType'
    | 'setInvolvementTypeRetired'
    | 'setAttending'
    | 'setSignalTypeRetired'
  > = {
    involvementTypes,
    offeredInvolvementTypes,
    involvementTypesLoaded,
    setInvolvement,
    createInvolvementType,
    updateInvolvementType,
    setInvolvementTypeRetired,
    setAttending,
    setSignalTypeRetired,
  };

  return { members };
}

export type SpaceInvolvements = ReturnType<typeof createSpaceInvolvements>;
