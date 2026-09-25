export type * from './Canvas.types';
import { createSignal, type JSX, onCleanup } from 'solid-js';

import { createLayoutComponent } from '../createLayoutComponent';
import type { Artboard, CanvasProps } from './Canvas.types';

/**
 * A coordinate space with a declared size — the one primitive freeform placement was missing.
 *
 * Everything else a scrapbook wants already works: `x`/`y`/`rotate` place a component, `zIndex`
 * stacks it, `$animate` reveals it on scroll, and a template can compute any of those from data.
 * What nothing could say is *what space those numbers are in*, so nothing downstream could scale,
 * letterbox or convert them, and a layout authored against a 1200px preview pane was simply wrong
 * in a 400px docked panel. This is that missing sentence, and it is small: an element that declares
 * a size in the author's units and a scale that makes it meet the box it was given.
 *
 * ## Why a Solid component and not a Lit primitive
 *
 * The generic pull is the other way — primitives are framework-neutral, which is what makes them
 * the currency the schema renderer can mount anywhere. Three reasons it loses here, in order of
 * weight:
 *
 * 1. **It measures.** The scale is `boxWidth / artboardWidth`, so a `ResizeObserver` is mandatory
 *    and no amount of prop inspection substitutes for it. `createLayoutComponent` already has the
 *    escape hatch, added for `Grid`'s `childAspect`, which is the same shape of problem.
 * 2. **Its children are arbitrary schema subtrees.** As a primitive they would be slotted through
 *    a shadow boundary, putting a shadow root between the artboard and every item — on the one
 *    surface a manipulation layer hit-tests against. `@we/drag` already carries `deepElement.ts`
 *    because `elementFromPoint` stopping at custom-element hosts broke autoscroll and overlapping
 *    drop-zone resolution; adding a boundary here is buying that bug deliberately.
 * 3. **`:host`'s own overflow is never DS-managed**, and a canvas clips or scrolls. That is a
 *    known `@we/primitives` footgun and precisely the kind a scrollable wrapper walks into.
 *
 * Framework-neutrality is answered the way `Row` and `Column` answer it: the types are their own
 * file, so a second adapter implements them rather than re-deriving them.
 *
 * ## Two elements, not one
 *
 * A transform does not change the box a parent lays out against, so the artboard cannot be the
 * element that carries the DS props: at `scale`, a 1200×3000 artboard would still ask its parent
 * for 1200×3000 however small it was drawn. So the outer element is measured and laid out, and the
 * inner one is the coordinate space — sized in the author's units, scaled, and clipped by the box
 * around it.
 *
 * ## What is inside is placed, not flowed
 *
 * Every direct child of the artboard starts at its origin, so `x`/`y` are coordinates rather than
 * deltas from whatever preceded them. That is one CSS rule and it is in `Canvas.scss`, with the
 * reasoning; the component's part of it is the `data-we-artboard` marker the rule keys off — which
 * is also how anything above finds this element, a manipulation layer converting a pointer position
 * into artboard coordinates being the case in view.
 */

/** No box yet. A zero width is what `solve` reads as "not measured", and it draws nothing until it is. */
const UNMEASURED = { width: 0, height: 0 };

const observable = () => typeof ResizeObserver !== 'undefined';

/** The artboard's size, defended against a caller who passed nothing usable. */
function sizeOf(artboard: Artboard | undefined): Artboard {
  const width = Number(artboard?.width);
  const height = Number(artboard?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
  };
}

interface Solved {
  /** The scale on each axis. Equal except under `stretch`. */
  x: number;
  y: number;
  /** Where the scaled artboard sits in the box — non-zero only when `contain` letterboxes. */
  left: number;
  top: number;
  /** The height the outer box needs, when the canvas is the one deciding it. */
  height?: number;
}

