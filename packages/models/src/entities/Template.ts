import { Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import type { FileData } from '../utils/imageHelpers';
import { WeNode } from '../WeNode';

@Model({ name: 'Template' })
export class Template extends WeNode {
  @Property({ through: 'we://template_name' })
  name: string = '';

  @Property({ through: 'we://template_origin' })
  origin: string = ''; // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://template_active' })
  active: boolean = false;

  @Property({ through: 'we://template_version' })
  version: number = 1;

  @Property({
    through: 'we://has_template_schema',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) => {
      if (data && typeof data === 'object' && 'data_base64' in data) {
        try {
          return JSON.parse(atob(data.data_base64));
        } catch {
          return {};
        }
      }
      if (typeof data === 'string') {
        try {
          return JSON.parse(data);
        } catch {
          return {};
        }
      }
      return data ?? {};
    },
  })
  schema: Record<string, unknown> = {}; // TODO: why not make this TemplateSchema?
}
