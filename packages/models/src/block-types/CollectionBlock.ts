import { Ad4mModel, ModelOptions, Property } from '@coasys/ad4m';

@ModelOptions({ name: 'CollectionBlock' })
export class CollectionBlock extends Ad4mModel {
  @Property({ through: 'we://collection_block_node_type', resolveLanguage: 'literal', writable: true })
  type: string = '';

  @Property({ through: 'we://collection_block_display', resolveLanguage: 'literal', writable: true })
  display: string = '';

  @Property({ through: 'we://collection_block_direction', resolveLanguage: 'literal', writable: true })
  direction: string = '';

  @Property({ through: 'we://collection_block_format', resolveLanguage: 'literal', writable: true })
  format: string = '';

  @Property({ through: 'we://collection_block_indent', resolveLanguage: 'literal', writable: true })
  indent: number = 0;

  @Property({ through: 'we://collection_block_version', resolveLanguage: 'literal', writable: true })
  version: number = 0;
}
