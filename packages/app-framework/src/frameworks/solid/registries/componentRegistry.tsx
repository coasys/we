import { BlockComposer, BlockRenderer } from '@we/block-solid';
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
  Breadcrumbs,
  Calendar,
  CircleButton,
  Column,
  Dialog,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  IconLabelButton,
  List,
  PostCard,
  RerenderLog,
  Row,
  SignalControl,
  Stepper,
  Table,
  Timeline,
  ToastContainer,
} from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import {
  CesiumGlobe,
  ChatPanel,
  CollapsibleSidebar,
  GraphWidget,
  mockGraphData,
  SpaceSidebarWidget,
} from '@we/widgets/solid';

import ComplexWeCube from '../components/3d/ComplexWeCube';
import WeCube from '../components/3d/WeCube';
import WeNetwork from '../components/3d/WeNetwork';
import { BenchmarkTimer } from '../components/BenchmarkTimer';

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
  Breadcrumbs,
  Calendar,
  CircleButton,
  Column,
  Dialog,
  DropdownMenu,
  EditableImage,
  FlipCard,
  Grid,
  IconLabelButton,
  List,
  PostCard,
  Row,
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

  // Testing
  BenchmarkTimer,
  RerenderLog,

  // 3D
  WeCube,
  ComplexWeCube,
  WeNetwork,
};

// Ideas:
// Hero — common landing section (title, subtitle, image, cta)
// Card — repeatable content block (title, image, footer, actions)
// Image/Media — src, alt, ratio, fit
// Heading / Text primitives — H1..H4, Paragraph (gives AI typographic control)
// List / Repeat (data-driven) — itemTemplate + itemsSource ($store/$map)
// Nav / Menu — items array for site structure
// Modal / Drawer — overlay patterns
// Form primitives (Input, Select, Button) or a Form container (fields + onSubmit)
// Badge / Tag / Avatar — small metadata visuals
// DataTable (if you have tabular content use-cases)
