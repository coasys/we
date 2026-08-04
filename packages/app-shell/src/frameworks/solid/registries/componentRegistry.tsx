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
import { DesignToolbar } from '@we/editor';
import { RightPanelContainer } from '@we/editor';
import { TemplateCard } from '@we/editor';
import { AiPanel } from '@we/editor/ai';
import type { ComponentRegistry } from '@we/schema-solid';
import { CollapsibleSidebar, GraphWidget, mockGraphData, SpaceSidebarWidget } from '@we/widgets/solid';
import { lazy } from 'solid-js';

/**
 * The globe arrives on demand.
 *
 * Cesium, three, and the layer stack behind them are the largest thing this app can load — several
 * times the rest of the bundle put together — and a template only needs them once it renders a
 * globe, which most sessions never do. Importing them here would put that cost in front of first
 * paint for everyone.
 *
 * This is code-splitting within one build, not loading a separately-built bundle: Rollup still
 * gives every chunk the same `solid-js`, so the single-instance guarantee the module system relies
 * on is untouched.
 */
/** Same reasoning as the globe: one decorative component, and `three` behind it. */
const WeCubeOnDemand = lazy(() => import('../components/3d/WeCube'));

const CesiumGlobeOnDemand = lazy(async () => {
  const [{ CesiumGlobe }, { layerFactoryRegistry }] = await Promise.all([
    import('@we/globe-widget'),
    import('@we/module-globe/layers'),
  ]);
  return {
    default: (props: Record<string, unknown>) => <CesiumGlobe {...props} layerFactoryRegistry={layerFactoryRegistry} />,
  };
});

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
