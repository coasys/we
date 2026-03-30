import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'AudioBlock' })
export class AudioBlock extends WeNode {
  @Property({ through: 'we://title', required: true })
  title: string = '';

  @Property({ through: 'we://artist' })
  artist: string = '';

  @Property({ through: 'we://audio_url', required: true })
  audioUrl: string = '';

  @Property({ through: 'we://duration' })
  duration: number = 0;

  @Property({ through: 'we://album_art' })
  albumArt: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
