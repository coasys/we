import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createSignal, JSX, Show } from 'solid-js';

import { AiPanel } from '../ai/AiPanel';
import { useEditorHost } from '../host';
import { panelResizing, RAIL_STRIP_WIDTH, setPanelResizing, TOTAL_RAIL_WIDTH } from '../panelLayout';
import { useEditorSurface } from '../surface';
import { CodePanel } from './CodePanel';
import { InspectorPanel } from './InspectorPanel';
import { ThemePanel } from './ThemePanel';

export * from '../panelLayout';

/** Minimum pixel movement before a mousedown is treated as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 5;

interface PanelUnitProps {
  icon: string;
  tooltip: string;
  isOpen: () => boolean;
  panelWidth: () => number;
  toggle: () => void;
  setPanelWidth: (w: number) => void;
  children: JSX.Element;
}

/**
 * A panel paired with its rail — the thin handle on the panel's left edge.
 *
 * The rail serves two purposes:
 *   - Short press (< DRAG_THRESHOLD_PX of movement): toggles the panel open/closed.
 *   - Drag left/right: resizes the panel width.
 *
 * The CSS transition is disabled during drag so the panel tracks the cursor
 * exactly without lag, then re-enabled on release so open/close still animates.
 */
function PanelUnit(props: PanelUnitProps) {
  // Controls whether the width transition is active. Disabled during drag to
  // prevent the CSS animation fighting against live pointer updates.
  const [resizing, setResizing] = createSignal(false);
  let startWidth = 0;
  let openAtStart = false;
  let moved = false; // plain boolean — no reactive overhead needed

  /**
   * The drag policy, which is the half `we-resize-handle` deliberately does not own.
   *
   * A rail is not just a resizer: a short press toggles the panel, a drag resizes it, and dragging
   * leftwards from closed opens it on the way. The handle reports raw screen movement and nothing
   * else, so all of that stays here — where the panel's minimum, its maximum, and what "closed"
   * means are already known.
   */
  function onResizeStart() {
    openAtStart = props.isOpen(); // capture once — avoids reading a stale closure
    // When closed, treat start width as 0 so the panel grows from the drag position
    // rather than jumping to the previously stored width.
    startWidth = openAtStart ? props.panelWidth() : 0;
    moved = false;
  }

  function onResize(event: CustomEvent<{ delta: number }>) {
    // The handle reports screen direction; this rail sits to the *left* of its panel, so dragging
    // left — a negative screen delta — is what makes the panel wider.
    const delta = -event.detail.delta;

    if (!moved) {
      if (Math.abs(delta) < DRAG_THRESHOLD_PX) return; // not yet a drag
      moved = true;
      setResizing(true); // disable local panel transition — fires only once per drag
      setPanelResizing(true); // disable canvas/toolbar transitions — fires only once per drag
      // Drag left on a closed panel → open it before the first width update
      if (!openAtStart && delta > 0) props.toggle();
    }

    if (props.isOpen()) {
      // When dragging from closed, skip the minimum so the panel tracks the cursor
      // exactly from the start. The minimum is enforced on release instead.
      const min = openAtStart ? 240 : 1;
      props.setPanelWidth(Math.max(min, Math.min(900, startWidth + delta)));
    }
  }

  function onResizeEnd() {
    setResizing(false); // re-enable local transition for open/close animation
    setPanelResizing(false); // re-enable canvas/toolbar transitions
    if (!moved) {
      // A press that never moved is a click. The handle reports it as a zero-length drag, which is
      // the same disambiguation this made for itself before — now without a raw mouse listener.
      props.toggle();
    } else if (!openAtStart && props.isOpen() && props.panelWidth() < 240) {
      // Released below minimum after drag-from-closed: snap to minimum.
      // Transition is re-enabled above so this animates in smoothly.
      props.setPanelWidth(240);
    }
  }

  return (
    <Row height="100%" flexShrink="0" styles={{ 'user-select': resizing() ? 'none' : 'auto' }}>
      {/* Rail — always visible in edit mode, handles both click (toggle) and drag (resize).
          height on the tooltip host is what lets the rail Column's 100% resolve — the trigger
          part follows the host height (see the tooltip primitive's CSS). */}
      <we-tooltip title={props.tooltip} placement="left" height="100%">
        <Column
          width={`${RAIL_STRIP_WIDTH}px`}
          height="100%"
          ax="center"
          ay="center"
          bg={props.isOpen() ? 'neutral-100' : 'neutral-50'}
          borderLeft={`1px solid ${tokenVar('color', 'neutral-200')}`}
          hoverProps={{ bg: 'neutral-100' }}
          flexShrink="0"
          position="relative"
        >
          <we-icon name={props.icon} size="sm" color={props.isOpen() ? 'neutral-700' : 'neutral-400'} />
          {/*
            Laid over the whole rail rather than beside it, because the rail *is* the target: it
            toggles on a press and resizes on a drag, and splitting those across two elements would
            put a seam through the middle of one control. Its own divider is suppressed — the rail
            already draws a border, and two lines a pixel apart is one line that looks wrong.
          */}
          <we-resize-handle
            position="absolute"
            top="0"
            left="0"
            width="100%"
            height="100%"
            // Native `style`, not the design system's `styles` prop. Both work now, but this is a
            // custom property on one element rather than a design decision, and going through the DS
            // prop means going through Solid's custom-element property path to reach the same place.
            style={{ '--we-resize-handle-line': 'transparent', '--we-resize-handle-line-active': 'transparent' }}
            on:resizestart={onResizeStart}
            on:resize={onResize}
            on:resizeend={onResizeEnd}
          />
        </Column>
      </we-tooltip>

      {/* Panel content — slides out to the right of its rail on open */}
      <div
        style={{
          width: props.isOpen() ? `${props.panelWidth()}px` : '0px',
          'min-width': '0px',
          overflow: 'hidden',
          // Only animate during open/close clicks. During drag the transition is
          // disabled so the outer clip boundary matches the inner content exactly,
          // preventing the "content overflows then jumps" artifact.
          transition: resizing() ? 'none' : 'width 300ms ease',
          'flex-shrink': '0',
        }}
      >
        {/* Inner div holds the panel at its full layout width while the outer clips it.
            This prevents panel content from being squished to 0 during close animation. */}
        <div style={{ width: `${props.panelWidth()}px`, height: '100%' }}>{props.children}</div>
      </div>
    </Row>
  );
}

