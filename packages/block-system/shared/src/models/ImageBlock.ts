import { Model, Property } from '@coasys/ad4m';
import { WeNode } from '@we/models';

@Model({ name: 'ImageBlock' })
export class ImageBlock extends WeNode {
  @Property({
    through: 'we://image_block_node_type',
    required: true,
  })
  type: string = '';

  @Property({
    through: 'we://image_block_src',
    required: true,
  })
  src: string = '';

  @Property({
    through: 'we://image_block_alt_text',
    required: true,
  })
  altText: string = '';

  @Property({
    through: 'we://image_block_width',
    required: true,
  })
  width: number = 0;

  @Property({
    through: 'we://image_block_height',
    required: true,
  })
  height: number = 0;

  @Property({
    through: 'we://image_block_version',
    required: true,
  })
  version: number = 0;
}
