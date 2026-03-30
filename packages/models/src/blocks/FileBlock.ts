import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'FileBlock' })
export class FileBlock extends WeNode {
  @Property({ through: 'we://name', required: true })
  name: string = '';

  @Property({ through: 'we://url', required: true })
  url: string = '';

  @Property({ through: 'we://mime_type' })
  mimeType: string = '';

  @Property({ through: 'we://size' })
  size: number = 0;

  @Property({ through: 'we://version' })
  version: number = 0;
}
