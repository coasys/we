import type { CoreEntityDef } from './defs';

export const Space: CoreEntityDef = {
  base: 'WeNode',
  optional: ['avatar', 'coverImage', 'location', 'url'],
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
      autoInterpret: { type: 'boolean', predicate: 'we://auto_interpret', default: false },
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
    },
  },
};
