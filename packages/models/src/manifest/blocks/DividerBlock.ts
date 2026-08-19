import type { CoreEntityDef } from '../defs';

export const DividerBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://divider_block' },
    properties: {
      style: { type: 'string', predicate: 'we://style', default: 'solid' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
