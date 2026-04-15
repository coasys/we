// Modals
export {
  CreateSpaceModalWidget,
  type CreateSpaceModalWidgetProps,
} from '../../widgets/modals/CreateSpaceModalWidget/CreateSpaceModalWidget.solid';

// Sidebars
export {
  SpaceSidebarWidget,
  type SpaceSidebarWidgetProps,
} from '../../widgets/sidebars/SpaceSidebarWidget/SpaceSidebarWidget.solid';
export {
  CollapsibleSidebar,
  CollapsibleSidebarContext,
  type CollapsibleSidebarProps,
  type CollapsibleSidebarItem,
} from '../../widgets/sidebars/CollapsibleSidebar';

// Panels
export { ChatPanel, type ChatPanelProps, type ChatMessage, type SessionInfo } from '../../widgets/panels/ChatPanel';

// Cesium
export { CesiumGlobe, type CesiumGlobeProps } from '../../widgets/cesium/CesiumGlobe/CesiumGlobe.solid';
export type {
  CesiumLayer,
  LayerFactory,
  LayerConfig,
  LayerContext,
  LayerEventBus,
  LayerStore,
  LayerMetadata,
  CameraState,
} from '../../widgets/cesium/CesiumGlobe/CesiumGlobe.types';

// Graph
export { GraphWidget, type GraphWidgetProps } from '../../widgets/graph/GraphWidget/GraphWidget.solid';
export { mockGraphData } from '../../widgets/graph/GraphWidget/mockData';
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
} from '../../widgets/graph/GraphWidget/GraphWidget.types';
