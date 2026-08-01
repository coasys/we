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
import { layerFactoryRegistry } from '@we/module-globe';
import type { ComponentRegistry } from '@we/schema-solid';
import { CesiumGlobe, CollapsibleSidebar, GraphWidget, mockGraphData, SpaceSidebarWidget } from '@we/widgets/solid';

import WeCube from '../components/3d/WeCube';
import { AiPanel } from '../components/editor/AiPanel';
import { DesignToolbar } from '../components/editor/DesignToolbar';
import { RightPanelContainer } from '../components/editor/RightPanelContainer';
import { TemplateCard } from '../components/marketplace/TemplateCard';

/**
 * The globe's layer set moved to `@we/module-globe` — the module owns it now. Re-exported so existing
 * importers keep working.
 */
export { layerFactoryRegistry };

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
