import { createSignal, onCleanup, onMount, Show } from 'solid-js';

export type * from './CollapsedContent.types';
import type { CollapsedContentProps } from './CollapsedContent.types';

export function CollapsedContent(props: CollapsedContentProps) {
  const maxH = () => props.maxHeight ?? '280px';
  const fadeColor = () => props.fadeColor ?? 'var(--we-color-neutral-100)';

  let innerRef: HTMLDivElement | undefined;
  const [overflow, setOverflow] = createSignal(false);

  onMount(() => {
    if (!innerRef) return;

    const check = () => {
      const maxPx = parseFloat(props.maxHeight ?? '280px');
      // Threshold prevents the button+fade making the card taller than its expanded state.
      setOverflow((innerRef?.scrollHeight ?? 0) > maxPx);
    };

    const observer = new ResizeObserver(check);
    observer.observe(innerRef);
    check();

    onCleanup(() => observer.disconnect());
  });

  // Only apply height constraint when content actually overflows maxHeight
  const effectivelyCollapsed = () => props.collapsed && overflow();
  const toggleIcon = () => props.icon ?? (effectivelyCollapsed() ? 'caret-down' : 'caret-up');

  return (
    <div class={`we-collapsed-content${props.class ? ' ' + props.class : ''}`}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          'max-height': effectivelyCollapsed() ? maxH() : '5000px',
          transition: 'max-height 0.4s ease',
        }}
      >
        {/* Inner wrapper — unconstrained, measured by ResizeObserver */}
        <div ref={innerRef}>{props.children}</div>

        {/* Fade overlay — only when content is actually clipped */}
        <Show when={effectivelyCollapsed()}>
          <div
            style={{
              position: 'absolute',
              bottom: '0',
              left: '0',
              right: '0',
              height: '80px',
              background: `linear-gradient(to bottom, transparent, ${fadeColor()})`,
              'pointer-events': 'none',
            }}
          />
        </Show>

        {/* Clickable overlay — same onClick binding as the button, only when collapsed */}
        <Show when={effectivelyCollapsed()}>
          <div
            onClick={props.onExpandClick}
            style={{
              position: 'absolute',
              inset: '0',
              cursor: 'pointer',
            }}
          />
        </Show>
      </div>

      {/* Toggle button — only rendered when content overflows maxHeight */}
      <Show when={props.showToggle !== false && overflow()}>
        <div style={{ display: 'flex', 'justify-content': 'center', 'padding-top': '8px' }}>
          <button
            type="button"
            onClick={props.onExpandClick}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 16px',
              display: 'flex',
              'align-items': 'center',
              gap: '4px',
              'border-radius': '6px',
              color: 'var(--we-color-neutral-500)',
              'font-size': 'var(--we-font-size-300)',
            }}
          >
            <we-icon name={toggleIcon()} size="sm" />
          </button>
        </div>
      </Show>
    </div>
  );
}
