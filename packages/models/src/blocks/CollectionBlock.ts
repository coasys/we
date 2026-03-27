import { Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends WeNode {
  @Property({
    through: 'we://collection_block_node_type',
    required: true,
  })
  type: string = '';

  @Property({
    through: 'we://collection_block_display',
    required: true,
  })
  display: string = '';

  @Property({
    through: 'we://collection_block_direction',
    required: true,
  })
  direction: string = '';

  @Property({
    through: 'we://collection_block_format',
    required: true,
  })
  format: string = '';

  @Property({
    through: 'we://collection_block_indent',
    required: true,
  })
  indent: number = 0;

  @Property({
    through: 'we://collection_block_version',
    required: true,
  })
  version: number = 0;
}
