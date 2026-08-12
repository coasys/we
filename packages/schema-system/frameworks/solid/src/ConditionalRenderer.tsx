import type { TransitionConfig } from '@we/schema-shared';
import { resolveProp } from '@we/schema-shared';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import {
  buildTransitionCSS,
  hiddenOpacity,
  hiddenTransform,
  revealEffect,
  revealTrackProperty,
  transitionSpan,
} from './transitionUtils';
import type { RendererOutput, SchemaNode } from './types';

type ConditionalRendererProps = {
  node: SchemaNode;
  stores: Record<string, unknown>;
  context: Record<string, unknown>;
  renderNode: (node?: SchemaNode, nodeContext?: Record<string, unknown>) => RendererOutput;
};

/**
 * Sizing the wrapper mirrors from its content, as DS prop → CSS property.
 *
 * Only sizing: padding, margin and the rest belong to the content's own box and would double up if
 * the wrapper took them too.
 */
const SIZE_PROPS: Array<[string, string]> = [
  ['width', 'width'],
  ['minWidth', 'min-width'],
  ['maxWidth', 'max-width'],
  ['height', 'height'],
  ['minHeight', 'min-height'],
  ['maxHeight', 'max-height'],
  // `flex` for the same reason and with a sharper edge: inside a Row or Column the *wrapper* is the
  // flex item, so `flex: '1'` declared on the content had no effect at all — it was being read by
  // an element that is not the one the parent is sizing. Nothing reported it; the node simply did
  // not grow, which looks like a styling opinion rather than a dropped instruction.
  ['flex', 'flex'],
];

/** Which reveal axis each size prop belongs to — see the mirroring loop below. */
const AXIS_OF_SIZE_PROP: Record<string, 'block' | 'inline'> = {
  width: 'inline',
  minWidth: 'inline',
  maxWidth: 'inline',
  height: 'block',
  minHeight: 'block',
  maxHeight: 'block',
};

