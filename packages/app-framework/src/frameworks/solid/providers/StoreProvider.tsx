import {
  AdamStoreProvider,
  AiStoreProvider,
  AppStoreProvider,
  AssistantStoreProvider,
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
                  <AssistantStoreProvider>{props.children}</AssistantStoreProvider>
                </SpaceStoreProvider>
              </AppStoreProvider>
            </AiStoreProvider>
          </TemplateStoreProvider>
        </ThemeStoreProvider>
      </AdamStoreProvider>
    </RouteStoreProvider>
  );
}
