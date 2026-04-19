import { Row } from '@we/components/solid';
import { createMemo } from 'solid-js';

interface CalloutDisplayProps {
  text: string | undefined;
  variant: string | undefined;
  icon: string | undefined;
}

const VARIANT_ICONS: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  error: 'x-circle',
  success: 'check-circle',
};

const VARIANT_COLORS: Record<string, string> = {
  info: 'primary-100',
  warning: 'warning-100',
  error: 'error-100',
  success: 'success-100',
};

const VARIANT_BORDER_COLORS: Record<string, string> = {
  info: 'primary-300',
  warning: 'warning-300',
  error: 'error-300',
  success: 'success-300',
};

export function CalloutDisplay(props: CalloutDisplayProps) {
  const variant = createMemo(() => props.variant || 'info');
  const iconName = createMemo(() => props.icon || VARIANT_ICONS[variant()] || 'info');

  return (
    <Row
      class="we-callout-block"
      gap="300"
      ay="start"
      p="300"
      r="200"
      bg={VARIANT_COLORS[variant()] || VARIANT_COLORS.info}
      borderLeft={`3px solid ${VARIANT_BORDER_COLORS[variant()] || VARIANT_BORDER_COLORS.info}`}
    >
      <we-icon name={iconName()} size="sm" />
      <we-text flex="1">{props.text || ''}</we-text>
    </Row>
  );
}
