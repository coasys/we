import { HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { decodeFileAsJson } from '../utils/fileTransforms';
import { WeNode } from '../WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @HasMany({ through: 'we://children' })
  children: string[] = [];

  @Property({
    through: 'we://editor_state',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: decodeFileAsJson,
  })
  editorState: Record<string, unknown> = {};

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
