/**
 * The canvas card write group.
 *
 * `RecordStore.createCardOnCanvas` is the live caller. A class-backed card uses the same function
 * rather than a second write with its own id. The card's id is whatever the registered collection
 * model's `create` assigns inside `createBlocks`. Nothing here mints one.
 *
 * One `runEntityTransaction` wraps the card and, when a point was given, its placement. They commit
 * together only where the connected backend's runner commits the batch when the callback settles
 * and discards it when the callback throws. Until a backend registers a runner, the default runs
 * the callback with no token and each write commits on its own (`entityRegistry.ts`). This module
 * does not delete a partial group afterwards. A cleanup that sometimes ran would claim a rollback
 * the runner did not perform, and a failed cleanup swallowed on the way out would hide that the
 * group was still there.
 */
import type { ParentRef } from '@we/backend-shared';
import { type ContentInput, createBlocks } from '@we/block-shared';
import { Placement, runEntityTransaction } from '@we/entities';

/**
 * Write one placement, node reference included, inside whatever write group the caller is in.
 *
 * The reference goes in as a **one-element array**, which is what makes it part of the same commit.
 * The ORM skips a relation field handed a plain value — that is the trap `Relationship`'s endpoints
 * hit — and the generated `setNode` accessor takes no batch, so linking afterwards would commit
 * separately and reintroduce the intermediate state.
 * An array value routes through `setRelationValues` *with* the batch, which is the documented path
 * and the only one that composes.
 */
export async function createPlacement(
  dataset: unknown,
  parent: ParentRef,
  nodeId: string,
  nodeType: string,
  at: { x: number; y: number },
  batchId?: string,
): Promise<void> {
  await Placement.create(
    dataset,
    { nodeType, x: at.x, y: at.y, node: [nodeId] },
    { parent, ...(batchId ? { batchId } : {}) },
  );
}

export interface CanvasCardWriteInput {
  /** Dataset handle the models and `runEntityTransaction` receive. */
  dataset: unknown;
  /** The canvas. The placement's parent. */
  canvas: string;
  /**
   * Where the card's content is parented. The live caller passes `contentHome(canvas) ?? canvas`,
   * which is the canvas itself when the shell has not named a separate home.
   */
  contentHomeId: string;
  /** The composition `createBlocks` stores. A class card with no body passes an empty block list. */
  content: ContentInput;
  /** Where the card sits. Omitted, the card is created and not placed — the toolbar path. */
  at?: { x: number; y: number };
}

/**
 * Compose a card onto a canvas and place it, in one write group.
 *
 * `createBlocks` transacts internally, so it takes the batch rather than opening its own. The
 * placement joins that batch. Answers with the card id the model assigned, or `undefined` when
 * the collection model created nothing.
 */
export async function writeCanvasCard(input: CanvasCardWriteInput): Promise<{ id: string } | undefined> {
  const parent: ParentRef = { id: input.canvas, relation: 'children', entity: 'CollectionBlock' };
  const home: ParentRef = { id: input.contentHomeId, relation: 'children', entity: 'CollectionBlock' };

  return runEntityTransaction(input.dataset, async (tx) => {
    const root = (await createBlocks(input.dataset, input.content, {
      kind: 'card',
      anchor: home,
      batchId: tx.batchId,
    })) as { id?: string } | undefined;

    if (!root?.id) return undefined;
    if (!input.at) return { id: root.id };
    await createPlacement(input.dataset, parent, root.id, 'CollectionBlock', input.at, tx.batchId);
    return { id: root.id };
  });
}
