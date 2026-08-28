import type { BlockDataset, MentionCandidate } from '@we/block-shared';
import { createContext, type JSX, useContext } from 'solid-js';

import type { CollabSession, CollabUser } from '../editor/collab';

/**
 * What the host tells the block system about where it is mounted.
 *
 * ## Why this exists
 *
 * Every template that rendered or composed a block carried this, verbatim:
 *
 * ```ts
 * perspective: { $: 'datasetStore.currentDataset.handle' }
 * ```
 *
 * Eight files in this repo alone, and it would have been in every template anyone ever wrote. It is
 * backend plumbing quoted as a string path — the template naming an AD4M perspective, reaching
 * through a store it should not need to know about, to answer a question with exactly one sensible
 * answer: *the space you are in*. Forget it and the block renders blank, because an image's
 * expression URL cannot resolve without it. That is a poor trade for a value the host already knows.
 *
 * The same argument holds for who can be @mentioned, and for how a live co-editing session
 * travels: the space's members and the ephemeral transport are the host's knowledge. The host
 * provides them once. A block that wants a different one still says so — the prop wins, which is
 * what the editor's preview needs when it renders a block from another space.
 *
 * ## Why a context rather than a renderer special case
 *
 * The schema renderer could have injected it for these component types, but then "which components
 * secretly receive a dataset" becomes renderer knowledge, and the renderer's whole job is not to
 * know anything about the components it mounts. A context is the ordinary answer, and it works the
 * same for a hand-written Solid component as for a schema-mounted one.
 */
export interface BlockHostValue {
  /** The dataset blocks read and write, when nobody says otherwise. */
  dataset: () => BlockDataset | null;
  /** Who can be mentioned in a composition here. */
  mentions: () => MentionCandidate[];
  /**
   * Open a live co-editing session on a composition, or null where none is possible — a personal
   * space has nobody to share with. The composer calls this when asked to `collaborate`.
   */
  collab: (nodeId: string) => CollabSession | null;
  /** How this agent appears to co-editors. */
  collabUser: () => CollabUser;
}

const NONE: BlockHostValue = {
  dataset: () => null,
  mentions: () => [],
  collab: () => null,
  collabUser: () => ({ name: 'Someone', color: 'hsl(210 70% 45%)' }),
};

const BlockHostContext = createContext<BlockHostValue>(NONE);

export function BlockHostProvider(props: {
  dataset?: () => BlockDataset | null;
  mentions?: () => MentionCandidate[];
  collab?: (nodeId: string) => CollabSession | null;
  collabUser?: () => CollabUser;
  children: JSX.Element;
}) {
  const parent = useContext(BlockHostContext);
  const value: BlockHostValue = {
    dataset: () => (props.dataset ? props.dataset() : parent.dataset()),
    mentions: () => (props.mentions ? props.mentions() : parent.mentions()),
    collab: (nodeId) => (props.collab ? props.collab(nodeId) : parent.collab(nodeId)),
    collabUser: () => (props.collabUser ? props.collabUser() : parent.collabUser()),
  };
  return <BlockHostContext.Provider value={value}>{props.children}</BlockHostContext.Provider>;
}

/** The host facts in force where this is called. */
export function useBlockHost(): BlockHostValue {
  return useContext(BlockHostContext);
}

/** Back-compat name: the dataset half of the host. */
export function BlockDatasetProvider(props: { dataset: () => BlockDataset | null; children: JSX.Element }) {
  return <BlockHostProvider dataset={props.dataset}>{props.children}</BlockHostProvider>;
}

/**
 * The dataset a block should use: the one it was given, else the one it is being rendered in.
 *
 * Called as an accessor rather than resolved once, because the host's current dataset changes when
 * the user moves between spaces and a block rendered before the switch must not keep reading the
 * space they left.
 */
export function useBlockDataset(explicit?: BlockDataset | null): BlockDataset | null {
  const host = useContext(BlockHostContext);
  return explicit ?? host.dataset();
}
