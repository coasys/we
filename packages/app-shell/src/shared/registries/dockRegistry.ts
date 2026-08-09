/**
 * Dock Registry — module panels that take room from the app rather than covering it.
 *
 * The sibling of `slotRegistry`, and the distinction between them is the whole point. A slot is
 * chrome that **overlays**: it positions itself and whatever is beneath carries on underneath. A
 * dock **insets**: the host shrinks the content viewport by exactly as much as the dock occupies, so
 * a panel and the space can be used at the same time.
 *
 * That mechanism already existed — `TemplateLayout.computeRightOffset` shrinks the viewport for the
 * theme and template editor's rails, and `PersistentAppFrames` reads the same number so embedded
 * apps line up. It was hardcoded to the editor. This generalises it: any module can contribute, and
 * the editor's own offsets are still summed alongside.
 *
 * ## Anchors group, docks position
 *
 * `slotRegistry`'s docblock notes that an anchor is semantic metadata — it orders and groups, and
 * the contributed node positions itself, because WE's shell nodes always have. It also notes that a
 * future anchor *could* emit a container, and that doing so would be a deliberate behaviour change
 * rather than something to smuggle in. This is that change, made in a new registry rather than by
 * altering what an anchor means, so nothing that renders through a slot today moves.
 *
 * A dock therefore does not position itself. It says which edge and how big; the host owns where
 * that lands, what it has to clear (the sidebar on the left, the module rail on the right), what
 * the content viewport becomes, and what happens on a window too narrow to give anything up. That
 * is not tidiness: a module cannot see the sidebar's width or the rail's, and the call module was
 * carrying `right: '72px'` — a hardcoded copy of geometry it had no way to keep in step.
 */
import type { DockContribution } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';

export interface DockEntry extends DockContribution {
  /** Unique — `<moduleId>:<index>`, so one module can contribute more than one panel. */
  id: string;
  /** The module whose store the `edge` / `size` / `float` keys are read from. */
  moduleId: string;
}

const entries = new Map<string, DockEntry>();

export const dockRegistry = {
  register(entry: DockEntry): void {
    entries.set(entry.id, entry);
  },

  remove(id: string): void {
    entries.delete(id);
  },

  get(id: string): DockEntry | undefined {
    return entries.get(id);
  },

  /**
   * Every dock, in a stable order.
   *
   * Ordered by declared `order` then by id, the same tiebreak `slotRegistry` uses and for the same
   * reason: without it, registration order leaks into layout and two docks on the same edge would
   * swap places depending on which module loaded first.
   */
  ordered(): DockEntry[] {
    return [...entries.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  },
};

/**
 * The store path a dock's geometry is published at.
 *
 * Built here rather than in the shell store so the two ends cannot drift — the memo that writes the
 * geometry and the schema node that reads it derive their key from the same function.
 */
export function dockGeometryPath(id: string, field: string): string {
  return `shellStore.dockGeometry.${id}.${field}`;
}

/**
 * Wrap a dock's node in the box the host has decided it occupies.
 *
 * Every geometric prop is a `$store` reference rather than a literal, which is what keeps a dock
 * *moving* rather than being rebuilt: changing edge, size or float rewrites props on a container
 * that stays mounted. Rebuilding it would remount the panel's whole subtree, and a subtree holding
 * live `<video>` elements loses its streams when that happens — the same reference-identity hazard
 * the call module's tile cache exists for, one layer up.
 *
 * The outer `$if` is the exception, and it is the right one: no edge means the panel is closed, and
 * a closed panel genuinely should be gone rather than hidden — a call stage nobody has open must
 * not keep decoding video.
 */
export function dockFrame(entry: DockEntry, node: SchemaNode): SchemaNode {
  const geo = (field: string) => ({ $store: dockGeometryPath(entry.id, field) });

  return {
    type: '$if',
    props: {
      condition: geo('edge'),
      then: {
        type: 'Column',
        props: {
          position: 'fixed',
          top: geo('top'),
          right: geo('right'),
          bottom: geo('bottom'),
          left: geo('left'),
          width: geo('width'),
          height: geo('height'),
          transform: geo('transform'),
          // The panel's own surface. A module's node fills it and need not paint a background, a
          // border or a radius of its own — which is what stops two docked modules from looking
          // like two different applications.
          bg: 'neutral-0',
          border: '1px solid neutral-200',
          r: '500',
          shadow: 'xl',
          overflow: 'hidden',
          zIndex: 'sticky',
        },
        children: [resizeHandle(entry.id), node],
      },
    },
  };
}

/**
 * The edge of a docked panel you can drag.
 *
 * Rendered by the host rather than by the module, for the same reason placement is: a module cannot
 * see the sidebar, the rail, or the window, so it cannot say what a sensible size would be — and
 * three preset buttons in a module's own chrome were what stood in for this. Putting it here means
 * every docked panel gets dragging, and the ones that come later get it without asking.
 *
 * Absent while floating: `handle` is undefined for a panel that takes no room, and a `$if` on it is
 * what keeps a strip from sprouting a divider it could not act on.
 */
function resizeHandle(id: string): SchemaNode {
  const geo = (field: string) => ({ $store: dockGeometryPath(id, field) });
  const on = (side: string) => ({ $eq: [geo('handle'), side] });

  return {
    type: '$if',
    props: {
      condition: geo('handle'),
      then: {
        type: 'we-resize-handle',
        props: {
          // Vertical bar for a panel whose handle is on its left or right; horizontal otherwise.
          orientation: { $if: { condition: { $or: [on('left'), on('right')] }, then: 'vertical', else: 'horizontal' } },
          // Flush with the panel's own border, so dragging thickens the line that is already there
          // rather than revealing a second one a few pixels inside it.
          align: { $if: { condition: { $or: [on('left'), on('top')] }, then: 'start', else: 'end' } },
          styles: { '--we-resize-handle-thickness': '3px' },
          position: 'absolute',
          zIndex: 'sticky',
          // Pinned to the named side and stretched along the other axis, so one node serves all four
          // edges rather than four nodes each knowing about one.
          top: { $if: { condition: on('bottom'), then: 'auto', else: '0' } },
          bottom: { $if: { condition: on('top'), then: 'auto', else: '0' } },
          left: { $if: { condition: on('right'), then: 'auto', else: '0' } },
          right: { $if: { condition: on('left'), then: 'auto', else: '0' } },
          width: { $if: { condition: { $or: [on('left'), on('right')] }, then: '8px', else: 'auto' } },
          height: { $if: { condition: { $or: [on('top'), on('bottom')] }, then: '8px', else: 'auto' } },
          // `onXxx`, not `on:xxx`: the schema renderer recognises an event prop by a capital after
          // "on", and Solid lowercases the rest to the event name — so these bind `resizestart`,
          // `resize` and `resizeend`. The `on:` form is for hand-written TSX and is inert here.
          onResizestart: { $action: 'shellStore.beginDockResize', args: [id] },
          onResize: { $action: 'shellStore.resizeDock', args: [id, '$arg.detail.delta'] },
          onResizeend: { $action: 'shellStore.endDockResize' },
        },
      },
    },
  };
}
