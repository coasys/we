import type { ModelInstance, ModelStatic } from '@we/backend-shared';

/** Generic component type — avoids coupling the registry to a specific framework. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BlockComponent = (props: any) => any;

/** The static surface a block persists through — any backend's registered implementation. */
export type BlockModelStatic = ModelStatic<ModelInstance>;

/**
 * A registered block type mapping node types to model entities and UI components.
 */
export interface BlockRegistration {
  /** Lexical/serialized node type strings that map to this block (e.g., ['paragraph', 'heading', 'quote']) */
  nodeTypes: string[];
  /** The entity's static surface — the proxy from `@we/models`, resolving to whichever backend is connected. */
  model: BlockModelStatic;
  /** The entity's manifest name — how the persistence layer looks up field facts (file storage, property sets). */
  entity: string;
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
export function getBlockModel(nodeType: string): BlockModelStatic | undefined {
  return blockRegistry.get(nodeType)?.model;
}

/**
 * Returns the distinct registrations across all registered block types (several node types, e.g.
 * 'paragraph'/'heading'/'quote', map to the same model) — model + entity name together, since the
 * persistence layer resolving an arbitrary block needs both.
 */
export function getRegisteredBlockModels(): BlockRegistration[] {
  const seen = new Set<BlockModelStatic>();
  const out: BlockRegistration[] = [];
  for (const reg of blockRegistry.values()) {
    if (seen.has(reg.model)) continue;
    seen.add(reg.model);
    out.push(reg);
  }
  return out;
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
