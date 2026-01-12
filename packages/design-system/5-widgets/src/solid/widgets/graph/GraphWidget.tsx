/**
 * Graph Widget
 *
 * A 2D force-directed graph visualization using D3-force for layout and Canvas for rendering.
 * Displays nodes (users, spaces, posts) and edges (relationships) with interactive features.
 */

import * as d3 from 'd3-force';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

import type {
  EdgeStyleConfig,
  GraphData,
  GraphEdge,
  GraphNode,
  InteractionConfig,
  LayoutConfig,
  NodeStyleConfig,
} from './types';

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

// Default colors for node types
const DEFAULT_NODE_COLORS = {
  user: '#3b82f6', // blue
  space: '#10b981', // green
  post: '#f59e0b', // amber
};

// Default edge colors
const DEFAULT_EDGE_COLORS = {
  follows: '#64748b',
  'member-of': '#10b981',
  'posted-in': '#8b5cf6',
  'commented-on': '#f59e0b',
};

export function GraphWidget(props: GraphWidgetProps) {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let animationFrameId: number | undefined;

  const [hoveredNode, setHoveredNode] = createSignal<GraphNode | null>(null);
  const [transform, setTransform] = createSignal({ x: 0, y: 0, k: 1 });
  const [dimensions, setDimensions] = createSignal({ width: 800, height: 600 });

  // D3 simulation
  let simulation: d3.Simulation<GraphNode, GraphEdge> | undefined;

  // Image cache for avatars
  const imageCache = new Map<string, HTMLImageElement>();

  // Preload avatar images
  const preloadImages = () => {
    props.data.nodes.forEach((node) => {
      if (node.avatar && !imageCache.has(node.avatar)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          imageCache.set(node.avatar!, img);
          render(); // Re-render when image loads
        };
        img.onerror = () => {
          console.warn(`Failed to load avatar image: ${node.avatar}`);
        };
        img.src = node.avatar;
      }
    });
  };

  // Default styling functions
  const getNodeSize = (node: GraphNode) => {
    if (props.nodeStyle?.size) return props.nodeStyle.size(node);
    return node.size || (node.type === 'user' ? 12 : node.type === 'space' ? 14 : 8);
  };

  const getNodeColor = (node: GraphNode) => {
    if (props.nodeStyle?.color) return props.nodeStyle.color(node);
    return node.color || DEFAULT_NODE_COLORS[node.type] || '#666';
  };

  const getNodeLabel = (node: GraphNode) => {
    if (props.nodeStyle?.label) return props.nodeStyle.label(node);
    return node.label;
  };

  const getLabelColor = (node: GraphNode) => {
    const labelColor = props.nodeStyle?.labelColor;
    if (!labelColor) return '#333';
    return typeof labelColor === 'function' ? labelColor(node) : labelColor;
  };

  const getLabelBackgroundColor = (node: GraphNode) => {
    const labelBgColor = props.nodeStyle?.labelBackgroundColor;
    if (!labelBgColor) return 'rgba(255, 255, 255, 0.9)';
    return typeof labelBgColor === 'function' ? labelBgColor(node) : labelBgColor;
  };

  const getLabelFontSize = () => {
    return props.nodeStyle?.labelFontSize || 12;
  };

  const getEdgeWidth = (edge: GraphEdge) => {
    if (props.edgeStyle?.width) return props.edgeStyle.width(edge);
    return edge.width || 1.5;
  };

  const getEdgeColor = (edge: GraphEdge) => {
    if (props.edgeStyle?.color) return props.edgeStyle.color(edge);
    return edge.color || DEFAULT_EDGE_COLORS[edge.type] || '#999';
  };

  // Transform screen coordinates to graph coordinates
  const screenToGraph = (screenX: number, screenY: number) => {
    const t = transform();
    return {
      x: (screenX - t.x) / t.k,
      y: (screenY - t.y) / t.k,
    };
  };

  // Find node at position
  const findNodeAtPosition = (x: number, y: number): GraphNode | null => {
    const graphPos = screenToGraph(x, y);
    for (const node of props.data.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const size = getNodeSize(node);
      const dx = node.x - graphPos.x;
      const dy = node.y - graphPos.y;
      if (dx * dx + dy * dy <= size * size) {
        return node;
      }
    }
    return null;
  };

  // Render function
  const render = () => {
    if (!canvasRef) return;

    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions();
    const t = transform();
    const hovered = hoveredNode();

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Apply transform
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Draw edges
    props.data.edges.forEach((edge) => {
      const source = typeof edge.source === 'string' ? props.data.nodes.find((n) => n.id === edge.source) : edge.source;
      const target = typeof edge.target === 'string' ? props.data.nodes.find((n) => n.id === edge.target) : edge.target;

      if (!source || !target || source.x === undefined || target.x === undefined) return;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y!);
      ctx.lineTo(target.x, target.y!);
      ctx.strokeStyle = getEdgeColor(edge as GraphEdge);
      ctx.lineWidth = getEdgeWidth(edge as GraphEdge) / t.k;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // Draw nodes
    props.data.nodes.forEach((node) => {
      if (node.x === undefined || node.y === undefined) return;

      const size = getNodeSize(node);
      const color = getNodeColor(node);
      const isHovered = hovered?.id === node.id;

      // Check if node has avatar and image is loaded
      const avatarImage = node.avatar ? imageCache.get(node.avatar) : null;

      if (avatarImage) {
        // Draw avatar image with circular clip
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();

        // Draw image centered in circle
        ctx.drawImage(avatarImage, node.x - size, node.y - size, size * 2, size * 2);

        ctx.restore();

        // Border for avatar
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1 / t.k;
        ctx.stroke();
      } else {
        // Fallback to colored circle if no avatar
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        // Border
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 1 / t.k;
        ctx.stroke();
      }

      // Hover highlight
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3 / t.k;
        ctx.stroke();
      }
    });

    // Draw labels
    if (props.nodeStyle?.showLabel !== false) {
      const fontSize = getLabelFontSize();
      ctx.font = `${fontSize / t.k}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      props.data.nodes.forEach((node) => {
        if (node.x === undefined || node.y === undefined) return;

        const label = getNodeLabel(node);
        const size = getNodeSize(node);
        const labelColor = getLabelColor(node);
        const labelBgColor = getLabelBackgroundColor(node);

        // Label background
        const metrics = ctx.measureText(label);
        const padding = 4 / t.k;
        const labelY = node.y + size + 4 / t.k;

        ctx.fillStyle = labelBgColor;
        ctx.fillRect(
          node.x - metrics.width / 2 - padding,
          labelY - padding,
          metrics.width + padding * 2,
          fontSize / t.k + padding * 2,
        );

        // Label text
        ctx.fillStyle = labelColor;
        ctx.fillText(label, node.x, labelY);
      });
    }

    ctx.restore();
  };

  // Handle mouse move
  const handleMouseMove = (e: MouseEvent) => {
    if (!containerRef) return;

    const rect = containerRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = findNodeAtPosition(x, y);
    setHoveredNode(node);

    if (node) {
      containerRef.style.cursor = 'pointer';
    } else {
      containerRef.style.cursor = 'default';
    }

    props.interactions?.onNodeHover?.(node);
  };

  // Handle click
  const handleClick = (e: MouseEvent) => {
    if (!containerRef) return;

    const rect = containerRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = findNodeAtPosition(x, y);
    if (node) {
      props.interactions?.onNodeClick?.(node);
    }
  };

  // Handle wheel for zoom
  const handleWheel = (e: WheelEvent) => {
    if (props.interactions?.enableZoom === false) return;

    e.preventDefault();
    const t = transform();
    const delta = -e.deltaY * 0.001;
    const newK = Math.max(0.1, Math.min(5, t.k * (1 + delta)));

    // Zoom towards mouse position
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const newX = x - ((x - t.x) / t.k) * newK;
      const newY = y - ((y - t.y) / t.k) * newK;

      setTransform({ x: newX, y: newY, k: newK });
    }
  };

  // Update canvas size
  const updateSize = () => {
    if (!containerRef || !canvasRef) return;

    const rect = containerRef.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvasRef.width = rect.width * dpr;
    canvasRef.height = rect.height * dpr;
    canvasRef.style.width = `${rect.width}px`;
    canvasRef.style.height = `${rect.height}px`;

    const ctx = canvasRef.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    setDimensions({ width: rect.width, height: rect.height });
  };

  onMount(() => {
    if (!canvasRef || !containerRef) return;

    // Initialize canvas size
    updateSize();
    window.addEventListener('resize', updateSize);

    // Initialize transform to center
    const { width, height } = dimensions();
    setTransform({ x: width / 2, y: height / 2, k: 1 });

    // Setup D3 force simulation
    const layoutConfig = props.layout || {};

    simulation = d3
      .forceSimulation(props.data.nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphEdge>(props.data.edges)
          .id((d) => d.id)
          .distance(layoutConfig.distance || 100),
      )
      .force('charge', d3.forceManyBody().strength(layoutConfig.chargeStrength || -300))
      .force('center', d3.forceCenter(0, 0).strength(layoutConfig.centerForce || 0.1))
      .force(
        'collision',
        d3.forceCollide().radius((d) => getNodeSize(d as GraphNode) + 5),
      )
      .alpha(1)
      .alphaDecay(0.02)
      .on('tick', render);

    // Preload avatar images
    preloadImages();

    // Start render loop
    const animate = () => {
      render();
      animationFrameId = requestAnimationFrame(animate);
    };
    animate();
  });

  onCleanup(() => {
    if (simulation) {
      simulation.stop();
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    window.removeEventListener('resize', updateSize);
  });

  // Re-render when data or style changes
  createEffect(() => {
    void props.data;
    void props.nodeStyle;
    void props.edgeStyle;
    render();
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: typeof props.width === 'number' ? `${props.width}px` : props.width || '100%',
        height: typeof props.height === 'number' ? `${props.height}px` : props.height || '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
