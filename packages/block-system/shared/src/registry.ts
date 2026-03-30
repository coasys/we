import type { Ad4mModel } from '@coasys/ad4m';

/** Generic component type — avoids coupling the registry to a specific framework. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlockComponent = (props: any) => any;

/**
 * A registered block type mapping node types to AD4M model classes and UI components.
 */
export interface BlockRegistration {
  /** Lexical/serialized node type strings that map to this block (e.g., ['paragraph', 'heading', 'quote']) */
  nodeTypes: string[];
  /** The AD4M model class for this block type */
  model: typeof Ad4mModel;
  /** Pure display component — props only, no onChange. Used in read-only mode and schema views. */
  display?: BlockComponent;
  /** Pure input component — receives block props + onChange + isSelected. Used in edit mode. */
  input?: BlockComponent;
}

/** Registry mapping node type strings to block registrations */
const blockRegistry = new Map<string, BlockRegistration>();

/**
 * Register a block type, mapping one or more serialized node type strings to a model class.
 */
export function registerBlock(registration: BlockRegistration): void {
  for (const nodeType of registration.nodeTypes) {
    blockRegistry.set(nodeType, registration);
  }
}

/**
 * Look up the block registration for a given serialized node type.
 */
export function getBlockRegistration(nodeType: string): BlockRegistration | undefined {
  return blockRegistry.get(nodeType);
}

/**
 * Get the model class for a given serialized node type.
 */
export function getBlockModel(nodeType: string): typeof Ad4mModel | undefined {
  return blockRegistry.get(nodeType)?.model;
}

/**
 * Update an existing block registration with additional fields (e.g., display/input components).
 * Used by framework packages to add components to registrations created by `registerBlock()`.
 */
export function updateBlockRegistration(
  nodeType: string,
  update: Partial<Pick<BlockRegistration, 'display' | 'input'>>,
): void {
  const existing = blockRegistry.get(nodeType);
  if (existing) {
    blockRegistry.set(nodeType, { ...existing, ...update });
  }
}
