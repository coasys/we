/**
 * GENERATED from src/manifest/blocks/DividerBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'DividerBlock' })
export class DividerBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://divider_block' })
  flag: string = '';

  @Property({ through: 'we://style' })
  style: string = 'solid';

  @Property({ through: 'we://version' })
  version: number = 0;
}
