export type { SizeValue, ComponentSize, ToneName } from '@we/tokens';

export type { DesignSystemProps } from '@we/design-types';

import type { ComponentSize } from '@we/tokens';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allowedTextTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'small', 'b', 'i', 'span', 'label', 'div'] as const;

export type TextTag = (typeof allowedTextTags)[number];
/*
  How a component is painted — one vocabulary for every component that has a choice, independent of
  its colour. Colour is `tone`, a DS prop every element takes; `variant` is only ever the style, so
  any tone combines with any style. Radix's model, and the reason `primary` and `secondary` left:
  they were emphasis levels mixed into a list of styles, with `success` and `danger` colours mixed in
  as well.

  - `solid`: the fill and its label — the main action, a loud badge.
  - `soft`: the tinted fill and the family's text — a secondary action, a quiet badge, an alert.
  - `outline`: a border in the family on no fill.
  - `ghost`: no fill until hovered — a toolbar button.
  - `bare`: no appearance at all — a real `<button>` around arbitrary content.
  - `edge`: an alert's family as a thick left edge on a plain surface; alerts only.
*/
export type ButtonVariant = 'solid' | 'soft' | 'outline' | 'ghost' | 'bare';
export type BadgeVariant = 'soft' | 'solid';
export type TagVariant = 'soft' | 'solid';
export type AlertVariant = 'soft' | 'edge';
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