function solve(props: CanvasProps, box: { width: number; height: number }): Solved | undefined {
  const artboard = sizeOf(props.artboard);
  const fit = props.fit ?? 'scale';
  if (fit === 'none' || !artboard.width || !artboard.height) return undefined;
  // Nothing has been measured yet. Answering `0` here would collapse the artboard to a point and
  // then spring it open, which reads worse than the one frame at natural size that this gives.
  if (!box.width) return undefined;

  if (fit === 'stretch') {
    return { x: box.width / artboard.width, y: (box.height || artboard.height) / artboard.height, left: 0, top: 0 };
  }

  /*
    `contain` needs a second axis to fit against, and a canvas in document flow has no height of its
    own until something gives it one — its own `height` prop, a flex parent, a grid track. Falling
    back to `scale` rather than to zero is the reading that shows the artboard: a caller who asked
    for `contain` and gave no height meant "fit it", and width is the axis that exists.
  */
  const scale =
    fit === 'contain' && box.height
      ? Math.min(box.width / artboard.width, box.height / artboard.height)
      : box.width / artboard.width;

  const drawn = { width: artboard.width * scale, height: artboard.height * scale };
  return {
    x: scale,
    y: scale,
    left: Math.max(0, (box.width - drawn.width) / 2),
    top: fit === 'contain' && box.height ? Math.max(0, (box.height - drawn.height) / 2) : 0,
    /*
      Only `scale` sizes its own box, and it is the reason the whole component reads as ordinary
      content: it turns "a 1200×3000 artboard" into "however tall that is here", so a scrapbook
      several screens long scrolls like a page. `contain` and `stretch` were handed a box and must
      stay inside it, and `contain` without a height has already fallen back to scaling by width —
      which wants the height too, or it would leave the artboard drawn over whatever came after it.
    */
    ...(fit === 'contain' && box.height ? {} : { height: drawn.height }),
  };
}

/** The artboard layer's style, handed to `wrapChildren` as the hook's `extra`. */
type ArtboardLayer = () => JSX.CSSProperties;

function useArtboard(props: CanvasProps): {
  ref?: (el: HTMLElement) => void;
  style?: () => JSX.CSSProperties;
  extra?: ArtboardLayer;
} {
  const [box, setBox] = createSignal(UNMEASURED);

  const ref = (el: HTMLElement) => {
    if (!observable()) return;
    const observer = new ResizeObserver((entries) => {
      // The content box, not the border box: the artboard sits inside the padding, so solving
      // against the border box overflows by exactly the padding on every side.
      const measured = entries[0]?.contentBoxSize?.[0];
      const width = measured ? measured.inlineSize : el.clientWidth;
      const height = measured ? measured.blockSize : el.clientHeight;
      const current = box();
      if (current.width === width && current.height === height) return;
      setBox({ width, height });
      const solved = solve(props, { width, height });
      props.onMeasure?.({ width, height, scale: solved?.x ?? 1 });
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const solved = () => solve(props, box());

  const style = () => {
    const height = solved()?.height;
    /*
      The caller's own `height` wins. The hook's style is applied after the DS props, so without
      this the component would quietly overrule a `height: '100%'` somebody wrote on purpose — and
      a canvas inside a fixed-height panel is an ordinary thing to want.
    */
    if (height === undefined || props.height) return {};
    return { height: `${height}px` };
  };

  const layer = (): JSX.CSSProperties => {
    const artboard = sizeOf(props.artboard);
    const at = solved();
    return {
      position: 'relative',
      // The coordinate space, at its declared size. Everything inside is placed against this box,
      // whatever scale it is eventually drawn at — which is the whole contract.
      ...(artboard.width ? { width: `${artboard.width}px` } : {}),
      ...(artboard.height ? { height: `${artboard.height}px` } : {}),
      // A flex item by default takes its size from the container; this one is the size it declares.
      flex: '0 0 auto',
      'transform-origin': 'top left',
      ...(at
        ? {
            transform: `translate(${at.left}px, ${at.top}px) scale(${at.x}${at.y === at.x ? '' : `, ${at.y}`})`,
          }
        : {}),
    };
  };

  return { ref, style, extra: layer };
}

const render = createLayoutComponent<CanvasProps, ArtboardLayer>({
  /*
    `overflow: hidden` by default, because the two boxes disagree on purpose.

    The artboard's *layout* size is its declared size whatever it is drawn at, so at any scale below
    1 the inner element overflows the outer one by the difference — invisibly, since nothing is
    painted out there, but enough to give the page a scrollbar and a horizontal drift. Clipping is
    what makes the outer box the honest one. A caller who wants the overflow visible can say so.
  */
  defaults: { display: 'block', overflow: 'hidden' },
  ownKeys: ['artboard', 'fit', 'onMeasure'],
  direction: 'column',
  hook: useArtboard,
  /*
    The artboard itself: the coordinate space, at the size it declares, drawn at whatever scale the
    box it landed in works out to.

    `data-we-artboard` is how anything above can find it — a manipulation layer converting a pointer
    position into artboard coordinates needs this element's box, not the outer one's.
  */
  wrapChildren: (children, _props, layer) => (
    <div data-we-artboard="" style={layer?.() ?? {}}>
      {children()}
    </div>
  ),
});

/** @superclass DesignSystemElement */
export function Canvas(allProps: CanvasProps) {
  return render(allProps);
}
