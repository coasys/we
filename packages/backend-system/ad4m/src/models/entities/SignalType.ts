/**
 * GENERATED from src/manifest/entities/SignalType.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

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

  /** Reserved for future categorical signal support */
  @Property({ through: 'we://signal_value_type' })
  valueType: string = 'numeric';

  @Property({ through: 'we://schema_version' })
  schemaVersion: number = 1;
}
