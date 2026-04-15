import { Flag, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { decodeFileAsJson } from '../utils/fileTransforms';
import { WeNode } from '../WeNode';

@Model({ name: 'Template' })
export class Template extends WeNode {
  @Flag({ through: 'we://type', value: 'we://template' })
  type: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://origin' })
  origin: string = ''; // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://version' })
  version: number = 1;

  @Property({
    through: 'we://template_schema',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: decodeFileAsJson,
  })
  schema: Record<string, unknown> = {};
}
