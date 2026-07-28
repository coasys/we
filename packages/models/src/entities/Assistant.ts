import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * An AI assistant configuration. Lives in the personal (we-root) perspective and
 * is referenced by `Thread.assistantId` when a conversation is opened with it.
 *
 * `personalityIds`, `skillIds` and `mcpServerIds` are JSON-encoded `string[]`s of
 * the ids of the granted {@link Personality} / {@link Skill} / {@link McpServer}
 * records (all in the same perspective). JSON arrays — rather than AD4M HasMany
 * link relations — keep the grant set a single atomic property that any backend
 * can read/write in one write, mirroring how `AgentSettings.perspectiveOrder`
 * stores an id list. Use the empty string or `"[]"` for "none".
 */
@Model({ name: 'Assistant' })
export class Assistant extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://assistant' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  /** Model identifier the assistant runs on (e.g. an id from the backend's /v1/models). */
  @Property({ through: 'we://model_id' })
  modelId: string = '';

  /** Optional base system prompt, prepended ahead of any granted personalities. */
  @Property({ through: 'we://system_prompt' })
  systemPrompt: string = '';

  /** JSON-encoded string[] of granted Personality ids. */
  @Property({ through: 'we://personality_ids' })
  personalityIds: string = '';

  /** JSON-encoded string[] of granted Skill ids. */
  @Property({ through: 'we://skill_ids' })
  skillIds: string = '';

  /** JSON-encoded string[] of granted McpServer ids. */
  @Property({ through: 'we://mcp_server_ids' })
  mcpServerIds: string = '';
}
