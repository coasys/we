// Modals
export { CreateSpaceModalWidget, type CreateSpaceModalWidgetProps } from './widgets/modals/CreateSpaceModalWidget';

// Sidebars
export { SpaceSidebarWidget, type SpaceSidebarWidgetProps } from './widgets/sidebars/SpaceSidebarWidget';
export {
  CollapsibleSidebar,
  CollapsibleSidebarContext,
  type CollapsibleSidebarProps,
  type CollapsibleSidebarItem,
} from './widgets/sidebars/CollapsibleSidebar';

// Cesium
export { CesiumGlobe, type CesiumGlobeProps } from './widgets/cesium/CesiumGlobe';
export type {
  CesiumLayer,
  LayerFactory,
  LayerConfig,
  LayerContext,
  LayerEventBus,
  LayerStore,
  LayerMetadata,
  CameraState,
} from './widgets/cesium/types';

// Graph
export { GraphWidget, type GraphWidgetProps } from './widgets/graph/GraphWidget';
export { mockGraphData } from './widgets/graph/mockData';
export type {
  GraphData,
  GraphNode,
  GraphEdge,
  NodeType,
  EdgeType,
  NodeStyleConfig,
  EdgeStyleConfig,
  LayoutConfig,
  InteractionConfig,
} from './widgets/graph/types';
