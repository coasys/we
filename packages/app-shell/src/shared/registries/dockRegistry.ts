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

import type { SnapPoint } from '../dockGeometry';

export interface DockEntry extends DockContribution {
  /** Unique — `<moduleId>:<index>`, so one module can contribute more than one panel. */
  id: string;
  /** The module whose store the `edge` / `size` / `float` keys are read from. */
  moduleId: string;
  /**
   * How a *schema* addresses that store, where it is not a module's — `'editorStore'`.
   *
   * The shell reads `edge`/`size`/`float` in TypeScript, through `readDockKey`, which resolves
   * against `moduleStores` or `hostDockStores` and needs no path. `close` is different: it is
   * rendered into the titlebar as an `$action`, so it needs a name the renderer can resolve, and the
   * two namespaces do not have the same shape — a module's store is `modules.<id>`, and the host's
   * own stores are named outright. Defaults to the module form, which is right for every module.
   */
  storeRef?: string;
}

/**
 * Stores a dock may read its keys from that are not a module's.
 *
 * The editor's panels are docks now, and the editor is not a module: its open flags live in
 * `editorStore`, which the shell holds. Registered by whatever mounts that store, under the id its
 * dock entries name — so `readDockKey` resolves against one place whether the panel came from a
 * module or from the host itself.
 *
 * Deliberately not merged into `moduleStores`: a module's store is installable, sandboxed and gone
 * when it is uninstalled, and putting host state in the same bag would make "which of these can the
 * user remove" an unanswerable question.
 */
export const hostDockStores: Record<string, Record<string, unknown>> = {};

const entries = new Map<string, DockEntry>();

/**
 * Registration is observable, because a plain object cannot be depended on.
 *
 * A dock names its `edge` as a *string key* into a store, and the shell resolves it by looking that
 * store up in `hostDockStores` and calling the accessor. When the store is not there yet the lookup
 * yields nothing — and, crucially, the memo doing the looking never touches the accessor, so it
 * registers no dependency on it and has nothing to re-run for. It cannot recover on its own.
 *
 * That is not hypothetical ordering paranoia: `ShellStoreProvider` wraps `EditorStoreProvider`, so
 * the shell's dock geometry is computed before the editor store exists. The theme panel could not be
 * opened at all — its flag went true, the memo never re-read the edge, and no amount of clicking or
 * reloading helped. Opening any *other* panel fixed it, because that changed something the memo did
 * depend on, and the re-run finally found the editor's store.
 *
 * Framework-neutral on purpose: this file is shared, so it publishes a subscription and lets the
 * host turn it into whatever reactive primitive it uses.
 */
