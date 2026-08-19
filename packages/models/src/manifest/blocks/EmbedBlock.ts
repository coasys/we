import type { CoreEntityDef } from '../defs';

export const EmbedBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://embed_block' },
    properties: {
      url: { type: 'string', predicate: 'we://url', default: '' },
      target: { type: 'string', predicate: 'we://target', default: '' },
      targetType: { type: 'string', predicate: 'we://target_type', default: '' },
      displayMode: { type: 'string', predicate: 'we://display_mode', default: 'card' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
