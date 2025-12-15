import {
  AdamStoreProvider,
  AiStoreProvider,
  ModalStoreProvider,
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
              <ModalStoreProvider>
                <SpaceStoreProvider>{props.children}</SpaceStoreProvider>
              </ModalStoreProvider>
            </AiStoreProvider>
          </TemplateStoreProvider>
        </ThemeStoreProvider>
      </AdamStoreProvider>
    </RouteStoreProvider>
  );
}
