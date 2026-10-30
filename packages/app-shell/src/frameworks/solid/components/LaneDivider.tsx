/**
 * The grip between two groups of a lane: dragged, it moves the boundary between them.
 *
 * One component for every lane — a window edge's, a template's — because a boundary looks and handles
 * the same wherever it is; what a drag *means* (an edge's stored sizes, a template section's share of
 * its lane) is the lane's, and arrives as the three callbacks. A box along the lane of the size the
 * lane leaves between its groups (none, or a gap), stretched across it, with the grip straddling its
 * middle so the line it draws is the boundary itself.
 */
import { SEAM_PX } from '@shared/dockGeometry';
import type { JSX } from 'solid-js';

export function LaneDivider(props: {
  /** Which way the lane runs: a column's boundaries are horizontal bars, dragged up and down. */
  direction: 'column' | 'row';
  /** Its own length along the lane — the room between the two groups. */
  size: string;
  /** Anything else its box needs to sit where the boundary is — a lane with a `gap` pulls it back by one. */
  style?: JSX.CSSProperties;
  onStart: () => void;
  onMove: (delta: number) => void;
  onEnd: () => void;
}) {
  const column = () => props.direction === 'column';
  return (
    <div
      style={{
        position: 'relative',
        flex: 'none',
        // Across the whole lane, whatever its groups are aligned to.
        'align-self': 'stretch',
        height: column() ? props.size : undefined,
        width: column() ? undefined : props.size,
        ...props.style,
      }}
    >
      <we-resize-handle
        data-we-lane-divider=""
        orientation={column() ? 'horizontal' : 'vertical'}
        align="center"
        line="auto"
        style={{
          position: 'absolute',
          'z-index': 2,
          'pointer-events': 'auto',
          '--we-resize-handle-thickness': '3px',
          ...(column()
            ? { left: '0', right: '0', top: `calc(50% - ${SEAM_PX / 2}px)`, height: `${SEAM_PX}px` }
            : { top: '0', bottom: '0', left: `calc(50% - ${SEAM_PX / 2}px)`, width: `${SEAM_PX}px` }),
        }}
        on:resizestart={() => props.onStart()}
        on:resize={(event: CustomEvent<{ delta: number }>) => props.onMove(event.detail.delta)}
        on:resizeend={() => props.onEnd()}
      />
    </div>
  );
}

export default LaneDivider;
