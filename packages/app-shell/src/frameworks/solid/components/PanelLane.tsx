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
 */
import { HOME_SECTION_ATTR, registerHomeLane } from '@shared/registries/homeLanes';
import { onTemplatePanelsChanged, templatePanelDockId, templatePanels } from '@shared/registries/templatePanels';
import { Row } from '@we/components/solid';
import type { TemplatePanel } from '@we/schema-shared';
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';

import { useShellStore } from '../stores/ShellStore';
import TemplatePanelBody from './TemplatePanelBody';

/** How far the pointer must travel before a press on the grip is a drag rather than a click. */
const BREAK_OUT_DRAG_PX = 4;

export function PanelLane(props: { lane?: string; direction?: 'column' | 'row'; accepts?: string }) {
  const shellStore = useShellStore();
  const lane = () => props.lane ?? '';
  const direction = () => props.direction ?? 'column';

  const [version, setVersion] = createSignal(0);
  onCleanup(onTemplatePanelsChanged(() => setVersion((v) => v + 1)));
  const declared = createMemo<readonly TemplatePanel[]>(() => {
    version();
    return templatePanels();
  });

  /**
   * The sections here now, in order — whatever `dockPlacement` says is home in this lane, whether
   * it was declared here or dropped in. Read from the placements rather than the declaration, so a
   * section dragged in from another lane shows up and one dragged out goes.
   */
  const here = createMemo(() => {
    const placements = shellStore.dockPlacement();
    return declared()
      .filter((panel) => {
        const placement = placements[templatePanelDockId(panel.id)];
        return placement?.snap === 'home' && placement.home === lane();
      })
      .sort((a, b) => {
        const order = (panel: TemplatePanel) =>
          placements[templatePanelDockId(panel.id)]?.order ?? Number.POSITIVE_INFINITY;
        return order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1;
      });
  });

  /** Sections declared home here that are away — a placeholder each, with the way back. */
  const away = createMemo(() => {
    const placements = shellStore.dockPlacement();
    return declared().filter((panel) => {
      if (panel.home !== lane()) return false;
      const placement = placements[templatePanelDockId(panel.id)];
      return placement !== undefined && placement.snap !== 'home';
    });
  });

  let el: HTMLDivElement | undefined;
  const register = () => {
    if (!el) return;
    const accepts = (props.accepts ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    onCleanup(registerHomeLane({ lane: lane(), el, direction: direction(), accepts }));
  };

  return (
    <div
      ref={(node: HTMLDivElement) => {
        el = node;
        register();
      }}
      style={{
        display: 'flex',
        'flex-direction': direction(),
        gap: 'var(--we-space-400)',
        width: '100%',
        'min-width': '0',
      }}
    >
      <For each={here()}>{(panel) => <Section panel={panel} />}</For>
      <For each={away()}>{(panel) => <Placeholder panel={panel} />}</For>
    </div>
  );
}

/** One section at home: its body, and the grip that takes it away. */
function Section(props: { panel: TemplatePanel }) {
  const shellStore = useShellStore();
  const dockId = () => templatePanelDockId(props.panel.id);
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
      shellStore.breakOut(props.panel.id, x, y);
      shellStore.beginDockMove(dockId(), x, y);
    });
    grip.addEventListener('move', (event) => {
      const { dx, dy } = (event as CustomEvent<{ dx: number; dy: number }>).detail;
      if (Math.abs(dx) + Math.abs(dy) >= BREAK_OUT_DRAG_PX) moved = true;
      shellStore.moveDock(dockId(), dx, dy);
    });
    grip.addEventListener('moveend', () => {
      shellStore.endDockMove(dockId());
      // A click, not a drag: the section goes to the snap its declaration named rather than
      // staying wherever the pointer happened to be.
      if (!moved) shellStore.breakOut(props.panel.id);
    });
  });

  return (
    <div
      {...{ [HOME_SECTION_ATTR]: props.panel.id }}
      style={{ position: 'relative', width: '100%' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusIn={() => setFocus(true)}
      onFocusOut={() => setFocus(false)}
    >
      <TemplatePanelBody panelId={props.panel.id} />
      <Show when={!props.panel.fixed}>
        {/*
          Revealed on hover and on keyboard focus, never only hover: a hover-only affordance does
          not exist on a touchscreen, and a grip somebody cannot tab to is a control some people
          cannot use. The tooltip carries the verb.
        */}
        <we-tooltip title="Break out into a panel" placement="left">
          <we-move-handle
            label={`Break ${props.panel.title ?? props.panel.id} out into a panel`}
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              width: '24px',
              height: '24px',
              opacity: hover() || focus() ? 1 : 0,
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
function Placeholder(props: { panel: TemplatePanel }) {
  const shellStore = useShellStore();
  return (
    <Row
      {...{ [HOME_SECTION_ATTR]: props.panel.id }}
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
        <we-text variant="footnote">{props.panel.title ?? props.panel.id} is floating</we-text>
      </Row>
      <we-button size="xs" variant="ghost" onClick={() => shellStore.returnHome(props.panel.id)}>
        Bring back
      </we-button>
    </Row>
  );
}

export default PanelLane;
