import { Flag, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { WeNode } from '../WeNode';

@Model({ name: 'Template' })
export class Template extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://template' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://origin' })
  origin: string = ''; // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://version' })
  version: number = 1;

  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({
    through: 'we://template_schema',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
  })
  schema: string | null = null;
}
