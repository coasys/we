/**
 * What people make in a space: posts and replies, the boards that arrange its work, files, and where
 * content with no other home lives. Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * The writes themselves are the block layer's (`writePost`, `reconcileBlocks`) and the boards'
 * (`shared/boards.ts`); what is here is which dataset, as whom, and what is said when one fails.
 */
import type { ContentInput } from '@we/block-shared';
import {
  contentHash,
  decodeEditorState,
  deleteBlocks,
  isContentDocument,
  reconcileBlocks,
  writePost,
} from '@we/block-shared';
import { CollectionBlock, compressImageToFileData, type DatasetProxy, dataURIToFileData } from '@we/entities';

import { createBoardActions } from '../../boards';
import { uploadOf } from '../../uploadOf';
import type { RecordStore } from '../RecordStore';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';
import type { SpaceNavigation } from './navigation';
import type { SpaceTaskStates } from './taskStates';
import type { CreatePostOptions } from './types';

export interface SpaceContentDeps extends SpaceContext {
  recordStore: Pick<RecordStore, 'provideContentHomes'>;
  navigation: { members: Pick<SpaceNavigation['members'], 'root' | 'landmarks'> } & Pick<
    SpaceNavigation,
    'reloadSpaceStructure'
  >;
  taskStates: Pick<SpaceTaskStates, 'offeredTaskStates' | 'boardWorkflow'>;
}

/** A file's contents as a data URI. */
const readAsDataURI = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    // `readAsDataURL` always yields a string.
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });

