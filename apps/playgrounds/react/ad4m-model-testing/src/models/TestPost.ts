import { Ad4mModel, HasMany, Flag, Model, Field } from '@coasys/ad4m';

@Model({ name: 'TestPost' })
export class TestPost extends Ad4mModel {
  @Flag({ through: 'test://post_type', value: 'test://post' })
  postType = 'test://post';

  @Field({ through: 'test://title', required: true, writable: true, initial: 'literal://string:uninitialized' })
  title: string = '';

  @Field({ through: 'test://body', writable: true })
  body: string = '';

  @HasMany({ through: 'test://has_tag' })
  tags: string[] = [];

  @HasMany({ through: 'test://has_comment' })
  comments: string[] = [];
}
