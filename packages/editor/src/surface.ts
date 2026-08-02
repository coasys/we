import { createContext, useContext } from 'solid-js';

/**
 * Where the editing chrome positions itself.
 *
 * - `viewport` — pinned to the window (`position: fixed`). What WE's shell wants: the dock runs the
 *   full height of the screen beside the template, and the shell offsets its own content viewport to
 *   make room.
 * - `container` — pinned to the nearest positioned ancestor (`position: absolute`). What an embedding
 *   application wants when the editor lives inside a panel rather than owning the window.
 *
 * Opt-in rather than inferred. The alternative — always `absolute`, and let whoever mounts it supply
 * a positioned ancestor — silently changes where the dock lands in any host that has no such
 * ancestor, and the failure is a layout that looks *nearly* right. An explicit choice fails loudly
 * or not at all.
 */
export type SurfacePositioning = 'viewport' | 'container';

export interface EditorSurface {
  positioning: SurfacePositioning;
}

const SurfaceContext = createContext<EditorSurface>({ positioning: 'viewport' });

export const EditorSurfaceProvider = SurfaceContext.Provider;

export function useEditorSurface(): EditorSurface {
  return useContext(SurfaceContext);
}
