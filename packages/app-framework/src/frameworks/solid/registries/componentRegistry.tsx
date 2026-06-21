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
  countryOutlinesLayer,
  h3HexagonsLayer,
  type LayerFactory,
  pointLocationsLayer,
  proceduralStarsLayer,
  skyboxLayer,
  solarSystemLayer,
} from '@we/cesium-layers';
import {
  Accordion,
  AvatarStack,
  Breadcrumbs,
  Calendar,
  CircleButton,
  CollapsedContent,
  Column,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  IconLabelButton,
  List,
  PostCard,
  RerenderLog,
  Row,
  SearchInput,
  SignalControl,
  Stepper,
  Table,
  Timeline,
  ToastContainer,
} from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import { CesiumGlobe, CollapsibleSidebar, GraphWidget, mockGraphData, SpaceSidebarWidget } from '@we/widgets/solid';

import WeCube from '../components/3d/WeCube';
import { BenchmarkTimer } from '../components/BenchmarkTimer';
import { ChatPanel } from '../components/ChatPanel';
import { TemplateSwitcherChip } from '../components/TemplateSwitcherChip';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const layerFactoryRegistry: Record<string, LayerFactory<any>> = {
  // Planet layers
  pointLocationsLayer,
  countryOutlinesLayer,
  h3HexagonsLayer,
  // Background layers
  skyboxLayer,
  proceduralStarsLayer,
  solarSystemLayer,
};

export const componentRegistry: ComponentRegistry = {
  // @we/components
  Accordion,
  AvatarStack,
  Breadcrumbs,
  Calendar,
  CircleButton,
  CollapsedContent,
  Column,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  IconLabelButton,
  List,
  PostCard,
  Row,
  SearchInput,
  Stepper,
  Table,
  Timeline,
  ToastContainer,

  // @we/widgets
  ChatPanel,
  SpaceSidebarWidget,
  CollapsibleSidebar,
  CesiumGlobe: (props) => <CesiumGlobe {...props} layerFactoryRegistry={layerFactoryRegistry} />,
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

  // Shell
  TemplateSwitcherChip,

  // Testing
  BenchmarkTimer,
  RerenderLog,

  // 3D
  WeCube,
};
