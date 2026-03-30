import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'TagBlock' })
export class TagBlock extends WeNode {
  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://color' })
  color: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
