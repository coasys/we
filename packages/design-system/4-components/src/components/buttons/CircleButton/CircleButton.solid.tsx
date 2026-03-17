import { JSX } from 'solid-js';

export interface CircleButtonProps {
  label: string;
  icon?: string;
  image?: string;
  onClick?: () => void;
  class?: string;
  styles?: JSX.CSSProperties;
}

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
          <we-icon name={props.icon} color="ui-700" />
        ) : (
          <we-avatar initials={props.label.slice(0, 2)} />
        )}
      </we-tooltip>
    </we-button>
  );
}
