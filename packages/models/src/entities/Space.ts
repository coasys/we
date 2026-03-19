import { HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import type { FileData } from '../utils/imageHelpers';
import { WeNode } from '../WeNode';

const FILE_STORAGE_LANGUAGE = 'QmzSYwdjqeP9D13Sfmyc5HcabM9jL3DtPyhadnF6dQXu4FjVSbQ';

@Model({ name: 'Space' })
export class Space extends WeNode {
  @Property({ through: 'we://has_uuid' })
  uuid: string = '';

  @Property({ through: 'we://has_url' })
  url?: string;

  @Property({ through: 'we://has_name', required: true })
  name: string = '';

  @Property({ through: 'we://has_description', required: true })
  description: string = '';

  @Property({ through: 'we://has_visibility' })
  visibility: string = '';

  @Property({
    through: 'we://has_image',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: any) =>
      data?.data_base64 ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}` : data,
  })
  image?: string | FileData;

  @Property({
    through: 'we://has_thumbnail',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: any) =>
      data?.data_base64 ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}` : data,
  })
  thumbnail?: string | FileData;

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];
}

export interface Space extends HasManyMethods<'locations'> {}
