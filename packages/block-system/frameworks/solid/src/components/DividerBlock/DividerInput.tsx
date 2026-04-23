import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { DividerDisplay } from './DividerDisplay';

type DividerVariant = 'solid' | 'dashed' | 'dotted';

interface DividerInputProps {
  style: DividerVariant | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

const STYLE_OPTIONS = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
];

export function DividerInput(props: DividerInputProps) {
  const [style, setStyle] = createSignal<DividerVariant>(props.style || 'solid');

  function handleStyleChange(e: CustomEvent) {
    setStyle(e.detail);
    props.onChange('style', e.detail);
  }

  return (
    <Column onClick={props.onSelect} position="relative">
      <DividerDisplay style={style()} />
      <Show when={props.isSelected()}>
        <Row position="absolute" top="-32px" right="0">
          <we-select value={style()} options={STYLE_OPTIONS} onChange={handleStyleChange} size="xs" />
        </Row>
      </Show>
    </Column>
  );
}
