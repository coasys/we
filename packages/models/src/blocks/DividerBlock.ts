import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'DividerBlock' })
export class DividerBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://divider_block' })
  flag: string = '';

  @Property({ through: 'we://style', initial: 'solid' })
  style: string = 'solid';

  @Property({ through: 'we://version' })
  version: number = 0;
}
