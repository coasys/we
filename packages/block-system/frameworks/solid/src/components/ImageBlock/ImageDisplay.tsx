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
  return (
    <Show when={props.src}>
      <we-image
        src={props.src}
        alt={props.altText || ''}
        width={props.width ? `${props.width}px` : '100%'}
        height={props.height ? `${props.height}px` : 'auto'}
        fit="contain"
        r="200"
      />
    </Show>
  );
}
