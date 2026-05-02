# Plan: Perspective Ordering + `we-sortable` Primitive

> **Goal:** Let users drag-and-drop perspectives in the sidebar to reorder them, with order persisted across sessions. Deliver this through a general-purpose `we-sortable` primitive that the CollapsibleSidebar groups can use, and a schema-level `reorderable` prop that lets schemas wire ordering back to a store action.

---

## Context

`PerspectiveProxy` only exposes `uuid`, `name`, and `sharedUrl` — there is no `createdAt` or any date field. The load order from `allPerspectives` is non-deterministic (AD4M returns them in whatever order the SPARQL triple store yields). Sorting by creation time is not possible without an external tracking mechanism.

The correct solution is to store an explicit `perspectiveOrder: string[]` array in `AgentSettings` (persisted in `we-root`) and derive the sidebar order from that.

---

## Part 1 — Perspective Order Persistence

### Data model change

**File:** `packages/models/src/entities/AgentSettings.ts`

Add a nullable field:

```typescript
@SDNAProperty({ writable: true })
perspectiveOrder?: string[];
```

`AgentSettings` is the one model stored in `we-root` that holds per-user WE-level preferences. It's the correct location — not `SpaceSettings`, which is per-space.

---

### `AdamStore` changes

**File:** `packages/app-framework/src/frameworks/solid/stores/AdamStore.tsx`

#### 1. `orderedPerspectives` signal

Derived from `allPerspectives` + the saved order. This replaces direct `allPerspectives` use in the sidebar.

```typescript
const orderedPerspectives = createMemo(() => {
  const all = allPerspectives();
  const order = agentSettings()?.perspectiveOrder;
  if (!order || order.length === 0) return all;

  const byUuid = new Map(all.map((p) => [p.uuid, p]));
  const ordered = order.flatMap((uuid) => {
    const p = byUuid.get(uuid);
    return p ? [p] : [];
  });
  // Append any perspectives not yet in the saved order (e.g. created on another device)
  const inOrder = new Set(order);
  const appended = all.filter((p) => !inOrder.has(p.uuid));
  return [...ordered, ...appended];
});
```

#### 2. `reorderPerspectives(newOrder: string[])` action

Called when the user completes a drag. Saves the new order to `AgentSettings`.

```typescript
async function reorderPerspectives(newOrder: string[]) {
  const settings = agentSettings();
  if (!settings) return;
  settings.perspectiveOrder = newOrder;
  await settings.save();
}
```

#### 3. Bootstrap order on first load

In `getMySpaces` (or wherever `allPerspectives` is first materialised): if `agentSettings().perspectiveOrder` is null/empty, save the current load order as the initial ordering. This gives a stable baseline on first boot.

```typescript
// After allPerspectives is first populated:
if (!agentSettings()?.perspectiveOrder?.length) {
  const initialOrder = allPerspectives().map((p) => p.uuid);
  await reorderPerspectives(initialOrder);
}
```

#### 4. Keep order in sync on perspective add/remove

WE already has `perspectiveAdded` and `perspectiveRemoved` AD4M event handlers. Extend them:

- **added**: append the new UUID to `perspectiveOrder` and save
- **removed**: filter the UUID out of `perspectiveOrder` and save

```typescript
// In perspectiveAdded handler:
const current = agentSettings()?.perspectiveOrder ?? [];
await reorderPerspectives([...current, newPerspective.uuid]);

// In perspectiveRemoved handler:
const current = agentSettings()?.perspectiveOrder ?? [];
await reorderPerspectives(current.filter((id) => id !== removedUuid));
```

#### 5. Interface additions

```typescript
export interface AdamStoreContext {
  // ... existing entries ...
  /** Perspectives sorted by user-defined order (falls back to load order) */
  orderedPerspectives: Accessor<PerspectiveProxy[]>;
  /** Persist a new perspective ordering to AgentSettings */
  reorderPerspectives: (newOrder: string[]) => Promise<void>;
}
```

---

### Sidebar schema change

**File:** `packages/app-framework/src/shared/schemas/shell/Sidebar.schema.ts`

Replace the perspectives group `items` source from `allPerspectives` to `adamStore.orderedPerspectives`. The group also gains `reorderable: true` and an `onReorder` action:

