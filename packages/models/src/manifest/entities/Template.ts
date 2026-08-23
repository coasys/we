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
      /**
       * Whether this record is a whole interface or one section of one — `'shell'` or `'view'`.
       *
       * The queryable mirror of `TemplateMeta.role`, written on every save and publish, exactly as
       * `themeId` mirrors `meta.themeId` and for the same reason: the authoritative copy lives
       * inside the serialized `schema` blob, and a marketplace cannot filter on a field it would
       * have to parse every record to read.
       *
       * **Absent means shell**, and that asymmetry is deliberate. Every template published before
       * views existed has no value here, so the marketplace's template list asks for `not: 'view'`
       * rather than `'shell'` — anything else would empty the shelf of everything already on it.
       */
      role: { type: 'string', predicate: 'we://template_role', default: '' },
    },
    relations: {
      screenshots: { target: 'ImageBlock', cardinality: 'many', predicate: 'we://screenshot' },
    },
  },
};
