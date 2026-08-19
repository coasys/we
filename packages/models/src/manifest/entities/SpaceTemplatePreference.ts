import type { CoreEntityDef } from '../defs';

export const SpaceTemplatePreference: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: {"predicate": "we://flag", "value": "we://space_template_preference"},
    properties: {
      spaceUrl: { type: "string", predicate: "we://space_url", default: "" },
      preference: { type: "string", predicate: "we://preference", default: "" },
    },
    relations: {
    },
  },
};
