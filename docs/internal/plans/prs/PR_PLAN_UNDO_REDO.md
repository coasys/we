# PR Plan: Undo/Redo for AI Schema Edits

## Summary

Add undo/redo controls to the AI chat panel so users can step backward and forward through schema changes made by the AI (or via the code editor). Each successful schema edit creates a snapshot; the user can undo/redo via toolbar buttons or keyboard shortcuts.

---

## Motivation

Currently, when the AI applies schema patches (or the user edits JSON directly in code mode), there is no way to revert a change without manually re-editing. This is especially problematic during exploratory conversations where the AI may apply several rounds of edits and the user wants to backtrack.

---

## Design

### Approach: Schema Snapshot Stack

Maintain an in-memory history stack of `TemplateSchema` snapshots inside `AiStore`. Every successful schema mutation (AI patch or code-mode edit) pushes the **pre-edit** schema onto the undo stack and clears the redo stack. Undo pops from the undo stack, pushes current state onto redo, and applies the popped snapshot. Redo does the inverse.

```
undoStack: TemplateSchema[]   (most recent at end)
redoStack: TemplateSchema[]   (most recent at end)
```

**Why snapshots over mutation inversion?**

- Simpler and more reliable — no need to compute inverse patches
- `deepClone` is already used in the patch pipeline (line 817 of AiStore.tsx)
- Schema objects are small (typically < 50 KB JSON), so memory is not a concern
- Avoids edge cases where inverse patch computation could diverge

**Stack size limit:** Cap at ~50 entries to keep memory bounded. Drop the oldest entry when the cap is reached.

### Scope

- **In scope:** AI-applied patches (`update_schema` tool), code-mode edits (`onSchemaEdit`), pending-changes on read-only templates
- **Out of scope:** Manual drag-and-drop edits in the visual builder (separate concern), persistence of undo history across sessions

---

## Implementation Plan

### Phase 1: Undo/Redo State in AiStore

**File:** `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`

1. **Add signals:**

   ```ts
   const [undoStack, setUndoStack] = createSignal<TemplateSchema[]>([]);
   const [redoStack, setRedoStack] = createSignal<TemplateSchema[]>([]);
   ```

2. **Add derived accessors:**

   ```ts
   const canUndo: Accessor<boolean> = () => undoStack().length > 0;
   const canRedo: Accessor<boolean> = () => redoStack().length > 0;
   ```

3. **Add `pushSnapshot()` helper** (called before every schema mutation):

   ```ts
   const MAX_UNDO = 50;
   function pushSnapshot() {
     const current = deepClone(templateStore.currentTemplate) as TemplateSchema;
     setUndoStack((prev) => {
       const next = [...prev, current];
       return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
     });
     setRedoStack([]); // new edit invalidates redo history
   }
   ```

4. **Add `undo()` action:**

   ```ts
   async function undo() {
     const stack = undoStack();
     if (stack.length === 0) return;
     const snapshot = stack[stack.length - 1];
     setUndoStack((prev) => prev.slice(0, -1));
     // Push current state onto redo
     setRedoStack((prev) => [...prev, deepClone(templateStore.currentTemplate) as TemplateSchema]);
     // Apply snapshot
     if (isReadOnly()) {
       setPendingTemplate(snapshot);
     } else {
       templateStore.updateTemplate(snapshot);
       await templateStore.persistCurrentTemplate();
     }
   }
   ```

5. **Add `redo()` action** (mirror of undo):

   ```ts
   async function redo() {
     const stack = redoStack();
     if (stack.length === 0) return;
     const snapshot = stack[stack.length - 1];
     setRedoStack((prev) => prev.slice(0, -1));
     setUndoStack((prev) => [...prev, deepClone(templateStore.currentTemplate) as TemplateSchema]);
     if (isReadOnly()) {
       setPendingTemplate(snapshot);
     } else {
       templateStore.updateTemplate(snapshot);
       await templateStore.persistCurrentTemplate();
     }
   }
   ```

6. **Insert `pushSnapshot()` calls** at the three mutation sites:
   - **AI patch success** (~line 1033): before `templateStore.updateTemplate(mergedTemplate)`
   - **AI patch buffered** (~line 1029): before `setPendingTemplate(mergedTemplate)`
   - **Code-mode edit** (~line 1138): before `templateStore.updateTemplate(parsed)`

7. **Reset stacks on template switch** — add to the existing `createEffect` that watches `currentTemplate.id`:

   ```ts
   setUndoStack([]);
   setRedoStack([]);
   ```

8. **Export on the `AiStore` interface:**

   ```ts
   canUndo: Accessor<boolean>;
   canRedo: Accessor<boolean>;
   undo: () => Promise<void>;
   redo: () => Promise<void>;
   ```

   And wire them into the store object returned by the provider.

---

### Phase 2: ChatPanel UI Controls

**File:** `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.types.ts`

