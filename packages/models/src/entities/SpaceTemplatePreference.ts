import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'SpaceTemplatePreference' })
export class SpaceTemplatePreference extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space_template_preference' })
  flag: string = '';

  @Property({ through: 'we://space_url' })
  spaceUrl: string = '';

  @Property({ through: 'we://preference' })
  preference: string = ''; // 'space' | 'user'
}
