// Pure framework-agnostic schema types
export type SchemaProp =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | SchemaProp[]
  | TransitionConfig
  | undefined;
export type TemplateMeta = { name: string; description: string; icon: string };
export type TemplateSchema = SchemaNode & { id?: string; schemaVersion?: number; meta: TemplateMeta };
export type RouteSchema = SchemaNode & { path: string };

// Transition configuration for $if operator (can be used in props via prop resolution)
export type TransitionConfig = {
  type: 'fade' | 'slide' | 'scale';
  duration?: number; // Milliseconds (default: 300)
  easing?: string; // CSS easing function (default: 'ease')
  delay?: number; // Milliseconds (default: 0)
};

export type SchemaNode = {
  type?: string; // Used to look up the node's component in the registry (if not included, children rendered in a fragment)
  props?: Record<string, SchemaProp>; // Props to pass to the component
  slots?: Record<string, SchemaNode>; // Named slots for components that support them
  slot?: string; // The name of the slot this node should be rendered into
  routes?: RouteSchema[]; // Routes for routing components
  children?: (SchemaNode | string)[]; // Child nodes (or strings for text nodes like <we-text>)
};

// Types that need to be passed a framework specific NodeType (e.g. JSX.Element for Solid, React.ReactNode for React)
export type ComponentRegistry<NodeType = unknown> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: (props: any) => NodeType;
};

export type RenderProps<NodeType = unknown> = {
  node: SchemaNode | null;
  stores: Record<string, unknown>;
  registry: ComponentRegistry<NodeType>;
  context?: Record<string, unknown>;
  children?: NodeType;
};

export type RendererOutput<NodeType = unknown> = NodeType | null;
