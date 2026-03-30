import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'LocationBlock' })
export class LocationBlock extends WeNode {
  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://latitude', required: true })
  latitude: number = 0;

  @Property({ through: 'we://longitude', required: true })
  longitude: number = 0;

  @Property({ through: 'we://address' })
  address: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
