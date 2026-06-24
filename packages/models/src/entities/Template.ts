import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { ImageBlock } from '../blocks/ImageBlock';
import { FILE_STORAGE_LANGUAGE } from '../constants';
import { WeNode } from '../WeNode';

@Model({ name: 'Template' })
export class Template extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://template' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://origin' })
  origin: string = ''; // 'built-in' | 'shared' | 'custom' | 'marketplace'

  @Property({ through: 'we://version' })
  version: number = 1;

  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({
    through: 'we://template_schema',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
  })
  schema: string | null = null;

  @Property({ through: 'we://theme_id' })
  themeId: string = '';

  @HasMany(() => ImageBlock, { through: 'we://screenshot' })
  screenshots: string[] = [];
}

export interface Template extends HasManyMethods<'screenshots'> {}
