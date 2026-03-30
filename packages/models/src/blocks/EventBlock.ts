import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'EventBlock' })
export class EventBlock extends WeNode {
  @Property({ through: 'we://title', required: true })
  title: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://start_date', required: true })
  startDate: string = '';

  @Property({ through: 'we://end_date' })
  endDate: string = '';

  @Property({ through: 'we://location' })
  location: string = '';

  @Property({ through: 'we://all_day' })
  allDay: boolean = false;

  @Property({ through: 'we://version' })
  version: number = 0;
}
