/**
 * A `$panels` outlet — a lane in the template's own flow, holding the sections whose placement says
 * they are home here.
 *
 * ## Picture-in-picture, for any region of a page
 *
 * A section declared `home: 'sidebar'` renders here inline, with no frame, indistinguishable from
 * the layout around it — until somebody hovers it, when a grip appears in its corner. Press and
 * drag the grip and the section breaks out into a panel under the pointer, already being dragged;
 * click it and the section breaks out to the snap its declaration named. Either way it is now an
 * ordinary panel: it can be snapped, docked, folded, stacked and named in a layout, and its position
 * menu offers the way back. While it is away, this outlet shows a placeholder in its place with the
 * same offer.
 *
 * ## Two mount points, one remount at the gesture
 *
 * A section is rendered here when home and in the dock layer when not, and moving between the two
 * is a remount. The frame's rule is "never remount on *move*", and this is not a move: it is a
 * deliberate, rare transition somebody chose, and a section is a schema node — a re-query and a
 * scroll reset, once. Module panels never take this path. The alternatives were worse: a fixed
 * frame tracking a scrolling outlet lags a frame, which on a feed is unacceptable, and a node set
 * `position: fixed` in place is trapped by any transformed ancestor a template happens to write.
 *
 * ## The grip is the host's, not the section's
 *
 * It lives on the wrapper this component draws around each section, never inside the section's own
 * node. Two reasons. The template's tree stays clean of host chrome. And the wrapper outlives the
 * section: when the section remounts into the dock layer mid-gesture, the grip — and the pointer
 * capture it holds — are still here, so press-and-drag survives the swap. The wrapper then becomes
 * the placeholder.
 *
 * ## A lane as a sidebar
 *
 * A lane can be the left column of a page — a space's tree beside its view — and a sidebar wants two
 * things a plain lane did not have. `resize: 'end'` (or `'start'`) puts a handle on that edge alone,
 * and the width somebody drags it to is kept per agent and per template (`shellStore.laneWidth`),
 * between the template's `minWidth` and `maxWidth`. And a lane can be folded away
 * (`shellStore.toggleLane`): its sections stay mounted and hidden, so a feed keeps its place.
 *
 * Folding slides. The lane's own width goes to nothing while what is in it keeps its width, held to
 * the lane's inner edge and cut off at the outer one, so the column moves out past the edge rather
 * than being squeezed — and the view beside it takes the room as it goes. Folded, the lane is inert
 * and hidden once the slide ends, so nothing in it can be tabbed to.
 *
 * A template can fold one itself (`collapsed`) — an inspector's lane while nothing is selected —
 * which overrides the reader's fold without writing it.
 *
 * Below `NARROW_VIEWPORT_PX` a kept width means nothing — a phone has no room for a 280px column
 * beside anything — so the lane takes the width its parent gives it and the handle goes. How the page
 * stacks there is the template's, through its own layout (`mdUpProps`).
 *
 * The grips are quiet by default, so a page made of sections reads as a page. Hovering or focusing a
 * section shows its own; `shellStore.customisingLayout` shows them all.
 */
import { NARROW_VIEWPORT_PX } from '@shared/dockGeometry';
import { type DockEntry, dockRegistry, dockTitle, hostDockStores } from '@shared/registries/dockRegistry';
import { HOME_SECTION_ATTR, registerHomeLane } from '@shared/registries/homeLanes';
import { moduleStores } from '@shared/registries/moduleRegistry';
import { TEMPLATE_DOCK_STORE_ID } from '@shared/registries/templatePanels';
import { Row } from '@we/components/solid';
import type { TemplatePanel } from '@we/schema-shared';
import { type Accessor, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { type LaneSection, useShellStore } from '../stores/ShellStore';
import { PanelSlot } from './PanelHost';

/** How far the pointer must travel before a press on the grip is a drag rather than a click. */
const BREAK_OUT_DRAG_PX = 4;

/** A CSS length the lane can do arithmetic on: a number of pixels, or `'240px'`. Anything else is not a bound. */
function pixels(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value ?? '');
  return match ? Number(match[1]) : undefined;
}

