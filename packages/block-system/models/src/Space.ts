import { Ad4mModel, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

@Model({ name: 'Space' })
export class Space extends Ad4mModel {
  @Property({
    through: 'we://has_name',
    required: true,
  })
  name: string = '';

  @Property({
    through: 'we://has_description',
    required: true,
  })
  description: string = '';

  @Property({ through: 'we://has_visibility' })
  visibility: string = '';

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];
}

export interface Space extends HasManyMethods<'locations'> {}
