/**
 * Portable schema fragments — the shapes, for anyone authoring nodes.
 *
 * Every export here is a function returning `SchemaNode`s. It runs at *authoring* time and leaves
 * nothing behind: what ships is the JSON it produced, indistinguishable from JSON written by hand,
 * which is what keeps the result inspectable in the visual editor, editable by an AI, and free of
 * any dependency on this package at runtime.
 *
 * ## Why this is its own package
 *
 * It was one package under `templates/`, which made it look like a peer of the templates rather than
 * a library beneath them — and `modules → templates` is the sideways edge the dependency rules
 * forbid. So a feature module needing a shape the kit already had could only copy it, which is how
 * the call module ended up with a hand-written second copy of `peopleTooltip`. The kit's own
 * conventions call two hand-written copies an extraction trigger; the fix is placement, not another
 * abstraction.
 *
 * Splitting on the tier the kit already had is what makes the move safe: **nothing here names a
 * store.** Every fragment takes what it needs as an option, so it is portable to any deployment that
 * implements the schema vocabulary. Fragments that read WE's own stores (`profileStore`,
 * `runtimeStore`, `datasetStore`) or its agent machinery (`$agent`) stay in `@we/template-kit`,
 * because their real dependency is the host's store surface and no `package.json` can express it.
 *
 * `kit.test.ts` in that package enforces it twice: it walks every expansion for a `$store` a fragment
 * introduced itself, and it reads this package's own source for the same thing. The second check is
 * what the first could not do — the collection fragments (`collectionFeed`, `commentThread`,
 * `channelRail`, `mediaGrid`) all filter on `spaceStore.mutedDids` and came within one commit of
 * being moved here, because no fixture covered them.
 *
 * ## Why a module may depend on it
 *
 * Because the dependency is compile-time only. A module bundles this package, the functions run
 * during its build, and what lands in `dist` is the expanded data — so there is no runtime coupling,
 * no version agreement between host and module, and a module built against one version of a fragment
 * keeps rendering when the fragment changes. That is why this is a devDependency there rather than
 * a peer, and why the kit stays free to evolve.
 *
 * ## What belongs here, and what belongs in `@we/components`
 *
 * Code should own only what data *cannot express*: behaviour, focus management, accessibility
 * semantics, browser APIs, measurement. Everything above that line is arrangement, and arrangement
 * belongs here — because a prop is a customisation somebody predicted, while a node tree is every
 * customisation, including the ones nobody thought of.
 *
 * So `AvatarStack` is a component (overlap maths) and the count beside it is a fragment; `we-modal`
 * is a primitive (focus trap, top layer) and the confirm dialog inside it is a fragment.
 *
 * `@we/template-kit`'s CONVENTIONS.md carries the authoring rules (extraction threshold,
 * options-object API, the const rule) and applies to both packages;
 * `docs/architecture/template-fragments.md` is where all of it is going.
 */

export type { AnchorId, Content } from './types.ts';

// States — what a surface shows when it has nothing to show.
export { emptyNote, emptyState } from './states/emptyState.ts';
export type { EmptyStateOptions } from './states/emptyState.ts';
export { gatePrompt } from './states/gatePrompt.ts';
export type { GatePromptOptions } from './states/gatePrompt.ts';
export { skeletonList } from './states/skeletonList.ts';
export type { SkeletonListOptions } from './states/skeletonList.ts';

// Lists — a grid of cards, and the card in it.
export { cardList, cardShell } from './lists/cards.ts';
export type { CardListOptions, CardShellOptions } from './lists/cards.ts';

export { kanbanBoard, moveCardMenu } from './lists/kanbanBoard.ts';
export type { KanbanBoardOptions } from './lists/kanbanBoard.ts';
export { loadMore } from './lists/loadMore.ts';
export type { LoadMoreOptions } from './lists/loadMore.ts';
export { pickerRow } from './lists/pickerRow.ts';
export type { PickerRowOptions } from './lists/pickerRow.ts';

// Layout — the boxes a page is made of.
export { attributeRow } from './layout/attributeRow.ts';
export type { AttributeRowOptions } from './layout/attributeRow.ts';
export { badgedAvatar } from './layout/badgedAvatar.ts';
export type { BadgedAvatarOptions } from './layout/badgedAvatar.ts';
export { pageShell } from './layout/pageShell.ts';
export type { PageShellOptions } from './layout/pageShell.ts';
export { railButton, railGroup, railItem, railShell } from './layout/rail.ts';
export type { RailButtonOptions, RailGroupOptions, RailItemOptions, RailShellOptions } from './layout/rail.ts';
export { sectionCard } from './layout/sectionCard.ts';
export type { SectionCardOptions } from './layout/sectionCard.ts';
export { statChip } from './layout/statChip.ts';
export type { StatChipOptions } from './layout/statChip.ts';

// Input.
export { field } from './input/field.ts';
export type { FieldOptions } from './input/field.ts';

// Overlays.
export { composerModal } from './overlays/composerModal.ts';
export type { ComposerModalOptions } from './overlays/composerModal.ts';
export { confirmModal } from './overlays/confirmModal.ts';
export type { ConfirmModalOptions } from './overlays/confirmModal.ts';
export { formModal } from './overlays/formModal.ts';
export type { FormModalOptions } from './overlays/formModal.ts';
/*
  Filed here rather than in the WE tier it was written in, because it names no store: the people, the
  pictures and the names all arrive as options. It was the fragment a module wanted first, and the
  one that made the packaging problem visible.
*/
export { peopleTooltip } from './overlays/peopleTooltip.ts';
export type { PeopleTooltipOptions } from './overlays/peopleTooltip.ts';
export { pickerPopover } from './overlays/pickerPopover.ts';
export type { PickerPopoverOptions } from './overlays/pickerPopover.ts';
