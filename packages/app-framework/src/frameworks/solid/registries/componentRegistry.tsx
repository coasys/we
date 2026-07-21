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
import { CesiumGlobe, CollapsibleSidebar, GraphWidget, mockGraphData, SpaceSidebarWidget } from '@we/widgets/solid';

import WeCube from '../components/3d/WeCube';
import { AiPanel } from '../components/editor/AiPanel';
import { DesignToolbar } from '../components/editor/DesignToolbar';
import { RightPanelContainer } from '../components/editor/RightPanelContainer';
import { TemplateCard } from '../components/marketplace/TemplateCard';

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

  // Marketplace
  TemplateCard,

  // Shell
  DesignToolbar,

  // Testing
  RerenderLog,

  // 3D
  WeCube,
};
