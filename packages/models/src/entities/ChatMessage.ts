import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'ChatMessage' })
export class ChatMessage extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://chat_message' })
  flag: string = '';

  @Property({ through: 'we://role' })
  role: string = ''; // 'user' | 'assistant'

  @Property({ through: 'we://content' })
  content: string = '';
}
