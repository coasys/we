import {
  AccountStoreProvider,
  AppStoreProvider,
  DatasetStoreProvider,
  EditorStoreProvider,
  PresenceStoreProvider,
  ProfileStoreProvider,
  RecordStoreProvider,
  RouteStoreProvider,
  RuntimeStoreProvider,
  SessionStoreProvider,
  ShapeStoreProvider,
  ShellStoreProvider,
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
      <ShellStoreProvider>
        {/* Above Session, and outside it: accounts are directories on disk, readable with no
            executor running. The boot screen needs them while the session is still locked. */}
        <AccountStoreProvider>
          {/* Session → Dataset → Profile is the dependency spine: everything below reads them. */}
          <SessionStoreProvider>
            {/* Directly beneath Session: it reads only the port bundle, and its consent subscription
              must be live before anything below it can mount an embedded app that asks for
              credentials. */}
            <RuntimeStoreProvider>
              <DatasetStoreProvider>
                {/* Directly beneath Dataset: the shape adoption rail follows the current dataset,
                    and everything below that renders a space may query the entities it registers. */}
                <ShapeStoreProvider>
                  {/* Beneath Shape: it offers a form for every model this space carries, which is
                      exactly the list the adoption rail above assembles. */}
                  <RecordStoreProvider>
                    <ProfileStoreProvider>
                      <ThemeStoreProvider>
                        <TemplateStoreProvider>
                          <EditorStoreProvider>
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
                          </EditorStoreProvider>
                        </TemplateStoreProvider>
                      </ThemeStoreProvider>
                    </ProfileStoreProvider>
                  </RecordStoreProvider>
                </ShapeStoreProvider>
              </DatasetStoreProvider>
            </RuntimeStoreProvider>
          </SessionStoreProvider>
        </AccountStoreProvider>
      </ShellStoreProvider>
    </RouteStoreProvider>
  );
}
