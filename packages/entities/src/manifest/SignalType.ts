import type { CoreEntityDef } from './defs';

export const SignalType: CoreEntityDef = {
  base: 'WeNode',
  unions: {
    mode: { alias: 'SignalMode', values: ['toggle', 'vote', 'rating', 'slider'] },
    aggregate: { alias: 'SignalAggregate', values: ['count', 'mean', 'sum', 'median'] },
    semantic: { alias: 'SignalSemantic', values: ['approval', 'quality', 'relevance', 'agreement', 'custom'] },
  },
  entity: {
    flag: { predicate: 'we://flag', value: 'we://signal_type' },
    properties: {
      name: { type: 'string', predicate: 'we://name', default: '' },
      slug: { type: 'string', predicate: 'we://slug', default: '' },
      description: { type: 'string', predicate: 'we://description', default: '' },
      icon: { type: 'string', predicate: 'we://icon', default: '' },
      iconSecondary: { type: 'string', predicate: 'we://icon_secondary', default: '' },
      step: { type: 'number', predicate: 'we://step', default: 1 },
      rangeMin: { type: 'number', predicate: 'we://range_min', default: 0 },
      rangeMax: { type: 'number', predicate: 'we://range_max', default: 1 },
      mode: { type: 'string', predicate: 'we://mode', default: 'toggle' },
      aggregate: { type: 'string', predicate: 'we://aggregate', default: 'count' },
      semantic: { type: 'string', predicate: 'we://semantic', default: 'custom' },
      allowChange: { type: 'boolean', predicate: 'we://allow_change', default: true },
      /** Reserved for future categorical signal support */
      valueType: { type: 'string', predicate: 'we://signal_value_type', default: 'numeric' },
      schemaVersion: { type: 'number', predicate: 'we://schema_version', default: 1 },
    },
    relations: {},
  },
};
