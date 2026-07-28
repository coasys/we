import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';
import { Message } from './Message';

/**
 * An assistant conversation. Belongs to a neighbourhood perspective — the space
 * it was created in — so a neighbourhood can hold many threads. `assistantId`
 * references an {@link Assistant} in the personal (we-root) perspective;
 * `modelId` is an optional per-thread model override (falls back to the
 * assistant's `modelId` when empty).
 *
 * Messages are queried by `Message.threadId` (the canonical join); the HasMany
 * relation here exists for ORM navigation and parent-linked creation.
 */
@Model({ name: 'Thread' })
export class Thread extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://thread' })
  flag: string = '';

  @Property({ through: 'we://title' })
  title: string = '';

  @Property({ through: 'we://assistant_id' })
  assistantId: string = '';

  /** Optional per-thread model override; empty → use the assistant's modelId. */
  @Property({ through: 'we://model_id' })
  modelId: string = '';

  @Property({ through: 'we://created_at' })
  createdAt: string = '';

  @Property({ through: 'we://updated_at' })
  updatedAt: string = '';

  @HasMany(() => Message, { through: 'we://message' })
  messages: Message[] = [];
}

export interface Thread extends HasManyMethods<'messages'> {}
