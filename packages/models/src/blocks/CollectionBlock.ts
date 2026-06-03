import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { decodeFileAsJson } from '../utils/fileTransforms';
import { WeNode } from '../WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://collection_block' })
  flag: string = '';

  @HasMany({ through: 'we://children' })
  children: string[] = [];

  @Property({
    through: 'we://editor_state',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: decodeFileAsJson as any,
  })
  editorState: Record<string, unknown> | null = null;

  @Property({ through: 'we://type' })
  type: string = '';

  @Property({ through: 'we://display' })
  display: string = '';

  @Property({ through: 'we://direction' })
  direction: string = '';

  @Property({ through: 'we://format' })
  format: string = '';

  @Property({ through: 'we://indent' })
  indent: number = 0;

  @Property({ through: 'we://columns' })
  columns: number = 0;

  @Property({ through: 'we://gap' })
  gap: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}

export interface CollectionBlock extends HasManyMethods<'children'> {}
