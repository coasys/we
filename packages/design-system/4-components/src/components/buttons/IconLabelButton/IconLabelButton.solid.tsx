import { MaybeAccessor, toValue } from '@we/design-utils/solid';
import type { IconWeight } from '@we/primitives/types';
import { JSX } from 'solid-js';

export interface IconLabelButtonProps {
  icon: MaybeAccessor<string>;
  label: MaybeAccessor<string>;
  selected?: MaybeAccessor<boolean>;
  iconWeight?: MaybeAccessor<IconWeight>;
  onClick?: () => void;
  class?: MaybeAccessor<string>;
  styles?: MaybeAccessor<JSX.CSSProperties>;
}

export function IconLabelButton(props: IconLabelButtonProps) {
  return (
    <we-button
      class={`we-icon-label-button ${props.class || ''}`}
      styles={props.styles}
      onClick={props.onClick}
      slot="trigger"
      // variant={toValue(props.variant)}
      // size={toValue(props.size)}
      data-we-button
    >
      <we-icon name={toValue(props.icon)} weight={toValue(props.iconWeight)} />
      {/* {toValue(props.label) && ( */}
      <we-text size="600" color="ui-black">
        {toValue(props.label)}
      </we-text>
      {/* )} */}
    </we-button>
  );
}
