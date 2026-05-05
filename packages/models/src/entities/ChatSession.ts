import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';
import { ChatMessage } from './ChatMessage';

@Model({ name: 'ChatSession' })
export class ChatSession extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://chat_session' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @HasMany(() => ChatMessage, { through: 'we://chat_message' })
  messages: ChatMessage[] = [];
}

export interface ChatSession extends HasManyMethods<'messages'> {}
