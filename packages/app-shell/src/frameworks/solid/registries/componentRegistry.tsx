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
  Accordion,
  AvatarStack,
  Breadcrumbs,
  Calendar,
  Card,
  CircleButton,
  CollapsedContent,
  Column,
  Combobox,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  IconLabelButton,
  List,
  PostCard,
  RerenderLog,
  Row,
  Search,
  Select,
  SignalControl,
  Stepper,
  Table,
  Timeline,
  ToastContainer,
} from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import { CollapsibleSidebar, GraphWidget, mockGraphData, SpaceSidebarWidget } from '@we/widgets/solid';
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

/** One decorative component, and `three` behind it. */
const WeCubeOnDemand = lazy(() => import('../components/3d/WeCube'));

/** The editing surface — CodeMirror and Prism arrive with it, once a template is being edited. */
const DesignToolbar = lazy(() => import('@we/editor').then((m) => ({ default: m.DesignToolbar })));
const RightPanelContainer = lazy(() => import('@we/editor').then((m) => ({ default: m.RightPanelContainer })));
const TemplateCard = lazy(() => import('@we/editor').then((m) => ({ default: m.TemplateCard })));
const AiPanel = lazy(() => import('@we/editor/ai').then((m) => ({ default: m.AiPanel })));

export const componentRegistry: ComponentRegistry = {
  // @we/components
  Accordion,
  AvatarStack,
  Breadcrumbs,
  Calendar,
  Card,
  CircleButton,
  CollapsedContent,
  Column,
  Combobox,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  IconLabelButton,
  List,
  PostCard,
  Row,
  Search,
  Select,
  Stepper,
  Table,
  Timeline,
  ToastContainer,

  // @we/widgets
  AiPanel,
  RightPanelContainer,
  SpaceSidebarWidget,
  CollapsibleSidebar,
  // Contributed by @we/module-globe — registered here rather than injected by the module registry so
  // the static registry stays the single source for what a template may name. When modules become
  // installable this entry comes from moduleRegistry.components() instead.
  CesiumGlobe: CesiumGlobeOnDemand,
  // Contributed by @we/module-graph. Registered here for the same reason the globe is: this registry
  // is the single source for what a template may name.
  GraphView: GraphViewOnDemand,
  GraphWidget: (props) => <GraphWidget {...props} data={props.data || mockGraphData} />,
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
  DesignToolbar,

  // Testing
  RerenderLog,

  // 3D
  WeCube: WeCubeOnDemand,
};
