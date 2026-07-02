import { createContext, useContext } from 'solid-js';

export interface VisualEditorContextValue {
  enabled: boolean;
  hoveredId: () => string | null;
  selectedId: () => string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  registerNode: (id: string, el: HTMLElement) => () => void;
  getNodeElement: (id: string) => HTMLElement | null;
}

const defaultValue: VisualEditorContextValue = {
  enabled: false,
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
