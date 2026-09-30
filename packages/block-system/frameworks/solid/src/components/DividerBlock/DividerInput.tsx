import { Column } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { BlockToolbar } from '../BlockToolbar';
import { DividerDisplay } from './DividerDisplay';

type DividerVariant = 'solid' | 'dashed' | 'dotted';

interface DividerInputProps {
  style: DividerVariant | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
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
    <Column position="relative">
      <DividerDisplay style={style()} />
      <Show when={props.isSelected()}>
        <BlockToolbar placement="above">
          <we-select value={style()} options={STYLE_OPTIONS} onChange={handleStyleChange} size="xs" />
        </BlockToolbar>
      </Show>
    </Column>
  );
}