```typescript
{
  reorderable: true,
  onReorder: { $action: 'adamStore.reorderPerspectives', args: [{ $local: '$arg.detail' }] },
  items: { $store: 'adamStore.orderedPerspectives' },
  // ... rest of group
}
```

---

## Part 2 — `we-sortable` Primitive

### Location

`packages/design-system/src/3-primitives/we-sortable/`

Consistent with other primitives (`we-tooltip`, `we-dialog`, `we-sheet`, etc.).

### Component API

```typescript
// Props
interface WeSortableProps {
  /** Controls drag direction and drop zone orientation */
  direction: 'vertical' | 'horizontal';
  /** Optional group name for cross-container drag (kanban use case) */
  group?: string;
  /** Items to render — must each have a stable `id: string` */
  items: { id: string; [key: string]: unknown }[];
}

// Events
// we-reorder: fired when an item is dropped within the same container
//   detail: string[] — new ordered array of IDs
// we-transfer: fired when an item is dropped into a different group container
//   detail: { itemId: string; fromContainerId: string; toContainerId: string; newIndex: number }
```

### Rendering

`we-sortable` is a layout wrapper. Each slotted child corresponds to one `item` by `id`. The component:

1. Renders a flex container (`direction === 'vertical'` → `flex-direction: column`, horizontal → `row`)
2. Injects drag handles (`:before` pseudo or an inline `<span class="drag-handle">`) for each child
3. Uses **pointer events** internally (not native HTML5 DnD — native DnD has poor mobile support and can't style ghost images)
4. On pointer-up: computes new order → fires `we-reorder` or `we-transfer`

### Integration with CollapsibleSidebar groups

The `CollapsibleSidebar` schema group type gains two new optional props:

```typescript
interface SidebarGroup {
  // ... existing props ...
  /** Enables user drag-to-reorder within this group */
  reorderable?: boolean;
  /** Called when the user reorders items — receives new ID array */
  onReorder?: SchemaValue; // wired to $action token
}
```

When `reorderable: true`, the group renders its items inside `<we-sortable direction="vertical">` instead of a plain list. The `we-reorder` event fires `onReorder`.

---

## Part 3 — Schema System Support

### `reorderable` in group schemas

The group renderer in `SchemaRenderer.tsx` (or the CollapsibleSidebar schema config) needs to:

1. Detect `reorderable: true` on a group
2. Wrap the item list in `<we-sortable direction="vertical">`
3. Wire `onReorder` to the `we-reorder` event

This is schema-configuration-level work, not a new schema token — `reorderable` is a plain boolean prop on the group, and `onReorder` is a standard `$action` value.

No changes to `resolveProp`, `dispatcher.ts`, `types.ts`, or `zodSchemas.ts` are needed.

---

## Implementation Order

| Step | Task                                                             | Files                                                      |
| ---- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | Add `perspectiveOrder` to `AgentSettings`                        | `packages/models/src/entities/AgentSettings.ts`            |
| 2    | Add `orderedPerspectives` + `reorderPerspectives` to `AdamStore` | `packages/app-framework/.../AdamStore.tsx`                 |
| 3    | Bootstrap order on first load + sync on add/remove               | `packages/app-framework/.../AdamStore.tsx`                 |
| 4    | Update sidebar schema to use `orderedPerspectives`               | `packages/app-framework/.../Sidebar.schema.ts`             |
| 5    | Implement `we-sortable` primitive                                | `packages/design-system/src/3-primitives/we-sortable/`     |
| 6    | Add `reorderable` + `onReorder` to CollapsibleSidebar groups     | `packages/design-system/src/5-widgets/CollapsibleSidebar/` |
| 7    | Wire `we-sortable` into sidebar schema                           | `packages/app-framework/.../Sidebar.schema.ts`             |

Steps 1–4 (persistence) can be reviewed and merged independently of steps 5–7 (DnD primitive).

---

## Out of Scope

- **Grid drag-and-drop** — deferred; pointer-event-based grid reordering is significantly more complex
- **Cross-space perspective sharing** — perspective order is per-user, stored in `we-root`; other users see their own order
- **Animated reordering** — can be added as a `we-sortable` enhancement after the base is working; the `we-reorder` event fires before animation completes which makes deferring straightforward
