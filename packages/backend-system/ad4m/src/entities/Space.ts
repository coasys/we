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
   * Which candidate models this community's calls start out extracting, as a JSON array of
   * entity names.
   *
   * The middle of three layers. `EntitySchema.extractable` says what is a candidate at all —
   * a question about whether an LLM *could* mint one, answered by the codebase; this says which
   * of them a call here begins with, which is a question about what this community's
   * conversations are about and is nobody else's to answer. A call may then add or remove for
   * itself (`CallExtraction`).
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
   * Whether calls in this space are interpreted as they happen.
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
   * it answers through `we://comment`, which is true of a post, a block, a drawn connection and
   * another reply alike. This says only what may be *added*, so a community that switches to
   * flat keeps showing the nesting it already has rather than silently redrawing a hierarchy as
   * a list, and switching back loses nothing. Nothing migrates, because nothing about the data
   * depends on it.
   *
   * A field here rather than a `ModuleSetting`, and the distinction is the one `moduleSettings`
   * draws below: that field exists so a *module* stops adding columns to this entity on its own
   * behalf, and setting groups are built from what registered modules declare. Threads are not a
   * module — `comments` is on `WeNode`, so every record in WE has them whatever is installed —
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
   * `extractionTargets` carry a second axis it has no concept of, **which call** — a per-call
   * decision belonging to that call's participants rather than to the space's administrator,
   * held in `CallExtraction` and read through `spaceStore.autoInterpretForCall(collectionId)`,
   * which is a function rather than a value for exactly that reason. Migrating them here as-is
   * would typecheck, pass, and silently drop the layer where participants overrule the space.
   *
   * What was worth fixing is fixed: a capability that wants a setting today declares a
   * `ModuleSetting` and gets a resolved value and a rendered control, so there is no fourth
   * column coming. **Revisit the subject axis when a second capability wants a per-subject
   * override** — one is not evidence the resolver needs one. Recording is the one to watch.
   */
  @Property({ through: 'we://module_settings' })
  moduleSettings: string = '';

  @HasOne(() => LocationBlock, { through: 'we://location' })
  location?: LocationBlock;

  /**
   * This space's own board — "Everything", the one that gathers all of the community's work.
   *
   * The counterpart of `CollectionBlock.board` one level up, and the same reasoning: which board
   * is *the* space's is a fact about the space. It is also what makes curating every other board
   * safe, since this is the catch-all nothing can hide from — see `docs/architecture/boards.md`.
   */
  @HasOne(() => CollectionBlock, { through: 'we://board' })
  board?: CollectionBlock;

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
}

export interface Space extends HasManyMethods<'taskStates'> {
  /** Generated by @HasOne — links a new LocationBlock as this space's location. */
  setLocation(value: Pick<LocationBlock, 'id'>): Promise<void>;
  /** Generated by @HasOne — links a new CollectionBlock as this space's board. */
  setBoard(value: Pick<CollectionBlock, 'id'>): Promise<void>;
}
