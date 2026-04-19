interface TagDisplayProps {
  name: string | undefined;
  color: string | undefined;
}

export function TagDisplay(props: TagDisplayProps) {
  return (
    <we-tag class="we-tag-block" styles={props.color ? { background: props.color } : undefined}>
      #{props.name || 'tag'}
    </we-tag>
  );
}
