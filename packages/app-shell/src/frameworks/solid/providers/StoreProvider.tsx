import {
  AppStoreProvider,
  DatasetStoreProvider,
  EditSessionStoreProvider,
  PresenceStoreProvider,
  ProfileStoreProvider,
  RouteStoreProvider,
  SessionStoreProvider,
  SpaceStoreProvider,
  TemplateStoreProvider,
  ThemeStoreProvider,
} from '@solid/stores';
import { ParentProps } from 'solid-js';

import { BootController } from './BootController';
import { EditorHostAdapter } from './EditorHostAdapter';

export default function StoreProvider(props: ParentProps) {
  return (
    <RouteStoreProvider>
      {/* Session → Dataset → Profile is the dependency spine: everything below reads them. */}
      <SessionStoreProvider>
        <DatasetStoreProvider>
          <ProfileStoreProvider>
            <ThemeStoreProvider>
              <TemplateStoreProvider>
                <EditSessionStoreProvider>
                  <AppStoreProvider>
                    <SpaceStoreProvider>
                      {/* BootController composes the post-unlock load across the stores above —
                          it must mount beneath them all. Renders nothing. */}
                      <BootController />
                      {/* Innermost: presence follows the current dataset and the route, so it needs
                          the session/dataset stores and RouteStore above it. App-lifetime, not
                          view-lifetime — it must outlive navigation rather than being torn down
                          with a view. */}
                      {/* Innermost of all: the editor's host port is built from every store above
                          it, so it must sit below them all. It provides only a context — nothing
                          renders here — so a deployment that ships no editing surface pays a
                          context and nothing else. */}
                      <PresenceStoreProvider>
                        <EditorHostAdapter>{props.children}</EditorHostAdapter>
                      </PresenceStoreProvider>
                    </SpaceStoreProvider>
                  </AppStoreProvider>
                </EditSessionStoreProvider>
              </TemplateStoreProvider>
            </ThemeStoreProvider>
          </ProfileStoreProvider>
        </DatasetStoreProvider>
      </SessionStoreProvider>
    </RouteStoreProvider>
  );
}
