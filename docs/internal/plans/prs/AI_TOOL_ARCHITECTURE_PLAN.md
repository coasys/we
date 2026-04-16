# AI Tool Architecture Plan

## Overview

Replace the JSON blob response format with Claude's `tool_use` for schema mutations only. Keep the full system prompt but add **prompt caching** for ~90% cost reduction. This gives us streaming text, structured validated mutations, native error recovery, and minimal implementation complexity.

---

## Current State

| Problem | Detail |
|---------|--------|
| **JSON blob response** | AI returns `{ response, updatedNodes }` — can't stream any of it |
| **No streaming** | User sees blank bubble for 5-15s while full response assembles |
| **No error recovery** | If a patch fails, the user sees an error; Claude can't self-correct |
| **Fragile parsing** | Code fence stripping, prose-mixed-into-JSON, partial JSON edge cases |
| **High cost** | ~25K input tokens at full price every request |

---

## Proposed Architecture

```
Current:
  System prompt: 80KB (full price every request)
  User: { request: "...", currentSchema: {...} }
  AI:   { response: "...", updatedNodes: [...] }    ← can't stream any of it

Proposed:
  System prompt: 80KB cached (90% discount after first request)
  Tools: update_schema only
  AI:   "I'll add a header..."                      ← streamed to UI in real-time
        + tool_use: update_schema({ patches: [...] })← validated before applying
```

### Why Not Context Retrieval Tools?

The original plan proposed splitting context into tool-sized chunks (get_design_tokens, get_available_components, etc.) to reduce prompt size. Analysis showed this is counterproductive:

- **Prompt caching** reduces the 25K-token prompt to ~2.5K effective cost — cheaper than tool round-trips
- **Tool results aren't cached** — each retrieval is fresh input tokens at full price
- **Each retrieval = extra API round-trip** adding 1-3s latency per tool call
- **Claude decides what to fetch** — if it doesn't call a tool, it works with incomplete context
- **25K tokens is well within Claude's effective window** — accuracy isn't diluted at this size

Cached full prompt: cheapest, fastest, most accurate. Tools only for mutations.

---

## Tool Definition

One tool. Schema mutations with validation and error recovery:

```ts
const updateSchemaTool = {
  name: 'update_schema',
  description: 'Apply node patches to the current template schema. Each patch replaces the node at the given path. Use path [] to replace the entire schema.',
  input_schema: {
    type: 'object',
    properties: {
      patches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Path to the node to replace. [] = root, [0] = first child of root, [2, 0] = first child of third child of root.',
            },
            node: {
              type: 'object',
              description: 'The SchemaNode to insert at this path.',
            },
          },
          required: ['path', 'node'],
        },
      },
    },
    required: ['patches'],
  },
};
```

---

## Request Flow

### Happy Path (single round-trip)

```
Request:
  system: [full ai-context, cache_control: ephemeral]
  tools:  [update_schema]
  messages: [...history, { role: 'user', content: JSON.stringify({ request, currentSchema }) }]

Response (streamed):
  [text]:     "I'll add a header with primary-500 background..."   ← streams to chat
  [tool_use]: update_schema({ patches: [{ path: [0], node: {...} }] })
              → validate patches → PASS → apply to store → persist
              → send tool_result: { content: "Template updated successfully" }

Continuation (streamed):
  [text]:     "Done! The header is now..."     ← optional closing text
  [stop_reason: end_turn]
```

### Error Recovery (2-3 round-trips, only on validation failure)

```
Response (streamed):
  [text]:     "I'll restructure the layout..."
  [tool_use]: update_schema({ patches: [{ path: [0, 5], node: {...} }] })
              → validate → FAIL: "path [0, 5] does not exist (root has 3 children)"
              → send tool_result: { is_error: true, content: "path [0, 5] does not exist..." }

Continuation (streamed):
  [text]:     "Let me fix that..."
  [tool_use]: update_schema({ patches: [{ path: [0, 2], node: {...} }] })
              → validate → PASS → apply to store → persist
              → send tool_result: { content: "Template updated successfully" }

Continuation:
  [text]:     "Done! I've corrected the path..."
  [stop_reason: end_turn]
```

Key: validation runs **before** applying to the store. Failed patches never touch state. Claude gets the error as a `tool_result` (first-class API concept) and self-corrects — no fake user messages in the history.

---

## Prompt Caching

Add `cache_control` to the system prompt to enable Anthropic's prompt caching:

```ts
body: {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 16384,
  stream: true,
  tools: [updateSchemaTool],
  system: [
    {
      type: 'text',
      text: chatSystemPrompt,           // full ~80KB ai-context
      cache_control: { type: 'ephemeral' },
    },
  ],
  messages: claudeMessages,
}
```

Cached tokens are billed at **10% of input price**. After the first request in a session, the 25K-token system prompt costs ~2.5K equivalent tokens. Cache TTL is 5 minutes, refreshed on each request.

