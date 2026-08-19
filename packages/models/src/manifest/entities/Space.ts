import type { CoreEntityDef } from '../defs';

export const Space: CoreEntityDef = {
  base: 'WeNode',
  optional: ["avatar", "coverImage", "location", "url"],
  entity: {
    flag: {"predicate": "we://flag", "value": "we://space"},
    properties: {
      uuid: { type: "string", predicate: "we://uuid", default: "" },
      url: { type: "string", predicate: "we://url" },
      name: { type: "string", predicate: "we://name", required: true, default: "" },
      description: { type: "string", predicate: "we://description", required: true, default: "" },
      discovery: { type: "string", predicate: "we://discovery", default: "hidden" },
      avatar: { type: "string", predicate: "we://image", format: "file", readAs: "dataUri" },
      coverImage: { type: "string", predicate: "we://thumbnail", format: "file", readAs: "dataUri" },
      defaultTemplateId: { type: "string", predicate: "we://default_template_id", default: "" },
      defaultThemeId: { type: "string", predicate: "we://default_theme_id", default: "" },
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
      enabledModules: { type: "string", predicate: "we://enabled_modules", default: "" },
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
      autoInterpret: { type: "boolean", predicate: "we://auto_interpret", default: false },
    },
    relations: {
      location: { target: "LocationBlock", cardinality: "one", predicate: "we://location" },
    },
  },
};
