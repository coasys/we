import { fileToDataUri, Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'AudioBlock' })
export class AudioBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://audio_block' })
  flag: string = '';

  @Property({ through: 'we://title', required: true })
  title: string = '';

  @Property({ through: 'we://artist' })
  artist: string = '';

  @Property({
    through: 'we://audio_url',
    required: true,
    resolveLiteral: false,
    transform: fileToDataUri,
  })
  audioUrl: string = '';

  @Property({ through: 'we://duration' })
  duration: number = 0;

  @Property({ through: 'we://album_art' })
  albumArt: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
