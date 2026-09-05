import type { CoreEntityDef } from './defs';

export const TagBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    flag: { predicate: 'we://flag', value: 'we://tag_block' },
    authoring: { fields: ['name', 'color'] },
    properties: {
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      color: { type: 'string', predicate: 'we://color', control: 'color', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
