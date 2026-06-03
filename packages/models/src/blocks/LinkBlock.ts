import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'LinkBlock' })
export class LinkBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://link_block' })
  flag: string = '';

  @Property({ through: 'we://url', required: true })
  url: string = '';

  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://thumbnail' })
  thumbnail: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
