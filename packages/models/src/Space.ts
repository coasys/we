import { Ad4mModel, HasMany, Model, Field } from '@coasys/ad4m';

@Model({ name: 'Space' })
export class Space extends Ad4mModel {
  @Field({ through: 'we://has_uuid', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  uuid: string = '';

  @Field({ through: 'we://has_name', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  name: string = '';

  @Field({ through: 'we://has_description', resolveLanguage: 'literal', writable: true, required: true, initial: 'literal://string:uninitialized' })
  description: string = '';

  @Field({ through: 'we://has_visibility', resolveLanguage: 'literal', writable: true })
  visibility: string = '';

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];

  @Field({ through: 'we://has_user_locations', resolveLanguage: 'literal', writable: true })
  userLocations: string = '[]'; // JSON string of UserLocation[]
}

export interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  avatar?: string;
  color?: string;
}

export interface SpaceType {
  uuid: string;
  name: string;
  description: string;
  visibility: string;
  locations: string[];
  userLocations?: string; // JSON string
}
