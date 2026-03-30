import type { Ad4mModel } from '@coasys/ad4m';

/**
 * A registered block type mapping node types to AD4M model classes.
 */
export interface BlockRegistration {
  /** Lexical/serialized node type strings that map to this block (e.g., ['paragraph', 'heading', 'quote']) */
  nodeTypes: string[];
  /** The AD4M model class for this block type */
  model: typeof Ad4mModel;
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