const listeners = new Set<() => void>();
function announce(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to registration changes. Returns an unsubscribe. */
export function onDockRegistryChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish a host store the dock entries can name — see `hostDockStores`. */
export function registerHostDockStore(id: string, store: Record<string, unknown>): void {
  hostDockStores[id] = store;
  announce();
}

export function unregisterHostDockStore(id: string): void {
  delete hostDockStores[id];
  announce();
}

export const dockRegistry = {
  register(entry: DockEntry): void {
    entries.set(entry.id, entry);
    announce();
  },

  remove(id: string): void {
    entries.delete(id);
    announce();
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
 * Wrap a panel in the box the host has decided it occupies, and in the controls that move it.
 *
 * Every geometric prop is a `$store` reference rather than a literal, which is what keeps a panel
 * *moving* rather than being rebuilt: changing snap, size or displacement rewrites props on a
 * container that stays mounted. Rebuilding it would remount the panel's whole subtree, and a subtree
 * holding live `<video>` elements loses its streams when that happens — the same reference-identity
 * hazard the call module's tile cache exists for, one layer up.
 *
 * The outer `$if` is the exception, and it is the right one: no edge means the panel is closed, and a
 * closed panel genuinely should be gone rather than hidden — a call stage nobody has open must not
 * keep decoding video.
 *
 * The snap targets sit *outside* that box, because they cover the window while the panel is being
 * dragged across it. Hence the transparent `display: contents` wrapper holding both: two fixed-position
 * siblings, neither of which is inside the other.
 */
/**
 * How `fitDock` finds the two boxes whose difference is the panel's chrome.
 *
 * Attributes rather than refs because the frame is *schema* — it is built as nodes so a deployment
 * can restyle it, which means there is no component here to hang a ref on.
 */
export const DOCK_FRAME_ATTR = 'data-we-dock-frame';
export const DOCK_CONTENT_ATTR = 'data-we-dock-content';

/**
 * When a panel is glass: floating over the app, and not filling it.
 *
 * Both of those are `floating` — a maximised panel is not displacing either — but they want
 * opposite answers here. A card over the content has something behind it worth seeing; a panel
 * covering the window has nothing beside it, so translucency there only makes its own contents
 * harder to read, over a full-window blur nobody asked for.
 *
 * A displacing panel is opaque for the reason it has no radius and no shadow: it has *taken* its
 * room rather than borrowed it, so it meets the content edge to edge and is not on top of anything.
 */
const isGlass = (id: string) => ({
  $and: [{ $store: dockGeometryPath(id, 'floating') }, { $not: { $store: dockGeometryPath(id, 'maximised') } }],
});

/**
 * How far past the panel you can see, and how much of it resolves.
 *
 * `color-mix` toward `transparent` rather than an `opacity` on the box: opacity fades the panel's
 * *contents* along with its background, so the text would go with it. This fades only what is
 * painted behind them.
 */
const translucent = (role: string) => `color-mix(in oklch, var(--we-role-${role}) 50%, transparent)`;

/** Enough to separate the panel from what is behind it without turning it into frosted glass. */
const PANEL_BLUR = 'blur(12px)';

export function dockFrame(entry: DockEntry, node: SchemaNode): SchemaNode {
  const geo = (field: string) => ({ $store: dockGeometryPath(entry.id, field) });
  const glass = isGlass(entry.id);

  return {
    type: 'Column',
    // Transparent: both children position themselves, and a box around them would be one more thing
    // in the flow for no reason.
    props: { styles: { display: 'contents' } },
    children: [
      snapTargets(entry.id),
      insertLines(entry.id),
      {
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
              // The panel's own surface. A module's node fills it and need not paint a background, a
              // border or a radius of its own — which is what stops two docked modules from looking
              // like two different applications.
              //
              // Half-transparent while it is a card, so the app stays visible behind it and the
              // panel reads as being *over* something rather than as a hole cut in the window. See
              // `isGlass` for why a maximised panel is excluded, and `translucent` for why this is
              // not an `opacity`.
              bg: { $if: { condition: glass, then: translucent('surface-sunken'), else: 'surface-sunken' } },
              // Backdrop blur belongs with the transparency and goes when it does: it is expensive,
              // it makes the element a containing block for fixed descendants, and over an opaque
              // background it would cost both of those for nothing visible.
              styles: { $if: { condition: glass, then: { 'backdrop-filter': PANEL_BLUR }, else: {} } },
              border: '1px solid border',
              // Rounded and lifted only while floating. A card over the app should read as being on
              // top; a panel that has taken room *from* the app meets it edge to edge, where a radius
              // would leave slivers of background in the corners and a shadow would fall on content
              // that is beside it rather than beneath it.
              r: { $if: { condition: geo('floating'), then: '500' } },
              shadow: { $if: { condition: geo('floating'), then: 'xl' } },
              overflow: 'hidden',
              zIndex: 'sticky',
              /*
                Marked so "fit to content" can measure the chrome rather than assume it.

                What sits between this box and the one the panel's content gets — the titlebar, its
                padding and border, this frame's own border — is decided here and needed by
                `fitDock`, which solves a height from the content's aspect and has to add it back
                on. It was a constant, it drifted by eleven pixels when the titlebar gained the
                padding that clears the corner radius, and in a wide arrangement that came back
                multiplied by the tile ratio as a band down each side. Measuring the two boxes is
                the version that cannot drift.
              */
              [DOCK_FRAME_ATTR]: entry.id,
            },
            children: [
              ...grips(entry.id),
              titleBar(entry),
              /*
                The panel gets what is left, and no more.

                Its own root is `height: 100%` — of the frame, not of the frame *minus the titlebar* —
                so slotted straight in it overflows by exactly the bar's height and the last 32px of
                every panel disappear behind the frame's `overflow: hidden`. A flex child with
                `flex: 1` and a zero minimum takes the remainder instead, which is the same pair the
                modal's scroll region needs and for the same reason.
              */
              {
                type: 'Column',
                props: {
                  flex: '1',
                  minHeight: '0',
                  width: '100%',
                  overflow: 'hidden',
                  [DOCK_CONTENT_ATTR]: entry.id,
                  /*
                    Room for chrome painted over a maximised panel — see `padTop` in dockGeometry.

                    Absent for every other placement, which is why this is a geometry field rather
                    than a constant: a floating or snapped panel is clamped out of those bands
                    already, and only a maximised one takes the whole window and then has the call
                    bar over its bottom edge. Padding the content rather than shrinking the box is
                    what keeps the panel covering the sidebar while its contents stay readable.
                  */
                  pt: geo('padTop'),
                  pb: geo('padBottom'),
                },
                /*
                  A panel is a surface of its own.

                  What a docked module has to fit into is the box the user dragged, not the window
                  and not the space behind it — so anything inside adapts to *this* panel. That is
                  the case the whole surface mechanism was built for: the call stage is a rectangle
                  somebody reshapes by hand, and until this existed nothing inside it could tell.

                  Declared here rather than by each module, for the reason every surface is
                  host-declared: a container query with no container is silently false, so a module
                  relying on one it did not get would look correct and never adapt.
                */
                children: [{ type: '$surface', children: [node] }],
              },
            ],
          },
        },
      },
    ],
  };
}

