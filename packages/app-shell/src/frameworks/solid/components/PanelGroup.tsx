/**
 * A group: one or more panels sharing a place — the unit every place arranges.
 *
 * Alone, a panel is its group; several sharing a place are tabs, one showing — the one most recently
 * raised or opened — and a strip naming them all. One component wherever a group is: a section of a
 * template's lane, a column of a window's edge, a card floating free. What differs between those is
 * only where the group's box is, which is the place's business, never the group's.
 *
 * ## The frame
 *
 * How a group is framed is its front panel's declaration, else its lane's default, else flush — see
 * `PanelFrame`:
 *
 * - **window** — a titlebar: the panel's name (or the tabs), a grip that takes the group out of its
 *   place under the pointer, and its close.
 * - **flush** — part of the page around it, as a sidebar is: no titlebar; a slim header naming it
 *   where its content draws no heading of its own (a module's or the host's panel), the tabs when
 *   there are several, and a grip in the corner shown on hover or focus.
 * - **none** — its content, and the tabs if it needs them to be usable.
 *
 * ## Tabs behind the front stay mounted
 *
 * Every member keeps its slot and is hidden rather than unmounted while another is in front, as tabs
 * on an edge always were: a call in a background tab keeps its streams, a transcript its scroll.
 */
import { type DockEntry, dockRegistry, dockTitle, hostDockStores } from '@shared/registries/dockRegistry';
import { HOME_SECTION_ATTR } from '@shared/registries/homeLanes';
import { moduleStores } from '@shared/registries/moduleRegistry';
import { TEMPLATE_DOCK_STORE_ID } from '@shared/registries/templatePanels';
import { Row } from '@we/components/solid';
import type { PanelFrame, TemplatePanel } from '@we/schema-shared';
import { createSignal, For, onMount, Show } from 'solid-js';

import { useShellStore } from '../stores/ShellStore';
import { PanelSlot } from './PanelHost';

/** How far the pointer must travel before a press on a grip is a drag rather than a click. */
const BREAK_OUT_DRAG_PX = 4;

/** What a panel is called: its declared title, else its dock's name. */
export function panelTitle(dockId: string, declared: TemplatePanel | undefined): string {
  if (declared?.title) return declared.title;
  const entry = dockRegistry.get(dockId);
  return entry ? dockTitle(entry) : dockId;
}

/** A panel's id as a lane's seams know it: a template's panel by its own id, anything else by its dock's. */
export const sectionKey = (dockId: string) => dockId.replace(/^template:/, '');

/**
 * Close a panel: a template's own by the host's close for it, a module's or the host's by the method
 * its `close` key names, on the store its keys are read from — the resolution its `edge` is read through.
 */
export function closePanel(dockId: string, shellStore: ReturnType<typeof useShellStore>): void {
  const entry = dockRegistry.get(dockId);
  if (!entry) return;
  if (entry.moduleId === TEMPLATE_DOCK_STORE_ID) return shellStore.closeTemplatePanel(sectionKey(dockId));
  if (!entry.close) return;
  const store = (entry.store ?? moduleStores[entry.moduleId] ?? hostDockStores[entry.moduleId]) as
    Record<string, unknown> | undefined;
  const action = store?.[entry.close];
  if (typeof action === 'function') (action as () => void)();
}

/** Whether a panel can be closed from its frame. */
const closable = (entry: DockEntry | undefined) =>
  !!entry && (!!entry.close || entry.moduleId === TEMPLATE_DOCK_STORE_ID);

/**
 * A grip that takes a group out of its place: dragged, it breaks out under the pointer and is carried;
 * pressed without a drag, it goes to the snap its declaration names. Direct listeners rather than
 * delegated props: the handle's gesture events are its own, dispatched from inside its shadow root.
 * On mount, because the generated element types take a ref *variable*.
 */
function wireBreakOutGrip(
  grip: HTMLElement | undefined,
  dockId: () => string,
  shellStore: ReturnType<typeof useShellStore>,
): void {
  if (!grip) return;
  let moved = false;
  grip.addEventListener('movestart', (event) => {
    const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
    moved = false;
    shellStore.breakOut(dockId(), x, y);
    shellStore.beginDockMove(dockId(), x, y);
  });
  grip.addEventListener('move', (event) => {
    const { dx, dy } = (event as CustomEvent<{ dx: number; dy: number }>).detail;
    if (Math.abs(dx) + Math.abs(dy) >= BREAK_OUT_DRAG_PX) moved = true;
    shellStore.moveDock(dockId(), dx, dy);
  });
  grip.addEventListener('moveend', () => {
    shellStore.endDockMove(dockId());
    if (!moved) shellStore.breakOut(dockId());
  });
}

/** The tabs of a group of several: one per member, the front lit; pressing one brings it forward. */
function Tabs(props: { members: string[]; front: string }) {
  const shellStore = useShellStore();
  return (
    <Row ay="center" gap="100" minWidth="0">
      <For each={props.members}>
        {(member) => (
          <we-button
            size="sm"
            variant={member === props.front ? 'soft' : 'ghost'}
            onClick={() => shellStore.raiseDock(member)}
          >
            {panelTitle(member, shellStore.panelDeclaration(member))}
          </we-button>
        )}
      </For>
    </Row>
  );
}

