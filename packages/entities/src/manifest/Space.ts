import type { CoreEntityDef } from './defs';

export const Space: CoreEntityDef = {
  base: 'WeNode',
  optional: ['avatar', 'coverImage', 'location', 'url'],
  // `setTaskStates` is how a column drag writes the community's order — see the relation below.
  methodRelations: ['taskStates'],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://space' },
    properties: {
      uuid: { type: 'string', predicate: 'we://uuid', default: '' },
      url: { type: 'string', predicate: 'we://url' },
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      description: { type: 'string', predicate: 'we://description', required: true, default: '' },
      discovery: { type: 'string', predicate: 'we://discovery', default: 'hidden' },
      avatar: { type: 'string', predicate: 'we://image', format: 'file', readAs: 'dataUri' },
      coverImage: { type: 'string', predicate: 'we://thumbnail', format: 'file', readAs: 'dataUri' },
      defaultTemplateId: { type: 'string', predicate: 'we://default_template_id', default: '' },
      defaultThemeId: { type: 'string', predicate: 'we://default_theme_id', default: '' },
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
      enabledModules: { type: 'string', predicate: 'we://enabled_modules', default: '' },
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
      enabledViews: { type: 'string', predicate: 'we://enabled_views', default: '' },
      /**
       * Whether calls in this space are interpreted as they happen, rather than only when somebody
       * presses Extract.
       *
       * A property of the *space* rather than of the agent, because the consequences are the
       * community's: a standing watch spends an LLM call on whichever member's node wins the election,
       * and writes what it finds into everyone's copy. Left to each agent, one member could sign the
       * rest up to both.
       *
       * Defaults off, and that default is the point — joining a space should never be the same act as
       * volunteering to run its extraction.
       */
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
      extractionTargets: { type: 'string', predicate: 'we://extraction_targets', default: '' },
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
      autoInterpret: { type: 'boolean', predicate: 'we://auto_interpret', default: true },
      /**
       * What this community decides about each capability's settings, as JSON.
       *
       * `{ "<group>": { "<key>": value } }`, where a group is a module id or a capability the host
       * declares. One field rather than one per setting: `autoInterpret`, `extractionTargets` and
       * `shareExtractionDetail` are all here as bespoke columns already, and every capability that
       * wanted an opinion added another — a core entity accreting a field on behalf of a module is
       * the shape this replaces.
       *
       * **Absent means "no opinion"**, never "off" — the same rule as `enabledModules`. A level says
       * nothing until somebody sets something, and the resolver takes the most specific level that
       * has an opinion. See `moduleSettings.ts` in the app shell for the order and for how a
       * `restrict` setting differs.
       *
       * ## Two of those three columns are staying, and this is not an oversight
       *
       * This field replaced the *shape*, not the three instances of it — and only one of them could
       * move anyway. This resolver answers along one axis, **who is asking**: deployment → agent
       * everywhere → community here → agent here, most specific wins. `autoInterpret` and
       * `extractionTargets` carry a second axis it has no concept of, **which call** — a per-call
       * decision belonging to that call's participants rather than to the space's administrator,
       * held in `CallExtraction` and read through `spaceStore.autoInterpretForCall(collectionId)`,
       * which is a function rather than a value for exactly that reason. Migrating them here as-is
       * would typecheck, pass, and silently drop the layer where participants overrule the space.
       *
       * `shareExtractionDetail` has no such axis and could move. There is no reason to: it is a
       * stored predicate with data behind it, and absent-means-no-opinion makes the move a
       * read-fallback preserving a three-way distinction rather than a rename — against the gain of
       * one fewer column.
       *
       * What was worth fixing is fixed: a capability that wants a setting today declares a
       * `ModuleSetting` and gets a resolved value and a rendered control, so there is no fourth
       * column coming. **Revisit the subject axis when a second capability wants a per-subject
       * override** — one is not evidence the resolver needs one. Recording is the one to watch.
       */
      moduleSettings: { type: 'string', predicate: 'we://module_settings', default: '' },
      /**
       * Whether extraction passes broadcast their prompt and response to the rest of the space.
       *
       * A property of the space for the same reason `autoInterpret` is, though a different one than
       * might be assumed. It is not about secrecy: in a call the prompt is built from a transcript
       * every participant already holds, so a member sharing theirs reveals nothing the others lack.
       *
       * It is about the state being *collective*. "I share and you do not" is an asymmetry with no
       * use — the reason to turn this on is that a space is working on extraction and wants to see
       * what it is doing, which is a decision about the space rather than about one member.
       *
       * Defaults off because the payload is tens of KB per pass and rides the ephemeral signalling
       * transport, which exists for small last-write-wins messages. That is a poor default to impose
       * on every space forever, and a very reasonable thing to switch on for an afternoon.
       */
      shareExtractionDetail: {
        type: 'boolean',
        predicate: 'we://share_extraction_detail',
        default: false,
      },
    },
    relations: {
      location: { target: 'LocationBlock', cardinality: 'one', predicate: 'we://location' },
      /**
       * This space's own board — "Everything", the one that gathers all of the community's work.
       *
       * The counterpart of `CollectionBlock.board` one level up, and the same reasoning: which board
       * is *the* space's is a fact about the space. It is also what makes curating every other board
       * safe, since this is the catch-all nothing can hide from — see `docs/architecture/boards.md`.
       */
      board: { target: 'CollectionBlock', cardinality: 'one', predicate: 'we://board' },
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
      taskStates: {
        target: 'TaskState',
        cardinality: 'many',
        predicate: 'we://task_state_order',
        ordered: true,
      },
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
      typeStyles: { target: 'TypeStyle', cardinality: 'many', predicate: 'we://type_style' },
    },
  },
};
