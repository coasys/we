export type { SizeToken, SizeValue, AvatarSizeToken, AvatarSizeValue, SpaceToken } from '@we/tokens';

export type { DesignSystemProps } from '@we/design-types';

import type { SizeValue } from '@we/tokens';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allowedTextTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'b', 'i', 'span', 'label', 'div'] as const;

export type TextTag = (typeof allowedTextTags)[number];
export type BadgeVariant = '' | 'primary' | 'success' | 'danger' | 'warning';
export type BadgeSize = '' | 'sm' | 'lg';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';
export type CardVariant = '' | 'elevated' | 'outlined' | 'filled';
export type CheckboxSize = 'sm' | 'md' | 'lg';
export type FormFieldSize = 'sm' | 'md' | 'lg';
export type InputSize = 'sm' | 'md' | 'lg';
export type MenuItemVariant = 'default' | 'danger';
export type IconSize = '' | SizeValue; // Allow empty string for default size + both tokens and raw values
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
export type ModalSize = '' | 'xs' | 'sm' | 'lg' | 'xl' | 'fullscreen';
export type RadioSize = 'sm' | 'md' | 'lg';
export type SelectSize = 'sm' | 'md' | 'lg';
export type SpinnerSize = '' | 'sm' | 'lg';
export type TextareaSize = 'sm' | 'md' | 'lg';
export type PopoverEvent = 'contextmenu' | 'mouseover' | 'click';
export type TextVariant =
  | ''
  | 'heading'
  | 'heading-sm'
  | 'heading-lg'
  | 'subheading'
  | 'ingress'
  | 'body'
  | 'label'
  | 'footnote';
export type TooltipStrategy = 'absolute' | 'fixed';
export type ImageFit = '' | 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
export type ImageLoading = 'eager' | 'lazy';
export type SwitchSize = 'sm' | 'md' | 'lg';
export type TagVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger';
export type ProgressBarSize = 'sm' | 'md' | 'lg';
export type ProgressBarVariant = 'default' | 'success' | 'warning' | 'danger';
export type AlertVariant = 'info' | 'success' | 'warning' | 'error';
export type NumberInputSize = 'sm' | 'md' | 'lg';
export type SliderSize = 'sm' | 'md' | 'lg';
export type DrawerPosition = 'left' | 'right' | 'top' | 'bottom';
export type PaginationSize = 'sm' | 'md' | 'lg';
export type ComboboxSize = 'sm' | 'md' | 'lg';
export type DatePickerSize = 'sm' | 'md' | 'lg';
