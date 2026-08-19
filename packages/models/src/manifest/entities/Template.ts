import type { CoreEntityDef } from '../defs';

export const Template: CoreEntityDef = {
  base: 'WeNode',
  methodRelations: ['screenshots'],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://template' },
    properties: {
      name: { type: 'string', predicate: 'we://name', default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      icon: { type: 'string', predicate: 'we://icon', default: '' },
      origin: { type: 'string', predicate: 'we://origin', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 1 },
      slug: { type: 'string', predicate: 'we://slug', default: '' },
      schema: { type: 'string', predicate: 'we://template_schema', format: 'file', default: null },
      themeId: { type: 'string', predicate: 'we://theme_id', default: '' },
    },
    relations: {
      screenshots: { target: 'ImageBlock', cardinality: 'many', predicate: 'we://screenshot' },
    },
  },
};
