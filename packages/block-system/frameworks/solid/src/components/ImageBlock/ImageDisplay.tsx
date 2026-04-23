import { Show } from 'solid-js';

interface ImageDisplayProps {
  src: string | undefined;
  altText: string | undefined;
  width: number | undefined;
  height: number | undefined;
}

/**
 * Pure display component for ImageBlock.
 * Props only, no Lexical coupling, no onChange.
 * Used in read-only mode and reusable in schema views.
 */
export function ImageDisplay(props: ImageDisplayProps) {
  // Width is stored as a percentage (33 / 66 / 100). Default to 33 (small). Center when narrower than full.
  const resolvedWidth = () => props.width ?? 33;
  const widthCss = () => `${resolvedWidth()}%`;

  return (
    <Show when={props.src}>
      <we-image
        src={props.src}
        alt={props.altText || ''}
        width={widthCss()}
        height="auto"
        fit="contain"
        r="200"
        style={resolvedWidth() < 100 ? { margin: '0 auto', display: 'block' } : undefined}
      />
    </Show>
  );
}
