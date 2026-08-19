import type { CoreEntityDef } from '../defs';

export const CalloutBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://callout_block' },
    properties: {
      text: { type: 'string', predicate: 'we://text', default: '' },
      variant: { type: 'string', predicate: 'we://variant', default: 'info' },
      icon: { type: 'string', predicate: 'we://icon', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
