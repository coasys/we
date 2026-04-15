# AI Chat Sidebar — Feature Plan

## Overview

Add a **right-side chat panel** to the shell that lets users edit the current template via natural language conversation with Claude. The panel provides a persistent chat interface (message history, streaming responses) and applies validated schema changes live.

---

## Current State (What Exists)

| Asset                  | Location                                                                     | Status                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **AiStore**            | `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`             | Functional but one-shot (no conversation history, no streaming, hardcoded to `gpt-4` via AD4M)      |
| **AiInterface**        | `packages/app-framework/src/frameworks/solid/components/AiInterface.tsx`     | Basic input bar + single response display — no chat history, no sidebar panel                       |
| **ai-context**         | `packages/ai-context/`                                                       | Auto-generated 80KB system prompt with full schema spec, component registry, stores, tokens, models |
| **schemaExamples**     | `packages/app-framework/src/shared/prompts/schemaExamples.ts`                | 11 few-shot examples (add/remove/restyle/conditionals)                                              |
| **CollapsibleSidebar** | `packages/design-system/5-widgets/`                                          | Supports `side: 'right'`, `position: 'fixed'` — but designed for nav items, not chat content        |
| **TemplateStore**      | `packages/app-framework/src/frameworks/solid/stores/TemplateStore.tsx`       | `updateTemplate()` for in-place mutation, `saveTemplate(name)` for persistence to we-root           |
| **Validation**         | `packages/schema-system/shared/`                                             | `validateStructure()` (Zod) + `validateSemantic()` (context-aware)                                  |
| **Shell sidebar**      | `packages/app-framework/src/shared/schemas/shell/Sidebar.schema.ts`          | Left-side nav sidebar schema fragment                                                               |
| **TemplateProvider**   | `packages/app-framework/src/frameworks/solid/providers/TemplateProvider.tsx` | Hardcoded `margin-left: 66px` layout for sidebar                                                    |

### Key Architectural Constraints

1. **AD4M AI routing** — The current AiStore routes prompts through `Ad4mClient.ai.prompt()` which delegates to AD4M's backend. This uses whatever model AD4M has configured (default: gpt-4). There's no direct Claude API call from the app.
2. **No streaming** — `client.ai.prompt()` is request/response, not streaming.
3. **Shell is schema-rendered** — The shell (boot screen + sidebar) is rendered via `RenderSchema` from a static schema definition. The main content area is a hardcoded `<div>` with `margin-left: 66px`.
4. **aiStore not in stores object** — The AiStore exists as a provider but is NOT currently wired into the `stores` object in TemplateProvider, so it can't be accessed via `$store` / `$action` in schemas.

---

## Architecture Decision: Claude API vs AD4M AI

Both routes will be available. Claude API is the primary path; AD4M AI is the fallback.

### Primary: Direct Claude API

- User provides their own Claude API key (stored in AgentSettings in we-root perspective)
- AiStore calls Claude API directly from the app (raw `fetch`, no SDK)
- Full control: streaming, conversation history, model selection
- No dependency on AD4M's AI routing or model availability

### Fallback: AD4M AI Routing

- Existing `Ad4mClient.ai.prompt()` path remains functional
- Used when no Claude API key is configured, or if user prefers AD4M's model
- One-shot (no streaming), but still applies schema changes the same way
- The current `handleSchemaPrompt()` method stays as-is

**Approach:** Extend the existing `AiStore` with chat/streaming capabilities rather than creating a separate store. The AiStore already owns the AI↔schema pipeline — adding conversation state and a Claude API path keeps everything in one place.

---

## Components to Build

### 1. `ChatPanel` Widget (New)

**Location:** `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/`

A general-purpose sliding chat panel. Not AI-specific — just message display + input.

**Props:**

```typescript
interface ChatPanelProps {
  // Panel state
  open: boolean;
  side?: 'left' | 'right'; // default: 'right'
  width?: string; // default: '400px'
  position?: 'fixed' | 'absolute';
  zIndex?: number;

  // Messages
  messages: ChatMessage[];
  loading?: boolean; // Shows typing indicator

  // Input
  placeholder?: string;
  onSend: (message: string) => void;
  disabled?: boolean;

  // Header
  title?: string;
  onClose?: () => void;

  // Slots (Solid)
  header?: JSX.Element;
  footer?: JSX.Element;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  status?: 'sending' | 'sent' | 'error';
  metadata?: Record<string, unknown>; // e.g. { appliedSchema: true }
}
```

**Visual design:**

- Fixed-position panel on the right
- Slides in/out with transition
- Message bubbles (user right-aligned, assistant left-aligned)
- Auto-scroll to latest message
- Input area at bottom with send button
- Header with title + close button
- Loading/typing indicator during AI response

### 2. `AiStore` Extensions (Existing → Extended)

**Location:** `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`

The existing AiStore already owns the AI→schema pipeline. Extend it with chat state, Claude API support, and panel control.

