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
 * ## One frame, wherever the section is
 *
 * A section here is drawn in the frame every panel has (`frameBox`), in the page's flow rather than
 * over it, framed as its declaration says or else as this lane's `frame` does (flush by default).
 * Its content is drawn once and moves with it (`PanelHost`), so breaking a section out and putting it
 * back keeps a feed's place. The frame is drawn again where the section lands, and a drag that began
 * on its grip here is carried on by the window once the grip has gone (see `carryPastTheGrip`).
 *
 * ## The grip is the host's, not the section's
 *
 * It is part of the frame, never inside the section's own node, so the template's tree stays clean
 * of host chrome. A section leaves the page once its grip has been dragged a few pixels, under the
 * pointer; pressing a flush section's grip sends it to the snap its declaration names.
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
import { declareLaneFrame, HOME_SECTION_ATTR, registerHomeLane } from '@shared/registries/homeLanes';
import { Row } from '@we/components/solid';
import type { PanelFrame } from '@we/schema-shared';
import { type Accessor, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { type LaneSection, useShellStore } from '../stores/ShellStore';
import { LaneDivider } from './LaneDivider';
import { PanelGroup, panelTitle, sectionKey } from './PanelGroup';

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
  /** How its sections are framed, where a section's declaration does not say — see `PanelFrame`. Default flush. */
  frame?: PanelFrame;
}) {
  const shellStore = useShellStore();
  const lane = () => props.lane ?? '';
  const direction = () => props.direction ?? 'column';
  const narrow = createNarrow();
  // How its sections are framed where theirs do not say — read by every frame through `panelFrames`.
  createEffect(() => onCleanup(declareLaneFrame(lane(), props.frame ?? 'flush')));
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

  /*
    Dragging the boundary between two sections that grow: each takes the share of the lane it is on
    screen as the drag begins, and the boundary moves within their two lengths — held here while the
    drag lasts and written once at its end, as the lane's width is.
  */
  const frontOf = (seat: string) => shellStore.seatFront(seat.split('\n')) ?? seat.split('\n')[0];
  const grows = (seat: string | undefined) =>
    !!seat &&
    !!(
      seat.includes('\n') ||
      (shellStore.dockPlacement()[frontOf(seat)]?.grow ?? shellStore.panelDeclaration(frontOf(seat))?.grow)
    );
  const [dragGrow, setDragGrow] = createSignal<Record<string, number> | null>(null);
  /** The smallest a section may be dragged to — enough to keep its header and a line of it. */
  const SECTION_FLOOR_PX = 48;
  let share: { before: string; after: string; a: number; b: number } | null = null;
  const lengthOf = (seat: string) => {
    const box = el?.querySelector(`[${HOME_SECTION_ATTR}="${sectionKey(frontOf(seat))}"]`)?.getBoundingClientRect();
    return box ? (direction() === 'column' ? box.height : box.width) : 0;
  };
  const startShare = (before: string, after: string) => {
    share = { before, after, a: lengthOf(before), b: lengthOf(after) };
  };
  const moveShare = (delta: number) => {
    if (!share) return;
    const room = share.a + share.b;
    const a = Math.min(
      Math.max(share.a + delta, SECTION_FLOOR_PX),
      Math.max(SECTION_FLOOR_PX, room - SECTION_FLOOR_PX),
    );
    setDragGrow({ [share.before]: a, [share.after]: room - a });
  };
  const endShare = () => {
    const held = dragGrow();
    share = null;
    setDragGrow(null);
    if (!held) return;
    // Each seat's share, written on every panel in it, so whichever is in front keeps it.
    const grows: Record<string, number> = {};
    for (const [seat, length] of Object.entries(held)) for (const id of seat.split('\n')) grows[id] = length;
    shellStore.setSectionGrow(grows);
  };

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
          <For each={seats()}>
            {(seat, index) => (
              <>
                {/* Between two sections that share the lane's length, a boundary to drag. */}
                <Show when={index() > 0 && grows(seats()[index() - 1]) && grows(seat)}>
                  <LaneDivider
                    direction={direction()}
                    size="0px"
                    // The lane's gap is either side of this box; pulled back by one, it sits mid-gap.
                    style={{
                      'margin-top': direction() === 'column' ? 'calc(-1 * var(--we-space-400))' : undefined,
                      'margin-left': direction() === 'row' ? 'calc(-1 * var(--we-space-400))' : undefined,
                    }}
                    onStart={() => startShare(seats()[index() - 1], seat)}
                    onMove={moveShare}
                    onEnd={endShare}
                  />
                </Show>
                <HomeSeat members={seat.split('\n')} direction={direction()} grow={dragGrow()?.[seat]} />
              </>
            )}
          </For>
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

/**
 * A seat of sections, in the page's flow: as long as its content, unless it says `grow` — then that
 * share of what the lane has left, held to it so a tree or a list scrolls inside itself. A seat of
 * several fills the room its place gives it.
 */
function HomeSeat(props: { members: string[]; direction: 'column' | 'row'; grow?: number }) {
  const shellStore = useShellStore();
  const front = () => shellStore.seatFront(props.members) ?? props.members[0];
  // A share being dragged, else the reader's, else the declaration's; a seat of several fills its room.
  const grow = () =>
    props.grow ??
    shellStore.dockPlacement()[front()]?.grow ??
    (props.members.length > 1 ? 1 : shellStore.panelDeclaration(front())?.grow);
  return (
    <PanelGroup
      members={props.members}
      attrs={{ [HOME_SECTION_ATTR]: sectionKey(front()) }}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        'flex-direction': 'column',
        flex: grow() ? `${grow()} 1 0` : undefined,
        'min-height': grow() && props.direction === 'column' ? '0' : undefined,
        'min-width': grow() && props.direction === 'row' ? '0' : undefined,
      }}
    />
  );
}

/** Where a section was, while it is away: says so, and offers the way back. */
function Placeholder(props: { dockId: string }) {
  const shellStore = useShellStore();
  const title = () => panelTitle(props.dockId, shellStore.panelDeclaration(props.dockId));
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
