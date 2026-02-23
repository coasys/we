import { Ad4mModel, Field, HasMany, Model } from '@coasys/ad4m';

@Model({ name: 'Space' })
export class Space extends Ad4mModel {
  @Field({
    through: 'we://has_name',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  name: string = '';

  @Field({
    through: 'we://has_description',
    resolveLanguage: 'literal',
    writable: true,
    required: true,
    initial: 'literal://string:uninitialized',
  })
  description: string = '';

  @Field({ through: 'we://has_visibility', resolveLanguage: 'literal', writable: true })
  visibility: string = '';

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];
  declare addLocations: (value: string) => Promise<void>;
  declare removeLocations: (value: string) => Promise<void>;
  declare setLocations: (values: string[]) => Promise<void>;
}