**Extended interface** (additions to existing `AiStore`):

```typescript
interface AiStore {
  // --- Existing ---
  models: Accessor<Model[]>;
  tasks: Accessor<AITask[]>;
  handleSchemaPrompt: (prompt: string) => Promise<string | undefined>; // AD4M fallback

  // --- New: Chat state ---
  messages: Accessor<ChatMessage[]>;
  isOpen: Accessor<boolean>;
  isStreaming: Accessor<boolean>;
  apiKeyConfigured: Accessor<boolean>;

  // --- New: Panel control ---
  toggle: () => void;
  open: () => void;
  close: () => void;

  // --- New: Chat actions ---
  sendMessage: (text: string) => Promise<void>; // Primary: Claude API
  clearHistory: () => void;

  // --- New: Settings ---
  setApiKey: (key: string) => Promise<void>;
}
```

**New responsibilities** (in addition to existing AD4M AI path):

- Stores conversation history (in-memory, per session)
- Primary path: calls Claude API directly (via fetch to `https://api.anthropic.com/v1/messages`)
- Fallback: if no API key, `sendMessage` delegates to existing `handleSchemaPrompt` (AD4M routing)
- Handles streaming responses (SSE parsing) for Claude path
- On AI response: extracts `updatedSchema`, validates, applies via `templateStore.updateTemplate()`
- Template forking logic: if on a core/built-in template, auto-fork to a saved template before mutating
- API key persistence: stored in AD4M AgentSettings in we-root perspective

### 3. `AiChatSidebar.schema.ts` (New Shell Fragment)

**Location:** `packages/app-framework/src/shared/schemas/shell/AiChatSidebar.schema.ts`

Schema fragment rendered alongside the left sidebar in the shell. Contains:

- Toggle button (floating, right edge) when panel is closed
- ChatPanel component when open
- API key prompt if no key configured

### 4. Component Registry Updates

- Register `ChatPanel` in `componentRegistry.tsx`
- Wire `aiStore` into the `stores` object in `TemplateProvider.tsx` (currently missing from stores)

### 5. Layout Adjustments

- `TemplateProvider.tsx`: Make main content width responsive to chat panel open state
  - Closed: `margin-left: 66px; width: calc(100% - 66px)` (current)
  - Open: `margin-left: 66px; width: calc(100% - 66px - 400px)` (shrink for panel)

---

## Template Forking Logic

When the user is editing a **core template** (default, launcher, etc.):

1. First AI edit → prompt: "You're editing a built-in template. Changes will be saved as a new template. Enter a name:"
2. `templateStore.saveTemplate(name)` — creates new template in we-root
3. `templateStore.switchTemplate(newId)` — switch to the fork
4. Subsequent edits mutate the fork in-place via `updateTemplate()`

When editing a **saved/user template**:

- Edits apply directly via `updateTemplate()`
- Periodically auto-save or save on explicit user action

---

## Claude API Integration

### System Prompt

Reuse the existing `schemaContext` from `@we/ai-context` (80KB auto-generated spec). Append a chat-specific preamble:

```
You are a UI template editor for the WE platform. The user will ask you to modify
their current template. You MUST respond with valid JSON:

{
  "response": "Brief explanation of what you changed",
  "updatedSchema": { ... full updated TemplateSchema ... }
}

If the request is unclear, ask for clarification (respond with just "response", no "updatedSchema").
If you cannot fulfill the request, explain why in "response".
```

### API Call Shape

```typescript
// Direct fetch to Claude API (no SDK needed, keeps bundle small)
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    stream: true,
    system: systemPrompt,
    messages: conversationHistory,
  }),
});
```

### Conversation History

Messages sent to Claude include the full conversation, but the `currentSchema` is only included with each user message (so the AI always sees the latest state):

```typescript
messages: [
  { role: 'user', content: JSON.stringify({ request: "Add a header", currentSchema: {...} }) },
  { role: 'assistant', content: '{ "response": "Added header", "updatedSchema": {...} }' },
  { role: 'user', content: JSON.stringify({ request: "Make it blue", currentSchema: {...} }) },
  // ...
]
```

### Validation Before Apply

```typescript
import { validateStructure, validateSemantic, buildValidationContext } from '@we/schema-shared';

const structural = validateStructure(updatedSchema);
if (!structural.valid) {
  // Show errors in chat, don't apply
  addMessage({ role: 'system', content: `Schema validation failed: ${errors}` });
  return;
}

// Semantic validation with full context
const context = buildValidationContext({ components, stores, models });
const semantic = validateSemantic(updatedSchema, context);
if (semantic.errors.some((e) => e.severity === 'error')) {
  // Show errors but still allow apply with warnings
  addMessage({ role: 'system', content: `Schema has issues: ${errors}` });
  return;
}

templateStore.updateTemplate(updatedSchema);
```

---

## API Key Storage