/**
 * The strip a panel is dragged by, and the controls that place it.
 *
 * In flow above the panel's content rather than floating over it, which is the difference between a
 * titlebar and an obstruction: panels here carry their own headers and close buttons, and a grip
 * overlaid in a corner would sooner or later land on one of them.
 *
 * It is also the whole keyboard story. The grip is focusable and moves the panel by arrow key, and
 * the menu names all eight positions outright — so nothing about placing a panel requires a pointer,
 * which a drag-only design would have quietly made true.
 *
 * Padded, and taller than the controls inside it. A 24px bar holding a 24px button put that button's
 * corner exactly where the panel's own 16px radius clips, so the menu trigger came out shaved on two
 * sides; 4px of vertical padding and 8px of horizontal is enough to clear the curve at the height the
 * button actually occupies.
 */
/**
 * Show a control only while the panel is *not* maximised.
 *
 * Three of the titlebar's controls do nothing at all in full screen, and each does nothing in a way
 * that is worse than inert. Fitting to content writes a width and height the maximised box ignores.
 * The displace toggle writes a flag it ignores. The position menu ticks a snap that decides only
 * where the panel will land *later*, so choosing one changes something invisible now and surprising
 * on the way back out.
 *
 * Hidden rather than disabled, which is the same choice `fitButton` already makes for a module that
 * publishes no aspect — "a control that did nothing would be worse than one that is not there".
 * Disabling would keep the titlebar's composition stable, and the usual argument for that is a
 * toggle staying under the cursor between presses. It does not apply here: maximising relocates the
 * whole titlebar to the top of the window, so nothing is where it was regardless.
 *
 * What stays is what still means something. The grip, because dragging a maximised panel pulls it
 * back out — one of the two ways to leave. The maximise toggle, which is the other. And close.
 */
function whileRestored(id: string, node: SchemaNode): SchemaNode {
  return {
    type: '$if',
    props: { condition: { $not: { $store: `shellStore.dockPlacement.${id}.maximised` } }, then: node },
  };
}

