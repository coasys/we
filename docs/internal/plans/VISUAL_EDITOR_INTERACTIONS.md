# Visual Editor Interactions Plan

Three canvas interaction features for the template visual editor: resize handles, drag-and-drop reordering, and element insertion.

---

## Existing Architecture (constraints & integration points)

- **Canvas**: Real DOM rendered inline (not an iframe). Element positions are queryable at any time via `getBoundingClientRect`.
- **Overlay**: `EditorOverlay.tsx` is an absolute-positioned transparent layer (`z-index: 5`) that already handles pointer events, hover highlights, and selection highlights. This is the natural home for all three interaction surfaces.
- **Node registry**: `VisualEditorContext` maintains `registerNode(id, el)` — a live map of schema node ID → DOM element. Used by the overlay to compute bounding boxes via `getNodeBoundsElement(nodeId)`.
- **Edit propagation**: `handlePropChange(nodeId, prop, value)` → deep-clone template → `findNodeById` → `mergeNode` → `replaceNodeInTree` → `updateTemplate` + `persistCurrentTemplate`. All three features must commit through this path.
- **Undo/redo**: `AiStore` snapshot system. Any edit that calls `updateTemplate` should also call `aiStore.pushSnapshot()` so the change is undoable.
- **No external DnD libraries**: Everything is vanilla `mousedown`/`mousemove`/`mouseup` with RAF. The existing panel resize in `RightPanelContainer.tsx` (lines 46–100) is the pattern to follow.
- **Space token scale**: `"0"` through `"1000"` (11 steps). These are design tokens that resolve to CSS custom properties at render time via `tokenVar()`. The actual pixel value of each step is readable from `getComputedStyle(document.documentElement).getPropertyValue('--we-space-N')`.
- **Node IDs**: Stable `id` field on each `SchemaNode`, assigned by `ensureNodeIds()`. Never mutate these during interaction — they're the reconciliation key.
- **Schema `styles` escape hatch**: `node.styles` accepts raw CSS (`Record<string, string | number>`) applied via a wrapper div. Use this for free-form pixel values that don't map to a design token.

---

## Feature 1: Resize Handles

### What it does

Resize handles appear on the bounding box of the selected element in the EditorOverlay. Dragging a handle updates the node's width/height props, either snapping to the nearest space token or writing free-form pixel values.

### Technical approach

**Rendering handles**: The overlay already renders a selection rect. Add 8 handle elements (4 corners + 4 edges) as small absolute-positioned squares within that rect. Each handle has a `data-handle` attribute indicating its role (`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`).

**Drag lifecycle** (follows the existing `RightPanelContainer` pattern):

1. `mousedown` on a handle: capture `startX`, `startY`, the handle role, and the node's current `w`/`h` prop values (or pixel size from `getBoundingClientRect` if no value is set yet).
2. `mousemove` on `document`: compute `deltaX`/`deltaY`, apply to the relevant axis, determine the new value (snap or free — see below), update a transient Solid signal. **Do not commit to the template on every frame** — use the signal to show a live preview in the overlay tooltip only.
3. `mouseup`: commit the final value via `handlePropChange`, push undo snapshot, clean up listeners.

**Snapping to token scale**: At drag start, read the computed CSS values for all 11 space tokens:

