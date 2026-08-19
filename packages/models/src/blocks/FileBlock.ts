/**
 * GENERATED from src/manifest/blocks/FileBlock.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { fileToDataUri, Flag, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { WeNode } from '../WeNode';

@Model({ name: 'FileBlock' })
export class FileBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://file_block' })
  flag: string = '';

  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://url', required: true, resolveLanguage: FILE_STORAGE_LANGUAGE, transform: fileToDataUri })
  url: string = '';

  @Property({ through: 'we://mime_type' })
  mimeType: string = '';

  @Property({ through: 'we://size' })
  size: number = 0;

  @Property({ through: 'we://version' })
  version: number = 0;
}
