import { fileToDataUri, Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'ImageBlock' })
export class ImageBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://image_block' })
  flag: string = '';

  @Property({ through: 'we://src', required: true, resolveLiteral: false, transform: fileToDataUri })
  src: string = '';

  @Property({ through: 'we://altText' })
  altText: string = '';

  @Property({ through: 'we://width' })
  width: number = 0;

  @Property({ through: 'we://height' })
  height: number = 0;

  @Property({ through: 'we://version' })
  version: number = 0;
}
