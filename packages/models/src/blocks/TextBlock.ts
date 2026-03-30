import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'TextBlock' })
export class TextBlock extends WeNode {
  @Property({ through: 'we://type' })
  type: string = '';

  @Property({ through: 'we://direction' })
  direction: string = '';

  @Property({ through: 'we://format' })
  format: string = '';

  @Property({ through: 'we://indent' })
  indent: number = 0;

  @Property({ through: 'we://textFormat' })
  textFormat: number = 0;

  @Property({ through: 'we://textStyle' })
  textStyle: string = '';

  @Property({ through: 'we://listType' })
  listType: string = '';

  @Property({ through: 'we://start' })
  start: number = 0;

  @Property({ through: 'we://tag' })
  tag: string = '';

  @Property({ through: 'we://text' })
  text: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
