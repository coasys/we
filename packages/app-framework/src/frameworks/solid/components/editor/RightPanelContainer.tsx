import { Column, Row } from '@we/components/solid';
import { tokenVar } from '@we/design-utils';
import { createSignal, JSX, Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { AiPanel } from './AiPanel';
import { CodePanel } from './CodePanel';
import { InspectorPanel } from './InspectorPanel';
import { ThemePanel } from './ThemePanel';

export const RAIL_STRIP_WIDTH = 32; // px per strip
export const TOTAL_RAIL_WIDTH = RAIL_STRIP_WIDTH * 3; // all three strips (used by TemplateLayout)
export const TEMPLATE_RAILS_WIDTH = RAIL_STRIP_WIDTH * 2; // code + AI strips only
export const THEME_RAIL_WIDTH = RAIL_STRIP_WIDTH; // theme strip only

/**
 * True while any panel rail is being dragged to resize. Module-level so
 * TemplateLayout and DesignToolbar can disable their CSS transitions during
 * drag, keeping the canvas edge in sync with the panel edge.
 */
export const [panelResizing, setPanelResizing] = createSignal(false);

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
  // prevent the CSS animation fighting against live mousemove updates.
  const [resizing, setResizing] = createSignal(false);
  let startX = 0;
  let startWidth = 0;
  let moved = false; // plain boolean — no reactive overhead needed

  function onMouseDown(e: MouseEvent) {
    e.preventDefault();
    startX = e.clientX;
    const openAtStart = props.isOpen(); // capture once — avoids reading a stale closure
    // When closed, treat start width as 0 so the panel grows from the drag position
    // rather than jumping to the previously stored width.
    startWidth = openAtStart ? props.panelWidth() : 0;
    moved = false;

    const onMove = (e: MouseEvent) => {
      // positive delta = mouse moved left = panel grows wider
      const delta = startX - e.clientX;

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
        // exactly from the start. The minimum is enforced on mouseup instead.
        const min = openAtStart ? 240 : 1;
        props.setPanelWidth(Math.max(min, Math.min(900, startWidth + delta)));
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setResizing(false); // re-enable local transition for open/close animation
      setPanelResizing(false); // re-enable canvas/toolbar transitions
      if (!moved) {
        props.toggle(); // short press = click → toggle
      } else if (!openAtStart && props.isOpen() && props.panelWidth() < 240) {
        // Released below minimum after drag-from-closed: snap to minimum.
        // Transition is re-enabled above so this animates in smoothly.
        props.setPanelWidth(240);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <Row height="100%" styles={{ 'flex-shrink': '0', 'user-select': resizing() ? 'none' : 'auto' }}>
      {/* Rail — always visible in edit mode, handles both click (toggle) and drag (resize) */}
      <we-tooltip title={props.tooltip} placement="left">
        <Column
          width={`${RAIL_STRIP_WIDTH}px`}
          height="100vh"
          ax="center"
          ay="center"
          bg={props.isOpen() ? 'neutral-100' : 'neutral-50'}
          borderLeft={`1px solid ${tokenVar('color', 'neutral-200')}`}
          hoverProps={{ bg: 'neutral-100' }}
          cursor="ew-resize"
          styles={{ 'flex-shrink': '0' }}
          onMouseDown={onMouseDown}
        >
          <we-icon name={props.icon} size="sm" color={props.isOpen() ? 'neutral-700' : 'neutral-400'} />
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
  const aiStore = useAiStore();

  // Slide the container off-screen when neither editing mode is active.
  // When either mode is active, translateX(0) keeps it visible.
  const containerTransform = () => {
    if (aiStore.isEditingTemplate() || aiStore.isEditingTheme()) return 'none';
    let w = TOTAL_RAIL_WIDTH;
    if (aiStore.isOpen()) w += aiStore.aiPanelWidth();
    if (aiStore.codePanelOpen()) w += aiStore.codePanelWidth();
    if (aiStore.themePanelOpen()) w += aiStore.themePanelWidth();
    return `translateX(${w}px)`;
  };

  return (
    <Row
      position="fixed"
      top="0"
      right="0"
      height="100vh"
      zIndex={20}
      transform={containerTransform()}
      transition={panelResizing() ? 'none' : 'transform 300ms ease'}
      pointerEvents={aiStore.isEditingTemplate() || aiStore.isEditingTheme() ? 'auto' : 'none'}
    >
      {/* Theme panel — visible when isEditingTheme */}
      <Show when={aiStore.isEditingTheme()}>
        <PanelUnit
          icon="paint-bucket"
          tooltip="Theme editor"
          isOpen={() => aiStore.themePanelOpen()}
          panelWidth={() => aiStore.themePanelWidth()}
          toggle={() => aiStore.toggleThemePanel()}
          setPanelWidth={(w) => aiStore.setThemePanelWidth(w)}
        >
          <ThemePanel />
        </PanelUnit>
      </Show>

      {/* Code + AI panels — visible when isEditingTemplate */}
      <Show when={aiStore.isEditingTemplate()}>
        {/* Visual properties panel — only in visual mode */}
        <Show when={aiStore.contentMode() === 'visual'}>
          <PanelUnit
            icon="cursor-click"
            tooltip="Properties"
            isOpen={() => aiStore.visualPanelOpen()}
            panelWidth={() => aiStore.visualPanelWidth()}
            toggle={() => aiStore.toggleVisualPanel()}
            setPanelWidth={(w) => aiStore.setVisualPanelWidth(w)}
          >
            <InspectorPanel />
          </PanelUnit>
        </Show>

        <PanelUnit
          icon="code"
          tooltip="Code editor"
          isOpen={() => aiStore.codePanelOpen()}
          panelWidth={() => aiStore.codePanelWidth()}
          toggle={() => aiStore.toggleCodePanel()}
          setPanelWidth={(w) => aiStore.setCodePanelWidth(w)}
        >
          <CodePanel />
        </PanelUnit>

        <PanelUnit
          icon="chat-circle"
          tooltip="AI chat"
          isOpen={() => aiStore.isOpen()}
          panelWidth={() => aiStore.aiPanelWidth()}
          toggle={() => aiStore.toggle()}
          setPanelWidth={(w) => aiStore.setAiPanelWidth(w)}
        >
          <AiPanel />
        </PanelUnit>
      </Show>
    </Row>
  );
}
