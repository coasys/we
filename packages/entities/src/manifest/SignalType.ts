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
      /**
       * Withdrawn from use, without withdrawing what people gave.
       *
       * A signal type is a word a community agreed on, and a `Signal` refers to it by *record id*
       * — so deleting the type does not remove the thousands of reactions that name it, it makes
       * them unreachable. Every template resolves a type by slug (`find(local.signalTypes, { slug:
       * 'like' }).id`), and a re-created type is a new record with a new id, so "delete it and add
       * it back" does not restore the history either. The rows are simply stranded.
       *
       * Retiring is the reversible version of that decision, and it matches what `deleteShape`
       * already does one layer up: the definition stops being offered, the instances keep their
       * data, and putting the type back brings every reaction with it.
       */
      retired: { type: 'boolean', predicate: 'we://retired', default: false },
      /** Reserved for future categorical signal support */
      valueType: { type: 'string', predicate: 'we://signal_value_type', default: 'numeric' },
      schemaVersion: { type: 'number', predicate: 'we://schema_version', default: 1 },
    },
    relations: {},
  },
};