export function RightPanelContainer() {
  const surface = useEditorSurface();
  const session = useEditorHost().session;

  // Slide the container off-screen when neither editing mode is active.
  // When either mode is active, translateX(0) keeps it visible.
  /**
   * Where the container sits when it is not editing: its own width to the right, i.e. off the edge.
   *
   * Plus whatever a docked module panel has taken from that edge, which is the part that used to be
   * missing. The container is positioned at `right: var(--we-dock-right)`, so sliding it by its own
   * width alone lands it *inside* the dock rather than outside the window — and a dock frame paints
   * above it, so exiting the editor made its controls jump behind the notes panel instead of leaving
   * the screen.
   */
  const containerTransform = () => {
    if (session.isEditingTemplate() || session.isEditingTheme()) return 'none';
    let w = TOTAL_RAIL_WIDTH;
    if (session.isOpen()) w += session.aiPanelWidth();
    if (session.codePanelOpen()) w += session.codePanelWidth();
    if (session.themePanelOpen()) w += session.themePanelWidth();
    return `translateX(calc(${w}px + var(--we-dock-right, 0px)))`;
  };

  return (
    <Row
      // `fixed` beside the whole window in WE's shell; `absolute` within a host's own container when
      // the editor is embedded in a panel. See `useEditorSurface`.
      position={surface.positioning === 'container' ? 'absolute' : 'fixed'}
      top="0"
      // Beside the content rather than the window, so a docked module panel slides the editor's
      // rails inwards instead of opening underneath them. Inside a host's own container there is no
      // dock to account for, and the variable is simply unset.
      right="var(--we-dock-right, 0px)"
      height={surface.positioning === 'container' ? '100%' : '100vh'}
      zIndex={20}
      transform={containerTransform()}
      transition={panelResizing() ? 'none' : 'transform 300ms ease'}
      pointerEvents={session.isEditingTemplate() || session.isEditingTheme() ? 'auto' : 'none'}
    >
      {/* Theme panel — visible when isEditingTheme */}
      <Show when={session.isEditingTheme()}>
        <PanelUnit
          icon="paint-bucket"
          tooltip="Theme editor"
          isOpen={() => session.themePanelOpen()}
          panelWidth={() => session.themePanelWidth()}
          toggle={() => session.toggleThemePanel()}
          setPanelWidth={(w) => session.setThemePanelWidth(w)}
        >
          <ThemePanel />
        </PanelUnit>
      </Show>

      {/* Code + AI panels — visible when isEditingTemplate */}
      <Show when={session.isEditingTemplate()}>
        {/* Visual properties panel — only in visual mode */}
        <Show when={session.contentMode() === 'visual'}>
          <PanelUnit
            icon="cursor-click"
            tooltip="Properties"
            isOpen={() => session.visualPanelOpen()}
            panelWidth={() => session.visualPanelWidth()}
            toggle={() => session.toggleVisualPanel()}
            setPanelWidth={(w) => session.setVisualPanelWidth(w)}
          >
            <InspectorPanel />
          </PanelUnit>
        </Show>

        <PanelUnit
          icon="code"
          tooltip="Code editor"
          isOpen={() => session.codePanelOpen()}
          panelWidth={() => session.codePanelWidth()}
          toggle={() => session.toggleCodePanel()}
          setPanelWidth={(w) => session.setCodePanelWidth(w)}
        >
          <CodePanel />
        </PanelUnit>

        <PanelUnit
          icon="chat-circle"
          tooltip="AI chat"
          isOpen={() => session.isOpen()}
          panelWidth={() => session.aiPanelWidth()}
          toggle={() => session.toggle()}
          setPanelWidth={(w) => session.setAiPanelWidth(w)}
        >
          <AiPanel />
        </PanelUnit>
      </Show>
    </Row>
  );
}
