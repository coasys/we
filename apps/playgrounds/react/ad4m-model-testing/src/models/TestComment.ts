// TODO Phase 2: update imports to use @Model, @Field, @Flag
// TODO Phase 2: add @BelongsToOne(() => TestPost, { through: 'test://has_comment' })
import { Ad4mModel, Flag, ModelOptions, Property } from '@coasys/ad4m';

@ModelOptions({ name: 'TestComment' })
export class TestComment extends Ad4mModel {
  @Flag({ through: 'test://comment_type', value: 'test://comment' })
  commentType = 'test://comment';

  @Property({ through: 'test://body', required: true, writable: true })
  body: string = '';

  // Phase 2: becomes @BelongsToOne(() => TestPost, { through: 'test://has_comment' })
  // For now this is the raw parent base expression ID, managed manually in scenarios
  @Property({ through: 'test://comment_post', required: true, writable: false })
  postId: string = '';
}
