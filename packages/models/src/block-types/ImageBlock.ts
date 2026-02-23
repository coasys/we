import { Ad4mModel, Model, Property } from '@coasys/ad4m';

@Model({ name: 'ImageBlock' })
export class ImageBlock extends Ad4mModel {
  @Property({ through: 'we://image_block_node_type', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  type: string = '';

  @Property({ through: 'we://image_block_src', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  src: string = '';

  @Property({ through: 'we://image_block_alt_text', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  altText: string = '';

  @Property({ through: 'we://image_block_width', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  width: number = 0;

  @Property({ through: 'we://image_block_height', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  height: number = 0;

  @Property({ through: 'we://image_block_version', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  version: number = 0;
}
