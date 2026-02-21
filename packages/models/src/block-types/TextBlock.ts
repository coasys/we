import { Ad4mModel, ModelOptions, Property } from '@coasys/ad4m';

@ModelOptions({ name: 'TextBlock' })
export class TextBlock extends Ad4mModel {
  @Property({ through: 'we://text_block_node_type', resolveLanguage: 'literal', writable: true })
  type: string = '';

  @Property({ through: 'we://text_block_direction', resolveLanguage: 'literal', writable: true })
  direction: string = '';

  @Property({ through: 'we://text_block_format', resolveLanguage: 'literal', writable: true })
  format: string = '';

  @Property({ through: 'we://text_block_indent', resolveLanguage: 'literal', writable: true })
  indent: number = 0;

  @Property({ through: 'we://text_block_text_format', resolveLanguage: 'literal', writable: true })
  textFormat: number = 0;

  @Property({ through: 'we://text_block_text_style', resolveLanguage: 'literal', writable: true })
  textStyle: string = '';

  @Property({ through: 'we://text_block_list_type', resolveLanguage: 'literal', writable: true })
  listType: string = '';

  @Property({ through: 'we://text_block_start', resolveLanguage: 'literal', writable: true })
  start: number = 0;

  @Property({ through: 'we://text_block_tag', resolveLanguage: 'literal', writable: true })
  tag: string = '';

  @Property({ through: 'we://text_block_text', resolveLanguage: 'literal', writable: true })
  text: string = '';

  @Property({ through: 'we://text_block_version', resolveLanguage: 'literal', writable: true })
  version: number = 0;
}
