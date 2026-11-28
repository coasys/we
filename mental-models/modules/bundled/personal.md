# Personal modules

The notes module (`@we/module-notes`) and the Pocket (`@we/module-pocket`) are agent-scoped: `manifest.scope` and `entities.scope` are `'agent'`, and their data is in the agent's personal space, which they reach through the `agentData` kernel. A note is private and the same in every space. The Pocket holds references to things from any space, in folders.

**Why:** A panel that gathers from many spaces has no one space to be enabled in, and its contents are nobody else's business. So the agent turns these modules on and off in Settings → Modules, and no space can turn them on or off for the agent (`pocket/src/index.ts` header). Both modules own the container and not the content: a note is a post's own shape, and a Pocket item is an address (`notes/src/index.ts` header).

**Parent:** [Bundled modules](README.md)

<details><summary>How it works</summary>

**Notes** (kernels `agentData`, `records`):
- A note is a `CollectionBlock` with `kind: 'post'` in the personal space. It uses the same composer and card as a post. It is a note only because of where it is.
- `share(id, spaceName)` reads the note's document, writes it into the space on screen as a post (`records.documents.create`), and writes a `NoteShare` in the personal space. A note that is dragged into a space is recorded in the same way.
- The module's one entity is `NoteShare` `{ noteId, ref, spaceName, sharedAt }`, with predicates `we://module/notes/<property>`. It points out at the post. The post has no reference back, because that reference would name a private record.
- After a share, the note and the post are independent.
- Contributions: the `main` panel and the part `toggleButton`.

**Pocket** (kernel `agentData`):
- Entities `PocketFolder` (name, icon, color, root, `folders`, `items`) and `PocketItem` (`ref` and its parts `entity`, `datasetKey`, `recordId`, and a label, icon, thumbnail and source as they were at gather time).
- A gather is an address and a note of how the thing looked. The post is not copied, and its document is read and then dropped. A second gather of a held reference is a move.
- The store marks four chrome members as public (`open`, `toggle`, `close`, `show`). All other members are private, so a space's template cannot write into the agent's personal space.
- `holds: 'open'`: the panel stays on screen while it is open.

Organising notes into folders is the Pocket's job. A note goes into it by drag, and neither module names the other.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/notes/src/index.ts](../../../packages/module-system/notes/src/index.ts), [entities.ts](../../../packages/module-system/notes/src/entities.ts), [store.ts](../../../packages/module-system/notes/src/store.ts): `notesModule`, `NOTES_MANIFEST`, `NOTE_PREDICATES`, `share`.
- [packages/module-system/pocket/src/index.ts](../../../packages/module-system/pocket/src/index.ts), [entities.ts](../../../packages/module-system/pocket/src/entities.ts), [store.ts](../../../packages/module-system/pocket/src/store.ts): `pocketModule`, `POCKET_MANIFEST`, `createPocketStore`.
- How an agent-scoped module is active everywhere: [Enablement](../registry/enablement.md).
- The personal space itself (`we-personal`): [Datasets](../../data/stores/datasets.md).

</details>
