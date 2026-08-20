import type { BlockDataset } from '@we/block-shared';
import { createContext, type JSX, useContext } from 'solid-js';

/**
 * Where blocks read and write, when nobody says otherwise.
 *
 * ## Why this exists
 *
 * Every template that rendered or composed a block carried this, verbatim:
 *
 * ```ts
 * perspective: { $store: 'datasetStore.currentDataset.handle' }
 * ```
 *
 * Eight files in this repo alone, and it would have been in every template anyone ever wrote. It is
 * backend plumbing quoted as a string path — the template naming an AD4M perspective, reaching
 * through a store it should not need to know about, to answer a question with exactly one sensible
 * answer: *the space you are in*. Forget it and the block renders blank, because an image's
 * expression URL cannot resolve without it. That is a poor trade for a value the host already knows.
 *
 * The host provides it once. A block that wants a different one still says so — the prop wins, which
 * is what the editor's preview needs when it renders a block from another space.
 *
 * ## Why a context rather than a renderer special case
 *
 * The schema renderer could have injected it for these component types, but then "which components
 * secretly receive a dataset" becomes renderer knowledge, and the renderer's whole job is not to
 * know anything about the components it mounts. A context is the ordinary answer, and it works the
 * same for a hand-written Solid component as for a schema-mounted one.
 */
const BlockDatasetContext = createContext<() => BlockDataset | null>(() => null);

export function BlockDatasetProvider(props: { dataset: () => BlockDataset | null; children: JSX.Element }) {
  return <BlockDatasetContext.Provider value={props.dataset}>{props.children}</BlockDatasetContext.Provider>;
}

/**
 * The dataset a block should use: the one it was given, else the one it is being rendered in.
 *
 * Called as an accessor rather than resolved once, because the host's current dataset changes when
 * the user moves between spaces and a block rendered before the switch must not keep reading the
 * space they left.
 */
export function useBlockDataset(explicit?: BlockDataset | null): BlockDataset | null {
  const fromContext = useContext(BlockDatasetContext);
  return explicit ?? fromContext();
}
