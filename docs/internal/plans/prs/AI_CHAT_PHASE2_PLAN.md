# AI Chat — Phase 2 Plan

## Overview

Improvements to the AI chat system building on the Phase 1 chat panel + template management work. Focuses on: persisting chat history, per-template chat sessions, schema JSON viewer/editor, and streaming AI thinking to the UI.

---

## Current State

| Asset | Status |
|-------|--------|
| **AiStore** | Claude SSE streaming works, messages stored in SolidJS signal (lost on reload) |
| **ChatPanel widget** | Full chat UI with message list, input, template header, fork/fresh picker |
| **Template model** | AD4M-persisted with `@Flag`, `@HasMany` installed relation on AgentSettings |
| **Streaming** | SSE tokens accumulated but NOT streamed to UI — user sees blank bubble until response completes |
| **Chat scope** | Single global conversation — switching templates doesn't change chat context |
| **Schema visibility** | No way to view or manually edit the schema JSON |

---

## Feature 1: Per-Template Chat Sessions

### Problem
All templates share one chat history. Switching templates leaves irrelevant messages. No way to review what was discussed for a given template.

### Approach: `ChatMessage` + `ChatSession` AD4M Models

Two new models: `ChatMessage` for individual messages, `ChatSession` as a container linked to Template via `@HasMany`. This keeps messages as first-class graph entities, enables per-message styling by type, and allows multiple sessions per template (conversation history).

```ts
@Model({ name: 'ChatMessage' })
class ChatMessage extends WeNode {
  @Flag({ through: 'we://type', value: 'we://chat_message' })
  type: string = '';

  @Property({ through: 'we://role' })
  role: string = '';  // 'user' | 'assistant'

  @Property({ through: 'we://message_type' })
  messageType: string = 'text';  // 'text' | 'success' | 'error' | 'info'

  @Property({ through: 'we://content' })
  content: string = '';

  @Property({ through: 'we://thinking' })
  thinking: string = '';  // AI reasoning (collapsible, populated by extended thinking)

  // createdAt is provided automatically by AD4M (retuned for all models)
  // Messages are ordered by createdAt — no separate order/timestamp field needed
}
```

```ts
@Model({ name: 'ChatSession' })
class ChatSession extends WeNode {
  @Flag({ through: 'we://type', value: 'we://chat_session' })
  type: string = '';

  @Property({ through: 'we://name' })
  name: string = '';  // e.g. "Session 1", auto-generated or user-named

  @Property({ through: 'we://updated_at' })
  updatedAt: string = '';

  @HasMany(() => ChatMessage, { through: 'we://chat_message' })
  messages: ChatMessage[] = [];
}
```

No `templateId` on ChatSession — the ownership link lives on Template via `@HasMany`:

```ts
// Template model
@HasMany(() => ChatSession, { through: 'we://chat_session' })
chatSessions: ChatSession[] = [];
```

This gives us:
- Natural graph ownership (Template → ChatSession → ChatMessage)
- Multiple sessions per template (conversation history / "New Chat")
- No redundant FK to maintain

### Message Types

The `messageType` field controls visual styling in the ChatPanel:

| messageType | Use case | Styling |
|-------------|----------|--------|
| `text` | Normal user/assistant messages | Default bubble |
| `success` | Template updated, fork completed | Green accent, check icon |
| `error` | API failure, parse error, patch failure | Red accent, warning icon |
| `info` | System notices (read-only warning, fork prompt) | Neutral accent, info icon |

This replaces the current `role: 'system'` catch-all. System-level messages now use `role: 'assistant'` with an appropriate `messageType`, giving the ChatPanel enough info to render distinct visual treatments.

Performance note: if conversations grow large, paginate by loading the last N messages on session open and fetching older ones on scroll. Not needed initially.

### AiStore Changes

- **Subscription-driven messages**: subscribe to ChatMessage query for the active session. New messages (user or assistant) appear in real-time via the subscription — no manual re-fetching.
- **Immediate persistence**: when user sends a message, create the `ChatMessage` model instance immediately (not after response). The subscription picks it up and adds it to the signal.
- **On template switch** (`createEffect` watching `currentTemplate.id`): unsubscribe from current session's message query, load the new template's active ChatSession (most recent by `createdAt`), subscribe to its messages.
- **On app boot**: load the current template's active ChatSession, subscribe to its messages.
- **`clearHistory()`**: delete all ChatMessage instances in the session (or delete the session and create a fresh one).
- **"New Chat" action**: create a new ChatSession linked to the template, subscribe to its messages.

