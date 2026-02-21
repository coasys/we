// TODO Phase 2: update imports to use @Model, @Field, @Flag
// TODO Phase 2: add @BelongsToMany(() => TestPost, { through: 'test://has_tag' })
import { Ad4mModel, Flag, ModelOptions, Property } from '@coasys/ad4m';

@ModelOptions({ name: 'TestTag' })
export class TestTag extends Ad4mModel {
  @Flag({ through: 'test://tag_type', value: 'test://tag' })
  tagType = 'test://tag';

  @Property({ through: 'test://label', required: true, writable: true })
  label: string = '';

  // Phase 2: becomes @BelongsToMany(() => TestPost, { through: 'test://has_tag' })
}