1. **Add props:**
   ```ts
   canUndo?: boolean;
   canRedo?: boolean;
   onUndo?: () => void;
   onRedo?: () => void;
   ```

**File:** `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.solid.tsx`

2. **Add undo/redo buttons** in the header row, next to the existing mode switcher / new-chat button. Use the existing `we-button` + `we-icon` pattern:

   ```tsx
   <Show when={props.onUndo}>
     <we-button
       variant="ghost"
       size="sm"
       disabled={!props.canUndo}
       onClick={() => props.onUndo?.()}
       title="Undo last edit"
     >
       <we-icon name="arrow-u-up-left" size="sm" />
     </we-button>
   </Show>
   <Show when={props.onRedo}>
     <we-button
       variant="ghost"
       size="sm"
       disabled={!props.canRedo}
       onClick={() => props.onRedo?.()}
       title="Redo last edit"
     >
       <we-icon name="arrow-u-up-right" size="sm" />
     </we-button>
   </Show>
   ```

   Place these between the template context header and the mode switcher, so they sit in the toolbar area and are always visible regardless of chat/code mode.

3. **Add keyboard shortcut handler** on the panel container:
   ```tsx
   onKeyDown={(e: KeyboardEvent) => {
     if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
       e.preventDefault();
       if (e.shiftKey) props.onRedo?.();
       else props.onUndo?.();
     }
   }}
   ```

---

### Phase 3: Schema Wiring

**File:** `packages/app-framework/src/shared/schemas/shell/AiChatSidebar.schema.ts`

1. **Add bindings** to connect the new store accessors/actions to the ChatPanel props:
   ```ts
   canUndo: { $store: 'aiStore.canUndo' },
   canRedo: { $store: 'aiStore.canRedo' },
   onUndo: { $action: 'aiStore.undo' },
   onRedo: { $action: 'aiStore.redo' },
   ```

---

### Phase 4: Chat Feedback Messages

When the user triggers undo/redo, append a system-style message to the chat so the conversation log reflects what happened:

- **Undo:** `"↶ Reverted to previous schema state."`
- **Redo:** `"↷ Re-applied schema change."`

These should be appended inside the `undo()` and `redo()` functions in AiStore using the existing `createMessage('assistant', ...)` pattern.

---

## File Change Summary

| File                                                                                | Changes                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/app-framework/src/frameworks/solid/stores/AiStore.tsx`                    | Add undo/redo signals, `pushSnapshot()`, `undo()`, `redo()`, export on interface + store object, insert snapshot calls at 3 mutation sites, reset on template switch |
| `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.types.ts`  | Add `canUndo`, `canRedo`, `onUndo`, `onRedo` props                                                                                                                   |
| `packages/design-system/5-widgets/src/widgets/panels/ChatPanel/ChatPanel.solid.tsx` | Add undo/redo buttons in header toolbar, add keyboard shortcut handler                                                                                               |
| `packages/app-framework/src/shared/schemas/shell/AiChatSidebar.schema.ts`           | Wire 4 new prop bindings                                                                                                                                             |

---

## Edge Cases & Considerations

1. **Read-only (core) templates:** Undo/redo operates on `pendingTemplate` instead of the live store. The snapshot captures the pending state. If the user undoes all pending changes, `pendingTemplate` is set back to `null`.

2. **Template switch:** Stacks are cleared when switching templates — undo history is per-template-session, not persisted.

3. **Streaming in progress:** Disable undo/redo buttons while `isStreaming` is true to avoid conflicts with an in-flight patch application.

4. **Code-mode edits:** Each "Save" from the JSON editor pushes a snapshot, same as AI edits. This means code-mode and chat-mode edits share the same undo stack.

5. **Multi-continuation AI turns:** A single `sendMessage` call can produce multiple `update_schema` tool uses across continuations. Each validated+applied patch set is one snapshot entry (not one per continuation). This is natural since the snapshot is captured once before the first patch application in a turn.

6. **Fork flow:** When the user forks a read-only template, pending changes are applied to the new template. The undo stack should carry over to the new template context (don't clear on fork).

---

## Testing Plan

1. **Manual testing:**
   - Send an AI message that modifies the schema → undo → verify schema reverts → redo → verify schema re-applies
   - Make multiple AI edits → undo twice → redo once → verify correct intermediate state
   - Switch templates → verify undo stack is empty
   - Test Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
   - Test on read-only template with pending changes
   - Test code-mode edit → undo

2. **Unit tests** (if test infrastructure exists for stores):
   - `pushSnapshot` correctly captures pre-edit state
   - `undo` restores previous state and pushes to redo stack
   - `redo` restores next state and pushes to undo stack
   - Stack cap at 50 entries drops oldest
   - Stacks cleared on template switch

---

## Estimated Scope

~4 files changed, ~120 lines added. No new dependencies. No model/persistence changes needed (undo history is ephemeral).
