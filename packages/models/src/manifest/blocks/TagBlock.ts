import type { CoreEntityDef } from '../defs';

export const TagBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://tag_block' },
    properties: {
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      color: { type: 'string', predicate: 'we://color', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
