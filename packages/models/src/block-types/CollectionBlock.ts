import { Ad4mModel, Model, Property } from '@coasys/ad4m';

@Model({ name: 'CollectionBlock' })
export class CollectionBlock extends Ad4mModel {
  @Property({
    through: 'we://collection_block_node_type',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  type: string = '';

  @Property({
    through: 'we://collection_block_display',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  display: string = '';

  @Property({
    through: 'we://collection_block_direction',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  direction: string = '';

  @Property({
    through: 'we://collection_block_format',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  format: string = '';

  @Property({
    through: 'we://collection_block_indent',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  indent: number = 0;

  @Property({
    through: 'we://collection_block_version',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  version: number = 0;
}
