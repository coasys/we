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
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { SnapPoint } from '../dockGeometry';
import { createRegistry } from './createRegistry';

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
  /**
   * The close button's action, written out, for a dock whose close cannot be named as a member.
   *
   * A module names a method and the titlebar builds `<store>.<method>`. That works because a module
   * store *has* that member; a **template panel's** does not. Its keys are minted per panel
   * (`close:extraction`) into `hostDockStores`, which is where the shell reads `edge`/`size`/`float`
   * from in TypeScript — but the close button is rendered as a schema `$action`, and the renderer
   * resolves `shellStore` to the real store surface, where no such member exists. So the button
   * rendered, took the click, and logged `method "close:extraction" not found on store "shellStore"`:
   * an authored panel could not be closed at all.
   *
   * A whole handler rather than another key, because the answer needs an argument — one real method
   * taking the panel's id, rather than a synthetic member per panel that the template surface could
   * never classify.
   */
  closeAction?: SchemaProp;
  /**
   * What to call the panel where its name has to fit on a tab.
   *
   * A template panel carries its declared `title`; a module's dock has none, so `dockTitle` makes
   * one from its `name`. Only read when the panel shares a seat — a panel alone names itself inside
   * its own content, as every module's does.
   */
  title?: string;
}

/** A tab's label for a dock: its title, else its name made readable, else its module. */
export function dockTitle(entry: DockEntry): string {
  if (entry.title) return entry.title;
  const raw = entry.name ?? entry.moduleId;
  const words = raw
    .replace(/[-_:]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
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

/**
 * Fixed chrome the host or a template is painting, that floating panels must clear.
 *
 * The sibling of `hostDockStores`, and it exists for the same reason: `moduleChrome` sums
 * `chromeReserve` off every module store, and the app's own chrome is not a module. A shell template
 * pinning a nav strip has exactly the problem the call bar has — a panel snapped to that corner
 * opens underneath it — and no store to publish from, because a template is data.
 *
 * Keyed so a re-register replaces rather than accumulates: the same template re-rendering must not
 * reserve its band twice.
 */
export const hostChromeReserves: Record<string, { top?: number; bottom?: number; width?: number }> = {};

/** Publish fixed chrome for panels to clear. Pass `undefined` to withdraw it. */
export function registerHostChromeReserve(
  id: string,
  reserve: { top?: number; bottom?: number; width?: number } | undefined,
): void {
  if (reserve) hostChromeReserves[id] = reserve;
  else delete hostChromeReserves[id];
  registry.announce();
}

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
 * The change channel used to live here, hand-rolled; `createRegistry` carries it now, for every
 * registry, which is why the side tables above announce through the registry rather than through a
 * listener set of their own.
 */
const registry = createRegistry<DockEntry>();

/** Subscribe to registration changes. Returns an unsubscribe. */
export const onDockRegistryChanged = registry.subscribe;

/** Publish a host store the dock entries can name — see `hostDockStores`. */
export function registerHostDockStore(id: string, store: Record<string, unknown>): void {
  hostDockStores[id] = store;
  registry.announce();
}

export function unregisterHostDockStore(id: string): void {
  delete hostDockStores[id];
  registry.announce();
}

export const dockRegistry = {
  register: registry.register,
  remove: registry.remove,
  get: registry.get,
  /**
   * Every dock, in a stable order — declared `order` then id, the registry's default. Without the
   * tiebreak registration order leaks into layout and two docks on the same edge swap places
   * depending on which module loaded first.
   */
  ordered: registry.ordered,
};

/**
 * The store path a dock's geometry is published at.
 *
 * Built here rather than in the shell store so the two ends cannot drift — the memo that writes the
 * geometry and the schema node that reads it derive their key from the same function.
 */
export function dockGeometryPath(id: string, field: string): string {
  // By index, not by member: a dock id holds a colon (`call:0`, `editor:code`), which no identifier can.
  return `shellStore.dockGeometry['${id}'].${field}`;
}

/**
 * Wrap a panel in the box the host has decided it occupies, and in the controls that move it.
 *
 * Every geometric prop is a store reference rather than a literal, which is what keeps a panel
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
const isGlass = (id: string) => `${dockGeometryPath(id, 'floating')} && !${dockGeometryPath(id, 'maximised')}`;

/*
  Frosted glass is a theme's decision, and it already has the vocabulary for it.

  `surfaceOpacity` and `surfaceBlur` are theme overrides that resolve to `--we-theme-surface-opacity`
  and `--we-theme-surface-blur`, and the expression below is the one `Card` and every overlay
  primitive — modal, drawer, popover — already use, down to `in srgb`. A panel writing its own
  numbers would be the one surface in the app that ignored a theme asking for more glass or less.

  `color-mix` toward `transparent` rather than an `opacity` on the box: opacity fades the panel's
  *contents* along with its background, so the text would go with it. This fades only what is
  painted behind them.

  The fallbacks are where a panel differs from a card, and deliberately. A theme that says nothing
  leaves cards and modals opaque — `var(--we-theme-surface-blur, 0px)` — because most surfaces sit
  *in* a page rather than over one, and glass on all of them by default would be a look nobody
  chose. A floating panel is the opposite case: it is chrome laid over the app, and being able to
  see what it covers is the point of it floating rather than displacing. So it defaults to glass and
  a theme still overrules it, in either direction.
*/
const PANEL_OPACITY = '0.3';
const PANEL_BLUR_PX = '12px';

const glassBg = (role: string) =>
  `color-mix(in srgb, var(--we-role-${role}) calc(var(--we-theme-surface-opacity, ${PANEL_OPACITY}) * 100%), transparent)`;

const GLASS_BLUR = `blur(var(--we-theme-surface-blur, ${PANEL_BLUR_PX}))`;

export function dockFrame(entry: DockEntry, node: SchemaNode): SchemaNode {
  const geo = (field: string) => ({ $: dockGeometryPath(entry.id, field) });
  const glass = isGlass(entry.id);

  return {
    type: 'Column',
    // Transparent: both children position themselves, and a box around them would be one more thing
    // in the flow for no reason.
    props: { styles: { display: 'contents' } },
    children: [
      snapTargets(entry.id),
      insertLines(entry.id),
      laneDivider(entry.id),
      {
        type: '$if',
        props: {
          // Open, and not at home in the template — a section at its outlet is rendered there by
          // `PanelLane`, and a frame for it here would be a second copy.
          condition: { $: `${dockGeometryPath(entry.id, 'edge')} && !${dockGeometryPath(entry.id, 'home')}` },
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
              /*
                The panel's own surface. A module's node fills it and need not paint a background, a
                border or a radius of its own — which is what stops two docked modules from looking
                like two different applications.

                Translucent while it is a card, so the app stays visible behind it and the panel
                reads as being *over* something rather than as a hole cut in the window. The theme
                owns how far — see `glassBg` — and `isGlass` owns when.

                **`page`, and not `surface-sunken`.** It was sunken, and that is `page` minus
                lightness — the role for a *well recessed into* a surface, which is what an input
                trough or a code block is. So every docked panel came out darker than the page it
                sits beside, and read as a hole cut in the window rather than as part of it.

                `surface` and `surface-raised` were tried in between and are both too light: they are
                `page` *plus* lightness, which is the relationship a card wants when it sits **on**
                the page with the page still visible around it. A docked panel has no page showing
                around it — it either abuts the content or covers it — so lifting it off a
                background nobody can see just makes it paler than everything near it.

                A panel is the app's own ground, extended. Same role, and the frame's border is what
                separates it from the content beside it. Note this makes the panel body and its
                titlebar the same colour, which is deliberate: the bar's bottom border is the line
                between them, so a panel reads as one surface rather than as a header stuck on a box.
              */
              bg: { $: `${glass} ? '${glassBg('page')}' : 'page'` },
              // Backdrop blur belongs with the transparency and goes when it does: it is expensive,
              // it makes the element a containing block for fixed descendants, and over an opaque
              // background it would cost both of those for nothing visible.
              styles: {
                'backdrop-filter': { $: `${glass} ? '${GLASS_BLUR}' : 'none'` },
                /*
                  Gone while another tab in its seat is showing — gone, not unmounted. A call in a
                  background tab keeps its streams; a transcript keeps its scroll. `styles` so it
                  overrides the Column's own `display: flex`.
                */
                display: { $: `${dockGeometryPath(entry.id, 'hidden')} ? 'none' : 'flex'` },
              },
              border: '1px solid border',
              // Rounded and lifted only while floating. A card over the app should read as being on
              // top; a panel that has taken room *from* the app meets it edge to edge, where a radius
              // would leave slivers of background in the corners and a shadow would fall on content
              // that is beside it rather than beneath it.
              r: { $: `${dockGeometryPath(entry.id, 'floating')} ? '500' : null` },
              shadow: { $: `${dockGeometryPath(entry.id, 'floating')} ? 'xl' : null` },
              overflow: 'hidden',
              /*
                A step on the `sticky` band, not the band itself.

                Every frame was `zIndex: 'sticky'`, so two overlapping panels were ordered by document
                order — the registry's — and nothing a person did could change it: maximise a panel
                and anything registered after it went on painting over the top. The geometry hands
                each panel its own step by how recently it was touched (`layerOrder`), and touching is
                the pointer landing anywhere on the frame.
              */
              zIndex: geo('layer'),
              onPointerdown: { $action: 'shellStore.raiseDock', args: [entry.id] },
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
                  /*
                    The frame's shape, published for anything inside that needs to hug it.

                    A `we-drop-zone` filling a panel — the Pocket is one — draws its ring inset to
                    its own bounds, and its own bounds are square. Inside a frame with a 16px radius
                    and `overflow: hidden`, that ring loses its bottom corners exactly where the
                    curve is. The frame is the only thing that knows its own radius, and it changes
                    with the placement, so it says so rather than leaving every module to guess.

                    Only the bottom corners are ever curved here — the titlebar has the top two —
                    but a single radius is right anyway: the ring's top corners sit under the bar
                    and are not visible to be wrong.
                  */
                  styles: {
                    '--we-drop-zone-radius': {
                      $: `${dockGeometryPath(entry.id, 'floating')} ? 'var(--we-radius-500)' : '0px'`,
                    },
                    /*
                      Hidden while folded — hidden, never unmounted. A collapsed transcript keeps its
                      scroll and a collapsed call keeps its streams, which is the whole difference
                      between folding a panel and closing it. Here rather than as a DS prop because
                      it has to override the Column's own `display: flex`, and `styles` is applied
                      last.
                    */
                    display: { $: `${dockGeometryPath(entry.id, 'collapsed')} ? 'none' : 'flex'` },
                  },
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
    props: { condition: { $: `!shellStore.dockPlacement['${id}'].maximised` }, then: node },
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
        whole panel. It composites over the frame's own translucency, so it always lands more solid
        than the body it labels — about half at the default 0.3, and still the same way round at
        whatever the theme sets, which is the right way round for the part you grab.
      */
      bg: { $: `${isGlass(entry.id)} ? '${glassBg('page')}' : 'page'` },
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
      tabStrip(entry.id),
      {
        type: 'we-move-handle',
        props: {
          flex: '1',
          height: '100%',
          label: 'Move panel',
          // `onXxx`, not `on:xxx`: the schema renderer recognises an event prop by a capital after
          // "on" and Solid lowercases the rest, so these bind `movestart`, `move` and `moveend`.
          onMovestart: {
            $action: 'shellStore.beginDockMove',
            args: [entry.id, { $: 'arg.detail.x' }, { $: 'arg.detail.y' }],
          },
          onMove: { $action: 'shellStore.moveDock', args: [entry.id, { $: 'arg.detail.dx' }, { $: 'arg.detail.dy' }] },
          onMoveend: { $action: 'shellStore.endDockMove', args: [entry.id] },
        },
      },
      ...(entry.aspect ? [whileRestored(entry.id, fitButton(entry.id))] : []),
      whileRestored(entry.id, collapseButton(entry.id)),
      whileRestored(entry.id, displaceButton(entry.id)),
      maximiseButton(entry.id),
      whileRestored(entry.id, positionMenu(entry)),
      // Last, and after the menu: the one control whose consequence cannot be undone by clicking it
      // again wants to be the one furthest from the others.
      ...(entry.close || entry.closeAction ? [closeButton(entry)] : []),
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
/**
 * The seat's members, as a strip on the titlebar of the one showing.
 *
 * Nothing for a seat of one, which is most panels. For a shared seat: one small button per member,
 * the showing one marked, each a `raiseDock` — bringing a tab forward is the same act as bringing a
 * float to the front, and it is decided the same way. Before the grip rather than after the
 * controls, because that is where every tab strip anybody has used puts it.
 */
function tabStrip(id: string): SchemaNode {
  const tabs = dockGeometryPath(id, 'tabs');
  return {
    type: '$if',
    props: {
      condition: { $: `count(${tabs}) > 1` },
      then: {
        type: 'Row',
        props: { gap: '100', ay: 'center', flex: '0 0 auto', pr: '100' },
        children: [
          {
            type: '$each',
            props: { items: { $: tabs }, as: 'tab' },
            children: [
              {
                type: 'we-button',
                props: {
                  size: 'xs',
                  variant: { $: "tab.active ? 'secondary' : 'ghost'" },
                  onClick: { $action: 'shellStore.raiseDock', args: [{ $: 'tab.id' }] },
                },
                children: [
                  { type: 'we-text', props: { truncate: true, maxWidth: '120px' }, children: [{ $: 'tab.title' }] },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Fold the panel to its titlebar, or open it again.
 *
 * The way a panel gets out of the way without going anywhere: it keeps its place in its lane and its
 * lane-mates take the room, and the content is hidden rather than unmounted. Greyed rather than
 * absent where there is nowhere for that room to go, for the reason the displace toggle is greyed on
 * a corner — the control stays where people look for it, and says why it cannot be pressed. See
 * `canFold` for when that is.
 */
function collapseButton(id: string): SchemaNode {
  const place = (field: string) => `shellStore.dockPlacement['${id}'].${field}`;

  return {
    type: 'we-tooltip',
    props: {
      // The refusal names the condition rather than the state, as the displace toggle's does: there
      // has to be somewhere for the room to go, and beside it is the only direction it can go.
      title: {
        $: `${place('canCollapse')} ? (${place('collapsed')} ? 'Unfold' : 'Fold to titlebar') : 'Open a panel beside this one to fold'`,
      },
      placement: 'bottom',
    },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'xs',
          square: true,
          variant: { $: `${place('collapsed')} ? 'secondary' : 'ghost'` },
          disabled: { $: `!${place('canCollapse')}` },
          onClick: { $action: 'shellStore.toggleCollapseDock', args: [id] },
        },
        children: [{ type: 'we-icon', props: { name: { $: `${place('collapsed')} ? 'caret-down' : 'caret-up'` } } }],
      },
    ],
  };
}

function displaceButton(id: string): SchemaNode {
  const place = (field: string) => `shellStore.dockPlacement['${id}'].${field}`;

  return {
    type: 'we-tooltip',
    props: {
      title: { $: `${place('canDisplace')} ? 'Push content aside' : 'Snap to an edge to push content aside'` },
      placement: 'bottom',
    },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'xs',
          square: true,
          variant: { $: `${place('displace')} ? 'secondary' : 'ghost'` },
          disabled: { $: `!${place('canDisplace')}` },
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
  const maximised = `shellStore.dockPlacement['${id}'].maximised`;

  return {
    type: 'we-tooltip',
    props: {
      title: { $: `${maximised} ? 'Exit full screen' : 'Full screen'` },
      placement: 'bottom',
    },
    children: [
      {
        type: 'we-button',
        props: {
          size: 'xs',
          square: true,
          variant: { $: `${maximised} ? 'secondary' : 'ghost'` },
          onClick: { $action: 'shellStore.toggleMaximiseDock', args: [id] },
        },
        children: [
          {
            type: 'we-icon',
            props: { name: { $: `${maximised} ? 'arrows-in' : 'arrows-out'` } },
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
  // A written-out handler wins, for a dock whose close takes an argument — see `closeAction`.
  const onClick = entry.closeAction ?? { $action: `${store}.${entry.close}` };

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
          onClick,
        },
        children: [{ type: 'we-icon', props: { name: 'x' } }],
      },
    ],
  };
}

function positionMenu(entry: DockEntry): SchemaNode {
  const id = entry.id;
  const place = (field: string) => `shellStore.dockPlacement['${id}'].${field}`;

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
    checked: { $: `${place('snap')} == '${opts.snap}'` },
    onToggle: { $action: 'shellStore.snapDock', args: [id, opts.snap] },
  });

  return {
    type: 'DropdownMenu',
    props: {
      triggerIcon: 'dots-three',
      /*
        One of the row, not the row's only filled thing.

        The four controls beside it are `xs` ghost squares, and this drew `DropdownMenu`'s own
        trigger: a filled pill, because without `square` the size's horizontal padding still
        applies, and one that hovered to the accent, because the component overrode the fill of the
        `primary` variant and not its hover. Asking for `ghost` is enough now — icon-only is
        inferred from an icon with no label, and brings the square with it.
      */
      triggerVariant: 'ghost',
      // The tooltip its four neighbours all have. A `dots-three` chip says nothing about its
      // subject, and this one's subject is the whole of what the menu does.
      triggerTitle: 'Position',
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
        /*
          The way back to the arrangement the interface designed.

          Only when there is one to go back to and the panel has actually been moved away from it —
          `layoutPinned` is both of those. Otherwise this is a control that would do nothing, which
          is what `fitButton` is absent for on a module publishing no aspect.

          First in the list, and separated: it undoes a position rather than choosing one, so
          grouping it with the eight would read as a ninth place to put the panel.
        */
        /*
          The way back into the template, for a section that has a place there.

          Before the reset, because it is the more specific answer: a section broken out of a
          sidebar and dragged around is put back by this, and "Reset to layout" would do the same
          and also forget its size. Only for a panel with a `home` — an ordinary panel has no page
          to return to, and the item would be a control that does nothing.
        */
        {
          id: 'home',
          label: 'Return to page',
          icon: 'arrow-square-in',
          disabled: { $: `!${place('home')} || ${place('snap')} == 'home'` },
          onAction: { $action: 'shellStore.returnHome', args: [entry.id.replace(/^template:/, '')] },
        },
        {
          id: 'reset',
          label: 'Reset to layout',
          icon: 'arrow-counter-clockwise',
          // Disabled rather than hidden, for the reason `displaceButton` is: a control that vanishes
          // when you move a panel is one you stop looking for, and the disabled state carries the
          // actual rule — there is a layout to go back to, and you are not on it.
          disabled: { $: `!shellStore.layoutPinned['${id}']` },
          onAction: { $action: 'shellStore.resetDockToLayout', args: [id] },
        },
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
// The store builds the key, and the frame only ever compares it. It names four things now — the
// axis, the edge, the lane and the position along it — and rebuilding that here would be a second
// spelling of one identity, for the two to disagree about the day a fifth is added.
const INSERT_IS_ACTIVE = 'shellStore.activeInsert == slot.key';

function insertLines(id: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `shellStore.movingDock == '${id}'` },
      then: {
        type: '$each',
        props: { items: { $: 'shellStore.insertSlots' }, as: 'slot' },
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
              top: { $: 'slot.top' },
              left: { $: 'slot.left' },
              width: { $: 'slot.width' },
              height: { $: 'slot.height' },
              // A seam is a line; a seat is a box. The box is a filled region rather than an outline
              // because what it means is "into this", and a wash over a panel reads as that.
              r: { $: "slot.mode == 'tab' ? '500' : 'pill'" },
              // The drag is a pointer capture on the grip; a target that could swallow a pointer event
              // would end the drag it exists to guide.
              pointerEvents: 'none',
              // Above every panel, for the reason the snap targets are — see there.
              zIndex: 'chrome',
              bg: { $: `${INSERT_IS_ACTIVE} ? 'accent' : 'surface-active'` },
              opacity: {
                $: `${INSERT_IS_ACTIVE} ? (slot.mode == 'tab' ? 0.35 : 1) : (slot.mode == 'tab' ? 0.1 : 0.4)`,
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
const SNAP_IS_ACTIVE = 'shellStore.activeSnap == target.id';

function snapTargets(id: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $: `shellStore.movingDock == '${id}'` },
      then: {
        type: '$each',
        props: { items: { $: 'shellStore.snapTargets' }, as: 'target' },
        children: [
          {
            type: 'Column',
            props: {
              position: 'fixed',
              top: { $: 'target.top' },
              left: { $: 'target.left' },
              width: { $: 'target.width' },
              height: { $: 'target.height' },
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
              border: { $: `${SNAP_IS_ACTIVE} ? '2px solid primary-500' : '2px dashed neutral-300'` },
              bg: { $: `${SNAP_IS_ACTIVE} ? 'accent-muted' : 'transparent'` },
              opacity: { $: `${SNAP_IS_ACTIVE} ? 0.9 : 0.5` },
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
  const geo = (field: string) => dockGeometryPath(id, field);
  /*
    A maximised panel has no grips, and saying so takes a conjunction rather than reading `floating`.

    The geometry already says it — `handleX` and `handleY` are both absent, which is the docstring's
    "there is nothing left to give it" — but the maximised box also reports `floating: true`, which it
    has to: `floating` is what draws the radius, the shadow and the glass. So every edge matched the
    `$or` below and every corner matched outright, and a maximised panel drew all eight.

    They were not inert. `resizeDock` reads the same flag to decide what a drag means, took the
    floating arm, and wrote the rect it measured — the whole window — over the card's `w`/`h`. The
    panel looked unchanged, because the maximised branch resolves ahead of the placement; the size it
    would restore to was gone, and for a panel whose dock thickness falls back to the card, so was the
    size it would dock at.
  */
  const grippable = `!${geo('maximised')} && ${geo('floating')}`;

  /*
    A boundary in a lane belongs to both panels, so neither of them draws it.

    Stacked, the later panel's leading edge and the earlier one's trailing edge are the same line a
    few pixels apart — two grips for one boundary, each resizing only its own panel, which is why
    pulling it felt like neither. Both are suppressed, and `laneDivider` draws the seam from outside
    both frames (see there for why it cannot be drawn from inside either).

    Which sides those are comes from `laneAxis`, because it depends on the edge: a lane down the left
    divides the height, so the pair meet top-to-bottom; a lane across the top divides the width, so
    they meet left-to-right. It was the bottom either way, which drew a horizontal grip between two
    panels sitting side by side and wrote a height that arrangement does not read.
  */
  const alongLane = (axis: 'vertical' | 'horizontal') => `${geo('laneAxis')} == '${axis}'`;
  // The side of a panel that faces the *next* panel in its lane: down a vertical lane, rightward
  // along a horizontal one. The opposite side faces the previous one.
  const trailing = { vertical: 'bottom', horizontal: 'right' } as const;

  const edges: SchemaNode[] = (['left', 'right', 'top', 'bottom'] as const).map((side) => {
    const shown = `(${grippable}) || ${geo(side === 'left' || side === 'right' ? 'handleX' : 'handleY')} == '${side}'`;
    const axis = side === 'top' || side === 'bottom' ? 'vertical' : 'horizontal';
    // Suppressed only when this side really is a seam — a panel with a lane-mate on the other axis
    // keeps every grip it had.
    const seam = side === trailing[axis] ? geo('below') : geo('above');
    return {
      type: '$if',
      props: { condition: { $: `(${shown}) && !(${seam} && ${alongLane(axis)})` }, then: resizeEdge(id, side) },
    };
  });

  const corners: SchemaNode[] = (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => ({
    type: '$if',
    props: { condition: { $: grippable }, then: resizeCorner(id, corner) },
  }));

  return [...edges, ...corners];
}

/** One side, dragged along its own axis. */
function resizeEdge(id: string, side: 'left' | 'right' | 'top' | 'bottom'): SchemaNode {
  const vertical = side === 'left' || side === 'right';

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
      line: { $: `${dockGeometryPath(id, 'floating')} ? 'none' : 'auto'` },
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
        // The axis this side does not own is passed as zero rather than omitted: one action
        // signature serves edges and corners, and an edge contributes nothing on its own axis.
        args: vertical ? [id, side, { $: 'arg.detail.delta' }, 0] : [id, side, 0, { $: 'arg.detail.delta' }],
      },
      onResizeend: { $action: 'shellStore.endDockResize' },
    },
  };
}

/**
 * The divider between this panel and the next one in its lane — drawn over the seam, from outside
 * both frames.
 *
 * It was a grip inside the earlier panel's frame, straddling its bottom edge by six pixels so that
 * it would sit on the boundary. The frame is `overflow: hidden`, so the outer half was clipped: what
 * was left was 6px of `row-resize` inside the panel, then the 8px gap belonging to nobody, then
 * `grab` on the next panel's titlebar — and the accent line, aligned to the handle's outer end, was
 * entirely in the clipped region and never drew. The affordance the whole thing was for did not
 * render.
 *
 * A seam is a property of the pair, not of either panel, so it is drawn where the drag guides are:
 * in the frame's wrapper, outside the clipped box, at the box the geometry publishes. Fixed rather
 * than absolute, on the chrome layer, because it has to sit over both panels whatever their own
 * layers are.
 */
function laneDivider(id: string): SchemaNode {
  const geo = (field: string) => ({ $: dockGeometryPath(id, field) });
  return {
    type: '$if',
    props: {
      condition: { $: `${dockGeometryPath(id, 'below')} && ${dockGeometryPath(id, 'seam')}` },
      then: {
        type: 'we-resize-handle',
        props: {
          // A vertical lane's seam is a horizontal line, and a horizontal handle is one dragged up
          // and down — the primitive names the bar, not the drag.
          orientation: { $: `${dockGeometryPath(id, 'laneAxis')} == 'vertical' ? 'horizontal' : 'vertical'` },
          align: 'center',
          // Always drawn: a seam between two panels is a real boundary, and the 3px bar answering
          // under the pointer is what a splitter looks like everywhere else.
          line: 'auto',
          styles: { '--we-resize-handle-thickness': '3px' },
          position: 'fixed',
          // Above the two panels it divides, and still under the app's own chrome — see `seamLayer`.
          zIndex: geo('seamLayer'),
          top: geo('seam.top'),
          left: geo('seam.left'),
          width: geo('seam.width'),
          height: geo('seam.height'),
          onResizestart: { $action: 'shellStore.beginDockResize', args: [id] },
          onResize: { $action: 'shellStore.resizeColumn', args: [id, { $: 'arg.detail.delta' }] },
          onResizeend: { $action: 'shellStore.endDockResize' },
        },
      },
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
      onMove: { $action: 'shellStore.resizeDock', args: [id, corner, { $: 'arg.detail.dx' }, { $: 'arg.detail.dy' }] },
      onMoveend: { $action: 'shellStore.endDockResize' },
    },
    // No glyph: a corner grip is read from the cursor and from the corner it sits in, and a visible
    // handle in all four corners of a video tile is four things covering the picture.
    children: [{ type: 'Column' }],
  };
}
