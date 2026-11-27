/**
 * What is new to this agent in a space and who it has chosen not to hear: its read markers and the
 * containers holding something newer, the messages naming it, and the accounts it has muted. Part of
 * `SpaceStore` — see `../SpaceStore.ts`.
 *
 * The markers and the mute list are this agent's own, kept in the root dataset beside its space
 * preferences and for the same reason: they are not any one space's, and a feed has to filter on the
 * mute list before it can draw a single row.
 */
import { CollectionBlock, MutedAgent, ReadMarker } from '@we/entities';

import {
  CONTAINER_ACTIVITY_QUERY,
  type ContainerActivity,
  mentionsOf,
  unreadContainerIds,
} from '../../containerActivity';
import type { SpaceStore } from '../SpaceStore';
import { type SpaceContext, withRow } from './context';

export function createSpaceUnread(deps: SpaceContext) {
  const { reactivity, toasts, sessionStore: session, datasetStore, runCore } = deps;
  const { memo, effect, untrack } = reactivity;

  const [readMarkers, setReadMarkers] = reactivity.signal<ReadMarker[]>([]);
  const [mutedAgents, setMutedAgents] = reactivity.signal<MutedAgent[]>([]);
  /**
   * The space's containers, read once for both unread dots and mentions — see `containerActivity.ts`.
   *
   * Once per space: marking a container read changes the markers, not the containers, so the unread
   * set is recomputed from these rows rather than by reading the space again.
   */
  const [activityRows, setActivityRows] = reactivity.signal<ContainerActivity[]>([]);
  const [mentionRows, setMentionRows] = reactivity.signal<{ id: string; author: string; createdAt: number }[] | null>(
    null,
  );

  effect(() => {
    const root = datasetStore.rootDataset();
    if (!root) {
      setReadMarkers([]);
      setMutedAgents([]);
      return;
    }
    void ReadMarker.findAll(root.handle)
      .then(setReadMarkers)
      .catch(() => setReadMarkers([]));
    void MutedAgent.findAll(root.handle)
      .then(setMutedAgents)
      .catch(() => setMutedAgents([]));
  });

  /**
   * Mark a node read, as of now.
   *
   * Upsert on `nodeId` — one marker per node, moved forward rather than accumulated. Called on
   * opening a channel, so it runs often and stays silent on failure: a lost marker shows a stale
   * unread dot, which is not worth a toast interrupting what the user opened the channel to do.
   */
  async function markRead(nodeId: string, spaceUuid?: string): Promise<void> {
    const root = datasetStore.rootDataset();
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!root || !nodeId || !uuid) return;
    try {
      const marker = await runCore<Partial<ReadMarker>>('markRead', { node: nodeId, space: uuid }, root.handle);
      setReadMarkers(withRow(untrack(readMarkers), marker));
    } catch (error) {
      console.error('SpaceStore: could not write read marker', error);
    }
  }

  effect(() => {
    const ds = datasetStore.currentDataset();
    setActivityRows([]);
    if (!ds) return;

    void (async () => {
      try {
        const rows = await CollectionBlock.findAll(ds.handle, CONTAINER_ACTIVITY_QUERY);
        // A read that lands after a space switch belongs to the space that was left.
        if (datasetStore.currentDataset() === ds) setActivityRows(rows);
      } catch (error) {
        console.error('SpaceStore: could not read container activity', error);
      }
    })();
  });

  /**
   * Containers holding something newer than this agent's marker for them.
   *
   * One read for the whole space rather than a projection per row: the rail asked the same question
   * for every channel, so a space with thirty channels opened thirty of them.
   */
  const unreadNodeIds = memo(() => unreadContainerIds(activityRows(), readMarkers()));

  /*
    Messages in this space naming this agent — posts and transcript lines alike, newest first.

    Asked from the agent's end, through the backend's references (`we://mention` to this DID): one
    lookup however many messages the space holds, and it finds a mention in a transcript line, which
    the container read above never could. Read again on entering the space and whenever its
    containers' activity changes — a new line in a running call is not one of those, and is found on
    the next. A backend that cannot answer falls back to filtering the container read, which is what
    this was.
  */
  effect(() => {
    const ds = datasetStore.currentDataset();
    const did = session.me()?.did;
    const references = session.backendPorts()?.references;
    void activityRows();
    setMentionRows(null);
    if (!ds || !did || !references) return;
    void references
      .referrers(ds.handle, { relation: 'mentions' }, did, { limit: 50 })
      .then((rows) => {
        if (datasetStore.currentDataset() !== ds) return;
        setMentionRows(rows.map((row) => ({ id: row.id, author: row.author, createdAt: Date.parse(row.at) || 0 })));
      })
      .catch((error: unknown) => console.warn('SpaceStore: could not read who mentions this agent', error));
  });
  const myMentions = memo(() => {
    const did = session.me()?.did;
    const found = mentionRows();
    if (found) return found;
    return did ? mentionsOf(activityRows(), did) : [];
  });

  /** Just the DIDs — what a feed filter wants, without every consumer mapping the records. */
  const mutedDids = memo(() => mutedAgents().map((m) => m.did));

  /**
   * Markers as `{ nodeId, lastReadAt }` rows.
   *
   * An array rather than a map keyed by node id, because **a schema cannot index a map
   * dynamically**: a store read resolves a static dot path, so `identity.readMarkers.<some context
   * ref>` is not expressible — the path would be taken literally. The read is always "this row's
   * marker" from inside a `$each`, which means `find()` over an array with a context ref in `where`,
   * the only form the resolver supports. Linear per rendered row, over a list the size of the
   * channels one agent has opened.
   */
  const readMarkerRows = memo(() => readMarkers().map((m) => ({ nodeId: m.nodeId, lastReadAt: m.lastReadAt })));

  /**
   * Mute or unmute an agent for this agent, everywhere.
   *
   * Phrased positively — `muted: boolean` — so a switch can pass `event.detail` bare; the same
   * constraint `setModuleVisible` documents.
   *
   * Reports failure, unlike `markRead`: this one was asked for deliberately, and someone who thinks
   * they have muted an account and has not is worse off than someone who knows it did not work.
   */
  async function setAgentMuted(did: string, muted: boolean, description = ''): Promise<void> {
    const root = datasetStore.rootDataset();
    if (!root || !did) return;
    try {
      await runCore('setAgentMuted', { did, muted, description }, root.handle);
      // What the operation leaves: one record while muted, none after. Its id is not needed to read it.
      const rows = untrack(mutedAgents);
      if (muted) {
        if (!rows.some((m) => m.did === did)) setMutedAgents([...rows, { did, description } as MutedAgent]);
      } else if (rows.some((m) => m.did === did)) {
        setMutedAgents(rows.filter((m) => m.did !== did));
      }
    } catch (error) {
      console.error('SpaceStore: could not update mute list', error);
      toasts.error(muted ? 'Could not mute that account' : 'Could not unmute that account');
    }
  }

  const members: Pick<
    SpaceStore,
    'readMarkers' | 'markRead' | 'unreadNodeIds' | 'myMentions' | 'mutedDids' | 'mutedAgents' | 'setAgentMuted'
  > = {
    readMarkers: readMarkerRows,
    markRead,
    unreadNodeIds,
    myMentions,
    mutedDids,
    mutedAgents,
    setAgentMuted,
  };

  return { members };
}

export type SpaceUnread = ReturnType<typeof createSpaceUnread>;
