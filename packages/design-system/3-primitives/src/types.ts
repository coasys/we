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
/*
  How loud a badge is, orthogonal to what it means.

  `variant` says which meaning — neutral, success, danger — and this says how much of the screen it
  takes: `soft` is the tinted panel pair (`success-surface` on `success-text`), `solid` is the fill
  and its measured label (`success` on `on-success`). Every design system with a badge ends up with
  both axes, because "the connection is degraded" and "WE ARE RECORDING" are the same meaning at
  different volumes, and one appearance cannot serve both.

  Two values rather than the three most libraries offer: `outline` has no caller here yet, and the
  bar for a third is a real use, not symmetry with somebody else's table.
*/
export type BadgeAppearance = 'soft' | 'solid';
/*
  The same axis on an alert, and deliberately not the same two values.

  A badge is small enough that a fill is the loud option; an alert is a panel, so its fill would be
  the loudest thing on the page and there is no caller for one. What an alert needs instead is a
  *quieter* option than the tint — a column of pending items where eight tinted panels compete with
  each other and with everything around them. `accent` is that: the status as a thick left edge on
  an ordinary surface, which is Chakra's `left-accent` and Material's list-leading rule.
*/
export type AlertAppearance = 'soft' | 'accent';
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
