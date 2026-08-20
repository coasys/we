/**
 * GENERATED from src/manifest/blocks/EmbedBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'EmbedBlock' })
export class EmbedBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://embed_block' })
  flag: string = '';

  @Property({ through: 'we://url' })
  url: string = '';

  @Property({ through: 'we://target' })
  target: string = '';

  @Property({ through: 'we://target_type' })
  targetType: string = '';

  @Property({ through: 'we://display_mode' })
  displayMode: string = 'card';

  @Property({ through: 'we://version' })
  version: number = 0;
}