function titleBar(entry: DockEntry): SchemaNode {
  return {
    type: 'Row',
    props: {
      width: '100%',
      flex: '0 0 auto',
      ay: 'center',
      gap: '100',
      px: '200',
      py: '100',
      /*
        Translucent alongside the frame, so the card is one piece of glass rather than a solid bar
        stuck to a transparent body.

        No blur of its own: it is inside the frame, which has already blurred everything behind the
        whole panel. Its 50% composites over the frame's 50%, so the bar settles at about 75% — more
        solid than the content it labels, which is the right way round for the part you grab.
      */
      bg: { $if: { condition: isGlass(entry.id), then: translucent('page'), else: 'page' } },
      borderBottom: '1px solid border',
      /*
        Double-click to maximise, the other half of the convention the grip completes.

        On the bar rather than on the grip, so the empty space beside the buttons works too — which is
        where people aim, since the grip is a thin strip and the target for a double-click is
        "the titlebar". The button stays: this is a second route, not the only one.
      */
      onDblclick: { $action: 'shellStore.toggleMaximiseDock', args: [entry.id] },
    },
    children: [
      {
        type: 'we-move-handle',
        props: {
          flex: '1',
          height: '100%',
          label: 'Move panel',
          // `onXxx`, not `on:xxx`: the schema renderer recognises an event prop by a capital after
          // "on" and Solid lowercases the rest, so these bind `movestart`, `move` and `moveend`.
          onMovestart: { $action: 'shellStore.beginDockMove', args: [entry.id, '$arg.detail.x', '$arg.detail.y'] },
          onMove: { $action: 'shellStore.moveDock', args: [entry.id, '$arg.detail.dx', '$arg.detail.dy'] },
          onMoveend: { $action: 'shellStore.endDockMove', args: [entry.id] },
        },
      },
      ...(entry.aspect ? [whileRestored(entry.id, fitButton(entry.id))] : []),
      whileRestored(entry.id, displaceButton(entry.id)),
      maximiseButton(entry.id),
      whileRestored(entry.id, positionMenu(entry)),
      // Last, and after the menu: the one control whose consequence cannot be undone by clicking it
      // again wants to be the one furthest from the others.
      ...(entry.close ? [closeButton(entry)] : []),
    ],
  };
}

/**
 * Shrink the panel to the shape its content wants.
 *
 * A button rather than a menu item, because of how it is used: resizing by hand overshoots, and this
 * is the correction — pressed straight after a drag, often twice while settling on a width. Behind a
 * menu that is three actions for one adjustment.
 *
 * Only where the module publishes an aspect. Without one there is nothing to solve for, and a
 * control that did nothing would be worse than one that is not there.
 */
function fitButton(id: string): SchemaNode {
  return {
    type: 'we-tooltip',
    props: { title: 'Fit to content', placement: 'bottom' },
    children: [
      {
        type: 'we-button',
        props: { size: 'xs', square: true, variant: 'ghost', onClick: { $action: 'shellStore.fitDock', args: [id] } },
        children: [{ type: 'we-icon', props: { name: 'crop' } }],
      },
    ],
  };
}

/**
 * Push the content aside, or stop — out of the menu for the same reason, and greyed out where it
 * cannot work.
 *
 * Disabled rather than hidden on a corner. A control that vanishes when you move a panel is one you
 * stop looking for, and the disabled state carries the actual rule: displacing needs an edge, because
 * a rectangular layout cannot flow around a box in a corner. The store refuses it there anyway —
 * this is the same answer, made visible before the click rather than after it.
 */
function displaceButton(id: string): SchemaNode {
  const place = (field: string) => ({ $store: `shellStore.dockPlacement.${id}.${field}` });

  return {
    type: 'we-tooltip',
    props: {
      title: {
        $if: {
          condition: place('canDisplace'),
          then: 'Push content aside',
          else: 'Snap to an edge to push content aside',
        },
      },
      placement: 'bottom',
    },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'xs',
          square: true,
          variant: { $if: { condition: place('displace'), then: 'secondary', else: 'ghost' } },
          disabled: { $not: place('canDisplace') },
          onClick: { $action: 'shellStore.toggleDockDisplace', args: [id] },
        },
        children: [{ type: 'we-icon', props: { name: 'columns' } }],
      },
    ],
  };
}

/**
 * Cover the screen, or go back to being a card.
 *
 * Here rather than in the module's own controls, which is where the call module had it — the only
 * module that could do it, in a bar that has nothing to do with layout. It sits with the other three
 * things you can do to a panel's shape, and every panel has it now.
 *
 * The glyph swaps, unlike the two beside it: this control's states are opposite *moves* rather than a
 * capability being on or off, so "expand" and "contract" say more than a highlight would.
 */
