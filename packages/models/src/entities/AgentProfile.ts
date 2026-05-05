import { Flag, HasOne, Model, Property } from '@coasys/ad4m';

import { LocationBlock } from '../blocks/LocationBlock';
import { FILE_STORAGE_LANGUAGE } from '../constants';
import type { FileData } from '../utils/imageHelpers';
import { WeNode } from '../WeNode';

@Model({ name: 'AgentProfile' })
export class AgentProfile extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://agent_profile' })
  flag: string = '';

  @Property({ through: 'we://first_name' })
  firstName: string = '';

  @Property({ through: 'we://last_name' })
  lastName: string = '';

  @Property({ through: 'we://handle' })
  handle: string = '';

  @Property({ through: 'we://bio' })
  bio: string = '';

  @HasOne(() => LocationBlock, { through: 'we://location' })
  location?: LocationBlock;

  @Property({
    through: 'we://profile_image',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) =>
      data && typeof data === 'object' && 'data_base64' in data
        ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}`
        : data,
  })
  profileImage?: string | FileData;

  @Property({
    through: 'we://cover_image',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: (data: FileData | string | null | undefined) =>
      data && typeof data === 'object' && 'data_base64' in data
        ? `data:${data?.file_type || 'image/png'};base64,${data?.data_base64}`
        : data,
  })
  coverImage?: string | FileData;
}
