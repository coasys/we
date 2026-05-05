import { Flag, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import type { FileData } from '../utils/imageHelpers';
import { WeNode } from '../WeNode';

@Model({ name: 'AgentProfile' })
export class AgentProfile extends WeNode {
  @Flag({ through: 'we://type', value: 'we://agent_profile' })
  type: string = '';

  @Property({ through: 'we://has_first_name' })
  firstName: string = '';

  @Property({ through: 'we://has_last_name' })
  lastName: string = '';

  @Property({ through: 'we://has_handle' })
  handle: string = '';

  @Property({ through: 'we://has_bio' })
  bio: string = '';

  @Property({ through: 'we://has_location' })
  location: string = '';

  @Property({
    through: 'we://has_profile_image',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) =>
      data && typeof data === 'object' && 'data_base64' in data
        ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}`
        : data,
  })
  profileImage?: string | FileData;

  @Property({
    through: 'we://has_cover_image',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) =>
      data && typeof data === 'object' && 'data_base64' in data
        ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}`
        : data,
  })
  coverImage?: string | FileData;
}
