import { Ad4mModel, Model, Property } from '@coasys/ad4m';

@Model({ name: 'TextBlock' })
export class TextBlock extends Ad4mModel {
  @Property({
    through: 'we://text_block_node_type',
    required: true,
  })
  type: string = '';

  @Property({
    through: 'we://text_block_direction',
    required: true,
  })
  direction: string = '';

  @Property({
    through: 'we://text_block_format',
    required: true,
  })
  format: string = '';

  @Property({
    through: 'we://text_block_indent',
    required: true,
  })
  indent: number = 0;

  @Property({
    through: 'we://text_block_text_format',
    required: true,
  })
  textFormat: number = 0;

  @Property({
    through: 'we://text_block_text_style',
    required: true,
  })
  textStyle: string = '';

  @Property({
    through: 'we://text_block_list_type',
    required: true,
  })
  listType: string = '';

  @Property({
    through: 'we://text_block_start',
    required: true,
  })
  start: number = 0;

  @Property({
    through: 'we://text_block_tag',
    required: true,
  })
  tag: string = '';

  @Property({
    through: 'we://text_block_text',
    required: true,
  })
  text: string = '';

  @Property({
    through: 'we://text_block_version',
    required: true,
  })
  version: number = 0;
}
