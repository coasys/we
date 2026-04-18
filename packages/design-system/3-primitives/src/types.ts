export type { SizeValue, ComponentSize, ComponentVariant } from '@we/tokens';

export type { DesignSystemProps } from '@we/design-types';

import type { ComponentSize } from '@we/tokens';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allowedTextTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'b', 'i', 'span', 'label', 'div'] as const;

export type TextTag = (typeof allowedTextTags)[number];
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type MenuItemVariant = 'default' | 'danger';
export type IconSize = ComponentSize | (string & {}); // semantic sizes + raw CSS values
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
export type ModalSize = ComponentSize | 'fullscreen';
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
export type DrawerPosition = 'left' | 'right' | 'top' | 'bottom';