### Migration
- Core templates (read-only) won't have persisted sessions — their in-memory conversations are ephemeral
- Only custom templates get persisted sessions by default
- The `role: 'system'` messages become `role: 'assistant', messageType: 'info' | 'success' | 'error'`

---

## Feature 2: Chat Persistence Across Reloads

### Problem
Messages are stored in a SolidJS signal (`createSignal<ChatMessage[]>([])`). All history is lost on app reload.

### Approach
This is effectively solved by Feature 1 — once ChatSessions are AD4M-persisted, messages survive reloads automatically.

### Boot Flow
1. `loadSavedTemplates()` runs (existing)
2. After templates load, load the current template's ChatSessions via `@HasMany` with `.include()`
3. Pick the most recent ChatSession (by `updatedAt`), load its messages
4. If no ChatSession exists, start with empty messages (create session lazily on first send)

### Save Strategy
- **On user send** — Create `ChatMessage` instance immediately, link to session. Subscription delivers it to UI.
- **On AI response complete** — Create `ChatMessage` instance with `content`, `thinking`, `messageType`. Subscription delivers it.
- **During streaming** — Thinking text is shown in a transient UI-only bubble (not persisted until complete).
- **On `clearHistory()`** — Delete ChatMessage instances in the active session.
- All messages are persisted as individual AD4M model instances, shown in real-time via subscription.

---

## Feature 3: Schema JSON Viewer/Editor

### Problem
No way to see the actual schema JSON being generated, review AI changes, or make manual edits.

### Approach: Toggle Panel Mode

Add a "Code" / "Chat" toggle to the ChatPanel header. When in Code mode, the message list is replaced with a JSON editor showing the current template schema.

### UI Design
```
┌─ AI Template Editor ─────────────┐
│ [Template Name]  [Chat] [Code]   │
│ ─────────────────────────────────│
│  (Chat mode: message list)       │
│  (Code mode: JSON editor)        │
│                                  │
│ ─────────────────────────────────│
│ [input bar / save button]        │
└──────────────────────────────────┘
```

### Implementation Options

**Option A — Simple textarea with JSON formatting:**
- `JSON.stringify(currentTemplate, null, 2)` in a `<textarea>`
- Parse on blur/save, validate, apply via `updateTemplate()`
- Pro: minimal code. Con: no syntax highlighting, poor DX for large schemas.

**Option B — Read-only viewer + Edit button:**
- Show formatted JSON with `<pre>` and syntax highlighting (Prism.js or similar)
- "Edit" button opens a modal with textarea
- Pro: safer (no accidental edits), clean default view

**Option C — Inline code editor component:**
- Lightweight JSON editor (e.g., `@monaco-editor/react` or a Lit-based code editor)
- Pro: Real IDE-like experience. Con: Heavy dependency, may conflict with Lit/SolidJS rendering.

**Recommendation:** Start with **Option B** (read-only viewer with edit modal). It's the safest UX — users can review the JSON without accidentally breaking things. The edit modal can validate JSON before applying. Upgrade to a proper editor later if there's demand.

