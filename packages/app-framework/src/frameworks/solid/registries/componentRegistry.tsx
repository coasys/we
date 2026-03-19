import { BlockComposer } from '@we/block-solid';
import { CreateSpacePage } from '../pages/CreateSpacePage';
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
  CircleButton,
  Column,
  IconLabelButton,
  PopoverMenu,
  PopoverToggleMenu,
  PostCard,
  RerenderLog,
  Row,
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
  // @we/primitives
  'we-text': (props) => <we-text {...props}>{props.children}</we-text>,
  'we-button': (props) => <we-button {...props}>{props.children}</we-button>,
  'we-icon': (props) => <we-icon {...props} />,
  'we-image': (props) => <we-image {...props} />,
  'we-tabs': (props) => <we-tabs {...props}>{props.children}</we-tabs>,
  'we-tab': (props) => <we-tab {...props}>{props.children}</we-tab>,
  'we-spinner': (props) => <we-spinner {...props} />,
  'we-input': (props) => <we-input {...props} />,
  'we-modal': (props) => <we-modal {...props}>{props.children}</we-modal>,
  'we-iframe': (props) => <we-iframe {...props} />,
  'we-avatar': (props) => <we-avatar {...props} />,

  // @we/components
  Column,
  Row,
  CircleButton,
  IconLabelButton,
  PopoverMenu,
  PopoverToggleMenu,
  PostCard,

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
