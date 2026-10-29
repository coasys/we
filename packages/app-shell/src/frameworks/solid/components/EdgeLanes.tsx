/**
 * The lanes at the window's edges — a sidebar of panels pushing the content aside, the way a
 * template's lane (`PanelLane`) is a column of them inside a page.
 *
 * Each edge holds its lanes side by side, outboard first; each lane its seats along it, divided by
 * flex — `grow 1 base`, never below the floor — which is the division the geometry engine works out
 * for the same seats (`columnLayout`), from the same numbers (`laneBase`). A seat is a group
 * (`PanelGroup`): its panels' frames filling it, one showing and the rest hidden behind it as tabs. How thick a lane
 * is stays the engine's answer (`displacingLanes`), because it is also how far the content moves.
 *
 * Cards snapped to an edge, two seats of them or more, are a lane too — over the content rather than
 * beside it, each card keeping its own width (`CoverOf`).
 *
 * The lanes and their seats are keyed by name, never rebuilt by a recount: a frame is redrawn only
 * when its panel changes seat. Its content is the panel host's and moves with it (`PanelHost`).
 *
 * ## The lane's own controls
 *
 * What belongs to the lane rather than to any one panel in it is drawn by the lane: the grip between
 * two seats (`Divider`), the grip on a lane's inner edge for its thickness (`InnerEdge`), and the strip
 * a stowed lane becomes (`StowStrip`). They used to be drawn over the window at boxes the geometry
 * engine published, from outside every frame because a boundary several frames share is no one
 * frame's to draw; inside the lane they are simply where the boundary is.
 *
 * The drop targets are still measured from the engine's boxes — the same division, so they land on
 * the seams the flex makes.
 */
import { COLLAPSED_PX, DOCK_GAP_PX, EDGES, PANEL_LAYER_BASE, SEAM_PX } from '@shared/dockGeometry';
import { dockRegistry, dockTitle, STOW_ICONS } from '@shared/registries/dockRegistry';
import { weProps } from '@we/design-utils/solid';
import type { DockEdge } from '@we/module-shared';
import { createMemo, For, Index, Show } from 'solid-js';

import { type EdgeLane, type EdgeSeat, useShellStore } from '../stores/ShellStore';
import { PanelGroup } from './PanelGroup';

type Edge = Exclude<DockEdge, null>;

const sameStrings = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Outboard first: away from the edge each lane is against. */
const OUTWARD: Record<Edge, 'row' | 'row-reverse' | 'column' | 'column-reverse'> = {
  left: 'row',
  right: 'row-reverse',
  top: 'column',
  bottom: 'column-reverse',
};

const px = (value: number | undefined) => (value === undefined ? undefined : `${value}px`);

/** The side of a lane facing the content — the one its thickness is dragged from. */
const INBOARD: Record<Edge, Edge> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** The seat's panel that is showing — the one its grips act for. */
function showing(seat: EdgeSeat | undefined, geometry: ReturnType<ReturnType<typeof useShellStore>['dockGeometry']>) {
  return seat?.ids.find((id) => !geometry[id]?.hidden) ?? seat?.ids[0];
}

function Seat(props: { seat: () => EdgeSeat | undefined; edge: Edge }) {
  const vertical = props.edge === 'left' || props.edge === 'right';
  const ids = createMemo(() => props.seat()?.ids ?? [], [], { equals: sameStrings });
  /*
    Folded across a top or bottom lane, a seat is its titlebar against the edge rather than a band of
    the lane's whole thickness — the room below it is the lane's until every seat has folded. Down a
    side a fold is the seat's own share of the lane, which `laneBase` already makes a titlebar's.
  */
  const bar = () => !vertical && props.seat()?.folded;
  return (
    <PanelGroup
      members={ids()}
      style={{
        position: 'relative',
        flex: `${props.seat()?.grow ?? 1} 1 ${px(props.seat()?.base ?? 0)}`,
        'min-height': vertical ? px(props.seat()?.floor ?? 0) : undefined,
        'min-width': vertical ? undefined : px(props.seat()?.floor ?? 0),
        ...(bar() ? { height: px(COLLAPSED_PX), 'align-self': props.edge === 'top' ? 'flex-start' : 'flex-end' } : {}),
        // A card over the content keeps its own size across its lane — see `coveringLanes`.
        width: vertical && props.seat()?.cross !== undefined ? px(props.seat()?.cross) : undefined,
        height: !vertical && props.seat()?.cross !== undefined ? px(props.seat()?.cross) : undefined,
      }}
    />
  );
}

