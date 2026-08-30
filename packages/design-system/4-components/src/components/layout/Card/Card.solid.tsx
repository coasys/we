export type * from './Card.types';
import { createLayoutComponent } from '../createLayoutComponent';
import type { CardProps } from './Card.types';

const render = createLayoutComponent<CardProps>({
  defaults: {
    // The named form of the chain this used to spell out. Same resolution, and now findable by
    // anything else that needs to round like the sheet it sits in.
    r: 'surface',
    p: 'var(--we-theme-surface-padding, var(--we-space-500))',
    gap: 'var(--we-theme-surface-gap, var(--we-space-400))',
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