---

## System Prompt Changes

The existing `chatSystemPreamble` needs minor updates:

1. **Remove JSON blob format instructions** — Claude no longer returns `{ response, updatedNodes }`
2. **Add tool usage instructions** — "Use update_schema to apply changes. Respond with plain text to explain what you're doing."
3. **Keep all ai-context** — components, tokens, stores, operators, rules, examples stay in the prompt
4. **Keep currentSchema in user messages** — no change to how the schema is provided

The prompt structure becomes:

```
[existing ai-context: components, tokens, stores, operators, rules, examples]

Response format:
- Respond with plain text explaining what you're doing and why
- Use the update_schema tool to apply schema changes
- Each patch replaces the node at the given path
- Use path [] to replace the entire schema
- Prefer targeted patches over full replacement
- If you have no schema changes, just respond with text
```

---

## SSE Event Handling

The current SSE handler accumulates text deltas. It needs to also handle `tool_use` content blocks:

```ts
// State tracking
let currentBlockType: 'text' | 'tool_use' | null = null;
let currentToolId = '';
let toolInputBuffer = '';
let textContent = '';
let toolCalls: Array<{ id: string; name: string; input: object }> = [];

// Event routing:
// content_block_start (type: 'text')     → set currentBlockType = 'text'
// content_block_start (type: 'tool_use') → set currentBlockType = 'tool_use', capture id + name
// content_block_delta (type: 'text_delta')       → append to textContent, stream to UI
// content_block_delta (type: 'input_json_delta') → append to toolInputBuffer
// content_block_stop                              → if tool_use, parse toolInputBuffer as JSON
// message_delta (stop_reason: 'tool_use')        → execute tool, send continuation
// message_delta (stop_reason: 'end_turn')        → done
```

### Continuation Loop

When Claude's response ends with `stop_reason: 'tool_use'`, execute the tool and continue:

```ts
// After stream completes with stop_reason: 'tool_use':
// 1. Validate patches against current schema
// 2. If valid: apply to store, persist, tool_result = success message
// 3. If invalid: tool_result = { is_error: true, content: error details }
// 4. Append assistant message + tool_result to conversation history
// 5. Send continuation request (same system prompt, extended messages)
// 6. Stream continuation response (may have more text, another tool_use, or end_turn)
```

The loop only triggers when validation fails — happy path is one request/response.

---

## Patch Validation

Validate patches **before** applying to the store:

```ts
function validatePatches(
  patches: Array<{ path: number[]; node: unknown }>,
  currentSchema: SchemaNode,
): { valid: true } | { valid: false; error: string } {
  for (const { path, node } of patches) {
    // 1. Verify path exists in current schema
    let target: SchemaNode = currentSchema;
    for (let i = 0; i < path.length; i++) {
      const children = target.children;
      if (!children || path[i] >= children.length || path[i] < 0) {
        return {
          valid: false,
          error: `Path [${path.join(', ')}] invalid: index ${path[i]} out of bounds at depth ${i} (node has ${children?.length ?? 0} children)`,
        };
      }
      target = children[path[i]];
    }

    // 2. Verify node has required 'type' field
    if (!node || typeof node !== 'object' || !('type' in node)) {
      return { valid: false, error: `Patch at [${path.join(', ')}]: node must have a 'type' field` };
    }
  }
  return { valid: true };
}
```

---

## Performance Impact

| Metric | Current | Proposed |
|--------|---------|----------|
| System prompt cost | ~25K tokens at full price | ~25K tokens at **10% price** (cached) |
| Time to first visible token | 5-15s (after full JSON parse) | <1s (text streams immediately) |
| Mutation reliability | Fragile JSON parsing | API-enforced valid JSON |
| Error recovery | None (show error to user) | Claude self-corrects via tool_result |
| Implementation complexity | — | Low (2 files changed) |

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/app-framework/src/shared/prompts/chatSystemPrompt.ts` | Remove JSON blob format instructions, add tool usage guidelines |
| `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx` | Add tool definition to request body, add `cache_control` to system prompt, update SSE handler for tool_use blocks, add continuation loop, add patch validation, update `processAiResponse` → tool-based flow |

No changes to `@we/ai-context` — the full context stays as-is in the system prompt.

---

## Future Enhancements (not in this PR)

### Model Switching + Thinking Budget

| Mode | Model | Thinking | Use case |
|------|-------|----------|----------|
| Quick | Claude Haiku | Off | Simple styling, text changes |
| Standard | Claude Sonnet | budget: 4096 | Component additions, layout changes |
| Thorough | Claude Sonnet | budget: 16384 | Complex multi-component restructuring |

### Extended Thinking

Layers on cleanly — add `thinking: { type: 'enabled', budget_tokens: N }` to request body. Stream thinking content to a collapsible UI section.
