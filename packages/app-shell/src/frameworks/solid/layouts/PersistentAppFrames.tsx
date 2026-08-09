/**
 * PersistentAppFrames
 *
 * Renders embedded external-app iframes (e.g. Flux) once, mounted alongside the
 * shell chrome in TemplateProvider — outside the template <Router>, which is
 * keyed on the active template id and fully remounts on template switches.
 * Living here instead of inside TemplateLayout keeps these iframes alive across
 * template switches (as they already are across space/route navigation), so an
 * embedded app in mid-use (e.g. an active call) isn't dropped when the user
 * switches templates.
 *
 * Positioning mirrors TemplateLayout's content viewport (same left/right offsets)
 * so the active app iframe lines up with the same viewport the template occupies.
 */
import type { Stores } from '@solid/types';
import { Column } from '@we/components/solid';
import { panelResizing } from '@we/editor/runtime';
import { For } from 'solid-js';

import { computeBottomOffset, computeLeftOffset, computeRightOffset, computeTopOffset } from './TemplateLayout';

export function PersistentAppFrames(props: { stores: Stores }) {
  const { stores } = props;

  return (
    <Column
      display={stores.appStore.activeAppId() ? 'block' : 'none'}
      position="fixed"
      top={computeTopOffset(stores)}
      bottom={computeBottomOffset(stores)}
      left={computeLeftOffset(stores)}
      right={computeRightOffset(stores)}
      transition={panelResizing() ? 'none' : 'top 300ms ease, right 300ms ease, bottom 300ms ease, left 300ms ease'}
    >
      {/* opacity:0/1 creates an explicit GPU compositing layer (unlike visibility:hidden
           which does not). will-change:opacity pre-allocates that layer so the browser
           never needs to rasterize on show — it's a pure compositor operation. */}
      <For each={stores.appStore.apps()}>
        {(app) => (
          <Column
            position="absolute"
            top="0"
            left="0"
            opacity={stores.appStore.activeAppId() === app.id ? 1 : 0}
            pointerEvents={stores.appStore.activeAppId() === app.id ? 'auto' : 'none'}
            styles={{ 'will-change': 'opacity' }}
            width="100%"
            height="100%"
          >
            <we-iframe src={app.url} title={app.name} allow={app.allow} width="100%" height="100%" display="block" />
          </Column>
        )}
      </For>
    </Column>
  );
}
