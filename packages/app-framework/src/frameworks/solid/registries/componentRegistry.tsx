import { BlockComposer } from '@we/block-solid';
import {
  countryOutlinesLayer,
  h3HexagonsLayer,
  type LayerFactory,
  proceduralStarsLayer,
  skyboxLayer,
  solarSystemLayer,
  userLocationsLayer,
} from '@we/cesium-layers';
import {
  Accordion,
  Breadcrumbs,
  Calendar,
  CircleButton,
  Column,
  Dialog,
  IconLabelButton,
  List,
  PopoverMenu,
  PopoverToggleMenu,
  PostCard,
  RerenderLog,
  Row,
  Stepper,
  Table,
  Timeline,
  ToastContainer,
} from '@we/components/solid';
import type { ComponentRegistry } from '@we/schema-solid';
import {
  CesiumGlobe,
  CollapsibleSidebar,
  CreateSpaceModalWidget,
  GraphWidget,
  mockGraphData,
  SpaceSidebarWidget,
} from '@we/widgets/solid';

import { CreateSpacePage } from '../pages/CreateSpacePage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const layerFactoryRegistry: Record<string, LayerFactory<any>> = {
  // Planet layers
  userLocationsLayer,
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
  Column,
  Dialog,
  Row,
  CircleButton,
  IconLabelButton,
  PopoverMenu,
  PopoverToggleMenu,
  PostCard,
  List,
  Stepper,
  Table,
  Timeline,
  ToastContainer,

  // @we/widgets
  CreateSpaceModalWidget,
  SpaceSidebarWidget,
  CollapsibleSidebar,
  // Inject layerFactoryRegistry dependency
  CesiumGlobe: (props) => <CesiumGlobe {...props} layerFactoryRegistry={layerFactoryRegistry} />,
  // Inject mockGraphData dependency
  GraphWidget: (props) => <GraphWidget {...props} data={props.data || mockGraphData} />,

  // @we/block-solid
  BlockComposer,

  // Pages
  CreateSpacePage,

  // Testing
  RerenderLog,
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
