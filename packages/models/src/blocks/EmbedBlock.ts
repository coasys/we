import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'EmbedBlock' })
export class EmbedBlock extends WeNode {
  @Property({ through: 'we://url' })
  url: string = '';

  @Property({ through: 'we://target' })
  target: string = '';

  @Property({ through: 'we://target_type' })
  targetType: string = '';

  @Property({ through: 'we://display_mode', initial: 'card' })
  displayMode: string = 'card';

  @Property({ through: 'we://version' })
  version: number = 0;
}
