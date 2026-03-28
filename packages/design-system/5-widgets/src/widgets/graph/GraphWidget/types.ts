/**
 * Graph Widget Types
 */

export type NodeType = 'user' | 'space' | 'post';
export type EdgeType = 'follows' | 'member-of' | 'posted-in' | 'commented-on';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  color?: string;
  size?: number;
  avatar?: string;
  // D3 force simulation adds these
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: EdgeType;
  label?: string;
  color?: string;
  width?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NodeStyleConfig {
  size?: (node: GraphNode) => number;
  color?: (node: GraphNode) => string;
  label?: (node: GraphNode) => string;
  showLabel?: boolean;
  labelColor?: string | ((node: GraphNode) => string);
  labelBackgroundColor?: string | ((node: GraphNode) => string);
  labelFontSize?: number;
}

export interface EdgeStyleConfig {
  width?: (edge: GraphEdge) => number;
  color?: (edge: GraphEdge) => string;
  showLabel?: boolean;
}

export interface LayoutConfig {
  type?: 'force' | 'static';
  strength?: number;
  distance?: number;
  centerForce?: number;
  chargeStrength?: number;
}

export interface InteractionConfig {
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  enableZoom?: boolean;
  enablePan?: boolean;
}

/**
 * @ai 2D force-directed graph visualization using D3-force layout and Canvas rendering.
 * Displays typed nodes (user, space, post) and edges (follows, member-of, etc.)
 * with configurable styling, layout forces, and interaction handlers.
 */
export interface GraphWidgetProps {
  /** Graph data with nodes and edges */
  data: GraphData;
  /** Width of the canvas */
  width?: string | number;
  /** Height of the canvas */
  height?: string | number;
  /** Node styling configuration */
  nodeStyle?: NodeStyleConfig;
  /** Edge styling configuration */
  edgeStyle?: EdgeStyleConfig;
  /** Layout configuration */
  layout?: LayoutConfig;
  /** Interaction handlers */
  interactions?: InteractionConfig;
}
