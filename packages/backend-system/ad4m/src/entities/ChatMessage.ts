/**
 * GENERATED from src/manifest/ChatMessage.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from './WeNode';

@Model({ name: 'ChatMessage' })
export class ChatMessage extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://chat_message' })
  flag: string = '';

  @Property({ through: 'we://role' })
  role: string = '';

  @Property({ through: 'we://content' })
  content: string = '';
}
