# Composer

`BlockComposer` is the editor for a composition. It is built on ProseMirror, and its schema comes from the block registry. `BlockRenderer` draws a composition without an editor. With the `collaborate` prop, the composer joins a live Yjs session, so that several agents edit one document at the same time.

**Why:** The renderer never makes an editor, so a feed of posts does not mount one editor for each card (`block-system/CONVENTIONS.md`). Live editing in one paragraph needs a text CRDT. Durable block order is already the `children` relation, so the session is only for live text, and a save writes the merged document to the records. Nothing opaque is stored, and a peer who was not in the session reads the records (`collab.ts` header).

**Parent:** [Blocks](README.md)

<details><summary>How it works</summary>

**The editor** (`frameworks/solid/src/editor/`):

- `schema.ts` makes the ProseMirror schema. `createBlockSchema` makes one atom node for each registered custom block, with its fields in a `props` attribute. Its `toDOM` is the only definition of a text block's DOM, and the renderer uses it too.
- `converter.ts` converts a ProseMirror document to content blocks and back (code points on one side, UTF-16 on the other).
- `nodeViews.tsx` mounts each custom block's input component. Plugins give handles and drag, hover and focus as decorations, the keymap, markdown input rules, `@` mentions, links, the formatting toolbar and the `/` menu.
- A list item is a flat block with `listType` and `level`. It is not a child of a list.

**A block type** has a display component (for `BlockRenderer`) and an input component (for the composer). The input component writes through `onChange(property, value)`, so each change is one undo step. `BlockDisplayOverrides` replaces a display for one render context.

**The host** (`BlockHostProvider`) gives the composer its `dataset`, its `mentions` and `collab(nodeId)`. A prop on the composer wins over the host.

**Live sessions.** `CollabSession` is `{ doc, fragment, awareness, synced, destroy }`, bound to the editor with `y-prosemirror`. The app shell's `collabSession.ts` carries it over the ephemeral port on the channel `we:collab:<nodeId>`, with the messages `hello`, `sync`, `update` and `awareness`. It drops a message from an agent that is not a member of the space. In a personal space there is nobody to share with, so there is no session.

</details>

<details><summary>Where in the code</summary>

- [packages/block-system/frameworks/solid/src/components/BlockComposer.tsx](../../../packages/block-system/frameworks/solid/src/components/BlockComposer.tsx), [BlockRenderer.tsx](../../../packages/block-system/frameworks/solid/src/components/BlockRenderer.tsx), [BlockHost.tsx](../../../packages/block-system/frameworks/solid/src/components/BlockHost.tsx), [BlockDisplayOverrides.tsx](../../../packages/block-system/frameworks/solid/src/components/BlockDisplayOverrides.tsx).
- [packages/block-system/frameworks/solid/src/editor/](../../../packages/block-system/frameworks/solid/src/editor): `schema.ts`, `converter.ts`, `nodeViews.tsx`, `commands.ts`, `collab.ts`, `plugins/`.
- [packages/block-system/frameworks/solid/src/core-block-components.ts](../../../packages/block-system/frameworks/solid/src/core-block-components.ts): `registerCoreBlockComponents`.
- [packages/app-shell/src/frameworks/solid/collab/collabSession.ts](../../../packages/app-shell/src/frameworks/solid/collab/collabSession.ts): the session over the ephemeral port.

</details>
