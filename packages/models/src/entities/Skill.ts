import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * A named capability an AI assistant can be granted. `body` holds the skill's
 * instructions/definition (interpreted by the AD4M backend); `description` is a
 * short human summary. Lives in the personal (we-root) perspective.
 */
@Model({ name: 'Skill' })
export class Skill extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://skill' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://body' })
  body: string = '';
}
