import {
  AudioDisplay,
  BlockComposer,
  BlockRenderer,
  CalloutDisplay,
  CodeDisplay,
  EmbedDisplay,
  EventDisplay,
  FileDisplay,
  ImageDisplay,
  LinkDisplay,
  LocationDisplay,
  TagDisplay,
  TaskDisplay,
  VideoDisplay,
} from '@we/block-solid';
import {
  AvatarStack,
  Calendar,
  Card,
  CodeEditor, // Plainly, though it carries CodeMirror — see the registry entry below.
  CollapsedContent,
  Column,
  Combobox,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  RerenderLog,
  Row,
  Search,
  Select,
  SignalControl,
  ToastContainer,
} from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import { lazy } from 'solid-js';

/**
 * Components fetched when something first renders them, rather than before anything renders at all.
 *
 * Each of these carries a dependency far larger than the app around it, and each serves a mode most
 * sessions never enter. Loading them eagerly put that weight in front of first paint for everyone.
 *
 * This is code-splitting inside one build, not loading separately-built bundles: Rollup still gives
 * every chunk the same `solid-js`, so the single-instance guarantee the module system depends on is
 * untouched — see the note in `bundledModules.ts`, which is about the other thing.
 */

/** Cesium, three, and the layer stack — several times the size of the rest of the app. */
const CesiumGlobeOnDemand = lazy(async () => {
  const [{ CesiumGlobe }, { layerFactoryRegistry }] = await Promise.all([
    import('@we/globe-widget'),
    import('@we/module-globe/layers'),
  ]);
  return {
    default: (props: Record<string, unknown>) => <CesiumGlobe {...props} layerFactoryRegistry={layerFactoryRegistry} />,
  };
});

/** The graph engine, its expanders, layouts and d3-force — loaded when a template first draws one. */
const GraphViewOnDemand = lazy(() => import('../components/GraphHost'));

/*
  The body of a panel an interface declared, rendered with the interface's own grants.

  Registered as a component rather than inlined into the frame because that is what a bag switch
  needs: `RenderSchema` takes a bag per call site, and a component is the only thing that can make a
  second call from inside one tree. See `shared/registries/templateBag.ts`.
*/
const TemplatePanelBodyOnDemand = lazy(() => import('../components/TemplatePanelBody'));

/*
  A `$panels` outlet — a lane in the template's own flow. The marker is rewritten to this name by
  `resolveParts` before the renderer sees it, the way `$part` is expanded, because it has to read the
  shell's placements and render sections with the template's bag, which only a host component can.
*/
const PanelLaneOnDemand = lazy(() => import('../components/PanelLane'));

/** One decorative component, and `three` behind it. */
const WeCubeOnDemand = lazy(() => import('../components/3d/WeCube'));

/** The editing surface — CodeMirror and Prism arrive with it, once a template is being edited. */
const EditingBar = lazy(() => import('@we/editor').then((m) => ({ default: m.EditingBar })));
const TemplateCard = lazy(() => import('@we/editor').then((m) => ({ default: m.TemplateCard })));
const AiPanel = lazy(() => import('@we/editor/ai').then((m) => ({ default: m.AiPanel })));
/*
  One entry per editor panel, because each is its own dock now.

  They arrived as a single `RightPanelContainer` when the editor owned its own rails, widths and
  position at the right edge. The shell places them now — the same grip, snap targets, resize and
  maximise every other panel has — so what it needs from this package is the contents of each, named
  separately so a dock's node can say which one it holds.
*/
const EditorCodePanel = lazy(() => import('@we/editor').then((m) => ({ default: m.CodePanel })));
const EditorInspectorPanel = lazy(() => import('@we/editor').then((m) => ({ default: m.InspectorPanel })));
const EditorThemePanel = lazy(() => import('@we/editor').then((m) => ({ default: m.ThemePanel })));

export const componentRegistry: ComponentRegistry = {
  // @we/components
  AvatarStack,
  Calendar,
  Card,
  /*
    A read-only code view, and CodeMirror behind it.

    Registered because the generated component reference already documents `CodeEditor` as available
    to schemas, and it was not — so a schema reaching for it rendered nothing at all, silently. The
    docs promised it; this makes the promise true.

    NOT `lazy()`, though it is the largest thing here. It was, and the wrapper was inert:
    `@we/components` builds with `splitting: false`, so `@we/components/solid` is a single module —
    and this file, along with a dozen others in the shell, already imports it statically for `Column`
    and `Row`. Rollup said so on every app build (INEFFECTIVE_DYNAMIC_IMPORT) and split nothing.

    Nothing moves by dropping it: `CodeEditor` fetches CodeMirror itself, in `onMount`, so the
    ~270 KB stays out of the eager graph either way. The deferral belongs in the component, which is
    the only place it survives a consumer that also wants a `Column`.
  */
  CodeEditor,
  CollapsedContent,
  Column,
  Combobox,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  Row,
  Search,
  Select,
  ToastContainer,

  // @we/editor
  AiPanel,
  EditorCodePanel,
  EditorInspectorPanel,
  EditorThemePanel,
  // Contributed by @we/module-globe — registered here rather than injected by the module registry so
  // the static registry stays the single source for what a template may name. When modules become
  // installable this entry comes from moduleRegistry.components() instead.
  CesiumGlobe: CesiumGlobeOnDemand,
  // Contributed by @we/module-graph. Registered here for the same reason the globe is: this registry
  // is the single source for what a template may name.
  GraphView: GraphViewOnDemand,
  // Host-only: a template names panels, never this. It is what a panel's *frame* wraps around the
  // template's node so the two can be rendered with different grants.
  TemplatePanelBody: TemplatePanelBodyOnDemand,
  // Host-only for the same reason: a template writes `$panels`, never this.
  PanelLane: PanelLaneOnDemand,
  SignalControl,

  // @we/block-solid
  BlockComposer,
  BlockRenderer,
  AudioDisplay,
  CalloutDisplay,
  CodeDisplay,
  EmbedDisplay,
  EventDisplay,
  FileDisplay,
  ImageDisplay,
  LinkDisplay,
  LocationDisplay,
  TagDisplay,
  TaskDisplay,
  VideoDisplay,

  // Marketplace
  TemplateCard,

  // Shell
  EditingBar,

  /*
    Testing.

    A perf debugging tool — logging on every mount is its purpose, which is exactly why production
    templates should not be able to reach it.

    Build-gated rather than gated on `sessionStore.devTools`, and deliberately not moved onto that
    switch with the rest of the developer affordances. The switch governs what *chrome* shows; this
    is a word in the vocabulary a template is rendered against, and the registry is built once. A
    template naming an unregistered component renders nothing and warns, which is the right answer
    for a production build and the wrong one for a developer who has merely muted their own tools.
  */
  ...(import.meta.env.DEV ? { RerenderLog } : {}),

  // 3D
  WeCube: WeCubeOnDemand,
};
