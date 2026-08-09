/**
 * Where a docked module panel lands, and how much room the app gives up for it.
 *
 * Pure functions over a viewport and a list of docks, deliberately: this is the one place that
 * knows the shell's geometry — the sidebar on the left, the module rail on the right, how wide
 * "medium" is, and when the window is too narrow to inset anything at all. A module says *which
 * edge* and *how big*; everything else is here, where it can be reasoned about and tested without a
 * browser.
 *
 * See `registries/dockRegistry.ts` for why a module does not position itself.
 */
import type { DockEdge, DockSize } from '@we/module-shared';

/** The collapsed shell sidebar. Mirrors `SHELL_SIDEBAR_WIDTH`, in pixels for arithmetic. */
export const SIDEBAR_PX = 80;

/**
 * What a panel on the right must clear so the module rail stays reachable while it is open.
 *
 * The rail is 48px (`MODULE_RAIL_WIDTH`) plus a gap. Covering it would hide the way to close the
 * very panel that was covering it, which is the one state a docked panel must not be able to reach.
 */
export const RAIL_PX = 56;

/** The gap between a floating or docked panel and the edges it sits against. */
export const DOCK_GAP_PX = 8;

/**
 * Below this width, docks stop insetting and start floating.
 *
 * Insetting trades content area for a panel, and the trade only makes sense when there is content
 * area to trade. On a narrow window a 440px panel beside a 400px viewport is not two usable things,
 * it is one unusable one — so the panel goes back to covering, where at least what it covers is
 * still whole underneath it.
 */
export const NARROW_VIEWPORT_PX = 900;

export interface Viewport {
  width: number;
  height: number;
  /**
   * Chrome already occupying each edge that docks must keep clear of, beyond the shell's own.
   *
   * The sidebar and the module rail are constants and live below; this is for what comes and goes.
   * The template and theme editors open rails and panels along the right edge, and a dock that
   * ignored them opened on top of the controls being used to edit the thing it was covering.
   */
  reserved?: ContentInset;
}

export interface DockRequest {
  id: string;
  edge: DockEdge;
  size: DockSize;
  /** The module asked to overlay rather than inset. The host may force this on; never off. */
  float: boolean;
  /**
   * What the user dragged this dock to, in pixels, overriding the named size.
   *
   * The module keeps saying what it *wants* — `md`, an opening bid — and the host keeps deciding
   * what it gets, which now includes remembering that somebody moved it. Absent until they do.
   */
  resizedTo?: number;
}

/** Nobody wants a panel too narrow to show anything; below this it is a sliver with a scrollbar. */
export const MIN_DOCK_PX = 200;

/**
 * A resolved dock box.
 *
 * Offsets are CSS strings or `undefined` — never `'auto'` — because an undefined prop is skipped by
 * the design system's style builder, while a string it cannot parse would emit a broken custom
 * property. `undefined` is how you say "this edge is not anchored".
 */
export interface DockGeometry {
  edge: DockEdge;
  /**
   * Which edge of the panel the resize handle sits on — the one facing the content it steals from.
   *
   * `undefined` while floating: a panel that takes no room has nothing to trade, so there is nothing
   * to drag. Named as a *side of the panel* rather than a direction of travel, because that is what
   * the frame needs in order to place it.
   */
  handle?: 'left' | 'right' | 'top' | 'bottom';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  transform?: string;
  /** Whether this dock is overlaying. Read by nothing in the schema — it is here for tests. */
  floating: boolean;
}

/** How much room the content viewport gives up, per edge, in pixels. */
export interface ContentInset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The region a dock may occupy: the window, less the chrome that is always there. */
function contentRegion(viewport: Viewport) {
  const reserved = viewport.reserved;
  const left = SIDEBAR_PX + (reserved?.left ?? 0);
  const right = RAIL_PX + (reserved?.right ?? 0);
  const top = reserved?.top ?? 0;
  const bottom = reserved?.bottom ?? 0;
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, viewport.width - left - right),
    height: Math.max(0, viewport.height - top - bottom),
  };
}

/**
 * The thickness of a dock on its edge, in pixels.
 *
 * `lg` is a fraction rather than a number because the point of the large size is "most of the
 * screen", which is a different pixel count on a laptop and a monitor. The small and medium sizes
 * are fixed, because the point of those is "a panel", and a panel that grew with the display would
 * just be a bigger panel showing the same thing.
 */
