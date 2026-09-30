interface DividerDisplayProps {
  style: 'solid' | 'dashed' | 'dotted' | undefined;
}

export function DividerDisplay(props: DividerDisplayProps) {
  const borderStyle = () => props.style || 'solid';

  return <we-divider class="we-divider-block" my="200" variant={borderStyle()} />;
}
