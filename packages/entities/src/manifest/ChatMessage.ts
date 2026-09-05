import type { CoreEntityDef } from './defs';

export const ChatMessage: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://chat_message' },
    properties: {
      role: { type: 'string', predicate: 'we://role', default: '' },
      content: { type: 'string', predicate: 'we://content', default: '' },
    },
    relations: {},
  },
};
