/**
 * GENERATED from src/manifest/entities/Signal.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

@Model({ name: 'Signal' })
export class Signal extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://signal' })
  flag: string = '';

  @Property({ through: 'we://signal_type_id' })
  signalTypeId: string = '';

  @Property({ through: 'we://value' })
  value: number = 0;
}
