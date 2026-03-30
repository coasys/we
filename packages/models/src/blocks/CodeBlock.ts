import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'CodeBlock' })
export class CodeBlock extends WeNode {
  @Property({ through: 'we://code', required: true })
  code: string = '';

  @Property({ through: 'we://language' })
  language: string = '';

  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://version' })
  version: number = 0;
}