function maximiseButton(id: string): SchemaNode {
  const maximised = { $store: `shellStore.dockPlacement.${id}.maximised` };

  return {
    type: 'we-tooltip',
    props: {
      title: { $if: { condition: maximised, then: 'Exit full screen', else: 'Full screen' } },
      placement: 'bottom',
    },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'xs',
          square: true,
          variant: { $if: { condition: maximised, then: 'secondary', else: 'ghost' } },
          onClick: { $action: 'shellStore.toggleMaximiseDock', args: [id] },
        },
        children: [
          {
            type: 'we-icon',
            props: { name: { $if: { condition: maximised, then: 'arrows-in', else: 'arrows-out' } } },
          },
        ],
      },
    ],
  };
}

/**
 * The eight positions, and nothing else.
 *
 * It held the fit and displace controls too, which made it a menu about three unrelated things and
 * buried the two that are pressed most. They are buttons beside it now, and this is a position
 * picker — one question, eight answers, each ticked when it is the current one.
 */
/**
 * Close the panel — the last control on the titlebar, after the position menu.
 *
 * Rendered by the host rather than by the panel, which is the change: every panel used to draw its
 * own inside its own content, so no two were the same size or in the same place, and the video stage
 * — a grid of tiles with nowhere to put a header — simply had none. A panel's controls belong on the
 * bar that already holds its grip, its position menu and its full-screen button.
 *
 * The action is the module's, because closing is the one thing about a panel the host does not
 * decide: where it sits is the host's and remembered per device, whether it is open is the module's
 * own state. A module that declares no `close` gets no button rather than a dead one.
 */
function closeButton(entry: DockEntry): SchemaNode {
  const store = entry.storeRef ?? `modules.${entry.moduleId}`;

  return {
    type: 'we-tooltip',
    props: { title: 'Close', placement: 'bottom' },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'xs',
          square: true,
          variant: 'ghost',
          onClick: { $action: `${store}.${entry.close}` },
        },
        children: [{ type: 'we-icon', props: { name: 'x' } }],
      },
    ],
  };
}

function positionMenu(entry: DockEntry): SchemaNode {
  const id = entry.id;
  const place = (field: string) => ({ $store: `shellStore.dockPlacement.${id}.${field}` });

  /*
    An options object, not three positional arguments — and the reason is the icon bundler.

    `collect-icons` reads icon names out of source, and a name passed positionally into a helper is
    invisible to it: it looks for `icon: '…'`, or a name beside a `we-icon`. Written the short way,
    all eight of these fell through to the CDN and would have been blank squares on an offline
    desktop build. The kit's own conventions ask for options objects anyway; this is the case where
    the convention has teeth.
  */
  const at = (opts: { snap: SnapPoint; label: string; icon: string }) => ({
    id: opts.snap,
    type: 'toggle',
    label: opts.label,
    icon: opts.icon,
    checked: { $eq: [place('snap'), opts.snap] },
    onToggle: { $action: 'shellStore.snapDock', args: [id, opts.snap] },
  });

  return {
    type: 'DropdownMenu',
    props: {
      triggerIcon: 'dots-three',
      // Explicitly empty: the trigger is a 24px chip in a titlebar, and `DropdownMenu` otherwise
      // falls back to the word "Options", which would be wider than the panel on a small float.
      triggerLabel: '',
      size: 'xs',
      /*
        A size larger than the trigger, and the reason the two are separate props.

        The trigger has to fit the titlebar; the list has to be read. At `xs` the items came out at
        12px beside a panel whose own controls are larger, which is the wrong way round for the thing
        you are reading rather than the thing you are aiming at.
      */
      itemSize: 'sm',
      placement: 'bottom-end',
      items: [
        at({ snap: 'top-left', label: 'Top left', icon: 'arrow-up-left' }),
        at({ snap: 'top', label: 'Top', icon: 'arrow-line-up' }),
        at({ snap: 'top-right', label: 'Top right', icon: 'arrow-up-right' }),
        at({ snap: 'left', label: 'Left', icon: 'arrow-line-left' }),
        at({ snap: 'right', label: 'Right', icon: 'arrow-line-right' }),
        at({ snap: 'bottom-left', label: 'Bottom left', icon: 'arrow-down-left' }),
        at({ snap: 'bottom', label: 'Bottom', icon: 'arrow-line-down' }),
        at({ snap: 'bottom-right', label: 'Bottom right', icon: 'arrow-down-right' }),
      ],
    },
  };
}

