import { createContext, useContext } from 'solid-js';

/**
 * A region of the page another owner provides, selected as a whole: a section the shell mounts, or a
 * panel a module draws itself. Neither is a node of the template being edited, so neither can be the
 * selected node — but each can be pointed at, named, and offered the routes to taking it over.
 */
export interface OwnerRef {
  kind: 'view' | 'panel';
  /** The view's id, or the panel's dock id (`<moduleId>:<name>`). */
  id: string;
  /** What it is called, for the label drawn round it. */
  name: string;
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
