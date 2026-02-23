import { Ad4mModel, Model, Property } from '@coasys/ad4m';

@Model({ name: 'TextBlock' })
export class TextBlock extends Ad4mModel {
  @Property({ through: 'we://text_block_node_type', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  type: string = '';

  @Property({ through: 'we://text_block_direction', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  direction: string = '';

  @Property({ through: 'we://text_block_format', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  format: string = '';

  @Property({ through: 'we://text_block_indent', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  indent: number = 0;

  @Property({ through: 'we://text_block_text_format', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  textFormat: number = 0;

  @Property({ through: 'we://text_block_text_style', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  textStyle: string = '';

  @Property({ through: 'we://text_block_list_type', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  listType: string = '';

  @Property({ through: 'we://text_block_start', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  start: number = 0;

  @Property({ through: 'we://text_block_tag', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  tag: string = '';

  @Property({ through: 'we://text_block_text', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  text: string = '';

  @Property({ through: 'we://text_block_version', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  version: number = 0;
}
