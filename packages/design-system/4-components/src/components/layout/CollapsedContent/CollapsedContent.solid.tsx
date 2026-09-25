import { createSignal, onCleanup, onMount, Show } from 'solid-js';

export type * from './CollapsedContent.types';
import type { CollapsedContentProps } from './CollapsedContent.types';

export function CollapsedContent(props: CollapsedContentProps) {
  const maxH = () => props.maxHeight ?? '280px';
  /*
    What the fade fades *into* is whatever is behind the content, so it is a role: `surface`, since
    collapsed content sits on a card or a panel. A scale position pinned it to one theme's idea of a
    near-white, which inverts with the ramp and so was a light band across a dark card.
  */
  const fadeColor = () => props.fadeColor ?? 'var(--we-role-surface)';

  let innerRef: HTMLDivElement | undefined;
  const [overflow, setOverflow] = createSignal(false);
  /*
    How tall the content actually is, kept current by the ResizeObserver below.

    Measured rather than guessed because an open section must animate towards its *own* height.
    This used to open to a flat `max-height: 5000px`, which is not "uncapped" — with the
    `overflow: hidden` above it, anything past 5000px was clipped and unreachable, since the
    box does not scroll either. A call transcript hit that at roughly ninety utterances and
    silently lost the rest; so would any long post body.
  */
  const [contentHeight, setContentHeight] = createSignal(0);

  onMount(() => {
    if (!innerRef) return;

    const check = () => {
      const maxPx = parseFloat(props.maxHeight ?? '280px');
      const height = innerRef?.scrollHeight ?? 0;
      setContentHeight(height);
      // Threshold prevents the button+fade making the card taller than its expanded state.
      setOverflow(height > maxPx);
    };

    const observer = new ResizeObserver(check);
    observer.observe(innerRef);
    check();

    onCleanup(() => observer.disconnect());
  });

  // Only apply height constraint when content actually overflows maxHeight
  const effectivelyCollapsed = () => props.collapsed && overflow();
  const toggleIcon = () => props.icon ?? (effectivelyCollapsed() ? 'caret-down' : 'caret-up');

  /*
    Open: the content's own measured height, which is both the honest cap and a real target for
    the transition to animate towards — `none` is not animatable, which is why the flat 5000px
    was there in the first place.

    It stays honest as things change because the observer above re-measures on every content
    resize, so a late image, a streamed reply or another utterance arriving mid-call widens the
    cap with it rather than being cut off by a stale number.
  */
  const maxHeightStyle = () => (effectivelyCollapsed() ? maxH() : contentHeight() ? `${contentHeight()}px` : 'none');

  return (
    <div class={`we-collapsed-content${props.class ? ' ' + props.class : ''}`}>
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          'max-height': maxHeightStyle(),
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
              color: 'var(--we-role-text-muted)',
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