/**
 * The grip between a seat and the next: dragged, it moves the boundary between them (`resizeColumn`).
 * A box of no size along the lane — or the gap between cards, over the content — with the grip
 * straddling it, so the line it draws is the boundary itself.
 */
function Divider(props: { above: () => string | undefined; edge: Edge; gap: number }) {
  const shellStore = useShellStore();
  const vertical = props.edge === 'left' || props.edge === 'right';
  return (
    <div
      style={{
        position: 'relative',
        flex: 'none',
        // Across the whole lane, whatever its cards are aligned to: over the content they keep to the
        // edge (`align-items: flex-end`), and a divider that did too had no width to be grabbed by.
        'align-self': 'stretch',
        height: vertical ? px(props.gap) : undefined,
        width: vertical ? undefined : px(props.gap),
      }}
    >
      <we-resize-handle
        data-we-lane-divider=""
        // A seam across a column is a horizontal bar, dragged up and down — the primitive names the bar.
        orientation={vertical ? 'horizontal' : 'vertical'}
        align="center"
        line="auto"
        style={{
          position: 'absolute',
          'z-index': 2,
          'pointer-events': 'auto',
          '--we-resize-handle-thickness': '3px',
          ...(vertical
            ? { left: '0', right: '0', top: `calc(50% - ${SEAM_PX / 2}px)`, height: px(SEAM_PX) }
            : { top: '0', bottom: '0', left: `calc(50% - ${SEAM_PX / 2}px)`, width: px(SEAM_PX) }),
        }}
        on:resizestart={() => {
          const id = props.above();
          if (id) shellStore.beginDockResize(id);
        }}
        on:resize={(event: CustomEvent<{ delta: number }>) => {
          const id = props.above();
          if (id) shellStore.resizeColumn(id, event.detail.delta);
        }}
        on:resizeend={() => shellStore.endDockResize()}
      />
    </div>
  );
}

/**
 * The grip on a lane's inner edge: its thickness against the content, which every panel in it shares
 * (`resizeDock` on the lane's first panel — each resolves to the same thickness). Dragged far enough
 * back towards the edge, the lane is put away — see `STOW_DRAG_PX`.
 */
function InnerEdge(props: { first: () => string | undefined; edge: Edge }) {
  const shellStore = useShellStore();
  const side = INBOARD[props.edge];
  const across = side === 'left' || side === 'right';
  return (
    <we-resize-handle
      data-we-lane-edge=""
      // A lane down a side is dragged left and right: a vertical bar.
      orientation={across ? 'vertical' : 'horizontal'}
      // Flush with the lane's own border, so dragging thickens the line already there.
      align={side === 'left' || side === 'top' ? 'start' : 'end'}
      line="auto"
      style={{
        position: 'absolute',
        'z-index': 2,
        'pointer-events': 'auto',
        '--we-resize-handle-thickness': '3px',
        [side]: '0',
        ...(across ? { top: '0', bottom: '0', width: '8px' } : { left: '0', right: '0', height: '8px' }),
      }}
      on:resizestart={() => {
        const id = props.first();
        if (id) shellStore.beginDockResize(id);
      }}
      on:resize={(event: CustomEvent<{ delta: number }>) => {
        const id = props.first();
        if (id) shellStore.resizeDock(id, side, across ? event.detail.delta : 0, across ? 0 : event.detail.delta);
      }}
      on:resizeend={() => shellStore.endDockResize()}
    />
  );
}

/**
 * The strip a stowed lane becomes: the names of the panels put away, and one way back — the whole
 * strip is the button that opens the lane. A real `<button>`, so it is reachable by keyboard.
 *
 * Beneath the lane's frames, filling the lane, which is the strip's thickness while it is stowed: the
 * panels shrink onto it as they fade, rather than it appearing once they have gone. Faint until pointed
 * at, as a folded bar's name is; vertical text down a side, read top to bottom, as every docking IDE's
 * collapsed tool windows are — `writing-mode` rather than a rotation, which would leave the box the
 * wrong shape.
 */
