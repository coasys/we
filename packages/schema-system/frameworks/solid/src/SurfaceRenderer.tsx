import { surfaceStyles } from '@we/schema-shared';

import { createSurface } from './createSurface';
import type { RendererOutput, SchemaNode } from './types';

/**
 * How a surface fills what it was given.
 *
 * Three of the four host sites replace a `Column`, so this reproduces one. A template dropping a
 * surface somewhere else overrides the lot through `styles`, which is merged over this.
 */
const FILL: Record<string, string> = {
  display: 'flex',
  'flex-direction': 'column',
  width: '100%',
  height: '100%',
  'min-width': '0',
  'min-height': '0',
};

/**
 * `$surface` — a box the content inside it can measure itself against.
 *
 * Two elements, because **an element cannot query itself**: `@container` matches descendants of a
 * container, never the container. So the outer box declares the container and the inner box is the
 * first element able to see it. The inner box is `display: contents`, so a surface adds exactly one
 * box rather than two and the children lay out inside the outer exactly as they would have inside
 * whatever box was there before — which is what makes this droppable anywhere without rearranging
 * what it wraps.
 *
 * The tier is decided by CSS and read back rather than computed here; see `createSurface` and
 * `@we/design-utils`' surface module for why that distinction matters at the boundaries.
 *
 * Nesting is meaningful and needs nothing special: the container is named, so an inner surface
 * shadows an outer one for the CSS rules `*UpProps` compiles to, and `as` names the context key so
 * a template can still address both.
 */
export function SurfaceRenderer(props: {
  node: SchemaNode;
  context: Record<string, unknown>;
  renderNode: (node: SchemaNode, context: Record<string, unknown>) => RendererOutput;
}): RendererOutput {
  const asKey = String(props.node.props?.as ?? 'surface');
  const { surface, outerRef, innerRef, outerAttrs, innerAttrs } = createSurface();

  const childContext = { ...props.context, [asKey]: surface };
  const style = { ...FILL, ...surfaceStyles(), ...((props.node.props?.styles as Record<string, string>) ?? {}) };

  return (
    <div {...outerAttrs} style={style} ref={outerRef}>
      <div {...innerAttrs} ref={innerRef}>
        {(props.node.children as SchemaNode[] | undefined)?.map((child) => props.renderNode(child, childContext))}
      </div>
    </div>
  );
}
