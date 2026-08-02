# Let post authors edit posts

## Summary

Adds post editing for post authors, completing the create/edit/delete trio (delete shipped on `dev` already). The interesting part isn't the UI — it's how saving an edit is persisted.

Posts are backed by an AD4M block tree: a root `CollectionBlock` linked to independently-addressable child block expressions (`ImageBlock`, `TextBlock`, etc.) via `we://children`. The naive way to "save an edit" is to delete the whole tree and recreate it from the editor's current content, exactly like creating a new post. That's simple but destructive: the post gets a new id (breaking any link to it and discarding its `signals`), and every contained block gets recreated even if the user only changed one word — destroying any identity/data attached to individual blocks (today that's nothing observable, but `WeNode` already exposes `comments`/`signals` generically on every block, not just posts, so it's not purely hypothetical).

Instead, this PR makes `createBlocks` stamp each block's AD4M id back into the saved `editorState` blob, and adds `reconcileBlocks`, which diffs an edited tree against what's already persisted: blocks whose id survived the edit are updated in place, blocks with no id (or a duplicate — e.g. a copy/pasted block) are created fresh, and existing blocks never matched during the walk are deleted. Reordering and reparenting fall out for free, since AD4M's relation-array assignment already does a full replace rather than an incremental diff.

Lexical's built-in node types for plain text (`ParagraphNode`, `HeadingNode`, `QuoteNode`, `ListItemNode`) don't round-trip arbitrary extra JSON fields the way our custom block nodes do, so text blocks initially had no way to carry an id through an edit session and were always recreated rather than reconciled in place. This is now closed using Lexical's `NodeState` API (`createState`/`$setState`/`$getState`), which attaches arbitrary serialized data to *any* node — built-in or custom — without subclassing, so text blocks are now reconciled exactly like every other block type.

Separately: after wiring all of this up, edits were persisting correctly but not showing up in the post list until navigating away and back. Root cause turned out to be unrelated to reconciliation itself — `BlockRenderer` destructured `editorState`/`perspective` directly in its component signature, which freezes their value at first mount in Solid (component functions run once, not on every prop change). Since the list deliberately reuses the existing mounted card for a post whose id is unchanged, the already-mounted renderer never saw the edited content. Fixed alongside the reconciliation work since it blocked verifying any of it end-to-end.

## Changes

- **`packages/block-system/shared/src/serialization.ts`**
  - `createBlocks` now stamps each created block's AD4M id back onto the tree before building the `editorState` blob (by running `preUploadFileAssets` *after* the persist walk instead of before, so its shallow copies pick up the ids `persistNode` just stamped in). This is the foundation reconciliation depends on — without it, a freshly-loaded post's tree has no way to tell "this block already exists" from "this is new."
  - `persistNode` — extracted from `createBlocks`'s former inner `persist` closure so `reconcileBlocks` can reuse the same node-creation logic for blocks it can't match against an existing one.
  - `reconcileBlocks(perspective, existingRoot, node)` — new. Walks the edited tree, matches nodes against the existing tree's ids (via a `collectDescendants` helper that hydrates every existing descendant once, reused for both matching and cleanup), updates/creates/deletes as needed, and overwrites each parent's `children` relation with the final ordered list once its subtree is settled.

- **`packages/block-system/shared/src/index.ts`** — exports `reconcileBlocks`.

- **`packages/block-system/frameworks/solid/src/nodes/blockIdState.ts`** — new. Defines the shared `blockId` `NodeState` config plus `stampBlockIdState` (lockstep-walks the live tree against the just-loaded JSON right after `editor.setEditorState`, calling `$setState` wherever the JSON has an `id`) and `promoteBlockIdState` (pure JSON transform promoting the `NodeState`-carried `blockId` back into a plain top-level `id` field on save, matching the shape our custom block nodes already produce). Wired into both `BlockComposer.tsx`'s load/save paths and `CollectionInput.tsx`'s (the nested collection sub-editor), since both register the same built-in text node types.

- **`packages/app-framework/src/frameworks/solid/stores/SpaceStore.tsx`** — adds `updatePost(postId, json)`, which loads the existing root `CollectionBlock` and hands off to `reconcileBlocks`.

