export type * from './Card.types';
import { createLayoutComponent } from '../createLayoutComponent';
import type { CardProps } from './Card.types';

const render = createLayoutComponent<CardProps>({
  /*
    A Card is a surface — said once, the way `we-modal` says it in COMPONENT_CASCADE, rather than
    once per axis. This was three raw `var()` chains, then three family names, and both were the
    same statement repeated because layer 4 had no way to make it.
  */
  family: 'surface',
  name: 'card',
  defaults: {
    // Not a family axis: shadow has no group, so a theme reaches it through this one variable.
    shadow: 'var(--we-theme-shadow, none)',
  },
  ownKeys: ['direction'],
  direction: (props) => props.direction ?? 'column',
  finalizeStyle: (style, props) => {
    // Apply surface opacity to background only (not element content) when bg is set
    // and the caller hasn't explicitly set opacity.
    if (props.opacity === undefined) {
      // On the colour alone: the image a surface wears (a theme's surface image, a gradient bg) is
      // its own layer and must not go through color-mix, which takes colours only. This read
      // `background`, which nothing writes any more, so the theme's surface opacity never reached a
      // card at all.
      const styleRecord = style as Record<string, unknown>;
      const bgColor = styleRecord['background-color'] as string | undefined;
      if (bgColor) {
        styleRecord['background-color'] =
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