function CloseButton(props: { dockId: string; size: 'xs' | 'sm' }) {
  const shellStore = useShellStore();
  return (
    <Show when={closable(dockRegistry.get(props.dockId))}>
      <we-tooltip content="Close" placement="left">
        <we-button
          size={props.size}
          variant="ghost"
          square
          label="Close"
          onClick={() => closePanel(props.dockId, shellStore)}
        >
          <we-icon name="x" />
        </we-button>
      </we-tooltip>
    </Show>
  );
}

/** A window's titlebar: the name (or the tabs), the grip it is moved by, and its close. */
function TitleBar(props: { members: string[]; front: string }) {
  const shellStore = useShellStore();
  let grip: HTMLElement | undefined;
  onMount(() => wireBreakOutGrip(grip, () => props.front, shellStore));
  return (
    <Row ay="center" gap="100" px="200" py="100" bg="chrome" borderBottom="1px solid border">
      <Show when={props.members.length > 1}>
        <Tabs members={props.members} front={props.front} />
      </Show>
      <we-move-handle ref={grip} label="Move panel" style={{ flex: '1', 'min-width': '0' }}>
        <Show when={props.members.length < 2}>
          <we-text variant="label" truncate>
            {panelTitle(props.front, shellStore.panelDeclaration(props.front))}
          </we-text>
        </Show>
      </we-move-handle>
      <CloseButton dockId={props.front} size="xs" />
    </Row>
  );
}

/**
 * A flush group's header: the tabs when there are several, else the name — only where the content
 * draws no heading of its own, which a template's own panel does — and the close.
 */
function FlushHeader(props: { members: string[]; front: string }) {
  const shellStore = useShellStore();
  const ownHeading = () => dockRegistry.get(props.front)?.moduleId === TEMPLATE_DOCK_STORE_ID;
  return (
    <Show when={props.members.length > 1 || !ownHeading()}>
      <Row ay="center" ax="between" gap="200" px="300" pt="200" pb="100">
        <Show
          when={props.members.length > 1}
          fallback={
            <we-text variant="label">{panelTitle(props.front, shellStore.panelDeclaration(props.front))}</we-text>
          }
        >
          <Tabs members={props.members} front={props.front} />
        </Show>
        <Show when={!ownHeading()}>
          <CloseButton dockId={props.front} size="sm" />
        </Show>
      </Row>
    </Show>
  );
}

export function PanelGroup(props: { members: string[]; direction: 'row' | 'column'; laneFrame?: PanelFrame }) {
  const shellStore = useShellStore();
  const front = () => shellStore.seatFront(props.members) ?? props.members[0];
  const declared = () => shellStore.panelDeclaration(front());
  // Its front panel's own declaration first, then its lane's, then flush — see `PanelFrame`.
  const frame = (): PanelFrame => declared()?.frame ?? props.laneFrame ?? 'flush';
  // A group of several fills the room its place gives it; one panel takes its declared share, if any.
  const grow = () => (props.members.length > 1 ? 1 : declared()?.grow);
  const [pointed, setPointed] = createSignal(false);
  let grip: HTMLElement | undefined;
  onMount(() => wireBreakOutGrip(grip, front, shellStore));

  return (
    <div
      {...{ [HOME_SECTION_ATTR]: sectionKey(front()) }}
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
      onMouseEnter={() => setPointed(true)}
      onMouseLeave={() => setPointed(false)}
      onFocusIn={() => setPointed(true)}
      onFocusOut={() => setPointed(false)}
    >
      <Show when={frame() === 'window'}>
        <TitleBar members={props.members} front={front()} />
      </Show>
      <Show when={frame() === 'flush'}>
        <FlushHeader members={props.members} front={front()} />
      </Show>
      <Show when={frame() === 'none' && props.members.length > 1}>
        <Row px="200" pt="200">
          <Tabs members={props.members} front={front()} />
        </Row>
      </Show>
      <For each={props.members}>
        {(member) => (
          // Behind the front: hidden, never unmounted — see the module comment.
          <div style={{ display: member === front() ? 'contents' : 'none' }}>
            <PanelSlot id={member} />
          </div>
        )}
      </For>
      <Show when={!declared()?.fixed && frame() === 'flush'}>
        {/*
          Revealed on hover and on keyboard focus, never only hover: a hover-only affordance does not
          exist on a touchscreen, and a grip somebody cannot tab to is a control some people cannot use.
        */}
        <we-tooltip content="Break out into a panel" placement="left">
          <we-move-handle
            label={`Break ${panelTitle(front(), declared())} out into a panel`}
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              width: '24px',
              height: '24px',
              opacity: pointed() || shellStore.customisingLayout() ? 1 : 0,
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

export default PanelGroup;
