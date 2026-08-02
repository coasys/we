import {
  AdamStoreProvider,
  AiStoreProvider,
  AppStoreProvider,
  PresenceStoreProvider,
  RouteStoreProvider,
  SpaceStoreProvider,
  TemplateStoreProvider,
  ThemeStoreProvider,
} from '@solid/stores';
import { ParentProps } from 'solid-js';

import { EditorHostAdapter } from './EditorHostAdapter';

export default function StoreProvider(props: ParentProps) {
  return (
    <RouteStoreProvider>
      <AdamStoreProvider>
        <ThemeStoreProvider>
          <TemplateStoreProvider>
            <AiStoreProvider>
              <AppStoreProvider>
                <SpaceStoreProvider>
                  {/* Innermost: presence follows the current perspective and the route, so it needs
                      AdamStore and RouteStore above it. App-lifetime, not view-lifetime — it must
                      outlive navigation rather than being torn down with a view. */}
                  {/* Innermost of all: the editor's host port is built from every store above it,
                      so it must sit below them all. It provides only a context — nothing renders
                      here — so a deployment that ships no editing surface pays a context and
                      nothing else. */}
                  <PresenceStoreProvider>
                    <EditorHostAdapter>{props.children}</EditorHostAdapter>
                  </PresenceStoreProvider>
                </SpaceStoreProvider>
              </AppStoreProvider>
            </AiStoreProvider>
          </TemplateStoreProvider>
        </ThemeStoreProvider>
      </AdamStoreProvider>
    </RouteStoreProvider>
  );
}
