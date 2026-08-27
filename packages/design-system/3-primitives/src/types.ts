export type { SizeValue, ComponentSize, ComponentVariant } from '@we/tokens';

export type { DesignSystemProps } from '@we/design-types';

import type { ComponentSize } from '@we/tokens';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allowedTextTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'b', 'i', 'span', 'label', 'div'] as const;

export type TextTag = (typeof allowedTextTags)[number];
// 'bare' is the appearance-free member of the scale (elsewhere called "unstyled") — button
// semantics with no chrome of its own, for wrapping arbitrary content in a real <button>.
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'bare';
export type MenuItemVariant = 'default' | 'danger';
export type IconSize = '' | ComponentSize | (string & {}); // '' = inherit from parent context, semantic sizes, or raw CSS values
export type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
/*
  Four sizes, deliberately fewer than the control scale.

  The widths this replaced were 320, 380, 400, 420, 500, 520, 560, 600, 640, 770, 850 and 900px
  across ~38 call sites — and that is not eleven needs, it is three needs and eight guesses. A
  modal is read at a glance (`sm`), filled in (`md`), or worked in (`lg`); `fullscreen` is the
  lightbox case, where the content is the size and the sheet gets out of its way. Offering `xs`
  and `xl` as well would only invite the guessing back.
*/
export type ModalSize = 'sm' | 'md' | 'lg' | 'fullscreen';
export type PopoverEvent = 'contextmenu' | 'mouseover' | 'click';
export type TextVariant =
  | ''
  | 'heading-sm'
  | 'heading-md'
  | 'heading-lg'
  | 'heading-xl'
  | 'subheading'
  | 'ingress'
  | 'body'
  | 'label'
  | 'footnote';
export type TooltipStrategy = 'absolute' | 'fixed';
export type ImageFit = '' | 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
export type ImageLoading = 'eager' | 'lazy';
export type DrawerPosition = 'left' | 'right' | 'top' | 'bottom';
