# AI Tool Architecture Plan

## Overview

Replace the monolithic JSON blob response format and 80KB system prompt with Claude's `tool_use` feature. Define tools for both **on-demand context retrieval** and **schema mutation**. This cleanly separates conversational text (streamable) from structured operations (tool calls), dramatically improving performance, cost, and UX.

Prerequisite: requires an audit of the `@we/ai-context` package to determine how best to split the monolithic context into tool-sized chunks.

---

## Current State

| Problem | Detail |
|---------|--------|
| **80KB system prompt** | Full `@we/ai-context` sent on every request — components, tokens, stores, examples, everything |
| **JSON blob response** | AI returns `{ response, updatedNodes }` — can't stream any of it |
| **No streaming** | User sees blank bubble for 5-15s while full response assembles |
| **High cost** | ~25K+ input tokens per request, most unused |
| **Diluted accuracy** | AI processes 80KB of context even for simple "change this color" requests |

---

## Proposed Architecture

```
Current:
  System prompt: 80KB everything
  User: { request: "...", currentSchema: {...} }
  AI:   { response: "...", updatedNodes: [...] }    ← can't stream any of it

Proposed:
  System prompt: ~5KB lean (role, rules, tool usage guidelines)
  Tools available: context retrieval + schema mutation
  AI:   "I'll add a header..."                      ← streamed to UI in real-time
        + tool_use: get_design_tokens()              ← fetches only what's needed
        + tool_use: update_schema({ patches: [...] })← structured schema changes
```

---

## Tool Definitions

### Context Retrieval Tools

Claude calls these to pull focused context on-demand:

| Tool | Returns | Use case |
|------|---------|----------|
| `get_available_components` | Component registry with props, descriptions | When building new UI or choosing components |
| `get_design_tokens` | Color, spacing, typography, sizing tokens | When styling or theming |
| `get_store_actions(storeName?)` | Store state + actions for a specific store (or all) | When wiring interactivity |
| `get_schema_tokens` | `$store`, `$action`, `$if`, `$each`, `$eq` syntax docs | When adding dynamic/conditional behavior |
| `get_current_schema` | Current template schema JSON | When Claude needs to see what exists |
| `get_component_examples(componentName)` | Usage examples for a specific component | When Claude needs patterns |

### Schema Mutation Tools

| Tool | Input | Effect |
|------|-------|--------|
| `update_schema` | `{ patches: [{ path: number[], node: SchemaNode }] }` | Apply node patches via `patchByPath()` |
| `replace_schema` | `{ schema: SchemaNode }` | Full schema replacement (for major restructuring) |

---

## Streaming Flow

With tool_use, Claude naturally produces content in this order:

```
1. [thinking]     → streamed to collapsible "Thinking..." section (if extended thinking enabled)
2. [text]         → streamed to chat bubble in real-time (conversational response)
3. [tool_use]     → get_design_tokens() → tool result returned
4. [tool_use]     → update_schema({...}) → schema applied, success/error shown
```

The text block streams token-by-token to the UI — no waiting. Tool calls are processed when they arrive. This completely eliminates the blank bubble problem.

### Incremental Schema Building

A major benefit of tool_use: Claude can emit multiple `update_schema` calls in a single response, each applied as it arrives via the SSE stream. For complex designs, the user watches the template build up live:

```
AI text: "I'll build this out section by section..."     ← streams immediately

tool_use: update_schema({ replace root with Column })         ← applied → UI updates
tool_use: update_schema({ add header at path [0] })           ← applied → UI updates
tool_use: update_schema({ add sidebar at path [1] })          ← applied → UI updates
tool_use: update_schema({ add content grid at path [2] })     ← applied → UI updates
tool_use: update_schema({ add footer at path [3] })           ← applied → UI updates
```

Each tool call is a complete, parseable unit — no partial JSON fragility. This is impossible with the current JSON blob approach (all-or-nothing).

**Considerations:**
- **Path ordering**: each patch references paths as they exist *after* prior patches. System prompt guidance: "Apply changes sequentially, referencing the schema state after each prior change."
- **Granularity**: AI should chunk by logical section (header, nav, content, footer) rather than individual nodes. Too many tiny calls = overhead; too few = loses the live feel.
- **Error handling**: if patch N fails, earlier patches are already applied. Options: snapshot before starting (rollback on error), or let the AI self-correct via tool_result error message.
- **Works with existing `patchByPath`**: no new schema infrastructure needed — each patch is exactly what we already support.

---

## System Prompt (Lean)

The system prompt shrinks from ~80KB to ~5KB:

```
You are an AI assistant that helps users build UIs using the WE schema system.
You have tools to retrieve component docs, design tokens, and store actions.
You have tools to update the schema.

Guidelines:
- Use get_available_components before suggesting unfamiliar components
- Use get_design_tokens when the user asks about colors, spacing, etc.
- Use get_current_schema to understand the current layout before making changes
- Use update_schema with targeted patches (prefer over replace_schema)
- Respond conversationally — explain what you're doing and why

[few-shot examples of tool usage patterns]
```

---

## SSE Event Handling

