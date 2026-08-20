/**
 * GENERATED from src/manifest/blocks/ImageBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { fileToDataUri, Flag, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/models';

import { WeNode } from '../WeNode';

@Model({ name: 'ImageBlock' })
export class ImageBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://image_block' })
  flag: string = '';

  @Property({ through: 'we://src', required: true, resolveLanguage: FILE_STORAGE_LANGUAGE, transform: fileToDataUri })
  src: string = '';

  @Property({ through: 'we://altText' })
  altText: string = '';

  @Property({ through: 'we://width' })
  width: number = 0;

  @Property({ through: 'we://height' })
  height: number = 0;

  @Property({ through: 'we://version' })
  version: number = 0;
}
