import { Ad4mModel, BelongsToOne, Flag, Model, Field } from '@coasys/ad4m';
import { TestPost } from './TestPost';

@Model({ name: 'TestComment' })
export class TestComment extends Ad4mModel {
  @Flag({ through: 'test://comment_type', value: 'test://comment' })
  commentType = 'test://comment';

  @Field({ through: 'test://body', required: true, writable: true, initial: 'literal://string:uninitialized' })
  body: string = '';

  // Reverse traversal: find the TestPost that has a test://has_comment link pointing to this instance
  @BelongsToOne(() => TestPost, { through: 'test://has_comment' })
  post: string = '';
}
