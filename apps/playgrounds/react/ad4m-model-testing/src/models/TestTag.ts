import { Ad4mModel, BelongsToMany, Flag, Model, Property } from '@coasys/ad4m';

import { TestPost } from './TestPost';

@Model({ name: 'TestTag' })
export class TestTag extends Ad4mModel {
  @Flag({ through: 'test://tag_type', value: 'test://tag' })
  type = 'test://tag';

  @Property({ through: 'test://label', required: true, writable: true, initial: 'literal://string:uninitialized' })
  label: string = '';

  // Reverse traversal: find all TestPosts that have a test://has_tag link pointing to this instance
  @BelongsToMany(() => TestPost, { through: 'test://has_tag' })
  posts: TestPost[] = [];
}
