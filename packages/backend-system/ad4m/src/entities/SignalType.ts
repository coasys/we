/**
 * GENERATED from src/manifest/SignalType.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

export type SignalMode = 'toggle' | 'vote' | 'rating' | 'slider';
export type SignalAggregate = 'count' | 'mean' | 'sum' | 'median';
export type SignalSemantic = 'approval' | 'quality' | 'relevance' | 'agreement' | 'custom';

@Model({ name: 'SignalType' })
export class SignalType extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://signal_type' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://icon_secondary' })
  iconSecondary: string = '';

  @Property({ through: 'we://step' })
  step: number = 1;

  @Property({ through: 'we://range_min' })
  rangeMin: number = 0;

  @Property({ through: 'we://range_max' })
  rangeMax: number = 1;

  @Property({ through: 'we://mode' })
  mode: SignalMode = 'toggle';

  @Property({ through: 'we://aggregate' })
  aggregate: SignalAggregate = 'count';

  @Property({ through: 'we://semantic' })
  semantic: SignalSemantic = 'custom';

  @Property({ through: 'we://allow_change' })
  allowChange: boolean = true;

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
  @Property({ through: 'we://retired' })
  retired: boolean = false;

  /** Reserved for future categorical signal support */
  @Property({ through: 'we://signal_value_type' })
  valueType: string = 'numeric';

  @Property({ through: 'we://schema_version' })
  schemaVersion: number = 1;
}
