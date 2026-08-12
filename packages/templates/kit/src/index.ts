/**
 * The shapes WE's templates are built from, as data.
 *
 * Every export here is a function returning `SchemaNode`s — it runs at authoring time and leaves
 * nothing behind. What ships is the JSON it produced, indistinguishable from JSON written by hand,
 * which is what keeps a template inspectable in the visual editor, editable by an AI, and free of
 * any dependency on this package at runtime.
 *
 * ## Two tiers
 *
 * - **Layout, states, lists, overlays** name no store. They are portable to any deployment.
 * - **`we/`** reads WE's own stores (`profileStore`, `runtimeStore`) or its schema machinery
 *   (`$agent`). They are portable only where those exist.
 *
 * The split is not decoration: the store surface is this kit's real dependency, and it is not
 * expressed in `package.json`. Keeping the tiers apart is how a consumer can tell which fragments
 * will work for them.
 *
 * ## What belongs here, and what belongs in `@we/components`
 *
 * Code should own only what data *cannot express*: behaviour, focus management, accessibility
 * semantics, browser APIs, measurement. Everything above that line is arrangement, and arrangement
 * stays here — because a prop is a customisation somebody predicted, while a node tree is every
 * customisation, including the ones nobody thought of.
 *
 * So `AvatarStack` is a component (overlap maths) and the count beside it is a fragment;
 * `we-modal` is a primitive (focus trap, top layer) and the confirm dialog inside it is a fragment.
 *
 * The package README states this rule in full; CONVENTIONS.md carries the authoring rules
 * (extraction threshold, options-object API, the const rule); and
 * `docs/architecture/template-fragments.md` is where all of it is going.
 */

// States — what a surface shows when it has nothing to show.
export { emptyNote, emptyState } from './states/emptyState.ts';
export type { EmptyStateOptions } from './states/emptyState.ts';
export { gatePrompt } from './states/gatePrompt.ts';
export type { GatePromptOptions } from './states/gatePrompt.ts';

// Lists — a grid of cards, and the card in it.
export { cardList, cardShell } from './lists/cards.ts';
export type { CardListOptions, CardShellOptions } from './lists/cards.ts';

// Layout — the boxes a page is made of.
export { attributeRow } from './layout/attributeRow.ts';
export type { AttributeRowOptions } from './layout/attributeRow.ts';
export { pageShell } from './layout/pageShell.ts';
export type { PageShellOptions } from './layout/pageShell.ts';
export { sectionCard } from './layout/sectionCard.ts';
export type { SectionCardOptions } from './layout/sectionCard.ts';
export { statChip } from './layout/statChip.ts';
export type { StatChipOptions } from './layout/statChip.ts';

// Input.
export { field } from './input/field.ts';
export type { FieldOptions } from './input/field.ts';

// Overlays.
export { confirmModal } from './overlays/confirmModal.ts';
export type { ConfirmModalOptions } from './overlays/confirmModal.ts';

// WE-domain — these name WE's stores or its agent machinery.
export { adminSection } from './we/adminSection.ts';
export type { AdminSectionOptions } from './we/adminSection.ts';
export { agentByline } from './we/agentByline.ts';
export type { AgentBylineOptions } from './we/agentByline.ts';
export { installedList } from './we/installedList.ts';
export type { InstalledListOptions } from './we/installedList.ts';
export { marketplaceList } from './we/marketplaceList.ts';
export type { MarketplaceListOptions } from './we/marketplaceList.ts';
export { peopleRow } from './we/peopleRow.ts';
export type { PeopleRowOptions } from './we/peopleRow.ts';
export { peopleTooltip } from './we/peopleTooltip.ts';
export type { PeopleTooltipOptions } from './we/peopleTooltip.ts';