```ts
// Track which content block we're in
let currentBlockType: 'thinking' | 'text' | 'tool_use' | null = null;
let currentToolName = '';
let toolInputBuffer = '';

// content_block_start → identifies block type
// content_block_delta → routes to thinking, text, or tool input accumulation
// content_block_stop → if tool_use, parse input and execute tool

// For tool calls:
// 1. Execute the tool (e.g., return component registry JSON)
// 2. Send tool_result back to Claude (for multi-turn tool use)
// 3. For update_schema: apply patches, show success/error messageType in chat
```

---

## Tool Execution (Client-Side)

Tools execute locally in the browser — no server needed:

```ts
const toolHandlers = {
  get_available_components: () => componentRegistry,       // from @we/ai-context
  get_design_tokens: () => designTokens,                   // from @we/ai-context
  get_store_actions: (input) => storeActions[input.storeName],
  get_schema_tokens: () => schemaTokenDocs,
  get_current_schema: () => deepClone(templateStore.currentTemplate),
  get_component_examples: (input) => examples[input.componentName],
  update_schema: (input) => applyPatches(input.patches),   // returns success/error
  replace_schema: (input) => replaceFullSchema(input.schema),
};
```

---

## Extended Thinking

Extended thinking layers on cleanly as an optional enhancement:

```ts
body: {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 16384,
  stream: true,
  thinking: { type: 'enabled', budget_tokens: 4096 },  // optional
  tools: toolDefinitions,
  system: leanSystemPrompt,
  messages: claudeMessages,
}
```

---

## Performance Impact

| Metric | Current (JSON blob) | Proposed (tools) |
|--------|---------------------|------------------|
| System prompt | ~80KB every request | ~5KB every request |
| Input tokens per request | ~25K+ | ~5K base + tools as needed |
| Time to first visible token | 5-15s (after full parse) | <1s (text streams immediately) |
| Context accuracy | Diluted (80KB of everything) | Focused (only relevant tools called) |
| Cost per request | High | ~50-70% reduction |

---

## Migration Path

The current `processAiResponse()` / `buildClaudeMessages()` approach is replaced:

1. **System prompt**: swap monolithic context for lean prompt + tool definitions
2. **User messages**: remove `currentSchema` embedding (Claude calls `get_current_schema` tool)
3. **Response handling**: replace JSON parsing with SSE tool_use event handling
4. **Schema application**: `update_schema` tool handler replaces `processAiResponse()`
5. **Chat history**: tool calls and results are included in conversation history (Claude API handles this natively)

---

## `@we/ai-context` Package Changes

**TODO: Audit required** — review the current ai-context package structure to determine the best splits.

Split the monolithic export into tool-sized chunks:

```ts
// Current: single massive string
export const schemaContext: string = '...80KB...';

// Proposed: structured exports for tool handlers
export const componentRegistry: object = { ... };
export const designTokens: object = { ... };
export const storeActions: Record<string, object> = { ... };
export const schemaTokenDocs: object = { ... };
export const componentExamples: Record<string, object> = { ... };
export const leanSystemPrompt: string = '...5KB...';
export const toolDefinitions: Tool[] = [ ... ];
```

### Audit Questions
- How is the 80KB context currently structured? Sections, templates, generated code?
- Which sections map cleanly to individual tools?
- Are there cross-cutting concerns that need to stay in the system prompt?
- Can examples be split per-component or are they interleaved?
- What's the right granularity for `get_store_actions` — per-store or all-at-once?

---

## Files to Create/Modify

### Modified Files
- `packages/ai-context/` — split monolithic export into structured tool-sized chunks
- `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx` — tool_use SSE handling, tool handlers, lean system prompt
- `packages/app-framework/src/shared/prompts/` — new lean system prompt, tool definitions
- `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/` — thinking display (collapsible)

---

## Feature: Model Switching + Thinking Budget

Expose a model selector in the ChatPanel header or settings. Different models suit different tasks:

| Mode | Model | Thinking | Use case |
|------|-------|----------|----------|
| Quick | Claude Haiku | Off | Simple styling, text changes, small tweaks |
| Standard | Claude Sonnet | budget: 4096 | Component additions, layout changes |
| Thorough | Claude Sonnet | budget: 16384 | Complex multi-component restructuring |

### Thinking Budget Impact

| Budget | Added latency | Cost impact |
|--------|---------------|-------------|
| Off | 0 | Cheapest |
| 1024 | ~0.5-1s | Low |
| 4096 | ~1-3s | Medium |
| 16384 | ~3-8s | High |

Thinking tokens are billed as output tokens. Budget is a cap — Claude may use less.

### UX
- Dropdown or segmented control in ChatPanel header: Quick / Standard / Thorough
- Persisted to AgentSettings (new `aiMode` property)
- Could auto-detect: if user's prompt is short/simple, default to Quick; if complex, suggest Thorough

---

## Open Questions

- Should tool results be cached within a session? (e.g., `get_available_components` returns the same thing every time)
- How to handle multi-turn tool use? (Claude calls tool, gets result, calls another tool, then responds)
- Should `update_schema` validate patches before applying? (Return validation errors as tool_result so Claude can self-correct)
- Auto-detect mode vs manual selection — or both with auto as default?
