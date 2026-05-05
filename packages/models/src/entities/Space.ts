import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { LocationBlock } from '../blocks/LocationBlock';
import { FILE_STORAGE_LANGUAGE } from '../constants';
import type { FileData } from '../utils/imageHelpers';
import { WeNode } from '../WeNode';

@Model({ name: 'Space' })
export class Space extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space' })
  flag: string = '';

  @Property({ through: 'we://uuid' })
  uuid: string = '';

  @Property({ through: 'we://url' })
  url?: string;

  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://description', required: true })
  description: string = '';

  @Property({ through: 'we://visibility' })
  visibility: string = '';

  @Property({
    through: 'we://image',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) =>
      data && typeof data === 'object' && 'data_base64' in data
        ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}`
        : data,
  })
  image?: string | FileData;

  @Property({
    through: 'we://thumbnail',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) =>
      data && typeof data === 'object' && 'data_base64' in data
        ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}`
        : data,
  })
  thumbnail?: string | FileData;

  @HasMany(() => LocationBlock, { through: 'we://location' })
  locations: LocationBlock[] = [];
}

export interface Space extends HasManyMethods<'locations'> {}
