import type { CoreEntityDef } from '../defs';

export const SpacePreference: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: {"predicate": "we://flag", "value": "we://space_preference"},
    properties: {
      /** The dataset id of the space these choices apply to. */
      spaceUuid: { type: "string", predicate: "we://space_uuid", default: "" },
      /**
       * Module ids this agent has muted here, as a JSON array.
       *
       * A list of exclusions rather than of inclusions, so a module the community enables later still
       * appears — silence about a module means "no opinion", not "no".
       */
      mutedModules: { type: "string", predicate: "we://muted_modules", default: "" },
      /**
       * The template this agent wants when they open this space, overriding the space's default.
       *
       * One of {@link FOLLOW_SPACE}, {@link AGENT_DEFAULT}, or a template id. Deliberately not a boolean
       * "use my own": which template is a richer answer than whether, and it lets someone pick a third
       * template that is neither the space's choice nor their global default.
       */
      templateId: { type: "string", predicate: "we://template_id", default: "" },
      /** The theme this agent wants in this space. Same three-way value as `templateId`. */
      themeId: { type: "string", predicate: "we://theme_id", default: "" },
    },
    relations: {
    },
  },
};
