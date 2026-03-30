import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'CalloutBlock' })
export class CalloutBlock extends WeNode {
  @Property({ through: 'we://text' })
  text: string = '';

  @Property({ through: 'we://variant', initial: 'info' })
  variant: string = 'info';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