export function ConditionalRenderer({ node, stores, context, renderNode }: ConditionalRendererProps): RendererOutput {
  const enterTransition = node.props?.enterTransition as TransitionConfig | undefined;
  const exitTransition = node.props?.exitTransition as TransitionConfig | undefined;
  const hasTransitions = enterTransition || exitTransition;

  const conditionMet = createMemo(() => {
    const condition = resolveProp(node.props?.condition, stores, context, createMemo);
    return typeof condition === 'function' ? condition() : condition;
  });

  // If no transitions, use standard Show component
  if (!hasTransitions) {
    return (
      <Show when={conditionMet()} fallback={renderNode(node.props?.else as SchemaNode | undefined)}>
        {renderNode(node.props?.then as SchemaNode | undefined)}
      </Show>
    );
  }

  const effectiveCondition = createMemo(() => !!conditionMet());

  const startVisible = effectiveCondition();
  const initialHiddenTransform = enterTransition ? hiddenTransform(enterTransition) : '';
  const initialHiddenOpacity = enterTransition ? hiddenOpacity(enterTransition) : 0;

  const [isVisible, setIsVisible] = createSignal(startVisible);
  const [shouldRender, setShouldRender] = createSignal(startVisible);
  const [opacity, setOpacity] = createSignal(startVisible ? 1 : initialHiddenOpacity);
  const [transform, setTransform] = createSignal(startVisible ? '' : initialHiddenTransform);

  /*
    Reveal — the size axis.

    The wrapper becomes a single-track grid and the inner div clips, so the track can go 0fr → 1fr
    and land on whatever height (or width) the content actually wants. That two-element structure
    already existed here for opacity and transform; reveal just needs it to mean something.

    `open` is separate from `isVisible` for the same reason opacity is: the enter path has to paint
    one frame closed before it opens, or the browser has no start value to interpolate from and the
    element simply appears.
  */
  const enterReveal = enterTransition ? revealEffect(enterTransition) : undefined;
  const exitReveal = exitTransition ? revealEffect(exitTransition) : undefined;
  const hasReveal = enterReveal ?? exitReveal;
  const [open, setOpen] = createSignal(startVisible);

  /** True when a reveal is animating this axis — so nothing else may size the wrapper along it. */
  const revealsAxis = (axis: 'block' | 'inline') => !!hasReveal && (hasReveal.axis ?? 'block') === axis;

  // Mutable timer refs — must live outside createEffect so they can be cancelled
  // when the condition reverses mid-transition. onCleanup inside setTimeout is a
  // no-op (not in a reactive context), so we cancel manually on enter and unmount.
  let exitTimerOuter: ReturnType<typeof setTimeout> | undefined;
  let exitTimerInner: ReturnType<typeof setTimeout> | undefined;

  const cancelExitTimers = () => {
    clearTimeout(exitTimerOuter);
    clearTimeout(exitTimerInner);
    exitTimerOuter = undefined;
    exitTimerInner = undefined;
  };

  onCleanup(cancelExitTimers);

  // ── Condition change → animate in / out ──────────────────────────────────────
  createEffect(() => {
    const newCondition = effectiveCondition();

    if (newCondition && !isVisible()) {
      cancelExitTimers(); // cancel any in-progress exit before re-entering
      setShouldRender(true);
      setIsVisible(true);

      if (enterTransition) {
        setOpacity(hiddenOpacity(enterTransition));
        setTransform(hiddenTransform(enterTransition));
        if (enterReveal) setOpen(false);
        requestAnimationFrame(() => {
          const firstEffect = Array.isArray(enterTransition) ? enterTransition[0] : enterTransition;
          setTimeout(() => {
            setOpacity(1);
            setTransform('');
            setOpen(true);
          }, firstEffect?.delay ?? 0);
        });
      } else {
        setOpacity(1);
        setTransform('');
        setOpen(true);
      }
    } else if (!newCondition && isVisible()) {
      setIsVisible(false);

      if (exitTransition) {
        const firstEffect = Array.isArray(exitTransition) ? exitTransition[0] : exitTransition;
        // The longest effect, not the first — see transitionSpan.
        const duration = transitionSpan(exitTransition);
        const delay = firstEffect?.delay ?? 0;

        exitTimerOuter = setTimeout(() => {
          setOpacity(hiddenOpacity(exitTransition));
          setTransform(hiddenTransform(exitTransition));
          if (exitReveal) setOpen(false);

          exitTimerInner = setTimeout(() => setShouldRender(false), duration);
        }, delay);
      } else {
        setShouldRender(false);
        setOpacity(initialHiddenOpacity);
        setTransform(initialHiddenTransform);
        setOpen(false);
      }
    }
  });

  // ── CSS transition string ─────────────────────────────────────────────────────
  const transitionCSS = createMemo(() => {
    const current = isVisible();
    const config = current ? (enterTransition ?? exitTransition) : (exitTransition ?? enterTransition);
    return config ? buildTransitionCSS(config) : '';
  });

  // ── Overlay / positioning helpers (unchanged) ─────────────────────────────────
  const isOverlayComponent = (tagName: string): boolean => {
    if (!tagName?.startsWith('we-')) return false;
    const ComponentClass = customElements.get(tagName);
    if (!ComponentClass) return false;
    return 'isOverlay' in ComponentClass && ComponentClass.isOverlay === true;
  };

  const contentNode = node.props?.then as SchemaNode | undefined;
  const contentProps = contentNode?.props || {};
  const contentType = String(contentNode?.type || '');
  const isOverlay = isOverlayComponent(contentType);
  const hasPosition = contentProps.position;
  const hasZIndex = contentProps['z-index'] || contentProps.zIndex;

  // ── Wrapper style ─────────────────────────────────────────────────────────────
  const wrapperStyle = createMemo(() => {
    const style: Record<string, string | number> = {
      opacity: opacity(),
      transition: transitionCSS(),
      // The wrapper is a pure animation container — never capture pointer events.
      // The content inside handles its own interactions.
      'pointer-events': 'none',
    };

    const t = transform();
    if (t) style.transform = t;

    if (hasReveal) {
      style.display = 'grid';
      style[revealTrackProperty(hasReveal)] = open() ? '1fr' : '0fr';
    }

    if (isOverlay) {
      if (hasZIndex) style['z-index'] = String(contentProps['z-index'] || contentProps.zIndex);
      return style;
    }

    if (hasPosition || hasZIndex) {
      style.position = String(contentProps.position || 'relative');
      if (hasZIndex) style['z-index'] = String(contentProps['z-index'] || contentProps.zIndex);
      if (!revealsAxis('inline')) style.width = '100%';
      if (!revealsAxis('block')) style.height = '100%';
    }

    // Adopt whatever size the content asked for. The wrapper exists only to carry opacity and
    // transform, and is supposed to be invisible to layout — but it is a real box, so without this
    // it silently becomes the parent that percentages resolve against. A child asking for
    // `width: 100%` then resolves against a box that is itself sized by that child, which CSS
    // settles as shrink-to-fit: the element renders at its intrinsic width and its `maxWidth` never
    // binds, because nothing ever asks for more.
    //
    // Copying `maxWidth` alongside `width` is what keeps alignment intact. The wrapper ends up the
    // same size the content would have been, so the parent's `align-items` lands on a box of the
    // right width — rather than centring a full-width wrapper and leaving the content against its
    // left edge. Applied after the positioned defaults above so an explicit size wins over them.
    //
    // Except along an axis being revealed. The grid track *is* the size there, and a copied
    // `height` would pin the wrapper open at full height while the track animated inside it —
    // the element would jump to its final size and then ease a gap shut underneath itself.
    for (const [prop, cssProp] of SIZE_PROPS) {
      if (revealsAxis(AXIS_OF_SIZE_PROP[prop])) continue;
      const declared = contentProps[prop];
      if (declared !== undefined && declared !== null) style[cssProp] = String(declared);
    }

    return style;
  });

  /*
    The inner div restores pointer events, and for a reveal it is also the clip. `min-*: 0` is not
    optional: a grid item's automatic minimum size is its content, which would hold the track open
    at full size and defeat the whole thing.
  */
  const innerStyle = createMemo(() => {
    const style: Record<string, string> = { 'pointer-events': 'auto' };
    if (hasReveal) {
      style.overflow = 'hidden';
      style[revealsAxis('inline') ? 'min-width' : 'min-height'] = '0';
    }
    return style;
  });

  return (
    <Show when={shouldRender()} fallback={renderNode(node.props?.else as SchemaNode | undefined)}>
      <div style={wrapperStyle()}>
        <div style={innerStyle()}>{renderNode(contentNode)}</div>
      </div>
    </Show>
  );
}
