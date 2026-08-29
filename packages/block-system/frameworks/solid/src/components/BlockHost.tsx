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
  /**
   * Go to whatever a record reference names — see `@we/backend-shared`'s `recordRef`.
   *
   * Host knowledge for the same reason `dataset` is: a block holding
   * `we:n:<cid>/CollectionBlock/<id>` has exactly one sensible destination, and reaching it means
   * knowing the route a record's page is mounted at, which side of a shared/personal space the URL
   * segment comes from, and how to join a space that is not joined yet. None of that is a block's
   * business, and a prop threaded from every call site would be the `perspective` string all over
   * again.
   *
   * **Absent** where there is nowhere to go: the editor's preview, a screenshot harness, a host with
   * no router. Absent rather than a no-op on purpose — a consumer has to be able to tell "follow
   * this" from "this cannot be followed", and a function that silently does nothing looks like the
   * first while behaving like the second. A reference card then renders as content rather than as a
   * control that absorbs a press. See `EmbedDisplay`.
   */
  openRef?: (ref: string) => void;
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
  openRef?: (ref: string) => void;
  children: JSX.Element;
}) {
  const parent = useContext(BlockHostContext);
  const value: BlockHostValue = {
    dataset: () => (props.dataset ? props.dataset() : parent.dataset()),
    mentions: () => (props.mentions ? props.mentions() : parent.mentions()),
    collab: (nodeId) => (props.collab ? props.collab(nodeId) : parent.collab(nodeId)),
    collabUser: () => (props.collabUser ? props.collabUser() : parent.collabUser()),
    openRef: props.openRef ?? parent.openRef,
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
