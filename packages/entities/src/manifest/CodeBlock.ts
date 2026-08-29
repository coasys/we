import type { CoreEntityDef } from './defs';

export const CodeBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    flag: { predicate: 'we://flag', value: 'we://code_block' },
    authoring: { fields: ['title', 'language', 'code'] },
    properties: {
      code: { type: 'string', predicate: 'we://code', control: 'textarea', required: true, default: '' },
      language: { type: 'string', predicate: 'we://language', default: '' },
      title: { type: 'string', predicate: 'we://title', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
