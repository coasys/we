import type { SchemaNode } from '@we/schema-shared';

import { landingPageTemplate } from './about';

/**
 * The About page, shown over the boot screen.
 *
 * Someone meeting WE for the first time is asked to create an account before they have been told
 * what they are creating it in. This is the answer to that, reachable from the mark in the corner
 * and from a link in the welcome copy.
 *
 * ## Why a second host rather than one
 *
 * `TemplateLayout` renders shell views too, and this deliberately does not replace it. That one
 * injects per-view stores — `profile`, `settings` and `schema-tests` each need their own — which a
 * schema node cannot express. The About page needs none of that; it reads `shellStore` and nothing
 * else. So the two hosts differ in what they can offer, not in what they show: both render the same
 * `landingPageTemplate`, and the content has no idea which one mounted it.
 *
 * They cannot both be live at once, hence the `bootState` guard. `TemplateLayout` takes over the
 * moment the app is usable.
 *
 * ## Cost
 *
 * None at boot beyond what was already being paid. The schema is data, and it is already in the
 * entry chunk via `TemplateLayout`'s import of the same module. The expensive parts are components,
 * and they are already deferred: `WeCube` is registered as a lazy import, so three.js is only
 * fetched once a cube actually renders, and the imagery further down are `we-image` elements that
 * fetch on mount. Gating on an `$if` means none of that happens until someone asks for the page.
 *
 * The page's own "Back to WE" button calls `shellStore.closeShellView`, which closes this exactly as
 * it closes the in-app copy — and the label still reads correctly when what you return to is the
 * sign-in screen.
 */
export const aboutOverlay: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $and: [
        { $ne: [{ $store: 'sessionStore.bootState' }, 'ready'] },
        { $eq: [{ $store: 'shellStore.activeShellView' }, 'landing-page'] },
      ],
    },
    enterTransition: { type: 'fade', duration: 150 },
    then: {
      type: 'Column',
      props: {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        bg: 'neutral-50',
        // Above the boot screen, which is the thing it is covering.
        zIndex: 10000,
      },
      children: [landingPageTemplate],
    },
  },
};
