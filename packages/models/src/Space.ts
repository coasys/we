import { Ad4mModel, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

@Model({ name: 'Space' })
export class Space extends Ad4mModel {
  @Property({
    through: 'we://has_name',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  name: string = '';

  @Property({
    through: 'we://has_description',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  description: string = '';

  @Property({ through: 'we://has_visibility', resolveLanguage: 'literal', writable: true })
  visibility: string = '';

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];
}

export interface Space extends HasManyMethods<'locations'> {}
