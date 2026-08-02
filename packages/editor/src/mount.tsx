import { render } from 'solid-js/web';

import { DesignToolbar } from './components/DesignToolbar';
import { EditorOverlay } from './components/EditorOverlay';
import { RightPanelContainer } from './components/RightPanelContainer';
import { type EditorHost, EditorHostProvider } from './host';

export interface MountOptions {
  /** Ports the editor reaches its application through. */
  host: EditorHost;
  /**
   * Render the overlay that draws selection and resize handles over the live template.
   *
   * Off by default: it positions itself over the rendered template, so an application that mounts
   * the editor beside its content rather than on top of it wants only the toolbar and panels.
   */
  overlay?: boolean;
  /** Render the design toolbar. Default true. */
  toolbar?: boolean;
  /** Render the right-hand panel dock. Default true. */
  panels?: boolean;
}

/**
 * Mount WE's editing surface into a DOM element.
 *
 * A **mount function rather than a component** on purpose. Solid renders into any DOM node, so a
 * React, Vue or Svelte application integrates by handing over an element — it never imports Solid,
 * never configures a JSX pragma, and never has two reactive runtimes in one bundle. Internally this
 * stays Solid; externally it is a function and a DOM node. The same trick that makes the Lit
 * primitives framework-neutral at the boundary.
 *
 * ```ts
 * const dispose = mountTemplateEditor(document.getElementById('editor')!, { host: myPorts });
 * // …later
 * dispose();
 * ```
 *
 * The returned function unmounts and releases every reactive subscription the surface created.
 *
 * **Geometry note.** The surface currently positions itself against the viewport (`position: fixed`),
 * inherited from having only ever run inside WE's shell. It therefore overlays the whole window
 * rather than the element passed here — usable for a full-screen editing mode, not yet for editing
 * inside a panel. Making it container-relative is a contained change to the two positioned
 * components and does not affect this signature.
 */
export function mountTemplateEditor(element: HTMLElement, options: MountOptions): () => void {
  const { host, overlay = false, toolbar = true, panels = true } = options;

  return render(
    () => (
      <EditorHostProvider value={host}>
        {overlay ? <EditorOverlay /> : null}
        {toolbar ? <DesignToolbar /> : null}
        {panels ? <RightPanelContainer /> : null}
      </EditorHostProvider>
    ),
    element,
  );
}
