import { launcherUIRegistry } from '@shared/registries/launcherUIRegistry';
import { getModel, getModelForPerspective } from '@shared/registries/modelRegistry';
import { createTestStore } from '@shared/schemas/shell/tests/testStore';
import { componentRegistry as registry } from '@solid/registries/componentRegistry';
import {
  useAdamStore,
  useAiStore,
  useAppStore,
  useRouteStore,
  useSpaceStore,
  useTemplateStore,
  useThemeStore,
} from '@solid/stores';
import type { Stores } from '@solid/types';
import { Route, Router } from '@solidjs/router';
import { toastService } from '@we/components/solid';
import type { TemplateSchema } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { onMount, Show } from 'solid-js';

import { SHELL_SIDEBAR_WIDTH, TemplateLayout } from '../layouts/TemplateLayout';
import { buildRoutes } from '../utils/buildRoutes';

export default function TemplateProvider() {
  // Stores
  const adamStore = useAdamStore();
  const aiStore = useAiStore();
  const appStore = useAppStore();
  const spaceStore = useSpaceStore();
  const themeStore = useThemeStore();
  const templateStore = useTemplateStore();
  const routeStore = useRouteStore();

  // Set CSS custom property on :root so position:fixed elements (e.g. CesiumGlobe canvas)
  // can consume the sidebar width without hard-coding it.
  onMount(() => {
    document.documentElement.style.setProperty('--we-sidebar-width', SHELL_SIDEBAR_WIDTH);
  });

  // Test store — isolated mock data + test perspective for schema test templates
  const testStore = createTestStore(adamStore.testPerspective);
  testStore.benchSetNavigate((to: string) => routeStore.navigate(to));

  // Console store for debugging $action calls in schema
  const consoleStore = {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
  };

  // Model store — wraps Ad4m static model methods with automatic perspective injection
  const modelStore = {
    create: (modelName: string, data: Record<string, unknown> = {}, options?: Record<string, unknown>) => {
      const Model = getModel(modelName);
      return Model.create(adamStore.currentPerspective()!, data, options);
    },
    update: (modelName: string, id: string, data: Record<string, unknown>) => {
      const Model = getModel(modelName);
      return Model.update(adamStore.currentPerspective()!, id, data);
    },
    delete: (modelName: string, id: string) => {
      const Model = getModel(modelName);
      return Model.delete(adamStore.currentPerspective()!, id);
    },
  };

  const stores: Stores = {
    adamStore,
    aiStore,
    appStore,
    spaceStore,
    themeStore,
    templateStore,
    routeStore,
    consoleStore,
    testStore,
    model: modelStore,
    $getModel: getModel,
    $getModelForPerspective: getModelForPerspective,
    $onError: (msg: string) => toastService.error(msg),
  };

  // Shell chrome — boot screen + sidebar + AI chat panel.
  // Rendered once outside the keyed Router so it never remounts on template switches.
  const shellSchema: TemplateSchema = {
    meta: { name: 'Shell', description: 'App shell chrome', icon: '' },
    children: [launcherUIRegistry.bootScreen, launcherUIRegistry.shell, launcherUIRegistry.aiChatSidebar],
  };

  const notFoundNode = {
    type: 'Column',
    props: { ax: 'center', bg: 'neutral-0', p: '500' },
    children: [{ type: 'we-text', props: { size: '600' }, children: ['Page not found :_('] }],
  };

  const templateSchema = templateStore.currentTemplate;

  // TemplateLayout receives stores via closure — SolidJS Router requires `root` to be
  // a component type, so we wrap it to pass stores through.
  const Layout = (props: { children?: unknown }) => TemplateLayout({ stores, children: props.children as never });

  return (
    <>
      {/* Shell chrome — stable, never remounts */}
      <RenderSchema node={shellSchema} stores={stores} registry={registry} />

      {/* Router — keyed on template ID so buildRoutes reruns when the template changes.
           Template switching is a rare intentional action; the full remount is acceptable. */}
      <Show when={templateSchema.id || 'empty'} keyed>
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        {(_id) => (
          <Router root={Layout}>
            {buildRoutes(stores, templateSchema.routes ?? [])}
            <Route
              path="*"
              component={() =>
                templateSchema.routes?.length ? RenderSchema({ node: notFoundNode, stores, registry }) : null
              }
            />
          </Router>
        )}
      </Show>
    </>
  );
}
