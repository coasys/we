# Persistence

Persistence writes a composition as models and reads it back. `createBlocks` saves a new composition, `reconcileBlocks` saves an edit, and `loadBlocks` rebuilds a composition from its models. A collection's `mode` (`document`, `feed` or `collaborative`) controls which of these may write to it.

**Why:** An edit computes its removals against the keys that the author loaded (`document.base`), so a block that another agent added in the meantime is kept. `reconcileBlocks` refuses a `feed` collection, because in a container that many agents write to, a removal pass would delete every message that the editor's document does not name (`reconcileBlocks` comment).

**Parent:** [Blocks](README.md)

<details><summary>How it works</summary>

**Modes** (`CollectionMode`):

| Mode | Who writes | Write path |
|---|---|---|
| `document` | One agent authors one artifact: a post, a reply, a message. | `createBlocks`, then `reconcileBlocks`. |
| `feed` | Many agents append: a channel, a board, a call record. No `editorState`. | Append (`createBlocks` with an `anchor`, or `record.create`). |
| `collaborative` | Many agents edit one artifact in one live session. | A save writes the merged session document to the models. |

`isReconcilable` is an allow-list: `document`, `collaborative`, and an absent mode (posts written before the field existed). `kind` is a free label with no registry.

**Save** (`createBlocks(dataset, document, { kind, mode, anchor, batchId, fields, relations })`):
1. Uploads file assets first, so the records and the blob agree about each asset.
2. Creates one model for each block, linked through `children`, in one write group (`runEntityTransaction`).
3. Writes the Portable Text blob and the `textContent` search text on the root, and the mention relations.
4. Stamps each block's `_key` with its model id.

`mode` defaults to `document` when a `kind` is given.

**Edit** (`reconcileBlocks(dataset, root, document)`): updates the blocks whose `_key` is still there, creates the others, and removes only what was in `base` and is now absent.

**Load:** `decodeEditorState(blob)` reads the blob. `loadBlocks(dataset, rootId)` rebuilds the composition from `children` when the root has no blob (for example a call record) or when the blob is behind the models.

Other functions: `createBlock`, `deleteBlocks`, `copyableContent` (content to copy into another space), `extractTextContent`, `extractMentions`. The fields that go into the search text are listed for each block type in `TEXT_FIELDS_BY_TYPE`.

</details>

<details><summary>Where in the code</summary>

- [packages/block-system/shared/src/serialization.ts](../../../packages/block-system/shared/src/serialization.ts): `createBlocks`, `CreateBlocksOptions`, `reconcileBlocks`, `loadBlocks`, `childrenToBlocks`, `copyableContent`.
- [packages/block-system/shared/src/modes.ts](../../../packages/block-system/shared/src/modes.ts): `CollectionMode`, `isCollectionMode`, `isReconcilable`.
- [packages/block-system/shared/src/utils.ts](../../../packages/block-system/shared/src/utils.ts): `decodeEditorState`.
- [packages/block-system/shared/src/content.ts](../../../packages/block-system/shared/src/content.ts): `ContentDocument`, `toPortableText`.

</details>