- **`packages/app-framework/.../CardsRoute/PostComposerModal.ts`** — new. Extracts the "compose a post" modal (heading, `BlockComposer`, Cancel/Save buttons) into a `postComposerModal()` factory parameterized by title, save action, and optional initial `editorState`, since create and edit now share the same UI shape.

- **`packages/app-framework/.../CardsRoute/CreatePostModal.ts`** — refactored to call `postComposerModal()` instead of duplicating its structure.

- **`packages/app-framework/.../CardsRoute/PostsList.ts`** — adds a pencil icon next to the trash icon in each post's header (author-only, same `$eq` guard as delete), opening `postComposerModal()` prefilled with `$post.editorState` and saving via `spaceStore.updatePost` instead of `createPost`.

- **ai-context docs** (`CLAUDE.md`, `.cursor/rules/we-schema.mdc`, `.github/copilot-instructions.md`, `packages/ai-context/**`) — regenerated from the updated stores fragment to document `spaceStore.updatePost`.

- **`packages/block-system/frameworks/solid/src/components/BlockRenderer.tsx`** — stops destructuring `editorState`/`perspective` in the component signature; reads `props.editorState`/`props.perspective` live instead, all the way through `LoadEditorState`'s `createEffect`, so an edited post's new content actually reaches an already-mounted card instead of needing a remount to show up.

## Known follow-ups

- **Nested collection sub-editors** (a `collection` block's embedded mini-editor) go through the same `blockId`/`reconcileBlocks` machinery as everything else, but this path is less exercised — worth extra manual testing if nested collections are in active use.
- **Concurrent edits aren't conflict-checked.** Two overlapping saves on the same post compute their diffs against independently-loaded snapshots; this was already true of the old recreate-everything approach (no real regression), but reconciliation makes a partial/half-applied merge possible in a way a blunt delete-and-recreate wasn't.
- **Copy/pasting a block within the editor** duplicates its `id` onto the pasted copy (Lexical's clipboard path round-trips the same JSON, `NodeState` included). `reconcileBlocks` defends against this — only the first occurrence of a given id is reused, any later duplicate is treated as new — but it means the *first* matching node in document order wins the reuse, which usually but not always matches user intent (e.g. cut-and-pasting a block to reorder it relies on this).

## Test plan

- [x] `pnpm --filter @we/block-shared exec tsc --noEmit` — clean
- [x] `pnpm --filter @we/block-solid exec tsc --noEmit` — only pre-existing, unrelated baseline error (`LexicalNode` name resolution in `BlockKeyboardPlugin.tsx`)
- [x] `pnpm --filter @we/app-framework exec tsc --noEmit` — only pre-existing, unrelated baseline errors (`AdamStore` module resolution, `integrationLoader` test, `commands` property in `validator.test.ts`)
- [x] `pnpm --filter @we/block-shared build` / `pnpm --filter @we/block-solid build` / `pnpm --filter @we/app-framework build` — all succeed
- [x] `we-validate-schemas` on `HeaderLayout`/`SidebarLayout` (which transitively pull in `PostsList.ts`) — no schema issues
- [x] Manual: edit a post and confirm the change appears in the post list immediately, without navigating away/refreshing (this was the `BlockRenderer` bug — confirmed fixed)
- [ ] Manual: edit a post containing an image — confirm the image is *updated*, not recreated (check its AD4M id is unchanged before/after save)
- [ ] Manual: remove a block from a post during edit — confirm it's actually deleted (e.g. check the Blocks route's image filter, the way the delete-post bug was originally caught)
- [ ] Manual: add a new block during edit — confirm it's created and linked
- [ ] Manual: reorder blocks during edit — confirm the new order persists
- [ ] Manual: edit content inside a nested collection block — confirm its blocks are also id-matched, not wholesale recreated
- [ ] Manual: copy/paste a block within the editor, then save — confirm both the original and the pasted copy end up as distinct, valid blocks (not one orphaned/double-deleted)
- [ ] Manual: confirm only the post's author sees the edit (pencil) icon
