import type { CoreEntityDef } from '../defs';

export const LinkBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://link_block' },
    properties: {
      url: { type: 'string', predicate: 'we://url', required: true, default: '' },
      title: { type: 'string', predicate: 'we://title', default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      thumbnail: { type: 'string', predicate: 'we://thumbnail', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
