import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * A reusable personality an AI assistant can adopt — a named block of guidance
 * text merged into the assistant's system prompt. Lives in the personal
 * (we-root) perspective and can be granted to any assistant.
 */
@Model({ name: 'Personality' })
export class Personality extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://personality' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://body' })
  body: string = '';
}