/**
 * The gaps in a strip, drawn as lines while a panel is over them.
 *
 * The convention every application with dockable panels shares: a drop that could only report an
 * *edge* can only ever return a panel to where the registry put it, so the gaps between the panels
 * already there become targets, and the one you are over is drawn as a line. Photoshop draws it
 * between groups, VS Code highlights the gap, and both mean the same thing — "let go and it goes
 * here, in this position".
 *
 * Thin, and only lit when active: eight dashed boxes plus four dashed lines would be more decoration
 * than the screen can carry. The line says *between these two*, which a box cannot.
 */
function insertLines(id: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $eq: [{ $store: 'shellStore.movingDock' }, id] },
      then: {
        type: '$each',
        props: { items: { $store: 'shellStore.insertSlots' }, as: 'slot' },
        children: [
          {
            /*
              The line, drawn where the store says — which is *on* the boundary, not centred in the
              target measured against it. Those are two different boxes for a reason: see
              `insertionSlots`.
            */
            type: 'Column',
            props: {
              position: 'fixed',
              top: '$slot.top',
              left: '$slot.left',
              width: '$slot.width',
              height: '$slot.height',
              r: 'pill',
              // The drag is a pointer capture on the grip; a target that could swallow a pointer event
              // would end the drag it exists to guide.
              pointerEvents: 'none',
              // Above every panel, for the reason the snap targets are — see there.
              zIndex: 'chrome',
              bg: {
                $if: {
                  condition: {
                    $eq: [{ $store: 'shellStore.activeInsert' }, { $concat: ['$slot.edge', ':', '$slot.index'] }],
                  },
                  then: 'accent',
                  else: 'surface-active',
                },
              },
              opacity: {
                $if: {
                  condition: {
                    $eq: [{ $store: 'shellStore.activeInsert' }, { $concat: ['$slot.edge', ':', '$slot.index'] }],
                  },
                  then: 1,
                  else: 0.4,
                },
              },
            },
          },
        ],
      },
    },
  };
}

/**
 * Where a dragged panel can land, shown only while one is being dragged.
 *
 * Eight boxes, with the one it would take right now lit up. Drawn from the host's own `snapTargets`
 * rather than from the panel's size, because what a target has to communicate is *where*, not how
 * big — a target the size of the panel would be invisible for a small one and would cover the screen
 * for a large one.
 *
 * `pointerEvents: 'none'` throughout: the drag is a pointer capture on the grip, and a target that
 * could swallow a pointer event would end the drag it exists to guide.
 */
function snapTargets(id: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $eq: [{ $store: 'shellStore.movingDock' }, id] },
      then: {
        type: '$each',
        props: { items: { $store: 'shellStore.snapTargets' }, as: 'target' },
        children: [
          {
            type: 'Column',
            props: {
              position: 'fixed',
              top: '$target.top',
              left: '$target.left',
              width: '$target.width',
              height: '$target.height',
              r: '500',
              pointerEvents: 'none',
              /*
                Above the panels, not beside them.

                These belong to the frame of the panel being dragged, which is one entry among several
                at the same `sticky` layer — so whether a guide was visible depended on where its own
                panel happened to sit in the slot order. A guide you can only sometimes see is worse
                than none, since the rule it is teaching looks intermittent.
              */
              zIndex: 'chrome',
              border: {
                $if: {
                  condition: { $eq: [{ $store: 'shellStore.activeSnap' }, '$target.id'] },
                  then: '2px solid primary-500',
                  else: '2px dashed neutral-300',
                },
              },
              bg: {
                $if: {
                  condition: { $eq: [{ $store: 'shellStore.activeSnap' }, '$target.id'] },
                  then: 'accent-muted',
                  else: 'transparent',
                },
              },
              opacity: {
                $if: { condition: { $eq: [{ $store: 'shellStore.activeSnap' }, '$target.id'] }, then: 0.9, else: 0.5 },
              },
            },
          },
        ],
      },
    },
  };
}

