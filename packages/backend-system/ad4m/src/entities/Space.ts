/**
 * GENERATED from src/manifest/Space.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { fileToDataUri, Flag, HasMany, HasManyMethods, HasOne, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';

import { CollectionBlock } from './CollectionBlock';
import { LocationBlock } from './LocationBlock';
import { SpaceRole } from './SpaceRole';
import { TaskState } from './TaskState';
import { TypeStyle } from './TypeStyle';
import { WeNode } from './WeNode';

@Model({ name: 'Space' })
export class Space extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space' })
  flag: string = '';

  @Property({ through: 'we://uuid' })
  uuid: string = '';

  @Property({ through: 'we://url' })
  url?: string;

  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://description', required: true })
  description: string = '';

  @Property({ through: 'we://discovery' })
  discovery: string = 'hidden';

  @Property({ through: 'we://image', resolveLanguage: FILE_STORAGE_LANGUAGE, transform: fileToDataUri })
  avatar?: string;

  @Property({ through: 'we://thumbnail', resolveLanguage: FILE_STORAGE_LANGUAGE, transform: fileToDataUri })
  coverImage?: string;

  @Property({ through: 'we://default_template_id' })
  defaultTemplateId: string = '';

  @Property({ through: 'we://default_theme_id' })
  defaultThemeId: string = '';

  /**
   * Which feature modules this community has turned on, as a JSON array of module ids.
   *
   * **Empty means "not decided", not "none".** A space created before this field existed, or by an
   * agent who never opened the setting, must keep rendering the chrome it always had — so an unset
   * value falls back to the modules the deployment's seed activated. Treating empty as "none" would
   * silently strip existing spaces of every module the moment this shipped.
   *
   * A JSON string rather than a relation because the values are ids from the seed, not entities in
   * the perspective — the same shape `AgentSettings.datasetOrder` uses for an ordered id list.
   */
  @Property({ through: 'we://enabled_modules' })
  enabledModules: string = '';

  /**
   * Which sections this community's spaces have, and in what order — a JSON array of view ids.
   *
   * The community's decision, exactly as `enabledModules` is: every member sees the same
   * sections, because "what is in this space" is a fact about the space rather than a preference
   * about it. An agent's own hiding lives in `SpacePreference.hiddenViews`, which is private.
   *
   * **Empty means "not decided", not "none"** — the same rule, and it exists for the same
   * reason. A space that predates views must show the sections it always had, so an unset value
   * falls back to the deployment's bundled set in seed order. Reading empty as "none" would land
   * as every existing space silently losing every tab.
   *
   * Ordered, and the order is the nav order: this is the one field a community reorders its own
   * sections by. A JSON string rather than a relation because the values are ids from a registry
   * or a marketplace, not entities in the perspective — the shape `datasetOrder` already uses.
   */
  @Property({ through: 'we://enabled_views' })
  enabledViews: string = '';

  /**
   * Which candidate models a new collection here starts out extracting — a call, a channel, the
   * space's own collection — as a JSON array of entity names.
   *
   * The middle of three layers. `EntitySchema.extractable` says what is a candidate at all —
   * a question about whether an LLM *could* mint one, answered by the codebase; this says which
   * of them a new conversation here begins with, which is a question about what this community
   * talks about and is nobody else's to answer. Each collection then holds its own list
   * (`CollectionBlock.extractionTargets`), copied from this when it is made.
   *
   * **A default, not a live setting.** Changing it changes what the *next* collection starts
   * with; a call already under way keeps the list its participants have, so nobody's meeting
   * changes underneath them because somebody edited the space. A collection that was made
   * without a copy (by an app that did not know to write one) falls back to this at read time.
   *
   * **Empty means "not decided", not "none"** — the `enabledModules` rule, and it matters more
   * here than anywhere: reading empty as none would make every space that predates this field
   * silently stop extracting, with nothing on screen to say why. An unset value falls back to
   * the two classes that were hardcoded before this existed (`TaskBlock`, `EventBlock`), so
   * nothing regresses; the first toggle writes the resolved list and the community owns it
   * thereafter.
   *
   * A JSON string rather than a relation because the values are entity *names* — there is
   * nothing in the perspective to point at. Same shape as `enabledModules` and `enabledViews`.
   */
  @Property({ through: 'we://extraction_targets' })
  extractionTargets: string = '';

  /**
   * Whether a new collection here is interpreted as it grows — a call as it happens, a channel as
   * messages arrive. A default, copied onto each collection when it is made
   * (`CollectionBlock.autoExtract`), for the reason `extractionTargets` gives.
   *
   * On by default. It was off, on the reasoning that a pass spends somebody's LLM budget and a
   * community should opt in — which reads well and played badly: extraction is the feature, and
   * a space arrived with it silently disabled, so the ordinary first experience was a call that
   * transcribed and extracted nothing, with the reason two screens away. Nobody turns on a thing
   * they have not seen work.
   *
   * The budget argument survives where it is actually true: this is a *space* setting, so a
   * community can switch it off for everyone, and it does nothing at all on a node with no model
   * configured — `available` answers that separately and refuses first.
   */
  @Property({ through: 'we://auto_interpret' })
  autoInterpret: boolean = true;

  /**
   * How deep a conversation here may go: `fractal` (a reply may be replied to) or `flat` (only
   * the record itself may be).
   *
   * **A reading, not a shape.** Replies are always stored as a tree — a reply hangs off whatever
   * it answers through `we://response`, which is true of a post, a block, a drawn connection and
   * another reply alike. This says only what may be *added*, so a community that switches to
   * flat keeps showing the nesting it already has rather than silently redrawing a hierarchy as
   * a list, and switching back loses nothing. Nothing migrates, because nothing about the data
   * depends on it.
   *
   * A field here rather than a `ModuleSetting`, and the distinction is the one `moduleSettings`
   * draws below: that field exists so a *module* stops adding columns to this entity on its own
   * behalf, and setting groups are built from what registered modules declare. Threads are not a
   * module — `responses` is on `WeNode`, so every record in WE has them whatever is installed —
   * so there is no group to hang this on and nothing to uninstall it with. It sits beside
   * `autoInterpret` for the same reason: a core capability whose scope is the community's to
   * decide.
   *
   * Defaults to `fractal`, which is what every surface did before the setting existed.
   */
  @Property({ through: 'we://thread_mode' })
  threadMode: string = 'fractal';

  /**
   * What this community decides about each capability's settings, as JSON.
   *
   * `{ "<group>": { "<key>": value } }`, where a group is a module id or a capability the host
   * declares. One field rather than one per setting: `autoInterpret` and `extractionTargets` are
   * here as bespoke columns already, and every capability that wanted an opinion added another — a core entity accreting a field on behalf of a module is
   * the shape this replaces.
   *
   * **Absent means "no opinion"**, never "off" — the same rule as `enabledModules`. A level says
   * nothing until somebody sets something, and the resolver takes the most specific level that
   * has an opinion. See `moduleSettings.ts` in the app shell for the order and for how a
   * `restrict` setting differs.
   *
   * ## Those two columns are staying, and this is not an oversight
   *
   * This field replaced the *shape*, not the instances of it. This resolver answers along one axis, **who is asking**: deployment → agent
   * everywhere → community here → agent here, most specific wins. `autoInterpret` and
   * `extractionTargets` are not answers along that axis at all: they are the defaults a new
   * collection copies, and the decision that matters is then the collection's own — held on the
   * collection (`CollectionBlock.autoExtract`) and belonging to whoever is in that conversation.
   * Migrating them here would typecheck, pass, and silently turn a starting point into a setting
   * that overrules every conversation.
   *
   * What was worth fixing is fixed: a capability that wants a setting today declares a
   * `ModuleSetting` and gets a resolved value and a rendered control, so there is no fourth
   * column coming. **Revisit the subject axis when a second capability wants a per-subject
   * override** — one is not evidence the resolver needs one. Recording is the one to watch.
   */
  @Property({ through: 'we://module_settings' })
  moduleSettings: string = '';

  /**
   * The workflows this space has put away, by name — a JSON list. An archived workflow is kept, so the
   * records going through it still show and can still finish, but it is not offered for starting
   * on anything new and is listed apart.
   *
   * A property of the space rather than of the workflow, because archiving is how this community
   * arranges its workflows, not part of what a workflow is: the backend holds the definition, and a
   * definition knows nothing about being put away. A JSON string for `enabledViews`' reason —
   * the values are names, not entities.
   */
  @Property({ through: 'we://archived_workflows' })
  archivedWorkflows: string = '';

  /**
   * How a task may move between this space's states, in their order: empty for anywhere (a board
   * lets a card go to any column), `next` for on to the next state only, `next-and-back` for on or
   * back one. Anything but empty runs the states as a workflow, so a move it does not allow is refused
   * on the board rather than made.
   */
  @Property({ through: 'we://task_workflow_rule' })
  taskWorkflowRule: string = '';

  @HasOne(() => LocationBlock, { through: 'we://location' })
  location?: LocationBlock;

  /**
   * The order this community reads its task states in — and only the order.
   *
   * Position hints over a membership defined elsewhere, the same shape a board's `children` have
   * over the tasks a state gathers, and the same shape AD4M's ordering entries have over the
   * links they order. A state is a state because a `TaskState` record exists, not because it is
   * listed here; one that is not listed still appears, after the ones that are, sorted by what it
   * counts as.
   *
   * That is what keeps reordering safe on a shared space. It is a relation rather than a number
   * on each state, so two people dragging columns at the same moment converge instead of writing
   * the same position and losing one of the answers — which is the whole reason this relation is
   * `ordered` and the reason a `position` scalar was refused.
   */
  @HasMany(() => TaskState, { through: 'we://task_state_order', ordering: { strategy: 'linkedList' } })
  taskStates: string[] = [];

  /**
   * The colour this community draws each kind of thing in — its key.
   *
   * `TypeStyle` was written for one board, on the argument that two boards legitimately
   * disagree about what a task looks like. True, and it left the more common question with no
   * home: "tasks are blue *here*", meaning in this space, so that a canvas made tomorrow starts
   * out coloured the way every other one is. A canvas can still carry its own records in front
   * of these; this is what they fall back to. The same shape as `taskStates` — a vocabulary
   * decision, one record per fact, so two people colouring two kinds at once are two writes.
   *
   * The predicate is the record's own flag value, as `we://signal` is for a node's signals.
   */
  @HasMany(() => TypeStyle, { through: 'we://type_style' })
  typeStyles: string[] = [];

  /**
   * The space collection: the one collection everything top-level in this space hangs off.
   *
   * Calls, loose messages, posts, channels, extracted items and the canvas record are its
   * children, so "what is in this space" is one containment walk rather than "every record with
   * no parent" — which cannot tell top-level content from an orphan, and has no polymorphic read.
   *
   * The host makes it in every space, in `createSpace`, before anything else. It is a
   * `CollectionBlock` (the root channel, `kind: 'channel'`) rather than containment on this record because the
   * machinery extraction needs — passes, `extracted`, a board, `mode` — already lives there, and
   * because this record is identity and settings and is copied to the discovery space, which the
   * space's contents must never be.
   *
   * Its own relation rather than a role (`roles`), because it is structural rather than chosen:
   * queries scope through it, and no starter can remove it.
   */
  @HasOne(() => CollectionBlock, { through: 'we://root' })
  root?: CollectionBlock;

  /**
   * The records this space names by role — its canvas, say. One `SpaceRole` per role. Read
   * through `spaceStore.roles`; see `SpaceRole` for why it is shaped this way.
   */
  @HasMany(() => SpaceRole, { through: 'we://space_role' })
  roles: string[] = [];
}

export interface Space extends HasManyMethods<'taskStates'> {
  /** Generated by @HasOne — links a new LocationBlock as this space's location. */
  setLocation(value: Pick<LocationBlock, 'id'>): Promise<void>;
  /** Generated by @HasOne — links a new CollectionBlock as this space's root. */
  setRoot(value: Pick<CollectionBlock, 'id'>): Promise<void>;
}
