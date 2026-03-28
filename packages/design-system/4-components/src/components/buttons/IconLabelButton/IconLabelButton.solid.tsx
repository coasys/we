import { MaybeAccessor, toValue } from '@we/design-utils/solid';
import type { IconWeight } from '@we/primitives/types';
import { JSX } from 'solid-js';

export type * from './IconLabelButton.types';
import type { IconLabelButtonProps as SharedIconLabelButtonProps } from './IconLabelButton.types';

type SolidIconLabelButtonProps = {
  [K in keyof SharedIconLabelButtonProps]: MaybeAccessor<SharedIconLabelButtonProps[K]>;
};

export function IconLabelButton(props: SolidIconLabelButtonProps) {
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
      <we-text fontSize="600" color="neutral-0">
        {toValue(props.label)}
      </we-text>
      {/* )} */}
    </we-button>
  );
}
