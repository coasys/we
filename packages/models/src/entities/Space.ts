import { HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'Space' })
export class Space extends WeNode {
  @Property({ through: 'we://has_name', required: true })
  name: string = '';

  @Property({ through: 'we://has_description', required: true })
  description: string = '';

  @Property({ through: 'we://has_visibility' })
  visibility: string = '';

  @HasMany({ through: 'we://has_location' })
  locations: string[] = [];
}

export interface Space extends HasManyMethods<'locations'> {}
