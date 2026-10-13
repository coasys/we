import { createContext, useContext } from 'solid-js';

/**
 * A region of the page another owner provides: a section the shell mounts, a panel a module draws
 * itself, or one node inside a part the template placed. None is a node of the template being
 * edited, so none can be the selected node — but each can be pointed at, named, and offered the
 * routes to taking it over.
 */
export interface OwnerRef {
  kind: 'view' | 'panel' | 'part-node';
  /** The view's id, the panel's dock id (`<moduleId>:<name>`), or the node's id inside its part. */
  id: string;
  /** What it is called, for the label drawn round it. */
  name: string;
  /**
   * For a node inside a part: the placements it sits in, outermost first. The first is the
   * template's own `$part` node; each after it is a part placed inside the one before.
   */
  chain?: string[];
  /** For a node inside a part: the parts on that chain by their `$part` ids, outermost first. */
  parts?: string[];
}

export interface VisualEditorContextValue {
  enabled: boolean;
  /** The owned region selected instead of a node, or null. Selecting either clears the other. */
  selectedOwner: () => OwnerRef | null;
  onSelectOwner: (owner: OwnerRef | null) => void;
  hoveredId: () => string | null;
  selectedId: () => string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  registerNode: (id: string, el: HTMLElement) => () => void;
  getNodeElement: (id: string) => HTMLElement | null;
}

const defaultValue: VisualEditorContextValue = {
  enabled: false,
  selectedOwner: () => null,
  onSelectOwner: () => {},
  hoveredId: () => null,
  selectedId: () => null,
  onHover: () => {},
  onSelect: () => {},
  registerNode: () => () => {},
  getNodeElement: () => null,
};

export const VisualEditorCtx = createContext<VisualEditorContextValue>(defaultValue);

export const VisualEditorProvider = VisualEditorCtx.Provider;

export function useVisualEditor(): VisualEditorContextValue {
  return useContext(VisualEditorCtx);
}
