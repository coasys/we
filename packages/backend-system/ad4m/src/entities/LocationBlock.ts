/**
 * GENERATED from src/manifest/LocationBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

@Model({ name: 'LocationBlock' })
export class LocationBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://location_block' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://latitude', required: true })
  latitude: number = 0;

  @Property({ through: 'we://longitude', required: true })
  longitude: number = 0;

  @Property({ through: 'we://address' })
  address: string = '';

  @Property({ through: 'we://city' })
  city?: string;

  /** ISO 3166-1 alpha-2 code (e.g. 'DE'). Use for filtering/grouping; display country for labels. */
  @Property({ through: 'we://country_code' })
  countryCode?: string;

  @Property({ through: 'we://country' })
  country?: string;

  @Property({ through: 'we://version' })
  version: number = 0;
}