/** Whether the window is narrower than a lane can keep a column's width in. */
function createNarrow(): Accessor<boolean> {
  if (typeof window === 'undefined' || !window.matchMedia) return () => false;
  const query = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_PX - 0.02}px)`);
  const [narrow, setNarrow] = createSignal(query.matches);
  const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
  query.addEventListener('change', onChange);
  onCleanup(() => query.removeEventListener('change', onChange));
  return narrow;
}

export function PanelLane(props: {
  lane?: string;
  direction?: 'column' | 'row';
  accepts?: string;
  /** The lane's width before anybody resizes it — a CSS length. Absent, it takes its parent's. */
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  /** The flex shorthand for the lane as an item of its parent row. */
  flex?: string;
  /** Which edge the reader can drag to resize it: `end` for a column on the left, `start` for one on the right. */
  resize?: 'start' | 'end';
  /**
   * Folded while nothing in it is open — a lane that has nothing to show until something is chosen,
   * such as an inspector's, or settings opened from a gear. It folds as the reader's fold does, and
   * unfolds to the reader's own state; without it an empty lane keeps its width, which is how a
   * template holds room for one.
   */
  foldEmpty?: boolean;
}) {
  const shellStore = useShellStore();
  const lane = () => props.lane ?? '';
  const direction = () => props.direction ?? 'column';
  const narrow = createNarrow();
  /*
    By id, and only when what the lane holds changes. The shell's list is worked out again whenever
    any panel moves — every frame of a drag, of a resize — and hands back new entries each time; drawn
    from those, every section was unmounted and drawn again on every frame, the tree and the inspector
    included, which is what made dragging a call window in a Coasys space judder where a template
    without lanes did not. Ids are strings, which a list keeps by value.
  */
  const sections = createMemo(() => shellStore.laneSections()[lane()] ?? [], undefined, { equals: sameSections });
  const here = createMemo(() => sections().filter((section) => section.open && !section.away), undefined, {
    equals: sameSections,
  });
  const away = createMemo(
    () =>
      sections()
        .filter((section) => section.away)
        .map((section) => section.id),
    undefined,
    {
      equals: sameIds,
    },
  );
  const collapsed = () =>
    shellStore.collapsedLanes().includes(lane()) || (!!props.foldEmpty && !here().length && !away().length);

  /*
    The width while a drag is under way, held here and written once at the end: a write per pointer
    move would serialise the whole lane map to storage at the frame rate.
  */
  const [dragWidth, setDragWidth] = createSignal<number | undefined>(undefined);
  const clamp = (width: number) => {
    const min = pixels(props.minWidth) ?? 120;
    const max = pixels(props.maxWidth) ?? Number.POSITIVE_INFINITY;
    return Math.min(Math.max(width, min), max);
  };
  const width = () => {
    if (narrow()) return '100%';
    const held = dragWidth() ?? shellStore.laneWidth(lane());
    return held !== undefined ? `${clamp(held)}px` : (props.width ?? '100%');
  };

  /*
    Sections sharing a seat, as tabs: consecutive ones with the same explicit `order` — the rule an
    edge's seats follow. Anything that said no `order` is a seat of its own.
  */
  const seats = createMemo(
    () => {
      const out: LaneSection[][] = [];
      for (const section of here()) {
        const last = out[out.length - 1];
        if (last && section.order !== undefined && last[0].order === section.order) last.push(section);
        else out.push([section]);
      }
      // Each seat by the ids in it, joined — a string, so the list keeps a seat that has not changed.
      return out.map((seat) => seat.map((section) => section.id).join('\n'));
    },
    undefined,
    { equals: sameIds },
  );

  let el: HTMLDivElement | undefined;
  const register = () => {
    if (!el) return;
    const accepts = (props.accepts ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    onCleanup(registerHomeLane({ lane: lane(), el, direction: direction(), accepts }));
  };

  let handle: HTMLElement | undefined;
  let startWidth = 0;
  onMount(() => {
    if (!handle) return;
    // Direct listeners: the handle's gesture events are its own — see the section grip below.
    handle.addEventListener('resizestart', () => {
      startWidth = el?.getBoundingClientRect().width ?? 0;
    });
    handle.addEventListener('resize', (event) => {
      const { delta } = (event as unknown as CustomEvent<{ delta: number }>).detail;
      setDragWidth(clamp(startWidth + (props.resize === 'start' ? -delta : delta)));
    });
    handle.addEventListener('resizeend', () => {
      const width = dragWidth();
      if (width !== undefined) shellStore.setLaneWidth(lane(), width);
      setDragWidth(undefined);
    });
  });

  /*
    How long the fold slides: the medium motion token, which a theme's animationSpeed and a
    reduced-motion setting both move. None while a resize drag is under way, which the lane must
    follow exactly.
  */
  const slide = () => (dragWidth() !== undefined ? 'none' : 'var(--we-transition-300) var(--we-ease-standard)');

  return (
    <div
      ref={(node: HTMLDivElement) => {
        el = node;
        register();
      }}
      inert={collapsed()}
      style={{
        display: 'flex',
        position: 'relative',
        // Folded away rather than unmounted: its sections keep their state. To nothing, by sliding.
        width: collapsed() ? '0px' : width(),
        'min-width': collapsed() || narrow() ? '0' : (props.minWidth ?? '0'),
        'max-width': narrow() ? 'none' : (props.maxWidth ?? 'none'),
        flex: narrow() ? undefined : (props.flex ?? (props.width || props.resize ? '0 0 auto' : undefined)),
        'box-sizing': 'border-box',
        /*
          Hidden only once the slide is over, so it is seen leaving; shown at once on the way back,
          so it is seen arriving.
        */
        visibility: collapsed() ? 'hidden' : 'visible',
        transition:
          slide() === 'none'
            ? 'none'
            : `width ${slide()}, min-width ${slide()}, visibility 0s linear ${collapsed() ? 'var(--we-transition-300)' : '0s'}`,
      }}
    >
      {/* Cuts off what has slid past the lane's edge, leaving the handle outside it free to overhang. */}
      <div
        style={{
          display: 'flex',
          'justify-content': props.resize === 'start' ? 'flex-start' : 'flex-end',
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            'flex-direction': direction(),
            gap: 'var(--we-space-400)',
            // The lane's own width, held while the lane narrows, so its content moves rather than squeezes.
            width: narrow() ? '100%' : width(),
            'min-width': narrow() ? '0' : (props.minWidth ?? '0'),
            'flex-shrink': '0',
            'box-sizing': 'border-box',
          }}
        >
          <For each={seats()}>{(seat) => <Seat members={seat.split('\n')} direction={direction()} />}</For>
          <For each={away()}>{(id) => <Placeholder dockId={id} />}</For>
        </div>
      </div>
      {/*
        Hidden while folded rather than left out: its listeners are attached once, on mount, so a
        handle made again when the lane unfolds had none, and a lane folded once could not be resized
        again — nor one that started folded, such as an inspector's, ever.
      */}
      <Show when={props.resize && !narrow()}>
        <we-resize-handle
          ref={handle}
          orientation="vertical"
          style={{
            display: collapsed() ? 'none' : undefined,
            position: 'absolute',
            top: '0',
            bottom: '0',
            [props.resize === 'start' ? 'left' : 'right']: '-4px',
            width: '8px',
            'z-index': '1',
          }}
        />
      </Show>
    </div>
  );
}

/**
 * One seat of a lane: a section on its own, or several sharing the place as tabs — one showing, the
 * one most recently raised or opened, and a strip naming them all. The rule an edge's seats follow,
 * in a lane: an inspector and the space's settings can take turns in one column rather than
 * stacking, and opening either brings it forward.
 */
function Seat(props: { members: string[]; direction: 'row' | 'column' }) {
  const shellStore = useShellStore();
  const front = () => shellStore.seatFront(props.members) ?? props.members[0];
  return (
    <Show when={props.members.length > 1} fallback={<Section dockId={props.members[0]} direction={props.direction} />}>
      <div style={{ display: 'flex', 'flex-direction': 'column', flex: '1 1 0', 'min-height': '0', width: '100%' }}>
        <Row ay="center" gap="100" px="200" pt="200">
          <For each={props.members}>
            {(member) => (
              <we-button
                size="sm"
                variant={member === front() ? 'soft' : 'ghost'}
                onClick={() => shellStore.raiseDock(member)}
              >
                {sectionTitle(member, shellStore.panelDeclaration(member))}
              </we-button>
            )}
          </For>
        </Row>
        {/* Keyed by the front, so the section showing is the one drawn — its own state is its own. */}
        <Show when={front()} keyed>
          {(id) => <Section dockId={id} direction={props.direction} tabbed />}
        </Show>
      </div>
    </Show>
  );
}

/** Two lists of a lane's sections that would draw the same. */
function sameSections(a: readonly LaneSection[], b: readonly LaneSection[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return x.id === y.id && x.open === y.open && x.order === y.order && x.tab === y.tab && x.away === y.away;
    })
  );
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What a section is called: its declared title, else its dock's name. */
function sectionTitle(dockId: string, declared: TemplatePanel | undefined): string {
  if (declared?.title) return declared.title;
  const entry = dockRegistry.get(dockId);
  return entry ? dockTitle(entry) : dockId;
}

/**
 * Close a module's or the host's panel by its own action — the method its `close` key names, on the
 * store its keys are read from, the same resolution the shell reads its `edge` through.
 */
function closeDock(entry: DockEntry): void {
  if (!entry.close) return;
  const store = (entry.store ?? moduleStores[entry.moduleId] ?? hostDockStores[entry.moduleId]) as
    Record<string, unknown> | undefined;
  const action = store?.[entry.close];
  if (typeof action === 'function') (action as () => void)();
}

/** A section's id as the outlet's seams know it: a template's panel by its own id, anything else by its dock's. */
const sectionKey = (dockId: string) => dockId.replace(/^template:/, '');

/** What a section draws: its panel, which the panel host draws once and moves here — see `PanelHost`. */
function SectionBody(props: { dockId: string }) {
  return <PanelSlot id={props.dockId} />;
}

/**
 * A slim header for a section that does not draw its own — a module's panel or the host's, whose
 * name and close button live on the titlebar of the frame it has on an edge, and which has no frame
 * here. A template's own sections draw their own heading, as the tree and an inspector do, so they
 * get none.
 */
function SectionHeader(props: { dockId: string; tabbed?: boolean }) {
  const shellStore = useShellStore();
  const entry = () => dockRegistry.get(props.dockId);
  const close = () => {
    const dock = entry();
    if (dock) closeDock(dock);
  };
  return (
    <Show when={entry() && entry()!.moduleId !== TEMPLATE_DOCK_STORE_ID}>
      <Row ay="center" ax="between" gap="200" px="300" pt="200" pb="100">
        <Show when={!props.tabbed} fallback={<div />}>
          <we-text variant="label">{sectionTitle(props.dockId, shellStore.panelDeclaration(props.dockId))}</we-text>
        </Show>
        <Show when={entry()!.close}>
          <we-tooltip content="Close" placement="left">
            <we-button size="sm" variant="ghost" square label="Close" onClick={close}>
              <we-icon name="x" />
            </we-button>
          </we-tooltip>
        </Show>
      </Row>
    </Show>
  );
}

/**
 * One section at home: its body, and the grip that takes it away.
 *
 * As long as its content, unless its panel declares `grow`: then it takes that share of whatever
 * length the lane has left, as a panel in a docked lane does, and is held to it — so a section that
 * fills a sidebar (a tree, a list) reaches the bottom of the lane and scrolls inside itself rather
 * than growing past it. A column, so what the section draws can say `height: 100%` and mean it.
 */
function Section(props: { dockId: string; direction: 'row' | 'column'; tabbed?: boolean }) {
  const shellStore = useShellStore();
  const declared = () => shellStore.panelDeclaration(props.dockId);
  const [hover, setHover] = createSignal(false);
  const [focus, setFocus] = createSignal(false);
  let moved = false;
  let grip: HTMLElement | undefined;

  /*
    Direct listeners rather than delegated props: the handle's gesture events are its own,
    dispatched from inside its shadow root, and this is the one binding that cannot miss them. See
    "Solid + Lit Web Component Event Handling". On mount rather than in a callback ref, because the
    generated element types take a ref *variable*.
  */
  onMount(() => {
    if (!grip) return;
    grip.addEventListener('movestart', (event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      moved = false;
      // Break out under the pointer and begin the panel drag in one motion — the wrapper this grip
      // sits on stays mounted, so the capture survives the section's remount.
      shellStore.breakOut(props.dockId, x, y);
      shellStore.beginDockMove(props.dockId, x, y);
    });
    grip.addEventListener('move', (event) => {
      const { dx, dy } = (event as CustomEvent<{ dx: number; dy: number }>).detail;
      if (Math.abs(dx) + Math.abs(dy) >= BREAK_OUT_DRAG_PX) moved = true;
      shellStore.moveDock(props.dockId, dx, dy);
    });
    grip.addEventListener('moveend', () => {
      shellStore.endDockMove(props.dockId);
      // A click, not a drag: the section goes to the snap its declaration named rather than
      // staying wherever the pointer happened to be.
      if (!moved) shellStore.breakOut(props.dockId);
    });
  });

  // A tab fills its seat, which is the room the seat was given.
  const grow = () => (props.tabbed ? 1 : declared()?.grow);

  return (
    <div
      {...{ [HOME_SECTION_ATTR]: sectionKey(props.dockId) }}
      style={{
        position: 'relative',
        width: '100%',
        ...(grow()
          ? {
              flex: `${grow()} 1 0`,
              [props.direction === 'row' ? 'min-width' : 'min-height']: '0',
              display: 'flex',
              'flex-direction': 'column',
            }
          : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusIn={() => setFocus(true)}
      onFocusOut={() => setFocus(false)}
    >
      <SectionHeader dockId={props.dockId} tabbed={props.tabbed} />
      <SectionBody dockId={props.dockId} />
      <Show when={!declared()?.fixed}>
        {/*
          Revealed on hover and on keyboard focus, never only hover: a hover-only affordance does
          not exist on a touchscreen, and a grip somebody cannot tab to is a control some people
          cannot use. The tooltip carries the verb.
        */}
        <we-tooltip content="Break out into a panel" placement="left">
          <we-move-handle
            label={`Break ${sectionTitle(props.dockId, declared())} out into a panel`}
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              width: '24px',
              height: '24px',
              opacity: hover() || focus() || shellStore.customisingLayout() ? 1 : 0,
              transition: 'opacity 120ms ease',
              'border-radius': 'var(--we-radius-300)',
              background: 'var(--we-role-surface-raised)',
              'box-shadow': 'var(--we-shadow-sm)',
            }}
            ref={grip}
          >
            <we-icon name="arrow-square-out" size="sm" />
          </we-move-handle>
        </we-tooltip>
      </Show>
    </div>
  );
}

/** Where a section was, while it is away: says so, and offers the way back. */
function Placeholder(props: { dockId: string }) {
  const shellStore = useShellStore();
  const title = () => sectionTitle(props.dockId, shellStore.panelDeclaration(props.dockId));
  return (
    <Row
      {...{ [HOME_SECTION_ATTR]: sectionKey(props.dockId) }}
      ay="center"
      ax="between"
      gap="300"
      px="300"
      py="200"
      r="surface"
      border="1px dashed border"
      color="text-muted"
    >
      <Row ay="center" gap="200">
        <we-icon name="arrow-square-out" size="sm" />
        <we-text variant="footnote">{title()} is floating</we-text>
      </Row>
      <we-button size="xs" variant="ghost" onClick={() => shellStore.returnHome(props.dockId)}>
        Bring back
      </we-button>
    </Row>
  );
}

export default PanelLane;
