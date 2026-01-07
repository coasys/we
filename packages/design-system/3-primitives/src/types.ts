export type { SizeToken, SizeValue, AvatarSizeToken, AvatarSizeValue, SpaceToken } from '@we/tokens';

export type { DesignSystemProps } from '@we/design-system-types';

import type { SizeValue } from '@we/tokens';

// TODO: review these types and move to @we/design-system-types

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allowedTextTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'b', 'i', 'span', 'label', 'div'] as const;

export type TextTag = (typeof allowedTextTags)[number];
export type BadgeVariant = '' | 'primary' | 'success' | 'danger' | 'warning';
export type BadgeSize = '' | 'sm' | 'lg';
// export type ButtonVariant = 'default' | 'primary' | 'link' | 'subtle' | 'ghost' | 'danger' | 'contrast';
// export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type IconSize = '' | SizeValue; // Allow empty string for default size + both tokens and raw values
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
export type ModalSize = '' | 'xs' | 'sm' | 'lg' | 'xl' | 'fullscreen';
export type SpinnerSize = '' | 'sm' | 'lg';
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
export type Placement =
  | 'auto'
  | 'auto-start'
  | 'auto-end'
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'right'
  | 'right-start'
  | 'right-end'
  | 'left'
  | 'left-start'
  | 'left-end';
export type TooltipStrategy = 'absolute' | 'fixed';
export type ImageFit = '' | 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
export type ImageLoading = 'eager' | 'lazy';
