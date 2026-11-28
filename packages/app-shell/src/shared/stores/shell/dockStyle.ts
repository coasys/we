/**
 * The dock kernel's answers as a web renderer draws them. Part of `ShellStore` — see `../ShellStore.ts`.
 *
 * The kernel (`dockGeometry.ts`) answers in geometry: pixels as numbers, a panel's paint order as a
 * rank. That is what a host drawing natively, on a canvas or in a terminal can use as it is. The
 * shell's frames are drawn by templates in a page, which bind `top`, `width` and `zIndex` as CSS, so
 * the store hands them this: each length as `<n>px`, each rank as a z-index above
 * `PANEL_LAYER_BASE`. Formatted once here, beside the store members that publish it, so the kernel
 * never learns what a stylesheet is and no template parses a number back out of a string.
 */
import { type DockGeometry, type DropSlot, PANEL_LAYER_BASE } from '../../dockGeometry';

/** The fields of a box the kernel answers in pixels. */
const LENGTHS = [
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'padTop',
  'padBottom',
  'layoutWidth',
  'layoutHeight',
] as const;

type Length = (typeof LENGTHS)[number];

/** A resolved box as the page draws it: its lengths as CSS, its rank as a z-index. */
export type DockStyle = Omit<DockGeometry, Length> & Partial<Record<Length, string>>;

/** A drop slot as the page draws it: its line's box as CSS. */
export type DropSlotStyle = Omit<DropSlot, 'top' | 'left' | 'width' | 'height'> & {
  top: string;
  left: string;
  width: string;
  height: string;
};

const px = (n: number) => `${Math.round(n)}px`;

/** One box, formatted. */
export function dockStyleOf(box: DockGeometry): DockStyle {
  const style: DockStyle = { ...box } as DockStyle;
  for (const key of LENGTHS) {
    const value = box[key];
    if (value !== undefined) style[key] = px(value);
  }
  if (box.layer !== undefined) style.layer = PANEL_LAYER_BASE + box.layer;
  return style;
}

/** Every box, formatted, by dock id. */
export function dockStyles(boxes: Record<string, DockGeometry>): Record<string, DockStyle> {
  return Object.fromEntries(Object.entries(boxes).map(([id, box]) => [id, dockStyleOf(box)]));
}

/** A drop slot, formatted. Its hit box stays geometry: nothing draws it. */
export function dropSlotStyleOf(slot: DropSlot): DropSlotStyle {
  return { ...slot, top: px(slot.top), left: px(slot.left), width: px(slot.width), height: px(slot.height) };
}
