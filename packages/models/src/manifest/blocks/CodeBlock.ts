import type { CoreEntityDef } from '../defs';

export const CodeBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://code_block' },
    properties: {
      code: { type: 'string', predicate: 'we://code', required: true, default: '' },
      language: { type: 'string', predicate: 'we://language', default: '' },
      title: { type: 'string', predicate: 'we://title', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
