import { Ad4mModel, Flag, HasMany, HasManyMethods, HasOne, Model, Property } from '@coasys/ad4m';
import { TestComment } from './TestComment';
import { TestTag } from './TestTag';

@Model({ name: 'TestPost' })
export class TestPost extends Ad4mModel {
  @Flag({ through: 'test://post_type', value: 'test://post' })
  type = 'test://post';

  @Property({ through: 'test://title', required: true, writable: true, initial: 'literal://string:uninitialized' })
  title: string = '';

  @Property({ through: 'test://body', writable: true })
  body: string = '';

  @HasMany(() => TestTag, { through: 'test://has_tag' })
  tags: string[] = [];

  @HasMany(() => TestComment, { through: 'test://has_comment' })
  comments: string[] = [];

  @HasOne(() => TestComment, { through: 'test://pinned_comment' })
  pinnedComment: string = '';
}
export interface TestPost extends HasManyMethods<'tags' | 'comments' | 'pinnedComment'> {}
