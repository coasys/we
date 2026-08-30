export type * from './Card.types';
import { createLayoutComponent } from '../createLayoutComponent';
import type { CardProps } from './Card.types';

const render = createLayoutComponent<CardProps>({
  defaults: {
    /*
      The named form of the chains this used to spell out, one per axis, identical in what they
      resolve to. Card is the whole reason the names exist: it is a layer-4 component, so it has no
      COMPONENT_CASCADE entry to inherit the surface family from and had to say so itself — and the
      only way to say it was a raw `var()` string, which is unfindable, unvalidated, and drifted
      from the primitives reading the same variables.
    */
    r: 'surface',
    p: 'surface',
    gap: 'surface',
    shadow: 'var(--we-theme-shadow, none)',
  },
  ownKeys: ['direction'],
  direction: (props) => props.direction ?? 'column',
  finalizeStyle: (style, props) => {
    // Apply surface opacity to background only (not element content) when bg is set
    // and the caller hasn't explicitly set opacity.
    if (props.opacity === undefined) {
      const styleRecord = style as Record<string, unknown>;
      const bgColor = styleRecord['background'] as string | undefined;
      // Gradients aren't <color> values — color-mix() only accepts real colors, so
      // wrapping a gradient reference in it produces an invalid declaration that gets
      // silently dropped, leaving the card with no background at all. Skip them.
      if (bgColor && !bgColor.startsWith('var(--we-gradient-')) {
        styleRecord['background'] =
          `color-mix(in srgb, ${bgColor} calc(var(--we-theme-surface-opacity, 1) * 100%), transparent)`;
        styleRecord['backdrop-filter'] = 'blur(var(--we-theme-surface-blur, 0px))';
      }
    }
    return style;
  },
});

/** @superclass DesignSystemElement */
export function Card(allProps: CardProps) {
  return render(allProps);
}
