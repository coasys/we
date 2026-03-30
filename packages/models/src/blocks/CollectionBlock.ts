import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @Property({ through: 'we://display' })
  display: string = '';

  @Property({ through: 'we://direction' })
  direction: string = '';

  @Property({ through: 'we://format' })
  format: string = '';

  @Property({ through: 'we://indent' })
  indent: number = 0;

  @Property({ through: 'we://columns' })
  columns: number = 0;

  @Property({ through: 'we://gap' })
  gap: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
