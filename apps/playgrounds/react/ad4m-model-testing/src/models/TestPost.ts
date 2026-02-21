// TODO Phase 2: update imports to use @Model, @Field, @Flag, @HasMany
import { Ad4mModel, Collection, Flag, ModelOptions, Property } from '@coasys/ad4m';

@ModelOptions({ name: 'TestPost' })
export class TestPost extends Ad4mModel {
  @Flag({ through: 'test://post_type', value: 'test://post' })
  postType = 'test://post';

  @Property({ through: 'test://title', required: true, writable: true })
  title: string = '';

  @Property({ through: 'test://body', required: false, writable: true })
  body: string = '';

  @Collection({ through: 'test://has_tag' })
  tags: string[] = [];

  @Collection({ through: 'test://has_comment' })
  comments: string[] = [];
}
