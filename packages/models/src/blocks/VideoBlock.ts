import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'VideoBlock' })
export class VideoBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://video_block' })
  flag: string = '';

  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://url', required: true })
  url: string = '';

  @Property({ through: 'we://duration' })
  duration: number = 0;

  @Property({ through: 'we://thumbnail' })
  thumbnail: string = '';

  @Property({ through: 'we://provider' })
  provider: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
