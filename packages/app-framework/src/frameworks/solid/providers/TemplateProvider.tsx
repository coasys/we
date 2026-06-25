import type { PerspectiveProxy } from '@coasys/ad4m';
import { getModel, getModelForPerspective } from '@shared/registries/modelRegistry';
import { shellRegistry } from '@shared/registries/shellRegistry';
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

  // Console store for debugging $action calls in schema
  const consoleStore = {
    log: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
    info: (...args: unknown[]) => console.info(...args),
  };

  // Model store — wraps Ad4m static model methods with automatic perspective injection.
  // Pass `{ perspective: 'store.path' }` in options to target a different perspective
  // (e.g. 'adamStore.rootPerspective' for we-root models like AgentProfile).
  const modelStore = {
    create: (modelName: string, data: Record<string, unknown> = {}, options?: Record<string, unknown>) => {
      const [Model, p] = resolve(modelName, options as { perspective?: string });
      const rest = Object.fromEntries(Object.entries(options ?? {}).filter(([k]) => k !== 'perspective'));
      return Model.create(p, data, Object.keys(rest).length ? rest : undefined);
    },
    update: (modelName: string, id: string, data: Record<string, unknown>, options?: { perspective?: string }) => {
      const [Model, p] = resolve(modelName, options);
      return Model.update(p, id, data);
    },
    delete: (modelName: string, id: string, options?: { perspective?: string }) => {
      const [Model, p] = resolve(modelName, options);
      return Model.delete(p, id);
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
    model: modelStore,
    $getModel: getModel,
    $getModelForPerspective: getModelForPerspective,
    $onError: (msg: string) => toastService.error(msg),
  };

  // Resolves a dot-path string like 'adamStore.rootPerspective' against the stores object.
  // Only called at action-dispatch time, so `stores` is always fully initialized.
  function resolvePerspective(path?: string): PerspectiveProxy | null {
    if (!path) return null;
    const [storeName, ...rest] = path.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let val: any = (stores as Record<string, unknown>)[storeName];
    for (const key of rest) val = val?.[key];
    return typeof val === 'function' ? val() : (val ?? null);
  }

  function resolve(modelName: string, opts?: { perspective?: string }) {
    return [getModel(modelName), resolvePerspective(opts?.perspective) ?? adamStore.currentPerspective()!] as const;
  }

  // Shell chrome — boot screen + sidebar + template editor.
  // Rendered once outside the keyed Router so it never remounts on template switches.
  const shellSchema: TemplateSchema = {
    meta: { name: 'Shell', description: 'App shell chrome', icon: '' },
    children: [shellRegistry.bootScreen, shellRegistry.sidebar, shellRegistry.templateEditor],
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
