import { Column } from '@we/components/solid';
import { createSignal } from 'solid-js';

import { CalloutDisplay } from './CalloutDisplay';

interface CalloutInputProps {
  text: string | undefined;
  variant: string | undefined;
  icon: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
}

const VARIANT_OPTIONS = [
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Error', value: 'error' },
  { label: 'Success', value: 'success' },
];

export function CalloutInput(props: CalloutInputProps) {
  const [variant, setVariant] = createSignal(props.variant || 'info');

  function handleTextInput(e: CustomEvent) {
    props.onChange('text', e.detail);
  }

  function handleVariantChange(e: CustomEvent) {
    setVariant(e.detail);
    props.onChange('variant', e.detail);
  }

  return (
    <Column class="we-callout-block-input" gap="200">
      <we-select value={variant()} options={VARIANT_OPTIONS} onChange={handleVariantChange} size="xs" />
      <CalloutDisplay text={props.text} variant={variant()} icon={props.icon} />
      <we-input type="text" value={props.text || ''} onInput={handleTextInput} placeholder="Callout text..." />
    </Column>
  );
}