### Schema Context Integration
- The viewer should show the **full template schema** (not just the current route's node)
- "Copy JSON" button for easy export
- When AI makes changes, the Code view updates live
- Validation errors shown inline if manual edits produce invalid schema

### ChatPanel Widget Changes
- New prop: `mode: 'chat' | 'code'`
- New prop: `schemaJson: string` (the formatted JSON to display)
- New prop: `onSchemaEdit: (json: string) => void` (callback when user saves manual edits)
- Toggle buttons in the header

---

## Feature 4: Stream AI Response Text to UI

### Problem
Currently, SSE tokens are accumulated silently until the full response arrives. The user sees a blank loading bubble for several seconds with no feedback.

### Current Flow
```
User sends message → blank "streaming" bubble → [5-15 seconds] → full response appears
```

### Approach (Interim)

As an interim improvement before the full tool-based architecture (see [AI_TOOL_ARCHITECTURE_PLAN.md](AI_TOOL_ARCHITECTURE_PLAN.md)), stream the raw response text into the chat bubble as it arrives. When the response is complete, parse the JSON and apply schema changes.

- While streaming: show accumulated tokens in the bubble (will be JSON, but gives immediate feedback)
- When complete: replace raw content with parsed `response` text, apply schema
- The `thinking` field on ChatMessage is populated if extended thinking is enabled

This is a stopgap. The tool-based architecture (separate PR) eliminates the JSON blob entirely, making streaming natural.

### ChatPanel UI
- While streaming: show expanding text content in the bubble
- When complete: show `response` text, apply schema changes
- If extended thinking is enabled: show thinking in a collapsible section

---

## Feature 5: Loading States for Template Operations

### Problem
Creating/forking a template involves AD4M model creation + persistence, which takes a few seconds. During this time there's no visual feedback — the UI freezes with no indication anything is happening. The template eventually appears in the sidebar and the chat session switches, but the delay feels broken.

### Approach

Add loading states to template operations that provide immediate visual feedback:

| Operation | Loading indicator | Resolves when |
|-----------|------------------|---------------|
| Fork template | Picker button shows spinner, sidebar shows placeholder entry | Template saved + switched + chat session loaded |
| Start fresh | Picker button shows spinner, sidebar shows placeholder entry | Template saved + switched + chat session loaded |
| Delete template | Delete button shows spinner / row dims | Template removed from AD4M + UI updated |
| Install/uninstall | Switch shows loading state | HasMany relation updated |
| Save (persist) | Toast or subtle indicator | AD4M write complete |

### Implementation

**TemplateStore changes:**
- New signal: `operationLoading: Accessor<string | null>` — the ID of the operation in progress (e.g., `'fork'`, `'delete:template-id'`, `null` when idle)
- Wrap `saveTemplateAs`, `deleteTemplate`, `installTemplate`, `uninstallTemplate` with loading state management
- Expose as part of the store interface

**ChatPanel / Picker changes:**
- Picker confirm button: disable + show spinner while `operationLoading()` is truthy
- Pass loading state through schema props

**Sidebar changes:**
- Optimistic placeholder entry while template is being created (name + icon from picker, dimmed/skeleton style)
- Remove placeholder once real template appears via subscription/signal update

**Settings schema:**
- Delete button: disabled + spinner when `operationLoading` matches the template ID
- Install switch: disabled during toggle

---


| # | Feature | Dependencies | Scope |
|---|---------|-------------|-------|
| 1 | ChatSession + ChatMessage models + per-template sessions | models package, AiStore | Medium |
| 2 | Chat persistence (boot restore + subscription) | Feature 1 | Small (part of F1) |
| 3 | Schema JSON viewer | ChatPanel widget | Medium |
| 4 | Stream response text to UI | AiStore SSE handler | Small |

Features 3 and 4 are independent of each other and of 1+2. Could be parallelized.

**Suggested order:** 1+2 → 3 → 4 (or 3 and 4 in parallel)

### Future: Tool-Based Architecture

See [AI_TOOL_ARCHITECTURE_PLAN.md](AI_TOOL_ARCHITECTURE_PLAN.md) — a larger refactor that replaces the JSON blob response format with Claude tool_use, splits the 80KB monolithic ai-context into on-demand tools, and makes streaming natural. Requires an audit of the `@we/ai-context` package to determine the best way to split it into tool-sized chunks.

---

## Decisions

- **Core template chat sessions**: Yes — core templates get chat sessions too. Users often chat about a core template before forking, and that context should be preserved.
- **Session history UX**: Sidebar list (like Copilot in VS Code). Shows all sessions for the current template, with option to delete old sessions and start new ones.
- **JSON editor validation**: Validate on save (not live). When user clicks save, parse + validate. Show errors inline if invalid, don't apply until valid.

---

## Files to Create/Modify

### New Files
- `packages/models/src/entities/ChatMessage.ts` — AD4M model for individual messages
- `packages/models/src/entities/ChatSession.ts` — AD4M model (container with @HasMany ChatMessage)

### Modified Files
- `packages/models/src/entities/index.ts` — export ChatMessage, ChatSession
- `packages/models/src/entities/Template.ts` — add `@HasMany` ChatSession
- `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx` — per-template session loading/saving, subscription, streaming text, messageType usage
- `packages/app-framework/src/frameworks/solid/stores/TemplateStore.tsx` — operationLoading signal, loading state management around async operations
- `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/` — code view toggle, messageType styling (success/error/info), loading states on picker
- `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.types.ts` — add messageType, thinking fields
- `packages/app-framework/src/shared/schemas/shell/AiChatSidebar.schema.ts` — pass new props
