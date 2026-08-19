import type { CoreEntityDef } from '../defs';

export const Theme: CoreEntityDef = {
  base: 'WeNode',
  methodRelations: ['screenshots'],
  passthrough: ["export type { ThemeData } from '../utils/themeData';"],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://theme' },
    properties: {
      name: { type: 'string', predicate: 'we://name', default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      icon: { type: 'string', predicate: 'we://icon', default: '' },
      origin: { type: 'string', predicate: 'we://origin', default: '' },
      slug: { type: 'string', predicate: 'we://slug', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 1 },
      /** Raw CSS string (e.g. [data-we-theme='x'] { ... } rules, ::part() selectors, etc.) */
      css: { type: 'string', predicate: 'we://stylesheet', format: 'file', default: null },
      /** Structured token overrides (primaryHue, saturation, neutralSaturation, etc.) */
      overrides: { type: 'string', predicate: 'we://token_overrides', format: 'file', default: null },
    },
    relations: {
      screenshots: { target: 'ImageBlock', cardinality: 'many', predicate: 'we://screenshot' },
    },
  },
};
