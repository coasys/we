import type { CoreEntityDef } from '../defs';

export const LinkBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://link_block' },
    authoring: { fields: ['url', 'title', 'description'] },
    properties: {
      url: { type: 'string', predicate: 'we://url', control: 'url', required: true, default: '' },
      title: { type: 'string', predicate: 'we://title', default: '' },
      description: { type: 'string', predicate: 'we://description', control: 'textarea', default: '' },
      thumbnail: { type: 'string', predicate: 'we://thumbnail', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
