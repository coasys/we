import type { CoreEntityDef } from './defs';

export const Signal: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://signal' },
    properties: {
      signalTypeId: { type: 'string', predicate: 'we://signal_type_id', default: '' },
      value: { type: 'number', predicate: 'we://value', default: 0 },
    },
    relations: {},
  },
};