```ts
const tokenPx = SPACE_OPTIONS.map((t) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--we-space-${t}`)),
);
```

During drag, find the nearest token where `Math.abs(currentPx - tokenPx[i]) < SNAP_THRESHOLD` (8px). If within threshold, snap and write the token string (e.g. `"400"`) to the `w` or `h` prop. If outside all thresholds, show the raw pixel value in the tooltip but don't commit until mouseup.

**Free-form pixel mode**: When the user holds **Alt**, bypass snapping entirely. On mouseup, write to `node.styles` (`{ width: "248px" }`) instead of the `w`/`h` props, since design token props only accept token strings.

**Prop mapping**: Width maps to the `width` prop; height to `height`. These exist on all `DesignSystemElement` components and the layout primitives (`Column`, `Row`, `Grid`, `Card`).

**Tooltip**: Render a small label near the active handle showing `w: 400` (token mode) or `248px` (free mode). Update every frame via the transient signal.

**Snap guides** (v2): Faint horizontal/vertical lines at each token boundary across the canvas, visible only during an active resize drag. Not required for v1.

### UX summary

- 8 handles on the selected element bounding box, visible only in visual edit mode
- Default: snaps to nearest space token; shows token name in tooltip
- Alt held: free-form pixel mode; shows px value in tooltip; writes to `styles` escape hatch
- A small `snap / free` pill indicator inside the tooltip clarifies the current mode
- No permanent toggle needed — Alt-as-modifier matches Figma's muscle memory

---

## Feature 2: Drag and Drop

### What it does

A user can pick up a selected element from the canvas and drop it into a new position in the schema tree, reordering siblings or reparenting into a different container.

### Technical approach

**Starting a drag**: In `EditorOverlay`'s existing `handlePointerDown`, add a hold-or-movement check — drag starts after either 200ms held or 5px cursor movement while the button is held. Before that threshold is reached, the interaction is still a normal click-to-select. A `dragging` boolean signal gates the two behaviours.

**Ghost element**: On drag start, create a `position: fixed` div that follows the cursor. It mirrors the selected element's bounding box dimensions with the node's `type` label and a semi-transparent blue tint. Update its position in `mousemove` via `requestAnimationFrame`.

**Parent map**: The DOM tree can't be traversed to find schema parents because of `$each` instances, logic nodes, and slots. On drag start, walk `templateSchema` once to build a `Map<nodeId, parentId>`. This is fast (templates are small) and gives O(1) lookups for the rest of the drag.

**Drop target detection**: Each `mousemove`, call `document.elementFromPoint(x, y)` with the ghost's `pointer-events: none` so the real element underneath is found. Walk up the DOM from that element using `closest('[data-we-node-id]')` to find the nearest schema node. Look up that node in the schema tree to determine if it can accept children (has a `children` array).

**Insertion position**: Within a valid drop target container, compute which gap between siblings the cursor is closest to. For a `Row` (horizontal), compare cursor X to each child's midpoint X. For a `Column` (vertical), compare cursor Y. Render a 2px blue insertion line between the appropriate siblings.

**Visual feedback during drag**:

- Valid drop targets: blue border ring
- Invalid targets (leaf nodes, `$each` parents, logic nodes, route nodes): no ring; show a `not-allowed` cursor
- Original position: leave a ghost placeholder (same dimensions, `opacity: 0.3`) so the user sees where the node came from

**Committing on drop**:

1. Remove the dragged `SchemaNode` from its current parent's `children` array
2. Insert it at the target index in the new parent's `children` array
3. Call `updateTemplate` with the modified schema + `persistCurrentTemplate` + `aiStore.pushSnapshot()`

**Cancellation**: `Escape` during drag aborts — remove the ghost, remove the placeholder, restore the selection highlight.

**v1 scope restrictions**: Only plain layout/content nodes (`Column`, `Row`, `Card`, `we-text`, `we-image`, etc.). Skip drag initiation for `$each`, `$if`, `$animate`, `$single`, `$routes`, and route nodes — their positional semantics in the schema tree are too complex for a first pass.

### UX summary

- Hold or move 5px while mouse-down on a selected element to initiate drag
- Semi-transparent ghost follows cursor; original position shows faded placeholder
- Valid containers highlight on hover; blue insertion line shows drop position
- Escape cancels; mouseup commits
- Logic nodes and route nodes are not draggable in v1

---

## Feature 3: Adding Elements

### What it does

A user can add a new element (e.g. `we-text`, `Row`, `Column`) into the template at a specific position, without leaving the canvas.

### Technical approach

**Insertion zones**: When a container node is selected (or hovered for 500ms), show small `+` pill buttons between each pair of its children, and at the start and end of the children list. These are rendered by `EditorOverlay` as absolute-positioned elements in the gaps between sibling bounding boxes. On hover over a container in the overlay, compute each child's `getBoundingClientRect`, then place `+` buttons at the midpoints of the gaps.

**Element picker popover**: Clicking a `+` button opens a small popover anchored to that button. The popover shows element types grouped into two categories:

_Layout_: `Row`, `Column`, `Grid`, `Card`, `we-divider`  
_Content_: `we-text`, `we-image`, `we-icon`, `we-button`, `we-badge`, `we-avatar`

Each entry is an icon + label. The user can type to filter. Clicking an entry closes the popover and inserts the node.

**New node scaffold**: Each element type has a minimal default `SchemaNode`:

```ts
const ELEMENT_DEFAULTS: Record<string, SchemaNode> = {
  'we-text': { type: 'we-text', children: ['New text'] },
  Row: { type: 'Row', props: { gap: '300', ay: 'center' }, children: [] },
  Column: { type: 'Column', props: { gap: '300' }, children: [] },
  // ...
};
```

Each new node gets a fresh ID via `ensureNodeIds()` before insertion.

**Insertion**: Insert the new `SchemaNode` at the chosen index in the target parent's `children` array, then call `updateTemplate` + `persistCurrentTemplate` + `aiStore.pushSnapshot()`. After insertion, immediately select the new node so the user lands in the InspectorPanel ready to edit its props.

**InspectorPanel tree `+` button** (secondary entry point): The existing tree view in InspectorPanel already renders each node with an expand/collapse control. Add a `+` icon button per row in the tree that opens the same element picker popover, inserting as a child of that node at the end of its children. This is the power-user path when the canvas `+` zone is hard to hit.

**`$if` / `$each` special case**: When the selected container is a `$each` or `$if`, the `+` button should add to the `then` or `children` of those nodes respectively, not to their parent. This needs explicit handling in the zone-rendering logic.

### UX summary

- `+` pill buttons appear between children of the hovered/selected container
- Click opens a compact grouped picker (icon + label, type-to-filter)
- New element is inserted and immediately selected
- InspectorPanel tree also gets per-node `+` buttons as a secondary path
- New nodes are scaffolded with sensible defaults (no blank/empty states)

---

## Shared Utilities to Build First

Before implementing any of the three features, extract these from the existing code:

1. **`buildParentMap(schema: TemplateSchema): Map<nodeId, nodeId>`** — walks the tree and returns child → parent ID mapping. Needed by drag-and-drop and deletion.
2. **`insertNode(schema, parentId, index, newNode): TemplateSchema`** — deep-clone, find parent, splice into `children`, return. Needed by add-elements and drag-and-drop.
3. **`removeNode(schema, nodeId): TemplateSchema`** — deep-clone, find and remove the node from its parent's children. Needed by drag-and-drop.
4. **`resolveSpaceTokenPx(): Record<string, number>`** — reads CSS variable values for all 11 space tokens from the document. Needed by resize.

These are pure functions on `TemplateSchema` — unit-testable, reusable across all three features.

---

## Implementation Order

### 1. Resize handles (first)

- Scoped entirely to prop updates — no tree restructuring needed
- Builds directly on the EditorOverlay's existing selection rect rendering
- The dual-mode (token-snap vs. pixel) is the only design question, resolved by Alt-as-modifier
- Delivers immediate value: users can adjust layouts without touching InspectorPanel inputs

### 2. Adding elements (second)

- Establishes `insertNode` and the element scaffold registry
- The `+` zone rendering in the overlay is also useful groundwork for the drop-target highlighting in drag-and-drop
- Gives users something to drag once drag-and-drop is built

### 3. Drag and drop (last)

- Most complex: ghost rendering, parent map, drop zone detection, tree restructuring
- Reuses `removeNode` + `insertNode` from step 2
- The least blocking of the three — users can work around it by adding elements in the right place
- Build this once the first two are solid and the tree manipulation utilities are proven
