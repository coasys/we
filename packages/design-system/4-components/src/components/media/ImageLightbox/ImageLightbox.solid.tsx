import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

export interface ImageLightboxProps {
  srcs: string[];
  initialIndex: number;
  onClose: () => void;
}

export function ImageLightbox(props: ImageLightboxProps) {
  const [index, setIndex] = createSignal(props.initialIndex);

  const prev = () => setIndex((i) => (i - 1 + props.srcs.length) % props.srcs.length);
  const next = () => setIndex((i) => (i + 1) % props.srcs.length);

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });

  const hasMany = () => props.srcs.length > 1;

  return (
    <Portal>
      <we-modal close={props.onClose} hideclosebutton p="0" r="500" overflow="hidden" width="calc(100vw - 80px)">
        <div style={{ position: 'relative', width: '100%', height: 'calc(100dvh - 120px)', 'max-height': '900px' }}>
          <we-image src={props.srcs[index()]} alt="" fit="contain" width="100%" height="100%" />

          {/* Close */}
          <we-button
            variant="ghost"
            size="sm"
            square
            style={{ position: 'absolute', top: '12px', right: '12px', 'z-index': '1' }}
            onClick={props.onClose}
          >
            <we-icon name="x" />
          </we-button>

          {/* Prev / Next */}
          <Show when={hasMany()}>
            <we-button
              variant="ghost"
              size="md"
              square
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', 'z-index': '1' }}
              onClick={prev}
            >
              <we-icon name="caret-left" />
            </we-button>
            <we-button
              variant="ghost"
              size="md"
              square
              style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', 'z-index': '1' }}
              onClick={next}
            >
              <we-icon name="caret-right" />
            </we-button>

            {/* Dot indicators */}
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '8px',
                'align-items': 'center',
                'z-index': '1',
              }}
            >
              <For each={props.srcs}>
                {(_, i) => (
                  <div
                    onClick={() => setIndex(i())}
                    style={{
                      width: i() === index() ? '10px' : '7px',
                      height: i() === index() ? '10px' : '7px',
                      'border-radius': '50%',
                      background: i() === index() ? 'var(--we-role-text)' : 'var(--we-role-border)',
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                      'flex-shrink': '0',
                    }}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </we-modal>
    </Portal>
  );
}