export function createSpaceContent(deps: SpaceContentDeps) {
  const { reactivity, toasts, sessionStore: session, datasetStore, recordStore, navigation, taskStates } = deps;
  const { onCleanup } = reactivity;
  const { root: spaceRoot, landmarks: spaceLandmarks } = navigation.members;
  const { reloadSpaceStructure } = navigation;

  async function createPost(json: unknown, options: CreatePostOptions = {}): Promise<string | undefined> {
    const p = datasetStore.currentDataset()?.handle;
    const me = session.me()?.did;
    if (!p || !me) return;

    // The anchor is what makes one action serve every composed artifact. A post has none — it sits
    // in the space. A message names its channel through `children`; a reply names whatever it
    // answers through `responses`. Both arrive from a schema as ids, which is all a template
    // has, and both are `$each`/route values rather than anything the store could derive.
    // With no anchor named, a post goes in the space collection — the space's top level — rather than
    // nowhere. Read at the call, not destructured as a default, so a space entered after this store
    // was built still gets its own.
    const { kind = 'post', relation = 'children' } = options;
    const parentId = options.parentId ?? (spaceRoot() || undefined);

    // The action arrives from a schema as unknown; the composer produced it, so it is a content
    // document. The writes, threading a reply included, are `core.createPost`'s, as an agent's are.
    return writePost(p, json as ContentInput, {
      invoker: me,
      kind,
      ...(parentId && (relation === 'responses' ? { respondsTo: parentId } : { container: parentId })),
    });
  }

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    const document = json as ContentInput;

    // Somebody else may have saved this post while it was open here. A peer-to-peer store cannot
    // refuse the second writer — a write that has not arrived is invisible — so what it can do is
    // notice: the document carries a hash of the content as loaded, and the stored blob says what
    // is there now. Their blocks survive the save either way (reconcileBlocks keeps what the author
    // never loaded); a paragraph both agents edited resolves to whichever write is later, and that
    // is the one thing worth saying out loud.
    const loadedHash = isContentDocument(document) ? document.baseHash : undefined;
    const storedHash = loadedHash ? contentHash(decodeEditorState(existingRoot.editorState) ?? []) : undefined;
    const changedMeanwhile = !!loadedHash && !!storedHash && loadedHash !== storedHash;

    await reconcileBlocks(p, existingRoot, document);

    if (changedMeanwhile) {
      toasts.warning(
        'This post was changed by someone else while you were editing. Your version of anything you both changed was kept.',
        8000,
      );
    }
  }

  async function deleteCollection(collectionId: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    await deleteBlocks(p, collectionId);
  }

  /**
   * The dataset a board write means: the one named, or the space on screen.
   *
   * Named rather than assumed, because a board is not always made where the reader is looking — the
   * extraction hook runs wherever the election landed. It resolves the same dataset
   * `interpretCollection` does, which is the one the pass just wrote its records into, so a board
   * cannot land somewhere its own cards did not.
   */
  function datasetFor(uri?: string): DatasetProxy | undefined {
    if (!uri) return datasetStore.currentDataset()?.handle;
    return datasetStore.datasets().find((d) => d.sharedUri === uri || d.id === uri)?.handle;
  }

  /*
    The board writes, from `shared/boards.ts`.

    The board actions that need the host, and what they decide is the board design rather than anything about
    this store: which list to store, what a drop means, and the invariant that a board's children are
    columns. They live there because they are a subsystem rather than because this file is long — the
    ordering itself is the backend's, so what is left in them is meaning, and meaning reads better
    beside the rest of its own meaning.

    The store stays their **surface**: a template names `spaceStore.moveCardToColumn`, and where the
    implementation sits is not a template author's business. Only a few things reach outside the
    module, and they arrive as arguments — which dataset, what the community's states are and whether
    they ask for agreement, and how a failure reaches the person who caused it.
  */
  const boards = createBoardActions({
    dataset: datasetFor,
    invoker: () => session.me()?.did,
    offeredStates: () => taskStates.offeredTaskStates(),
    notify: (message) => toasts.error(message),
    landmarksChanged: () => void reloadSpaceStructure(),
    workflow: taskStates.boardWorkflow,
    /*
      A staged suggestion for one property, dropped — see `BoardDeps.resolveSuggestion`. Checked
      against the proposal list first rather than rejected blind, since a reject on a record with no
      overlay is refused, and most moves are of cards nobody proposed. Best-effort throughout: the
      move is the thing that matters, and a suggestion that survives is visible on the card.
    */
    resolveSuggestion: async (recordId, property) => {
      const port = session.backendPorts()?.interpretation;
      const dataset = datasetStore.currentDataset()?.handle;
      if (!port || !dataset) return;
      try {
        const pending = await port.proposals(dataset);
        if (!pending.some((proposal) => proposal.id === recordId && property in proposal.values)) return;
        await port.reject(dataset, recordId, property);
      } catch (error) {
        console.warn('SpaceStore: could not settle a staged suggestion before a move', error);
      }
    },
  });

  /*
    Where content lives: the space collection, for anything made on the space's own canvas and for
    anything made with no other home. See `provideContentHomes` — lent because the record store is
    composed before this one.
  */
  onCleanup(
    recordStore.provideContentHomes({
      forCanvas: (canvas) => (canvas === spaceLandmarks().canvas && spaceRoot() ? spaceRoot() : canvas),
      root: () => spaceRoot(),
    }),
  );

  /**
   * Store a file and return the URL that points at it.
   *
   * Images are compressed on the way through, for the reason the profile and space-image paths
   * already do it: a phone photo is several megabytes, and a space's content syncs to every member.
   * Anything else is stored as-is.
   */
  async function uploadFile(file: File, name?: string): Promise<string | null> {
    const profiles = session.backendPorts()?.profiles;
    if (!profiles) return null;
    try {
      const fileData = file.type.startsWith('image/')
        ? await compressImageToFileData(file, name ?? file.name)
        : // Non-images go through unchanged. `dataURIToFileData` is the same decode the image path
          // ends with, so both arrive at the port in one shape.
          dataURIToFileData(await readAsDataURI(file), name ?? file.name);
      return await profiles.uploadFile(uploadOf(fileData));
    } catch (error) {
      console.error('SpaceStore: upload failed', error);
      toasts.error('Could not upload that file.');
      return null;
    }
  }

  const members: Pick<
    SpaceStore,
    | 'createPost'
    | 'updatePost'
    | 'deleteCollection'
    | 'uploadFile'
    | 'openBoardFor'
    | 'ensureBoardFor'
    | 'addStateToSpaceBoard'
    | 'removeBoardColumn'
    | 'moveCardToColumn'
    | 'addTaskToColumn'
  > = {
    createPost,
    updatePost,
    deleteCollection,
    uploadFile,
    ...boards,
  };

  return { members };
}

export type SpaceContent = ReturnType<typeof createSpaceContent>;
