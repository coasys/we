/**
 * The record store's drops: something dragged in from elsewhere — another space, the Pocket, a note —
 * taken into the space on screen, onto a feed or onto a canvas where it landed.
 *
 * A copy for the author's own things, a quote for anybody else's — the table is `shared/bringIn.ts`;
 * this is the store's half, reading and writing through the datasets it holds. Things already in this
 * space are only placed. Each new post offers an undo.
 */
import { datasetIdOf, datasetKey, datasetKindOf, formatRef, HERE } from '@we/backend-shared';
import { copyableContent, createBlock, deleteBlocks, writePost } from '@we/block-shared';
import { CollectionBlock } from '@we/entities';

import { bringIn as decideBringIn, type BringInItem, type BroughtIn } from '../../bringIn';
import { notifyCopiedIn } from '../../registries/moduleHostServices';
import type { AppDataset } from '../DatasetStore';
import type { RecordStore } from '../RecordStore';
import type { RecordCanvas } from './canvas';
import type { RecordContext } from './context';
import type { RecordKinds } from './kinds';

export interface RecordDropsDeps extends RecordContext {
  kinds: Pick<RecordKinds, 'schemaFor'>;
  canvas: Pick<RecordCanvas, 'writePlacement' | 'placeOnCanvas'>;
  /** Where content made on `canvas` lives — see `RecordStore.provideContentHomes`. */
  contentHome: (canvas?: string) => string | undefined;
}

export type RecordDrops = Pick<RecordStore, 'dropOnCanvas' | 'bringIn'>;

export function createRecordDrops(deps: RecordDropsDeps): RecordDrops {
  const { toasts, datasetStore, sessionStore: session, kinds, contentHome } = deps;
  const { schemaFor } = kinds;
  // Named apart from the canvas a drop lands on, which every action here takes as `canvas`.
  const placing = deps.canvas;

  async function dropOnCanvas(
    canvas: string,
    payload: { entity: string; id: string; dataset?: string; x: number; y: number },
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !canvas || !payload?.id || !payload.entity) return;
    // The same spelling a stored reference uses for this dataset, so a row gathered here and dragged
    // back out compares equal to the space it came from.
    const here = datasetKey({ cid: dataset.sharedUri, uuid: dataset.id });
    const from = payload.dataset ?? '';
    if (from && from !== HERE && from !== here) {
      /*
        Something from elsewhere becomes a post here first — a copy or a quote, the rule every drop
        into a space follows — and that post is what goes on the canvas. A canvas can only draw this
        space's records, and placing a coordinate for a record in another dataset drew nothing.

        A single block is brought in *alone* — a copy of the picture, or a lone embed — and belongs to
        the canvas the way a card composed on it does. A post holding one picture was a card around
        nothing. A whole post or note still arrives as a post.
      */
      const brought = await bringOne(
        { ...payload, ref: { entity: payload.entity, id: payload.id, dataset: from } },
        { canvas },
      );
      /*
        `writePlacement` rather than `placeOnCanvas`, so this leaves no undo entry.

        Bringing something in from another space *creates* a record here, and the canvas history is
        arrangement only — an entry for it would undo by removing the placement, which leaves the new
        record behind, loose and usually parked back in the corner by the tray. The act already has
        its own way back: `bringOne` raises a toast with Undo that deletes what it made.
      */
      if (brought) await placing.writePlacement(canvas, brought.id, brought.entity, payload.x, payload.y);
      return;
    }
    if (!schemaFor(payload.entity)) {
      toasts.error('That is not something a canvas can hold.');
      return;
    }
    // A record that is already in this space is only being *placed*, which is an arrangement act
    // like a drag — so it is undoable, and undoing it takes the card off the canvas again.
    await placing.placeOnCanvas(canvas, payload.id, payload.entity, payload.x, payload.y);
  }

  /** The dataset a reference's key names, if this agent holds it. */
  function heldDataset(key: string): AppDataset | undefined {
    const id = datasetIdOf(key);
    if (datasetKindOf(key) === 'personal') return datasetStore.datasets().find((d) => d.id === id);
    return datasetStore.datasets().find((d) => d.sharedId === id);
  }

  /**
   * One dropped thing into the space on screen, with its undo and its announcement.
   *
   * The decision is `shared/bringIn.ts`; this is the store's half — reading and writing through the
   * datasets it holds, and telling modules, since a note shared by dragging is shared as surely as
   * one shared with the button.
   */
  async function bringOne(item: BringInItem, into: { canvas?: string } = {}): Promise<BroughtIn | null> {
    const here = datasetStore.currentDataset();
    if (!here) return null;
    const hereKey = datasetKey({ cid: here.sharedUri, uuid: here.id });
    try {
      const result = await decideBringIn(
        item,
        {
          hereKey,
          me: session.me()?.did,
          held: (key) => {
            const ds = heldDataset(key);
            return ds ? { handle: ds.handle, name: ds.name } : null;
          },
          readPost: async (handle, id) => {
            const post = await CollectionBlock.findOne(handle, { where: { id } });
            return post ? { author: post.author, editorState: post.editorState } : null;
          },
          copyable: (handle, editorState, only) => copyableContent(handle, editorState, only),
          write: async (blocks, fields) => {
            const invoker = session.me()?.did;
            if (!invoker) return null;
            const home = contentHome();
            const id = await writePost(here.handle, blocks, {
              invoker,
              kind: 'post',
              fields,
              ...(home ? { container: home } : {}),
            });
            return id ? { id } : null;
          },
          // Owned by the canvas, as a card composed on it is — deleting the canvas takes it.
          writeBlock: into.canvas
            ? async (block) =>
                (await createBlock(here.handle, block, {
                  anchor: {
                    id: contentHome(into.canvas) ?? into.canvas!,
                    relation: 'children',
                    entity: 'CollectionBlock',
                  },
                })) ?? null
            : undefined,
        },
        { alone: !!into.canvas },
      );
      if (!result) return null;

      // Posts only: a block written alone is not a post that arrived, and a note's share is the note.
      if (result.entity === 'CollectionBlock') {
        const to = formatRef({ datasetKey: hereKey, entity: 'CollectionBlock', id: result.id });
        notifyCopiedIn({ from: result.from, to, mode: result.mode, spaceName: here.name });
      }
      const message =
        result.mode === 'quote' ? 'Quoted here' : result.entity === 'CollectionBlock' ? 'Posted here' : 'Added here';
      toasts.success(message, 8000, {
        label: 'Undo',
        run: () => void deleteBlocks(here.handle, result.id).catch(() => toasts.error('Could not undo that.')),
      });
      return result;
    } catch (error) {
      console.error('RecordStore: bringing something into the space failed', error);
      toasts.error('Could not add that here.');
      return null;
    }
  }

  async function bringIn(payload: { items?: BringInItem[] } | undefined): Promise<void> {
    for (const item of payload?.items ?? []) {
      if (item?.ref?.entity && item.ref.id) await bringOne(item);
    }
  }

  return { dropOnCanvas, bringIn };
}
