import type { CoreEntityDef } from './defs';

export const ChatSession: CoreEntityDef = {
  base: 'WeNode',
  methodRelations: ['messages'],
  typedArrays: ['messages'],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://chat_session' },
    properties: {
      name: { type: 'string', predicate: 'we://name', default: '' },
      templateId: { type: 'string', predicate: 'we://template_id', default: '' },
    },
    relations: {
      messages: { target: 'ChatMessage', cardinality: 'many', predicate: 'we://chat_message' },
    },
  },
};