Store the Claude API key securely in the user's we-root perspective via a new property on `AgentSettings`:

```typescript
// In models or AgentSettings
@Property({ through: 'we://claude_api_key' })
claudeApiKey: string = '';
```

- Retrieved on app boot from we-root perspective
- Never sent to any server except Anthropic's API
- UI prompt in the chat panel if not configured
- Can also be set from the Settings shell page

---

## File Changes Summary

### New Files

| File                                                                                | Purpose                              |
| ----------------------------------------------------------------------------------- | ------------------------------------ |
| `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.types.ts`  | Props & message types                |
| `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.solid.tsx` | SolidJS chat panel component         |
| `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/index.ts`            | Exports                              |
| ~~`ChatStore.tsx`~~                                                                 | ~~Not needed — merged into AiStore~~ |
| `packages/app-framework/src/shared/schemas/shell/AiChatSidebar.schema.ts`           | Shell schema fragment                |
| `packages/app-framework/src/shared/prompts/chatSystemPrompt.ts`                     | Chat-specific system prompt wrapper  |

### Modified Files

| File                                                                           | Change                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `packages/design-system/5-widgets/src/index.ts`                                | Export ChatPanel                                                       |
| `packages/app-framework/src/frameworks/solid/registries/componentRegistry.tsx` | Register ChatPanel                                                     |
| `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`               | Add chat state, Claude API, panel control, streaming                   |
| `packages/app-framework/src/frameworks/solid/providers/TemplateProvider.tsx`   | Wire aiStore into stores object; make layout responsive to panel state |
| `packages/app-framework/src/shared/schemas/shell/index.ts`                     | Export aiChatSidebar                                                   |
| `packages/app-framework/src/shared/registries/launcherUIRegistry.ts`           | Add aiChatSidebar to shell children                                    |
| `packages/models/src/entities/AgentSettings.ts` (or equivalent)                | Add claudeApiKey property                                              |

---

## Implementation Phases

### Phase 1: ChatPanel Widget

- Build the ChatPanel component in design-system
- Types, rendering, message bubbles, input, scroll behavior
- Register in component registry
- Verify with a static test in SchemaTests

### Phase 2: AiStore Extensions + Claude Integration

- Extend AiStore with chat state (messages, isOpen, isStreaming)
- Add Claude API path (`sendMessage`) alongside existing AD4M path (`handleSchemaPrompt`)
- Implement direct Claude API calls (non-streaming first)
- API key storage in AgentSettings / we-root
- Reuse existing `schemaContext` for system prompt
- Response parsing + validation + apply to templateStore
- Wire aiStore into TemplateProvider stores object

### Phase 3: Shell Integration

- Create `AiChatSidebar.schema.ts` shell fragment
- Add to launcherUIRegistry shell
- Layout adjustments in TemplateProvider
- Toggle button in left sidebar footer (or floating FAB)

### Phase 4: Template Forking

- Detect when editing a core/built-in template
- Prompt user for template name
- Fork via saveTemplate + switchTemplate
- Subsequent edits go to the fork

### Phase 5: Streaming + Polish

- Implement SSE streaming from Claude API
- Token-by-token message display
- Error recovery (retry, rate limits)
- Conversation history management (clear, export)
- Auto-save edited templates

---

## Open Questions

1. **CORS**: Direct browser calls to `api.anthropic.com` require `anthropic-dangerous-direct-browser-access` header. This works but Anthropic warns against it for production (exposes API key in browser). Alternative: proxy through a lightweight endpoint or through AD4M's backend. For a personal dev tool, direct access may be acceptable.

2. **Electron vs Web**: In Electron, CORS isn't an issue. In web mode, the direct API call needs the dangerous header. Should we handle this differently per platform?

3. ~~**AD4M AI vs Direct API**~~: Resolved — both paths live in AiStore. Claude is primary; AD4M is fallback when no API key is set.

4. **System prompt size**: The ai-context is ~80KB. Claude handles this fine but it uses significant context window. Consider: should the chat mode use a trimmed version that excludes rarely-needed sections?

5. **Template size limits**: Large templates (weNativeApp.ts is 1500+ lines) may approach Claude's output limits. The section indexing system (`StoredTemplate.sections`) could help by sending only relevant sections for editing rather than the entire template.

6. **Undo/Redo**: Should the chat track template states for undo? Could store a stack of previous schemas and let the user revert individual AI edits.

7. **Toggle trigger**: Where should the chat panel open button live? Options:
   - (a) Footer item in the left sidebar (like settings/profile)
   - (b) Floating action button (bottom-right corner)
   - (c) Keyboard shortcut only
   - Recommendation: (a) sidebar footer item + (c) keyboard shortcut

---

## Dependencies

- Raw `fetch` — For Claude API calls (no SDK, keeps bundle small)
- `@we/ai-context` — Existing, provides system prompt
- `@we/schema-shared` — Existing, provides validation
- No new external dependencies required if using raw fetch
