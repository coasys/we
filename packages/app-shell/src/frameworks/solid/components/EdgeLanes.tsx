/**
 * The lanes at the window's edges — a sidebar of panels pushing the content aside, the way a
 * template's lane (`PanelLane`) is a column of them inside a page.
 *
 * Each edge holds its lanes side by side, outboard first; each lane its seats along it, divided by
 * flex — `grow 1 base`, never below the floor — which is the division the geometry engine works out
 * for the same seats (`columnLayout`), from the same numbers (`laneBase`). A seat holds its panels'
 * frames (`frameBox`), filling it, one showing and the rest hidden behind it as tabs. How thick a lane
 * is stays the engine's answer (`displacingLanes`), because it is also how far the content moves.
 *
 * Cards snapped to an edge, two seats of them or more, are a lane too — over the content rather than
 * beside it, each card keeping its own width (`CoverOf`).
 *
 * The lanes and their seats are keyed by name, never rebuilt by a recount: a frame is redrawn only
 * when its panel changes seat. Its content is the panel host's and moves with it (`PanelHost`).
 *
 * ## What the lanes do not draw yet
 *
 * The grips between seats and on a lane's inner edge, a stowed lane's strip, and the drop targets are
 * still drawn from the engine's boxes, over the window — the same division, so they land on the seams
 * the flex makes.
 */
import { COLLAPSED_PX, DOCK_GAP_PX, EDGES, PANEL_LAYER_BASE } from '@shared/dockGeometry';
import { dockRegistry, frameBox } from '@shared/registries/dockRegistry';
import { chromeBag } from '@shared/registries/templateBag';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import type { DockEdge } from '@we/module-shared';
import { RenderSchema } from '@we/schema-solid';
import { createMemo, For, Show } from 'solid-js';

import { type EdgeLane, type EdgeSeat, useShellStore } from '../stores/ShellStore';

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

/** One panel's frame, as the shell draws it over the window — here filling its seat. */
function Frame(props: { id: string }) {
  const entry = dockRegistry.get(props.id);
  const bag = chromeBag();
  return entry && bag ? RenderSchema({ node: frameBox(entry), stores: bag, registry }) : null;
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
    <div
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
    >
      <For each={ids()}>{(id) => <Frame id={id} />}</For>
    </div>
  );
}

function Lane(props: { lane: () => EdgeLane | undefined; edge: Edge }) {
  const vertical = props.edge === 'left' || props.edge === 'right';
  const shellStore = useShellStore();
  const seatKeys = createMemo(() => props.lane()?.seats.map((seat) => seat.key) ?? [], [], { equals: sameStrings });
  return (
    <div
      style={{
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
      <For each={seatKeys()}>
        {(key) => <Seat seat={() => props.lane()?.seats.find((seat) => seat.key === key)} edge={props.edge} />}
      </For>
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
          gap: px(DOCK_GAP_PX),
          'pointer-events': 'none',
          'z-index': layer(),
        }}
      >
        <For each={seatKeys()}>
          {(key) => <Seat seat={() => lane()?.seats.find((seat) => seat.key === key)} edge={props.edge} />}
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
