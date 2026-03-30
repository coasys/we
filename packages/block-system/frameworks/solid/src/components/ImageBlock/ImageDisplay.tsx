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
    <div class="we-image-block">
      {props.src ? (
        <img
          src={props.src}
          alt={props.altText}
          style={{
            width: props.width ? `${props.width}px` : 'auto',
            height: props.height ? `${props.height}px` : 'auto',
          }}
        />
      ) : null}
    </div>
  );
}