export function dockThickness(edge: DockEdge, size: DockSize, viewport: Viewport, resizedTo?: number): number {
  const region = contentRegion(viewport);
  const vertical = edge === 'left' || edge === 'right';
  const available = vertical ? region.width : region.height;

  // A drag beats a named size, but never the window: a panel dragged wide on a monitor must not
  // still be wider than a laptop screen when the same session moves to one.
  if (resizedTo !== undefined && size !== 'full') return clamp(resizedTo, Math.min(MIN_DOCK_PX, available), available);

  if (size === 'full') return vertical ? region.width : region.height;
  if (vertical) {
    if (size === 'sm') return clamp(320, 0, region.width);
    if (size === 'md') return clamp(440, 0, region.width);
    return clamp(Math.round(region.width * 0.45), 320, region.width);
  }
  if (size === 'sm') return clamp(150, 0, region.height);
  if (size === 'md') return clamp(300, 0, region.height);
  return clamp(Math.round(region.height * 0.5), 200, region.height);
}

/**
 * Resolve one dock into a box.
 *
 * Three shapes, and which one you get is decided by float and size rather than by a mode the module
 * has to name:
 *
 * - **Floating and small** — a strip, centred along the bottom. It ignores the edge preference, and
 *   that is not an oversight: an edge is a decision about where to give up room, and a strip gives
 *   up none. The bottom specifically, because floating *control* chrome lives at the top — the call
 *   bar is a pill at top centre, and a strip placed there would land on it. Its width comes from its
 *   content, so a two-person strip is not a band of empty panel.
 * - **Floating and anything else** — covering the content region entirely. This is the maximised
 *   case, and insetting it would leave a content viewport of zero width.
 * - **Docked** — flush against its edge, spanning it, insetting by its thickness.
 */
export function resolveDock(request: DockRequest, viewport: Viewport): DockGeometry {
  const { edge } = request;
  if (!edge) return { edge: null, floating: true };

  const region = contentRegion(viewport);
  const narrow = viewport.width < NARROW_VIEWPORT_PX;
  const floating = request.float || narrow;
  const px = (n: number) => `${Math.round(n)}px`;

  if (floating && request.size === 'sm') {
    return {
      edge,
      floating: true,
      bottom: px(region.bottom + DOCK_GAP_PX),
      left: '50%',
      transform: 'translateX(-50%)',
      height: px(dockThickness('bottom', 'sm', viewport)),
    };
  }

  if (floating) {
    return {
      edge,
      floating: true,
      top: px(region.top + DOCK_GAP_PX),
      bottom: px(region.bottom + DOCK_GAP_PX),
      left: px(region.left + DOCK_GAP_PX),
      right: px(region.right + DOCK_GAP_PX),
    };
  }

  const thickness = dockThickness(edge, request.size, viewport, request.resizedTo);
  const common = { edge, floating: false };

  if (edge === 'right' || edge === 'left') {
    return {
      ...common,
      handle: edge === 'right' ? 'left' : 'right',
      top: px(region.top + DOCK_GAP_PX),
      bottom: px(region.bottom + DOCK_GAP_PX),
      width: px(thickness - DOCK_GAP_PX),
      ...(edge === 'right' ? { right: px(region.right) } : { left: px(region.left) }),
    };
  }

  return {
    ...common,
    handle: edge === 'top' ? 'bottom' : 'top',
    left: px(region.left + DOCK_GAP_PX),
    right: px(region.right + DOCK_GAP_PX),
    height: px(thickness - DOCK_GAP_PX),
    ...(edge === 'top' ? { top: px(region.top + DOCK_GAP_PX) } : { bottom: px(region.bottom + DOCK_GAP_PX) }),
  };
}

/**
 * What the content viewport gives up, summed across every dock.
 *
 * Floating docks contribute nothing by definition. Two docks on the same edge stack their
 * thicknesses — which is the honest answer even though nothing places them side by side yet: an
 * inset that under-reported would put the second panel over content the app believes is visible.
 * Tabbing them into one dock is the eventual fix, and it belongs here rather than in either module.
 */
export function contentInset(requests: DockRequest[], viewport: Viewport): ContentInset {
  const inset: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };
  const narrow = viewport.width < NARROW_VIEWPORT_PX;

  for (const request of requests) {
    if (!request.edge || request.float || narrow) continue;
    inset[request.edge] += dockThickness(request.edge, request.size, viewport, request.resizedTo);
  }
  return inset;
}
