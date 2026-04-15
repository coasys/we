import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

@Model({ name: 'ChatMessage' })
export class ChatMessage extends WeNode {
  @Flag({ through: 'we://type', value: 'we://chat_message' })
  type: string = '';

  @Property({ through: 'we://role' })
  role: string = ''; // 'user' | 'assistant'

  @Property({ through: 'we://message_type' })
  messageType: string = 'text'; // 'text' | 'success' | 'error' | 'info'

  @Property({ through: 'we://content' })
  content: string = '';

  @Property({ through: 'we://thinking' })
  thinking: string = '';
}
