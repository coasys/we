import { render } from 'solid-js/web';

import { DesignToolbar } from './components/DesignToolbar';
import { EditorOverlay } from './components/EditorOverlay';
import { RightPanelContainer } from './components/RightPanelContainer';
import { type EditorHost, EditorHostProvider } from './host';
import { EditorSurfaceProvider, type SurfacePositioning } from './surface';

export interface MountOptions {
  /** Ports the editor reaches its application through. */
  host: EditorHost;
  /**
   * Render the overlay that draws selection and resize handles over the live template.
   *
   * Off by default because it draws *over* the template — an application that mounts the editor
   * beside its content rather than on top of it wants only the toolbar and panels. It is not off for
   * geometry reasons: the overlay normalises against its own root and is container-relative already.
   */
  overlay?: boolean;
  /** Render the design toolbar. Default true. */
  toolbar?: boolean;
  /** Render the right-hand panel dock. Default true. */
  panels?: boolean;
  /**
   * Where the chrome pins itself. Defaults to `container` — an application mounting the editor into
   * an element almost always means "inside this element", and the mount function makes that element
   * a positioned ancestor so the default is correct without further setup.
   *
   * Pass `viewport` for a full-screen editing mode that should own the window regardless of where it
   * was mounted.
   */
  positioning?: SurfacePositioning;
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
 * **Geometry.** The panel dock pins to the mounted element by default (`positioning: 'container'`),
 * which is what "mount the editor here" should mean.
 *
 * The overlay is already container-relative and needs nothing: it normalises every rect against its
 * own root (`toRelative`), so it works wherever it is mounted. It is off by default only because it
 * draws *over* the rendered template — an application that mounts the editor beside its content
 * rather than on top of it does not want it. Pass `overlay: true` when the editor is over the
 * template. See `tests/geometry.test.ts`.
 */
export function mountTemplateEditor(element: HTMLElement, options: MountOptions): () => void {
  const { host, overlay = false, toolbar = true, panels = true, positioning = 'container' } = options;

  // `absolute` chrome needs a positioned ancestor, and the element handed to us is the one the caller
  // means. Setting it here rather than documenting it removes the most likely way to mis-integrate:
  // chrome that lands against the window because a `position` declaration was missed.
  if (positioning === 'container' && getComputedStyle(element).position === 'static') {
    element.style.position = 'relative';
  }

  return render(
    () => (
      <EditorHostProvider value={host}>
        <EditorSurfaceProvider value={{ positioning }}>
          {overlay ? <EditorOverlay /> : null}
          {toolbar ? <DesignToolbar /> : null}
          {panels ? <RightPanelContainer /> : null}
        </EditorSurfaceProvider>
      </EditorHostProvider>
    ),
    element,
  );
}
