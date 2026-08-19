/**
 * GENERATED from src/manifest/entities/SpaceTemplatePreference.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'SpaceTemplatePreference' })
export class SpaceTemplatePreference extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space_template_preference' })
  flag: string = '';

  @Property({ through: 'we://space_url' })
  spaceUrl: string = '';

  @Property({ through: 'we://preference' })
  preference: string = '';
}