/**
 * Every edge and corner you can pull, for a floating panel; the one that faces the content, for a
 * panel that displaces it.
 *
 * A floating panel takes room from nothing, so all four sides are free to move and the corners move
 * two at once — which is what a window does, and what people try before they try anything else. A
 * displacing panel spans its edge by definition: three of its sides are pinned to the region and only
 * the inner one is a size at all, so it gets exactly one handle and the geometry hands back only that
 * side (see `handleX` / `handleY`).
 *
 * The corners are `we-move-handle`s rather than resize handles, because a corner is a two-axis drag
 * and `we-resize-handle` reports one number along one axis. Same gesture, same pointer capture; only
 * the arithmetic at the other end differs.
 */
function grips(id: string): SchemaNode[] {
  const geo = (field: string) => ({ $store: dockGeometryPath(id, field) });
  const floating = geo('floating');

  const edges: SchemaNode[] = (['left', 'right', 'top', 'bottom'] as const).map((side) => ({
    type: '$if',
    props: {
      // Shown when the panel floats, or when this is the single side a displacing panel can trade.
      condition: { $or: [floating, { $eq: [geo(side === 'left' || side === 'right' ? 'handleX' : 'handleY'), side] }] },
      then: resizeEdge(id, side),
    },
  }));

  const corners: SchemaNode[] = (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => ({
    type: '$if',
    props: { condition: floating, then: resizeCorner(id, corner) },
  }));

  return [...edges, ...corners];
}

/** One side, dragged along its own axis. */
function resizeEdge(id: string, side: 'left' | 'right' | 'top' | 'bottom'): SchemaNode {
  const vertical = side === 'left' || side === 'right';
  const geo = (field: string) => ({ $store: dockGeometryPath(id, field) });

  return {
    type: 'we-resize-handle',
    props: {
      orientation: vertical ? 'vertical' : 'horizontal',
      // Flush with the panel's own border, so dragging thickens the line that is already there
      // rather than revealing a second one a few pixels inside it.
      align: side === 'left' || side === 'top' ? 'start' : 'end',
      /*
        A line to thicken only where there is a boundary to thicken.

        A displacing panel's edge *is* the seam between it and the content it pushed aside, and the
        3px bar under the pointer reads as that seam answering. A floating panel has no seam — the bar
        becomes a coloured stripe stuck to the side of a card, and it disagrees with the corner grips,
        which draw nothing and feel cleaner for it. The cursor is the affordance there, as it is for
        every window corner anybody has dragged. Keyboard focus still shows: see `line` on the
        primitive.
      */
      line: { $if: { condition: geo('floating'), then: 'none', else: 'auto' } },
      styles: { '--we-resize-handle-thickness': '3px' },
      position: 'absolute',
      zIndex: 'sticky',
      // Pinned to its own side and stretched along the other axis, so one node serves all four.
      ...(vertical
        ? { top: '0', bottom: '0', [side]: '0', width: '8px' }
        : { left: '0', right: '0', [side]: '0', height: '8px' }),
      onResizestart: { $action: 'shellStore.beginDockResize', args: [id] },
      onResize: {
        $action: 'shellStore.resizeDock',
        // The axis this side does not own is passed as zero rather than omitted: one action signature
        // serves edges and corners, and an edge simply contributes nothing on the axis it is pinned to.
        args: vertical ? [id, side, '$arg.detail.delta', 0] : [id, side, 0, '$arg.detail.delta'],
      },
      onResizeend: { $action: 'shellStore.endDockResize' },
    },
  };
}

/** One corner, dragged in both axes at once. */
function resizeCorner(id: string, corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): SchemaNode {
  const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];

  return {
    type: 'we-move-handle',
    props: {
      position: 'absolute',
      zIndex: 'sticky',
      width: '14px',
      height: '14px',
      [vertical]: '0',
      [horizontal]: '0',
      label: `Resize from the ${corner.replace('-', ' ')}`,
      // Diagonal both ways, so the cursor names the axis pair rather than a direction of travel.
      styles: { cursor: corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize' },
      onMovestart: { $action: 'shellStore.beginDockResize', args: [id] },
      onMove: { $action: 'shellStore.resizeDock', args: [id, corner, '$arg.detail.dx', '$arg.detail.dy'] },
      onMoveend: { $action: 'shellStore.endDockResize' },
    },
    // No glyph: a corner grip is read from the cursor and from the corner it sits in, and a visible
    // handle in all four corners of a video tile is four things covering the picture.
    children: [{ type: 'Column' }],
  };
}
