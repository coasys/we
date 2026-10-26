import type { SchemaNode } from '@we/schema-shared';

/**
 * The app's mark: WE's own, drawn through the theme's gradient — or, while an app in use brings its own
 * brand (`templateStore.brand`), that app's, drawn as it is.
 *
 * One fragment for every place the shell shows its mark, so a whitelabelled app changes them all and
 * none of them is left saying WE. The gradient is WE's mark's alone: a brand's mark carries its own
 * colours, and masking it with the theme's would repaint it.
 *
 * `wordmark` prefers the brand's wordmark where it has one, for the places with room for the name.
 */
export function brandMark(options: {
  width: string;
  height: string;
  gradient: string;
  wordmark?: boolean;
}): SchemaNode {
  const own = options.wordmark
    ? 'templateStore.brand.wordmark ? templateStore.brand.wordmark : templateStore.brand.mark'
    : 'templateStore.brand.mark';
  return {
    type: 'we-image',
    props: {
      src: { $: `templateStore.brand.active && (${own}) ? ${own} : '/we-text.svg'` },
      alt: { $: 'templateStore.brand.name' },
      width: options.width,
      height: options.height,
      gradient: { $: `templateStore.brand.active && (${own}) ? '' : '${options.gradient}'` },
    },
  };
}
