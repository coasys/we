import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'TaskBlock' })
export class TaskBlock extends WeNode {
  @Property({ through: 'we://title', required: true })
  title: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://status', initial: 'todo' })
  status: string = 'todo';

  @Property({ through: 'we://priority', initial: 'medium' })
  priority: string = 'medium';

  @Property({ through: 'we://due_date' })
  dueDate: string = '';

  @Property({ through: 'we://assignee' })
  assignee: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