function StowStrip(props: { lane: () => EdgeLane | undefined; edge: Edge }) {
  const shellStore = useShellStore();
  const vertical = props.edge === 'left' || props.edge === 'right';
  const ids = () => props.lane()?.seats.flatMap((seat) => seat.ids) ?? [];
  const away = () => Boolean(shellStore.dockGeometry()[ids()[0] ?? '']?.awayFaded);
  const title = (id: string) => {
    const entry = dockRegistry.get(id);
    return entry ? dockTitle(entry) : id;
  };
  return (
    <div
      style={{
        position: 'absolute',
        inset: '0',
        'z-index': 0,
        'pointer-events': away() ? 'none' : 'auto',
        background: 'var(--we-role-chrome)',
        border: 'var(--we-border-width, 1px) solid var(--we-role-border)',
        overflow: 'hidden',
        // Fades with its lane's panels when every panel is put away or brought back.
        opacity: away() ? 0 : 1,
        transition: 'opacity var(--we-chrome-transition, 300ms) ease',
      }}
    >
      <we-button
        variant="bare"
        size="xs"
        label="Open"
        {...weProps({ width: '100%', height: '100%', color: 'text-faint', hoverProps: { color: 'text' } })}
        onClick={() => {
          const id = ids()[0];
          if (id) shellStore.toggleStowLane(id);
        }}
      >
        <div
          style={{
            display: 'flex',
            'flex-direction': vertical ? 'column' : 'row',
            'align-items': 'center',
            gap: 'var(--we-space-300)',
            padding: 'var(--we-space-200)',
            width: '100%',
            height: '100%',
          }}
        >
          {/* The way back points away from the edge the lane went to. */}
          <we-icon name={STOW_ICONS[INBOARD[props.edge]].icon} />
          <Index each={ids()}>
            {(id) => (
              <div
                style={{
                  'writing-mode': vertical ? 'vertical-rl' : 'horizontal-tb',
                  'max-height': '180px',
                  'max-width': '180px',
                }}
              >
                <we-text variant="label" truncate>
                  {title(id())}
                </we-text>
              </div>
            )}
          </Index>
        </div>
      </we-button>
    </div>
  );
}

function Lane(props: { lane: () => EdgeLane | undefined; edge: Edge }) {
  const vertical = props.edge === 'left' || props.edge === 'right';
  const shellStore = useShellStore();
  const seatKeys = createMemo(() => props.lane()?.seats.map((seat) => seat.key) ?? [], [], { equals: sameStrings });
  const seatAt = (index: number) => props.lane()?.seats[index];
  const foldedFlat = () => !vertical && (props.lane()?.seats.every((seat) => seat.folded) ?? false);
  // Its grips only while some panel of it is on screen: not while every panel is away, nor while
  // another panel is full screen.
  const shown = () =>
    (props.lane()?.seats ?? []).some(
      (seat) => !shellStore.dockGeometry()[showing(seat, shellStore.dockGeometry()) ?? '']?.hidden,
    );
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        'flex-direction': vertical ? 'column' : 'row',
        flex: 'none',
        width: vertical ? px(props.lane()?.thickness ?? 0) : undefined,
        height: vertical ? undefined : px(props.lane()?.thickness ?? 0),
        overflow: 'hidden',
        /*
          A lane opening out of its strip, or put away to it, eases its thickness — the content beside
          it eases the same distance on the same clock (`--we-chrome-transition`) — and its frames,
          filling it, are uncovered and covered at the size they are laid out at. Instant while a drag
          is live, so the edge tracks the hand.
        */
        transition: shellStore.dockResizing()
          ? 'none'
          : `${vertical ? 'width' : 'height'} var(--we-chrome-transition, 300ms) ease`,
      }}
    >
      <Show when={props.lane()?.stowed && !shellStore.panelMaximised()}>
        <StowStrip lane={props.lane} edge={props.edge} />
      </Show>
      <For each={seatKeys()}>
        {(key, index) => (
          <>
            <Show when={index() > 0 && !props.lane()?.stowed && shown()}>
              <Divider
                above={() => showing(seatAt(index() - 1), shellStore.dockGeometry())}
                edge={props.edge}
                gap={0}
              />
            </Show>
            <Seat seat={() => props.lane()?.seats.find((seat) => seat.key === key)} edge={props.edge} />
          </>
        )}
      </For>
      {/* Not on a lane folded flat along the top or bottom: its thickness is the bars, and a grip
          there would resize a height nothing is showing. */}
      <Show when={!props.lane()?.stowed && !foldedFlat() && shown()}>
        <InnerEdge first={() => showing(props.lane()?.seats[0], shellStore.dockGeometry())} edge={props.edge} />
      </Show>
    </div>
  );
}

