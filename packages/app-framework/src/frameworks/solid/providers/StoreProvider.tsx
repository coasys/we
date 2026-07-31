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
                  <PresenceStoreProvider>{props.children}</PresenceStoreProvider>
                </SpaceStoreProvider>
              </AppStoreProvider>
            </AiStoreProvider>
          </TemplateStoreProvider>
        </ThemeStoreProvider>
      </AdamStoreProvider>
    </RouteStoreProvider>
  );
}
