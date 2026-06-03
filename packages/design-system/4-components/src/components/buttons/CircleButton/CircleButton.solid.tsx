export type * from './CircleButton.types';
import type { CircleButtonProps } from './CircleButton.types';

export function CircleButton(props: CircleButtonProps) {
  return (
    <we-button
      class={`we-circle-button ${props.class || ''}`}
      styles={props.styles}
      onClick={props.onClick}
      slot="trigger"
      // variant="ghost"
      // circle
      data-we-button
    >
      <we-tooltip placement="right" title={props.label}>
        {props.image ? (
          <we-avatar image={props.image} />
        ) : props.icon ? (
          <we-icon name={props.icon} color="neutral-700" />
        ) : (
          <we-avatar initials={props.label.slice(0, 2)} />
        )}
      </we-tooltip>
    </we-button>
  );
}
