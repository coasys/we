import { ImageLightbox } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

interface ImageDisplayProps {
  src: string | undefined;
  altText: string | undefined;
  width: number | undefined;
  height: number | undefined;
}

export function ImageDisplay(props: ImageDisplayProps) {
  const resolvedWidth = () => props.width || 33;
  const widthCss = () => `${resolvedWidth()}%`;
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <Show when={props.src}>
        <div
          style={{
            width: widthCss(),
            cursor: 'pointer',
            margin: resolvedWidth() < 100 ? '0 auto' : undefined,
            display: resolvedWidth() < 100 ? 'block' : undefined,
          }}
          onClick={() => setOpen(true)}
        >
          <we-image src={props.src} alt={props.altText || ''} width="100%" height="auto" fit="contain" r="200" />
        </div>
      </Show>
      <Show when={open() && !!props.src}>
        <ImageLightbox srcs={[props.src!]} initialIndex={0} onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}
