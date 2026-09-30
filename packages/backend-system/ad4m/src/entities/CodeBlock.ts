/**
 * GENERATED from src/manifest/CodeBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

@Model({ name: 'CodeBlock' })
export class CodeBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://code_block' })
  flag: string = '';

  @Property({ through: 'we://code', required: true })
  code: string = '';

  @Property({ through: 'we://language' })
  language: string = '';

  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