function EdgeOf(props: { edge: Edge }) {
  const shellStore = useShellStore();
  const lanes = () => shellStore.edgeLanes().lanes[props.edge];
  const keys = createMemo(() => lanes().map((lane) => lane.key), [], { equals: sameStrings });
  const box = () => shellStore.edgeLanes().boxes[props.edge];
  return (
    <Show when={keys().length > 0}>
      <div
        data-we-edge-lanes={props.edge}
        style={{
          position: 'fixed',
          top: px(box().top),
          right: px(box().right),
          bottom: px(box().bottom),
          left: px(box().left),
          display: 'flex',
          'flex-direction': OUTWARD[props.edge],
          /*
            The lanes' own boxes let the pointer through — a stowed lane's strip is drawn beneath them —
            and each frame takes it back for itself.
          */
          'pointer-events': 'none',
          /*
            Just under the panels' own layers: a card floating over the content stays over a lane, and
            the grips between seats, drawn a layer above the panels they divide, stay over the seams.
          */
          'z-index': PANEL_LAYER_BASE - 1,
        }}
      >
        <For each={keys()}>
          {(key) => <Lane lane={() => lanes().find((lane) => lane.key === key)} edge={props.edge} />}
        </For>
      </div>
    </Show>
  );
}

/**
 * An edge's cards over the content, two seats or more: a lane standing a gap inside the room the
 * displacing lanes leave, its cards a gap apart and against its edge. A lane of one seat is not
 * drawn here — that card stays at its snap.
 */
function CoverOf(props: { edge: Edge }) {
  const shellStore = useShellStore();
  const vertical = props.edge === 'left' || props.edge === 'right';
  const lane = () => shellStore.edgeLanes().covers[props.edge];
  const seatKeys = createMemo(() => lane()?.seats.map((seat) => seat.key) ?? [], [], { equals: sameStrings });
  // As high as its highest card: raising one of them raises the lane.
  const layer = () =>
    Math.max(
      PANEL_LAYER_BASE,
      ...(lane()?.seats.flatMap((seat) => seat.ids) ?? []).map((id) => shellStore.dockGeometry()[id]?.layer ?? 0),
    );
  return (
    <Show when={seatKeys().length > 0}>
      <div
        data-we-edge-cover={props.edge}
        style={{
          position: 'fixed',
          top: px(lane()?.box.top),
          right: px(lane()?.box.right),
          bottom: px(lane()?.box.bottom),
          left: px(lane()?.box.left),
          display: 'flex',
          'flex-direction': vertical ? 'column' : 'row',
          'align-items': props.edge === 'right' || props.edge === 'bottom' ? 'flex-end' : 'flex-start',
          padding: px(DOCK_GAP_PX),
          'pointer-events': 'none',
          'z-index': layer(),
        }}
      >
        <For each={seatKeys()}>
          {(key, index) => (
            <>
              {/* The gap between two cards is their divider. */}
              <Show
                when={
                  index() > 0 &&
                  !shellStore.dockGeometry()[showing(lane()?.seats[index()], shellStore.dockGeometry()) ?? '']?.hidden
                }
              >
                <Divider
                  above={() => showing(lane()?.seats[index() - 1], shellStore.dockGeometry())}
                  edge={props.edge}
                  gap={DOCK_GAP_PX}
                />
              </Show>
              <Seat seat={() => lane()?.seats.find((seat) => seat.key === key)} edge={props.edge} />
            </>
          )}
        </For>
      </div>
    </Show>
  );
}

export function EdgeLanes() {
  return (
    <For each={EDGES}>
      {(edge) => (
        <>
          <EdgeOf edge={edge} />
          <CoverOf edge={edge} />
        </>
      )}
    </For>
  );
}

export default EdgeLanes;
